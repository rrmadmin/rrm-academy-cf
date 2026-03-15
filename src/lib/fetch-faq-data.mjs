/**
 * Standalone script to fetch FAQ data from Airtable and cache as JSON.
 * Run: AIRTABLE_PAT=xxx node src/lib/fetch-faq-data.mjs
 *
 * Source: Airtable FAQ Knowledge Base (appIiligSFffFWwGA)
 *   - Unified FAQ Index (tblLSbusrE9jCfKEn) — main records
 *   - Evidence URLs (tblPa4CzwFBaCQTwP) — linked citations
 *
 * Cross-references inline citations in Published Answers against
 * articles.json (Research Library) to generate /library/{slug} links.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'faqs.json');
const ARTICLES_PATH = join(__dirname, '..', 'data', 'articles.json');
const DRY_RUN = process.argv.includes('--dry-run');

const AIRTABLE_BASE_ID = 'appIiligSFffFWwGA';
const FAQ_TABLE_ID = 'tblLSbusrE9jCfKEn';
const EVIDENCE_TABLE_ID = 'tblPa4CzwFBaCQTwP';
const API_BASE = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

// Actual Airtable field names (discovered via API probe)
const FAQ_FIELDS = [
  'FAQ ID',
  'Question',
  'Primary Question',
  'Published Answer',
  'Basic Answer',
  'Schema Answer',
  'SEO Title',
  'SEO Description',
  'Answer Status',
  'Type',
  'FAQ Evidence URLs',
  'Foundational FAQ',
  'Condition FAQ',
];

const EVIDENCE_FIELDS = [
  'Source Title',
  'URL',
  'Foundational FAQs',
  'Condition FAQs',
];

/**
 * Generate a URL-safe slug from a question string.
 * "What is RRM?" → "what-is-rrm"
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/['']/g, '')           // remove apostrophes/smart quotes
    .replace(/[^a-z0-9]+/g, '-')   // non-alphanumeric → hyphens
    .replace(/^-+|-+$/g, '')       // trim leading/trailing hyphens
    .slice(0, 80);                  // cap length
}

// ---------------------------------------------------------------------------
// Research Library cross-referencing
// ---------------------------------------------------------------------------

/**
 * Build an author+year index from articles.json for citation matching.
 * Returns Map<"lastname:year", article[]>
 *
 * Authors field uses two formats:
 *   "Adamson GD, Pasta DJ" — LastName Initials, comma-separated
 *   "Adamson, GD; Pasta, DJ" — LastName, Initials; semicolon-separated
 * We extract just the last name and index by lastname:year.
 */
function buildArticleIndex(articles) {
  const idx = new Map();

  for (const a of articles) {
    const authorsStr = a.authors || '';
    const year = a.year;
    if (!year || !authorsStr) continue;

    // Split authors: try semicolons first, fall back to commas
    const authors = authorsStr.includes(';')
      ? authorsStr.split(';')
      : authorsStr.split(',');

    for (const raw of authors) {
      const trimmed = raw.trim();
      if (!trimmed) continue;

      // Extract last name: first word (handles "Adamson GD", "Adamson", "Dunson DB")
      const lastname = trimmed.replace(/,/g, '').split(/\s+/)[0].toLowerCase();
      if (lastname.length < 3) continue;

      const key = `${lastname}:${year}`;
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(a);
    }
  }

  return idx;
}

/**
 * Extract (author, year) citation pairs from HTML text.
 * Handles: "Author et al., 2019", "Author & Other, 2014", "Author (2004)"
 */
function extractCitations(html) {
  const text = html.replace(/<[^>]+>/g, ' ');
  const patterns = [
    /([A-Z][a-zA-Z-]+)\s+et\s+al\.?,?\s*\(?(\d{4})\)?/g,
    /([A-Z][a-zA-Z-]+)\s+&\s+[A-Z][a-zA-Z-]+,?\s*\(?(\d{4})\)?/g,
    /([A-Z][a-zA-Z-]+)\s+\((\d{4})\)/g,
  ];

  const skip = new Set([
    'the', 'this', 'these', 'most', 'over', 'many', 'some', 'peak',
    'women', 'studies', 'international', 'royal', 'national', 'american',
  ]);

  const seen = new Set();
  const results = [];

  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(text)) !== null) {
      const author = match[1];
      const year = parseInt(match[2], 10);
      if (skip.has(author.toLowerCase())) continue;
      if (year < 1990 || year > 2026) continue;

      const key = `${author.toLowerCase()}:${year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ author, year });
    }
  }

  return results;
}

/**
 * Match extracted citations against the article index.
 * Returns array of { author, year, slug, title } for matches.
 * Allows +/-1 year tolerance for publication year mismatches.
 */
function matchCitations(citations, articleIndex) {
  const libraryRefs = [];
  const seen = new Set(); // deduplicate by slug

  for (const { author, year } of citations) {
    const authorLower = author.toLowerCase();

    // Try exact year, then +/-1, then +/-2 year tolerance
    let matches = null;
    for (const tryYear of [year, year - 1, year + 1, year - 2, year + 2]) {
      const key = `${authorLower}:${tryYear}`;
      const found = articleIndex.get(key);
      if (found && found.length > 0) {
        matches = found;
        break;
      }
    }

    if (!matches) continue;

    // Pick best match: prefer first-author match
    const best = matches.find(a => {
      const firstWord = (a.authors || '').trim().split(/[\s,;]/)[0].toLowerCase();
      return firstWord === authorLower;
    }) || matches[0];

    if (seen.has(best.slug)) continue;
    seen.add(best.slug);

    libraryRefs.push({
      author,
      year,
      slug: best.slug,
      title: best.title,
      shortCitation: best.shortCitation || `${author} et al., ${year}`,
    });
  }

  return libraryRefs;
}

// ---------------------------------------------------------------------------
// Airtable fetching
// ---------------------------------------------------------------------------

async function fetchTable(pat, tableId, fields, formula) {
  const records = [];
  let offset;
  let page = 0;

  const fieldsParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
  const formulaParam = formula ? `&filterByFormula=${encodeURIComponent(formula)}` : '';

  do {
    page++;
    const url = `${API_BASE}/${tableId}?${fieldsParams}${formulaParam}&pageSize=100${
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
      throw new Error(`Airtable ${res?.status}: ${err}`);
    }

    const data = await res.json();
    offset = data.offset;
    records.push(...data.records);

    console.log(`  Page ${page}: ${data.records.length} records (${records.length} total)`);
  } while (offset);

  return records;
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

  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    console.error('Error: AIRTABLE_PAT environment variable required');
    process.exit(1);
  }

  // 1. Load Research Library articles for cross-referencing
  let articleIndex = new Map();
  if (existsSync(ARTICLES_PATH)) {
    const articles = JSON.parse(readFileSync(ARTICLES_PATH, 'utf-8'));
    articleIndex = buildArticleIndex(articles);
    console.log(`Loaded ${articles.length} library articles (${articleIndex.size} author+year keys)\n`);
  } else {
    console.log('Warning: articles.json not found — skipping library cross-reference\n');
  }

  // 2. Fetch published FAQs
  console.log('Fetching published FAQs...');
  const faqRecords = await fetchTable(
    pat,
    FAQ_TABLE_ID,
    FAQ_FIELDS,
    "{Answer Status}='Published'"
  );

  // 3. Fetch evidence URL records and index by source FAQ ID
  console.log('\nFetching evidence URLs...');
  const evidenceRecords = await fetchTable(pat, EVIDENCE_TABLE_ID, EVIDENCE_FIELDS, '');

  // Map: source FAQ record ID → array of { title, url }
  const evidenceBySourceFaq = {};
  for (const rec of evidenceRecords) {
    const f = rec.fields;
    const url = f['URL'] || '';
    const title = f['Source Title'] || '';
    if (!title && !url) continue;

    const linkedFaqIds = [
      ...(Array.isArray(f['Foundational FAQs']) ? f['Foundational FAQs'] : []),
      ...(Array.isArray(f['Condition FAQs']) ? f['Condition FAQs'] : []),
    ];

    for (const faqId of linkedFaqIds) {
      if (!evidenceBySourceFaq[faqId]) evidenceBySourceFaq[faqId] = [];
      evidenceBySourceFaq[faqId].push({ title, url });
    }
  }

  // 5. Transform FAQ records
  const faqs = [];
  let totalLibraryRefs = 0;

  for (const record of faqRecords) {
    const f = record.fields;

    // Question: prefer direct 'Question' field, fall back to 'Primary Question' lookup
    const question = f['Question']
      || (Array.isArray(f['Primary Question']) ? f['Primary Question'][0] : '')
      || '';
    const faqId = f['FAQ ID'] || '';

    if (!question) {
      console.warn(`  Skipping ${faqId || record.id}: no question text`);
      continue;
    }

    // Category from Type field
    const type = f['Type'] || '';
    let category = 'Common Concerns';
    if (type === 'Foundational') category = 'Foundational';
    else if (type === 'Condition' || type === 'Condition-Specific') category = 'Condition-Specific';

    // Resolve evidence through source FAQ links
    const sourceLinks = [
      ...(Array.isArray(f['Foundational FAQ']) ? f['Foundational FAQ'] : []),
      ...(Array.isArray(f['Condition FAQ']) ? f['Condition FAQ'] : []),
    ];
    const evidence = [...(evidenceBySourceFaq[record.id] || [])];
    for (const srcId of sourceLinks) {
      if (evidenceBySourceFaq[srcId]) {
        evidence.push(...evidenceBySourceFaq[srcId]);
      }
    }

    // Cross-reference inline citations → Research Library
    const publishedAnswer = f['Published Answer'] || '';
    const citations = extractCitations(publishedAnswer);
    const libraryRefs = matchCitations(citations, articleIndex);
    totalLibraryRefs += libraryRefs.length;

    // Sort order: extract numeric part from FAQ ID (F01→1, C35→35)
    const idNum = parseInt(faqId.replace(/[^0-9]/g, ''), 10) || 999;
    const sortOrder = category === 'Foundational' ? idNum : 100 + idNum;

    faqs.push({
      id: record.id,
      faqId,
      slug: slugify(question),
      question: question.trim(),
      publishedAnswer,
      basicAnswer: f['Basic Answer'] || '',
      schemaAnswer: f['Schema Answer'] || '',
      seoTitle: f['SEO Title'] || '',
      seoDescription: f['SEO Description'] || '',
      sortOrder,
      category,
      evidence,
      libraryRefs,
    });
  }

  // 6. Sort by sortOrder ascending
  faqs.sort((a, b) => a.sortOrder - b.sortOrder);

  // 7. Write output
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpOutput = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpOutput, JSON.stringify(faqs, null, 2));
  renameSync(tmpOutput, OUTPUT_PATH);

  const foundational = faqs.filter(f => f.category === 'Foundational').length;
  const condition = faqs.filter(f => f.category === 'Condition-Specific').length;
  const commonConcerns = faqs.filter(f => f.category === 'Common Concerns').length;
  const withEvidence = faqs.filter(f => f.evidence.length > 0).length;
  const withLibraryRefs = faqs.filter(f => f.libraryRefs.length > 0).length;
  console.log(`\nWrote ${faqs.length} FAQs to ${OUTPUT_PATH}`);
  console.log(`  Foundational: ${foundational}, Condition-Specific: ${condition}, Common Concerns: ${commonConcerns}`);
  console.log(`  With evidence URLs: ${withEvidence}`);
  console.log(`  With library refs: ${withLibraryRefs} (${totalLibraryRefs} total links)`);
}

fetchAll().catch(err => {
  console.error(err);
  process.exit(1);
});
