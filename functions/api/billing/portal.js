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
  STRIPE_API_VERSION, SITE_URL,
} from '../auth/_shared.js';
import { log } from '../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    return await handlePortal(request, env);
  } catch (err) {
    log(env, waitUntil, 'billing', 'portal_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

async function handlePortal(request, env) {
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
    apiVersion: STRIPE_API_VERSION,
  });

  const origin = SITE_URL;
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${origin}/account`,
  });

  return json({ ok: true, url: portalSession.url });
}
