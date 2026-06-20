/**
 * Shared helper: count succeeded PaymentIntents for a campaign.
 * Used by fund-progress.js (KV cache writer) and fund-supporters.js (cold-KV fallback).
 *
 * Runs Stripe paymentIntents.search with pagination and refund-netting.
 * Falls back to paymentIntents.list + client-side filter when search fails.
 *
 * Count of succeeded campaign gifts; mirrors fund-progress.count (refunds are netted out
 * of dollars, not count).
 *
 * @param {Stripe} stripe  Configured Stripe client (already verified non-null by caller)
 * @param {string} campaign  Metadata campaign value, e.g. 'provider-directory'
 * @returns {Promise<number>}  Count of succeeded campaign gifts (never rejects; returns 0 on full failure)
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
        count++;
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
    } catch {
      return 0;
    }
  }

  return count;
}
