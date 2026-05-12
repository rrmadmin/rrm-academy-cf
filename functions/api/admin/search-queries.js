/**
 * GET /api/admin/search-queries
 * SQL-aggregated views over the search_log table (rrm-analytics D1).
 * Protected by ADMIN_API_SECRET Bearer token (constant-time comparison).
 *
 * Query params:
 *   ?source      -- 'ask' | 'semantic' | 'pagefind' (optional)
 *   ?from        -- ISO date (optional, default 30 days ago)
 *   ?to          -- ISO date (optional, default now)
 *   ?zero_only   -- '1' returns only rows with results_count = 0
 *   ?q_like      -- substring filter on query text (% and _ escaped)
 *   ?view        -- 'list' (default) | 'top' | 'gaps' | 'users'
 *   ?limit       -- default 100, max 500
 *   ?offset      -- default 0
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';

const VALID_SOURCES = new Set(['ask', 'semantic', 'semantic_v2', 'pagefind', 'pagefind-mobile']);
const DEFAULT_DAYS = 30;

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.ADMIN_API_SECRET) {
    return json({ ok: false, error: 'Not configured' }, 503);
  }

  const auth = request.headers.get('Authorization') || '';
  const expected = `Bearer ${env.ADMIN_API_SECRET}`;
  const authBytes = new TextEncoder().encode(auth);
  const expectedBytes = new TextEncoder().encode(expected);
  let mismatch = authBytes.length !== expectedBytes.length ? 1 : 0;
  const len = Math.min(authBytes.length, expectedBytes.length);
  for (let i = 0; i < len; i++) {
    mismatch |= authBytes[i] ^ expectedBytes[i];
  }
  if (mismatch !== 0) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  if (!env.ANALYTICS_DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  const url = new URL(request.url);

  // Parse and validate query params
  const rawSource = url.searchParams.get('source') || '';
  const source = VALID_SOURCES.has(rawSource) ? rawSource : null;

  const defaultFrom = new Date(Date.now() - DEFAULT_DAYS * 86400 * 1000).toISOString().slice(0, 10);
  const defaultTo = new Date().toISOString().slice(0, 10);
  const dateRe = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/;

  const rawFrom = url.searchParams.get('from') || '';
  const from = rawFrom && dateRe.test(rawFrom) ? rawFrom : defaultFrom;

  const rawTo = url.searchParams.get('to') || '';
  const to = rawTo && dateRe.test(rawTo) ? rawTo : defaultTo;

  const zeroOnly = url.searchParams.get('zero_only') === '1';

  const rawQLike = url.searchParams.get('q_like') || '';
  const qLike = typeof rawQLike === 'string' && rawQLike.length > 0 && rawQLike.length <= 200
    ? rawQLike
    : null;

  const rawView = url.searchParams.get('view') || 'list';
  const view = ['list', 'top', 'gaps', 'users'].includes(rawView) ? rawView : 'list';

  const rawLimit = parseInt(url.searchParams.get('limit') || '100', 10);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 && rawLimit <= 500 ? rawLimit : 100;

  const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  // Build WHERE conditions (shared across views)
  const conditions = ['created_at >= ?', 'created_at <= ?'];
  const params = [from.slice(0, 10), to.slice(0, 10) + 'T23:59:59.999Z'];

  if (source) {
    conditions.push('source = ?');
    params.push(source);
  }
  if (zeroOnly || view === 'gaps') {
    conditions.push('results_count = 0');
  }
  if (qLike) {
    const escaped = qLike.replace(/%/g, '\\%').replace(/_/g, '\\_');
    conditions.push("query LIKE ? ESCAPE '\\'");
    params.push('%' + escaped + '%');
  }

  const where = 'WHERE ' + conditions.join(' AND ');

  try {
    if (view === 'list') {
      const countRow = await env.ANALYTICS_DB.prepare(
        `SELECT COUNT(*) AS total FROM search_log ${where}`
      ).bind(...params).first();
      const total = countRow?.total ?? 0;

      const rows = await env.ANALYTICS_DB.prepare(
        `SELECT id, source, query, user_id, ip_hash, results_count, duration_ms, http_status,
                user_agent_short, referer_path, created_at
         FROM search_log ${where}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      ).bind(...params, limit, offset).all();

      return json({ ok: true, results: rows.results ?? [], total });
    }

    if (view === 'top') {
      const rows = await env.ANALYTICS_DB.prepare(
        `SELECT query, COUNT(*) AS count
         FROM search_log ${where}
         GROUP BY query
         ORDER BY count DESC
         LIMIT ?`
      ).bind(...params, limit).all();

      return json({ ok: true, top: rows.results ?? [] });
    }

    if (view === 'gaps') {
      const rows = await env.ANALYTICS_DB.prepare(
        `SELECT query, COUNT(*) AS count
         FROM search_log ${where}
         GROUP BY query
         ORDER BY count DESC
         LIMIT ?`
      ).bind(...params, limit).all();

      return json({ ok: true, gaps: rows.results ?? [] });
    }

    if (view === 'users') {
      const row = await env.ANALYTICS_DB.prepare(
        `SELECT COUNT(DISTINCT user_id) AS users,
                COUNT(DISTINCT ip_hash) AS ips,
                COUNT(*) AS queries
         FROM search_log ${where}`
      ).bind(...params).first();

      return json({
        ok: true,
        summary: {
          users: row?.users ?? 0,
          ips: row?.ips ?? 0,
          queries: row?.queries ?? 0,
        },
      });
    }
  } catch (err) {
    log(env, waitUntil, 'admin', 'search_queries_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Query failed' }, 500);
  }
}
