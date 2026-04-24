/**
 * Fetch Educational Partners data from D1 via /api/partners and cache as JSON.
 * Run: LIBRARY_BUILD_TOKEN=xxx node src/lib/fetch-partners-data.mjs
 *
 * Full mode only -- no single-record dispatch. Partners mutate only via
 * admin actions which trigger a full rebuild.
 */

import { writeFileSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fetchResponseWithRetry } from './fetch-retry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'partners.json');
const DRY_RUN = process.argv.includes('--dry-run');
const API_URL = 'https://rrmacademy.org/api/partners';

async function main() {
  const token = process.env.LIBRARY_BUILD_TOKEN;
  if (!token) {
    console.error('Error: LIBRARY_BUILD_TOKEN environment variable required');
    process.exit(1);
  }

  console.log('Fetching active partners from D1...');
  const res = await fetchResponseWithRetry(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Partners API ${res.status}: ${err}`);
  }

  const body = await res.json();
  if (!body.ok || !Array.isArray(body.partners)) {
    throw new Error(`Partners API error: ${body.error || 'no partners array'}`);
  }

  const sorted = [...body.partners].sort((a, b) =>
    (b.approved_at || '').localeCompare(a.approved_at || '')
  );
  console.log(`Fetched ${sorted.length} active partners`);

  if (DRY_RUN) {
    console.log('Dry run; not writing file.');
    return;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(sorted, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
  console.log(`Wrote ${sorted.length} partners to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
