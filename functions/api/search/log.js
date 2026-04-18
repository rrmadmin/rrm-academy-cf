/**
 * POST /api/search/log
 * Pagefind search beacon. Logs client-side search queries for content-gap analysis.
 * No auth required (Pagefind runs for signed-out users).
 * Reads session if present to include user_id.
 */
import { CORS_HEADERS, optionsResponse, getSessionIdFromCookie, validateSession } from '../auth/_shared.js';
import { logSearchQuery, hashIp, extractRequestMeta } from '../_search_log.js';

// Simple IP rate limiter: max 30 requests per minute per IP
const rateLimitMap = new Map();
const RATE_LIMIT = 30;
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

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return Response.json({ error: 'rate_limited' }, { status: 429, headers: CORS_HEADERS });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_input' }, { status: 400, headers: CORS_HEADERS });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'invalid_input' }, { status: 400, headers: CORS_HEADERS });
  }

  const { query, results_count, source } = body;

  if (typeof query !== 'string') {
    return Response.json({ error: 'invalid_input' }, { status: 400, headers: CORS_HEADERS });
  }
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2 || trimmedQuery.length > 500) {
    return Response.json({ error: 'invalid_input' }, { status: 400, headers: CORS_HEADERS });
  }

  if (typeof results_count !== 'number' || !Number.isInteger(results_count) || results_count < 0 || results_count > 200) {
    return Response.json({ error: 'invalid_input' }, { status: 400, headers: CORS_HEADERS });
  }

  if (source !== undefined && source !== 'pagefind') {
    return Response.json({ error: 'invalid_input' }, { status: 400, headers: CORS_HEADERS });
  }

  // Read session if present -- include user_id for authed users
  let userId = null;
  if (env.DB) {
    const sessionId = getSessionIdFromCookie(request);
    if (sessionId) {
      try {
        const session = await validateSession(env.DB, sessionId);
        if (session) userId = session.userId;
      } catch {
        // Non-blocking -- proceed without user_id
      }
    }
  }

  const { user_agent_short, referer_path } = extractRequestMeta(request);

  await logSearchQuery(env, {
    source: 'pagefind',
    query: trimmedQuery,
    user_id: userId,
    ip_hash: await hashIp(ip),
    results_count,
    duration_ms: null,
    http_status: 200,
    user_agent_short,
    referer_path,
  });

  return Response.json({ ok: true }, { headers: CORS_HEADERS });
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  if (context.request.method === 'POST') return onRequestPost(context);
  return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: CORS_HEADERS });
}
