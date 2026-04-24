/**
 * Fetch FAQ data from D1 via /api/faqs endpoint and cache as JSON.
 * Run: LIBRARY_BUILD_TOKEN=xxx node src/lib/fetch-faq-data.mjs
 *
 * Single-record mode: RECORD_ID=recXXX fetches one FAQ for merge.
 * Full mode: fetches all published FAQs.
 *
 * Library ref resolution: if articles.json exists, articleId refs are
 * enriched with author, year, slug, title, shortCitation. Graceful
 * degradation if articles.json is missing.
 *
 * Replaces the previous Airtable-based fetch.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fetchResponseWithRetry } from './fetch-retry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'faqs.json');
const ARTICLES_PATH = join(__dirname, '..', 'data', 'articles.json');
const DRY_RUN = process.argv.includes('--dry-run');

const FAQS_URL = 'https://rrmacademy.org/api/faqs';

function sortFaqs(faqs) {
  faqs.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
  return faqs;
}

/**
 * Build an index of articles keyed by id for O(1) lookup.
 * Returns Map<articleId, article>
 */
function buildArticleIndex(articles) {
  const idx = new Map();
  for (const a of articles) {
    if (a.id) idx.set(a.id, a);
  }
  return idx;
}

/**
 * Enrich libraryRefs on each FAQ with metadata from articles.json.
 * If articleId is not found, ref is left as-is.
 */
function resolveLibraryRefs(faqs, articleIndex) {
  for (const faq of faqs) {
    if (!Array.isArray(faq.libraryRefs)) continue;
    faq.libraryRefs = faq.libraryRefs.map(ref => {
      const article = articleIndex.get(ref.articleId);
      if (!article) return ref;
      return {
        ...ref,
        author: article.authors || '',
        year: article.year || null,
        slug: article.slug || '',
        title: article.title || '',
        shortCitation: article.shortCitation || '',
      };
    });
  }
  return faqs;
}

async function fetchSingle(recordId) {
  const token = process.env.LIBRARY_BUILD_TOKEN;
  if (!token) {
    console.error('Error: LIBRARY_BUILD_TOKEN environment variable required');
    process.exit(1);
  }

  console.log(`Fetching single FAQ: ${recordId}`);
  const res = await fetchResponseWithRetry(`${FAQS_URL}?id=${encodeURIComponent(recordId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FAQ API ${res.status}: ${err}`);
  }

  const body = await res.json();
  if (!body.ok || !body.data) {
    throw new Error(`FAQ API error: ${body.error || 'no data'}`);
  }
  const faq = body.data;

  // Load existing faqs.json
  let faqs = [];
  if (existsSync(OUTPUT_PATH)) {
    faqs = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    console.log(`Loaded ${faqs.length} existing FAQs from cache`);
  } else {
    console.warn('Cache missing. Falling back to full fetch.');
    return fetchAll();
  }

  // Remove old version of this record (if present)
  const before = faqs.length;
  faqs = faqs.filter(f => f.id !== recordId);
  const wasPresent = faqs.length < before;

  // Resolve library refs if articles.json available
  if (existsSync(ARTICLES_PATH)) {
    const articles = JSON.parse(readFileSync(ARTICLES_PATH, 'utf-8'));
    const articleIndex = buildArticleIndex(articles);
    resolveLibraryRefs([faq], articleIndex);
  }

  // Add updated FAQ
  if (faq.status !== 'published') {
    console.log(`Removed non-published FAQ (status: ${faq.status}): ${faq.slug || faq.id}`);
  } else {
    faqs.push(faq);
    console.log(`${wasPresent ? 'Updated' : 'Added'} FAQ: ${faq.slug || faq.id}`);
  }

  sortFaqs(faqs);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(faqs, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
  console.log(`Wrote ${faqs.length} FAQs to ${OUTPUT_PATH}`);
}

async function fetchAll() {
  if (DRY_RUN) {
    const fixturePath = join(__dirname, '..', '..', '.pipeline', 'snapshots', 'latest', 'faqs.json');
    const fallbackPath = join(__dirname, '..', 'data', 'faqs.json');
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

  console.log('Fetching all published FAQs from D1...');
  const res = await fetchResponseWithRetry(FAQS_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FAQ API ${res.status}: ${err}`);
  }

  const body = await res.json();
  if (!body.ok || !body.results) {
    throw new Error(`FAQ API error: ${body.error || 'no results'}`);
  }
  const faqs = body.results;
  console.log(`Fetched ${faqs.length} published FAQs`);

  // Resolve library refs if articles.json available
  if (existsSync(ARTICLES_PATH)) {
    const articles = JSON.parse(readFileSync(ARTICLES_PATH, 'utf-8'));
    const articleIndex = buildArticleIndex(articles);
    resolveLibraryRefs(faqs, articleIndex);
    console.log(`Resolved library refs against ${articles.length} articles`);
  } else {
    console.warn('articles.json not found -- library refs left unresolved');
  }

  sortFaqs(faqs);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(faqs, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
  console.log(`Wrote ${faqs.length} FAQs to ${OUTPUT_PATH}`);
}

const recordId = process.env.RECORD_ID;
const main = recordId ? () => fetchSingle(recordId) : fetchAll;

main().catch(err => {
  console.error(err);
  process.exit(1);
});
