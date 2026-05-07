/**
 * Shared legacy cohort constants for the endo-survey count subsystem.
 * Consumed by:
 *   - functions/api/survey/count.js  (CF Pages Functions runtime, via ../../../src/lib/)
 *   - src/lib/fetch-survey-count.mjs (Node build script)
 *
 * Update both constants here when cohort measurements are revised.
 * Do NOT hardcode these values in either consumer.
 */

// Squarespace-era PDF download cohort (Sept 2023 - Jun 2024). Exact count.
// Source: Endo Self Survey Downloads on Squarespace CSV.
// 1,810 download submissions, 1,512 distinct emails.
export const SQSP_LEGACY_EXACT = 1512;

// Wix-era PDF download cohort (Apr 2024 - Feb 2026), measurement-based estimate.
// Source: Wix File Share dashboard for "Endometriosis Symptom Self-Survey.pdf"
// (uploaded Apr 25, 2024) -- 3,719 lifetime views as of 2026-05-06.
// Discount 10% for repeat views -> ~3,347 distinct viewers.
export const WIX_LEGACY_ESTIMATE = 3347; // floor(3719 * 0.9)

// Minimum expected total: sum of the two fixed legacy cohorts.
// Used by fetch-survey-count.mjs to validate the locally-reconstructed total.
export const MIN_EXPECTED_TOTAL = SQSP_LEGACY_EXACT + WIX_LEGACY_ESTIMATE; // 4859
