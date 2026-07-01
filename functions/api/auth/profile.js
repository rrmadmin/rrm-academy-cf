/**
 * PATCH /api/auth/profile
 * Updates the authenticated user's profile fields (first name, last name).
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, checkRateLimit,
  sessionCookie, authHintCookie,
} from './_shared.js';
import { log } from '../_log.js';
import { validateBody } from '../_validate.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPatch({ request, env, waitUntil }) {
  let responseHeaders = {};
  try {
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip) return json({ ok: false, error: 'Service temporarily unavailable.' }, 503);
    const allowed = await checkRateLimit(env, `prof:${ip}`, 60, 60);
    if (!allowed) return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);

    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    // Require authenticated session
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) {
      return json({ ok: false, error: 'Not authenticated.' }, 401);
    }

    // Build renewed-cookie headers once so every return path after this point
    // carries them (rate limit/validation early returns included).
    if (session.renewed) {
      responseHeaders['Set-Cookie'] = [
        sessionCookie(session.cookieId, session.expiresAt),
        authHintCookie(session.expiresAt),
      ];
    }

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400, responseHeaders); }

    const validation = validateBody(body, {
      firstName: { type: 'string', minLength: 1, maxLength: 100 },
      lastName: { type: 'string', minLength: 1, maxLength: 100 },
    });
    if (!validation.valid) return json({ ok: false, error: validation.error }, validation.status, responseHeaders);
    if (Object.keys(validation.data).length === 0) {
      return json({ ok: false, error: 'No fields to update.' }, 400, responseHeaders);
    }

    const user = await db.prepare(
      'SELECT first_name, last_name FROM user WHERE id = ?'
    ).bind(session.userId).first();
    if (!user) return json({ ok: false, error: 'Not authenticated.' }, 401, responseHeaders);

    const firstName = validation.data.firstName !== undefined ? validation.data.firstName : (user.first_name || '');
    const lastName = validation.data.lastName !== undefined ? validation.data.lastName : (user.last_name || '');

    // Update
    const name = firstName + ' ' + lastName;
    await db.prepare(
      "UPDATE user SET first_name = ?, last_name = ?, name = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(firstName, lastName, name, session.userId).run();

    return json({
      ok: true,
      user: { firstName, lastName, name },
    }, 200, responseHeaders);
  } catch (err) {
    log(env, waitUntil, 'auth', 'profile_error', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500, responseHeaders);
  }
}
