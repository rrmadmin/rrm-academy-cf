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

// --- Build unified vector entries ---

function buildEntries() {
  const entries = [];

  // Library articles
  for (const a of articles) {
    if (!a.slug || !a.title) continue;
    entries.push({
      slug: a.slug,
      text: a.title + '. ' + (a.abstract || ''),
      type: 'Research',
      url: `/library/${a.slug}/`,
      title: a.title,
      year: a.year || null,
      authors: a.shortCitation || '',
    });
  }

  // Commentary posts
  for (const p of posts) {
    if (!p.slug || !p.title) continue;
    entries.push({
      slug: `post-${p.slug}`,
      text: p.title + '. ' + (p.excerpt || ''),
      type: 'Article',
      url: `/commentary/${p.slug}/`,
      title: p.title,
      year: p.publishDate ? new Date(p.publishDate).getFullYear() : null,
      authors: p.author || '',
    });
  }

  // FAQs
  for (const f of faqs) {
    if (!f.slug || !f.question) continue;
    entries.push({
      slug: `faq-${f.slug}`,
      text: f.question + '. ' + (f.basicAnswer || f.publishedAnswer || ''),
      type: 'FAQ',
      url: `/faqs/${f.slug}/`,
      title: f.question,
      year: null,
      authors: '',
    });
  }

  // Courses
  for (const c of courses) {
    if (!c.slug || !c.title) continue;
    entries.push({
      slug: `course-${c.slug}`,
      text: c.title + '. ' + (c.description || c.shortDescription || ''),
      type: 'Course',
      url: `/courses/${c.slug}/`,
      title: c.title,
      year: null,
      authors: '',
    });
  }

  return entries;
}

const entries = buildEntries();
console.log(`Content: ${articles.length} articles, ${posts.length} posts, ${faqs.length} FAQs, ${courses.length} courses`);
console.log(`Total entries to embed: ${entries.length}`);

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
  const res = await fetch(
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.result.data;
}

async function upsertVectors(vectors) {
  const ndjson = vectors.map(v => JSON.stringify(v)).join('\n');
  const res = await fetch(
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vectorize API ${res.status}: ${err}`);
  }
  return res.json();
}

// --- Embed all entries ---

let embedded = 0;
for (let i = 0; i < entries.length; i += BATCH_SIZE) {
  const batch = entries.slice(i, i + BATCH_SIZE);

  const texts = batch.map(e => e.text.slice(0, MAX_TEXT_LEN));
  const embeddings = await getEmbeddings(texts);

  const vectors = batch.map((e, idx) => ({
    id: vectorId(e.slug),
    values: embeddings[idx],
    metadata: {
      slug: e.slug,
      title: e.title,
      year: e.year,
      authors: e.authors,
      type: e.type,
      url: e.url,
    },
  }));

  await upsertVectors(vectors);

  embedded += batch.length;
  console.log(`Embedded ${embedded}/${entries.length}...`);
}

console.log('Done. All content embedded.');
