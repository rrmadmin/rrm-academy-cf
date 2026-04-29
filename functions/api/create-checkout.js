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
import { sendGA4Event } from './_ga4.js';
import { classifySource, extractUtm, getClientId, deriveSessionId } from './_ga4-source.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    return await handleCheckout(request, env, waitUntil);
  } catch (err) {
    console.error('create-checkout error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

async function handleCheckout(request, env, waitUntil) {
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
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  const { mode, amount, tier } = body;
  const entry_referrer = typeof body.entry_referrer === 'string' ? body.entry_referrer.slice(0, 2048) : undefined;
  const entry_url = typeof body.entry_url === 'string' ? body.entry_url.slice(0, 2048) : undefined;

  if (mode !== 'payment' && mode !== 'subscription') {
    return json({ ok: false, error: 'Invalid mode — use "payment" or "subscription"' }, 400);
  }

  const canaryToken = request.headers.get('X-Canary-Token');
  const isCanary = env.CANARY_SECRET && canaryToken === env.CANARY_SECRET;

  if (!isCanary) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(`checkout:${ip}`)) {
      return json({ ok: false, error: 'Too many requests — try again later' }, 429);
    }
  }

  // --- Resolve logged-in user (optional) ---
  const db = env.DB;
  if (!db) {
    console.error('DB binding missing -- cannot resolve user for checkout');
    return json({ ok: false, error: 'Internal error' }, 500);
  }
  let userEmail = null;
  let userId = null;
  let stripeCustomerId = null;
  {
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (session) {
      const user = await db.prepare('SELECT id, email, stripe_customer_id FROM user WHERE id = ?')
        .bind(session.userId).first();
      if (user) {
        userEmail = user.email;
        userId = user.id;
        stripeCustomerId = user.stripe_customer_id;
        if (!stripeCustomerId && userEmail) {
          try {
            const customer = await stripe.customers.create({ email: userEmail, metadata: { user_id: userId } });
            stripeCustomerId = customer.id;
            await db.prepare('UPDATE user SET stripe_customer_id = ? WHERE id = ?')
              .bind(stripeCustomerId, userId).run();
          } catch {
            stripeCustomerId = null;
          }
        }
      }
    }
  }

  const origin = SITE_URL;

  // Use the browser's original entry referrer/URL (passed in POST body) for
  // source attribution. The request's own Referer is always rrmacademy.org (self-referral).
  const referrer = entry_referrer || '';
  const landingUrl = entry_url || '';
  const utmParams = extractUtm(landingUrl);
  const { source, medium } = classifySource(referrer);
  const gaSource = utmParams.utm_source || source;
  const gaMedium = utmParams.utm_medium || medium;
  const gaCampaign = utmParams.utm_campaign || '';

  // Store client_id + session_id so webhook can replay the real user identity
  const clientId = await getClientId(request);
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const sessionId = await deriveSessionId(clientId, dateStr);

  // --- One-time donation ---
  if (mode === 'payment') {
    const cents = Number(amount);
    if (!Number.isInteger(cents) || cents < 500) {
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
      success_url: `${origin}/donate/thank-you/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/donate/`,
    };

    if (stripeCustomerId) {
      sessionParams.customer = stripeCustomerId;
    } else {
      sessionParams.customer_creation = 'always';
      if (userEmail) sessionParams.customer_email = userEmail;
    }
    if (userId) sessionParams.client_reference_id = userId;
    sessionParams.metadata = {
      ...(sessionParams.metadata || {}),
      type: 'donation',
      ga_source: gaSource,
      ga_medium: gaMedium,
      ga_client_id: clientId,
      ga_session_id: String(sessionId),
      ...(gaCampaign && { ga_campaign: gaCampaign }),
    };

    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.create(sessionParams);
    } catch {
      return json({ ok: false, error: 'Payment service temporarily unavailable. Please try again.' }, 503);
    }
    waitUntil(sendGA4Event(env, request, 'begin_checkout', {
      page_location: entry_url || request.headers.get('Referer') || SITE_URL,
      currency: 'USD', value: cents / 100, items: [{ item_name: 'Donation' }],
    }).catch(() => {}));
    return json({ ok: true, url: checkoutSession.url });
  }

  // --- Recurring membership ---
  if (mode === 'subscription') {
    // --- Wix migration: validate optional wix_sub_id input ---
    const wixSubIdInput = body.wix_sub_id;
    if (wixSubIdInput !== undefined && wixSubIdInput !== null) {
      if (typeof wixSubIdInput !== 'string' || wixSubIdInput.length > 100 ||
          !/^wxs_[a-z0-9_-]+$/i.test(wixSubIdInput)) {
        return json({ ok: false, error: 'Invalid wix_sub_id' }, 400);
      }
    }
    const wixSubId = wixSubIdInput || null;

    // --- Layer 3: look up pending Wix subscription (feature-flagged) ---
    const stucV2 = env.STUC_MIGRATION_UX_V2 === 'true';
    let wixLookup = null;
    if (stucV2 && env.DB && (wixSubId || userEmail)) {
      try {
        wixLookup = await env.DB.prepare(
          "SELECT wix_subscription_id, tier, amount_cents, next_expected_at, status, migration_status " +
          "FROM wix_subscription " +
          "WHERE (wix_subscription_id = ? OR email = ? COLLATE NOCASE) " +
          "  AND status = 'active' " +
          "  AND migration_status = 'pending' " +
          "ORDER BY started_at DESC " +
          "LIMIT 1"
        ).bind(wixSubId, userEmail || '').first();
      } catch {
        env.EVENTS?.writeDataPoint({
          blobs: ['billing', 'stuc-migration', 'lookup-error', '', ''],
          indexes: ['stuc-migration-lookup-error'],
        });
        wixLookup = null;
      }
    }

    // --- Migration: atomic write-lock + off-amount detection + trial_end clamp ---
    let useCustomAmount = false;
    let trialEndUnix = null;
    let migrationMetadata = {};

    if (wixLookup) {
      // Off-amount detection: reject BEFORE acquiring the lock so a 412 does not
      // hold the 15-min mutex. A donor who sees the off-amount prompt and re-POSTs
      // with acknowledge_off_amount:true must be able to acquire the lock on the
      // second request -- if we locked first they'd hit 409 instead.
      const STANDARD_CENTS = new Set([900, 1900, 9900]);
      if (!STANDARD_CENTS.has(wixLookup.amount_cents) && body.acknowledge_off_amount !== true) {
        return json({
          ok: false,
          error: 'off_amount',
          amount_cents: wixLookup.amount_cents,
          standard_tiers: [
            { tier: 'member',    amount_cents: 900 },
            { tier: 'hero',      amount_cents: 1900 },
            { tier: 'superhero', amount_cents: 9900 },
          ],
        }, 412);
      }
      useCustomAmount = !STANDARD_CENTS.has(wixLookup.amount_cents);

      // Atomic write-lock with 15-min TTL — only acquired for requests we're
      // forwarding to Stripe (off-amount rejection has already been handled above).
      let lockResult;
      try {
        lockResult = await env.DB.prepare(
          "UPDATE wix_subscription " +
          "SET migration_handoff_started_at = strftime('%s','now') " +
          "WHERE wix_subscription_id = ? " +
          "  AND (migration_handoff_started_at IS NULL " +
          "       OR migration_handoff_started_at < strftime('%s','now') - 900)"
        ).bind(wixLookup.wix_subscription_id).run();
      } catch {
        lockResult = { meta: { changes: 1 } };
      }
      if ((lockResult?.meta?.changes ?? 0) === 0) {
        return json({ ok: false, error: 'migration_in_progress' }, 409);
      }

      // trial_end clamp: must be at least 1 day out, at most ~2 years out
      const nowSec = Math.floor(Date.now() / 1000);
      const trialEndCandidate = wixLookup.next_expected_at
        ? Math.floor(new Date(wixLookup.next_expected_at).getTime() / 1000)
        : null;
      if (
        Number.isFinite(trialEndCandidate) &&
        trialEndCandidate > nowSec + 86400 &&
        trialEndCandidate < nowSec + 730 * 86400
      ) {
        trialEndUnix = trialEndCandidate;
      } else if (trialEndCandidate !== null) {
        env.EVENTS?.writeDataPoint({
          blobs: ['billing', 'stuc-migration', 'trial-end-out-of-range', wixLookup.wix_subscription_id, String(trialEndCandidate)],
          indexes: ['trial-end-out-of-range'],
        });
      }

      migrationMetadata = {
        wix_subscription_id: wixLookup.wix_subscription_id,
        migration_handoff: 'true',
      };
    } else if (stucV2) {
      env.EVENTS?.writeDataPoint({
        blobs: ['billing', 'stuc-migration', 'cold-checkout', userEmail || 'anon', wixSubId || ''],
        indexes: ['cold-checkout'],
      });
    }

    // --- Tier resolution: fall back to wixLookup.tier when no tier sent ---
    let effectiveTier = tier;
    if (!effectiveTier && wixLookup) effectiveTier = wixLookup.tier;
    if (useCustomAmount && !effectiveTier) effectiveTier = 'member';

    const priceMap = {
      member: env.STRIPE_PRICE_MEMBER,
      hero: env.STRIPE_PRICE_HERO,
      superhero: env.STRIPE_PRICE_SUPERHERO,
    };
    const priceId = Object.hasOwn(priceMap, effectiveTier) ? priceMap[effectiveTier] : undefined;
    if (!priceId) {
      return json({ ok: false, error: 'Invalid tier' }, 400);
    }
    // Guard: reject test-mode price IDs when using a live key
    if (stripeKey.startsWith('sk_live_') && priceId.includes('_test_')) {
      console.error(`BLOCKED: test-mode price ID for tier "${effectiveTier}": ${priceId}`);
      return json({ ok: false, error: 'Payments not configured' }, 500);
    }

    // Guard: if logged-in user already has an active/trialing/past_due subscription, don't create a new one
    if (stripeCustomerId) {
      const existing = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: 'all',
        limit: 10,
      });
      const blocking = existing.data.find(s =>
        s.status === 'active' || s.status === 'trialing' || s.status === 'past_due' || s.status === 'incomplete'
      );
      if (blocking) {
        const msg = blocking.status === 'past_due'
          ? 'You have a membership with a payment issue. Please update your payment method from your account page.'
          : blocking.status === 'incomplete'
            ? 'You have a pending membership checkout. Please complete or cancel it before starting a new one.'
            : 'You already have an active membership. You can change or cancel it from your account page.';
        return json({ ok: false, error: msg, redirect: '/account/' }, 409);
      }
    }

    // --- Build line_items: use price_data for off-amount donors ---
    const lineItems = useCustomAmount && wixLookup
      ? [{
          price_data: {
            currency: 'usd',
            product_data: { name: `Save the Uterus Club ($${(wixLookup.amount_cents / 100).toFixed(0)}/month)` },
            unit_amount: wixLookup.amount_cents,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        }]
      : [{ price: priceId, quantity: 1 }];

    const sessionParams = {
      mode: 'subscription',
      line_items: lineItems,
      success_url: `${origin}/save-the-uterus-club/thank-you/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/save-the-uterus-club/`,
      metadata: { tier: effectiveTier },
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
    sessionParams.metadata = {
      ...sessionParams.metadata,
      ...migrationMetadata,
      ga_source: gaSource,
      ga_medium: gaMedium,
      ga_client_id: clientId,
      ga_session_id: String(sessionId),
      ...(gaCampaign && { ga_campaign: gaCampaign }),
    };

    // Carry migration metadata into subscription_data so webhook can read it
    if (Object.keys(migrationMetadata).length > 0) {
      sessionParams.subscription_data = {
        ...(trialEndUnix ? { trial_end: trialEndUnix } : {}),
        metadata: migrationMetadata,
      };
    }

    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.create(sessionParams);
    } catch {
      return json({ ok: false, error: 'Payment service temporarily unavailable. Please try again.' }, 503);
    }
    const tierValueMap = { member: 10, hero: 25, superhero: 50 };
    waitUntil(sendGA4Event(env, request, 'begin_checkout', {
      page_location: entry_url || request.headers.get('Referer') || SITE_URL,
      currency: 'USD', value: tierValueMap[effectiveTier] ?? 0, items: [{ item_name: `STUC ${effectiveTier}` }],
    }).catch(() => {}));
    return json({ ok: true, url: checkoutSession.url });
  }

  return json({ ok: false, error: 'Invalid mode — use "payment" or "subscription"' }, 400);
}
