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
  STRIPE_API_VERSION,
} from '../auth/_shared.js';
import { log } from '../_log.js';

function toUnix(isoString) {
  return Math.floor(new Date(isoString).getTime() / 1000);
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
    return json({ ok: true, subscription: null, donations: [], payments: [] });
  }

  // --- Default empty Stripe result ---
  let stripeDonations = [];
  let stripePayments = [];
  let subscription = null;

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
    const succeeded = charges.data.filter(c => c.status === 'succeeded');
    const mapCharge = c => ({
      amount: c.amount,
      date: c.created,
      receiptUrl: c.receipt_url || null,
      source: 'stripe',
    });
    stripeDonations = succeeded.filter(c => !c.invoice).map(mapCharge);
    stripePayments = succeeded.filter(c => !!c.invoice).map(mapCharge);

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
  try {
    const userId = session.userId;
    const email = user.email || '';
    const [wixSubRow, wixPayRows] = await Promise.all([
      db.prepare(
        'SELECT tier, status, amount_cents, next_expected_at FROM wix_subscription' +
        ' WHERE (user_id = ? OR email = ? COLLATE NOCASE) AND status = \'active\'' +
        ' AND migration_status NOT IN (\'stripe_active\', \'migrated\', \'fully_exited\')' +
        ' ORDER BY started_at DESC LIMIT 1'
      ).bind(userId, email).first(),
      db.prepare(
        'SELECT amount_cents, paid_at, receipt_number FROM wix_payment' +
        ' WHERE (user_id = ? OR email = ? COLLATE NOCASE) AND payment_status = \'PAID\'' +
        ' ORDER BY paid_at DESC LIMIT 50'
      ).bind(userId, email).all(),
    ]);

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
    if (!subscription) {
      const cancelledRow = await db.prepare(
        `SELECT tier, status, amount_cents, next_expected_at, last_order_at
           FROM wix_subscription
           WHERE (user_id = ? OR email = ? COLLATE NOCASE)
           AND migration_status NOT IN ('stripe_active', 'migrated', 'fully_exited')
           ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, COALESCE(last_order_at, started_at) DESC
           LIMIT 1`
      ).bind(userId, email).first();
      if (cancelledRow && cancelledRow.status !== 'active') {
        subscription = {
          tier: cancelledRow.tier,
          status: 'cancelled',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          source: 'wix',
          lastPaymentAt: cancelledRow.last_order_at || null,
        };
      }
    }

    wixDonations = (wixPayRows.results || []).map(p => ({
      amount: p.amount_cents,
      date: toUnix(p.paid_at),
      receiptUrl: null,
      receiptNumber: p.receipt_number || null,
      source: 'wix',
    }));
  } catch (err) {
    log(env, waitUntil, 'billing', 'wix_lookup_error', 'error', err.message, 0, 500);
    // Non-fatal: fall back to Stripe-only result
  }

  // --- Merge and sort donations ---
  const donations = [...stripeDonations, ...wixDonations].sort((a, b) => b.date - a.date);
  const payments = stripePayments;

  return json({ ok: true, subscription, donations, payments });
}
