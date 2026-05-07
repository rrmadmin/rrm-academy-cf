import { sendEmail, logEmailFailure } from '../_ses.js';
import { log } from '../_log.js';
import { validateEmail } from '../auth/_email-validate.js';
import { verifyAndTagEmail } from '../_elv.js';
import { json, optionsResponse, checkRateLimit, isValidEmail, verifyTurnstile, SITE_URL } from '../auth/_shared.js';
import { GUIDE_PDFS } from '../_guide-pdfs.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  if (!env.DB) {
    log(env, waitUntil, 'pdf', 'config_missing', 'error', 'DB binding not configured', 0, 500);
    return json({ ok: false, error: 'Server misconfigured' }, 500);
  }
  if (!env.AWS_ACCESS_KEY_ID) {
    return json({ ok: false, error: 'Server misconfigured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  const { guide_slug } = body;

  if (typeof guide_slug !== 'string' || !guide_slug) {
    return json({ ok: false, error: 'guide_slug is required.' }, 400);
  }

  if (!GUIDE_PDFS[guide_slug] || !GUIDE_PDFS[guide_slug].enabled) {
    return json({ ok: false, error: 'Not found.' }, 404);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await checkRateLimit(env, `pdf:${ip}`, 5, 900)) {
    return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429);
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return json({ ok: false, error: 'Valid email is required.' }, 400);
  }

  const emailCheck = await validateEmail(email);
  if (!emailCheck.valid) {
    return json({ ok: false, error: emailCheck.error }, 400);
  }

  const turnstileOk = await verifyTurnstile(env.CF_TURNSTILE_SECRET, body.turnstileToken, ip, env);
  if (!turnstileOk) {
    return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403);
  }

  const elv = await verifyAndTagEmail(email, env, { source: 'pdf-download' });
  if (elv.blocked) {
    return json({ ok: false, error: elv.reason }, 422);
  }

  try {
    const existing = await env.DB.prepare(
      'SELECT token FROM pdf_token WHERE email = ? COLLATE NOCASE AND guide_slug = ? AND expires_at > unixepoch() AND used_at IS NULL LIMIT 1'
    ).bind(email, guide_slug).first();
    let token = existing?.token;

    if (!token) {
      token = crypto.randomUUID();
      // arise-ignore unbatched-writes -- if/else branch; only one .run() executes per request
      await env.DB.prepare(
        'INSERT INTO pdf_token (token, email, guide_slug, expires_at) VALUES (?, ?, ?, unixepoch() + 86400)'
      ).bind(token, email, guide_slug).run();
    } else {
      await env.DB.prepare(
        'UPDATE pdf_token SET expires_at = unixepoch() + 86400 WHERE token = ? AND used_at IS NULL'
      ).bind(token).run();
    }

    const sub = await env.DB.prepare(
      'SELECT id, status, segments FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE'
    ).bind(email).first();
    const newSeg = `pdf-${guide_slug}`;
    if (sub) {
      const segs = JSON.parse(sub.segments || '[]') || [];
      if (!segs.includes(newSeg)) segs.push(newSeg);
      await env.DB.prepare(
        'UPDATE newsletter_subscriber SET segments = ? WHERE id = ?'
      ).bind(JSON.stringify(segs), sub.id).run();
    } else {
      const subId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO newsletter_subscriber (id, email, status, source, subscribed_at, segments) VALUES (?, ?, 'active', 'pdf-download', datetime('now'), ?)"
      ).bind(subId, email, JSON.stringify([newSeg])).run();
    }

    await env.DB.prepare(
      "INSERT INTO contact (id, email, source, created_at, updated_at) VALUES (?, ?, 'pdf-download', datetime('now'), datetime('now')) ON CONFLICT(email) DO UPDATE SET updated_at = datetime('now')"
    ).bind(crypto.randomUUID(), email).run();

    const guideTitle = GUIDE_PDFS[guide_slug].title;
    const redeemUrl = `${SITE_URL}/api/pdf/redeem?token=${token}`;

    const pdfSubject = `Your ${guideTitle} - Download Link Inside`;
    try {
      await sendEmail(env, {
        from: 'RRM Academy <info@mail.rrmacademy.org>',
        to: email,
        subject: pdfSubject,
        html: `<p>Here's your link to download <strong>${guideTitle}</strong>.</p><p><a href="${redeemUrl}">Download PDF</a></p><p>This link expires in 24 hours and can only be used once.</p><p style="color:#888;font-size:12px;">You're receiving this because you subscribed to RRM Academy updates.</p>`,
        text: `Download ${guideTitle}: ${redeemUrl}\n\nThis link expires in 24 hours and can only be used once.`,
        log: { db: env.DB, source: 'pdf/request', category: 'transactional' },
      });
    } catch (err) {
      log(env, waitUntil, 'pdf', 'request_send_error', 'error', err.message, 0, 502);
      await logEmailFailure(env.DB, { email, category: 'transactional', source: 'pdf/request', subject: pdfSubject, detail: err.message });
      return json({ ok: false, error: 'Failed to send email. Please try again.' }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    log(env, waitUntil, 'pdf', 'request_fail', 'error', err.message);
    return json({ ok: false, error: 'service_unavailable' }, 503);
  }
}
