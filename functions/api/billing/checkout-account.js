/**
 * GET /api/billing/checkout-account?session_id=cs_...
 * Checks whether a D1 account exists for a Stripe checkout session's email.
 * Used by thank-you pages to show the right post-checkout message.
 *
 * Returns:
 *   { ok: true, accountExists: bool, needsPassword: bool }
 *
 * - accountExists + needsPassword  → auto-created account, check email for password link
 * - accountExists + !needsPassword → existing account, just log in
 * - !accountExists                 → no account yet (webhook may not have fired)
 *
 * Unauthenticated by design (fresh donors have no session cookie on the
 * thank-you redirect) — this is an account-existence oracle keyed on any
 * valid cs_ session id, which can leak via referrer headers/logs well after
 * checkout. Mitigated by: rate limiting (below), a hard 24h session-age
 * cutoff (thank-you pages poll within seconds of redirect; anything older
 * is refused with the same response as an unknown session id), and strict
 * session_id shape validation.
 */
import Stripe from 'stripe';
import { json, optionsResponse, checkRateLimit, STRIPE_API_VERSION } from '../auth/_shared.js';
import { log } from '../_log.js';

const SESSION_ID_RE = /^cs_[A-Za-z0-9_]+$/;
const MAX_SESSION_AGE_SECONDS = 24 * 60 * 60;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const stripeKey = env.STRIPE_SECRET_KEY;
    const db = env.DB;
    if (!stripeKey || !db) return json({ ok: false, error: 'Not configured' }, 500);

    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session_id');
    if (
      typeof sessionId !== 'string' ||
      sessionId.length > 200 ||
      !SESSION_ID_RE.test(sessionId)
    ) {
      return json({ ok: false, error: 'Invalid session_id' }, 400);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!await checkRateLimit(env, `checkout-acct:${ip}`, 5, 900)) {
      return json({ ok: false, error: 'Too many requests' }, 429);
    }

    const stripe = new Stripe(stripeKey, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: STRIPE_API_VERSION,
    });

    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
      if (err.code === 'resource_missing') {
        return json({ ok: false, error: 'Invalid session' }, 400);
      }
      return json({ ok: false, error: 'Payment service temporarily unavailable' }, 503);
    }

    const ageSeconds = Math.floor(Date.now() / 1000) - (checkoutSession.created || 0);
    if (!checkoutSession.created || ageSeconds > MAX_SESSION_AGE_SECONDS) {
      // Same response as a bogus/unknown session id — a stale-but-real cs_ id
      // (leaked via referrer/logs long after checkout) must not be
      // distinguishable from one that never existed.
      return json({ ok: false, error: 'Invalid session' }, 400);
    }

    const email = (checkoutSession.customer_details?.email || checkoutSession.customer_email || '').toLowerCase().trim();
    if (!email) {
      return json({ ok: true, accountExists: false, needsPassword: false });
    }

    let user = await db.prepare('SELECT id, hashed_password, google_id FROM user WHERE email = ? COLLATE NOCASE')
      .bind(email).first();

    // D1 replication lag: a just-created account may not be visible yet on the
    // thank-you page's first poll. One 500ms retry covers the typical lag window.
    if (!user) {
      await new Promise(r => setTimeout(r, 500));
      user = await db.prepare('SELECT id, hashed_password, google_id FROM user WHERE email = ? COLLATE NOCASE')
        .bind(email).first();
    }

    if (!user) {
      return json({ ok: true, accountExists: false, needsPassword: false });
    }

    const needsPassword = !user.hashed_password && !user.google_id;
    return json({ ok: true, accountExists: true, needsPassword });
  } catch (err) {
    log(env, waitUntil, 'billing', 'checkout_account_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
