#!/usr/bin/env node
/**
 * sync-ecosystem.mjs
 *
 * Reads ecosystem.json from the rrm-academy-internal satellite repo and writes
 * it to the D1 system_config table. Run manually after editing the JSON:
 *   node scripts/sync-ecosystem.mjs
 *
 * Resolves ecosystem.json via env-var → sibling clone → home-path fallback.
 * Override with RRM_INTERNAL_ECOSYSTEM_PATH if cloned elsewhere.
 *
 * Requires: wrangler CLI authenticated with Cloudflare.
 *
 * Storage format: `gz:<base64-gzip>` — D1 has a 100KB-per-statement limit
 * and the raw JSON is now ~117KB. gzip+base64 brings it to ~49KB. The GET
 * endpoint at functions/api/admin/ecosystem.js detects the `gz:` prefix and
 * decompresses on read.
 *
 * The upsert pattern (single-row KV store on system_config) is intentional —
 * overwrite is the desired behavior. Not a multi-row data-loss risk.
 * See arise-ignore directive on the SQL line below.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir, homedir } from 'os';
import { gzipSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// ecosystem.json lives in rrm-academy-internal (satellite repo) post-public-split.
// Fallback chain: env override → sibling clone → absolute home path.
const candidates = [
  process.env.RRM_INTERNAL_ECOSYSTEM_PATH,
  join(projectRoot, '..', 'rrm-academy-internal', 'ecosystem.json'),
  join(homedir(), 'iCode', 'projects', 'rrm-academy-internal', 'ecosystem.json'),
].filter(Boolean);
const jsonPath = candidates.find(p => existsSync(p));
if (!jsonPath) {
  console.error('ecosystem.json not found.');
  console.error('Clone rrmadmin/rrm-academy-internal as a sibling of rrm-academy-cf,');
  console.error('OR set RRM_INTERNAL_ECOSYSTEM_PATH to the absolute path.');
  console.error('');
  console.error('Tried:');
  for (const c of candidates) console.error(`  - ${c}`);
  process.exit(2);
}

// Read and validate JSON
let jsonStr;
try {
  jsonStr = readFileSync(jsonPath, 'utf-8');
  JSON.parse(jsonStr); // validate
} catch (err) {
  console.error(`Failed to read/parse ${jsonPath}: ${err.message}`);
  process.exit(1);
}

// Compress: gzip + base64. Prefix with `gz:` so GET endpoint can detect format.
const gz = gzipSync(Buffer.from(jsonStr, 'utf-8'), { level: 9 });
const encoded = `gz:${gz.toString('base64')}`;

if (encoded.length > 95000) {
  console.error(`Compressed payload (${encoded.length}b) exceeds D1 95KB safety margin. JSON has grown beyond gzip-safe zone — split into multiple keys.`);
  process.exit(1);
}

// Write to temp file to avoid shell expansion of $, backticks, etc.
// arise-ignore insert-or-replace -- intentional single-row KV upsert (system_config has 1 row per key); not multi-row data-loss
const sql = `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('ecosystem-map', '${encoded}', datetime('now'));`;
const tmpFile = join(tmpdir(), `sync-ecosystem-${Date.now()}.sql`);
writeFileSync(tmpFile, sql);

console.log(`Syncing ecosystem JSON: raw ${jsonStr.length}b → gz+b64 ${encoded.length}b → D1 rrm-auth...`);

try {
  execSync(
    `npx wrangler d1 execute rrm-auth --remote --file="${tmpFile}"`,
    { cwd: projectRoot, stdio: 'inherit' }
  );
  console.log('Done.');
} catch (err) {
  console.error('Sync failed. Is wrangler authenticated?');
  process.exit(1);
} finally {
  try { unlinkSync(tmpFile); } catch {}
}
