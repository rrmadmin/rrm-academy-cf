import { CORS_HEADERS, optionsResponse, roleAtLeast, checkRateLimit } from '../auth/_shared.js';
import { log } from '../_log.js';
import { logSearchQuery, hashIp, extractRequestMeta } from '../_search_log.js';

function shouldUseV2(tier, user) {
  if (tier === 'all') return true;
  if (tier === 'admin' && user && roleAtLeast(user.role, 'admin')) return true;
  return false;
}

export function onRequestOptions() {
  return optionsResponse();
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
      waitUntil(logSearchQuery(env, {
        source: 'semantic',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 400,
        user_agent_short,
        referer_path,
      }).catch(() => {}));
    }
    return Response.json({ results: [], error: 'query_too_short' }, { status: 400, headers: CORS_HEADERS });
  }

  if (query.length > 500) {
    waitUntil(logSearchQuery(env, {
      source: 'semantic',
      query,
      ip_hash: await hashIp(ip),
      results_count: 0,
      duration_ms: Date.now() - start,
      http_status: 400,
      user_agent_short,
      referer_path,
    }).catch(() => {}));
    return Response.json({ results: [], error: 'query_too_long' }, { status: 400, headers: CORS_HEADERS });
  }

  // Rate limit by IP to protect billed AI/Vectorize calls
  const allowed = await checkRateLimit(env, `sem:${ip}`, 20, 60);
  if (!allowed) {
    return Response.json({ results: [], error: 'rate_limited' }, {
      status: 429,
      headers: { ...CORS_HEADERS, 'Retry-After': '60' },
    });
  }

  // Read v2 tier stamped by middleware; for anonymous users 'admin' tier falls back to v1
  const tier = context.data?.searchV2 || 'off';
  const sessionUser = context.data?.user || null;

  if (shouldUseV2(tier, sessionUser)) {
    // v2 path: service binding to rrm-ai-search Worker
    if (!env.AI_SEARCH) {
      log(env, waitUntil, 'search', 'v2_binding_missing', 'error', 'AI_SEARCH binding absent', 0, 503);
      waitUntil(logSearchQuery(env, {
        source: 'semantic_v2',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 503,
        user_agent_short,
        referer_path,
      }).catch(() => {}));
      return Response.json({ results: [], error: 'service_unavailable' }, { status: 503, headers: CORS_HEADERS });
    }
    if (!env.AI_SEARCH_WORKER_AUTH) {
      log(env, waitUntil, 'search', 'v2_auth_missing', 'error', 'AI_SEARCH_WORKER_AUTH secret absent', 0, 503);
      waitUntil(logSearchQuery(env, {
        source: 'semantic_v2',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 503,
        user_agent_short,
        referer_path,
      }).catch(() => {}));
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
      waitUntil(logSearchQuery(env, {
        source: 'semantic_v2',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 502,
        user_agent_short,
        referer_path,
      }).catch(() => {}));
      return Response.json({ results: [], error: 'search_failed' }, { status: 502, headers: CORS_HEADERS });
    }

    if (!v2Resp.ok) {
      log(env, waitUntil, 'search', 'v2_non2xx', 'error', String(v2Resp.status), Date.now() - start, 502);
      waitUntil(logSearchQuery(env, {
        source: 'semantic_v2',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 502,
        user_agent_short,
        referer_path,
      }).catch(() => {}));
      return Response.json({ results: [], error: 'search_failed' }, { status: 502, headers: CORS_HEADERS });
    }

    let v2Data;
    try {
      v2Data = await v2Resp.json();
    } catch (err) {
      log(env, waitUntil, 'search', 'v2_parse_error', 'error', err.message, Date.now() - start, 502);
      waitUntil(logSearchQuery(env, {
        source: 'semantic_v2',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 502,
        user_agent_short,
        referer_path,
      }).catch(() => {}));
      return Response.json({ results: [], error: 'search_failed' }, { status: 502, headers: CORS_HEADERS });
    }

    const results = Array.isArray(v2Data?.results) ? v2Data.results : [];
    if (!Array.isArray(v2Data?.results)) {
      const shape = Object.keys(v2Data || {}).join(',') || 'null';
      log(env, waitUntil, 'search', 'v2_shape_drift', 'warn', `v2Data.results not an array; v2Data keys=${shape}`, Date.now() - start, 200);
    }
    waitUntil(logSearchQuery(env, {
      source: 'semantic_v2',
      query,
      ip_hash: await hashIp(ip),
      results_count: results.length,
      duration_ms: Date.now() - start,
      http_status: 200,
      user_agent_short,
      referer_path,
    }).catch(() => {}));
    return Response.json({ results }, { headers: CORS_HEADERS });
  }

  // v1 path: legacy Vectorize
  try {
    if (!env.AI || !env.VECTORIZE) {
      return Response.json({ results: [], error: 'service_unavailable' }, { status: 503, headers: CORS_HEADERS });
    }

    // Embed the user's query (600ms timeout -- 2x client headroom)
    const SUBREQ_TIMEOUT_MS = 600;
    let embedding;
    try {
      embedding = await Promise.race([
        env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [query] }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ai_timeout')), SUBREQ_TIMEOUT_MS)),
      ]);
    } catch (aiErr) {
      const isTimeout = aiErr.message === 'ai_timeout';
      log(env, waitUntil, 'search', isTimeout ? 'ai_timeout' : 'ai_error', 'error', isTimeout ? 'AI.run timed out' : aiErr.message, Date.now() - start, isTimeout ? 503 : 502);
      waitUntil(logSearchQuery(env, {
        source: 'semantic',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: isTimeout ? 503 : 502,
        user_agent_short,
        referer_path,
      }).catch(() => {}));
      return Response.json({ results: [], error: isTimeout ? 'service_unavailable' : 'embedding_failed' }, { status: isTimeout ? 503 : 502, headers: CORS_HEADERS });
    }
    const queryVector = embedding.data?.[0];
    if (!queryVector) {
      const shape = Object.keys(embedding || {}).join(',') || 'null';
      log(env, waitUntil, 'search', 'embedding_failed', 'error', `AI returned no vector; embedding keys=${shape}`, 0, 502);
      waitUntil(logSearchQuery(env, {
        source: 'semantic',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: 502,
        user_agent_short,
        referer_path,
      }).catch(() => {}));
      return Response.json({ results: [], error: 'embedding_failed' }, { status: 502, headers: CORS_HEADERS });
    }

    // Find nearest neighbors (600ms timeout)
    let matches;
    try {
      matches = await Promise.race([
        env.VECTORIZE.query(queryVector, { topK: 10, returnMetadata: 'all' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('vectorize_timeout')), SUBREQ_TIMEOUT_MS)),
      ]);
    } catch (vErr) {
      const isTimeout = vErr.message === 'vectorize_timeout';
      log(env, waitUntil, 'search', isTimeout ? 'vectorize_timeout' : 'vectorize_error', 'error', isTimeout ? 'Vectorize timed out' : vErr.message, Date.now() - start, isTimeout ? 503 : 502);
      waitUntil(logSearchQuery(env, {
        source: 'semantic',
        query,
        ip_hash: await hashIp(ip),
        results_count: 0,
        duration_ms: Date.now() - start,
        http_status: isTimeout ? 503 : 502,
        user_agent_short,
        referer_path,
      }).catch(() => {}));
      return Response.json({ results: [], error: isTimeout ? 'service_unavailable' : 'search_failed' }, { status: isTimeout ? 503 : 502, headers: CORS_HEADERS });
    }

    const seen = new Set();
    const results = [];
    for (const m of matches.matches) {
      if (!m.metadata || (!m.metadata.url && !m.metadata.slug)) continue;
      const matchUrl = m.metadata.url || `/library/${m.metadata.slug}/`;
      const recMatch = matchUrl.match(/-(rec[a-zA-Z0-9]{14})\/?$/);
      const dedupKey = recMatch ? recMatch[1].toLowerCase() : matchUrl.toLowerCase();
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const result = {
        slug: m.metadata.slug,
        title: m.metadata.title,
        year: m.metadata.year,
        authors: m.metadata.authors,
        type: m.metadata.type || 'Research',
        score: m.score,
        url: matchUrl,
      };
      if (m.metadata.rrmRelevance != null) result.rrmRelevance = m.metadata.rrmRelevance;
      results.push(result);
    }

    waitUntil(logSearchQuery(env, {
      source: 'semantic',
      query,
      ip_hash: await hashIp(ip),
      results_count: results.length,
      duration_ms: Date.now() - start,
      http_status: 200,
      user_agent_short,
      referer_path,
    }).catch(() => {}));
    return Response.json({ results }, { headers: CORS_HEADERS });
  } catch (err) {
    log(env, waitUntil, 'search', 'semantic_error', 'error', err.message, 0, 500);
    waitUntil(logSearchQuery(env, {
      source: 'semantic',
      query,
      ip_hash: await hashIp(ip),
      results_count: 0,
      duration_ms: Date.now() - start,
      http_status: 500,
      user_agent_short,
      referer_path,
    }).catch(() => {}));
    return Response.json({ results: [], error: 'search_failed' }, { status: 500, headers: CORS_HEADERS });
  }
}
