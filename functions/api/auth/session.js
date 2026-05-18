/**
 * GET /api/auth/session
 * Returns the current user's session data, or null if not authenticated.
 * Used by client-side JS to check auth state.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
  sessionCookie, authHintCookie, clearAuthHintCookie,
} from './_shared.js';
import { log } from '../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

// Server saw a hint cookie but no/invalid session — clear the stale hint so
// JS stops paying for auth fetches it doesn't need.
function hasHintCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  return /(?:^|;\s*)rrm_auth=1/.test(cookie);
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);

    if (!session) {
      const driftHeaders = hasHintCookie(request) ? { 'Set-Cookie': clearAuthHintCookie() } : {};
      return json({ ok: true, user: null }, 200, driftHeaders);
    }

    // Fetch user data
    const user = await db.prepare(
      'SELECT id, email, name, first_name, last_name, email_verified, role, blocked, created_at FROM user WHERE id = ?'
    ).bind(session.userId).first();

    if (!user) {
      const driftHeaders = hasHintCookie(request) ? { 'Set-Cookie': clearAuthHintCookie() } : {};
      return json({ ok: true, user: null }, 200, driftHeaders);
    }

    const headers = {};
    // If session was renewed, send updated cookies (HttpOnly + hint).
    // We refresh the hint cookie's Expires whenever the session renews so its
    // lifetime tracks the underlying session.
    if (session.renewed) {
      headers['Set-Cookie'] = [
        sessionCookie(session.id, session.expiresAt),
        authHintCookie(session.expiresAt),
      ];
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
