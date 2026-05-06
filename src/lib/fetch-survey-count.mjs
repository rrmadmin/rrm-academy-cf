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

  const total = Number(payload?.total);
  if (!Number.isFinite(total) || total < 0) {
    console.error(`[survey-count] Invalid total value: ${payload?.total}; preserving prior data`);
    process.exit(0);
  }

  const out = {
    total,
    liveDistinct: Number(payload?.liveDistinct) || 0,
    liveSubmissions: Number(payload?.liveSubmissions) || 0,
    wixLegacyEstimate: Number(payload?.wixLegacyEstimate) || 0,
    lastUpdated: payload?.lastUpdated ?? new Date().toISOString(),
    source: payload?.source ?? 'endo-survey-v1+ + wix-pdf-legacy-estimate',
    fetchedAt: new Date().toISOString(),
  };

  if (DRY_RUN) {
    console.log('[survey-count] DRY RUN, would write:', out);
    return;
  }

  const dir = dirname(OUTPUT_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`[survey-count] Wrote ${OUTPUT_PATH} (total=${out.total}, liveDistinct=${out.liveDistinct}, wixLegacyEstimate=${out.wixLegacyEstimate})`);
}

main().catch(err => {
  console.error('[survey-count] Fatal error:', err);
  process.exit(1);
});
