/**
 * POST /api/auth/change-password
 * Accepts { currentPassword, newPassword }, verifies current password, updates to new.
 * Requires active session (logged in).
 */
import {
  json, optionsResponse, hashPassword, verifyPassword,
  getSessionIdFromCookie, validateSession, isValidPassword,
  invalidateAllUserSessions, createSession, sessionCookie,
} from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    // Require auth
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not logged in.' }, 401);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const currentPassword = body.currentPassword || '';
    const newPassword = body.newPassword || '';

    if (!currentPassword) return json({ ok: false, error: 'Current password is required.' }, 400);
    if (!isValidPassword(newPassword)) return json({ ok: false, error: 'New password must be at least 8 characters.' }, 400);

    // Get user's current hashed password
    const user = await db.prepare('SELECT id, hashed_password FROM user WHERE id = ?')
      .bind(session.userId).first();
    if (!user) return json({ ok: false, error: 'User not found.' }, 404);

    // Verify current password
    const valid = await verifyPassword(currentPassword, user.hashed_password);
    if (!valid) return json({ ok: false, error: 'Current password is incorrect.' }, 403);

    // Hash and save new password
    const hashedPassword = await hashPassword(newPassword);
    await db.prepare(
      'UPDATE user SET hashed_password = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(hashedPassword, user.id).run();

    // Invalidate all sessions and create a fresh one
    await invalidateAllUserSessions(db, user.id);
    const newSession = await createSession(db, user.id);

    return json(
      { ok: true },
      200,
      { 'Set-Cookie': sessionCookie(newSession.id, newSession.expiresAt) }
    );
  } catch (err) {
    return json({ ok: false, error: 'Server error: ' + (err.message || 'Unknown') }, 500);
  }
}
