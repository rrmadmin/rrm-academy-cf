/**
 * GET  /api/ask  — NLWeb capability JSON (unauth, no rate limit)
 * POST /api/ask  — Conversational AI: requires authenticated session
 *
 *  - GET returns capability metadata for NLWeb/orank discovery
 *  - POST without session: 401 → page JS redirects to /signup/?next=/ask
 *  - POST with session, non-member (free tier): 3 requests/day, base model
 *  - POST with session, STUC member or staff: 20 requests/day, V2 model
 *  - POST with session + Accept: text/event-stream: SSE-framed response
 */
import { json, optionsResponse, getSessionIdFromCookie, validateSession, roleAtLeast } from './auth/_shared.js';
import { validateBody } from './_validate.js';
import { log } from './_log.js';
import { logSearchQuery, hashIp, extractRequestMeta } from './_search_log.js';
import { SYSTEM_PROMPT } from './_ask_prompt.js';
import { requireMember } from './community/_shared.js';
import { withIdempotency } from './_idempotency.js';


async function hashShort(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function logAskQuery(env, waitUntil, request, message, userId, start, httpStatus, source) {
  const { user_agent_short, referer_path } = extractRequestMeta(request);
  // Hash the IP first (synchronous-ish via subtle.digest) before launching the
  // log; we want the bg promise to be self-contained so waitUntil can finish
  // after the response is already sent.
  const ipHash = await hashIp(request.headers.get('cf-connecting-ip') || '');
  const p = logSearchQuery(env, {
    source: source || 'ask',
    query: message,
    user_id: userId,
    ip_hash: ipHash,
    results_count: null,
    duration_ms: Date.now() - start,
    http_status: httpStatus,
    user_agent_short,
    referer_path,
  }).catch(() => { /* logSearchQuery swallows its own errors; this catch keeps the promise clean */ });
  if (typeof waitUntil === 'function') {
    waitUntil(p);
  } else {
    await Promise.race([
      p,
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
  }
}

function utcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

const RATE_LIMIT_MAX_MEMBER = 20;
const RATE_LIMIT_MAX_FREE = 3;
const RATE_LIMIT_TTL = 172800; // 48h in seconds
const META = { response_type: 'answer', version: 'nlweb-1.0' };

function shouldUseV2(tier, user) {
  if (tier === 'all') return true;
  if (tier === 'admin' && user && roleAtLeast(user.role, 'admin')) return true;
  return false;
}

/**
 * Returns null (not found / expired) or session object. Never throws.
 * Requires env.DB to already be checked before calling.
 */
async function tryGetSession(env, request) {
  try {
    const sessionId = getSessionIdFromCookie(request);
    return await validateSession(env.DB, sessionId);
  } catch {
    return null;
  }
}

function sseResponse(payload, status = 200, extraHeaders = {}) {
  const body = `retry: 60000\n\ndata: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': 'https://rrmacademy.org',
      'Access-Control-Allow-Credentials': 'true',
      ...extraHeaders,
    },
  });
}

/**
 * Shared upstream call. Returns { answer, citations } on success, or throws
 * with { httpStatus, errorCode } so callers can map to their response format.
 *
 * effectiveTier: when provided, overrides context.data.searchV2 for model
 * selection. Pass 'off' to force the base model regardless of feature flags.
 */
async function callUpstream(context, message, user, effectiveTier) {
  const { env, waitUntil } = context;
  const start = Date.now();
  const tier = effectiveTier !== undefined ? effectiveTier : (context.data?.searchV2 || 'off');

  if (shouldUseV2(tier, user)) {
    if (!env.AI_SEARCH) {
      const err = Object.assign(new Error('AI_SEARCH binding absent'), { httpStatus: 503, errorCode: 'service_unavailable' });
      log(env, waitUntil, 'ask', 'v2_binding_missing', 'error', 'AI_SEARCH binding absent', 0, 503);
      throw err;
    }
    if (!env.AI_SEARCH_WORKER_AUTH) {
      const err = Object.assign(new Error('AI_SEARCH_WORKER_AUTH absent'), { httpStatus: 503, errorCode: 'service_unavailable' });
      log(env, waitUntil, 'ask', 'v2_auth_missing', 'error', 'AI_SEARCH_WORKER_AUTH secret absent', 0, 503);
      throw err;
    }

    let v2Resp;
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
    } catch (fetchErr) {
      const isTimeout = fetchErr.name === 'AbortError' || fetchErr.name === 'TimeoutError';
      const httpStatus = isTimeout ? 504 : 502;
      const errorCode = isTimeout ? 'upstream_timeout' : 'upstream_error';
      log(env, waitUntil, 'ask', 'v2_fetch_error', 'error', fetchErr.message, Date.now() - start, httpStatus);
      throw Object.assign(new Error(errorCode), { httpStatus, errorCode });
    }

    if (!v2Resp.ok) {
      log(env, waitUntil, 'ask', 'v2_non2xx', 'error', String(v2Resp.status), Date.now() - start, 502);
      throw Object.assign(new Error('upstream_error'), { httpStatus: 502, errorCode: 'upstream_error' });
    }

    let v2Data;
    try {
      v2Data = await v2Resp.json();
    } catch (parseErr) {
      log(env, waitUntil, 'ask', 'v2_parse_error', 'error', parseErr.message, Date.now() - start, 502);
      throw Object.assign(new Error('upstream_error'), { httpStatus: 502, errorCode: 'upstream_error' });
    }

    if (typeof v2Data?.answer !== 'string') {
      log(env, waitUntil, 'ask', 'v2_no_answer', 'error', 'missing answer in v2 response', Date.now() - start, 502);
      throw Object.assign(new Error('upstream_error'), { httpStatus: 502, errorCode: 'upstream_error' });
    }

    if (v2Data.answer.length === 0) {
      return {
        answer: "I don't have information from the RRM Library that directly addresses this question. Try rephrasing, or browse [/library/](https://rrmacademy.org/library/) for related research.",
        citations: [],
        fallback: true,
      };
    }

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

    return { answer: v2Data.answer, citations };
  }

  // v1 path: legacy NLWeb AI Search proxy
  if (!env.NLWEB_SEARCH_URL) {
    throw Object.assign(new Error('service_unavailable'), { httpStatus: 503, errorCode: 'service_unavailable' });
  }

  let upstreamResp;
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
  } catch (fetchErr) {
    const isTimeout = fetchErr.name === 'AbortError' || fetchErr.name === 'TimeoutError';
    const httpStatus = isTimeout ? 504 : 502;
    const errorCode = isTimeout ? 'upstream_timeout' : 'upstream_error';
    log(env, waitUntil, 'ask', 'upstream_fetch_error', 'error', fetchErr.message, Date.now() - start, httpStatus);
    throw Object.assign(new Error(errorCode), { httpStatus, errorCode });
  }

  if (!upstreamResp.ok) {
    log(env, waitUntil, 'ask', 'upstream_non2xx', 'error', String(upstreamResp.status), Date.now() - start, 502);
    throw Object.assign(new Error('upstream_error'), { httpStatus: 502, errorCode: 'upstream_error' });
  }

  let upstreamData;
  try {
    upstreamData = await upstreamResp.json();
  } catch (parseErr) {
    log(env, waitUntil, 'ask', 'upstream_parse_error', 'error', parseErr.message, Date.now() - start, 502);
    throw Object.assign(new Error('upstream_error'), { httpStatus: 502, errorCode: 'upstream_error' });
  }

  const answer = upstreamData?.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || answer.length === 0) {
    log(env, waitUntil, 'ask', 'upstream_no_answer', 'error', 'empty or missing content in choices[0]', Date.now() - start, 502);
    throw Object.assign(new Error('upstream_error'), { httpStatus: 502, errorCode: 'upstream_error' });
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

  return { answer, citations };
}

async function handleAuthedAsk(context, session) {
  const { request, env, waitUntil } = context;
  const start = Date.now();

  const user = await env.DB.prepare(
    'SELECT id, role, blocked FROM user WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (user.blocked) {
    return json({ error: 'forbidden' }, 403);
  }

  // Determine membership: staff/STUC members get 20/day + V2; everyone else
  // gets free tier (3/day + base model). A non-member Response from requireMember
  // is interpreted as free tier — never returned to the caller.
  let memberAuth;
  try { memberAuth = await requireMember(request, env); } catch { memberAuth = null; }
  const isMember = memberAuth !== null && !(memberAuth instanceof Response);
  const rateLimitMax = isMember ? RATE_LIMIT_MAX_MEMBER : RATE_LIMIT_MAX_FREE;
  // Free users always get the base model regardless of the searchV2 feature flag.
  const effectiveTier = isMember ? (context.data?.searchV2 || 'off') : 'off';

  const rateLimitKey = `ask:rate:${user.id}:${utcDateKey()}`;
  let currentCount;
  try {
    const raw = await env.COMMUNITY_KV.get(rateLimitKey);
    currentCount = raw ? parseInt(raw, 10) : 0;
  } catch (err) {
    log(env, waitUntil, 'ask', 'kv_read_error', 'error', err.message, 0, 503);
    return json({ error: 'service_unavailable' }, 503);
  }

  if (currentCount >= rateLimitMax) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    const resetS = String(Math.max(0, Math.ceil((tomorrow.getTime() - Date.now()) / 1000)));
    return json({ error: 'rate_limited', reset: tomorrow.toISOString() }, 429, {
      'RateLimit-Limit': String(rateLimitMax),
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': resetS,
    });
  }

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
  const wantsSSE = (request.headers.get('Accept') || '').includes('text/event-stream') ||
    (request.headers.get('Accept') || '').includes('application/x-ndjson');

  // Increment BEFORE upstream call to close the check-then-act race window.
  // If the upstream call fails we refund by writing back the pre-increment count.
  const newCount = currentCount + 1;
  try {
    await env.COMMUNITY_KV.put(rateLimitKey, String(newCount), { expirationTtl: RATE_LIMIT_TTL });
  } catch (err) {
    log(env, waitUntil, 'ask', 'kv_write_error', 'error', err.message, 0, 503);
    return json({ error: 'service_unavailable' }, 503);
  }

  let result;
  try {
    result = await callUpstream(context, message, user, effectiveTier);
  } catch (upstreamErr) {
    // Refund the increment so a failed upstream call doesn't count against the user.
    waitUntil(
      env.COMMUNITY_KV.put(rateLimitKey, String(currentCount), { expirationTtl: RATE_LIMIT_TTL })
        .catch(refundErr => log(env, waitUntil, 'ask', 'kv_refund_error', 'warn', refundErr.message, 0, 0))
    );
    await logAskQuery(env, waitUntil, request, message, user.id, start, upstreamErr.httpStatus || 502, 'ask');
    return json({ error: upstreamErr.errorCode || 'upstream_error' }, upstreamErr.httpStatus || 502);
  }

  const httpStatus = 200;
  const durationMs = Date.now() - start;

  if (env.EVENTS) {
    const hashedQuery = await hashShort(message);
    const hashedUserId = await hashShort(user.id);
    env.EVENTS.writeDataPoint({
      blobs: ['rrm-academy', 'ask', 'query', String(httpStatus), hashedQuery, hashedUserId, context.data?.searchV2 === 'all' ? 'v2' : 'v1'],
      doubles: [durationMs, 1, httpStatus],
      indexes: ['ask'],
    });
  }

  const { user_agent_short, referer_path } = extractRequestMeta(request);
  const ipHash = await hashIp(request.headers.get('cf-connecting-ip') || '');
  // PF-F: move logging off the response-hot path. ANALYTICS_DB is a separate
  // D1 binding; an outage there should not 503 every /ask response.
  waitUntil(logSearchQuery(env, {
    source: context.data?.searchV2 === 'all' ? 'ask_v2' : 'ask',
    query: message,
    user_id: user.id,
    ip_hash: ipHash,
    results_count: null,
    duration_ms: durationMs,
    http_status: httpStatus,
    user_agent_short,
    referer_path,
  }).catch(() => {}));

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const askResetS = String(Math.max(0, Math.ceil((tomorrow.getTime() - Date.now()) / 1000)));
  const askRlHeaders = {
    'RateLimit-Limit': String(rateLimitMax),
    'RateLimit-Remaining': String(Math.max(0, rateLimitMax - newCount)),
    'RateLimit-Reset': askResetS,
  };

  const payload = { ...result, _meta: META };
  if (wantsSSE) {
    return sseResponse(payload, 200, askRlHeaders);
  }
  return json(payload, 200, askRlHeaders);
}

const CAPABILITY_JSON = {
  endpoint: '/api/ask',
  methods: ['GET', 'POST'],
  auth: {
    required: true,
    tiers: {
      free: '3 requests per day, base model',
      member: '20 requests per day, V2 model (STUC members and staff)',
    },
  },
  streaming: {
    supported: true,
    transport: 'text/event-stream',
    trigger: 'Accept: text/event-stream OR Accept: application/x-ndjson',
  },
  request: {
    POST: {
      content_type: 'application/json',
      body: { message: 'string, 2-500 chars' },
    },
  },
  response: {
    shape: { answer: 'string', citations: '{url, title?}[]', _meta: { response_type: 'string', version: 'string' } },
    sse_events: ['data: <answer-json>', 'data: [DONE]'],
  },
  guardrails: {
    scope: 'Restorative reproductive medicine education',
    do_not_use_for: ['medical advice', 'diagnosis', 'dosing recommendations'],
  },
  site: 'https://rrmacademy.org',
  library: 'https://rrmacademy.org/library/',
};

export async function onRequestGet() {
  return new Response(JSON.stringify(CAPABILITY_JSON), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': 'https://rrmacademy.org',
    },
  });
}

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  return withIdempotency(context, _handlePost);
}

async function _handlePost(context) {
  const { env, waitUntil, request } = context;
  const start = Date.now();

  if (!env.DB) {
    return json({ error: 'service_unavailable' }, 503);
  }
  if (!env.COMMUNITY_KV) {
    return json({ error: 'service_unavailable' }, 503);
  }

  const session = await tryGetSession(env, request);
  if (!session) {
    let message = '';
    try {
      const body = await request.json();
      if (body && typeof body.message === 'string') {
        message = body.message;
      }
    } catch {
      // unparseable/empty body — log with empty query rather than throwing
    }
    const { user_agent_short, referer_path } = extractRequestMeta(request);
    const ipHash = await hashIp(request.headers.get('cf-connecting-ip') || '');
    waitUntil(logSearchQuery(env, {
      source: 'ask_unauth_blocked',
      query: message,
      user_id: null,
      ip_hash: ipHash,
      results_count: null,
      duration_ms: Date.now() - start,
      http_status: 401,
      user_agent_short,
      referer_path,
    }).catch(() => {}));
    return json({ error: 'unauthorized' }, 401);
  }
  return handleAuthedAsk(context, session);
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method_not_allowed' }, 405);
}
