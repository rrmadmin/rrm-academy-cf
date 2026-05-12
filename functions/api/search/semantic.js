import { CORS_HEADERS, roleAtLeast } from '../auth/_shared.js';
import { log } from '../_log.js';
import { logSearchQuery, hashIp, extractRequestMeta } from '../_search_log.js';

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

function shouldUseV2(tier, user) {
  if (tier === 'all') return true;
  if (tier === 'admin' && user && roleAtLeast(user.role, 'admin')) return true;
  return false;
}

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;
  const start = Date.now();
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) {
    return Response.json({ results: [], error: 'service_unavailable' }, { status: 503, headers: CORS_HEADERS });
  }
  const { user_agent_short, referer_path } = extractRequestMeta(request);

  if (!query || query.length < 2) {
    if (query && query.length > 0) {
      await logSearchQuery(env, {
        source: 'semantic',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 200,
        user_agent_short,
        referer_path,
      });
    }
    return Response.json({ results: [] }, { headers: CORS_HEADERS });
  }

  if (query.length > 500) {
    await logSearchQuery(env, {
      source: 'semantic',
      query,
      ip_hash: await hashIp(ip),
      results_count: 0,
      duration_ms: Date.now() - start,
      http_status: 400,
      user_agent_short,
      referer_path,
    });
    return Response.json({ results: [], error: 'query_too_long' }, { status: 400, headers: CORS_HEADERS });
  }

  // Rate limit by IP to protect billed AI/Vectorize calls
  if (isRateLimited(ip)) {
    return Response.json({ results: [], error: 'rate_limited' }, { status: 429, headers: CORS_HEADERS });
  }

  // Read v2 tier stamped by middleware; for anonymous users 'admin' tier falls back to v1
  const tier = context.data?.searchV2 || 'off';
  const sessionUser = context.data?.user || null;

  if (shouldUseV2(tier, sessionUser)) {
    // v2 path: service binding to rrm-ai-search Worker
    if (!env.AI_SEARCH) {
      log(env, waitUntil, 'search', 'v2_binding_missing', 'error', 'AI_SEARCH binding absent', 0, 503);
      await logSearchQuery(env, {
        source: 'semantic_v2',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 503,
        user_agent_short,
        referer_path,
      });
      return Response.json({ results: [], error: 'service_unavailable' }, { status: 503, headers: CORS_HEADERS });
    }
    if (!env.AI_SEARCH_WORKER_AUTH) {
      log(env, waitUntil, 'search', 'v2_auth_missing', 'error', 'AI_SEARCH_WORKER_AUTH secret absent', 0, 503);
      await logSearchQuery(env, {
        source: 'semantic_v2',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 503,
        user_agent_short,
        referer_path,
      });
      return Response.json({ results: [], error: 'service_unavailable' }, { status: 503, headers: CORS_HEADERS });
    }

    let v2Resp;
    try {
      v2Resp = await env.AI_SEARCH.fetch('https://internal/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.AI_SEARCH_WORKER_AUTH}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, top_k: 10 }),
      });
    } catch (err) {
      log(env, waitUntil, 'search', 'v2_fetch_error', 'error', err.message, Date.now() - start, 502);
      await logSearchQuery(env, {
        source: 'semantic_v2',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 502,
        user_agent_short,
        referer_path,
      });
      return Response.json({ results: [], error: 'search_failed' }, { status: 502, headers: CORS_HEADERS });
    }

    if (!v2Resp.ok) {
      log(env, waitUntil, 'search', 'v2_non2xx', 'error', String(v2Resp.status), Date.now() - start, 502);
      await logSearchQuery(env, {
        source: 'semantic_v2',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 502,
        user_agent_short,
        referer_path,
      });
      return Response.json({ results: [], error: 'search_failed' }, { status: 502, headers: CORS_HEADERS });
    }

    let v2Data;
    try {
      v2Data = await v2Resp.json();
    } catch (err) {
      log(env, waitUntil, 'search', 'v2_parse_error', 'error', err.message, Date.now() - start, 502);
      await logSearchQuery(env, {
        source: 'semantic_v2',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 502,
        user_agent_short,
        referer_path,
      });
      return Response.json({ results: [], error: 'search_failed' }, { status: 502, headers: CORS_HEADERS });
    }

    const results = Array.isArray(v2Data?.results) ? v2Data.results : [];
    await logSearchQuery(env, {
      source: 'semantic_v2',
      query,
      ip_hash: await hashIp(ip),
      results_count: results.length,
      duration_ms: Date.now() - start,
      http_status: 200,
      user_agent_short,
      referer_path,
    });
    return Response.json({ results }, { headers: CORS_HEADERS });
  }

  // v1 path: legacy Vectorize
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
      await logSearchQuery(env, {
        source: 'semantic',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 502,
        user_agent_short,
        referer_path,
      });
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
      const matchUrl = m.metadata.url || `/library/${m.metadata.slug}/`;
      const recMatch = matchUrl.match(/-(rec[a-zA-Z0-9]+)\/?$/);
      const dedupKey = recMatch ? recMatch[1].toLowerCase() : matchUrl.toLowerCase();
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      results.push({
        slug: m.metadata.slug,
        title: m.metadata.title,
        year: m.metadata.year,
        authors: m.metadata.authors,
        type: m.metadata.type || 'Research',
        score: m.score,
        url: matchUrl,
      });
    }

    await logSearchQuery(env, {
      source: 'semantic',
      query,
      ip_hash: await hashIp(ip),
      results_count: results.length,
      duration_ms: Date.now() - start,
      http_status: 200,
      user_agent_short,
      referer_path,
    });
    return Response.json({ results }, { headers: CORS_HEADERS });
  } catch (err) {
    log(env, waitUntil, 'search', 'semantic_error', 'error', err.message, 0, 500);
    await logSearchQuery(env, {
      source: 'semantic',
      query,
      ip_hash: await hashIp(ip),
      results_count: 0,
      duration_ms: Date.now() - start,
      http_status: 500,
      user_agent_short,
      referer_path,
    });
    return Response.json({ results: [], error: 'search_failed' }, { status: 500, headers: CORS_HEADERS });
  }
}
