/**
 * POST /api/auth/forgot-password
 * Accepts { email }, generates a password reset token, sends email.
 * Always returns success (don't reveal whether email exists).
 */
import {
  json, optionsResponse, generateId, generateToken, hashToken,
  verifyTurnstile, checkRateLimit, isValidEmail,
} from './_shared.js';
import { sendEmail } from '../_ses.js';
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

    const email = (body.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return json({ ok: false, error: 'Valid email is required.' }, 400);

    // Rate limit by IP (before expensive DNS lookups)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(`forgot:${ip}`)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    if (!env.AWS_ACCESS_KEY_ID) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    // Turnstile
    const turnstileOk = await verifyTurnstile(
      env.CF_TURNSTILE_SECRET, body.turnstileToken, ip
    );
    if (!turnstileOk) return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);

    // Look up user (but always return success to prevent enumeration)
    const user = await db.prepare('SELECT id, name FROM user WHERE email = ? COLLATE NOCASE').bind(email).first();

    if (user) {
      // Delete any existing reset tokens for this user
      await db.prepare('DELETE FROM password_reset WHERE user_id = ?').bind(user.id).run();

      // Generate token
      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour

      await db.prepare(
        'INSERT INTO password_reset (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
      ).bind(generateId(), user.id, tokenHash, expiresAt).run();

      // Build reset link
      const resetUrl = `https://rrmacademy.org/reset-password?token=${token}`;

      try {
        await sendEmail(env, {
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
        });
      } catch (emailErr) {
        log(env, waitUntil, 'auth', 'forgot_password_error', 'error', emailErr.message);
      }
    }

    // Always return success (no email enumeration)
    return json({ ok: true, message: 'If an account exists with that email, a reset link has been sent.' });
  } catch (err) {
    console.error(err);
    log(env, waitUntil, 'auth', 'forgot_password_error', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
