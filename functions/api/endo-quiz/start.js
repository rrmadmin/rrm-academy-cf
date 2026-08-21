/**
 * POST /api/endo-quiz/start
 * Server-side hook for the quiz landing page (/endo-quiz/start/) firing on
 * load. Before this endpoint existed, the Endo Quiz conversion only fired on
 * PDF download and email submit on the results page -- so an ad visitor who
 * completed the quiz and simply read their on-screen results, without
 * downloading the PDF or handing over an email, was never counted at all.
 * Brian's decision 2026-08-21: the meaningful action worth crediting is
 * STARTING the quiz, not just the two downstream completions, since every
 * visitor who reaches /start/ from an ad has already engaged with the
 * educational tool. This fires the same Endo Quiz conversion action
 * (ENDO_QUIZ_CONVERSION_ACTION_ID) that /api/endo-quiz/request and
 * /api/endo-quiz/download fire. No body is parsed -- there is no user input
 * here beyond IP and the request's own Cookie header, and
 * sendGoogleAdsConversion is a silent no-op when the gclid cookie is absent,
 * so organic/non-ad visitors correctly get { ok: true } with nothing
 * uploaded. Each conversion action is ONE_PER_CLICK, which dedupes repeat
 * fires WITHIN that action only (reloading /start/ won't re-count for the
 * same gclid) -- it does not dedupe across the three distinct actions in
 * this funnel (ENDO_QUIZ_CONVERSION_ACTION_ID here,
 * ENDO_QUIZ_PDF_CONVERSION_ACTION_ID on download,
 * ENDO_QUIZ_EMAIL_CONVERSION_ACTION_ID on email capture), so a visitor who
 * completes the whole funnel can legitimately record up to three
 * conversions.
 */
import { log } from '../_log.js';
import { json, optionsResponse, checkRateLimit } from '../auth/_shared.js';
import { sendGoogleAdsConversion, ENDO_QUIZ_CONVERSION_ACTION_ID } from '../_google-ads.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (!await checkRateLimit(env, `endo-quiz-start:${ip}`, 10, 900)) {
      return json({ error: 'rate_limited' }, 429);
    }

    if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
      return json({ error: 'service_unavailable' }, 503);
    }

    sendGoogleAdsConversion(env, waitUntil, request.headers.get('Cookie') || '', ENDO_QUIZ_CONVERSION_ACTION_ID);

    return json({ ok: true });
  } catch (err) {
    console.error('endo-quiz start unexpected error:', err);
    log(env, waitUntil, 'endo_quiz', 'start_fail', 'error', 'unexpected error', 0, 500);
    return json({ error: 'server_error' }, 500);
  }
}
