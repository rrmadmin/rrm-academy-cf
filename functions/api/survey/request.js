/**
 * POST /api/survey/request
 * Accepts { email }, generates a magic-link token, stores in KV, sends email via SES.
 */
import { sendEmail, logEmailFailure } from '../_ses.js';
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';
import { validateEmail } from '../auth/_email-validate.js';
import { verifyAndTagEmail } from '../_elv.js';
import { json, optionsResponse, checkRateLimit } from '../auth/_shared.js';
import { validateBody } from '../_validate.js';

const TOKEN_TTL = 24 * 60 * 60; // 24 hours in seconds
const RATE_LIMIT_SECONDS = 600;       // 10 minutes between emails to same address

// Optional client GA4 identity override (body.ga = { cid, sid, sn }). Validated
// exactly as track.js validates its cid/sid/sn overrides -- mirror, don't invent.
const CID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CID_FALLBACK_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SID_MIN = 1;
const SID_MAX = 9_999_999_999; // epoch seconds; year 2286+

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  try {
    if (!env.SURVEY_TOKENS) {
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

    const validated = validateBody(body, {
      email: { type: 'email', required: true },
    });
    if (!validated.valid) return json({ ok: false, error: validated.error }, validated.status);
    const email = validated.data.email;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!await checkRateLimit(env, `survey:${ip}`, 5, 900)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    const emailCheck = await validateEmail(email, env);
    if (!emailCheck.valid) {
      return json({ ok: false, error: emailCheck.error, ...(emailCheck.suggestion ? { suggestion: emailCheck.suggestion } : {}) }, 400);
    }

    // ELV mailbox verification
    const elv = await verifyAndTagEmail(email, env, { source: 'survey' });
    if (elv.blocked) {
      return json({ ok: false, error: elv.reason }, 400);
    }

    // Rate limit: 1 email per 10 minutes per address
    const existing = await env.SURVEY_TOKENS.get(`email:${email}`, 'json');
    if (existing) {
      const elapsed = (Date.now() - existing.created) / 1000;
      if (elapsed < RATE_LIMIT_SECONDS) {
        return json({ ok: false, error: 'Check your inbox. A survey link was already sent.' }, 429);
      }
    }

    // Generate token
    const token = crypto.randomUUID();
    const now = Date.now();

    // Carry through UTM / userorigin params
    const url = new URL(request.url);
    const sanitizeMarketingTag = (v) => (typeof v === 'string' && v.length <= 200 && v.length > 0) ? v : '';
    const userorigin = sanitizeMarketingTag(url.searchParams.get('userorigin')) || sanitizeMarketingTag(body.userorigin) || '';
    const utmSource = sanitizeMarketingTag(url.searchParams.get('utm_source')) || sanitizeMarketingTag(body.utm_source) || '';

    // GA4 identity override (body.ga = { cid, sid, sn }), so the take page adopts the
    // same GA4 user across the email hop and generate_lead lands under that user
    // instead of an IP+UA fallback client_id. Invalid or absent -- ignore silently,
    // never reject the request over it.
    const gaCid = body.ga?.cid;
    const gaSid = body.ga?.sid;
    const gaSn = body.ga?.sn;
    const gaCidValid = typeof gaCid === 'string' && (CID_UUID_RE.test(gaCid) || CID_FALLBACK_RE.test(gaCid));
    const gaSidValid = typeof gaSid === 'number' && Number.isInteger(gaSid) && gaSid >= SID_MIN && gaSid <= SID_MAX;
    const gaSnValid = typeof gaSn === 'number' && Number.isInteger(gaSn) && gaSn >= 1 && gaSn <= 999_999;
    let ga4Overrides;
    if (gaCidValid && gaSidValid) {
      ga4Overrides = { client_id: gaCid, session_id: gaSid };
      if (gaSnValid) ga4Overrides.session_number = gaSn;
    }

    // Store token → email mapping
    await env.SURVEY_TOKENS.put(
      `token:${token}`,
      JSON.stringify({ email, created: now, used: false, userorigin, utmSource }),
      { expirationTtl: TOKEN_TTL }
    );

    // Store email → token reverse lookup (for rate limiting)
    await env.SURVEY_TOKENS.put(
      `email:${email}`,
      JSON.stringify({ token, created: now }),
      { expirationTtl: RATE_LIMIT_SECONDS }
    );

    // Build magic link
    let surveyUrl = `https://rrmacademy.org/endo-survey/take/?token=${token}`;
    if (userorigin) surveyUrl += `&userorigin=${encodeURIComponent(userorigin)}`;
    if (utmSource) surveyUrl += `&utm_source=${encodeURIComponent(utmSource)}`;
    if (gaCidValid) surveyUrl += `&cid=${encodeURIComponent(gaCid)}`;

    // Send email via SES
    const surveySubject = 'Your Endometriosis Symptom Self-Survey';
    try {
      await sendEmail(env, {
        from: 'RRM Academy <survey@mail.rrmacademy.org>',
        to: email,
        subject: surveySubject,
        html: buildEmailHtml(surveyUrl),
        log: env.DB ? { db: env.DB, source: 'survey/request', category: 'transactional' } : undefined,
      });
    } catch (err) {
      log(env, waitUntil, 'survey', 'request_send_error', 'error', err.message, 0, 502);
      // Best-effort: a missing/failed email_log write must not mask the send result
      await logEmailFailure(env.DB, { email, category: 'transactional', source: 'survey/request', subject: surveySubject, detail: err.message }).catch(() => {});
      await env.SURVEY_TOKENS.delete(`email:${email}`);
      await env.SURVEY_TOKENS.delete(`token:${token}`);
      return json({ ok: false, error: 'Failed to send email. Please try again.' }, 502);
    }

    waitUntil(sendGA4Event(env, request, 'generate_lead', { lead_source: 'endo_survey_request' }, ga4Overrides).catch(() => {}));

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    log(env, waitUntil, 'survey', 'request_fail', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}

function buildEmailHtml(surveyUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f5f3;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="background:#ffffff;border-radius:8px;padding:40px 32px;border-top:4px solid #725e7e;">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#313131;margin:0 0 24px;font-weight:normal;">
        Your Endometriosis Symptom Self-Survey
      </h1>
      <p style="font-size:16px;line-height:1.7;color:#636261;margin:0 0 16px;">
        Thank you for taking this step toward understanding your symptoms.
      </p>
      <p style="font-size:16px;line-height:1.7;color:#636261;margin:0 0 24px;">
        This evidence-based self-survey was developed by Dr. Naomi Whittaker, a board-certified OB/GYN specializing in endometriosis excision surgery, to help you identify symptoms that may warrant further evaluation.
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${surveyUrl}" style="display:inline-block;background:#725e7e;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:9999px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:500;">
          Take the Survey
        </a>
      </div>
      <p style="font-size:14px;line-height:1.6;color:#94918e;margin:24px 0 0;">
        This link is for your use only and can only be used once. If you did not request this survey, you can safely ignore this email.
      </p>
    </div>
    <div style="text-align:center;padding:24px 0 0;">
      <p style="font-size:12px;color:#94918e;margin:0;">
        RRM Academy &middot; A project of the RRM Foundation, a 501(c)(3) nonprofit
      </p>
    </div>
  </div>
</body>
</html>`;
}
