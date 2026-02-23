/**
 * POST /api/auth/signup
 * Creates a new user account and sends email verification.
 */
import {
  json, optionsResponse, generateId, generateToken, hashPassword, hashToken,
  createSession, sessionCookie, verifyTurnstile, checkRateLimit,
  isValidEmail, isValidPassword, CORS_HEADERS,
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

    const name = (body.name || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    // Validate
    if (!name || name.length > 200) return json({ ok: false, error: 'Name is required.' }, 400);
    if (!isValidEmail(email)) return json({ ok: false, error: 'Valid email is required.' }, 400);
    if (!isValidPassword(password)) return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);

    // Rate limit by IP
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(`signup:${ip}`)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    // Turnstile
    const turnstileOk = await verifyTurnstile(
      env.CF_TURNSTILE_SECRET, body.turnstileToken, ip
    );
    if (!turnstileOk) return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);

    // Check if email already exists
    const existing = await db.prepare('SELECT id FROM user WHERE email = ?').bind(email).first();
    if (existing) {
      return json({ ok: false, error: 'An account with this email already exists.' }, 409);
    }

    // Create user
    const userId = generateId();
    const hashedPassword = await hashPassword(password);
    await db.prepare(
      'INSERT INTO user (id, email, name, hashed_password) VALUES (?, ?, ?, ?)'
    ).bind(userId, email, name, hashedPassword).run();

    // Create email verification token
    const code = generateToken().slice(0, 8); // 8-char verification code
    const verifyExpiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    await db.prepare(
      'INSERT INTO email_verification (id, user_id, code, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(generateId(), userId, code, verifyExpiresAt).run();

    // Send verification email (fire-and-forget — don't block on Resend response)
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
            to: [email],
            subject: 'Verify your email — RRM Academy',
            text: [
              `Hi ${name},`,
              '',
              'Welcome to RRM Academy! Please verify your email by entering this code:',
              '',
              `    ${code}`,
              '',
              'This code expires in 1 hour.',
              '',
              'If you did not create an account, you can safely ignore this email.',
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

    // Create session (user can use the site, but with email_verified=0)
    const session = await createSession(db, userId);

    return json(
      { ok: true, emailVerificationRequired: true },
      200,
      { 'Set-Cookie': sessionCookie(session.id, session.expiresAt) }
    );
  } catch (err) {
    return json({ ok: false, error: 'Server error: ' + (err.message || 'Unknown') }, 500);
  }
}
