/**
 * POST /api/auth/login
 * Authenticates user with email/password, creates session.
 */
import {
  json, optionsResponse, verifyPassword, createSession, sessionCookie,
  verifyTurnstile, checkRateLimit, isValidEmail, CORS_HEADERS,
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
    const password = body.password || '';

    if (!isValidEmail(email) || !password) {
      return json({ ok: false, error: 'Email and password are required.' }, 400);
    }

    // Rate limit by IP (prevent brute force)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(`login:${ip}`)) {
      return json({ ok: false, error: 'Too many login attempts. Please try again in 15 minutes.' }, 429);
    }

    // Turnstile
    const turnstileOk = await verifyTurnstile(
      env.CF_TURNSTILE_SECRET, body.turnstileToken, ip
    );
    if (!turnstileOk) return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);

    // Look up user
    const user = await db.prepare('SELECT id, email, hashed_password, name, first_name, last_name, email_verified, role FROM user WHERE email = ?')
      .bind(email).first();

    // Constant-time-ish: always verify even if user doesn't exist (prevent timing attacks)
    if (!user) {
      // Hash a dummy password to spend similar time (iteration count must match PBKDF2_ITERATIONS)
      await verifyPassword(password, '100000$AAAAAAAAAAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
      return json({ ok: false, error: 'Invalid email or password.' }, 401);
    }

    const valid = await verifyPassword(password, user.hashed_password);
    if (!valid) {
      return json({ ok: false, error: 'Invalid email or password.' }, 401);
    }

    // Create session
    const session = await createSession(db, user.id);

    return json(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          firstName: user.first_name || '',
          lastName: user.last_name || '',
          emailVerified: !!user.email_verified,
          role: user.role,
        },
      },
      200,
      { 'Set-Cookie': sessionCookie(session.id, session.expiresAt) }
    );
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
