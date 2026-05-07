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
 * `wixLegacyEstimate` = Wix-era PDF download cohort (Apr 2024 - Feb 2026),
 *                       measurement-based estimate. Source: Wix File Share dashboard
 *                       for "Endometriosis Symptom Self-Survey.pdf" (uploaded
 *                       Apr 25, 2024) -- 3,719 lifetime views as of 2026-05-06.
 *                       Discount 10% for repeat views by the same user -> ~3,347
 *                       distinct viewers. Replaces prior 4,271 derivation (which
 *                       was based on Wix MEMBER count minus Squarespace migrants);
 *                       the view-counter basis is more direct. Refine via Wix
 *                       Members API if per-user download attribution becomes
 *                       available. See docs/plans/backlog.md.
 * `total`             = liveDistinct + sqspLegacyExact + wixLegacyEstimate
 *                       (honest "more than" framing; current floor ~6,000).
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { SQSP_LEGACY_EXACT, WIX_LEGACY_ESTIMATE } from '../../../src/lib/survey-legacy-constants.js';

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120',
};

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
      lastUpdated: row?.last_updated ?? null,
      source: 'endo-survey-v1+ + sqsp-pdf-exact + wix-pdf-legacy-estimate',
    },
    200,
    CACHE_HEADERS
  );
}
