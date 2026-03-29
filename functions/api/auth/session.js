/**
 * GET /api/auth/session
 * Returns the current user's session data, or null if not authenticated.
 * Used by client-side JS to check auth state.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, sessionCookie,
} from './_shared.js';
import { log } from '../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);

    if (!session) {
      return json({ ok: true, user: null });
    }

    // Fetch user data
    const user = await db.prepare(
      'SELECT id, email, name, first_name, last_name, email_verified, role, blocked, created_at FROM user WHERE id = ?'
    ).bind(session.userId).first();

    if (!user || user.blocked) {
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
          firstName: user.first_name || '',
          lastName: user.last_name || '',
          emailVerified: !!user.email_verified,
          role: user.role,
          createdAt: user.created_at,
        },
      },
      200,
      headers
    );
  } catch (err) {
    log(env, waitUntil, 'auth', 'session_error', 'error', err.message);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
