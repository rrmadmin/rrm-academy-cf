/**
 * POST /api/ask
 * Conversational AI endpoint: validates session, rate-limits per user/day via KV,
 * then proxies to either the rrm-ai-search Worker (v2) or Cloudflare AI Search (v1)
 * based on the feature:search_v2 KV flag stamped by middleware.
 */
import { json, optionsResponse, getSessionIdFromCookie, validateSession, roleAtLeast } from './auth/_shared.js';
import { validateBody } from './_validate.js';
import { log } from './_log.js';
import { logSearchQuery, hashIp, extractRequestMeta } from './_search_log.js';
import { SYSTEM_PROMPT } from './_ask_prompt.js';

async function hashShort(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function logAskQuery(env, request, message, userId, start, httpStatus, source) {
  const { user_agent_short, referer_path } = extractRequestMeta(request);
  await logSearchQuery(env, {
    source: source || 'ask',
    query: message,
    user_id: userId,
    ip_hash: await hashIp(request.headers.get('cf-connecting-ip') || ''),
    results_count: null,
    duration_ms: Date.now() - start,
    http_status: httpStatus,
    user_agent_short,
    referer_path,
  });
}

function utcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_TTL = 172800; // 48h in seconds

function shouldUseV2(tier, user) {
  if (tier === 'all') return true;
  if (tier === 'admin' && user && roleAtLeast(user.role, 'admin')) return true;
  return false;
}

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  const start = Date.now();

  if (!env.DB) {
    return json({ error: 'service_unavailable' }, 503);
  }

  // Auth: require valid session
  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(env.DB, sessionId);
  if (!session) {
    return json({ error: 'unauthorized' }, 401);
  }

  const user = await env.DB.prepare(
    'SELECT id, role, blocked FROM user WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (user.blocked) {
    return json({ error: 'forbidden' }, 403);
  }

  // KV rate limit: 20 queries/day per user
  if (!env.COMMUNITY_KV) {
    return json({ error: 'service_unavailable' }, 503);
  }

  const rateLimitKey = `ask:rate:${user.id}:${utcDateKey()}`;
  let currentCount;
  try {
    const raw = await env.COMMUNITY_KV.get(rateLimitKey);
    currentCount = raw ? parseInt(raw, 10) : 0;
  } catch (err) {
    log(env, waitUntil, 'ask', 'kv_read_error', 'error', err.message, 0, 503);
    return json({ error: 'service_unavailable' }, 503);
  }

  if (currentCount >= RATE_LIMIT_MAX) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return json({ error: 'rate_limited', reset: tomorrow.toISOString() }, 429);
  }

  // Parse and validate body. The rate-limit counter is written only after a successful
  // upstream response, so server-side failures do not burn the user's daily quota.
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'invalid_input' }, 400);
  }

  const validated = validateBody(body, {
    message: { type: 'string', required: true, minLength: 2, maxLength: 500 },
  });
  if (!validated.valid) {
    return json({ error: 'invalid_input' }, 400);
  }

  const message = validated.data.message;

  // Read v2 tier stamped by middleware; default to 'off'
  const tier = context.data?.searchV2 || 'off';

  if (shouldUseV2(tier, user)) {
    // v2 path: service binding to rrm-ai-search Worker
    if (!env.AI_SEARCH) {
      log(env, waitUntil, 'ask', 'v2_binding_missing', 'error', 'AI_SEARCH binding absent', 0, 503);
      await logAskQuery(env, request, message, user.id, start, 503, 'ask_v2');
      return json({ error: 'service_unavailable' }, 503);
    }
    if (!env.AI_SEARCH_WORKER_AUTH) {
      log(env, waitUntil, 'ask', 'v2_auth_missing', 'error', 'AI_SEARCH_WORKER_AUTH secret absent', 0, 503);
      await logAskQuery(env, request, message, user.id, start, 503, 'ask_v2');
      return json({ error: 'service_unavailable' }, 503);
    }

    let v2Resp;
    let httpStatus;
    try {
      v2Resp = await env.AI_SEARCH.fetch('https://internal/ask', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.AI_SEARCH_WORKER_AUTH}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, editorialPrompt: SYSTEM_PROMPT }),
        signal: AbortSignal.timeout(28000),
      });
    } catch (err) {
      const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';
      httpStatus = isTimeout ? 504 : 502;
      log(env, waitUntil, 'ask', 'v2_fetch_error', 'error', err.message, Date.now() - start, httpStatus);
      await logAskQuery(env, request, message, user.id, start, httpStatus, 'ask_v2');
      if (isTimeout) {
        return json({ error: 'upstream_timeout' }, 504);
      }
      return json({ error: 'upstream_error' }, 502);
    }

    if (!v2Resp.ok) {
      log(env, waitUntil, 'ask', 'v2_non2xx', 'error', String(v2Resp.status), Date.now() - start, 502);
      await logAskQuery(env, request, message, user.id, start, 502, 'ask_v2');
      return json({ error: 'upstream_error' }, 502);
    }

    let v2Data;
    try {
      v2Data = await v2Resp.json();
    } catch (err) {
      log(env, waitUntil, 'ask', 'v2_parse_error', 'error', err.message, Date.now() - start, 502);
      await logAskQuery(env, request, message, user.id, start, 502, 'ask_v2');
      return json({ error: 'upstream_error' }, 502);
    }

    if (typeof v2Data?.answer !== 'string' || v2Data.answer.length === 0) {
      log(env, waitUntil, 'ask', 'v2_no_answer', 'error', 'empty or missing answer in v2 response', Date.now() - start, 502);
      await logAskQuery(env, request, message, user.id, start, 502, 'ask_v2');
      return json({ error: 'upstream_error' }, 502);
    }

    const answer = v2Data.answer;
    const rawCitations = v2Data.citations;
    const citations = Array.isArray(rawCitations)
      ? rawCitations
          .filter(c => c && typeof c.url === 'string')
          .map(c => {
            const out = { url: c.url };
            if (c.title && typeof c.title === 'string') out.title = c.title;
            return out;
          })
      : [];

    httpStatus = 200;
    const durationMs = Date.now() - start;

    if (env.EVENTS) {
      const hashedQuery = await hashShort(message);
      const hashedUserId = await hashShort(user.id);
      env.EVENTS.writeDataPoint({
        blobs: ['rrm-academy', 'ask', 'query', String(httpStatus), hashedQuery, hashedUserId, 'v2'],
        doubles: [durationMs, 1, httpStatus],
        indexes: ['ask'],
      });
    }

    const { user_agent_short, referer_path } = extractRequestMeta(request);
    await logSearchQuery(env, {
      source: 'ask_v2',
      query: message,
      user_id: user.id,
      ip_hash: await hashIp(request.headers.get('cf-connecting-ip') || ''),
      results_count: null,
      duration_ms: durationMs,
      http_status: httpStatus,
      user_agent_short,
      referer_path,
    });

    waitUntil(
      env.COMMUNITY_KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: RATE_LIMIT_TTL })
        .catch(err => log(env, waitUntil, 'ask', 'kv_write_error', 'warn', err.message, 0, 0))
    );

    return json({ answer, citations });
  }

  // v1 path: legacy NLWeb AI Search proxy
  if (!env.NLWEB_SEARCH_URL) {
    await logAskQuery(env, request, message, user.id, start, 503, 'ask');
    return json({ error: 'service_unavailable' }, 503);
  }

  let upstreamResp;
  let httpStatus;
  try {
    upstreamResp = await fetch(`${env.NLWEB_SEARCH_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: message }],
        stream: false,
      }),
      signal: AbortSignal.timeout(28000),
    });
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';
    httpStatus = isTimeout ? 504 : 502;
    log(env, waitUntil, 'ask', 'upstream_fetch_error', 'error', err.message, Date.now() - start, httpStatus);
    await logAskQuery(env, request, message, user.id, start, httpStatus, 'ask');
    if (isTimeout) {
      return json({ error: 'upstream_timeout' }, 504);
    }
    return json({ error: 'upstream_error' }, 502);
  }

  if (!upstreamResp.ok) {
    log(env, waitUntil, 'ask', 'upstream_non2xx', 'error', String(upstreamResp.status), Date.now() - start, 502);
    await logAskQuery(env, request, message, user.id, start, 502, 'ask');
    return json({ error: 'upstream_error' }, 502);
  }

  let upstreamData;
  try {
    upstreamData = await upstreamResp.json();
  } catch (err) {
    log(env, waitUntil, 'ask', 'upstream_parse_error', 'error', err.message, Date.now() - start, 502);
    await logAskQuery(env, request, message, user.id, start, 502, 'ask');
    return json({ error: 'upstream_error' }, 502);
  }

  const answer = upstreamData?.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || answer.length === 0) {
    log(env, waitUntil, 'ask', 'upstream_no_answer', 'error', 'empty or missing content in choices[0]', Date.now() - start, 502);
    await logAskQuery(env, request, message, user.id, start, 502, 'ask');
    return json({ error: 'upstream_error' }, 502);
  }

  const rawCitations =
    upstreamData?.choices?.[0]?.message?.citations ||
    upstreamData?.choices?.[0]?.message?.context ||
    [];
  const citations = Array.isArray(rawCitations)
    ? rawCitations
        .filter(c => c && typeof c.url === 'string')
        .map(c => {
          const out = { url: c.url };
          if (c.title && typeof c.title === 'string') out.title = c.title;
          return out;
        })
    : [];

  httpStatus = 200;
  const durationMs = Date.now() - start;

  if (env.EVENTS) {
    const hashedQuery = await hashShort(message);
    const hashedUserId = await hashShort(user.id);
    env.EVENTS.writeDataPoint({
      blobs: ['rrm-academy', 'ask', 'query', String(httpStatus), hashedQuery, hashedUserId, 'v1'],
      doubles: [durationMs, 1, httpStatus],
      indexes: ['ask'],
    });
  }

  const { user_agent_short, referer_path } = extractRequestMeta(request);
  await logSearchQuery(env, {
    source: 'ask',
    query: message,
    user_id: user.id,
    ip_hash: await hashIp(request.headers.get('cf-connecting-ip') || ''),
    results_count: null,
    duration_ms: durationMs,
    http_status: httpStatus,
    user_agent_short,
    referer_path,
  });

  waitUntil(
    env.COMMUNITY_KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: RATE_LIMIT_TTL })
      .catch(err => log(env, waitUntil, 'ask', 'kv_write_error', 'warn', err.message, 0, 0))
  );

  return json({ answer, citations });
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method_not_allowed' }, 405);
}
