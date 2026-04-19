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
 * Cap: 10,000 URLs per request. We chunk at 9999 to stay safely under.
 *
 * Env:
 *   INDEXNOW_KEY         — public key string (matches public/<key>.txt filename)
 *   INDEXNOW_SINGLE_URL  — optional, full URL for single-record submissions
 *
 * Failure of the script itself is non-blocking at the workflow level
 * (continue-on-error: true), but the script DOES fail loudly inside CI when
 * the env is misconfigured, so the broken state surfaces in the run log.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const HOST = 'rrmacademy.org';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const KEY = process.env.INDEXNOW_KEY;
const SINGLE_URL = process.env.INDEXNOW_SINGLE_URL;
const DIST_DIR = 'dist';
const CHUNK = 9999;
const FETCH_TIMEOUT_MS = 15000;
const IN_CI = Boolean(process.env.GITHUB_ACTIONS);

if (!KEY) {
  if (IN_CI) {
    console.error('IndexNow: INDEXNOW_KEY missing in CI — failing');
    process.exit(1);
  }
  console.error('IndexNow: INDEXNOW_KEY env var missing — skipping (local)');
  process.exit(0);
}

const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

function decodeXmlEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function extractUrlsFromSitemap(xml) {
  const urls = [];
  const re = /<loc>([\s\S]*?)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    urls.push(decodeXmlEntities(m[1]).trim());
  }
  return urls;
}

function urlIsOnHost(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === HOST;
  } catch {
    return false;
  }
}

function gatherUrls() {
  if (SINGLE_URL) {
    if (!urlIsOnHost(SINGLE_URL)) {
      console.error(`IndexNow: INDEXNOW_SINGLE_URL "${SINGLE_URL}" is not on host ${HOST} — skipping submission`);
      return [];
    }
    return [SINGLE_URL];
  }
  if (!existsSync(DIST_DIR)) {
    console.error(`IndexNow: ${DIST_DIR}/ missing — skipping`);
    return [];
  }
  const sitemapFiles = readdirSync(DIST_DIR).filter(f => /^sitemap.*\.xml$/.test(f));
  if (sitemapFiles.length === 0) {
    console.error(`IndexNow: no sitemap-*.xml files in ${DIST_DIR}/ — sitemap generation likely broken`);
    if (IN_CI) process.exit(1);
    return [];
  }
  const all = new Set();
  let dropped = 0;
  for (const f of sitemapFiles) {
    if (f === 'sitemap-index.xml') continue;
    const xml = readFileSync(join(DIST_DIR, f), 'utf8');
    for (const u of extractUrlsFromSitemap(xml)) {
      if (urlIsOnHost(u)) all.add(u);
      else dropped++;
    }
  }
  if (sitemapFiles.length > 0 && all.size === 0) {
    console.error(`IndexNow: parsed ${sitemapFiles.length} sitemap file(s) but extracted 0 URLs — possible regex/parse regression`);
    if (IN_CI) process.exit(1);
  }
  if (dropped > 0) {
    console.warn(`IndexNow: dropped ${dropped} URL(s) not on host ${HOST}`);
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    let detail = '';
    if (!res.ok) {
      try {
        detail = (await res.text()).slice(0, 400);
      } catch {
        detail = '';
      }
    }
    return { status: res.status, ok: res.ok, detail, error: null };
  } catch (err) {
    return { status: 0, ok: false, detail: '', error: err.message };
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
    const chunkNo = Math.floor(i / CHUNK) + 1;
    const { status, ok, detail, error } = await submitChunk(chunk);
    if (error) {
      console.log(`  chunk ${chunkNo}: ${chunk.length} URLs → error ${error}`);
      failCount += chunk.length;
    } else if (ok) {
      console.log(`  chunk ${chunkNo}: ${chunk.length} URLs → HTTP ${status}`);
      okCount += chunk.length;
    } else {
      console.log(`  chunk ${chunkNo}: ${chunk.length} URLs → HTTP ${status}${detail ? ' — ' + detail : ''}`);
      failCount += chunk.length;
    }
  }
  console.log(`IndexNow: ${okCount} ok, ${failCount} failed`);
}

await main();
