/**
 * PATCH /api/auth/profile
 * Updates the authenticated user's profile fields (first name, last name).
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from './_shared.js';
import { log } from '../_log.js';

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
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    // Fetch current user data
    const user = await db.prepare(
      'SELECT first_name, last_name FROM user WHERE id = ?'
    ).bind(session.userId).first();
    if (!user) return json({ ok: false, error: 'User not found.' }, 404);

    // Determine updated values (only update what's provided)
    const firstName = body.firstName !== undefined ? String(body.firstName || '').trim() : (user.first_name || '');
    const lastName = body.lastName !== undefined ? String(body.lastName || '').trim() : (user.last_name || '');

    // Validate only fields the caller actually sent
    if (body.firstName !== undefined && (!firstName || firstName.length > 100)) {
      return json({ ok: false, error: 'First name is required (max 100 characters).' }, 400);
    }
    if (body.lastName !== undefined && (!lastName || lastName.length > 100)) {
      return json({ ok: false, error: 'Last name is required (max 100 characters).' }, 400);
    }

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
