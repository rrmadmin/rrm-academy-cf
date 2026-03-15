/**
 * POST /api/auth/signup
 * Creates a new user account and sends email verification.
 */
import {
  json, optionsResponse, generateId, generateSessionId, generateToken,
  hashPassword, sessionCookie, verifyTurnstile, checkRateLimit,
  isValidEmail, isValidPassword,
} from './_shared.js';
import { validateEmail } from './_email-validate.js';
import { verifyAndTagEmail } from '../_elv.js';
import { sendEmail } from '../_ses.js';
import { sendGA4Event } from '../_ga4.js';
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

    const firstName = (body.firstName || '').trim();
    const lastName = (body.lastName || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    // Validate
    if (!firstName || firstName.length > 100) return json({ ok: false, error: 'First name is required.' }, 400);
    if (!lastName || lastName.length > 100) return json({ ok: false, error: 'Last name is required.' }, 400);
    if (!isValidEmail(email)) return json({ ok: false, error: 'Valid email is required.' }, 400);
    if (!isValidPassword(password)) return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);

    // Rate limit by IP (before expensive DNS lookups)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(`signup:${ip}`)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    // Deep email validation (disposable domain, MX check, typo detection)
    const emailCheck = await validateEmail(email);
    if (!emailCheck.valid) {
      return json({
        ok: false,
        error: emailCheck.error,
        ...(emailCheck.suggestion ? { suggestion: emailCheck.suggestion } : {}),
      }, 400);
    }

    // ELV mailbox verification (after local checks pass, before account creation)
    const elv = await verifyAndTagEmail(email, env, { firstName, lastName, source: 'signup' });
    if (elv.blocked) {
      return json({ ok: false, error: elv.reason }, 400);
    }

    if (!env.AWS_ACCESS_KEY_ID) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    // Turnstile
    const turnstileOk = await verifyTurnstile(
      env.CF_TURNSTILE_SECRET, body.turnstileToken, ip
    );
    if (!turnstileOk) return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);

    // Hash password before existence check to prevent timing side-channel
    const hashedPassword = await hashPassword(password);

    // Check if email already exists
    const existing = await db.prepare('SELECT id FROM user WHERE email = ? COLLATE NOCASE').bind(email).first();
    if (existing) {
      return json({ ok: true, emailVerificationRequired: true }, 201);
    }

    // Prepare all three INSERTs
    const userId = generateId();
    const name = firstName + ' ' + lastName;

    const code = generateToken().slice(0, 8); // 8-char verification code
    const verifyExpiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    const sessionId = generateSessionId();
    const sessionExpiresAt = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);

    // Atomic batch: user + email_verification + session
    try {
      await db.batch([
        db.prepare(
          'INSERT INTO user (id, email, name, first_name, last_name, hashed_password) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(userId, email, name, firstName, lastName, hashedPassword),
        db.prepare(
          'INSERT INTO email_verification (id, user_id, code, expires_at) VALUES (?, ?, ?, ?)'
        ).bind(generateId(), userId, code, verifyExpiresAt),
        db.prepare(
          'INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)'
        ).bind(sessionId, userId, sessionExpiresAt),
      ]);
    } catch (batchErr) {
      if (batchErr.message && batchErr.message.includes('UNIQUE constraint failed')) {
        return json({ ok: true, emailVerificationRequired: true }, 201);
      }
      throw batchErr;
    }

    // Send verification email via waitUntil (decouple SES latency from response timing)
    if (env.AWS_ACCESS_KEY_ID) {
      waitUntil(
        sendEmail(env, {
          from: 'RRM Academy <accounts@mail.rrmacademy.org>',
          to: email,
          subject: 'Verify your email — RRM Academy',
          text: [
            `Hi ${firstName},`,
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
        }).catch(() => {})
      );
    }

    waitUntil(sendGA4Event(env, request, 'sign_up', { method: 'email' }).catch(() => {}));

    return json(
      { ok: true, emailVerificationRequired: true },
      201,
      { 'Set-Cookie': sessionCookie(sessionId, sessionExpiresAt) }
    );
  } catch (err) {
    console.error(err);
    log(env, waitUntil, 'auth', 'signup_fail', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
