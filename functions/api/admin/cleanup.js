/**
 * POST /api/admin/cleanup
 * Prunes expired sessions, password resets, and email verifications from D1.
 * Protected by ADMIN_API_SECRET env var.
 * Call daily from n8n or any external cron.
 */
export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('Authorization');
  if (!env.ADMIN_API_SECRET || auth !== `Bearer ${env.ADMIN_API_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);

  const sessions = await db.prepare('DELETE FROM session WHERE expires_at < ?').bind(now).run();
  const resets = await db.prepare('DELETE FROM password_reset WHERE expires_at < ?').bind(now).run();
  const verifications = await db.prepare('DELETE FROM email_verification WHERE expires_at < ?').bind(now).run();
  const sevenDaysAgo = now - 7 * 86400;
  const webhookEvents = await db.prepare('DELETE FROM webhook_event WHERE processed_at < ?').bind(sevenDaysAgo).run();

  const result = {
    ok: true,
    pruned: {
      sessions: sessions.meta.changes,
      password_resets: resets.meta.changes,
      email_verifications: verifications.meta.changes,
      webhook_events: webhookEvents.meta.changes,
    },
  };

  console.log('Cleanup:', JSON.stringify(result));
  return Response.json(result);
}
