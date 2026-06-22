import Stripe from 'stripe';
import { json, optionsResponse, checkRateLimit, STRIPE_API_VERSION } from '../auth/_shared.js';
import { log } from '../_log.js';

const CAMPAIGN = 'provider-directory';
const SESSION_ID_RE = /^cs_[A-Za-z0-9_]+$/;
const NOT_FOUND = { ok: true, found: false, displayName: null, seq: null };

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  if (
    typeof sessionId !== 'string' ||
    sessionId.length > 100 ||
    !SESSION_ID_RE.test(sessionId)
  ) {
    return json({ error: 'invalid_session_id' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await checkRateLimit(env, `supporter-badge:${ip}`, 5, 900)) {
    return json({ error: 'rate_limited' }, 429);
  }

  if (!env.STRIPE_SECRET_KEY || !env.DB) {
    log(env, waitUntil, 'billing', 'supporter_badge_misconfigured', 'error', 'missing binding', 0, 503);
    return json(NOT_FOUND);
  }

  let paymentIntentId;
  try {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: STRIPE_API_VERSION,
    });
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    paymentIntentId = session?.payment_intent;
  } catch (err) {
    log(env, waitUntil, 'billing', 'supporter_badge_stripe_error', 'error', err.message, 0, 502);
    return json(NOT_FOUND);
  }

  if (!paymentIntentId || typeof paymentIntentId !== 'string') {
    return json(NOT_FOUND);
  }

  try {
    const row = await env.DB.prepare(
      'SELECT display_name, gift_seq FROM supporter_recognition WHERE source_id = ? AND campaign = ?'
    ).bind(paymentIntentId, CAMPAIGN).first();

    if (!row) {
      return json(NOT_FOUND);
    }

    return json({ ok: true, found: true, displayName: row.display_name, seq: row.gift_seq });
  } catch (err) {
    log(env, waitUntil, 'billing', 'supporter_badge_db_error', 'error', err.message, 0, 500);
    return json(NOT_FOUND);
  }
}
