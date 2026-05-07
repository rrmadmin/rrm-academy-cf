/**
 * POST /api/contact/submit
 * Validates Turnstile token, rate-limits by IP, sends email via SES.
 */
import { json, optionsResponse, checkRateLimit, verifyTurnstile } from '../auth/_shared.js';
import { validateEmail } from '../auth/_email-validate.js';
import { verifyAndTagEmail } from '../_elv.js';
import { sendEmail, logEmailFailure } from '../_ses.js';
import { log } from '../_log.js';
import { validateBody } from '../_validate.js';
import { CONTACT_CATEGORIES, CATEGORY_SOURCES } from '../../../src/lib/contact-categories.js';
import { buildContactSubject } from './_subject.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    // Honeypot — if filled, silently accept (bots think they succeeded)
    if (body.website) {
      return json({ ok: true });
    }

    if (!env.AWS_ACCESS_KEY_ID) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    const validated = validateBody(body, {
      name:            { type: 'string', required: true, maxLength: 200 },
      email:           { type: 'email',  required: true },
      message:         { type: 'string', required: true, minLength: 10, maxLength: 5000 },
      category:        { type: 'enum', values: [...CONTACT_CATEGORIES], required: false },
      category_source: { type: 'enum', values: [...CATEGORY_SOURCES], required: false },
    });
    if (!validated.valid) return json({ ok: false, error: validated.error }, validated.status);

    // eslint-disable-next-line no-control-regex -- intentional: strip control chars from user input
    const name = validated.data.name.replace(/[\x00-\x1f\x7f]/g, '');
    const email = validated.data.email;
    const message = validated.data.message;
    const category = validated.data.category || 'other';
    const categorySource = validated.data.category_source || 'default';
    const authStateAtSubmit = context.data?.user?.id ?? null;

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Rate limit by IP
    if (!await checkRateLimit(env, `contact:${ip}`, 5, 900)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    // Verify Turnstile token
    const turnstileOk = await verifyTurnstile(env.CF_TURNSTILE_SECRET, body.turnstileToken, ip, env);
    if (!turnstileOk) {
      return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);
    }

    // Deep email validation (disposable domain, MX check, typo detection)
    const emailCheck = await validateEmail(email, env);
    if (!emailCheck.valid) {
      return json({ ok: false, error: emailCheck.error, ...(emailCheck.suggestion ? { suggestion: emailCheck.suggestion } : {}) }, 400);
    }

    // ELV mailbox verification (blocks spamtraps, disabled mailboxes)
    const elv = await verifyAndTagEmail(email, env, { source: 'contact' });
    if (elv.blocked) {
      return json({ ok: false, error: elv.reason }, 400);
    }

    // Send notification email via SES
    const notifySubject = buildContactSubject(category, message);
    try {
      await sendEmail(env, {
        from: 'RRM Academy <contact@mail.rrmacademy.org>',
        to: 'administrator@rrmacademy.org',
        replyTo: email,
        subject: notifySubject,
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          `Category: ${category} (source: ${categorySource})`,
          `Auth state at submit: ${authStateAtSubmit !== null ? `user:${authStateAtSubmit}` : 'anonymous'}`,
          '',
          message,
          '',
          '---',
          `Sent from rrmacademy.org/contact at ${new Date().toISOString()}`,
        ].join('\n'),
        log: { db: env.DB, source: 'contact/notify', category: 'transactional' },
      });
    } catch (err) {
      log(env, waitUntil, 'contact', 'send_error', 'error', err.message, 0, 502);
      await logEmailFailure(env.DB, { email: 'administrator@rrmacademy.org', category: 'transactional', source: 'contact/notify', subject: notifySubject, detail: err.message });
      return json({ ok: false, error: 'Failed to send message. Please try again.' }, 502);
    }

    // Send confirmation to the sender
    const confirmSubject = 'We received your message — RRM Academy';
    try {
      await sendEmail(env, {
        from: 'RRM Academy <contact@mail.rrmacademy.org>',
        to: email,
        subject: confirmSubject,
        text: [
          `Hi ${name},`,
          '',
          'Thank you for reaching out to RRM Academy. We received your message and will get back to you as soon as possible.',
          '',
          'Best regards,',
          'RRM Academy',
          'https://rrmacademy.org',
        ].join('\n'),
        log: { db: env.DB, source: 'contact/confirm', category: 'transactional' },
      });
    } catch (err) {
      log(env, waitUntil, 'contact', 'confirmation_error', 'warn', err.message, 0, 0);
      await logEmailFailure(env.DB, { email, category: 'transactional', source: 'contact/confirm', subject: confirmSubject, detail: err.message });
    }

    log(env, waitUntil, 'contact', 'submit_ok', 'ok', email, 0, 200, [category, categorySource]);
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    log(env, waitUntil, 'contact', 'submit_fail', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred.' }, 500);
  }
}
