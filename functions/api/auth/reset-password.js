/**
 * POST /api/auth/reset-password
 * Accepts { token, password }, validates token, resets password.
 */
import {
  json, optionsResponse, hashPassword, hashToken,
  generateSessionId, sessionCookie,
  isValidPassword, checkRateLimit, sessionInsertStatement,
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

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const token = (body.token || '').trim();
    const password = body.password || '';

    if (!token) return json({ ok: false, error: 'Reset token is required.' }, 400);
    if (!isValidPassword(password)) return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!await checkRateLimit(env, `reset-pw:${ip}`, 5, 900)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    // Hash password FIRST (pure compute) so a crypto failure never consumes the token.
    const hashedPassword = await hashPassword(password);

    const tokenHash = await hashToken(token);
    const now = Math.floor(Date.now() / 1000);

    // Consume the token atomically.
    const record = await db.prepare(
      "DELETE FROM password_reset WHERE token_hash = ? AND expires_at > ? AND purpose = 'reset' RETURNING user_id"
    ).bind(tokenHash, now).first();

    if (!record) {
      return json({ ok: false, error: 'This reset link is invalid, expired, or has already been used. Please request a new one.' }, 400);
    }

    // Update password and rotate session — atomically.
    const newSessionId = generateSessionId();
    const newExpiresAt = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);

    await db.batch([
      db.prepare('UPDATE user SET hashed_password = ?, email_verified = 1, updated_at = datetime(\'now\') WHERE id = ?')
        .bind(hashedPassword, record.user_id),
      db.prepare('DELETE FROM session WHERE user_id = ?')
        .bind(record.user_id),
      sessionInsertStatement(db, newSessionId, record.user_id, newExpiresAt),
    ]);

    // Notify the account owner that their password was reset.
    // Non-blocking: a notification failure never fails the reset itself.
    if (env.AWS_ACCESS_KEY_ID) {
      const notifyUser = await db.prepare('SELECT email, name FROM user WHERE id = ?')
        .bind(record.user_id).first();
      if (notifyUser) {
        const changeDate = new Date().toUTCString();
        waitUntil(
          sendEmail(env, {
            from: 'RRM Academy <accounts@mail.rrmacademy.org>',
            to: notifyUser.email,
            subject: 'Your RRM Academy password was changed',
            text: [
              `Hi ${notifyUser.name || 'there'},`,
              '',
              `Your RRM Academy password was reset on ${changeDate}.`,
              '',
              'If this was you, no action is needed.',
              '',
              'If you did not make this change, please contact us immediately at administrator@rrmacademy.org',
              '',
              '-- RRM Academy',
            ].join('\n'),
            log: { db: env.DB, source: 'auth/reset-password', category: 'transactional' },
          }).catch(err => logEmailFailure(env.DB, {
            email: notifyUser.email, category: 'transactional',
            source: 'auth/reset-password', subject: 'Your RRM Academy password was changed', detail: err.message,
          }))
        );
      }
    }

    // Design: auto-login after password reset (matches Auth0/Clerk UX).
    // Token possession is treated as proof of email control. If the threat
    // model changes (e.g., requiring re-auth after reset), drop the
    // session INSERT and Set-Cookie below.
    return json(
      { ok: true },
      200,
      { 'Set-Cookie': sessionCookie(newSessionId, newExpiresAt) }
    );
  } catch (err) {
    log(env, waitUntil, 'auth', 'reset_password_error', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
