/**
 * POST /api/admin/cleanup
 * Prunes expired sessions, password resets, and email verifications from D1.
 * Protected by ADMIN_API_SECRET env var.
 * Call daily from n8n or any external cron.
 */
import { log } from '../_log.js';

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.ADMIN_API_SECRET) {
    return Response.json({ error: 'Not configured' }, { status: 503 });
  }
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${env.ADMIN_API_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!env.DB) {
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);

  const sessions = await db.prepare('DELETE FROM session WHERE expires_at < ?').bind(now).run();
  const resets = await db.prepare('DELETE FROM password_reset WHERE expires_at < ?').bind(now).run();
  const verifications = await db.prepare('DELETE FROM email_verification WHERE expires_at < ?').bind(now).run();
  const sevenDaysAgo = now - 7 * 86400;
  const webhookEvents = await db.prepare('DELETE FROM webhook_event WHERE processed_at < ?').bind(sevenDaysAgo).run();
  const ninetyDaysAgo = now - 90 * 86400;
  const nlEvents = await db.prepare(
    "DELETE FROM newsletter_event WHERE created_at < datetime(?, 'unixepoch')"
  ).bind(ninetyDaysAgo).run();

  // Delete pdf_tokens more than 2 days past expiry (expired + 1-day grace)
  let pdfTokens = { meta: { changes: 0 } };
  try {
    pdfTokens = await db.prepare(
      'DELETE FROM pdf_token WHERE expires_at < ?'
    ).bind(now - 86400).run();
  } catch (err) {
    log(env, waitUntil, 'admin', 'cleanup_pdf_token_error', 'error', err.message);
  }

  const result = {
    ok: true,
    pruned: {
      sessions: sessions.meta.changes,
      password_resets: resets.meta.changes,
      email_verifications: verifications.meta.changes,
      webhook_events: webhookEvents.meta.changes,
      newsletter_events: nlEvents.meta.changes,
      pdf_tokens: pdfTokens.meta.changes,
    },
  };

  const total = result.pruned.sessions + result.pruned.password_resets + result.pruned.email_verifications + result.pruned.webhook_events + result.pruned.newsletter_events + result.pruned.pdf_tokens;
  log(env, waitUntil, 'admin', 'cleanup_completed', 'ok', `pruned ${total} rows`, 0, 200);
  return Response.json(result);
}
