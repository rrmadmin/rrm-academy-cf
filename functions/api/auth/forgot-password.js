/**
 * POST /api/auth/forgot-password
 * Accepts { email }, generates a password reset token, sends email.
 * Always returns success (don't reveal whether email exists).
 *
 * Timing strategy: SES send is deferred via waitUntil so both existing-user
 * and non-existing-user paths return in ~same time (D1 lookup only).
 * Anti-enumeration trumps UX clarity here — users can retry if email is delayed.
 *
 * SES failure design: unlike resend-verification.js (which returns 502, because
 * the authenticated user already knows we have their email), this endpoint must
 * not confirm address existence. ok:true even on SES failure is intentional.
 */
import {
  json, optionsResponse, generateId, generateToken, hashToken,
  verifyTurnstile, checkRateLimit, isValidEmail, RESET_TOKEN_TTL_S,
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

    const email = (body.email || '').normalize('NFC').trim().toLowerCase();
    if (!isValidEmail(email)) return json({ ok: false, error: 'Valid email is required.' }, 400);

    // Rate limit by IP (before expensive DNS lookups): 5 attempts per 15 minutes
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) return json({ ok: false, error: 'Service temporarily unavailable.' }, 503);
    if (!await checkRateLimit(env, `forgot:${ip}`, 5, 900)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    if (!env.AWS_ACCESS_KEY_ID) {
      return json({ ok: false, error: 'Reset link service is temporarily unavailable. Please try again in a few minutes or email administrator@rrmacademy.org for help.' }, 503);
    }

    // Turnstile
    const turnstileResult = await verifyTurnstile(
      env.CF_TURNSTILE_SECRET, body.turnstileToken, ip, env
    );
    if (!turnstileResult.ok) {
      const turnstileMsg = turnstileResult.reason === 'network'
        ? 'Verification service unavailable. Please try again in a moment.'
        : 'Spam check failed. Please refresh and try again.';
      return json({ ok: false, error: turnstileMsg }, 403);
    }

    // Look up user (but always return success to prevent enumeration)
    // Include blocked so we can silently skip token issuance for blocked users
    // without revealing account status to the caller.
    const user = await db.prepare('SELECT id, name, blocked FROM user WHERE email = ? COLLATE NOCASE').bind(email).first();

    if (user && !user.blocked) {
      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = Math.floor(Date.now() / 1000) + RESET_TOKEN_TTL_S;
      const resetUrl = `https://rrmacademy.org/reset-password/?token=${token}`;

      // Atomically replace any prior reset token before firing the email.
      // ON CONFLICT relies on idx_password_reset_user_purpose UNIQUE(user_id, purpose)
      // (migration 020). Two concurrent requests race to upsert the same row rather
      // than leaving two valid tokens. Token is valid for 1 hour.
      await db.prepare(
        "INSERT INTO password_reset (id, user_id, token_hash, expires_at, purpose) VALUES (?, ?, ?, ?, 'reset') ON CONFLICT(user_id, purpose) DO UPDATE SET id = excluded.id, token_hash = excluded.token_hash, expires_at = excluded.expires_at"
      ).bind(generateId(), user.id, tokenHash, expiresAt).run();

      // Deferred SES send — response returns before email completes.
      // SES failure: logged server-side; ok:true still returned (anti-enumeration).
      waitUntil(
        sendEmail(env, {
          from: 'RRM Academy <accounts@mail.rrmacademy.org>',
          to: email,
          subject: 'Reset your password — RRM Academy',
          text: [
            `Hi ${user.name || 'there'},`,
            '',
            'We received a request to reset your RRM Academy password. Click the link below to set a new password:',
            '',
            resetUrl,
            '',
            'This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.',
            '',
            'Best regards,',
            'RRM Academy',
            'https://rrmacademy.org',
          ].join('\n'),
          log: { db: env.DB, source: 'auth/forgot-password', category: 'transactional' },
        }).catch(emailErr => {
          log(env, waitUntil, 'auth', 'forgot_password_error', 'error', emailErr.message);
          return logEmailFailure(env.DB, { email, category: 'transactional', source: 'auth/forgot-password', subject: 'Reset your password — RRM Academy', detail: emailErr.message });
        })
      );
    }

    // Always return success (no email enumeration)
    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'auth', 'forgot_password_error', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
