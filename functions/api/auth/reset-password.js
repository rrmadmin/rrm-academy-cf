/**
 * POST /api/auth/reset-password
 * Accepts { token, password }, validates token, resets password.
 */
import {
  json, optionsResponse, hashPassword, hashToken,
  generateSessionId, sessionCookie,
  isValidPassword, checkRateLimit, sessionInsertStatement, SESSION_DURATION_MS,
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
    if (!isValidPassword(password)) return json({ ok: false, error: 'Password must be between 8 and 128 characters.' }, 400);

    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) return json({ ok: false, error: 'Service temporarily unavailable.' }, 503);
    if (!await checkRateLimit(env, `reset-pw:${ip}`, 5, 900)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    // Hash password FIRST (pure compute) so a crypto failure never consumes the token.
    const hashedPassword = await hashPassword(password);

    const tokenHash = await hashToken(token);
    const now = Math.floor(Date.now() / 1000);

    // Pre-SELECT to get user_id without consuming the token yet.
    // Allows the entire mutation to run as one atomic batch, preventing the
    // rugpull where the token is consumed but the password UPDATE fails.
    // purpose IN ('reset','welcome'): welcome tokens written by Stripe-auto-account
    // onboarding share this same endpoint for redemption (see /arise #4).
    const tokenRow = await db.prepare(
      "SELECT user_id FROM password_reset WHERE token_hash = ? AND expires_at > ? AND purpose IN ('reset', 'welcome')"
    ).bind(tokenHash, now).first();

    if (!tokenRow) {
      return json({ ok: false, error: 'This reset link is invalid, expired, or has already been used. Please request a new one.' }, 400);
    }

    // Atomic batch: consume token + update password + rotate sessions together.
    const newSessionId = generateSessionId();
    const newExpiresAt = Math.floor((Date.now() + SESSION_DURATION_MS) / 1000);

    const results = await db.batch([
      // Consume token — 0 changes means concurrent use; checked below.
      // Filter mirrors the pre-SELECT above so both purpose values consume cleanly.
      db.prepare("DELETE FROM password_reset WHERE token_hash = ? AND expires_at > ? AND purpose IN ('reset', 'welcome')")
        .bind(tokenHash, now),
      db.prepare('UPDATE user SET hashed_password = ?, email_verified = 1, updated_at = datetime(\'now\') WHERE id = ?')
        .bind(hashedPassword, tokenRow.user_id),
      // Cleanup: drop ALL outstanding password_reset rows for this user, regardless of purpose.
      // After successful auth via any token type, every other dangling token should be invalidated.
      db.prepare("DELETE FROM password_reset WHERE user_id = ?")
        .bind(tokenRow.user_id),
      // Cleanup: revoke ALL sessions on password reset (forces re-auth across all devices for security).
      // Atomic batch — inline DELETE retained for batch atomicity (mirror of invalidateAllUserSessions)
      db.prepare('DELETE FROM session WHERE user_id = ?')
        .bind(tokenRow.user_id),
      sessionInsertStatement(db, newSessionId, tokenRow.user_id, newExpiresAt),
    ]);

    if (results[0].meta?.changes !== 1) {
      // Race: token consumed concurrently between pre-SELECT and batch DELETE.
      return json({ ok: false, error: 'This reset link is invalid, expired, or has already been used. Please request a new one.' }, 400);
    }

    // Notify the account owner that their password was reset.
    // Non-blocking: a notification failure never fails the reset itself.
    if (env.AWS_ACCESS_KEY_ID) {
      const notifyUser = await db.prepare('SELECT email, name FROM user WHERE id = ?')
        .bind(tokenRow.user_id).first();
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
