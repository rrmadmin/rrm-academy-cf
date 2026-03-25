/**
 * Fetch library articles from the D1 enrichment worker and cache as JSON.
 * Run: WORKER_AUTH_TOKEN=xxx node src/lib/fetch-data.mjs
 *
 * Single-record mode: RECORD_ID=recXXX fetches all articles from the worker,
 * finds the matching record, and merges into existing articles.json cache.
 * Used by repository_dispatch to update a single article without a full rebuild.
 *
 * Replaces the previous Airtable-based fetch (Priority 4: D1 cutover).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'articles.json');
const DRY_RUN = process.argv.includes('--dry-run');

const WORKER_URL = 'https://rrm-library-worker.administrator-cloudflare.workers.dev/articles';

// --- Worker response mapping ---

/**
 * Map a worker article object to the articles.json schema.
 * The worker returns camelCase fields; this normalizes types for Astro components.
 */
function mapWorkerRecord(r) {
  if (!r.slug || !r.title) return null;

  return {
    id: r.id,
    slug: (r.slug || '').trim().toLowerCase(),
    title: (r.title || '').replace(/\.\s*$/, ''),
    authors: r.authors || '',
    shortCitation: r.shortCitation || '',
    year: r.year ?? null,
    abstract: r.abstract || '',
    journal: r.journal || '',
    journalAbbv: r.journalAbbv || '',
    doi: r.doi || '',
    pmid: r.pmid || '',
    sourceUrl: r.sourceUrl || '',
    datePublished: r.datePublished || '',
    volume: r.volume || '',
    issue: r.issue || '',
    pages: r.pages || '',
    // Worker returns keywords as JSON array; Astro components expect a string
    keywords: Array.isArray(r.keywords) ? r.keywords.join(', ') : (r.keywords || ''),
    apaCitation: r.apaCitation || '',
    vancouverCitation: r.vancouverCitation || '',
    mlaCitation: r.mlaCitation || '',
    topics: Array.isArray(r.topics) ? r.topics : [],
    searchTerms: Array.isArray(r.searchTerms) ? r.searchTerms : [],
    enrichmentStatus: r.enrichmentStatus || '',
    identifiers: Array.isArray(r.identifiers) ? r.identifiers : [],
    isOpenAccess: !!r.isOpenAccess,
    isCopyrighted: !!r.isCopyrighted,
    oaType: r.oaType || '',
    license: r.license || '',
    oaUrl: r.oaUrl || '',
    accessLevel: r.accessLevel || 'restricted',
    sentiment: r.sentiment || '',
    rrmRelevance: r.rrmRelevance || '',
    domain: r.domain || '',
    lastModified: r.lastModified || '',
    dateAddedToLibrary: r.dateAddedToLibrary || '',
  };
}

function sortArticles(articles) {
  const hasDate = (d) => d && !d.startsWith('1900');
  articles.sort((a, b) => {
    const aOk = hasDate(a.datePublished);
    const bOk = hasDate(b.datePublished);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
    return b.datePublished.localeCompare(a.datePublished);
  });
  return articles;
}

/** Fetch from the D1 worker with retry logic. Accepts full URL. */
async function fetchFromWorker(token, url = WORKER_URL) {
  let res;
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      lastError = undefined;
      if (res.ok || (res.status !== 429 && res.status < 500)) break;
    } catch (e) {
      lastError = e;
    }
    const delay = Math.pow(2, attempt) * 1000;
    console.warn(`Retry ${attempt + 1}/5 in ${delay / 1000}s...`);
    await new Promise(r => setTimeout(r, delay));
  }

  if (lastError) throw lastError;
  if (!res || !res.ok) {
    const err = res ? await res.text() : 'No response';
    throw new Error(`Worker ${res?.status}: ${err}`);
  }

  return res.json();
}

/** Fetch a single article. Returns the article object or null if not found. */
async function fetchSingleFromWorker(token, url) {
  let res;
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      lastError = undefined;
      if (res.ok || (res.status !== 429 && res.status < 500)) break;
    } catch (e) {
      lastError = e;
    }
    const delay = Math.pow(2, attempt) * 1000;
    console.warn(`Retry ${attempt + 1}/5 in ${delay / 1000}s...`);
    await new Promise(r => setTimeout(r, delay));
  }

  if (lastError) throw lastError;
  if (res?.status === 404) return null;
  if (!res || !res.ok) {
    const err = res ? await res.text() : 'No response';
    throw new Error(`Worker ${res?.status}: ${err}`);
  }
  return res.json();
}

function writeArticles(articles) {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(articles, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
}

// --- Single-record merge mode ---

async function fetchSingle(recordId) {
  const token = process.env.WORKER_AUTH_TOKEN;
  if (!token) {
    console.error('Error: WORKER_AUTH_TOKEN environment variable required');
    process.exit(1);
  }

  // Load existing articles.json
  let articles = [];
  if (existsSync(OUTPUT_PATH)) {
    articles = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    console.log(`Loaded ${articles.length} existing articles from cache`);
  } else {
    console.warn('Cache missing. Falling back to full fetch.');
    return fetchAll();
  }

  // Fetch single article from worker (returns null on 404)
  console.log(`Fetching single record from D1 worker: ${recordId}`);
  const singleUrl = `${WORKER_URL}?id=${encodeURIComponent(recordId)}`;
  const record = await fetchSingleFromWorker(token, singleUrl);

  // Remove old version of this record (if present)
  const before = articles.length;
  articles = articles.filter(a => a.id !== recordId);
  const wasPresent = articles.length < before;

  if (!record) {
    if (wasPresent) {
      console.log(`Record ${recordId} removed from articles.json`);
    } else {
      console.log(`Record ${recordId} not in articles.json -- nothing to do`);
    }
  } else {
    const article = mapWorkerRecord(record);
    if (!article) {
      console.log(`Record ${recordId} missing slug or title -- skipped`);
    } else {
      articles.push(article);
      console.log(`${wasPresent ? 'Updated' : 'Added'}: "${article.title}" (${article.slug})`);
    }
  }

  sortArticles(articles);
  writeArticles(articles);
  console.log(`\nWrote ${articles.length} articles to ${OUTPUT_PATH}`);

  // Ping Airtable webhook to confirm record was processed (onDeck -> Synced)
  // Kept for backward compatibility with Airtable automation trigger
  const webhookUrl = process.env.AIRTABLE_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('AIRTABLE_WEBHOOK_URL not set, skipping webhook ping');
  }
  try {
    if (!webhookUrl) throw new Error('skipped');
    const ping = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record_id: recordId, status: 'processed', articles_count: articles.length }),
    });
    console.log(`Airtable webhook: ${ping.ok ? 'confirmed' : ping.status}`);
  } catch (e) {
    console.warn(`Airtable webhook ping failed: ${e.message}`);
  }
}

// --- Main ---

async function fetchAll() {
  if (DRY_RUN) {
    const fixturePath = join(__dirname, '..', '..', '.pipeline', 'snapshots', 'latest', 'articles.json');
    const fallbackPath = join(__dirname, '..', 'data', 'articles.json');
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

  console.log('Fetching all articles from D1 worker...');
  const raw = await fetchFromWorker(token);
  console.log(`Worker returned ${raw.length} published articles`);

  const articles = raw.map(mapWorkerRecord).filter(Boolean);
  console.log(`Mapped ${articles.length} valid articles (${raw.length - articles.length} skipped)`);

  sortArticles(articles);
  writeArticles(articles);
  console.log(`\nWrote ${articles.length} articles to ${OUTPUT_PATH}`);
}

const recordId = process.env.RECORD_ID;
const main = recordId ? () => fetchSingle(recordId) : fetchAll;

main().catch(err => {
  console.error(err);
  process.exit(1);
});
