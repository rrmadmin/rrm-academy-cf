/**
 * POST /api/auth/resend-verification
 * Sends a new email verification code to the logged-in user.
 */
import {
  json, optionsResponse, generateId, generateToken, getSessionIdFromCookie,
  validateSession, checkRateLimit,
} from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated.' }, 401);

    // Rate limit
    if (!checkRateLimit(`resend-verify:${session.userId}`)) {
      return json({ ok: false, error: 'Please wait before requesting another code.' }, 429);
    }

    // Get user
    const user = await db.prepare('SELECT email, name, email_verified FROM user WHERE id = ?')
      .bind(session.userId).first();
    if (!user) return json({ ok: false, error: 'User not found.' }, 404);
    if (user.email_verified) return json({ ok: true, message: 'Email already verified.' });

    // Delete old verification records
    await db.prepare('DELETE FROM email_verification WHERE user_id = ?')
      .bind(session.userId).run();

    // Create new code
    const code = generateToken().slice(0, 8);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    await db.prepare(
      'INSERT INTO email_verification (id, user_id, code, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(generateId(), session.userId, code, expiresAt).run();

    // Send email
    if (env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'RRM Academy <accounts@rrmacademy.org>',
            to: [user.email],
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
          }),
        });
      } catch {
        // Email send failed — user can request resend later
      }
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'Server error: ' + (err.message || 'Unknown') }, 500);
  }
}
