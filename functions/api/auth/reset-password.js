/**
 * POST /api/auth/reset-password
 * Accepts { token, password }, validates token, resets password.
 */
import {
  json, optionsResponse, hashPassword, hashToken,
  invalidateAllUserSessions, createSession, sessionCookie,
  isValidPassword,
} from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const token = (body.token || '').trim();
    const password = body.password || '';

    if (!token) return json({ ok: false, error: 'Reset token is required.' }, 400);
    if (!isValidPassword(password)) return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);

    // Hash the token and look it up
    const tokenHash = await hashToken(token);
    const now = Math.floor(Date.now() / 1000);

    const record = await db.prepare(
      'SELECT id, user_id FROM password_reset WHERE token_hash = ? AND expires_at > ?'
    ).bind(tokenHash, now).first();

    if (!record) {
      return json({ ok: false, error: 'Invalid or expired reset link. Please request a new one.' }, 400);
    }

    // Update password
    const hashedPassword = await hashPassword(password);
    await db.prepare(
      'UPDATE user SET hashed_password = ?, email_verified = 1, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(hashedPassword, record.user_id).run();

    // Clean up all reset tokens and sessions for this user
    await db.prepare('DELETE FROM password_reset WHERE user_id = ?').bind(record.user_id).run();
    await invalidateAllUserSessions(db, record.user_id);

    // Create fresh session
    const session = await createSession(db, record.user_id);

    return json(
      { ok: true },
      200,
      { 'Set-Cookie': sessionCookie(session.id, session.expiresAt) }
    );
  } catch (err) {
    return json({ ok: false, error: 'Server error: ' + (err.message || 'Unknown') }, 500);
  }
}
