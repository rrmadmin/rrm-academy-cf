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
 * Uses --file (not --command) to avoid shell expansion of $, backticks, etc.
 * in the JSON content (e.g. "$9/mo" would be corrupted by shell interpolation).
 *
 * INSERT OR REPLACE is intentional here -- this is a single-row KV store
 * where overwrite is the desired behavior. Not a multi-row data-loss risk.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

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

// Escape single quotes for SQL, write to temp file to avoid shell expansion
const escaped = jsonStr.replace(/'/g, "''");
const sql = `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('ecosystem-map', '${escaped}', datetime('now'));`;
const tmpFile = join(tmpdir(), `sync-ecosystem-${Date.now()}.sql`);
writeFileSync(tmpFile, sql);

console.log(`Syncing ecosystem JSON (${jsonStr.length} bytes) to D1 rrm-auth...`);

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
