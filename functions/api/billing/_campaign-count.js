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
 * @returns {Promise<{count: number, complete: boolean, scannedPages: number|null}>}
 *   count: succeeded campaign gifts seen so far (never rejects; 0 on full failure).
 *   complete: false when the unindexed fallback scan hit MAX_FALLBACK_PAGES or the
 *     fallback itself errored -- count is a lower bound, not the true total, and
 *     callers must label it as partial rather than display it as a total.
 *   scannedPages: fallback pages walked (null when the indexed search path succeeded
 *     and no fallback ran).
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

  if (!searchFailed) {
    return { count, complete: true, scannedPages: null };
  }

  count = 0;
  const MAX_FALLBACK_PAGES = 50; // safety cap: bounds the unindexed full-account scan
  try {
    let cursor = undefined;
    let listHasMore = true;
    let pages = 0;
    while (listHasMore && pages < MAX_FALLBACK_PAGES) {
      const listParams = { limit: 100, expand: ['data.latest_charge'] };
      if (cursor) listParams.starting_after = cursor;
      const page = await stripe.paymentIntents.list(listParams);
      pages++;
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
    if (listHasMore && pages >= MAX_FALLBACK_PAGES) {
      console.error(`countCampaignGifts: fallback scan truncated at ${MAX_FALLBACK_PAGES} pages for campaign '${campaign}'; count may be incomplete`);
      return { count, complete: false, scannedPages: pages };
    }
    return { count, complete: true, scannedPages: pages };
  } catch {
    return { count: 0, complete: false, scannedPages: 0 };
  }
}
