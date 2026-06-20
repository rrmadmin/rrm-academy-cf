/**
 * Shared helper: count net-of-refunds succeeded PaymentIntents for a campaign.
 * Used by fund-progress.js (KV cache writer) and fund-supporters.js (cold-KV fallback).
 *
 * Runs Stripe paymentIntents.search with pagination and refund-netting.
 * Falls back to paymentIntents.list + client-side filter when search fails.
 *
 * @param {Stripe} stripe  Configured Stripe client (already verified non-null by caller)
 * @param {string} campaign  Metadata campaign value, e.g. 'provider-directory'
 * @returns {Promise<number>}  Count of net-positive gifts (never rejects; returns 0 on full failure)
 */
export async function countCampaignGifts(stripe, campaign) {
  let count = 0;
  let searchFailed = false;

  try {
    let hasMore = true;
    let nextPage = undefined;
    while (hasMore) {
      const params = {
        query: `status:'succeeded' AND metadata['campaign']:'${campaign}'`,
        limit: 100,
        expand: ['data.latest_charge'],
      };
      if (nextPage) params.page = nextPage;
      const page = await stripe.paymentIntents.search(params);
      for (const pi of page.data) {
        const ch = pi.latest_charge;
        const refunded = (ch && typeof ch === 'object') ? (ch.amount_refunded || 0) : 0;
        const net = Math.max(0, (pi.amount_received ?? pi.amount) - refunded);
        if (net > 0) count++;
      }
      hasMore = page.has_more;
      if (hasMore && page.data.length > 0) {
        nextPage = page.next_page;
      } else {
        hasMore = false;
      }
    }
  } catch {
    searchFailed = true;
  }

  if (searchFailed) {
    count = 0;
    try {
      let cursor = undefined;
      let listHasMore = true;
      while (listHasMore) {
        const listParams = { limit: 100, expand: ['data.latest_charge'] };
        if (cursor) listParams.starting_after = cursor;
        const page = await stripe.paymentIntents.list(listParams);
        for (const pi of page.data) {
          if (pi.status === 'succeeded' && pi.metadata?.campaign === campaign) {
            const ch = pi.latest_charge;
            const refunded = (ch && typeof ch === 'object') ? (ch.amount_refunded || 0) : 0;
            const net = Math.max(0, (pi.amount_received ?? pi.amount) - refunded);
            if (net > 0) count++;
          }
        }
        listHasMore = page.has_more;
        if (listHasMore && page.data.length > 0) {
          cursor = page.data[page.data.length - 1].id;
        } else {
          listHasMore = false;
        }
      }
    } catch {
      return 0;
    }
  }

  return count;
}
