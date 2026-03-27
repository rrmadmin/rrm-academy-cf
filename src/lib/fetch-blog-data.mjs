/**
 * Fetch blog posts from D1 via /api/blog/posts endpoint and cache as JSON.
 * Run: WORKER_AUTH_TOKEN=xxx node src/lib/fetch-blog-data.mjs
 *
 * Single-record mode: RECORD_ID=recXXX fetches one post for merge.
 * Full mode: fetches all published posts.
 *
 * Replaces the previous Airtable-based fetch.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'posts.json');
const DRY_RUN = process.argv.includes('--dry-run');

const POSTS_URL = 'https://rrmacademy.org/api/blog/posts';

async function fetchWithRetry(url, options, retries = 5) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    const delay = Math.pow(2, attempt) * 1000;
    console.warn(`Retry ${attempt + 1}/${retries} in ${delay / 1000}s...`);
    await new Promise(r => setTimeout(r, delay));
  }
  throw lastError;
}

function sortPosts(posts) {
  posts.sort((a, b) => {
    if (!a.publishDate && !b.publishDate) return 0;
    if (!a.publishDate) return 1;
    if (!b.publishDate) return -1;
    return b.publishDate.localeCompare(a.publishDate);
  });
  return posts;
}

async function fetchSingle(recordId) {
  const token = process.env.WORKER_AUTH_TOKEN;
  if (!token) {
    console.error('Error: WORKER_AUTH_TOKEN environment variable required');
    process.exit(1);
  }

  console.log(`Fetching single post: ${recordId}`);
  const res = await fetchWithRetry(`${POSTS_URL}?id=${encodeURIComponent(recordId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Blog API ${res.status}: ${err}`);
  }

  const body = await res.json();
  if (!body.ok || !body.data) {
    throw new Error(`Blog API error: ${body.error || 'no data'}`);
  }
  const post = body.data;

  // Load existing posts.json
  let posts = [];
  if (existsSync(OUTPUT_PATH)) {
    posts = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    console.log(`Loaded ${posts.length} existing posts from cache`);
  } else {
    console.warn('Cache missing. Falling back to full fetch.');
    return fetchAll();
  }

  // Remove old version of this record (if present)
  const before = posts.length;
  posts = posts.filter(p => p.id !== recordId);
  const wasPresent = posts.length < before;

  // Add updated post
  posts.push(post);
  console.log(`${wasPresent ? 'Updated' : 'Added'} post: ${post.slug}`);

  sortPosts(posts);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(posts, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
  console.log(`Wrote ${posts.length} posts to ${OUTPUT_PATH}`);
}

async function fetchAll() {
  if (DRY_RUN) {
    const fixturePath = join(__dirname, '..', '..', '.pipeline', 'snapshots', 'latest', 'posts.json');
    const fallbackPath = join(__dirname, '..', 'data', 'posts.json');
    const source = existsSync(fixturePath) ? fixturePath : fallbackPath;
    const data = JSON.parse(readFileSync(source, 'utf-8'));
    console.log(`DRY-RUN: Loaded ${data.length} records from ${source}`);
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
    console.log(`DRY-RUN: Wrote ${data.length} records to ${OUTPUT_PATH}`);
    return;
  }

  const token = process.env.WORKER_AUTH_TOKEN;
  if (!token) {
    console.error('Error: WORKER_AUTH_TOKEN environment variable required');
    process.exit(1);
  }

  console.log('Fetching all published posts from D1...');
  const res = await fetchWithRetry(POSTS_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Blog API ${res.status}: ${err}`);
  }

  const body = await res.json();
  if (!body.ok || !body.results) {
    throw new Error(`Blog API error: ${body.error || 'no results'}`);
  }
  const posts = body.results;
  console.log(`Fetched ${posts.length} published posts`);

  sortPosts(posts);

  // Dedup by slug (shouldn't happen, but safety net)
  const seen = new Set();
  const deduplicated = posts.filter(p => {
    if (seen.has(p.slug)) {
      console.warn(`Warning: duplicate slug "${p.slug}" -- keeping first occurrence`);
      return false;
    }
    seen.add(p.slug);
    return true;
  });

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(deduplicated, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
  console.log(`Wrote ${deduplicated.length} posts to ${OUTPUT_PATH}`);
}

const recordId = process.env.RECORD_ID;
const main = recordId ? () => fetchSingle(recordId) : fetchAll;

main().catch(err => {
  console.error(err);
  process.exit(1);
});
