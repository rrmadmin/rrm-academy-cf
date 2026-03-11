/**
 * POST /api/contact/submit
 * Validates Turnstile token, rate-limits by IP, sends email via SES.
 */
import { json, optionsResponse, checkRateLimit, isValidEmail, verifyTurnstile } from '../auth/_shared.js';
import { validateEmail } from '../auth/_email-validate.js';
import { verifyAndTagEmail } from '../_elv.js';
import { sendEmail } from '../_ses.js';
import { log } from '../_log.js';

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

    // Honeypot — if filled, silently accept (bots think they succeeded)
    if (body.website) {
      return json({ ok: true });
    }

    if (!env.AWS_ACCESS_KEY_ID) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    // Validate fields
    // eslint-disable-next-line no-control-regex -- intentional: strip control chars from user input
    const name = (body.name || '').trim().replace(/[\x00-\x1f\x7f]/g, '');
    const email = (body.email || '').trim().toLowerCase();
    const message = (body.message || '').trim();

    if (!name || name.length > 200) {
      return json({ ok: false, error: 'Name is required.' }, 400);
    }
    if (!isValidEmail(email)) {
      return json({ ok: false, error: 'Valid email is required.' }, 400);
    }
    if (!message || message.length < 10 || message.length > 5000) {
      return json({ ok: false, error: 'Message must be between 10 and 5,000 characters.' }, 400);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Rate limit by IP
    if (!checkRateLimit(`contact:${ip}`)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    // Verify Turnstile token
    const turnstileOk = await verifyTurnstile(env.CF_TURNSTILE_SECRET, body.turnstileToken, ip);
    if (!turnstileOk) {
      return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);
    }

    // Deep email validation (disposable domain, MX check, typo detection)
    const emailCheck = await validateEmail(email);
    if (!emailCheck.valid) {
      return json({ ok: false, error: emailCheck.error, ...(emailCheck.suggestion ? { suggestion: emailCheck.suggestion } : {}) }, 400);
    }

    // ELV mailbox verification (blocks spamtraps, disabled mailboxes)
    const elv = await verifyAndTagEmail(email, env, { source: 'contact' });
    if (elv.blocked) {
      return json({ ok: false, error: elv.reason }, 400);
    }

    // Send notification email via SES
    try {
      await sendEmail(env, {
        from: 'RRM Academy <contact@mail.rrmacademy.org>',
        to: 'administrator@rrmacademy.org',
        replyTo: email,
        subject: `[Contact] ${name} (${email})`,
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          '',
          message,
          '',
          '---',
          `Sent from rrmacademy.org/contact at ${new Date().toISOString()}`,
        ].join('\n'),
      });
    } catch (err) {
      log(env, waitUntil, 'contact', 'send_error', 'error', err.message, 0, 502);
      return json({ ok: false, error: 'Failed to send message. Please try again.' }, 502);
    }

    // Send confirmation to the sender
    try {
      await sendEmail(env, {
        from: 'RRM Academy <contact@mail.rrmacademy.org>',
        to: email,
        subject: 'We received your message — RRM Academy',
        text: [
          `Hi ${name},`,
          '',
          'Thank you for reaching out to RRM Academy. We received your message and will get back to you as soon as possible.',
          '',
          'Best regards,',
          'RRM Academy',
          'https://rrmacademy.org',
        ].join('\n'),
      });
    } catch (err) {
      log(env, waitUntil, 'contact', 'confirmation_error', 'warn', err.message, 0, 0);
    }

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    log(env, waitUntil, 'contact', 'submit_fail', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred.' }, 500);
  }
}
