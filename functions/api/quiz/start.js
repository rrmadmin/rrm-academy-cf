/**
 * POST /api/quiz/start
 * Server-side hook for the FABM quiz landing page
 * (/fertility-awareness-method-quiz/start/) firing on load. Before this
 * endpoint existed, the FABM Quiz conversion only fired when a visitor
 * finished all nine questions and requested their email result -- so an ad
 * visitor who started the quiz and dropped off partway through was never
 * counted at all. Brian's decision 2026-08-21: the meaningful action worth
 * crediting is STARTING the quiz, not just the downstream email completion,
 * since every visitor who reaches /start/ from an ad has already engaged
 * with the educational tool. This fires the same funnel split used by the
 * Endo Quiz (see ../_google-ads.js): QUIZ_CONVERSION_ACTION_ID is the
 * primary action here, and /api/quiz/request now fires the secondary
 * QUIZ_EMAIL_CONVERSION_ACTION_ID on email capture. No body is parsed --
 * there is no user input here beyond IP and the request's own Cookie
 * header, and sendGoogleAdsConversion is a silent no-op when the gclid
 * cookie is absent, so organic/non-ad visitors correctly get { ok: true }
 * with nothing uploaded. Each conversion action is ONE_PER_CLICK, which
 * dedupes repeat fires WITHIN that action only (reloading /start/ won't
 * re-count for the same gclid) -- it does not dedupe across the two
 * distinct actions in this funnel (QUIZ_CONVERSION_ACTION_ID here,
 * QUIZ_EMAIL_CONVERSION_ACTION_ID on email capture), so a visitor who
 * completes the whole funnel can legitimately record up to two
 * conversions.
 */
import { log } from '../_log.js';
import { json, optionsResponse, checkRateLimit } from '../auth/_shared.js';
import { sendGoogleAdsConversion, QUIZ_CONVERSION_ACTION_ID } from '../_google-ads.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (!await checkRateLimit(env, `quiz-start:${ip}`, 10, 900)) {
      return json({ error: 'rate_limited' }, 429);
    }

    if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
      return json({ error: 'service_unavailable' }, 503);
    }

    sendGoogleAdsConversion(env, waitUntil, request.headers.get('Cookie') || '', QUIZ_CONVERSION_ACTION_ID);

    return json({ ok: true });
  } catch (err) {
    console.error('quiz start unexpected error:', err);
    log(env, waitUntil, 'quiz', 'start_fail', 'error', 'unexpected error', 0, 500);
    return json({ error: 'server_error' }, 500);
  }
}
