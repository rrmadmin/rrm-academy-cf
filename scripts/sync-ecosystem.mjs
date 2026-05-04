#!/usr/bin/env node
/**
 * sync-ecosystem.mjs
 *
 * Reads docs/rrm-academy-ecosystem.json and writes it to D1 system_config table.
 * Run manually after editing the JSON:
 *   node scripts/sync-ecosystem.mjs
 *
 * Requires: wrangler CLI authenticated with Cloudflare.
 *
 * Storage format: `gz:<base64-gzip>` — D1 has a 100KB-per-statement limit
 * and the raw JSON is now ~117KB. gzip+base64 brings it to ~49KB. The GET
 * endpoint at functions/api/admin/ecosystem.js detects the `gz:` prefix and
 * decompresses on read.
 *
 * INSERT OR REPLACE is intentional — single-row KV store where overwrite is
 * the desired behavior. Not a multi-row data-loss risk.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { gzipSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const jsonPath = join(projectRoot, 'docs', 'rrm-academy-ecosystem.json');

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
