/**
 * POST /api/survey/submit
 * Stores survey results in Airtable and consumes the token.
 * Input: { token, symptoms: { tier1: [...], tier2: [...], tier3: [...] }, score: { tier1, tier2, tier3, total } }
 */
import { sendEmail } from '../_ses.js';
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://rrmacademy.org',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TOKEN_TTL = 24 * 60 * 60; // 24 hours -- match request.js

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    if (!env.SURVEY_TOKENS) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }
    if (!env.AIRTABLE_PAT || !env.AIRTABLE_SURVEY_BASE || !env.AIRTABLE_SURVEY_TABLE) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }
    if (!env.SURVEY_DB) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { token, symptoms, score } = body;
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
    if (typeof score.total !== 'number' || typeof score.tier1 !== 'number' ||
        typeof score.tier2 !== 'number' || typeof score.tier3 !== 'number') {
      return json({ ok: false, error: 'score must contain numeric total, tier1, tier2, tier3' }, 400);
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
    try {
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

    // Store in Airtable
    let airtableRecordId;
    try {
      const referrer = request.headers.get('referer') || '';
      const fields = {
        Score: score.total,
        'Tier 1 Count': score.tier1,
        'Tier 2 Count': score.tier2,
        'Tier 3 Count': score.tier3,
        'Tier 1 Symptoms': symptoms.tier1.join('\n'),
        'Tier 2 Symptoms': symptoms.tier2.join('\n'),
        'Tier 3 Symptoms': symptoms.tier3.join('\n'),
        Submitted: new Date().toISOString(),
        Source: referrer,
        'User Origin': data.userorigin || '',
      };

      const airtableResp = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_SURVEY_BASE}/${env.AIRTABLE_SURVEY_TABLE}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.AIRTABLE_PAT}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ records: [{ fields }], typecast: true }),
        }
      );

      if (!airtableResp.ok) {
        const errText = await airtableResp.text();
        log(env, waitUntil, 'survey', 'airtable_write_error', 'error', `${airtableResp.status} ${errText}`, 0, 502);
        await env.SURVEY_DB.prepare('DELETE FROM survey_token_claims WHERE token = ?').bind(token).run();
        await env.SURVEY_TOKENS.put(`token:${token}`, JSON.stringify(data), {
          expirationTtl: TOKEN_TTL,
        });
        return json({ ok: false, error: 'Failed to save results. Please try again.' }, 502);
      }

      const airtableData = await airtableResp.json();
      airtableRecordId = airtableData.records?.[0]?.id;
      if (!airtableRecordId) {
        log(env, waitUntil, 'survey', 'airtable_no_record_id', 'error', 'Airtable returned no record ID', 0, 502);
        await env.SURVEY_DB.prepare('DELETE FROM survey_token_claims WHERE token = ?').bind(token).run();
        await env.SURVEY_TOKENS.put(`token:${token}`, JSON.stringify(data), {
          expirationTtl: TOKEN_TTL,
        });
        return json({ ok: false, error: 'Failed to save results. Please try again.' }, 502);
      }
    } catch (err) {
      log(env, waitUntil, 'survey', 'airtable_write_error', 'error', err.message, 0, 502);
      await env.SURVEY_DB.prepare('DELETE FROM survey_token_claims WHERE token = ?').bind(token).run();
      await env.SURVEY_TOKENS.put(`token:${token}`, JSON.stringify(data), {
        expirationTtl: TOKEN_TTL,
      });
      return json({ ok: false, error: 'Failed to save results. Please try again.' }, 502);
    }

    // Link email to Airtable record in D1 (pseudonymized)
    try {
      await env.SURVEY_DB.prepare(
        'INSERT INTO survey_identities (email, airtable_record_id, source) VALUES (?, ?, ?)'
      ).bind(data.email, airtableRecordId, 'endo-survey-v1').run();
    } catch (d1Err) {
      const detail = `D1 write failed: email=${data.email} record=${airtableRecordId} err=${d1Err.message}`;
      log(env, waitUntil, 'survey', 'd1_identity_write_error', 'error', detail, 0, 500);

      const alertFn = async () => {
        try {
          await sendEmail(env, {
            from: 'RRM Academy <alerts@mail.rrmacademy.org>',
            to: 'administrator@rrmacademy.org',
            subject: 'ALERT: Survey identity link failed',
            text: `D1 write failed during survey submission.\n\nEmail: ${data.email}\nAirtable Record ID: ${airtableRecordId}\nError: ${d1Err.message}\nTimestamp: ${new Date().toISOString()}\n\nManual action required: INSERT into survey_identities or link this record manually.`,
          });
        } catch (emailErr) {
          log(env, waitUntil, 'survey', 'd1_alert_email_failed', 'error', emailErr.message, 0, 500);
        }
      };
      waitUntil(alertFn());
    }

    // Strip email from KV token
    const stripped = { ...updated, email: undefined };
    delete stripped.email;
    await env.SURVEY_TOKENS.put(`token:${token}`, JSON.stringify(stripped), {
      expirationTtl: TOKEN_TTL,
    });

    waitUntil(sendGA4Event(env, request, 'generate_lead', { event_category: 'endo_survey' }).catch(() => {}));

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    log(env, waitUntil, 'survey', 'submit_fail', 'error', err.message);
    return json({ ok: false, error: 'An unexpected error occurred. Please try again.' }, 500);
  }
}
