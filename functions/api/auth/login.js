/**
 * POST /api/auth/login
 * Authenticates user with email/password, creates session.
 */
import {
  json, optionsResponse, verifyPassword, sessionCookie,
  verifyTurnstile, checkRateLimit, isValidEmail,
  generateSessionId, waitlistBackfillStatement, sessionInsertStatement,
  DUMMY_PASSWORD_HASH,
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
    const password = body.password || '';

    if (!isValidEmail(email) || !password || password.length > 128) {
      return json({ ok: false, error: 'Invalid email or password.' }, 400);
    }

    // Rate limit by IP (prevent brute force): 5 attempts per 15 minutes
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) return json({ ok: false, error: 'Service temporarily unavailable.' }, 503);
    if (!await checkRateLimit(env, `login:${ip}`, 5, 900)) {
      return json({ ok: false, error: 'Too many login attempts. Please try again in 15 minutes.' }, 429);
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

    // Look up user
    const user = await db.prepare('SELECT id, email, hashed_password, google_id, name, first_name, last_name, email_verified, role, blocked FROM user WHERE email = ? COLLATE NOCASE')
      .bind(email).first();

    // Constant-time-ish: always verify even if user doesn't exist (prevent timing attacks)
    if (!user) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      return json({ ok: false, error: 'Invalid email or password.' }, 401);
    }

    // Passwordless accounts (Google-only or auto-created without password).
    // Anti-enumeration: return the same generic error regardless of the reason.
    // Fire a non-blocking guidance email out-of-band so the legitimate user
    // knows how to proceed without us revealing account details in the response.
    if (!user.hashed_password) {
      // Equalize timing with the verifyPassword path so this branch doesn't
      // reveal account type via response latency. Result is discarded.
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      const guidanceType = user.google_id ? 'google' : 'unprovisioned';
      waitUntil(
        (async () => {
          if (!env.AWS_ACCESS_KEY_ID) return;
          const text = guidanceType === 'google'
            ? [
                'Hi there,',
                '',
                'Someone tried to sign in to your RRM Academy account with a password, but your account uses Google sign-in.',
                '',
                'To access your account, use the "Sign in with Google" button at https://rrmacademy.org/login/',
                '',
                'If this wasn\'t you, no action is needed — your account is secure.',
                '',
                '-- RRM Academy',
              ].join('\n')
            : [
                'Hi there,',
                '',
                'Someone tried to sign in to your RRM Academy account, but no password has been set.',
                '',
                'Use "Forgot password" to set one: https://rrmacademy.org/forgot-password/',
                '',
                'If this wasn\'t you, no action is needed.',
                '',
                '-- RRM Academy',
              ].join('\n');
          await sendEmail(env, {
            from: 'RRM Academy <accounts@mail.rrmacademy.org>',
            to: user.email,
            subject: 'Sign-in attempt on your RRM Academy account',
            text,
            log: { db: env.DB, source: 'auth/login', category: 'transactional' },
          });
        })().catch(err => {
          logEmailFailure(env.DB, { email: user.email, category: 'transactional', source: 'auth/login', subject: 'Sign-in attempt on your RRM Academy account', detail: err.message });
        })
      );
      return json({ ok: false, error: 'Invalid email or password.' }, 401);
    }

    if (user.blocked) {
      await verifyPassword(password, user.hashed_password);
      return json({ ok: false, error: 'Invalid email or password.' }, 401);
    }

    const valid = await verifyPassword(password, user.hashed_password);
    if (!valid) {
      return json({ ok: false, error: 'Invalid email or password.' }, 401);
    }

    // Clean up expired sessions before creating new one.
    // Keeps multi-device working (only expired sessions removed, not active ones).
    const nowTs = Math.floor(Date.now() / 1000);
    await db.prepare('DELETE FROM session WHERE user_id = ? AND expires_at < ?').bind(user.id, nowTs).run();

    // Create session + backfill waitlist rows orphaned before this email logged in.
    // Idempotent: only touches course_waitlist rows where user_id IS NULL.
    const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
    const sessionId = generateSessionId();
    const expiresAt = Math.floor((Date.now() + SESSION_DURATION_MS) / 1000);
    await db.batch([
      sessionInsertStatement(db, sessionId, user.id, expiresAt),
      waitlistBackfillStatement(db, user.id, user.email),
    ]);
    const session = { id: sessionId, expiresAt };

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
    log(env, waitUntil, 'auth', 'login_fail', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
