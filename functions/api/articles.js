/**
 * GET /api/articles?page=N&limit=M
 *
 * Public unauth endpoint. Returns paginated published library articles.
 * Source: rrm-library-worker /articles (proxied with LIBRARY_BUILD_TOKEN).
 *
 * Rate limit: 30 req/min per IP (in-memory, per-isolate).
 * Cache: public, max-age=3600, s-maxage=3600.
 */
import { log } from './_log.js';

const WORKER_URL = 'https://rrm-library-worker.administrator-cloudflare.workers.dev';
const SITE_BASE = 'https://rrmacademy.org';

const PUBLIC_CORS = {
  'Access-Control-Allow-Origin': 'https://rrmacademy.org',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
};

// --- In-memory rate limiter: 30 req / 60s per IP ---
const articlesRateMap = new Map();
const ARTICLES_WINDOW_MS = 60 * 1000;
const ARTICLES_MAX = 30;

function checkArticlesRateLimit(key) {
  const now = Date.now();
  const entry = articlesRateMap.get(key);
  if (!entry || now - entry.start > ARTICLES_WINDOW_MS) {
    articlesRateMap.set(key, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  if (entry.count > ARTICLES_MAX) return false;
  return true;
}

function publicJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...PUBLIC_CORS, ...(status === 200 ? CACHE_HEADERS : {}) },
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

  const method = request.method;
  if (method !== 'GET') {
    return new Response(null, { status: 405, headers: { ...PUBLIC_CORS, Allow: 'GET' } });
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!checkArticlesRateLimit(`articles:${ip}`)) {
    return publicJson({ error: 'rate_limited' }, 429);
  }

  if (!env.LIBRARY_BUILD_TOKEN) {
    log(env, waitUntil, 'articles', 'missing_token', 'error', 'LIBRARY_BUILD_TOKEN unset', 0, 503);
    return publicJson({ error: 'service_unavailable' }, 503);
  }

  const url = new URL(request.url);

  const rawPage = url.searchParams.get('page') ?? '1';
  const rawLimit = url.searchParams.get('limit') ?? '25';

  const pageNum = Number(rawPage);
  const limitNum = Number(rawLimit);

  if (
    !Number.isInteger(pageNum) || !Number.isInteger(limitNum) ||
    pageNum < 1 || pageNum > 350 ||
    limitNum < 1 || limitNum > 50
  ) {
    return publicJson({ error: 'invalid_pagination' }, 400);
  }

  const offset = (pageNum - 1) * limitNum;

  const workerParams = new URLSearchParams({
    limit: String(limitNum),
    offset: String(offset),
  });

  let workerData;
  try {
    const resp = await fetch(`${WORKER_URL}/articles?${workerParams}`, {
      headers: { Authorization: `Bearer ${env.LIBRARY_BUILD_TOKEN}` },
    });
    if (!resp.ok) {
      log(env, waitUntil, 'articles', 'upstream_error', 'error', String(resp.status), 0, 503);
      return publicJson({ error: 'service_unavailable' }, 503);
    }
    workerData = await resp.json();
  } catch (err) {
    log(env, waitUntil, 'articles', 'fetch_error', 'error', err.message, 0, 503);
    return publicJson({ error: 'service_unavailable' }, 503);
  }

  const rawResults = Array.isArray(workerData?.results) ? workerData.results : [];
  const workerTotal = typeof workerData?.total === 'number' ? workerData.total : null;

  const results = rawResults.map(a => ({
    id: a.id,
    slug: a.slug,
    url: `${SITE_BASE}/library/${a.slug}/`,
    title: a.title,
    authors: a.authors,
    year: a.year,
    journal: a.journal,
    doi: a.doi,
    pmid: a.pmid,
    abstract: a.abstract,
    topics: Array.isArray(a.topics) ? a.topics : [],
    is_open_access: a.isOpenAccess === true,
    date_added: a.dateAddedToLibrary ? a.dateAddedToLibrary.slice(0, 10) : null,
  }));

  // total: the worker only returns an accurate total when offset=0 and results < limit.
  // For all other pages use a stable corpus estimate derived from the response.
  let total = typeof workerTotal === 'number' && workerTotal > 0
    ? workerTotal
    : offset + results.length + (workerData?.has_more ? limitNum : 0);

  const total_pages = Math.ceil(total / limitNum) || 1;

  return publicJson({
    page: pageNum,
    limit: limitNum,
    total,
    total_pages,
    results,
  });
}
