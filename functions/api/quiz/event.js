/**
 * POST /api/quiz/event
 * Receives navigator.sendBeacon events from the FABM quiz flow.
 * Writes a metadata-only row to D1 SURVEY_DB (rrm-survey, quiz_event table).
 * No auth required -- anonymous event tracking. No email, no answer content,
 * no cookies. Always 204 once method/shape parsing succeeds -- validation
 * failures and insert failures are logged server-side only (beacon callers
 * never read the response body).
 */
import { CORS_HEADERS, optionsResponse, checkRateLimit } from '../auth/_shared.js';
import { log } from '../_log.js';

const ALLOWED_EVENTS = new Set([
  'gate_view', 'consent_checked', 'quiz_start', 'question_view', 'question_answer',
  'back_tap', 'result_view', 'print_tap', 'cta_click', 'start_over', 'submit_ok', 'submit_fail',
]);

const ALLOWED_QIDS = new Set([
  'goal', 'cycles', 'postpartum', 'offbc', 'effort', 'femtech', 'device', 'budget', 'clinical',
]);

const SID_RE = /^[A-Za-z0-9-]{8,64}$/;
const RULES_VERSION_RE = /^v[0-9a-z-]{1,32}$/;

function noContent() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    if (!env.SURVEY_DB) {
      return noContent();
    }

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (!await checkRateLimit(env, `quiz-event:${ip}`, 120, 60)) {
      return noContent();
    }

    let body;
    try {
      const text = await request.text();
      body = JSON.parse(text);
    } catch {
      return noContent();
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return noContent();
    }

    const { sid, event, qid, rulesVersion } = body;

    if (typeof sid !== 'string' || !SID_RE.test(sid)) {
      return noContent();
    }
    if (typeof event !== 'string' || !ALLOWED_EVENTS.has(event)) {
      return noContent();
    }

    let safeQid = null;
    if (qid !== undefined && qid !== null && qid !== '') {
      if (typeof qid !== 'string' || !ALLOWED_QIDS.has(qid)) {
        return noContent();
      }
      safeQid = qid;
    }

    let safeRulesVersion = null;
    if (rulesVersion !== undefined && rulesVersion !== null && rulesVersion !== '') {
      if (typeof rulesVersion !== 'string' || !RULES_VERSION_RE.test(rulesVersion)) {
        return noContent();
      }
      safeRulesVersion = rulesVersion;
    }

    try {
      await env.SURVEY_DB.prepare(
        'INSERT INTO quiz_event (sid, event, qid, rules_version) VALUES (?, ?, ?, ?)'
      ).bind(sid, event, safeQid, safeRulesVersion).run();
    } catch (err) {
      console.error('quiz_event insert failed:', err.message);
      log(env, waitUntil, 'quiz', 'event_insert_error', 'error', 'insert failed', 0, 500);
      return noContent();
    }

    return noContent();
  } catch (err) {
    console.error('quiz event unexpected error:', err);
    log(env, waitUntil, 'quiz', 'event_fail', 'error', (err?.message || 'internal').slice(0, 200));
    return noContent();
  }
}
