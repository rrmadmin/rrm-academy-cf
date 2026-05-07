/**
 * Fetch endo-survey count from /api/survey/count and cache as JSON.
 * Run: node src/lib/fetch-survey-count.mjs
 *
 * Public endpoint, no auth required. 5-min edge cache on the server side.
 * Source of truth: D1 survey_identities table, source LIKE 'endo-survey-v1%'.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fetchResponseWithRetry } from './fetch-retry.mjs';
import { SQSP_LEGACY_EXACT, WIX_LEGACY_ESTIMATE, MIN_EXPECTED_TOTAL } from './survey-legacy-constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'survey-count.json');
const DRY_RUN = process.argv.includes('--dry-run');
const COUNT_URL = process.env.SURVEY_COUNT_URL || 'https://rrmacademy.org/api/survey/count';

async function main() {
  console.log(`[survey-count] Fetching from ${COUNT_URL}`);

  let payload;
  try {
    const res = await fetchResponseWithRetry(COUNT_URL, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      console.error(`[survey-count] Endpoint returned ${res.status}; preserving prior data`);
      process.exit(0);
    }
    payload = await res.json();
  } catch (err) {
    console.error(`[survey-count] Fetch failed: ${err.message}; preserving prior data`);
    process.exit(0);
  }

  const liveDistinct = Number(payload?.liveDistinct);
  if (!Number.isFinite(liveDistinct) || liveDistinct < 0) {
    console.error(`[survey-count] Invalid liveDistinct value: ${payload?.liveDistinct}; preserving prior data`);
    process.exit(0);
  }

  const liveSubmissions = Number(payload?.liveSubmissions);
  if (!Number.isFinite(liveSubmissions) || liveSubmissions < 0) {
    console.error(`[survey-count] Invalid liveSubmissions value: ${payload?.liveSubmissions}; preserving prior data`);
    process.exit(0);
  }

  // Reconstruct total locally from live data + build-time constants.
  // This eliminates one-deploy-cycle skew where the API runs old code with
  // stale constants while the build script runs new code with updated constants.
  const total = liveDistinct + SQSP_LEGACY_EXACT + WIX_LEGACY_ESTIMATE;

  if (total < MIN_EXPECTED_TOTAL) {
    console.error(`[survey-count] total ${total} < MIN_EXPECTED_TOTAL ${MIN_EXPECTED_TOTAL}; preserving prior data`);
    process.exit(0);
  }

  const out = {
    total,
    liveDistinct,
    liveSubmissions,
    sqspLegacyExact: SQSP_LEGACY_EXACT,
    wixLegacyEstimate: WIX_LEGACY_ESTIMATE,
    lastUpdated: payload?.lastUpdated ?? null,
    source: payload?.source ?? 'endo-survey-v1+ + sqsp-pdf-exact + wix-pdf-legacy-estimate',
    fetchedAt: new Date().toISOString(),
  };

  if (DRY_RUN) {
    console.log('[survey-count] DRY RUN, would write:', out);
    return;
  }

  const dir = dirname(OUTPUT_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`[survey-count] Wrote ${OUTPUT_PATH} (total=${out.total}, liveDistinct=${out.liveDistinct}, sqspLegacyExact=${out.sqspLegacyExact}, wixLegacyEstimate=${out.wixLegacyEstimate})`);
}

main().catch(err => {
  console.error('[survey-count] Fatal error:', err);
  process.exit(1);
});
