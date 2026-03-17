/**
 * Newsletter unsubscribe handler.
 * GET: renders confirmation page (link from email footer)
 * POST: one-click unsubscribe (RFC 8058, called by Gmail/Yahoo)
 */
import { log } from '../_log.js';
import { hmacToken } from './_tracking.js';

async function unsubscribe(db, email, waitUntil, env) {
  await db.prepare(
    "UPDATE newsletter_subscriber SET status = 'unsubscribed', unsubscribed_at = datetime('now') WHERE email = ? COLLATE NOCASE AND status = 'active'"
  ).bind(email).run();
  // Sync user table opt-in flag
  await db.prepare(
    "UPDATE user SET newsletter_opt_in = 0 WHERE email = ? COLLATE NOCASE"
  ).bind(email).run();
  await db.prepare(
    "INSERT INTO email_log (event, email, category, source) VALUES ('unsubscribed', ?, 'newsletter', 'newsletter/unsubscribe')"
  ).bind(email.toLowerCase()).run();
  log(env, waitUntil, 'newsletter', 'unsubscribe', 'ok', email, 0, 200);
}

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.DB) {
    log(env, waitUntil, 'newsletter', 'config_missing', 'error', 'DB binding not configured', 0, 500);
    return new Response('Server error. Please try again later.', { status: 500, headers: { 'Content-Type': 'text/html' } });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';
  const email = url.searchParams.get('e') || '';

  if (!token || !email || !env.NEWSLETTER_SECRET) {
    return new Response('Invalid unsubscribe link.', { status: 400, headers: { 'Content-Type': 'text/html' } });
  }

  const expected = await hmacToken(email, env.NEWSLETTER_SECRET);
  if (token !== expected) {
    return new Response('Invalid unsubscribe link.', { status: 400, headers: { 'Content-Type': 'text/html' } });
  }

  await unsubscribe(env.DB, email, waitUntil, env);

  return new Response(`<!DOCTYPE html>
<html><head><title>Unsubscribed</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#333;}
a{color:#725e7e;}</style></head>
<body><h1>You've been unsubscribed</h1>
<p>You won't receive any more emails from RRM Academy.</p>
<p>Changed your mind? <a href="https://rrmacademy.org/">Visit RRM Academy</a> and re-subscribe from the footer.</p>
</body></html>`, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.DB) {
    log(env, waitUntil, 'newsletter', 'config_missing', 'error', 'DB binding not configured', 0, 500);
    return new Response('', { status: 500 });
  }

  // RFC 8058 one-click: Gmail/Yahoo POST with form-encoded body
  const url = new URL(request.url);
  const email = url.searchParams.get('e') || '';
  const token = url.searchParams.get('t') || '';

  if (!email || !token || !env.NEWSLETTER_SECRET) {
    return new Response('', { status: 400 });
  }

  const expected = await hmacToken(email, env.NEWSLETTER_SECRET);
  if (token !== expected) {
    return new Response('', { status: 400 });
  }

  await unsubscribe(env.DB, email, waitUntil, env);
  return new Response('', { status: 200 });
}
