/**
 * POST /api/newsletter/subscribe
 * Validates Turnstile token, adds subscriber to D1, optionally updates D1 user table.
 */
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';
import { json, optionsResponse } from '../auth/_shared.js';

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
  const turnstileToken = body.turnstileToken || '';
  if (env.CF_TURNSTILE_SECRET && turnstileToken) {
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const verifyResp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.CF_TURNSTILE_SECRET,
        response: turnstileToken,
        remoteip: ip,
      }),
    });
    if (!verifyResp.ok) {
      log(env, waitUntil, 'newsletter', 'turnstile_http_error', 'error', `Turnstile returned ${verifyResp.status}`, 0, verifyResp.status);
      return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);
    }
    const result = await verifyResp.json();
    if (!result.success) {
      return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);
    }
  } else if (env.CF_TURNSTILE_SECRET) {
    return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);
  }

  // Add to D1 newsletter_subscriber
  try {
    // Check for existing subscriber
    const existing = await env.DB.prepare(
      'SELECT id, status FROM newsletter_subscriber WHERE email = ?'
    ).bind(email).first();

    if (existing) {
      if (existing.status === 'active') {
        return json({ ok: true, message: 'You are already subscribed.' });
      }
      // Re-activate unsubscribed/bounced subscriber
      await env.DB.prepare(
        "UPDATE newsletter_subscriber SET status = 'active', unsubscribed_at = NULL, bounce_count = 0 WHERE id = ?"
      ).bind(existing.id).run();
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
