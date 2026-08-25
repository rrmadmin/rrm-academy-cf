/**
 * POST /api/newsletter/subscribe
 * Validates Turnstile token, adds subscriber to D1, optionally updates D1 user table.
 */
import { sendGA4Event } from '../_ga4.js';
import { sendGoogleAdsConversion, NEWSLETTER_CONVERSION_ACTION_ID } from '../_google-ads.js';
import { log } from '../_log.js';
import { json, optionsResponse, verifyTurnstile, checkRateLimit } from '../auth/_shared.js';
import { verifyAndTagEmail } from '../_elv.js';
import { withIdempotency } from '../_idempotency.js';
import { validateBody } from '../_validate.js';
import { canonicalizeEmail } from '../auth/_email-validate.js';
import { sendSignupEmails } from './_signup-emails.js';

// The opt-in UPDATE, extended to seed a name onto a user row that has none.
// Bind order: (firstName, firstName, email).
//
// The name columns are written only when ALL THREE are blank, mirroring the
// checkout backfill in billing/_webhook-checkout.js: a row that already carries
// any name is never renamed by a newsletter signup. SQLite evaluates every RHS
// expression against the pre-UPDATE row, so both CASE guards see the original
// values and cannot disagree with each other mid-statement.
const USER_NAME_BACKFILL_SQL =
  "UPDATE user SET newsletter_opt_in = 1, newsletter_opted_in_at = datetime('now'), " +
  "first_name = CASE WHEN TRIM(COALESCE(name, '')) = '' AND TRIM(COALESCE(first_name, '')) = '' " +
  "AND TRIM(COALESCE(last_name, '')) = '' THEN ? ELSE first_name END, " +
  "name = CASE WHEN TRIM(COALESCE(name, '')) = '' AND TRIM(COALESCE(first_name, '')) = '' " +
  "AND TRIM(COALESCE(last_name, '')) = '' THEN ? ELSE name END, " +
  "updated_at = datetime('now') WHERE email = ? COLLATE NOCASE";

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  return withIdempotency(context, _handlePost);
}

async function _handlePost(context) {
  const { request, env, waitUntil } = context;

  // Rate limit by IP (protects ELV API credits); KV-backed so applies across all isolates
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, `newsletter-sub:${ip}`, 10, 900);
  if (!allowed) {
    return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);
  }

  if (!env.DB) {
    log(env, waitUntil, 'newsletter', 'config_missing', 'error', 'DB binding not configured', 0, 500);
    return json({ ok: false, error: 'Server misconfigured' }, 500);
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  // Honeypot
  if (body.website) {
    return json({ ok: true });
  }

  // Validate email via validateBody (NFC-normalized, length-capped, null-byte safe)
  const emailValidation = validateBody(body, { email: { type: 'email', required: true } });
  if (!emailValidation.valid) {
    return json({ ok: false, error: 'Valid email is required.' }, 400);
  }
  // First name, required since 2026-08-25. This form collected email only, and
  // newsletter_subscriber.name went unwritten on every website signup, which is
  // why 3,266 active subscribers have no name to greet. Validated through the
  // same helper as email so it is trimmed, length-capped and null-byte safe.
  const nameValidation = validateBody(body, { firstName: { type: 'string', required: true, maxLength: 100 } });
  if (!nameValidation.valid) {
    return json({ ok: false, error: 'First name is required.' }, 400);
  }
  const firstName = nameValidation.data.firstName;
  // Canonicalize on new-write paths only; unsubscribe/bounce key on stored value to avoid missing non-canonical existing rows.
  const email = canonicalizeEmail(emailValidation.data.email);

  // Verify Turnstile token
  const turnstileResult = await verifyTurnstile(env.CF_TURNSTILE_SECRET, body.turnstileToken, ip, env);
  if (!turnstileResult.ok) {
    const turnstileMsg = turnstileResult.reason === 'network'
      ? 'Verification service unavailable. Please try again in a moment.'
      : 'Spam check failed. Please refresh and try again.';
    return json({ ok: false, error: turnstileMsg }, 403);
  }

  // ELV mailbox verification (blocks spamtraps, disabled mailboxes, disposables)
  // firstName rides along so the CRM contact row is created with a name too,
  // instead of the email-derived guess the old wix-site import left behind.
  const elv = await verifyAndTagEmail(email, env, { firstName, source: 'newsletter' });
  if (elv.blocked) {
    return json({ ok: false, error: elv.reason }, 400);
  }

  // Add to D1 newsletter_subscriber
  try {
    // Check for existing subscriber
    const existing = await env.DB.prepare(
      'SELECT id, status, name FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE'
    ).bind(email).first();

    if (existing) {
      if (existing.status === 'active') {
        return json({ ok: true, message: 'You are subscribed!' });
      }
      if (existing.status === 'complained') {
        // CAN-SPAM: never auto-resubscribe a complainant
        log(env, waitUntil, 'newsletter', 'resub_blocked_complained', 'warn', existing.id, 0, 200);
        return json({ ok: true, message: 'You are subscribed!' });
      }
      if (existing.status === 'bounced') {
        // Require fresh ELV-verified send before treating as deliverable
        log(env, waitUntil, 'newsletter', 'resub_blocked_bounced', 'warn', existing.id, 0, 200);
        return json({ ok: true, message: 'You are subscribed!' });
      }
      // Only 'unsubscribed' status falls through to re-activation.
      // COALESCE(NULLIF(...)) keeps a name already on file: a re-subscribe is not
      // a rename, and the stored value may be a fuller name than this one field.
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE newsletter_subscriber SET status = 'active', unsubscribed_at = NULL, " +
          "name = COALESCE(NULLIF(TRIM(COALESCE(name, '')), ''), ?) WHERE id = ?"
        ).bind(firstName, existing.id),
        env.DB.prepare(USER_NAME_BACKFILL_SQL).bind(firstName, firstName, email),
      ]);
      return json({ ok: true, message: 'You are subscribed!' });
    }

    // Create new subscriber (ON CONFLICT handles race between the SELECT above and this INSERT)
    const id = crypto.randomUUID();
    const insertResult = await env.DB.prepare(
      "INSERT INTO newsletter_subscriber (id, email, name, source) VALUES (?, ?, ?, 'website') ON CONFLICT(email) DO NOTHING"
    ).bind(id, email, firstName).run();
    if (insertResult.meta?.changes === 0) {
      // Race: another request inserted between our SELECT and this INSERT
      return json({ ok: true, message: 'You are subscribed!' });
    }
  } catch (err) {
    log(env, waitUntil, 'newsletter', 'subscribe_error', 'error', err.message, 0, 502);
    return json({ ok: false, error: 'Something went wrong. Please try again.' }, 502);
  }

  // Optionally update D1 newsletter_opt_in if user exists
  try {
    await env.DB.prepare(USER_NAME_BACKFILL_SQL).bind(firstName, firstName, email).run();
  } catch (err) {
    // Non-fatal: subscriber is added to newsletter_subscriber even if user update fails
    log(env, waitUntil, 'newsletter', 'd1_update_error', 'warn', err.message, 0, 0);
  }

  waitUntil(sendGA4Event(env, request, 'generate_lead', { lead_source: 'newsletter' }).catch(() => {}));
  sendGoogleAdsConversion(env, waitUntil, request.headers.get('Cookie') || '', NEWSLETTER_CONVERSION_ACTION_ID);
  sendSignupEmails(env, waitUntil, email);

  return json({ ok: true, message: 'You are subscribed!' });
}
