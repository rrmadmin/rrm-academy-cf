/**
 * GET /api/auth/session
 * Returns the current user's session data, or null if not authenticated.
 * Used by client-side JS to check auth state.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, sessionCookie, CORS_HEADERS,
} from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(db, sessionId);

  if (!session) {
    return json({ ok: true, user: null });
  }

  // Fetch user data
  const user = await db.prepare(
    'SELECT id, email, name, email_verified, role, stripe_customer_id FROM user WHERE id = ?'
  ).bind(session.userId).first();

  if (!user) {
    return json({ ok: true, user: null });
  }

  const headers = {};
  // If session was renewed, send updated cookie
  if (session.renewed) {
    headers['Set-Cookie'] = sessionCookie(session.id, session.expiresAt);
  }

  return json(
    {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: !!user.email_verified,
        role: user.role,
      },
    },
    200,
    headers
  );
}
