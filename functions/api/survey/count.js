/**
 * GET /api/survey/count
 * Returns counts of endo self-survey takers across three cohorts. Public,
 * edge-cached for 5 minutes. No auth required.
 *
 * `liveDistinct`      = COUNT(DISTINCT email) from survey_identities (CF Pages era).
 * `liveSubmissions`   = COUNT(*) from survey_identities (includes retakes).
 * `sqspLegacyExact`   = Squarespace-era PDF download cohort (Sept 2023 - Jun 2024).
 *                       Exact count: 1,810 submissions, 1,512 distinct emails.
 *                       Source: Endo Self Survey Downloads on Squarespace CSV.
 *                       Cross-check: 1,504 of 1,512 already in rrm-auth.contact
 *                       (1,165 via source='import'); 8 not in contact at all.
 * `wixLegacyEstimate` = Wix-era PDF download cohort (Jun 2024 - Feb 2026), rough
 *                       estimate. Prior estimate of 5,783 (= 5,983 Wix members -
 *                       ~200 non-survey) implicitly included Squarespace migrants.
 *                       Subtracting the Squarespace exact gives Wix-only estimate.
 *                       Pending exact reconciliation via Wix Members API
 *                       (see docs/plans/backlog.md).
 * `total`             = liveDistinct + sqspLegacyExact + wixLegacyEstimate
 *                       (honest "more than" framing; displayed floor stays ~7,000).
 */
import { json, optionsResponse } from '../auth/_shared.js';

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
};

// Squarespace-era PDF download cohort (Sept 2023 - Jun 2024). Exact count.
// Source: /Users/brian/Downloads/Endo Self Survey Downloads on Squarespace - Sheet1 (1).csv
// 1,810 download submissions, 1,512 distinct emails. Platform was sqsp -> wix -> cf.
const SQSP_LEGACY_EXACT = 1512;

// Wix-era PDF download cohort (Jun 2024 - Feb 2026), rough estimate.
// Prior estimate of 5,783 (= 5,983 Wix members - ~200 non-survey) implicitly
// included Squarespace migrants. Cross-check against rrm-auth.contact showed
// 1,504 of 1,512 Squarespace emails were already in contact (1,165 via
// source='import'). Subtracting the Squarespace exact gives Wix-only estimate.
// Refine via Wix Members API. See docs/plans/backlog.md.
const WIX_LEGACY_ESTIMATE = 4271; // 5783 - 1512

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
  const total = liveDistinct + SQSP_LEGACY_EXACT + WIX_LEGACY_ESTIMATE;

  return json(
    {
      total,
      liveDistinct,
      liveSubmissions,
      sqspLegacyExact: SQSP_LEGACY_EXACT,
      wixLegacyEstimate: WIX_LEGACY_ESTIMATE,
      lastUpdated: row?.last_updated ?? new Date().toISOString(),
      source: 'endo-survey-v1+ + sqsp-pdf-exact + wix-pdf-legacy-estimate',
    },
    200,
    CACHE_HEADERS
  );
}
