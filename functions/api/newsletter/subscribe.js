/**
 * POST /api/newsletter/subscribe
 * Validates Turnstile token, adds subscriber to D1, optionally updates D1 user table.
 */
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';
import { json, optionsResponse, verifyTurnstile, checkRateLimit } from '../auth/_shared.js';
import { verifyAndTagEmail } from '../_elv.js';
import { withIdempotency } from '../_idempotency.js';
import { validateBody } from '../_validate.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  return withIdempotency(context, _handlePost);
}

async function _handlePost(context) {
  const { request, env, waitUntil } = context;

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

  // Rate limit by IP (protects ELV API credits); KV-backed so applies across all isolates
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, `newsletter-sub:${ip}`, 10, 900);
  if (!allowed) {
    return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);
  }

  // Honeypot
  if (body.website) {
    return json({ ok: true });
  }

  // Validate email via validateBody (NFC-normalized, length-capped, null-byte safe)
  const emailValidation = validateBody(body, { email: { type: 'email', required: true } });
  if (!emailValidation.valid) {
    return json({ ok: false, error: 'Valid email is required.' }, 400);
  }
  const email = emailValidation.data.email;

  // Verify Turnstile token
  const turnstileResult = await verifyTurnstile(env.CF_TURNSTILE_SECRET, body.turnstileToken, ip, env);
  if (!turnstileResult.ok) {
    const turnstileMsg = turnstileResult.reason === 'network'
      ? 'Verification service unavailable. Please try again in a moment.'
      : 'Spam check failed. Please refresh and try again.';
    return json({ ok: false, error: turnstileMsg }, 403);
  }

  // ELV mailbox verification (blocks spamtraps, disabled mailboxes, disposables)
  const elv = await verifyAndTagEmail(email, env, { source: 'newsletter' });
  if (elv.blocked) {
    return json({ ok: false, error: elv.reason }, 400);
  }

  // Add to D1 newsletter_subscriber
  try {
    // Check for existing subscriber
    const existing = await env.DB.prepare(
      'SELECT id, status FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE'
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
      // Only 'unsubscribed' status falls through to re-activation
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE newsletter_subscriber SET status = 'active', unsubscribed_at = NULL WHERE id = ?"
        ).bind(existing.id),
        env.DB.prepare(
          "UPDATE user SET newsletter_opt_in = 1, newsletter_opted_in_at = datetime('now') WHERE email = ? COLLATE NOCASE"
        ).bind(email),
      ]);
      return json({ ok: true, message: 'You are subscribed!' });
    }

    // Create new subscriber (ON CONFLICT handles race between the SELECT above and this INSERT)
    const id = crypto.randomUUID();
    const insertResult = await env.DB.prepare(
      "INSERT INTO newsletter_subscriber (id, email, source) VALUES (?, ?, 'website') ON CONFLICT(email) DO NOTHING"
    ).bind(id, email).run();
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
    await env.DB.prepare(
      "UPDATE user SET newsletter_opt_in = 1, newsletter_opted_in_at = datetime('now') WHERE email = ? COLLATE NOCASE"
    ).bind(email).run();
  } catch (err) {
    // Non-fatal: subscriber is added to newsletter_subscriber even if user update fails
    log(env, waitUntil, 'newsletter', 'd1_update_error', 'warn', err.message, 0, 0);
  }

  waitUntil(sendGA4Event(env, request, 'generate_lead', { lead_source: 'newsletter' }).catch(() => {}));

  return json({ ok: true, message: 'You are subscribed!' });
}
