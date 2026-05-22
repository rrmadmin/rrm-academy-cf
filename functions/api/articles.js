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


function publicJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...PUBLIC_CORS, ...(status === 200 ? CACHE_HEADERS : {}), ...extraHeaders },
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}

function mapArticle(a) {
  return {
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
  };
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
  const idsParam = url.searchParams.get('ids');

  if (idsParam !== null) {
    if (!/^[A-Za-z0-9-]+(,[A-Za-z0-9-]+){0,49}$/.test(idsParam)) {
      return publicJson({ error: 'invalid_ids' }, 400);
    }
    const rawIds = idsParam.split(',');
    const dedupedIds = [...new Set(rawIds)].slice(0, 50);
    const requested = dedupedIds.length;

    const results = [];
    const not_found = [];

    for (let i = 0; i < dedupedIds.length; i += 10) {
      const chunk = dedupedIds.slice(i, i + 10);
      const settled = await Promise.all(
        chunk.map(async id => {
          try {
            const resp = await fetch(`${WORKER_URL}/article/${id}`, {
              headers: { Authorization: `Bearer ${env.LIBRARY_BUILD_TOKEN}` },
            });
            if (resp.status === 200) {
              const data = await resp.json();
              return { ok: true, data };
            }
            return { ok: false, id };
          } catch {
            return { ok: false, id };
          }
        })
      );
      for (const r of settled) {
        if (r.ok) {
          results.push(mapArticle(r.data));
        } else {
          not_found.push(r.id);
        }
      }
    }

    const rlHeaders = await getRateLimitHeaders(env, `art:${ip}`, 30, 60);
    return publicJson({ results, not_found, requested, returned: results.length }, 200, rlHeaders);
  }

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

  const results = rawResults.map(mapArticle);

  // total: the worker only returns an accurate total when offset=0 and results < limit.
  // For all other pages use a stable corpus estimate derived from the response.
  let total = typeof workerTotal === 'number' && workerTotal > 0
    ? workerTotal
    : offset + results.length + (workerData?.has_more ? limitNum : 0);

  const total_pages = Math.ceil(total / limitNum) || 1;

  const rlHeaders = await getRateLimitHeaders(env, `art:${ip}`, 30, 60);
  return publicJson({
    page: pageNum,
    limit: limitNum,
    total,
    total_pages,
    results,
  }, 200, rlHeaders);
}
