#!/usr/bin/env node
/**
 * Submit URLs to IndexNow after a successful deploy.
 *
 * IndexNow notifies Bing, Yandex, Naver, Seznam, and other participating
 * engines that URLs have changed. Submitting unchanged URLs is allowed by
 * the spec (engines de-dupe), but submitting only what changed is polite.
 *
 * Strategy:
 *   - INDEXNOW_SINGLE_URL set        → submit just that URL (single-record dispatch)
 *   - otherwise                      → submit all URLs from the built sitemaps
 *
 * Endpoint: https://api.indexnow.org/indexnow (fans out to all engines)
 * Cap: 10,000 URLs per request. We chunk if exceeded.
 *
 * Env:
 *   INDEXNOW_KEY         — public key string (matches public/<key>.txt filename)
 *   INDEXNOW_SINGLE_URL  — optional, full URL for single-record submissions
 *
 * Failure is non-blocking: deploy already succeeded, IndexNow is best-effort.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const HOST = 'rrmacademy.org';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const KEY = process.env.INDEXNOW_KEY;
const SINGLE_URL = process.env.INDEXNOW_SINGLE_URL;
const DIST_DIR = 'dist';
const CHUNK = 10000;

if (!KEY) {
  console.error('IndexNow: INDEXNOW_KEY env var missing — skipping');
  process.exit(0);
}

const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

function extractUrlsFromSitemap(xml) {
  const urls = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    urls.push(m[1].trim());
  }
  return urls;
}

function gatherUrls() {
  if (SINGLE_URL) {
    return [SINGLE_URL];
  }
  if (!existsSync(DIST_DIR)) {
    console.error(`IndexNow: ${DIST_DIR}/ missing — skipping`);
    return [];
  }
  const sitemapFiles = readdirSync(DIST_DIR).filter(f => /^sitemap.*\.xml$/.test(f));
  const all = new Set();
  for (const f of sitemapFiles) {
    if (f === 'sitemap-index.xml') continue;
    const xml = readFileSync(join(DIST_DIR, f), 'utf8');
    for (const u of extractUrlsFromSitemap(xml)) {
      if (u.startsWith(`https://${HOST}/`)) all.add(u);
    }
  }
  return [...all];
}

async function submitChunk(urls) {
  const body = JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls,
  });
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
    });
    return { status: res.status, ok: res.ok, error: null };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

async function main() {
  const urls = gatherUrls();
  if (urls.length === 0) {
    console.log('IndexNow: 0 URLs to submit');
    return;
  }
  console.log(`IndexNow: submitting ${urls.length} URL(s) to ${ENDPOINT}`);
  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK);
    const { status, ok, error } = await submitChunk(chunk);
    if (error) {
      console.log(`  chunk ${i / CHUNK + 1}: ${chunk.length} URLs → error ${error}`);
      failCount += chunk.length;
    } else {
      console.log(`  chunk ${i / CHUNK + 1}: ${chunk.length} URLs → HTTP ${status}`);
      if (ok || status === 202) okCount += chunk.length;
      else failCount += chunk.length;
    }
  }
  console.log(`IndexNow: ${okCount} ok, ${failCount} failed`);
}

await main();
