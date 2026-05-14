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
 */
import Stripe from 'stripe';
import { json, optionsResponse, checkRateLimit, STRIPE_API_VERSION } from '../auth/_shared.js';
import { log } from '../_log.js';

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
    if (!sessionId || !sessionId.startsWith('cs_')) {
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
    } catch (_err) {
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
