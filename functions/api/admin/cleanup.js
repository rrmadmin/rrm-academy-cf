/**
 * POST /api/admin/cleanup
 * Prunes expired sessions, password resets, and email verifications from D1.
 * Protected by ADMIN_API_SECRET env var.
 * Call daily from n8n or any external cron.
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.ADMIN_API_SECRET) {
    return json({ ok: false, error: 'Not configured' }, 503);
  }

  const auth = request.headers.get('Authorization') || '';
  const expected = `Bearer ${env.ADMIN_API_SECRET}`;
  const authBytes = new TextEncoder().encode(auth);
  const expectedBytes = new TextEncoder().encode(expected);
  let mismatch = authBytes.length !== expectedBytes.length ? 1 : 0;
  const len = Math.min(authBytes.length, expectedBytes.length);
  for (let i = 0; i < len; i++) {
    mismatch |= authBytes[i] ^ expectedBytes[i];
  }
  if (mismatch !== 0) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);
  const pruned = {
    sessions: 0,
    password_resets: 0,
    email_verifications: 0,
    webhook_events: 0,
    newsletter_events: 0,
    pdf_tokens: 0,
    email_log: 0,
  };

  try {
    const r = await db.prepare('DELETE FROM session WHERE expires_at < ?').bind(now).run();
    pruned.sessions = r.meta.changes;
  } catch (err) {
    log(env, waitUntil, 'admin', 'cleanup_sessions_error', 'error', err.message);
  }

  try {
    const r = await db.prepare('DELETE FROM password_reset WHERE expires_at < ?').bind(now).run();
    pruned.password_resets = r.meta.changes;
  } catch (err) {
    log(env, waitUntil, 'admin', 'cleanup_resets_error', 'error', err.message);
  }

  try {
    const r = await db.prepare('DELETE FROM email_verification WHERE expires_at < ?').bind(now).run();
    pruned.email_verifications = r.meta.changes;
  } catch (err) {
    log(env, waitUntil, 'admin', 'cleanup_verifications_error', 'error', err.message);
  }

  try {
    const sevenDaysAgo = now - 7 * 86400;
    const r = await db.prepare('DELETE FROM webhook_event WHERE processed_at < ?').bind(sevenDaysAgo).run();
    pruned.webhook_events = r.meta.changes;
  } catch (err) {
    log(env, waitUntil, 'admin', 'cleanup_webhook_events_error', 'error', err.message);
  }

  try {
    const ninetyDaysAgo = now - 90 * 86400;
    const r = await db.prepare(
      "DELETE FROM newsletter_event WHERE created_at < datetime(?, 'unixepoch')"
    ).bind(ninetyDaysAgo).run();
    pruned.newsletter_events = r.meta.changes;
  } catch (err) {
    log(env, waitUntil, 'admin', 'cleanup_newsletter_events_error', 'error', err.message);
  }

  try {
    const r = await db.prepare(
      'DELETE FROM pdf_token WHERE expires_at < ?'
    ).bind(now - 86400).run();
    pruned.pdf_tokens = r.meta.changes;
  } catch (err) {
    log(env, waitUntil, 'admin', 'cleanup_pdf_token_error', 'error', err.message);
  }

  let emailLogPruned = 0;
  try {
    const emailLogResult = await db.prepare(
      "DELETE FROM email_log WHERE created_at < datetime('now', '-90 days')"
    ).run();
    emailLogPruned = emailLogResult.meta.changes;
  } catch (err) {
    log(env, waitUntil, 'admin', 'cleanup_email_log_error', 'error', err.message);
  }
  pruned.email_log = emailLogPruned;

  const total = pruned.sessions + pruned.password_resets + pruned.email_verifications + pruned.webhook_events + pruned.newsletter_events + pruned.pdf_tokens + pruned.email_log;
  log(env, waitUntil, 'admin', 'cleanup_completed', 'ok', `pruned ${total} rows`, 0, 200);
  return json({ ok: true, pruned });
}
