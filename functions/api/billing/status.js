/**
 * GET /api/billing/status
 * Returns the logged-in user's subscription status from Stripe and/or Wix.
 * Requires authentication (session cookie).
 *
 * Response:
 *   { ok: true, subscription: null }  — no active subscription
 *   { ok: true, subscription: { tier, status, currentPeriodEnd, cancelAtPeriodEnd, source } }
 *   source is 'stripe' or 'wix'; UI uses this to route Manage Billing correctly.
 */
import Stripe from 'stripe';
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
  checkRateLimit, STRIPE_API_VERSION,
} from '../auth/_shared.js';
import { log } from '../_log.js';

function toUnix(isoString) {
  const t = new Date(isoString).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

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

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await checkRateLimit(env, `billing-status:${ip}`, 30, 900)) {
    return json({ ok: false, error: 'Too many requests — try again later' }, 429);
  }

  // --- Auth check ---
  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(db, sessionId);
  if (!session) {
    return json({ ok: false, error: 'Not authenticated' }, 401);
  }

  // --- Get user's stripe_customer_id and email ---
  const user = await db.prepare('SELECT stripe_customer_id, email FROM user WHERE id = ?')
    .bind(session.userId).first();
  if (!user) {
    return json({ ok: true, subscription: null, donations: [], payments: [], hasMore: false });
  }

  // --- Default empty Stripe result ---
  let stripeDonations = [];
  let stripePayments = [];
  let subscription = null;
  let chargesHasMore = false;
  let wixPaymentsHasMore = false;

  if (user.stripe_customer_id) {
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
        // customer deleted from Stripe — fall through to Wix lookup
        subscriptions = { data: [] };
        charges = { data: [] };
      } else {
        log(env, waitUntil, 'billing', 'status_error', 'error', `stripe list: ${err.message}`, 0, 503);
        return json({ ok: false, error: 'Payment service temporarily unavailable. Please try again.' }, 503);
      }
    }

    // --- Build Stripe charge lists ---
    // Fully-refunded charges are excluded entirely — the account UI's
    // renderHistoryList() has no refund affordance, so a refunded donation
    // would otherwise still read as a completed one. Partial refunds
    // (amount_refunded > 0, refunded === false) still display.
    chargesHasMore = charges.has_more === true;
    const succeeded = charges.data.filter(c => c.status === 'succeeded' && !c.refunded);
    const mapCharge = c => ({
      amount: c.amount,
      date: c.created,
      receiptUrl: c.receipt_url || null,
      source: 'stripe',
    });
    // One-time (non-invoice) charges are donations UNLESS stamped as a course
    // purchase — create-checkout.js sets payment_intent_data.metadata.type
    // to 'donation' for donations and courses/enroll.js sets it to 'course'
    // for one-time course purchases; Stripe copies PI metadata onto the
    // resulting charge, so it's a reliable discriminator here.
    const isCoursePurchase = c => c.metadata?.type === 'course';
    stripeDonations = succeeded.filter(c => !c.invoice && !isCoursePurchase(c)).map(mapCharge);
    stripePayments = succeeded.filter(c => !!c.invoice || isCoursePurchase(c)).map(mapCharge);

    // --- Build Stripe subscription ---
    if (subscriptions.data.length) {
      const displayable = new Set(['active', 'trialing', 'past_due', 'incomplete']);
      const sub = subscriptions.data.find(s => displayable.has(s.status));
      if (sub) {
        const price = sub.items.data[0]?.price;

        const priceToTier = {};
        if (env.STRIPE_PRICE_MEMBER) priceToTier[env.STRIPE_PRICE_MEMBER] = 'member';
        if (env.STRIPE_PRICE_HERO) priceToTier[env.STRIPE_PRICE_HERO] = 'hero';
        if (env.STRIPE_PRICE_SUPERHERO) priceToTier[env.STRIPE_PRICE_SUPERHERO] = 'superhero';

        const mappedTier = priceToTier[price?.id] ||
          (sub.metadata?.tier_custom === '1' ? 'custom' : null) ||
          price?.nickname ||
          null;
        subscription = {
          tier: mappedTier,
          status: sub.status,
          currentPeriodEnd: sub.current_period_end,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          source: 'stripe',
          ...(sub.metadata?.tier_custom === '1' && sub.items.data[0]?.price?.unit_amount != null
            ? { amount: sub.items.data[0].price.unit_amount }
            : {}),
        };
      }
    }
  }

  // --- Query Wix tables in parallel ---
  let wixDonations = [];
  let wixPayments = [];
  let wixLookupFailed = false;
  try {
    const userId = session.userId;
    const email = user.email || '';
    const [wixSubRow, wixPayRows, cancelledRow] = await Promise.all([
      db.prepare(
        'SELECT tier, status, amount_cents, next_expected_at FROM wix_subscription' +
        ' WHERE (user_id = ? OR email = ? COLLATE NOCASE) AND status = \'active\'' +
        ' AND migration_status NOT IN (\'stripe_active\', \'migrated\', \'fully_exited\')' +
        ' AND COALESCE(next_expected_at, datetime(last_order_at, \'+31 days\')) >= datetime(\'now\', \'-7 days\')' +
        ' ORDER BY started_at DESC LIMIT 1'
      ).bind(userId, email).first(),
      db.prepare(
        'SELECT amount_cents, paid_at, receipt_number, is_donation FROM wix_payment' +
        ' WHERE (user_id = ? OR email = ? COLLATE NOCASE) AND payment_status = \'PAID\'' +
        ' ORDER BY paid_at DESC LIMIT 51'
      ).bind(userId, email).all(),
      db.prepare(
        `SELECT tier, status, amount_cents, next_expected_at, last_order_at
           FROM wix_subscription
           WHERE (user_id = ? OR email = ? COLLATE NOCASE)
           AND migration_status NOT IN ('stripe_active', 'migrated', 'fully_exited')
           ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, COALESCE(last_order_at, started_at) DESC
           LIMIT 1`
      ).bind(userId, email).first(),
    ]);

    const wixPayResults = wixPayRows.results || [];
    wixPaymentsHasMore = wixPayResults.length > 50;
    const mapWixPay = p => ({
      amount: p.amount_cents,
      date: toUnix(p.paid_at),
      receiptUrl: null,
      receiptNumber: p.receipt_number || null,
      source: 'wix',
    });
    // is_donation = 0 for STUC course/product purchases synced from Wix —
    // route those into wixPayments so they stop appearing as donations.
    const wixPageResults = wixPayResults.slice(0, 50);
    wixDonations = wixPageResults.filter(p => p.is_donation === 1).map(mapWixPay);
    wixPayments = wixPageResults.filter(p => p.is_donation !== 1).map(mapWixPay);

    // Surface Wix subscription only when Stripe has none
    if (!subscription && wixSubRow) {
      subscription = {
        tier: wixSubRow.tier,
        status: wixSubRow.status,
        currentPeriodEnd: wixSubRow.next_expected_at ? toUnix(wixSubRow.next_expected_at) : null,
        cancelAtPeriodEnd: false,
        source: 'wix',
        amount: wixSubRow.amount_cents,
      };
    }

    // Surface most-recent cancelled Wix sub when no active sub exists — enables welcome-back UI
    if (!subscription && cancelledRow && cancelledRow.status !== 'active') {
      subscription = {
        tier: cancelledRow.tier,
        status: 'cancelled',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        source: 'wix',
        lastPaymentAt: cancelledRow.last_order_at || null,
      };
    }
  } catch (err) {
    wixLookupFailed = true;
    log(env, waitUntil, 'billing', 'wix_lookup_error', 'error', err.message, 0, 500);
    // Non-fatal only when Stripe already has a subscription or charges to fall back on
  }

  if (wixLookupFailed && !subscription && !stripeDonations.length && !stripePayments.length) {
    return json({ ok: false, error: 'Service temporarily unavailable. Please try again.' }, 503);
  }

  // --- Merge, sort, and truncate to a stable page size ---
  const PAGE_SIZE = 50;
  const mergedDonations = [...stripeDonations, ...wixDonations].sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity));
  const mergedPayments = [...stripePayments, ...wixPayments].sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity));
  const donations = mergedDonations.slice(0, PAGE_SIZE);
  const payments = mergedPayments.slice(0, PAGE_SIZE);
  const hasMore = chargesHasMore || wixPaymentsHasMore ||
    mergedDonations.length > PAGE_SIZE || mergedPayments.length > PAGE_SIZE;

  return json({ ok: true, subscription, donations, payments, hasMore });
}
