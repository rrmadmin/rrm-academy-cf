/**
 * Fetch Provider Directory data from D1 via /api/providers and cache as JSON.
 * Run: LIBRARY_BUILD_TOKEN=xxx node src/lib/fetch-providers-data.mjs
 *
 * Full mode only -- no single-record dispatch in Phase 1 (data refresh is
 * monthly via the Python pipeline, not per-record).
 */

import { writeFileSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fetchResponseWithRetry } from './fetch-retry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'providers.json');
const DRY_RUN = process.argv.includes('--dry-run');
const API_URL = process.env.PROVIDERS_API_URL || 'https://rrmacademy.org/api/providers';

async function main() {
  const token = process.env.LIBRARY_BUILD_TOKEN;
  if (!token) {
    console.error('Error: LIBRARY_BUILD_TOKEN environment variable required');
    process.exit(1);
  }

  console.log(`Fetching provider directory from ${API_URL}...`);
  const res = await fetchResponseWithRetry(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Providers API ${res.status}: ${err}`);
  }

  const body = await res.json();
  if (!body.ok || !Array.isArray(body.providers)) {
    throw new Error(`Providers API error: ${body.error || 'no providers array'}`);
  }

  const providers = body.providers;
  console.log(`Fetched ${providers.length} provider records`);

  if (DRY_RUN) {
    console.log('Dry run; not writing file.');
    return;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify({ providers, count: providers.length }, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
  console.log(`Wrote ${providers.length} providers to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
