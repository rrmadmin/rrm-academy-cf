/**
 * GET /api/survey/count
 * Returns counts of endo self-survey takers across CF Pages (live D1) and
 * Wix-era PDF downloaders (rough estimate, pending exact reconciliation).
 * Public, edge-cached for 5 minutes. No auth required.
 *
 * `liveDistinct` = COUNT(DISTINCT email) from survey_identities (CF Pages era).
 * `liveSubmissions` = COUNT(*) from survey_identities (includes retakes).
 * `wixLegacyEstimate` = rough estimate of Wix RRM Academy members who
 *   signed up to download the legacy 3-tier endo self-survey PDF.
 *   Computed as (total Wix member import) - (~200 non-survey members).
 *   Pending exact count via Wix Members API (see docs/plans/backlog.md).
 * `total` = liveDistinct + wixLegacyEstimate (rounded; honest "more than" framing).
 */
import { json, optionsResponse } from '../auth/_shared.js';

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
};

// Wix-era PDF download cohort, rough estimate.
// Source: 5,983 total Wix members imported; ~200 are non-survey members
// (newsletter-only, course-only, etc.). Refine via Wix Members API.
const WIX_LEGACY_ESTIMATE = 5783;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.SURVEY_DB) {
    return json({ error: 'service_unavailable' }, 503);
  }

  let row;
  try {
    row = await env.SURVEY_DB.prepare(
      "SELECT COUNT(*) AS submissions, COUNT(DISTINCT email) AS distinct_takers, MAX(created_at) AS last_updated FROM survey_identities WHERE source LIKE 'endo-survey-v1%'"
    ).first();
  } catch (err) {
    console.error('[survey/count] query failed:', err);
    return json({ error: 'count_failed' }, 500);
  }

  const liveDistinct = row?.distinct_takers ?? 0;
  const liveSubmissions = row?.submissions ?? 0;
  const total = liveDistinct + WIX_LEGACY_ESTIMATE;

  return json(
    {
      total,
      liveDistinct,
      liveSubmissions,
      wixLegacyEstimate: WIX_LEGACY_ESTIMATE,
      lastUpdated: row?.last_updated ?? new Date().toISOString(),
      source: 'endo-survey-v1+ + wix-pdf-legacy-estimate',
    },
    200,
    CACHE_HEADERS
  );
}
