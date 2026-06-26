/**
 * POST /api/survey/submit
 * Stores symptoms in D1 `rrm-survey-symptoms` (SURVEY_SYMPTOMS_DB) and identity in D1 `rrm-survey` (SURVEY_DB). Consumes the token.
 * Input: { token, symptoms: { tier1: [...], tier2: [...], tier3: [...] }, score: { tier1, tier2, tier3, total } }
 */
import { sendEmail, logEmailFailure } from '../_ses.js';
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';
import { json, optionsResponse, checkRateLimit } from '../auth/_shared.js';

const TOKEN_TTL = 24 * 60 * 60; // 24 hours -- match request.js

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    if (!env.SURVEY_TOKENS) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }
    if (!env.SURVEY_DB) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }
    if (!env.SURVEY_SYMPTOMS_DB) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (!await checkRateLimit(env, `survey-submit:${ip}`, 10, 900)) {
      return json({ ok: false, error: 'rate_limited' }, 429);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { token, symptoms, score, device } = body;
    if (!token || !symptoms || !score) {
      return json({ ok: false, error: 'Missing required fields' }, 400);
    }
    if (typeof token !== 'string' || token.length > 40) {
      return json({ ok: false, error: 'Invalid token' }, 400);
    }
    if (!Array.isArray(symptoms.tier1) || !Array.isArray(symptoms.tier2) || !Array.isArray(symptoms.tier3)) {
      return json({ ok: false, error: 'symptoms must contain tier1, tier2, tier3 arrays' }, 400);
    }
    const MAX_ITEMS = 50;
    const MAX_LEN = 200;
    for (const tier of [symptoms.tier1, symptoms.tier2, symptoms.tier3]) {
      if (tier.length > MAX_ITEMS) {
        return json({ ok: false, error: `Too many symptoms (max ${MAX_ITEMS} per tier)` }, 400);
      }
      for (const s of tier) {
        if (typeof s !== 'string' || s.length > MAX_LEN) {
          return json({ ok: false, error: `Each symptom must be a string of at most ${MAX_LEN} characters` }, 400);
        }
      }
    }
    if (![score.total, score.tier1, score.tier2, score.tier3].every(n => Number.isFinite(n) && n >= 0 && n <= 200)) {
      return json({ ok: false, error: 'score values must be finite non-negative numbers <= 200' }, 400);
    }

    // Validate token
    const data = await env.SURVEY_TOKENS.get(`token:${token}`, 'json');
    if (!data) {
      return json({ ok: false, error: 'Token not found' }, 404);
    }
    if (data.used) {
      return json({ ok: false, error: 'Survey already completed' }, 409);
    }

    // Atomically claim token via D1 to prevent double-submit races
    try { // arise-ignore unbatched-writes -- writes span SURVEY_DB (rrm-survey) and SURVEY_SYMPTOMS_DB (rrm-survey-symptoms); db.batch() only works within a single binding so cross-DB atomicity is impossible; identityLinked + SES alert is the intentional fallback for partial failures
      const claim = await env.SURVEY_DB.prepare(
        'INSERT INTO survey_token_claims (token, claimed_at) VALUES (?, ?)'
      ).bind(token, Date.now()).run();
      if (!claim.success) {
        return json({ ok: false, error: 'Survey already completed' }, 409);
      }
    } catch (claimErr) {
      if (claimErr.message?.includes('UNIQUE constraint failed')) {
        return json({ ok: false, error: 'Survey already completed' }, 409);
      }
      throw claimErr;
    }

    // Mark token as used in KV
    const updated = { ...data, used: true, completedAt: Date.now() };
    await env.SURVEY_TOKENS.put(`token:${token}`, JSON.stringify(updated), {
      expirationTtl: TOKEN_TTL,
    });

    // Write symptoms (DB2) BEFORE the identity link (DB1). If the identity write later fails, the symptom row is an orphan we can re-link from the alert email, but clinical data is never lost. The inverse order would lose symptoms on a DB1-success/DB2-fail. Do not reorder.
    const recId = crypto.randomUUID();
    const referrer = request.headers.get('referer') || '';
    const vw = (typeof device?.viewport_width === 'number' && Number.isFinite(device.viewport_width)
      && device.viewport_width > 0 && device.viewport_width <= 10000) ? device.viewport_width : null;
    try {
      await env.SURVEY_SYMPTOMS_DB.prepare(
        "INSERT INTO survey_symptoms (rec_id, score_total, score_tier1, score_tier2, score_tier3, tier1_symptoms, tier2_symptoms, tier3_symptoms, source, user_origin, viewport_width, device_type, referrer, submitted_at) VALUES (?,?,?,?,?,?,?,?,'endo-survey-v1',?,?,?,?,datetime('now'))"
      ).bind(
        recId,
        score.total,
        score.tier1,
        score.tier2,
        score.tier3,
        symptoms.tier1.join('\n'),
        symptoms.tier2.join('\n'),
        symptoms.tier3.join('\n'),
        data.userorigin || null,
        vw,
        vw ? (vw <= 768 ? 'Mobile' : vw <= 1024 ? 'Tablet' : 'Desktop') : null,
        referrer,
      ).run();
    } catch (err) {
      log(env, waitUntil, 'survey', 'symptom_write_dropped', 'error', err.message, 0, 502);
      await env.SURVEY_DB.prepare('DELETE FROM survey_token_claims WHERE token = ?').bind(token).run();
      await env.SURVEY_TOKENS.put(`token:${token}`, JSON.stringify(data), { expirationTtl: TOKEN_TTL });
      return json({ ok: false, error: 'Failed to save results. Please try again.' }, 502);
    }

    // Link email to the symptom record id in D1 (pseudonymized; rec_id joins rrm-survey-symptoms)
    let identityLinked = false;
    try {
      await env.SURVEY_DB.prepare(
        'INSERT INTO survey_identities (email, airtable_record_id, source) VALUES (?, ?, ?)'
      ).bind(data.email, recId, 'endo-survey-v1').run();
      identityLinked = true;
    } catch (d1Err) {
      const detail = `D1 write failed: record=${recId} err=${d1Err.message}`;
      log(env, waitUntil, 'survey', 'd1_identity_write_error', 'error', detail, 0, 500);

      const alertSubject = 'ALERT: Survey identity link failed';
      const alertFn = async () => {
        try {
          await sendEmail(env, {
            from: 'RRM Academy <alerts@mail.rrmacademy.org>',
            to: 'administrator@rrmacademy.org',
            subject: alertSubject,
            text: `D1 write failed during survey submission.\n\nrec_id: ${recId}\nTimestamp: ${new Date().toISOString()}\n\nManual action required: look up the email for this rec_id and INSERT into survey_identities manually.`,
            log: { db: env.SURVEY_DB, source: 'survey/d1-alert', category: 'transactional' },
          });
        } catch (emailErr) {
          log(env, waitUntil, 'survey', 'd1_alert_email_failed', 'error', emailErr.message, 0, 500);
          await logEmailFailure(env.SURVEY_DB, { email: 'administrator@rrmacademy.org', category: 'transactional', source: 'survey/d1-alert', subject: alertSubject, detail: emailErr.message });
        }
      };
      waitUntil(alertFn());
    }

    if (identityLinked) {
      const stripped = { ...updated, email: undefined };
      delete stripped.email;
      await env.SURVEY_TOKENS.put(`token:${token}`, JSON.stringify(stripped), {
        expirationTtl: TOKEN_TTL,
      });
    }

    waitUntil(sendGA4Event(env, request, 'generate_lead', { lead_source: 'endo_survey', page_location: 'https://rrmacademy.org/endo-survey/take/' }).catch(() => {}));

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    log(env, waitUntil, 'survey', 'submit_fail', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
