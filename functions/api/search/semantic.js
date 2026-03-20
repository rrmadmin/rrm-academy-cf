import { CORS_HEADERS } from '../auth/_shared.js';
import { log } from '../_log.js';

// Simple IP rate limiter: max 20 requests per minute per IP
const rateLimitMap = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60_000;

function isRateLimited(ip) {
  const now = Date.now();
  if (rateLimitMap.size > 10000) {
    for (const [k, v] of rateLimitMap) {
      if (now - v.start > RATE_WINDOW) {
        rateLimitMap.delete(k);
      }
    }
  }
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get('q');

  if (!query || query.length < 2) {
    return Response.json({ results: [] }, { headers: CORS_HEADERS });
  }

  if (query.length > 500) {
    return Response.json({ results: [], error: 'query_too_long' }, { status: 400, headers: CORS_HEADERS });
  }

  // Rate limit by IP to protect billed AI/Vectorize calls
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return Response.json({ results: [], error: 'rate_limited' }, { status: 429, headers: CORS_HEADERS });
  }

  try {
    if (!env.AI || !env.VECTORIZE) {
      return Response.json({ results: [], error: 'service_unavailable' }, { status: 503, headers: CORS_HEADERS });
    }

    // Embed the user's query
    const embedding = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [query],
    });
    const queryVector = embedding.data?.[0];
    if (!queryVector) {
      log(env, waitUntil, 'search', 'embedding_failed', 'error', 'AI returned no vector', 0, 502);
      return Response.json({ results: [], error: 'embedding_failed' }, { status: 502, headers: CORS_HEADERS });
    }

    // Find nearest neighbors
    const matches = await env.VECTORIZE.query(queryVector, {
      topK: 10,
      returnMetadata: 'all',
    });

    const seen = new Set();
    const results = [];
    for (const m of matches.matches) {
      if (!m.metadata || (!m.metadata.url && !m.metadata.slug)) continue;
      const url = m.metadata.url || `/library/${m.metadata.slug}/`;
      const recMatch = url.match(/-(rec[a-zA-Z0-9]+)\/?$/);
      const dedupKey = recMatch ? recMatch[1].toLowerCase() : url.toLowerCase();
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      results.push({
        slug: m.metadata.slug,
        title: m.metadata.title,
        year: m.metadata.year,
        authors: m.metadata.authors,
        type: m.metadata.type || 'Research',
        score: m.score,
        url,
      });
    }

    return Response.json({ results }, { headers: CORS_HEADERS });
  } catch (err) {
    log(env, waitUntil, 'search', 'semantic_error', 'error', err.message, 0, 500);
    return Response.json({ results: [], error: 'search_failed' }, { status: 500, headers: CORS_HEADERS });
  }
}
