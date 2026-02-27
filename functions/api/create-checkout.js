/**
 * POST /api/create-checkout
 * Creates a Stripe Checkout Session for one-time donations or recurring memberships.
 *
 * Body:
 *   { mode: 'payment' | 'subscription', amount?: number, tier?: 'member' | 'hero' | 'superhero' }
 *
 * - mode: 'payment'      → one-time donation, requires `amount` (cents, min $5)
 * - mode: 'subscription'  → recurring membership, requires `tier`
 *
 * If user is logged in (session cookie), pre-fills email and sets client_reference_id.
 * No login required — anonymous checkout is supported.
 */
import Stripe from 'stripe';
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, checkRateLimit,
  STRIPE_API_VERSION, SITE_URL,
} from './auth/_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  try {
    return await handleCheckout(request, env);
  } catch (err) {
    console.error('create-checkout error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

async function handleCheckout(request, env) {
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json({ ok: false, error: 'Payments not configured' }, 500);

  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: STRIPE_API_VERSION,
  });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { mode, amount, tier } = body;

  if (mode !== 'payment' && mode !== 'subscription') {
    return json({ ok: false, error: 'Invalid mode — use "payment" or "subscription"' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(`checkout:${ip}`)) {
    return json({ ok: false, error: 'Too many requests — try again later' }, 429);
  }

  // --- Resolve logged-in user (optional) ---
  const db = env.DB;
  let userEmail = null;
  let userId = null;
  let stripeCustomerId = null;
  if (db) {
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (session) {
      const user = await db.prepare('SELECT id, email, stripe_customer_id FROM user WHERE id = ?')
        .bind(session.userId).first();
      if (user) {
        userEmail = user.email;
        userId = user.id;
        stripeCustomerId = user.stripe_customer_id;
      }
    }
  }

  const origin = SITE_URL;

  // --- One-time donation ---
  if (mode === 'payment') {
    const cents = parseInt(amount, 10);
    if (!cents || cents < 500) {
      return json({ ok: false, error: 'Minimum donation is $5' }, 400);
    }
    if (cents > 99999900) {
      return json({ ok: false, error: 'Amount too large' }, 400);
    }

    const sessionParams = {
      mode: 'payment',
      submit_type: 'donate',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Donation to RRM Foundation' },
          unit_amount: cents,
        },
        quantity: 1,
      }],
      success_url: `${origin}/donate/thank-you?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/donate`,
    };

    if (stripeCustomerId) {
      sessionParams.customer = stripeCustomerId;
    } else {
      sessionParams.customer_creation = 'always';
      if (userEmail) sessionParams.customer_email = userEmail;
    }
    if (userId) sessionParams.client_reference_id = userId;

    const checkoutSession = await stripe.checkout.sessions.create(sessionParams);
    return json({ ok: true, url: checkoutSession.url });
  }

  // --- Recurring membership ---
  if (mode === 'subscription') {
    const priceMap = {
      member: env.STRIPE_PRICE_MEMBER,
      hero: env.STRIPE_PRICE_HERO,
      superhero: env.STRIPE_PRICE_SUPERHERO,
    };
    const priceId = priceMap[tier];
    if (!priceId) {
      return json({ ok: false, error: 'Invalid tier' }, 400);
    }
    // Guard: reject test-mode price IDs when using a live key
    if (stripeKey.startsWith('sk_live_') && priceId.includes('test')) {
      console.error(`BLOCKED: test-mode price ID for tier "${tier}": ${priceId}`);
      return json({ ok: false, error: 'Payments not configured' }, 500);
    }

    // Guard: if logged-in user already has an active subscription, don't create a new one
    if (stripeCustomerId) {
      const existing = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: 'active',
        limit: 1,
      });
      if (existing.data.length > 0) {
        return json({
          ok: false,
          error: 'You already have an active membership. You can change or cancel it from your account page.',
          redirect: '/account',
        }, 409);
      }
    }

    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/save-the-uterus-club/thank-you?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/save-the-uterus-club`,
      metadata: { tier },
      custom_text: {
        submit: { message: 'Your monthly donation supports evidence-based reproductive health education through the RRM Foundation, a 501(c)(3) nonprofit.' },
      },
    };

    if (stripeCustomerId) {
      sessionParams.customer = stripeCustomerId;
    } else if (userEmail) {
      sessionParams.customer_email = userEmail;
    }
    if (userId) sessionParams.client_reference_id = userId;

    const checkoutSession = await stripe.checkout.sessions.create(sessionParams);
    return json({ ok: true, url: checkoutSession.url });
  }

  return json({ ok: false, error: 'Invalid mode — use "payment" or "subscription"' }, 400);
}
