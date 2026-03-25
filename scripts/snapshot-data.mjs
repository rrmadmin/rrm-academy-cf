#!/usr/bin/env node
/**
 * Snapshot articles.json to R2 before deploy.
 *
 * Stores a timestamped copy so any deploy can be rolled back by restoring
 * the snapshot. Keeps the last 30 snapshots (pruning oldest).
 *
 * Usage: CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=xxx node scripts/snapshot-data.mjs
 *
 * R2 bucket: rrm-assets (same bucket as community uploads / blog images)
 * Key pattern: snapshots/articles/YYYY-MM-DDTHH-MM-SSZ.json
 * Metadata: { articleCount, commit, timestamp }
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES_PATH = join(__dirname, '..', 'src', 'data', 'articles.json');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const BUCKET = 'rrm-assets';
const PREFIX = 'snapshots/articles/';
const MAX_SNAPSHOTS = 30;
const COMMIT = process.env.GITHUB_SHA || 'local';

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required');
  process.exit(1);
}

const R2_API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects`;
const headers = {
  'Authorization': `Bearer ${API_TOKEN}`,
};

async function upload(key, body, metadata) {
  const res = await fetch(`${R2_API}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      // R2 custom metadata via headers
      ...Object.fromEntries(
        Object.entries(metadata).map(([k, v]) => [`cf-r2-meta-${k}`, String(v)])
      ),
    },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`R2 upload failed: ${res.status} ${err.slice(0, 200)}`);
  }
  return res;
}

async function listSnapshots() {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects?prefix=${encodeURIComponent(PREFIX)}&limit=100`,
    { headers }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`R2 list failed: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.result || []).map(obj => obj.key).sort();
}

async function deleteObject(key) {
  const res = await fetch(`${R2_API}/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers,
  });
  return res.ok;
}

async function main() {
  // Read articles.json
  const articlesRaw = readFileSync(ARTICLES_PATH, 'utf-8');
  const articles = JSON.parse(articlesRaw);
  const count = articles.length;

  if (count === 0) {
    console.error('ERROR: articles.json is empty, not snapshotting');
    process.exit(1);
  }

  // Generate key
  const now = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
  const key = `${PREFIX}${now}.json`;

  console.log(`Snapshotting ${count} articles to R2: ${key}`);
  await upload(key, articlesRaw, {
    articleCount: count,
    commit: COMMIT.slice(0, 8),
    timestamp: new Date().toISOString(),
  });
  console.log(`Snapshot uploaded: ${count} articles, commit ${COMMIT.slice(0, 8)}`);

  // Prune old snapshots
  const existing = await listSnapshots();
  if (existing.length > MAX_SNAPSHOTS) {
    const toDelete = existing.slice(0, existing.length - MAX_SNAPSHOTS);
    console.log(`Pruning ${toDelete.length} old snapshots (keeping ${MAX_SNAPSHOTS})`);
    for (const old of toDelete) {
      await deleteObject(old);
    }
  }

  console.log(`Snapshots: ${Math.min(existing.length + 1, MAX_SNAPSHOTS)} stored`);
}

main().catch(err => {
  console.error(`Snapshot failed: ${err.message}`);
  // Non-blocking -- don't fail the deploy over a snapshot error
  process.exit(0);
});
