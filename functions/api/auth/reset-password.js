/**
 * POST /api/auth/reset-password
 * Accepts { token, password }, validates token, resets password.
 */
import {
  json, optionsResponse, hashPassword, hashToken,
  generateSessionId, sessionCookie,
  isValidPassword,
} from './_shared.js';
import { log } from '../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
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

    // Update password, clean up tokens/sessions, create fresh session — atomically
    const hashedPassword = await hashPassword(password);
    const newSessionId = generateSessionId();
    const newExpiresAt = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);

    await db.batch([
      db.prepare('UPDATE user SET hashed_password = ?, email_verified = 1, updated_at = datetime(\'now\') WHERE id = ?')
        .bind(hashedPassword, record.user_id),
      db.prepare('DELETE FROM password_reset WHERE user_id = ?')
        .bind(record.user_id),
      db.prepare('DELETE FROM session WHERE user_id = ?')
        .bind(record.user_id),
      db.prepare('INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(newSessionId, record.user_id, newExpiresAt),
    ]);

    return json(
      { ok: true },
      200,
      { 'Set-Cookie': sessionCookie(newSessionId, newExpiresAt) }
    );
  } catch (err) {
    console.error(err);
    log(env, waitUntil, 'auth', 'reset_password_error', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
