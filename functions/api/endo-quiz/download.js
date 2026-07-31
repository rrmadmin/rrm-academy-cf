/**
 * POST /api/endo-quiz/download
 * Server-side hook for the results page's "Download PDF summary" button
 * (generateEndoQuizSummaryPdf, jsPDF, client-side only -- no network call of
 * its own). Without this endpoint, an ad visitor who completes the quiz and
 * downloads the PDF instead of requesting the email leaves with nothing
 * recorded: the Google Ads Grants account has logged zero conversions
 * all-time, and Ad Grants policy requires at least one meaningful conversion
 * per calendar month. This fires the same Endo Quiz conversion action
 * (ENDO_QUIZ_CONVERSION_ACTION_ID) that /api/endo-quiz/request fires on
 * email capture. No body is parsed -- there is no user input here beyond IP
 * and the request's own Cookie header, and sendGoogleAdsConversion is a
 * silent no-op when the gclid cookie is absent, so organic/non-ad visitors
 * correctly get { ok: true } with nothing uploaded.
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
    if (!await checkRateLimit(env, `endo-quiz-dl:${ip}`, 10, 900)) {
      return json({ error: 'rate_limited' }, 429);
    }

    if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
      return json({ error: 'service_unavailable' }, 503);
    }

    sendGoogleAdsConversion(env, waitUntil, request.headers.get('Cookie') || '', ENDO_QUIZ_CONVERSION_ACTION_ID);

    return json({ ok: true });
  } catch (err) {
    console.error('endo-quiz download unexpected error:', err);
    log(env, waitUntil, 'endo_quiz', 'download_fail', 'error', 'unexpected error', 0, 500);
    return json({ error: 'server_error' }, 500);
  }
}
