/**
 * Standalone script to fetch Airtable data and cache as JSON.
 * Run: AIRTABLE_PAT=xxx node src/lib/fetch-data.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'articles.json');

const AIRTABLE_BASE_ID = 'appyZWo2G7iByXCgZ';
const BIFID_TABLE_ID = 'tbloxbruSGmhZ23BC';
const API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BIFID_TABLE_ID}`;

const FIELDS = [
  '1️⃣ Title (static)',
  '1️⃣ Author(s)',
  '1️⃣ Year (static)',
  '1️⃣ Abstract (static)',
  '1️⃣ Journal (static)',
  '1️⃣ Journal Abbv (static)',
  '1️⃣ DOI (static)',
  '1️⃣ PMID (static)',
  '1️⃣ Source URL (static)',
  '1️⃣ SEO:Base-Slug (static)',
  '1️⃣ Date Published (static)',
  '1️⃣ Volume (static)',
  '1️⃣ Issue (static)',
  '1️⃣ Pages (static)',
  '1️⃣ Keywords (static)',
  '1️⃣ APA Citation (static)',
  '1️⃣ Vancouver Citation (static)',
  '1️⃣ MLA Citation (static)',
  '1️⃣ Topics (AI)',
  '1️⃣ Search Terms (AI)',
  '1️⃣ Approved or Not',
  'Enrichment Status',
  '1️⃣ Short Citation',
];

async function fetchAll() {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    console.error('Error: AIRTABLE_PAT environment variable required');
    process.exit(1);
  }

  const articles = [];
  let offset;
  let page = 0;

  const formula = encodeURIComponent(
    "AND({1️⃣ Approved or Not}!='DIS Approved',{Enrichment Status}!='')"
  );
  const fieldsParams = FIELDS.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');

  do {
    page++;
    const url = `${API_URL}?${fieldsParams}&filterByFormula=${formula}&pageSize=100${
      offset ? `&offset=${offset}` : ''
    }`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable ${res.status}: ${err}`);
    }

    const data = await res.json();
    offset = data.offset;

    for (const record of data.records) {
      const f = record.fields;
      const slug = f['1️⃣ SEO:Base-Slug (static)'];
      const title = f['1️⃣ Title (static)'];
      if (!slug || !title) continue;

      const keywords = f['1️⃣ Keywords (static)'] || '';
      const topicsRaw = f['1️⃣ Topics (AI)'] || '';
      const searchTermsRaw = f['1️⃣ Search Terms (AI)'] || '';

      articles.push({
        id: record.id,
        slug: slug.trim(),
        title: title.replace(/\.\s*$/, ''),
        authors: Array.isArray(f['1️⃣ Author(s)']) ? f['1️⃣ Author(s)'].join('; ') : (f['1️⃣ Author(s)'] || ''),
        shortCitation: f['1️⃣ Short Citation'] || '',
        year: f['1️⃣ Year (static)'] ? Number(f['1️⃣ Year (static)']) : null,
        abstract: f['1️⃣ Abstract (static)'] || '',
        journal: f['1️⃣ Journal (static)'] || '',
        journalAbbv: f['1️⃣ Journal Abbv (static)'] || '',
        doi: f['1️⃣ DOI (static)'] || '',
        pmid: f['1️⃣ PMID (static)'] || '',
        sourceUrl: f['1️⃣ Source URL (static)'] || '',
        datePublished: f['1️⃣ Date Published (static)'] || '',
        volume: f['1️⃣ Volume (static)'] || '',
        issue: f['1️⃣ Issue (static)'] || '',
        pages: f['1️⃣ Pages (static)'] || '',
        keywords,
        apaCitation: f['1️⃣ APA Citation (static)'] || '',
        vancouverCitation: f['1️⃣ Vancouver Citation (static)'] || '',
        mlaCitation: f['1️⃣ MLA Citation (static)'] || '',
        topics: topicsRaw ? topicsRaw.split('\n').map(t => t.trim()).filter(Boolean) : [],
        searchTerms: searchTermsRaw ? searchTermsRaw.split('\n').map(t => t.trim()).filter(Boolean) : [],
        enrichmentStatus: f['Enrichment Status'] || '',
        isOpenAccess: keywords.toLowerCase().includes('open access'),
      });
    }

    console.log(`Page ${page}: ${data.records.length} records (${articles.length} total)`);
  } while (offset);

  // Sort newest first
  articles.sort((a, b) => {
    if (!a.datePublished && !b.datePublished) return 0;
    if (!a.datePublished) return 1;
    if (!b.datePublished) return -1;
    return b.datePublished.localeCompare(a.datePublished);
  });

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(articles, null, 2));
  console.log(`\nWrote ${articles.length} articles to ${OUTPUT_PATH}`);
}

fetchAll().catch(err => {
  console.error(err);
  process.exit(1);
});
