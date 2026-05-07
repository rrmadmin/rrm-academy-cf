/**
 * PATCH /api/auth/profile
 * Updates the authenticated user's profile fields (first name, last name).
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from './_shared.js';
import { log } from '../_log.js';
import { validateBody } from '../_validate.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPatch({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    // Require authenticated session
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) {
      return json({ ok: false, error: 'Not authenticated.' }, 401);
    }

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const validation = validateBody(body, {
      firstName: { type: 'string', minLength: 1, maxLength: 100 },
      lastName: { type: 'string', minLength: 1, maxLength: 100 },
    });
    if (!validation.valid) return json({ ok: false, error: validation.error }, validation.status);
    if (Object.keys(validation.data).length === 0) {
      return json({ ok: false, error: 'No fields to update.' }, 400);
    }

    const user = await db.prepare(
      'SELECT first_name, last_name FROM user WHERE id = ?'
    ).bind(session.userId).first();
    if (!user) return json({ ok: false, error: 'User not found.' }, 404);

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
    });
  } catch (err) {
    log(env, waitUntil, 'auth', 'profile_error', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
