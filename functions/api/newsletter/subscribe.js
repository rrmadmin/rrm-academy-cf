/**
 * POST /api/newsletter/subscribe
 * Validates Turnstile token, adds subscriber to D1, optionally updates D1 user table.
 */
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';
import { json, optionsResponse, verifyTurnstile } from '../auth/_shared.js';
import { verifyAndTagEmail } from '../_elv.js';

// Looser than auth rate limit (10/15min vs 5/15min) but still prevents ELV credit burning
const rateLimits = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 10;

function checkSubscribeRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    rateLimits.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_REQUESTS;
}

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
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

  // Rate limit by IP (protects ELV API credits)
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkSubscribeRateLimit(ip)) {
    return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);
  }

  // Honeypot
  if (body.website) {
    return json({ ok: true });
  }

  // Validate email
  const email = (body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Valid email is required.' }, 400);
  }

  // Verify Turnstile token
  const turnstileOk = await verifyTurnstile(env.CF_TURNSTILE_SECRET, body.turnstileToken, ip);
  if (!turnstileOk) {
    return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);
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
        return json({ ok: true, message: 'You are already subscribed.' });
      }
      // Re-activate unsubscribed/bounced subscriber
      await env.DB.prepare(
        "UPDATE newsletter_subscriber SET status = 'active', unsubscribed_at = NULL, bounce_count = 0 WHERE id = ?"
      ).bind(existing.id).run();
      try {
        await env.DB.prepare(
          "UPDATE user SET newsletter_opt_in = 1, newsletter_opted_in_at = datetime('now') WHERE email = ? COLLATE NOCASE"
        ).bind(email).run();
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'd1_update_error', 'warn', err.message, 0, 0);
      }
      return json({ ok: true, message: 'You are subscribed!' });
    }

    // Create new subscriber
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO newsletter_subscriber (id, email, source) VALUES (?, ?, 'website')"
    ).bind(id, email).run();
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

  waitUntil(sendGA4Event(env, request, 'generate_lead', { event_category: 'newsletter' }).catch(() => {}));

  return json({ ok: true, message: 'You are subscribed!' });
}
