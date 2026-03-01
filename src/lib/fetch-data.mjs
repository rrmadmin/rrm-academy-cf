/**
 * Standalone script to fetch Airtable data and cache as JSON.
 * Run: AIRTABLE_PAT=xxx node src/lib/fetch-data.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { API_URL, FIELDS } from './airtable-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'articles.json');

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
      const f = record.fields;
      const slug = f['1️⃣ SEO:Slug'];
      const title = f['1️⃣ Title (static)'];
      if (!slug || !title) continue;

      const keywords = f['1️⃣ Keywords (static)'] || '';
      const topicsRaw = f['1️⃣ Topics (AI)'] || '';
      const searchTermsRaw = f['1️⃣ Search Terms (AI)'] || '';
      const identifiers = Array.isArray(f['1️⃣ Identifier (static)'])
        ? f['1️⃣ Identifier (static)']
        : [];

      const oaType = f['1️⃣ OA Type (static)'] || '';
      const license = f['1️⃣ License (static)'] || '';
      const oaUrl = f['1️⃣ OA URL (static)'] || '';

      // Compute 3-state access level
      let accessLevel = 'restricted';
      if (oaType) {
        if (['Gold', 'Diamond', 'Hybrid', 'Green'].includes(oaType)) accessLevel = 'open';
        else if (oaType === 'Bronze') accessLevel = 'free';
      } else {
        if (identifiers.includes('Open Access')) accessLevel = 'open';
        else if (identifiers.includes('Full Text')) accessLevel = 'free';
      }

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
        identifiers,
        isOpenAccess: accessLevel === 'open',
        isCopyrighted: identifiers.includes('©'),
        oaType,
        license,
        oaUrl,
        accessLevel,
        sentiment: f['1️⃣ Sentiment (AI)'] || '',
      });
    }

    console.log(`Page ${page}: ${data.records.length} records (${articles.length} total)`);
  } while (offset);

  // Sort newest first; treat 1900 placeholder dates as missing
  const hasDate = (d) => d && !d.startsWith('1900');
  articles.sort((a, b) => {
    const aOk = hasDate(a.datePublished);
    const bOk = hasDate(b.datePublished);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
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
