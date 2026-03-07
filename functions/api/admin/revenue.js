/**
 * GET /api/admin/revenue
 * Returns Stripe revenue metrics for the admin dashboard.
 * Requires superadmin session auth.
 *
 * Query params:
 *   ?period=7d|28d|90d (default: 28d)
 */
import Stripe from 'stripe';
import { json, STRIPE_API_VERSION, requireSuperAdmin } from '../auth/_shared.js';

export async function onRequestGet({ request, env }) {
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

  try {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: STRIPE_API_VERSION,
    });

    const now = Math.floor(Date.now() / 1000);
    const periodStart = now - (days * 86400);

    // Fetch in parallel: subscriptions, charges, recent cancellations
    const [activeSubs, charges, cancelledSubs] = await Promise.all([
      stripe.subscriptions.list({ status: 'active', limit: 100 }),
      stripe.charges.list({ created: { gte: periodStart }, limit: 100 }),
      stripe.subscriptions.list({ status: 'canceled', created: { gte: periodStart }, limit: 100 }),
    ]);

    // MRR from active subscriptions
    let mrr = 0;
    const tierCounts = { member: 0, hero: 0, superhero: 0, other: 0 };
    const tierMrr = { member: 0, hero: 0, superhero: 0, other: 0 };
    for (const sub of activeSubs.data) {
      const monthlyAmount = sub.items.data.reduce((sum, item) => {
        let amount = item.price.unit_amount || 0;
        if (item.price.recurring?.interval === 'year') amount = Math.round(amount / 12);
        return sum + amount;
      }, 0);
      mrr += monthlyAmount;
      const tier = sub.metadata?.tier || 'other';
      const key = tierCounts[tier] !== undefined ? tier : 'other';
      tierCounts[key]++;
      tierMrr[key] += monthlyAmount;
    }

    // Charges in period: separate donations vs subscriptions
    let donationTotal = 0;
    let donationCount = 0;
    let subscriptionRevenue = 0;
    let subscriptionCharges = 0;
    const dailyRevenue = {};

    for (const charge of charges.data) {
      if (charge.status !== 'succeeded') continue;
      const amount = charge.amount;
      const date = new Date(charge.created * 1000).toISOString().slice(0, 10);

      if (!dailyRevenue[date]) dailyRevenue[date] = { donations: 0, subscriptions: 0 };

      if (charge.invoice) {
        subscriptionRevenue += amount;
        subscriptionCharges++;
        dailyRevenue[date].subscriptions += amount;
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
        subscriptions: rev.subscriptions / 100,
        total: (rev.donations + rev.subscriptions) / 100,
      }));

    const report = {
      mrr: mrr / 100,
      totalActiveSubs: activeSubs.data.length,
      tierCounts,
      tierMrr: {
        member: tierMrr.member / 100,
        hero: tierMrr.hero / 100,
        superhero: tierMrr.superhero / 100,
        other: tierMrr.other / 100,
      },
      donations: { count: donationCount, total: donationTotal / 100 },
      subscriptionRevenue: subscriptionRevenue / 100,
      subscriptionCharges,
      cancelledCount: cancelledSubs.data.length,
      totalRevenue: (donationTotal + subscriptionRevenue) / 100,
      timeline,
      fetchedAt: new Date().toISOString(),
    };

    if (env.COMMUNITY_KV) {
      await env.COMMUNITY_KV.put(cacheKey, JSON.stringify(report), { expirationTtl: 900 });
    }

    return json({ ok: true, data: report, cached: false });
  } catch (err) {
    console.error('Revenue API error:', err.message);
    return json({ ok: false, error: 'Failed to fetch revenue data' }, 502);
  }
}
