/**
 * POST /api/auth/resend-verification
 * Sends a new email verification code to the logged-in user.
 *
 * SES failure design: returns 502 (unlike forgot-password.js which returns ok:true on SES failure).
 * The divergence is intentional — this endpoint requires an active session, so the user already
 * knows we have their email address. Anti-enumeration is moot; honest failure improves UX.
 * forgot-password.js: anti-enumeration trumps UX. resend-verification.js: UX wins.
 */
import {
  json, optionsResponse, generateId, generateToken, getSessionIdFromCookie,
  validateSession, checkRateLimit, EMAIL_VERIFY_TTL_S, sessionCookie, authHintCookie,
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

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated.' }, 401);

    // Rate limit: 5 attempts per 15 minutes
    if (!await checkRateLimit(env, `resend-verify:${session.userId}`, 5, 900)) {
      return json({ ok: false, error: 'Please wait before requesting another code.' }, 429);
    }

    if (!env.AWS_ACCESS_KEY_ID) {
      return json({ ok: false, error: 'Verification email service is temporarily unavailable. Please try again later or contact administrator@rrmacademy.org for help.' }, 503);
    }

    // Get user
    const user = await db.prepare('SELECT email, name, email_verified FROM user WHERE id = ?')
      .bind(session.userId).first();
    if (!user) return json({ ok: false, error: 'User not found.' }, 404);
    if (user.email_verified) {
      const headers = {};
      if (session.renewed) headers['Set-Cookie'] = [sessionCookie(session.id, session.expiresAt), authHintCookie(session.expiresAt)];
      return json({ ok: true }, 200, headers);
    }

    // Generate new code and expiry.
    const code = generateToken().slice(0, 8);
    const expiresAt = Math.floor(Date.now() / 1000) + EMAIL_VERIFY_TTL_S;

    // Write D1 first — if SES fails, the new code is already in D1 and the user
    // can request another resend. The old code is invalidated regardless.
    await db.batch([
      db.prepare('DELETE FROM email_verification WHERE user_id = ?')
        .bind(session.userId),
      db.prepare('INSERT INTO email_verification (id, user_id, code, expires_at) VALUES (?, ?, ?, ?)')
        .bind(generateId(), session.userId, code, expiresAt),
    ]);

    // Now send email; on failure the code is already in D1 so the user can retry.
    try {
      await sendEmail(env, {
        from: 'RRM Academy <accounts@mail.rrmacademy.org>',
        to: user.email,
        subject: 'Your verification code — RRM Academy',
        text: [
          `Hi ${user.name || 'there'},`,
          '',
          'Here is your new verification code:',
          '',
          `    ${code}`,
          '',
          'This code expires in 1 hour.',
          '',
          'Best regards,',
          'RRM Academy',
          'https://rrmacademy.org',
        ].join('\n'),
        log: { db: env.DB, source: 'auth/resend-verification', category: 'transactional' },
      });
    } catch (emailErr) {
      log(env, waitUntil, 'auth', 'resend_verification_send_error', 'error', emailErr.message, 0, 502);
      await logEmailFailure(env.DB, { email: user.email, category: 'transactional', source: 'auth/resend-verification', subject: 'Your verification code — RRM Academy', detail: emailErr.message });
      return json({ ok: false, error: 'Failed to send verification email. Please try again.' }, 502);
    }

    const responseHeaders = {};
    if (session.renewed) {
      responseHeaders['Set-Cookie'] = [
        sessionCookie(session.id, session.expiresAt),
        authHintCookie(session.expiresAt),
      ];
    }

    return json({ ok: true }, 200, responseHeaders);
  } catch (err) {
    log(env, waitUntil, 'auth', 'resend_verification_error', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
