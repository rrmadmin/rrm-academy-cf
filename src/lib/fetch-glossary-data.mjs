/**
 * Fetch glossary data from D1 via /api/glossary/terms endpoint and cache as JSON.
 * Run: LIBRARY_BUILD_TOKEN=xxx node src/lib/fetch-glossary-data.mjs
 *
 * Single-record mode: RECORD_ID=term_xxx fetches one term for merge.
 * Full mode: fetches all published terms + references.
 *
 * Output shape: { terms: [...], references: [...], generatedAt: ISO }
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fetchResponseWithRetry } from './fetch-retry.mjs';
import { sanitizeHtml } from './html-sanitize.mjs';

function cleanTerm(term) {
  if (term && typeof term.bodyHtml === 'string' && term.bodyHtml.length > 0) {
    term.bodyHtml = sanitizeHtml(term.bodyHtml);
  }
  return term;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'glossary.json');
const DRY_RUN = process.argv.includes('--dry-run');

const GLOSSARY_URL = 'https://rrmacademy.org/api/glossary/terms';

function writeAtomic(payload) {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
}

async function fetchSingle(recordId) {
  const token = process.env.LIBRARY_BUILD_TOKEN;
  if (!token) {
    console.error('Error: LIBRARY_BUILD_TOKEN environment variable required');
    process.exit(1);
  }

  console.log(`Fetching single glossary term: ${recordId}`);
  const res = await fetchResponseWithRetry(`${GLOSSARY_URL}?id=${encodeURIComponent(recordId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Glossary API ${res.status}: ${err}`);
  }

  const body = await res.json();
  if (!body.ok || !body.data) {
    throw new Error(`Glossary API error: ${body.error || 'no data'}`);
  }
  const term = cleanTerm(body.data);

  // Load existing glossary.json
  if (!existsSync(OUTPUT_PATH)) {
    console.warn('Cache missing. Falling back to full fetch.');
    return fetchAll();
  }
  const existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
  const terms = Array.isArray(existing.terms) ? existing.terms : [];
  const references = Array.isArray(existing.references) ? existing.references : [];
  const abbreviations = Array.isArray(existing.abbreviations) ? existing.abbreviations : [];
  console.log(`Loaded ${terms.length} existing terms + ${references.length} refs + ${abbreviations.length} abbrs from cache`);

  // Remove old version of this record (if present)
  const before = terms.length;
  const filtered = terms.filter(t => t.id !== recordId);
  const wasPresent = filtered.length < before;

  const basePayload = { references, abbreviations, generatedAt: new Date().toISOString() };

  if (term.status !== 'published') {
    console.log(`Removed non-published term (status: ${term.status}): ${term.slug || term.id}`);
    writeAtomic({ terms: filtered, ...basePayload });
    console.log(`Wrote ${filtered.length} terms to ${OUTPUT_PATH}`);
    return;
  }

  filtered.push(term);
  filtered.sort(sortTerms);
  writeAtomic({ terms: filtered, ...basePayload });
  console.log(`${wasPresent ? 'Updated' : 'Added'} term: ${term.slug || term.id}`);
  console.log(`Wrote ${filtered.length} terms to ${OUTPUT_PATH}`);
}

function sortTerms(a, b) {
  const partOrder = ['I','II','III','IV','V','VI','VII','VIII'];
  const pa = partOrder.indexOf(a.part);
  const pb = partOrder.indexOf(b.part);
  if (pa !== pb) return pa - pb;
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
}

async function fetchAll() {
  if (DRY_RUN) {
    const fallbackPath = OUTPUT_PATH;
    if (!existsSync(fallbackPath)) {
      console.error(`DRY-RUN: no existing ${fallbackPath} to replay`);
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(fallbackPath, 'utf-8'));
    console.log(`DRY-RUN: Loaded ${data.terms?.length || 0} terms from ${fallbackPath}`);
    return;
  }

  const token = process.env.LIBRARY_BUILD_TOKEN;
  if (!token) {
    console.error('Error: LIBRARY_BUILD_TOKEN environment variable required');
    process.exit(1);
  }

  console.log('Fetching all published glossary terms from D1...');
  const res = await fetchResponseWithRetry(GLOSSARY_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Glossary API ${res.status}: ${err}`);
  }

  const body = await res.json();
  if (!body.ok || !body.results) {
    throw new Error(`Glossary API error: ${body.error || 'no results'}`);
  }
  const { terms: rawTerms = [], references = [], abbreviations = [] } = body.results;
  const terms = rawTerms.map(cleanTerm);
  console.log(`Fetched ${terms.length} terms (sanitized) + ${references.length} references + ${abbreviations.length} abbreviations`);

  terms.sort(sortTerms);
  references.sort((a, b) => (a.refNum ?? 0) - (b.refNum ?? 0));
  abbreviations.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  writeAtomic({ terms, references, abbreviations, generatedAt: new Date().toISOString() });
  console.log(`Wrote ${terms.length} terms + ${references.length} refs + ${abbreviations.length} abbrs to ${OUTPUT_PATH}`);
}

const recordId = process.env.RECORD_ID;
const main = recordId ? () => fetchSingle(recordId) : fetchAll;

main().catch(err => {
  console.error(err);
  process.exit(1);
});
