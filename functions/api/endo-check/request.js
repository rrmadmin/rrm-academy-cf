/**
 * POST /api/endo-check/request
 * Google Ads landing-flow counterpart to /api/survey/submit -- single-step
 * email capture (no magic link), source-tagged 'ads' in the same D1
 * pseudonymization split used by the organic /endo-survey/ flow:
 *   - symptoms/score -> SURVEY_SYMPTOMS_DB (rrm-survey-symptoms), no email
 *   - email identity  -> SURVEY_DB (rrm-survey) survey_identities, joined by rec_id
 * Does not touch functions/api/survey/* (guarded, off-limits).
 */
import { sendEmail, logEmailFailure } from '../_ses.js';
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';
import { validateEmail } from '../auth/_email-validate.js';
import { verifyAndTagEmail } from '../_elv.js';
import { json, optionsResponse, checkRateLimit, verifyTurnstile } from '../auth/_shared.js';
import { sendGoogleAdsConversion, ENDO_CHECK_CONVERSION_ACTION_ID } from '../_google-ads.js';

const TIER_MAX_ITEMS = { tier1: 15, tier2: 15, tier3: 6 };
const MAX_SYMPTOM_LEN = 200;
const MAX_SCORE = { tier1: 45, tier2: 30, tier3: 6, total: 81 };
const BANDS = new Set(['none', 'low', 'moderate', 'high']);

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    if (!env.SURVEY_DB || !env.SURVEY_SYMPTOMS_DB) {
      return json({ error: 'service_unavailable' }, 503);
    }
    if (!env.CF_TURNSTILE_SECRET) {
      return json({ error: 'service_unavailable' }, 503);
    }

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (!await checkRateLimit(env, `endo-check:${ip}`, 5, 900)) {
      return json({ error: 'rate_limited' }, 429);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json({ error: 'invalid_payload' }, 400);
    }

    const { email: rawEmail, score, symptoms, band, researchConsent, turnstileToken, device } = body;

    const turnstileResult = await verifyTurnstile(env.CF_TURNSTILE_SECRET, turnstileToken, ip, env);
    if (!turnstileResult.ok) {
      const msg = turnstileResult.reason === 'network'
        ? 'Verification service unavailable. Please try again in a moment.'
        : 'Spam check failed. Please refresh and try again.';
      return json({ error: msg }, 403);
    }

    const emailCheck = await validateEmail(rawEmail, env);
    if (!emailCheck.valid) {
      return json({ error: emailCheck.error, ...(emailCheck.suggestion ? { suggestion: emailCheck.suggestion } : {}) }, 400);
    }
    const email = emailCheck.email;

    if (typeof band !== 'string' || !BANDS.has(band)) {
      return json({ error: 'invalid_band' }, 400);
    }

    if (typeof score !== 'object' || score === null || Array.isArray(score)) {
      return json({ error: 'invalid_score' }, 400);
    }
    for (const key of ['tier1', 'tier2', 'tier3', 'total']) {
      const v = score[key];
      if (!Number.isFinite(v) || v < 0 || v > MAX_SCORE[key]) {
        return json({ error: 'invalid_score' }, 400);
      }
    }

    if (typeof symptoms !== 'object' || symptoms === null || Array.isArray(symptoms)) {
      return json({ error: 'invalid_symptoms' }, 400);
    }
    for (const tierKey of ['tier1', 'tier2', 'tier3']) {
      const list = symptoms[tierKey];
      if (!Array.isArray(list) || list.length > TIER_MAX_ITEMS[tierKey]) {
        return json({ error: 'invalid_symptoms' }, 400);
      }
      for (const s of list) {
        if (typeof s !== 'string' || s.length > MAX_SYMPTOM_LEN) {
          return json({ error: 'invalid_symptoms' }, 400);
        }
      }
    }

    const researchConsentInt = (researchConsent === true || researchConsent === 1) ? 1 : 0;
    if (researchConsentInt !== 1) {
      return json({ error: 'consent_required' }, 400);
    }

    waitUntil(
      verifyAndTagEmail(email, env, { source: 'endo-check-ads' }).catch(() => {})
    );

    const recId = crypto.randomUUID();
    const referrer = request.headers.get('referer') || '';
    const vw = (typeof device?.viewport_width === 'number' && Number.isFinite(device.viewport_width)
      && device.viewport_width > 0 && device.viewport_width <= 10000) ? device.viewport_width : null;

    try { // arise-ignore unbatched-writes -- writes span SURVEY_SYMPTOMS_DB (rrm-survey-symptoms) and SURVEY_DB (rrm-survey); db.batch() only works within a single binding so cross-DB atomicity is impossible. Mirrors functions/api/survey/submit.js's identical split; identity-link failure below is alerted, not silently dropped.
      await env.SURVEY_SYMPTOMS_DB.prepare(
        "INSERT INTO survey_symptoms (rec_id, score_total, score_tier1, score_tier2, score_tier3, tier1_symptoms, tier2_symptoms, tier3_symptoms, source, user_origin, viewport_width, device_type, referrer, submitted_at) VALUES (?,?,?,?,?,?,?,?,'ads',?,?,?,?,datetime('now'))"
      ).bind(
        recId,
        score.total,
        score.tier1,
        score.tier2,
        score.tier3,
        symptoms.tier1.join('\n'),
        symptoms.tier2.join('\n'),
        symptoms.tier3.join('\n'),
        null,
        vw,
        vw ? (vw <= 768 ? 'Mobile' : vw <= 1024 ? 'Tablet' : 'Desktop') : null,
        referrer,
      ).run();
    } catch (err) {
      console.error('endo-check symptom insert failed:', err.message);
      log(env, waitUntil, 'endo_check', 'symptom_write_dropped', 'error', 'insert failed', 0, 500);
      return json({ error: 'server_error' }, 500);
    }

    try {
      await env.SURVEY_DB.prepare(
        'INSERT INTO survey_identities (email, airtable_record_id, source) VALUES (?, ?, ?)'
      ).bind(email, recId, 'endo-check-ads').run();
    } catch (d1Err) {
      const detail = `D1 write failed: record=${recId} err=${d1Err.message}`;
      log(env, waitUntil, 'endo_check', 'd1_identity_write_error', 'error', detail, 0, 500);

      const alertSubject = 'ALERT: endo-check identity link failed';
      waitUntil((async () => {
        try {
          await sendEmail(env, {
            from: 'RRM Academy <alerts@mail.rrmacademy.org>',
            to: 'administrator@rrmacademy.org',
            subject: alertSubject,
            text: `D1 write failed during endo-check (ads) submission.\n\nrec_id: ${recId}\nTimestamp: ${new Date().toISOString()}\n\nManual action required: look up the email for this rec_id and INSERT into survey_identities manually.`,
            log: { db: env.SURVEY_DB, source: 'endo-check/d1-alert', category: 'transactional' },
          });
        } catch (emailErr) {
          log(env, waitUntil, 'endo_check', 'd1_alert_email_failed', 'error', emailErr.message, 0, 500);
          await logEmailFailure(env.SURVEY_DB, { email: 'administrator@rrmacademy.org', category: 'transactional', source: 'endo-check/d1-alert', subject: alertSubject, detail: emailErr.message });
        }
      })());
    }

    sendGoogleAdsConversion(env, waitUntil, request.headers.get('Cookie') || '', ENDO_CHECK_CONVERSION_ACTION_ID);
    waitUntil(sendGA4Event(env, request, 'generate_lead', { lead_source: 'endo_check_ads', page_location: 'https://rrmacademy.org/endo-check/results/' }).catch(() => {}));

    const emailSubject = 'Your endometriosis symptom self-check results';
    const emailText = buildEmailText(score, band);
    try {
      await sendEmail(env, {
        from: 'RRM Academy <info@mail.rrmacademy.org>',
        to: email,
        subject: emailSubject,
        text: emailText,
        log: { db: env.SURVEY_DB, source: 'endo-check/request', category: 'transactional' },
      });
    } catch (err) {
      console.error('endo-check email send failed:', err.message);
      log(env, waitUntil, 'endo_check', 'email_send_error', 'error', 'email failed', 0, 0);
      try {
        await logEmailFailure(env.SURVEY_DB, {
          email,
          category: 'transactional',
          source: 'endo-check/request',
          subject: emailSubject,
          detail: 'send failed',
        });
      } catch (logErr) { console.error('endo-check logEmailFailure failed:', logErr.message); }
    }

    return json({ ok: true });
  } catch (err) {
    console.error('endo-check request unexpected error:', err);
    log(env, waitUntil, 'endo_check', 'request_fail', 'error', 'unexpected error', 0, 500);
    return json({ error: 'server_error' }, 500);
  }
}

function buildEmailText(score, band) {
  const lines = [
    `Your score: ${score.total} out of 81`,
    `Tier 1 (very high suspicion): ${score.tier1} / 45`,
    `Tier 2 (high suspicion): ${score.tier2} / 30`,
    `Tier 3 (suspicion): ${score.tier3} / 6`,
    '',
  ];

  if (band === 'high') {
    lines.push('Your responses include a strong pattern of symptoms often associated with endometriosis. This is not a diagnosis -- only surgery can confirm endometriosis -- but a pattern like this is one a provider experienced in endometriosis care would typically want to evaluate further.');
  } else if (band === 'moderate') {
    lines.push('Your responses include symptoms associated with endometriosis across more than one category. This is not a diagnosis, but this pattern may be worth discussing with a healthcare provider experienced in endometriosis.');
  } else if (band === 'low') {
    lines.push('Your responses include a few symptoms that research associates with endometriosis. Even a small number of these symptoms can be worth mentioning at your next appointment, especially if they affect your daily life.');
  } else {
    lines.push('Your responses did not include symptoms commonly associated with endometriosis in this self-check. If you are still experiencing symptoms that concern you, consider discussing them with a healthcare provider.');
  }

  lines.push('');
  lines.push('Learn more about endometriosis:');
  lines.push('https://rrmacademy.org/endometriosis/');
  lines.push('');
  lines.push('Find a restorative reproductive medicine provider who can evaluate your symptoms:');
  lines.push('https://rrmacademy.org/providers/');
  lines.push('');
  lines.push('RRM Academy is a 501(c)(3) education nonprofit -- rrmacademy.org');

  return lines.join('\n');
}
