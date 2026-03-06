/**
 * Standalone script to fetch Airtable data and cache as JSON.
 * Run: AIRTABLE_PAT=xxx node src/lib/fetch-data.mjs
 *
 * Single-record mode: RECORD_ID=recXXX fetches one record, merges into
 * existing articles.json cache. Used by repository_dispatch to avoid
 * re-fetching 3000+ articles for a single change.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { API_URL, FIELDS } from './airtable-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'articles.json');
const DRY_RUN = process.argv.includes('--dry-run');

// --- Record mapping (shared between full fetch and single-record) ---

function mapRecord(record) {
  const f = record.fields;
  const slug = f['⚡️ SEO:Slug'];
  const title = f['⚡️ Title'];
  if (!slug || !title) return null;

  const oaFlag = f['⚡️ Is Open Access'] || '';
  const isOpenAccess = oaFlag === 'Open Access';
  const accessLevel = isOpenAccess ? 'open' : 'restricted';

  return {
    id: record.id,
    slug: slug.trim().toLowerCase(),
    title: title.replace(/\.\s*$/, ''),
    authors: f['⚡️ Author(s)'] || '',
    shortCitation: f['⚡️ Short Citation'] || '',
    year: f['⚡️ Year'] ? Number(f['⚡️ Year']) : null,
    abstract: f['⚡️ Abstract'] || '',
    journal: f['⚡️ Journal'] || '',
    journalAbbv: f['⚡️ Journal Abbv'] || '',
    doi: f['⚡️ DOI'] || '',
    pmid: '',
    sourceUrl: f['⚡️ Source URL'] || '',
    datePublished: f['⚡️ Date Published'] || '',
    volume: f['⚡️ Volume'] || '',
    issue: f['⚡️ Issue'] || '',
    pages: f['⚡️ Pages'] || '',
    keywords: f['⚡️ Keywords'] || '',
    apaCitation: f['⚡️ Citation'] || '',
    vancouverCitation: f['⚡️ Vancouver Citation'] || '',
    mlaCitation: f['⚡️ MLA Citation'] || '',
    topics: f['⚡️ Topics (AI)']
      ? f['⚡️ Topics (AI)'].split('\n').map(t => t.trim()).filter(Boolean)
      : [],
    searchTerms: f['⚡️ Search Terms (AI)']
      ? f['⚡️ Search Terms (AI)'].split('\n').map(t => t.trim()).filter(Boolean)
      : [],
    enrichmentStatus: f['Sync to RRM Library'] || '',
    identifiers: oaFlag ? [oaFlag] : [],
    isOpenAccess,
    isCopyrighted: oaFlag === '©',
    oaType: '',
    license: '',
    oaUrl: '',
    accessLevel,
    sentiment: f['⚡️ Sentiment (AI)'] || '',
    rrmRelevance: f['⚡️ RRM Relevance (AI)'] || '',
    domain: f['⚡️ Domain (AI)'] || '',
    lastModified: f['Last Modified'] || '',
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

// --- Single-record merge mode ---

async function fetchSingle(recordId) {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    console.error('Error: AIRTABLE_PAT environment variable required');
    process.exit(1);
  }

  const url = `${API_URL}/${recordId}`;

  console.log(`Fetching single record: ${recordId}`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${pat}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable ${res.status}: ${err}`);
  }

  const record = await res.json();
  const syncStatus = record.fields?.['Sync to RRM Library'];
  const isSynced = syncStatus === 'Synced' || syncStatus === 'onDeck';

  // Load existing articles.json
  let articles = [];
  if (existsSync(OUTPUT_PATH)) {
    articles = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    console.log(`Loaded ${articles.length} existing articles from cache`);
  }

  // Remove old version of this record (if present)
  const before = articles.length;
  articles = articles.filter(a => a.id !== recordId);
  const wasPresent = articles.length < before;

  if (!isSynced) {
    // Record is no longer synced -- remove it
    if (wasPresent) {
      console.log(`Record ${recordId} sync="${syncStatus}" -- removed from articles.json`);
    } else {
      console.log(`Record ${recordId} sync="${syncStatus}" -- not in articles.json, nothing to do`);
    }
  } else {
    const article = mapRecord(record);
    if (!article) {
      console.log(`Record ${recordId} missing slug or title -- skipped`);
    } else {
      articles.push(article);
      console.log(`${wasPresent ? 'Updated' : 'Added'}: "${article.title}" (${article.slug})`);
    }
  }

  sortArticles(articles);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(articles, null, 2));
  console.log(`\nWrote ${articles.length} articles to ${OUTPUT_PATH}`);

  // Ping Airtable webhook to confirm record was processed (onDeck -> Synced)
  const webhookUrl = 'https://hooks.airtable.com/workflows/v1/genericWebhook/app78UTVdeFph9qhL/wflCWOVSQdw1B8DVJ/wtrtpAQok7EXF3coj';
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

  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    console.error('Error: AIRTABLE_PAT environment variable required');
    process.exit(1);
  }

  const articles = [];
  let offset;
  let page = 0;

  const formula = encodeURIComponent("{Sync to RRM Library}='Synced'");
  const fieldsParams = FIELDS.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');

  do {
    page++;
    const url = `${API_URL}?${fieldsParams}&filterByFormula=${formula}&pageSize=100${
      offset ? `&offset=${offset}` : ''
    }`;

    let res;
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${pat}` },
        });
        lastError = undefined;
        if (res.status !== 429) break;
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
      throw new Error(`Airtable ${res?.status}: ${err}`);
    }

    const data = await res.json();
    offset = data.offset;

    for (const record of data.records) {
      const article = mapRecord(record);
      if (article) articles.push(article);
    }

    console.log(`Page ${page}: ${data.records.length} records (${articles.length} total)`);
  } while (offset);

  sortArticles(articles);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(articles, null, 2));
  console.log(`\nWrote ${articles.length} articles to ${OUTPUT_PATH}`);
}

const recordId = process.env.RECORD_ID;
const main = recordId ? () => fetchSingle(recordId) : fetchAll;

main().catch(err => {
  console.error(err);
  process.exit(1);
});
