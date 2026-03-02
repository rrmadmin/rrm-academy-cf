/**
 * Embed library articles into Cloudflare Vectorize via Workers AI.
 *
 * Runs as a Cloudflare Worker (via wrangler dev) to use AI + VECTORIZE bindings
 * directly with wrangler's OAuth auth -- no separate API token needed.
 *
 * Usage:
 *   npm run embed          # starts worker, triggers embed, shuts down
 *
 * Or manually:
 *   npx wrangler dev scripts/embed-library.mjs --compatibility-date 2025-01-01
 *   curl http://localhost:8787/embed
 */

import articles from '../src/data/articles.json';

const BATCH_SIZE = 100;
const MAX_TEXT_LEN = 2000;
const MODEL = '@cf/baai/bge-base-en-v1.5';
const MAX_ID_LEN = 64;

// Vectorize IDs max 64 bytes. Slugs can be 200+.
// Use a simple hash suffix to keep IDs unique when truncated.
const enc = new TextEncoder();
function vectorId(slug) {
  if (enc.encode(slug).length <= MAX_ID_LEN) return slug;
  // FNV-1a 32-bit hash of full slug, hex-encoded (8 chars)
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hash = (h >>> 0).toString(16).padStart(8, '0');
  // Truncate prefix by bytes: suffix is '-' + 8 hex = 9 bytes
  const maxPrefix = MAX_ID_LEN - 9; // 55 bytes for prefix
  let prefix = slug;
  while (enc.encode(prefix).length > maxPrefix) {
    prefix = prefix.slice(0, -1);
  }
  return prefix + '-' + hash;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/embed') {
      return new Response('GET /embed to start embedding', { status: 200 });
    }

    const logs = [];
    function log(msg) { logs.push(msg); }

    try {
      const startFrom = parseInt(url.searchParams.get('start') || '0');
      log(`Found ${articles.length} articles. Starting from ${startFrom}.`);
      let embedded = startFrom;

      for (let i = startFrom; i < articles.length; i += BATCH_SIZE) {
        const batch = articles.slice(i, i + BATCH_SIZE);

        // Build embedding text for each article
        const texts = batch.map(a => {
          const text = a.title + '. ' + (a.abstract || '');
          return text.slice(0, MAX_TEXT_LEN);
        });

        // Get embeddings via AI binding
        const result = await env.AI.run(MODEL, { text: texts });
        const embeddings = result.data;

        // Build vector objects
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

        // Upsert to Vectorize binding
        await env.VECTORIZE.upsert(vectors);

        embedded += batch.length;
        log(`Embedded ${embedded}/${articles.length}...`);
      }

      log('Done. All articles embedded.');
      return new Response(logs.join('\n'), {
        headers: { 'Content-Type': 'text/plain' },
      });
    } catch (err) {
      log(`Error: ${err.message}`);
      return new Response(logs.join('\n') + '\n\nFATAL: ' + err.stack, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
};
