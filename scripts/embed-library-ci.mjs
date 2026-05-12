/**
 * CI-friendly site embedder. Uses Cloudflare REST APIs directly
 * (no wrangler dev / Worker bindings needed).
 *
 * Embeds all site content into Vectorize: library articles, commentary posts,
 * FAQs, and courses. Each gets a type tag for search result rendering.
 *
 * Requires env vars: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 *
 * Usage:
 *   node scripts/embed-library-ci.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');

const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const INDEX_NAME = 'rrm-library-vectors';
const MODEL = '@cf/baai/bge-base-en-v1.5';
const BATCH_SIZE = 100;
const MAX_TEXT_LEN = 2000;
const MAX_ID_LEN = 64;

if (!API_TOKEN || !ACCOUNT_ID) {
  console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID required');
  process.exit(1);
}

// --- Load all content sources ---

function loadJSON(filename) {
  const path = join(DATA_DIR, filename);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const articles = loadJSON('articles.json');
const posts = loadJSON('posts.json');
const faqs = loadJSON('faqs.json');
const courses = loadJSON('courses.json');
const guides = loadJSON('guides.json');
const glossary = (() => {
  const path = join(DATA_DIR, 'glossary.json');
  if (!existsSync(path)) return { terms: [] };
  return JSON.parse(readFileSync(path, 'utf-8'));
})();

// --- Build unified vector entries ---

function buildEntries() {
  const entries = [];

  // Library articles -- enrich with AI-generated metadata for better semantic matching
  for (const a of articles) {
    if (!a.slug || !a.title) continue;
    const parts = [a.title];
    if (a.domain) parts.push(`Domain: ${a.domain}`);
    if (a.topics && a.topics.length) parts.push(`Topics: ${a.topics.join('; ')}`);
    if (a.searchTerms && a.searchTerms.length) parts.push(a.searchTerms.join(', '));
    if (a.abstract) parts.push(a.abstract);
    entries.push({
      id: a.id,
      slug: a.slug,
      text: parts.join('. '),
      type: 'Research',
      url: `/library/${a.slug}/`,
      title: a.title,
      year: a.year || null,
      authors: a.shortCitation || '',
      rrmRelevance: a.rrmRelevance || null,
    });
  }

  // Commentary posts -- use full content for richer embeddings
  for (const p of posts) {
    if (!p.slug || !p.title) continue;
    const parts = [p.title];
    if (p.seoKeywords) parts.push(p.seoKeywords);
    if (p.excerpt) parts.push(p.excerpt);
    if (p.content) parts.push(p.content.replace(/[#*_\[\]()]/g, ' ').replace(/\s+/g, ' '));
    entries.push({
      slug: `post-${p.slug}`,
      text: parts.join('. '),
      type: 'Article',
      url: `/commentary/${p.slug}/`,
      title: p.title,
      year: p.publishDate ? new Date(p.publishDate).getFullYear() : null,
      authors: p.author || '',
    });
  }

  // FAQs -- embed full answer for intent matching
  for (const f of faqs) {
    if (!f.slug || !f.question) continue;
    const parts = [f.question];
    if (f.category) parts.push(`Category: ${f.category}`);
    if (f.publishedAnswer) parts.push(f.publishedAnswer.replace(/[#*_\[\]()]/g, ' ').replace(/\s+/g, ' '));
    else if (f.basicAnswer) parts.push(f.basicAnswer);
    entries.push({
      slug: `faq-${f.slug}`,
      text: parts.join('. '),
      type: 'FAQ',
      url: `/faqs/${f.slug}/`,
      title: f.question,
      year: null,
      authors: '',
    });
  }

  // Courses -- include section titles for topic coverage
  for (const c of courses) {
    if (!c.slug || !c.title) continue;
    const parts = [c.title];
    if (c.description) parts.push(c.description);
    if (c.sections) {
      const sectionTitles = c.sections.map(s => s.title || '').filter(Boolean);
      if (sectionTitles.length) parts.push('Sections: ' + sectionTitles.join(', '));
    }
    if (c.seo && c.seo.keywords) parts.push(c.seo.keywords);
    entries.push({
      slug: `course-${c.slug}`,
      text: parts.join('. '),
      type: 'Course',
      url: `/courses/${c.slug}/`,
      title: c.title,
      year: null,
      authors: '',
    });
  }

  // Glossary terms -- embed name + stripped body for definitional retrieval
  for (const t of glossary.terms || []) {
    if (!t.slug || !t.name) continue;
    const stripped = (t.bodyHtml || '')
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const parts = [t.name];
    if (stripped) parts.push(stripped);
    entries.push({
      slug: `glossary-${t.slug}`,
      text: parts.join('. '),
      type: 'Glossary',
      url: `/glossary/${t.slug}/`,
      title: t.name,
      year: null,
      authors: '',
    });
  }

  // Pillar guides -- title (3x for embedding-signal boost) + description + headings + FAQ + body
  // Title repetition compensates for the 2000-char text cap: pillar guides compete against
  // laser-focused PubMed-style article titles in semantic ranking, so the title alone needs
  // disproportionate weight in the resulting vector.
  for (const g of guides) {
    if (!g.slug || !g.title) continue;
    const parts = [g.title, g.title, g.title];
    if (g.description) parts.push(g.description);
    if (g.sectionHeadings && g.sectionHeadings.length) {
      parts.push('Sections: ' + g.sectionHeadings.join(', '));
    }
    if (g.keywordText) parts.push(g.keywordText);
    if (g.bodyText) parts.push(g.bodyText);
    entries.push({
      slug: `guide-${g.slug}`,
      text: parts.join('. '),
      type: 'Guide',
      url: g.url,
      title: g.title,
      year: null,
      authors: '',
    });
  }

  return entries;
}

const entries = buildEntries();
console.log(`Content: ${articles.length} articles, ${posts.length} posts, ${faqs.length} FAQs, ${courses.length} courses, ${(glossary.terms || []).length} glossary terms, ${guides.length} guides`);
console.log(`Total entries to embed: ${entries.length}`);

if (articles.length < 2500) {
  console.error(`ABORT: Expected >= 2500 articles but found ${articles.length}. Is articles.json missing or truncated?`);
  process.exit(1);
}

if (guides.length < 8) {
  console.error(`ABORT: Expected 8 pillar guide entries but found ${guides.length}. Did scripts/build-guides-data.mjs run as part of the build? Without this guard, stale-vector purge below would delete previously-embedded guide-* vectors.`);
  process.exit(1);
}

if (posts.length < 15) {
  console.error(`ABORT: Expected >= 15 posts but found ${posts.length}. Without this guard, stale-vector purge below would delete previously-embedded post-* vectors.`);
  process.exit(1);
}

if (faqs.length < 20) {
  console.error(`ABORT: Expected >= 20 FAQs but found ${faqs.length}. Without this guard, stale-vector purge below would delete previously-embedded faq-* vectors.`);
  process.exit(1);
}

if (courses.length < 8) {
  console.error(`ABORT: Expected >= 8 courses but found ${courses.length}. Without this guard, stale-vector purge below would delete previously-embedded course-* vectors.`);
  process.exit(1);
}

if ((glossary.terms || []).length < 100) {
  console.error(`ABORT: Expected >= 100 glossary terms but found ${(glossary.terms || []).length}. Without this guard, stale-vector purge below would delete previously-embedded glossary-* vectors.`);
  process.exit(1);
}

// --- Vector ID (same logic as embed-library.mjs) ---

const enc = new TextEncoder();
function vectorId(slug) {
  if (enc.encode(slug).length <= MAX_ID_LEN) return slug;
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hash = (h >>> 0).toString(16).padStart(8, '0');
  const maxPrefix = MAX_ID_LEN - 9;
  let prefix = slug;
  while (enc.encode(prefix).length > maxPrefix) {
    prefix = prefix.slice(0, -1);
  }
  return prefix + '-' + hash;
}

// --- Cloudflare API helpers ---

async function getEmbeddings(texts) {
  let res;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: texts }),
      }
    );
  } catch (err) {
    throw new Error(`AI API network error: ${err.message}`);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.result.data;
}

async function upsertVectors(vectors) {
  const ndjson = vectors.map(v => JSON.stringify(v)).join('\n');
  let res;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${INDEX_NAME}/upsert`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/x-ndjson',
        },
        body: ndjson,
      }
    );
  } catch (err) {
    throw new Error(`Vectorize upsert network error: ${err.message}`);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vectorize API ${res.status}: ${err}`);
  }
  return res.json();
}

async function deleteVectors(ids) {
  let res;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${INDEX_NAME}/delete_by_ids`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
      }
    );
  } catch (err) {
    throw new Error(`Vectorize delete network error: ${err.message}`);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vectorize delete API ${res.status}: ${err}`);
  }
  return res.json();
}

async function listVectorIds() {
  const ids = [];
  let cursor = null;
  while (true) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${INDEX_NAME}/list`);
    if (cursor) url.searchParams.set('cursor', cursor);
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      });
    } catch (err) {
      throw new Error(`Vectorize list network error: ${err.message}`);
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Vectorize list API ${res.status}: ${err}`);
    }
    const data = await res.json();
    // CF API has returned two shapes: { result: [...] } and { result: { vectors: [...] } }.
    // Accept either; skip silently on unexpected shapes (stale-purge fail-soft already covers).
    let entries = [];
    if (Array.isArray(data.result)) {
      entries = data.result;
    } else if (data.result && Array.isArray(data.result.vectors)) {
      entries = data.result.vectors;
    }
    for (const v of entries) {
      if (typeof v === 'string') ids.push(v);
      else if (v && typeof v.id === 'string') ids.push(v.id);
    }
    cursor = data.result_info?.cursor;
    if (!cursor) break;
  }
  return ids;
}

// --- Embed all entries ---

let embedded = 0;
for (let i = 0; i < entries.length; i += BATCH_SIZE) {
  const batch = entries.slice(i, i + BATCH_SIZE);

  const texts = batch.map(e => e.text.slice(0, MAX_TEXT_LEN));
  const embeddings = await getEmbeddings(texts);

  const vectors = batch.map((e, idx) => {
    const metadata = {
      slug: e.slug,
      title: e.title,
      authors: e.authors,
      type: e.type,
      url: e.url,
    };
    if (e.year != null) metadata.year = e.year;
    if (e.rrmRelevance != null) metadata.rrmRelevance = e.rrmRelevance;
    return { id: e.id || vectorId(e.slug), values: embeddings[idx], metadata };
  });

  await upsertVectors(vectors);

  embedded += batch.length;
  console.log(`Embedded ${embedded}/${entries.length}...`);
}

// --- Purge stale vectors ---

const upsertedIds = new Set(entries.map(e => e.id || vectorId(e.slug)));

let listFailed = false;
let staleIds = [];
try {
  console.log('Listing existing vectors to find stale entries...');
  const existingIds = await listVectorIds();
  staleIds = existingIds.filter(id => !upsertedIds.has(id));
} catch (err) {
  console.warn(`Warning: stale vector listing failed (${err.message}). Skipping purge; vectors were upserted successfully.`);
  listFailed = true;
}

if (!listFailed) {
  if (staleIds.length > 0) {
    console.log(`Found ${staleIds.length} stale vectors to delete...`);
    let deleteFailed = 0;
    for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
      const batch = staleIds.slice(i, i + BATCH_SIZE);
      try {
        await deleteVectors(batch);
      } catch (err) {
        console.error(`Failed to delete stale vector batch at index ${i}: ${err.message}`);
        deleteFailed += batch.length;
      }
    }
    if (deleteFailed > 0) {
      console.error(`ABORT: Failed to delete ${deleteFailed} of ${staleIds.length} stale vectors. Re-run embed to retry; stale vectors will surface in search until cleared.`);
      process.exit(1);
    }
    console.log(`Deleted ${staleIds.length} stale vectors.`);
  } else {
    console.log('No stale vectors found.');
  }
}

console.log('Done. All content embedded.');
