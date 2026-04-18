/**
 * Best-effort session population for /api/admin/* endpoints.
 *
 * Populates context.data.user and context.data.session from a valid session
 * cookie when one is present. Does NOT enforce auth — each endpoint does its
 * own check (e.g. `if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)`).
 *
 * Why best-effort and not enforced:
 *   cleanup.js, ecosystem.js, and seo.js use Bearer ADMIN_API_SECRET auth and
 *   ignore context.data.user entirely. Enforcing session auth here would break
 *   those endpoints.
 *
 * On any error during session or user lookup, leaves context.data.user undefined
 * so the endpoint's own auth check returns 401.
 */
import { getSessionIdFromCookie, validateSession } from '../auth/_shared.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (!context.data) context.data = {};

  if (env.DB) {
    try {
      const sessionId = getSessionIdFromCookie(request);
      const session = await validateSession(env.DB, sessionId);
      if (session) {
        const user = await env.DB.prepare(
          'SELECT id, email, name, role, blocked FROM user WHERE id = ?'
        ).bind(session.userId).first();

        if (user && !user.blocked) {
          context.data.user = user;
          context.data.session = session;
        }
      }
    } catch {
      // Leave context.data.user undefined; endpoint enforces auth.
    }
  }

  return context.next();
}
