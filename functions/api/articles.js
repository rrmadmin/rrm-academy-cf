/**
 * GET /api/articles?page=N&limit=M
 *
 * Public unauth endpoint. Returns paginated published library articles.
 * Source: rrm-library-worker /articles (proxied with LIBRARY_BUILD_TOKEN).
 *
 * Rate limit: 30 req/min per IP (KV-backed, global across isolates).
 * Cache: public, max-age=3600, s-maxage=3600.
 */
import { log } from './_log.js';
import { checkRateLimit } from './auth/_shared.js';
import { getRateLimitHeaders } from './_ratelimit-headers.js';
import { mapArticle } from './_map-article.js';

const WORKER_URL = 'https://rrm-library-worker.administrator-cloudflare.workers.dev';

const PUBLIC_CORS = {
  'Access-Control-Allow-Origin': 'https://rrmacademy.org',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
};


function publicJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...PUBLIC_CORS, ...(status === 200 ? CACHE_HEADERS : {}), ...extraHeaders },
  });
}

// Opaque cursor = base64url(JSON {o: offset, l: limit}). The upstream
// rrm-library-worker only accepts limit+offset (no keyset over the sort column
// is exposed), so this cursor is an ENCODED OFFSET, not a true keyset position.
// It is documented as such in openapi.json. Offset pagination (page/limit) keeps
// working unchanged when no cursor is supplied.
function encodeCursor(offset, limit) {
  return btoa(JSON.stringify({ o: offset, l: limit }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 128) return null;
  try {
    const parsed = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
    if (!Number.isInteger(parsed?.o) || !Number.isInteger(parsed?.l)) return null;
    return { o: parsed.o, l: parsed.l };
  } catch {
    return null;
  }
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

  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) {
    log(env, waitUntil, 'articles', 'missing_ip', 'error', 'cf-connecting-ip absent', 0, 503);
    return publicJson({ error: 'service_unavailable' }, 503);
  }
  const allowed = await checkRateLimit(env, `art:${ip}`, 30, 60);
  if (!allowed) {
    const rlHeaders = await getRateLimitHeaders(env, `art:${ip}`, 30, 60);
    return publicJson({ error: 'rate_limited' }, 429, rlHeaders);
  }

  if (!env.LIBRARY_BUILD_TOKEN) {
    log(env, waitUntil, 'articles', 'missing_token', 'error', 'LIBRARY_BUILD_TOKEN unset', 0, 503);
    return publicJson({ error: 'service_unavailable' }, 503);
  }

  const url = new URL(request.url);
  const rawCursor = url.searchParams.get('cursor');
  const rawPage = url.searchParams.get('page') ?? '1';
  const rawLimit = url.searchParams.get('limit') ?? '25';

  let pageNum, limitNum, offset;
  if (rawCursor !== null) {
    const decoded = decodeCursor(rawCursor);
    if (
      decoded === null ||
      decoded.o < 0 || decoded.o > 350 * 50 ||
      decoded.l < 1 || decoded.l > 50
    ) {
      return publicJson({ error: 'invalid_cursor' }, 400);
    }
    offset = decoded.o;
    limitNum = decoded.l;
    pageNum = Math.floor(offset / limitNum) + 1;
  } else {
    pageNum = Number(rawPage);
    limitNum = Number(rawLimit);
    if (
      !Number.isInteger(pageNum) || !Number.isInteger(limitNum) ||
      pageNum < 1 || pageNum > 350 ||
      limitNum < 1 || limitNum > 50
    ) {
      return publicJson({ error: 'invalid_pagination' }, 400);
    }
    offset = (pageNum - 1) * limitNum;
  }

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

  const results = rawResults.map(mapArticle);

  // total: the worker only returns an accurate total when offset=0 and results < limit.
  // For all other pages use a stable corpus estimate derived from the response.
  let total = typeof workerTotal === 'number' && workerTotal > 0
    ? workerTotal
    : offset + results.length + (workerData?.has_more ? limitNum : 0);

  const total_pages = Math.ceil(total / limitNum) || 1;

  // nextCursor is a full-page-gated encoded offset: only emit it when this page
  // was full AND the upstream signals more (has_more) or the estimated total
  // still exceeds what we've served. A partial page ends the walk (null).
  //
  // EQUIVALENT-MUTANT NOTE (checked 2026-07-31, do not re-derive):
  // `offset + results.length` and `offset + limitNum` cannot be told apart from
  // outside this function, so a mutant swapping them survives by construction,
  // not for want of a test. nextOffset is read in exactly three places, and all
  // three sit behind `results.length === limitNum` in the && chain below, which
  // short-circuits. Where the value can reach an output, results.length IS
  // limitNum, so the two expressions are the same number. Prefer the current
  // form: it stays honest if the short-circuit guard is ever loosened.
  const nextOffset = offset + results.length;
  const hasMore = results.length === limitNum &&
    (workerData?.has_more === true || nextOffset < total) &&
    nextOffset <= 350 * 50;
  const nextCursor = hasMore ? encodeCursor(nextOffset, limitNum) : null;

  const rlHeaders = await getRateLimitHeaders(env, `art:${ip}`, 30, 60);
  return publicJson({
    page: pageNum,
    limit: limitNum,
    total,
    total_pages,
    nextCursor,
    results,
  }, 200, rlHeaders);
}
