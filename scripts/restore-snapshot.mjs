#!/usr/bin/env node
/**
 * Restore articles.json from an R2 snapshot.
 *
 * Usage:
 *   node scripts/restore-snapshot.mjs                    # list available snapshots
 *   node scripts/restore-snapshot.mjs latest              # restore most recent
 *   node scripts/restore-snapshot.mjs 2026-03-25T12-00   # restore by date prefix
 *
 * After restoring, run `npm run build` and deploy to apply.
 *
 * Requires: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars
 */

import { writeFileSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES_PATH = join(__dirname, '..', 'src', 'data', 'articles.json');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const BUCKET = 'rrm-assets';
const PREFIX = 'snapshots/articles/';

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required');
  process.exit(1);
}

const headers = { 'Authorization': `Bearer ${API_TOKEN}` };
const R2_API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects`;

async function listSnapshots() {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects?prefix=${encodeURIComponent(PREFIX)}&limit=100`,
    { headers }
  );
  if (!res.ok) throw new Error(`R2 list failed: ${res.status}`);
  const data = await res.json();
  return (data.result || []).map(obj => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded,
    name: obj.key.replace(PREFIX, ''),
  })).sort((a, b) => a.key.localeCompare(b.key));
}

async function downloadSnapshot(key) {
  const res = await fetch(`${R2_API}/${encodeURIComponent(key)}`, { headers });
  if (!res.ok) throw new Error(`R2 download failed: ${res.status}`);
  return res.text();
}

async function main() {
  const arg = process.argv[2];

  const snapshots = await listSnapshots();
  if (snapshots.length === 0) {
    console.log('No snapshots found in R2.');
    process.exit(0);
  }

  // List mode
  if (!arg) {
    console.log(`${snapshots.length} snapshots available:\n`);
    for (const s of snapshots) {
      const sizeMB = (s.size / 1024 / 1024).toFixed(1);
      console.log(`  ${s.name.padEnd(35)} ${sizeMB} MB`);
    }
    console.log('\nUsage: node scripts/restore-snapshot.mjs latest');
    console.log('       node scripts/restore-snapshot.mjs 2026-03-25');
    return;
  }

  // Find matching snapshot
  let target;
  if (arg === 'latest') {
    target = snapshots[snapshots.length - 1];
  } else {
    const matches = snapshots.filter(s => s.name.startsWith(arg));
    target = matches[matches.length - 1];
  }

  if (!target) {
    console.error(`No snapshot matching "${arg}"`);
    process.exit(1);
  }

  console.log(`Restoring: ${target.name} (${(target.size / 1024 / 1024).toFixed(1)} MB)`);
  const data = await downloadSnapshot(target.key);
  const articles = JSON.parse(data);
  console.log(`Downloaded: ${articles.length} articles`);

  // Atomic write
  mkdirSync(dirname(ARTICLES_PATH), { recursive: true });
  const tmpPath = ARTICLES_PATH + '.tmp';
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, ARTICLES_PATH);
  console.log(`Restored to ${ARTICLES_PATH}`);
  console.log('\nNext: npm run build && deploy to apply');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
