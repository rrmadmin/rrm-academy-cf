/**
 * GET /api/billing/status
 * Returns the logged-in user's subscription status from Stripe.
 * Requires authentication (session cookie).
 *
 * Response:
 *   { ok: true, subscription: null }  — no active subscription
 *   { ok: true, subscription: { tier, status, currentPeriodEnd, cancelAtPeriodEnd } }
 */
import Stripe from 'stripe';
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
  STRIPE_API_VERSION,
} from '../auth/_shared.js';
import { log } from '../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    return await handleStatus(request, env, waitUntil);
  } catch (err) {
    log(env, waitUntil, 'billing', 'status_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

async function handleStatus(request, env, waitUntil) {
  const db = env.DB;
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);
  if (!stripeKey) return json({ ok: false, error: 'Payments not configured' }, 500);

  // --- Auth check ---
  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(db, sessionId);
  if (!session) {
    return json({ ok: false, error: 'Not authenticated' }, 401);
  }

  // --- Get user's stripe_customer_id ---
  const user = await db.prepare('SELECT stripe_customer_id FROM user WHERE id = ?')
    .bind(session.userId).first();
  if (!user || !user.stripe_customer_id) {
    return json({ ok: true, subscription: null, donations: [], payments: [] });
  }

  // --- Query Stripe for subscriptions + charges in parallel ---
  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: STRIPE_API_VERSION,
  });

  let subscriptions, charges;
  try {
    [subscriptions, charges] = await Promise.all([
      stripe.subscriptions.list({
        customer: user.stripe_customer_id,
        status: 'all',
        limit: 10,
        expand: ['data.items.data.price'],
      }),
      stripe.charges.list({
        customer: user.stripe_customer_id,
        limit: 50,
      }),
    ]);
  } catch (err) {
    if (err.code === 'resource_missing') {
      return json({ ok: true, subscription: null, donations: [], payments: [] });
    }
    log(env, waitUntil, 'billing', 'status_error', 'error', `stripe list: ${err.message}`, 0, 503);
    return json({ ok: false, error: 'Payment service temporarily unavailable. Please try again.' }, 503);
  }

  // --- Build charge lists ---
  const succeeded = charges.data.filter(c => c.status === 'succeeded');
  const mapCharge = c => ({
    amount: c.amount,
    date: c.created,
    receiptUrl: c.receipt_url || null,
  });
  const donations = succeeded.filter(c => !c.invoice).map(mapCharge);
  const payments = succeeded.filter(c => !!c.invoice).map(mapCharge);

  // --- Build subscription ---
  let subscription = null;
  if (subscriptions.data.length) {
    const displayable = new Set(['active', 'trialing', 'past_due', 'incomplete']);
    const sub = subscriptions.data.find(s => displayable.has(s.status));
    if (!sub) {
      return json({ ok: true, subscription: null, donations, payments });
    }
    const price = sub.items.data[0]?.price;

    const priceToTier = {};
    if (env.STRIPE_PRICE_MEMBER) priceToTier[env.STRIPE_PRICE_MEMBER] = 'member';
    if (env.STRIPE_PRICE_HERO) priceToTier[env.STRIPE_PRICE_HERO] = 'hero';
    if (env.STRIPE_PRICE_SUPERHERO) priceToTier[env.STRIPE_PRICE_SUPERHERO] = 'superhero';

    subscription = {
      tier: priceToTier[price?.id] || price?.nickname || 'Member',
      status: sub.status,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  }

  return json({ ok: true, subscription, donations, payments });
}
