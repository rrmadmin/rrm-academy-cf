/**
 * Fetch library articles from the D1 enrichment worker and cache as JSON.
 * Run: LIBRARY_BUILD_TOKEN=xxx node src/lib/fetch-data.mjs
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
import { fetchWithRetry } from './fetch-retry.mjs';

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
    authorRecords: Array.isArray(r.authorRecords) ? r.authorRecords : [],
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

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function writeArticles(articles) {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(articles, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
}

// --- Single-record merge mode ---

async function fetchSingle(recordId) {
  const token = process.env.LIBRARY_BUILD_TOKEN;
  if (!token) {
    console.error('Error: LIBRARY_BUILD_TOKEN environment variable required');
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
  const record = await fetchWithRetry(singleUrl, { headers: authHeaders(token) }, { timeout: 15000, allow404: true });

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
  if (webhookUrl) {
    try {
      const ping = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_id: recordId, status: 'processed', articles_count: articles.length }),
      });
      console.log(`Airtable webhook: ${ping.ok ? 'confirmed' : ping.status}`);
    } catch (e) {
      console.warn(`Airtable webhook ping failed: ${e.message}`);
    }
  } else {
    console.warn('AIRTABLE_WEBHOOK_URL not set, skipping webhook ping');
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

  const token = process.env.LIBRARY_BUILD_TOKEN;
  if (!token) {
    console.error('Error: LIBRARY_BUILD_TOKEN environment variable required');
    process.exit(1);
  }

  console.log('Fetching all articles from D1 worker...');
  const response = await fetchWithRetry(`${WORKER_URL}?limit=5000`, { headers: authHeaders(token) });
  const raw = Array.isArray(response) ? response : response.results;
  console.log(`Worker returned ${raw.length} published articles`);

  // Exclude non-article types as a safety net (worker already filters, but cache may be stale)
  const EXCLUDED_TYPES = new Set(['faq', 'post', 'course', 'guide']);
  const filtered = raw.filter(r => !EXCLUDED_TYPES.has(r.type));
  if (filtered.length < raw.length) {
    console.log(`Filtered ${raw.length - filtered.length} non-article records (type exclusion)`);
  }
  const articles = filtered.map(mapWorkerRecord).filter(Boolean);
  console.log(`Mapped ${articles.length} valid articles`);

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
