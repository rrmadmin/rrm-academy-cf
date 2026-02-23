/**
 * POST /api/auth/forgot-password
 * Accepts { email }, generates a password reset token, sends email.
 * Always returns success (don't reveal whether email exists).
 */
import {
  json, optionsResponse, generateId, generateToken, hashToken,
  verifyTurnstile, checkRateLimit, isValidEmail,
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

    const email = (body.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return json({ ok: false, error: 'Valid email is required.' }, 400);

    // Rate limit by IP
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(`forgot:${ip}`)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    // Turnstile
    const turnstileOk = await verifyTurnstile(
      env.CF_TURNSTILE_SECRET, body.turnstileToken, ip
    );
    if (!turnstileOk) return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);

    // Look up user (but always return success to prevent enumeration)
    const user = await db.prepare('SELECT id, name FROM user WHERE email = ?').bind(email).first();

    if (user && env.RESEND_API_KEY) {
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
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'RRM Academy <accounts@rrmacademy.org>',
            to: [email],
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
          }),
        });
      } catch {
        // Email send failed — user can request again
      }
    }

    // Always return success (no email enumeration)
    return json({ ok: true, message: 'If an account exists with that email, a reset link has been sent.' });
  } catch (err) {
    return json({ ok: false, error: 'Server error: ' + (err.message || 'Unknown') }, 500);
  }
}
