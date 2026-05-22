/**
 * GET /api/articles/bulk?ids=a,b,c
 *
 * Public unauth endpoint. Bulk-fetch up to 50 published library articles by ID.
 * Source: rrm-library-worker /article/:id (proxied with LIBRARY_BUILD_TOKEN).
 *
 * Rate limit: shares the 30 req/min per IP budget with /api/articles.
 * Missing IDs are returned in not_found[] rather than producing a 404.
 */
import { log } from '../_log.js';
import { checkRateLimit } from '../auth/_shared.js';
import { getRateLimitHeaders } from '../_ratelimit-headers.js';
import { mapArticle } from '../_map-article.js';

const WORKER_URL = 'https://rrm-library-worker.administrator-cloudflare.workers.dev';

const PUBLIC_CORS = {
  'Access-Control-Allow-Origin': 'https://rrmacademy.org',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function publicJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...PUBLIC_CORS, ...extraHeaders },
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}

// HEAD parity with GET (RFC 9110 §9.3.2). Same status + headers, empty body.
// Consumes the same rate-limit budget as GET; agents using HEAD to probe
// RateLimit-* headers should expect that.
export async function onRequestHead(context) {
  const resp = await onRequestGet(context);
  return new Response(null, { status: resp.status, headers: resp.headers });
}

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) {
    log(env, waitUntil, 'articles_bulk', 'missing_ip', 'error', 'cf-connecting-ip absent', 0, 503);
    return publicJson({ error: 'service_unavailable' }, 503);
  }

  const allowed = await checkRateLimit(env, `art:${ip}`, 30, 60);
  if (!allowed) {
    const rlHeaders = await getRateLimitHeaders(env, `art:${ip}`, 30, 60);
    return publicJson({ error: 'rate_limited' }, 429, rlHeaders);
  }

  if (!env.LIBRARY_BUILD_TOKEN) {
    log(env, waitUntil, 'articles_bulk', 'missing_token', 'error', 'LIBRARY_BUILD_TOKEN unset', 0, 503);
    return publicJson({ error: 'service_unavailable' }, 503);
  }

  const url = new URL(request.url);
  const idsParam = url.searchParams.get('ids');

  if (idsParam === null || !/^[A-Za-z0-9-]+(,[A-Za-z0-9-]+){0,49}$/.test(idsParam)) {
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
