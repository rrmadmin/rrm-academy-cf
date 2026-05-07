/**
 * POST /api/auth/signup
 * Creates a new user account and sends email verification.
 */
import {
  json, optionsResponse, generateId, generateSessionId, generateToken,
  hashPassword, sessionCookie, verifyTurnstile, checkRateLimit,
  isValidPassword, waitlistBackfillStatement,
} from './_shared.js';
import { validateEmail } from './_email-validate.js';
import { verifyAndTagEmail } from '../_elv.js';
import { sendEmail, logEmailFailure } from '../_ses.js';
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';
import { validateBody } from '../_validate.js';

const SOURCE_MAP = [
  { prefix: '/ask', source: 'ask' },
  { prefix: '/courses', source: 'course' },
  { prefix: '/community', source: 'community' },
  { prefix: '/donate', source: 'donation' },
];

function deriveSignupSource(body, request) {
  const candidates = [];

  const bodyNext = typeof body.next === 'string' ? body.next.trim() : null;
  if (bodyNext) candidates.push(bodyNext);

  try {
    const urlNext = new URL(request.url).searchParams.get('next');
    if (urlNext) candidates.push(urlNext.trim());
  } catch { /* ignore */ }

  const referer = request.headers.get('Referer') || '';
  if (referer) {
    try {
      const ref = new URL(referer);
      if (ref.hostname === 'rrmacademy.org' || ref.hostname === 'www.rrmacademy.org') {
        candidates.push(ref.pathname);
      }
    } catch { /* ignore */ }
  }

  for (const candidate of candidates) {
    for (const { prefix, source } of SOURCE_MAP) {
      if (candidate === prefix || candidate.startsWith(prefix + '/') || candidate.startsWith(prefix + '?')) {
        return source;
      }
    }
  }

  return 'direct';
}

async function sendWelcomeAskEmail(env, email, firstName) {
  const greeting = firstName || 'there';
  const subject = "You're in. Ask RRM Academy anything.";
  const text = [
    `Hi ${greeting},`,
    '',
    'Welcome to RRM Academy. Your free account is active.',
    '',
    'You can now use /ask -- our conversational research layer that answers questions from our entire library.',
    'Head to https://rrmacademy.org/ask/ to get started.',
    '',
    'This is AI-generated and still learning; always verify against the cited library sources.',
    '',
    'If you hit anything unclear, reply to this email -- we read every one.',
    '',
    '-- The RRM Academy team',
  ].join('\n');
  const html = [
    '<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">',
    `<p>Hi ${greeting},</p>`,
    '<p>Welcome to RRM Academy. Your free account is active.</p>',
    '<p>You can now use <strong>/ask</strong> &mdash; our conversational research layer that answers questions from our entire library.<br>',
    '<a href="https://rrmacademy.org/ask/">Head to rrmacademy.org/ask/ to get started.</a></p>',
    '<p style="color:#666;font-size:0.9em">This is AI-generated and still learning; always verify against the cited library sources.</p>',
    '<p>If you hit anything unclear, reply to this email &mdash; we read every one.</p>',
    '<p>-- The RRM Academy team</p>',
    '</body></html>',
  ].join('\n');
  await sendEmail(env, {
    from: 'RRM Academy <hello@mail.rrmacademy.org>',
    to: email,
    subject,
    text,
    html,
    log: { db: env.DB, source: 'auth/signup', category: 'transactional' },
  });
}

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

    const validated = validateBody(body, {
      firstName: { type: 'string', required: true, maxLength: 100 },
      lastName:  { type: 'string', required: true, maxLength: 100 },
      email:     { type: 'email',  required: true },
    });
    if (!validated.valid) return json({ ok: false, error: validated.error }, validated.status);

    const firstName = validated.data.firstName;
    const lastName  = validated.data.lastName;
    const email     = validated.data.email;
    const password  = body.password || '';
    const signupSource = deriveSignupSource(body, request);

    if (!isValidPassword(password)) return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);

    // Rate limit by IP (before expensive DNS lookups): 5 attempts per 15 minutes
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!await checkRateLimit(env, `signup:${ip}`, 5, 900)) {
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
      return json({ ok: false, error: 'Email service is temporarily unavailable. Please try again in a few minutes or contact administrator@rrmacademy.org for help.' }, 503);
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
      // Anti-enumeration: silent 201, but fire-and-forget informational email with cooldown
      if (env.COMMUNITY_KV) {
        const cooldownKey = `signup-collision:${email.toLowerCase()}`;
        const alreadySent = await env.COMMUNITY_KV.get(cooldownKey);
        if (!alreadySent && env.AWS_ACCESS_KEY_ID) {
          await env.COMMUNITY_KV.put(cooldownKey, '1', { expirationTtl: 3600 });
          waitUntil(
            sendEmail(env, {
              from: 'RRM Academy <accounts@mail.rrmacademy.org>',
              to: email,
              subject: 'Did you try to sign up at RRM Academy?',
              text: [
                'Someone (maybe you) tried to create an RRM Academy account with this email address.',
                '',
                'If it was you, log in: https://rrmacademy.org/login/',
                '',
                "If you forgot your password, reset it: https://rrmacademy.org/forgot-password/",
                '',
                "If it wasn't you, you can safely ignore this email — no account was created or modified.",
              ].join('\n'),
              log: { db: env.DB, source: 'auth/signup', category: 'transactional' },
            }).catch(err => logEmailFailure(env.DB, { email, category: 'transactional', source: 'auth/signup', subject: 'Did you try to sign up at RRM Academy?', detail: err.message }))
          );
        }
      }
      const fakeSessionId = generateSessionId();
      const fakeExpires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      return json(
        { ok: true, emailVerificationRequired: true },
        201,
        { 'Set-Cookie': sessionCookie(fakeSessionId, fakeExpires) }
      );
    }

    // Prepare all three INSERTs
    const userId = generateId();
    const name = firstName + ' ' + lastName;

    const code = generateToken().slice(0, 8); // 8-char verification code
    const verifyExpiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    const sessionId = generateSessionId();
    const sessionExpiresAt = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);

    // Atomic batch: user + email_verification + session + waitlist backfill
    try {
      await db.batch([
        db.prepare(
          'INSERT INTO user (id, email, name, first_name, last_name, hashed_password, signup_source) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(userId, email, name, firstName, lastName, hashedPassword, signupSource),
        db.prepare(
          'INSERT INTO email_verification (id, user_id, code, expires_at) VALUES (?, ?, ?, ?)'
        ).bind(generateId(), userId, code, verifyExpiresAt),
        db.prepare(
          'INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)'
        ).bind(sessionId, userId, sessionExpiresAt),
        waitlistBackfillStatement(db, userId, email),
      ]);
    } catch (batchErr) {
      if (batchErr.message && batchErr.message.includes('UNIQUE constraint failed')) {
        // Anti-enumeration: same cookie shape as a real signup (fake session ID won't validate).
        const fakeSessionId = generateSessionId();
        const fakeExpires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
        return json(
          { ok: true, emailVerificationRequired: true },
          201,
          { 'Set-Cookie': sessionCookie(fakeSessionId, fakeExpires) }
        );
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
          log: { db: env.DB, source: 'auth/signup', category: 'transactional' },
        }).catch(err => logEmailFailure(env.DB, { email, category: 'transactional', source: 'auth/signup', subject: 'Verify your email — RRM Academy', detail: err.message }))
      );
    }

    waitUntil(sendGA4Event(env, request, 'sign_up', { method: 'email', source: signupSource }).catch(() => {}));

    if (signupSource === 'ask') {
      waitUntil(sendGA4Event(env, request, 'signup_from_ask', { source: 'ask' }).catch(() => {}));
      if (env.AWS_ACCESS_KEY_ID) {
        waitUntil(
          sendWelcomeAskEmail(env, email, firstName).catch(err => {
            log(env, waitUntil, 'auth', 'welcome_ask_email_fail', 'error', err.message);
          })
        );
      }
    }

    return json(
      { ok: true, emailVerificationRequired: true },
      201,
      { 'Set-Cookie': sessionCookie(sessionId, sessionExpiresAt) }
    );
  } catch (err) {
    log(env, waitUntil, 'auth', 'signup_fail', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
