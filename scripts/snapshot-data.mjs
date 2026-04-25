#!/usr/bin/env node
/**
 * Snapshot all build-time data files to R2 before deploy.
 *
 * Stores timestamped copies under snapshots/data/<type>/ so any deploy can be
 * rolled back AND the pre-deploy QA can diff against the previous baseline.
 * Keeps the last 30 snapshots per type (pruning oldest).
 *
 * Usage: CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=xxx node scripts/snapshot-data.mjs
 *
 * R2 bucket: rrm-assets (same as community uploads / blog images)
 * Key pattern: snapshots/data/<type>/YYYY-MM-DDTHH-MM-SSZ.json
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');

// type -> { file, prefix, countFn, minCount }
// minCount=0 means no enforcement (some types are best-effort).
//
// `snapshots/articles/` is the legacy prefix consumed by scripts/restore-snapshot.mjs.
// `snapshots/data/<type>/` is the new prefix consumed by scripts/qa-pre-deploy.mjs.
// Articles are written to both for rollback compatibility until restore-snapshot.mjs
// is updated to read from the new location.
const TYPES = [
  { type: 'articles', file: 'articles.json',  prefix: 'snapshots/articles/',          minCount: 1, countArray: true },
  { type: 'articles_v2', file: 'articles.json', prefix: 'snapshots/data/articles/',   minCount: 0, countArray: true },
  { type: 'posts',    file: 'posts.json',     prefix: 'snapshots/data/posts/',        minCount: 0, countArray: true },
  { type: 'faqs',     file: 'faqs.json',      prefix: 'snapshots/data/faqs/',         minCount: 0, countArray: true },
  { type: 'glossary', file: 'glossary.json',  prefix: 'snapshots/data/glossary/',     minCount: 0, countArray: false },
  { type: 'courses',  file: 'courses.json',   prefix: 'snapshots/data/courses/',      minCount: 0, countArray: true },
];

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const BUCKET = 'rrm-assets';
const MAX_SNAPSHOTS = 30;
const COMMIT = process.env.GITHUB_SHA || 'local';

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required');
  process.exit(1);
}

const R2_API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects`;
const headers = { 'Authorization': `Bearer ${API_TOKEN}` };

async function upload(key, body, metadata) {
  let res;
  try {
    res = await fetch(`${R2_API}/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        ...Object.fromEntries(
          Object.entries(metadata).map(([k, v]) => [`cf-r2-meta-${k}`, String(v)])
        ),
      },
      body,
    });
  } catch (err) {
    throw new Error(`R2 upload network error: ${err.message}`);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`R2 upload failed: ${res.status} ${err.slice(0, 200)}`);
  }
}

async function listSnapshots(prefix) {
  let res;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects?prefix=${encodeURIComponent(prefix)}&limit=100`,
      { headers }
    );
  } catch (err) {
    throw new Error(`R2 list network error: ${err.message}`);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`R2 list failed: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.result || []).map((obj) => obj.key).sort();
}

async function deleteObject(key) {
  try {
    const res = await fetch(`${R2_API}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers,
    });
    return res.ok;
  } catch (err) {
    console.warn(`[snapshot] deleteObject(${key}) failed: ${err.message}`);
    return false;
  }
}

async function snapshotOne(spec) {
  const path = join(DATA_DIR, spec.file);
  if (!existsSync(path)) {
    console.warn(`[skip] ${spec.type}: ${spec.file} missing`);
    return;
  }
  const raw = readFileSync(path, 'utf-8');
  let count = 0;
  try {
    const parsed = JSON.parse(raw);
    count = spec.countArray ? (Array.isArray(parsed) ? parsed.length : 0) : 1;
  } catch {
    console.warn(`[skip] ${spec.type}: ${spec.file} not valid JSON`);
    return;
  }

  if (count < spec.minCount) {
    console.error(`ERROR: ${spec.type} has ${count} records (min ${spec.minCount}), refusing snapshot`);
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `${spec.prefix}${stamp}.json`;

  await upload(key, raw, {
    type: spec.type,
    count,
    commit: COMMIT.slice(0, 8),
    timestamp: new Date().toISOString(),
  });
  console.log(`[ok] ${spec.type}: ${count} records -> ${key}`);

  // Prune
  const existing = await listSnapshots(spec.prefix);
  if (existing.length > MAX_SNAPSHOTS) {
    const toDelete = existing.slice(0, existing.length - MAX_SNAPSHOTS);
    await Promise.all(toDelete.map((old) => deleteObject(old)));
    console.log(`[prune] ${spec.type}: deleted ${toDelete.length} old`);
  }
}

async function main() {
  for (const spec of TYPES) {
    await snapshotOne(spec);
  }
}

main().catch((err) => {
  console.error(`Snapshot failed: ${err.message}`);
  process.exit(1);
});
