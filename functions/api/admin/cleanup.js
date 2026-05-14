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
  const sevenDaysAgo = now - 7 * 86400;
  const pdfTokenCutoff = now - 86400;

  const pruned = {
    sessions: 0,
    password_resets: 0,
    email_verifications: 0,
    webhook_events: 0,
    newsletter_events: 0,
    pdf_tokens: 0,
    email_log: 0,
    search_log: 0,
  };
  const errors = [];

  // Sequential per-table cleanup so a lock on one table (e.g. webhook_event
  // under concurrent writes) doesn't roll back the others.
  try {
    const r = await db.prepare('DELETE FROM session WHERE expires_at < ?').bind(now).run();
    pruned.sessions = r.meta?.changes ?? 0;
  } catch (e) {
    errors.push(`session: ${e.message}`);
  }
  try {
    const r = await db.prepare('DELETE FROM password_reset WHERE expires_at < ?').bind(now).run();
    pruned.password_resets = r.meta?.changes ?? 0;
  } catch (e) {
    errors.push(`password_reset: ${e.message}`);
  }
  try {
    const r = await db.prepare('DELETE FROM email_verification WHERE expires_at < ?').bind(now).run();
    pruned.email_verifications = r.meta?.changes ?? 0;
  } catch (e) {
    errors.push(`email_verification: ${e.message}`);
  }
  try {
    const r = await db.prepare('DELETE FROM webhook_event WHERE processed_at < ?').bind(sevenDaysAgo).run();
    pruned.webhook_events = r.meta?.changes ?? 0;
  } catch (e) {
    errors.push(`webhook_event: ${e.message}`);
  }
  try {
    const r = await db.prepare("DELETE FROM newsletter_event WHERE created_at < datetime(?, 'unixepoch')").bind(now - 90 * 86400).run();
    pruned.newsletter_events = r.meta?.changes ?? 0;
  } catch (e) {
    errors.push(`newsletter_event: ${e.message}`);
  }
  try {
    const r = await db.prepare('DELETE FROM pdf_token WHERE expires_at < ?').bind(pdfTokenCutoff).run();
    pruned.pdf_tokens = r.meta?.changes ?? 0;
  } catch (e) {
    errors.push(`pdf_token: ${e.message}`);
  }
  try {
    const r = await db.prepare("DELETE FROM email_log WHERE created_at < datetime('now', '-90 days')").run();
    pruned.email_log = r.meta?.changes ?? 0;
  } catch (e) {
    errors.push(`email_log: ${e.message}`);
  }

  if (errors.length) {
    log(env, waitUntil, 'admin', 'cleanup_partial_failure', 'warn', errors.join('; '));
  }

  // search_log lives in a separate D1 (rrm-analytics) so it runs outside the main DB loop.
  try {
    if (env.ANALYTICS_DB) {
      const r = await env.ANALYTICS_DB.prepare(
        "DELETE FROM search_log WHERE created_at < datetime('now', '-365 days')"
      ).run();
      pruned.search_log = r.meta.changes;
    }
  } catch (err) {
    log(env, waitUntil, 'admin', 'cleanup_search_log_error', 'error', err.message);
  }

  const total = pruned.sessions + pruned.password_resets + pruned.email_verifications + pruned.webhook_events + pruned.newsletter_events + pruned.pdf_tokens + pruned.email_log + pruned.search_log;
  log(env, waitUntil, 'admin', 'cleanup_completed', errors.length ? 'warn' : 'ok', `pruned ${total} rows${errors.length ? ' (partial failure)' : ''}`, 0, 200);
  return json({ ok: true, pruned, ...(errors.length ? { errors: errors } : {}) });
}
