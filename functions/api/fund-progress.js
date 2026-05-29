/**
 * GET /api/fund-progress
 * Returns fundraising progress for the provider-directory campaign.
 *
 * Response: { raised_cents, goal_cents, count, supporters }
 *
 * Queries Stripe for succeeded PaymentIntents with metadata campaign='provider-directory'.
 * Refunds are netted out via latest_charge.amount_refunded.
 * Result is cached in COMMUNITY_KV for 60 seconds to avoid hammering Stripe.
 * Missing STRIPE_SECRET_KEY -> 503 { error: 'service_unavailable' }.
 * Stripe API error -> 200 fail-soft { raised_cents: 0, goal_cents: 1000000, count: 0, supporters: 0 }
 * so the thermometer still renders.
 */
import { json, optionsResponse, checkRateLimit } from './auth/_shared.js';
import { log } from './_log.js';
import { getStripeClient } from './billing/_shared.js';

const GOAL_CENTS = 1000000;
const CAMPAIGN = 'provider-directory';
const KV_KEY = `fund-progress:${CAMPAIGN}`;
const KV_TTL = 60;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'service_unavailable' }, 503);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await checkRateLimit(env, `fund-progress:${ip}`, 30, 60)) {
    return json({ error: 'rate_limited' }, 429);
  }

  if (env.COMMUNITY_KV) {
    try {
      const cached = await env.COMMUNITY_KV.get(KV_KEY);
      if (cached) {
        return json(JSON.parse(cached));
      }
    } catch {
      // KV read failure -- fall through to Stripe
    }
  }

  let raised_cents = 0;
  let count = 0;

  try {
    const stripe = getStripeClient(env);
    let hasMore = true;
    let startingAfter = undefined;

    try {
      // Prefer search API (filters server-side by metadata)
      while (hasMore) {
        const params = {
          query: `status:'succeeded' AND metadata['campaign']:'${CAMPAIGN}'`,
          limit: 100,
          expand: ['data.latest_charge'],
        };
        if (startingAfter) params.page = startingAfter;
        const page = await stripe.paymentIntents.search(params);
        for (const pi of page.data) {
          const ch = pi.latest_charge;
          const refunded = (ch && typeof ch === 'object') ? (ch.amount_refunded || 0) : 0;
          raised_cents += Math.max(0, (pi.amount_received ?? pi.amount) - refunded);
          count++;
        }
        hasMore = page.has_more;
        if (hasMore && page.data.length > 0) {
          startingAfter = page.next_page;
        } else {
          hasMore = false;
        }
      }
    } catch (searchErr) {
      if (!searchErr.message?.includes('is not a valid')) {
        throw searchErr;
      }
      // Search unavailable: fall back to list + filter
      raised_cents = 0;
      count = 0;
      let cursor = undefined;
      let listHasMore = true;
      while (listHasMore) {
        const listParams = { limit: 100, starting_after: cursor, expand: ['data.latest_charge'] };
        const page = await stripe.paymentIntents.list(listParams);
        for (const pi of page.data) {
          if (pi.status === 'succeeded' && pi.metadata?.campaign === CAMPAIGN) {
            const ch = pi.latest_charge;
            const refunded = (ch && typeof ch === 'object') ? (ch.amount_refunded || 0) : 0;
            raised_cents += Math.max(0, (pi.amount_received ?? pi.amount) - refunded);
            count++;
          }
        }
        listHasMore = page.has_more;
        if (listHasMore && page.data.length > 0) {
          cursor = page.data[page.data.length - 1].id;
        } else {
          listHasMore = false;
        }
      }
    }
  } catch (err) {
    log(env, waitUntil, 'billing', 'fund_progress_stripe_error', 'error', err.message, 0, 0);
    return json({ raised_cents: 0, goal_cents: GOAL_CENTS, count: 0, supporters: 0 });
  }

  const result = { raised_cents, goal_cents: GOAL_CENTS, count, supporters: count };

  if (env.COMMUNITY_KV) {
    waitUntil(env.COMMUNITY_KV.put(KV_KEY, JSON.stringify(result), { expirationTtl: KV_TTL }).catch(() => {}));
  }

  return json(result);
}

export async function onRequestHead(context) {
  return onRequestGet(context);
}
