/**
 * GET /api/admin/revenue
 * Returns Stripe revenue metrics for the admin dashboard.
 * Requires superadmin session auth.
 *
 * Query params:
 *   ?period=7d|28d|90d (default: 28d)
 */
import Stripe from 'stripe';
import { json, optionsResponse, STRIPE_API_VERSION, requireSuperAdmin } from '../auth/_shared.js';
import { log } from '../_log.js';
import { tierFromPriceOrAmount } from '../community/_shared.js';

// Revenue data changes frequently enough to warrant a shorter cache than other admin endpoints.
// TODO: at scale (20K+ subs), replace the MRR for await loop with a webhook-maintained running total in KV.
const CACHE_TTL = 900;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
  try {
    // Session-based admin auth
    const auth = await requireSuperAdmin(request, env.DB);
    if (auth instanceof Response) return auth;

    if (!env.STRIPE_SECRET_KEY) return json({ ok: false, error: 'Stripe not configured' }, 500);

    const url = new URL(request.url);
    const period = url.searchParams.get('period') || '28d';
    const daysMap = { '7d': 7, '28d': 28, '90d': 90 };
    const days = daysMap[period] || 28;

    // Check KV cache (15 min)
    const cacheKey = `admin:revenue:${period}`;
    if (env.COMMUNITY_KV) {
      const cached = await env.COMMUNITY_KV.get(cacheKey, 'json');
      if (cached) return json({ ok: true, data: cached, cached: true });
    }

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: STRIPE_API_VERSION,
    });

    const now = Math.floor(Date.now() / 1000);
    const periodStart = now - (days * 86400);

    // MRR from active + trialing subscriptions (auto-paginate to avoid 100-item cap).
    // Two status-scoped loops are cheaper than status:'all' (which would also
    // paginate through canceled/incomplete/past_due subs we don't want to count) --
    // trialing donors from the Wix migration handoff are paying customers in every
    // meaningful sense and belong in MRR/tier counts alongside active ones.
    let mrr = 0;
    const TIER_ALLOWLIST = ['member', 'hero', 'superhero'];
    const tierCounts = { member: 0, hero: 0, superhero: 0, other: 0 };
    const tierMrr = { member: 0, hero: 0, superhero: 0, other: 0 };
    let totalActiveSubs = 0;
    let unknownPriced = 0;
    for (const status of ['active', 'trialing']) {
      for await (const sub of stripe.subscriptions.list({ status, limit: 100 })) {
        totalActiveSubs++;
        const monthlyAmount = sub.items.data.reduce((sum, item) => {
          if (item.price.unit_amount == null) {
            unknownPriced++;
            return sum;
          }
          let amount = item.price.unit_amount;
          if (item.price.recurring?.interval === 'year') amount = Math.round(amount / 12);
          return sum + amount;
        }, 0);
        mrr += monthlyAmount;
        const tier = tierFromPriceOrAmount(sub, env);
        const key = TIER_ALLOWLIST.includes(tier) ? tier : 'other';
        tierCounts[key]++;
        tierMrr[key] += monthlyAmount;
      }
    }

    // Count cancelled subs in period: bound server-side via Search API on canceled_at
    // (list + status:'canceled' has no created/canceled_at filter and would auto-paginate all-time)
    let cancelledCount = 0;
    for await (const sub of stripe.subscriptions.search({
      query: `status:'canceled' AND canceled_at>=${periodStart}`,
      limit: 100,
    })) {
      cancelledCount++;
    }

    // Charges in period: auto-paginate to avoid 100-item cap. Expand payment_intent
    // so one-time (non-invoice) charges can be split course-vs-donation via PI
    // metadata.type -- charge.metadata is NOT auto-copied from the PaymentIntent
    // that created it, so the expand is the only reliable in-band discriminator
    // (create-checkout.js and courses/enroll.js both set payment_intent_data.metadata.type).
    let donationTotal = 0;
    let donationCount = 0;
    let courseTotal = 0;
    let courseCount = 0;
    let subscriptionRevenue = 0;
    let subscriptionCharges = 0;
    const dailyRevenue = {};

    for await (const charge of stripe.charges.list({
      created: { gte: periodStart },
      limit: 100,
      expand: ['data.payment_intent'],
    })) {
      if (charge.status !== 'succeeded') continue;
      // Net of refunds -- a fully or partially refunded charge should not inflate
      // any revenue aggregate.
      const amount = charge.amount - (charge.amount_refunded || 0);
      const date = new Date(charge.created * 1000).toISOString().slice(0, 10);

      if (!dailyRevenue[date]) dailyRevenue[date] = { donations: 0, courses: 0, subscriptions: 0 };

      if (charge.invoice) {
        subscriptionRevenue += amount;
        subscriptionCharges++;
        dailyRevenue[date].subscriptions += amount;
      } else if (charge.payment_intent?.metadata?.type === 'course') {
        courseTotal += amount;
        courseCount++;
        dailyRevenue[date].courses += amount;
      } else {
        donationTotal += amount;
        donationCount++;
        dailyRevenue[date].donations += amount;
      }
    }

    // Daily timeline
    const timeline = Object.entries(dailyRevenue)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rev]) => ({
        date,
        donations: rev.donations / 100,
        courses: rev.courses / 100,
        subscriptions: rev.subscriptions / 100,
        total: (rev.donations + rev.courses + rev.subscriptions) / 100,
      }));

    const report = {
      mrr: mrr / 100,
      totalActiveSubs,
      tierCounts,
      tierMrr: {
        member: tierMrr.member / 100,
        hero: tierMrr.hero / 100,
        superhero: tierMrr.superhero / 100,
        other: tierMrr.other / 100,
      },
      unknownPriced,
      donations: { count: donationCount, total: donationTotal / 100 },
      courses: { count: courseCount, total: courseTotal / 100 },
      subscriptionRevenue: subscriptionRevenue / 100,
      subscriptionCharges,
      cancelledCount,
      totalRevenue: (donationTotal + courseTotal + subscriptionRevenue) / 100,
      timeline,
      fetchedAt: new Date().toISOString(),
    };

    if (env.COMMUNITY_KV) {
      await env.COMMUNITY_KV.put(cacheKey, JSON.stringify(report), { expirationTtl: CACHE_TTL });
    }

    return json({ ok: true, data: report, cached: false });
  } catch (err) {
    log(env, null, 'admin', 'revenue_error', 'error', err.message, 0, 502);
    return json({ ok: false, error: 'Failed to fetch revenue data' }, 502);
  }
}
