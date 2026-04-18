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

  // Single-DB cleanup: batched for atomicity and fewer round trips.
  // Order matches the `pruned` keys so results[i] maps to the right counter.
  let batchFailed = false;
  try {
    const results = await db.batch([
      db.prepare('DELETE FROM session WHERE expires_at < ?').bind(now),
      db.prepare('DELETE FROM password_reset WHERE expires_at < ?').bind(now),
      db.prepare('DELETE FROM email_verification WHERE expires_at < ?').bind(now),
      db.prepare('DELETE FROM webhook_event WHERE processed_at < ?').bind(sevenDaysAgo),
      db.prepare("DELETE FROM newsletter_event WHERE created_at < datetime(?, 'unixepoch')").bind(now - 90 * 86400),
      db.prepare('DELETE FROM pdf_token WHERE expires_at < ?').bind(pdfTokenCutoff),
      db.prepare("DELETE FROM email_log WHERE created_at < datetime('now', '-90 days')"),
    ]);
    pruned.sessions = results[0]?.meta?.changes ?? 0;
    pruned.password_resets = results[1]?.meta?.changes ?? 0;
    pruned.email_verifications = results[2]?.meta?.changes ?? 0;
    pruned.webhook_events = results[3]?.meta?.changes ?? 0;
    pruned.newsletter_events = results[4]?.meta?.changes ?? 0;
    pruned.pdf_tokens = results[5]?.meta?.changes ?? 0;
    pruned.email_log = results[6]?.meta?.changes ?? 0;
  } catch (err) {
    batchFailed = true;
    log(env, waitUntil, 'admin', 'cleanup_batch_error', 'error', err.message);
  }

  // search_log lives in a separate D1 (rrm-analytics) so it runs outside the batch.
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
  log(env, waitUntil, 'admin', 'cleanup_completed', batchFailed ? 'error' : 'ok', `pruned ${total} rows${batchFailed ? ' (batch failed)' : ''}`, 0, batchFailed ? 500 : 200);
  if (batchFailed) {
    return json({ ok: false, error: 'cleanup_batch_failed', pruned }, 500);
  }
  return json({ ok: true, pruned });
}
