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
      const f = record.fields;
      const slug = f['⚡️ SEO:Slug'];
      const title = f['⚡️ Title'];
      if (!slug || !title) continue;

      const oaFlag = f['⚡️ Is Open Access'] || '';
      const isOpenAccess = oaFlag === 'Open Access';
      const accessLevel = isOpenAccess ? 'open' : 'restricted';

      articles.push({
        id: record.id,
        slug: slug.trim(),
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
        topics: [],
        searchTerms: [],
        enrichmentStatus: f['Sync to RRM Library'] || '',
        identifiers: oaFlag ? [oaFlag] : [],
        isOpenAccess,
        isCopyrighted: oaFlag === '©',
        oaType: '',
        license: '',
        oaUrl: '',
        accessLevel,
        sentiment: f['⚡️ Sentiment (AI)'] || '',
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
