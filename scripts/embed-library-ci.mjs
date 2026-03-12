/**
 * CI-friendly library embedder. Uses Cloudflare REST APIs directly
 * (no wrangler dev / Worker bindings needed).
 *
 * Requires env vars: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 * Reads articles from src/data/articles.json
 *
 * Usage:
 *   node scripts/embed-library-ci.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTICLES_PATH = join(__dirname, '..', 'src', 'data', 'articles.json');

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

const articles = JSON.parse(readFileSync(ARTICLES_PATH, 'utf-8'));
console.log(`Loaded ${articles.length} articles`);

// Same ID logic as embed-library.mjs
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
  // Vectorize REST API expects NDJSON
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

let embedded = 0;
for (let i = 0; i < articles.length; i += BATCH_SIZE) {
  const batch = articles.slice(i, i + BATCH_SIZE);

  const texts = batch.map(a => {
    const text = a.title + '. ' + (a.abstract || '');
    return text.slice(0, MAX_TEXT_LEN);
  });

  const embeddings = await getEmbeddings(texts);

  const vectors = batch.map((a, idx) => ({
    id: vectorId(a.slug),
    values: embeddings[idx],
    metadata: {
      slug: a.slug,
      title: a.title,
      year: a.year || null,
      authors: a.shortCitation || '',
      type: 'Research',
    },
  }));

  await upsertVectors(vectors);

  embedded += batch.length;
  console.log(`Embedded ${embedded}/${articles.length}...`);
}

console.log('Done. All articles embedded.');
