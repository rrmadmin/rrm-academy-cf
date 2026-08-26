/**
 * POST /api/endo-quiz/results
 * Server-side hook for the results page (/endo-quiz/results/) firing on
 * load. Secondary (observed-only) funnel step between start
 * (ENDO_QUIZ_CONVERSION_ACTION_ID, 7671519551, primary) and the two
 * downstream completions (PDF download, email request) -- crediting a
 * visitor who reached their on-screen results even before they take either
 * of those next actions. No body is parsed -- there is no user input here
 * beyond IP and the request's own Cookie header, and
 * sendGoogleAdsConversion is a silent no-op when the gclid cookie is
 * absent, so organic/non-ad visitors correctly get { ok: true } with
 * nothing uploaded. ONE_PER_CLICK dedupes repeat fires WITHIN this action
 * only (reloading /results/ won't re-count for the same gclid).
 */
import { log } from '../_log.js';
import { json, optionsResponse, checkRateLimit } from '../auth/_shared.js';
import { sendGoogleAdsConversion, ENDO_QUIZ_RESULTS_CONVERSION_ACTION_ID } from '../_google-ads.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (!await checkRateLimit(env, `endo-quiz-results:${ip}`, 10, 900)) {
      return json({ error: 'rate_limited' }, 429);
    }

    if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
      return json({ error: 'service_unavailable' }, 503);
    }

    sendGoogleAdsConversion(env, waitUntil, request.headers.get('Cookie') || '', ENDO_QUIZ_RESULTS_CONVERSION_ACTION_ID);

    return json({ ok: true });
  } catch (err) {
    console.error('endo-quiz results unexpected error:', err);
    log(env, waitUntil, 'endo_quiz', 'results_fail', 'error', 'unexpected error', 0, 500);
    return json({ error: 'server_error' }, 500);
  }
}
