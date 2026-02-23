/**
 * POST /api/billing/portal
 * Creates a Stripe Billing Portal session and returns the URL.
 * Requires authentication (session cookie).
 *
 * Response: { ok: true, url: 'https://billing.stripe.com/...' }
 */
import Stripe from 'stripe';
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from '../auth/_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
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
    return json({ ok: false, error: 'No billing account found' }, 404);
  }

  // --- Create portal session ---
  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: '2024-12-18.acacia',
  });

  const origin = new URL(request.url).origin;
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${origin}/account`,
  });

  return json({ ok: true, url: portalSession.url });
}
