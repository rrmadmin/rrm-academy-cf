/**
 * POST /api/auth/change-password
 * Accepts { currentPassword, newPassword }, verifies current password, updates to new.
 * Requires active session (logged in).
 */
import {
  json, optionsResponse, hashPassword, verifyPassword,
  getSessionIdFromCookie, validateSession, isValidPassword,
  generateSessionId, sessionCookie, checkRateLimit, sessionInsertStatement,
} from './_shared.js';
import { sendEmail, logEmailFailure } from '../_ses.js';
import { log } from '../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    // Require auth
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not logged in.' }, 401);

    if (!await checkRateLimit(env, `change-pw:${session.userId}`, 5, 900)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const currentPassword = body.currentPassword || '';
    const newPassword = body.newPassword || '';

    if (!currentPassword || currentPassword.length > 128) return json({ ok: false, error: 'Current password is required.' }, 400);
    if (!isValidPassword(newPassword)) return json({ ok: false, error: 'New password must be at least 8 characters.' }, 400);

    // Get user's current hashed password (email + name included for notification)
    const user = await db.prepare('SELECT id, email, name, hashed_password, google_id FROM user WHERE id = ?')
      .bind(session.userId).first();
    if (!user) return json({ ok: false, error: 'User not found.' }, 404);

    if (!user.hashed_password) {
      if (user.google_id) {
        return json({ ok: false, error: 'This account uses Google sign-in. Use "Forgot password" to set a password first.' }, 400);
      }
      return json({ ok: false, error: 'Your account doesn\'t have a password yet. Use "Forgot password" to set one.' }, 400);
    }

    // Verify current password
    const valid = await verifyPassword(currentPassword, user.hashed_password);
    if (!valid) return json({ ok: false, error: 'Current password is incorrect.' }, 403);

    const sameAsCurrent = await verifyPassword(newPassword, user.hashed_password);
    if (sameAsCurrent) return json({ ok: false, error: 'New password must differ from your current password.' }, 400);

    // Hash and save new password, invalidate sessions, create fresh session — atomically
    const hashedPassword = await hashPassword(newPassword);
    const newSessionId = generateSessionId();
    const newExpiresAt = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);

    await db.batch([
      db.prepare('UPDATE user SET hashed_password = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .bind(hashedPassword, user.id),
      db.prepare('DELETE FROM session WHERE user_id = ?')
        .bind(user.id),
      db.prepare("DELETE FROM password_reset WHERE user_id = ? AND purpose = 'reset'")
        .bind(user.id),
      sessionInsertStatement(db, newSessionId, user.id, newExpiresAt),
    ]);

    // Notify the account owner that their password was changed.
    // Non-blocking: a notification failure never fails the change itself.
    if (env.AWS_ACCESS_KEY_ID && user.email) {
      const changeDate = new Date().toUTCString();
      waitUntil(
        sendEmail(env, {
          from: 'RRM Academy <accounts@mail.rrmacademy.org>',
          to: user.email,
          subject: 'Your RRM Academy password was changed',
          text: [
            `Hi ${user.name || 'there'},`,
            '',
            `Your RRM Academy password was changed on ${changeDate}.`,
            '',
            'If this was you, no action is needed.',
            '',
            'If you did not make this change, please contact us immediately at administrator@rrmacademy.org',
            '',
            '-- RRM Academy',
          ].join('\n'),
          log: { db: env.DB, source: 'auth/change-password', category: 'transactional' },
        }).catch(err => logEmailFailure(env.DB, {
          email: user.email, category: 'transactional',
          source: 'auth/change-password', subject: 'Your RRM Academy password was changed', detail: err.message,
        }))
      );
    }

    return json(
      { ok: true },
      200,
      { 'Set-Cookie': sessionCookie(newSessionId, newExpiresAt) }
    );
  } catch (err) {
    log(env, waitUntil, 'auth', 'change_password_error', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
