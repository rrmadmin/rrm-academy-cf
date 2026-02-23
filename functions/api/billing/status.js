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
} from '../auth/_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
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
    return json({ ok: true, subscription: null });
  }

  // --- Query Stripe for active subscriptions ---
  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: '2024-12-18.acacia',
  });

  const subscriptions = await stripe.subscriptions.list({
    customer: user.stripe_customer_id,
    status: 'all',
    limit: 1,
    expand: ['data.items.data.price'],
  });

  if (!subscriptions.data.length) {
    return json({ ok: true, subscription: null });
  }

  const sub = subscriptions.data[0];
  const price = sub.items.data[0]?.price;

  return json({
    ok: true,
    subscription: {
      tier: price?.nickname || 'Member',
      status: sub.status,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  });
}
