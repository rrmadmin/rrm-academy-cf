/**
 * POST /api/auth/logout
 * Invalidates the current session and clears the cookie.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, invalidateSession, clearSessionCookie,
} from './_shared.js';
import { log } from '../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    if (sessionId) {
      await invalidateSession(db, sessionId);
    }

    return json(
      { ok: true },
      200,
      { 'Set-Cookie': clearSessionCookie() }
    );
  } catch (err) {
    log(env, waitUntil, 'auth', 'logout', 'error', err.message);
    return json(
      { ok: true },
      200,
      { 'Set-Cookie': clearSessionCookie() }
    );
  }
}
