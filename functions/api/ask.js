/**
 * POST /api/ask
 * Conversational AI endpoint: validates session, rate-limits per user/day via KV,
 * then proxies to Cloudflare AI Search /chat/completions.
 */
import { json, optionsResponse, getSessionIdFromCookie, validateSession } from './auth/_shared.js';
import { validateBody } from './_validate.js';
import { log } from './_log.js';

async function hashShort(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function utcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_TTL = 172800; // 48h in seconds

const SYSTEM_PROMPT = `You are the RRM Academy conversational research layer. Your answers are grounded strictly in the RRM Academy library (Dr. Naomi Whittaker and the restorative reproductive medicine literature).

EDITORIAL RULES (non-negotiable):
1. Never recommend IVF for any condition. When IVF is mentioned, describe what the library documents about IVF outcomes, then explain the RRM approach (diagnose and treat root causes). Do not present IVF as a "better choice" for severe endometriosis, older women, or any other scenario. Do not suggest "if you want something widely available, IVF".
2. For "unexplained infertility": open by reframing gently. In RRM, "unexplained" usually means "not yet diagnosed" -- underlying endometriosis, PCOS, sperm factor, thyroid, or progesterone deficiency are commonly missed. Acknowledge the user respectfully if they use the term. Never scold, never open with "actually your diagnosis is wrong". Lead with curiosity and hope.
3. RRM is evidence-based medicine grounded in reproductive physiology. Do not describe RRM as secular. Do not volunteer disclaimers about religion. Treat religion as relevant only if the user explicitly asks.
4. Never use em dashes (use a double-hyphen -- or restructure the sentence).
5. Refer to Dr. Phil Boyle as "Dr. Boyle", never "Phil".
6. Cite library URLs exactly as retrieved. Do not fabricate URLs, PMIDs, DOIs, or statistics.
7. End every answer with: Answers are AI-generated, verify against the cited library sources.

Answer concisely, warmly, and clinically. Keep the RRM lens (root-cause diagnosis, restorative treatment, natural conception) central.`;

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
    'SELECT id, blocked FROM user WHERE id = ?'
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
  let currentCount = 0;
  try {
    const raw = await env.COMMUNITY_KV.get(rateLimitKey);
    currentCount = raw ? parseInt(raw, 10) : 0;
  } catch (err) {
    log(env, waitUntil, 'ask', 'kv_read_error', 'error', err.message, 0, 500);
    return json({ error: 'service_error' }, 500);
  }

  if (currentCount >= RATE_LIMIT_MAX) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return json({ error: 'rate_limited', reset: tomorrow.toISOString() }, 429);
  }

  try {
    await env.COMMUNITY_KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: RATE_LIMIT_TTL });
  } catch (err) {
    log(env, waitUntil, 'ask', 'kv_write_error', 'error', err.message, 0, 500);
    return json({ error: 'service_error' }, 500);
  }

  // Parse and validate body
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

  // Env guard for upstream URL
  if (!env.NLWEB_SEARCH_URL) {
    return json({ error: 'service_unavailable' }, 503);
  }

  // Proxy to AI Search /chat/completions
  let upstreamResp;
  let httpStatus = 502;
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
    if (isTimeout) {
      return json({ error: 'upstream_timeout' }, 504);
    }
    return json({ error: 'upstream_error' }, 502);
  }

  if (!upstreamResp.ok) {
    httpStatus = 502;
    log(env, waitUntil, 'ask', 'upstream_non2xx', 'error', String(upstreamResp.status), Date.now() - start, 502);
    return json({ error: 'upstream_error' }, 502);
  }

  let upstreamData;
  try {
    upstreamData = await upstreamResp.json();
  } catch (err) {
    log(env, waitUntil, 'ask', 'upstream_parse_error', 'error', err.message, Date.now() - start, 502);
    return json({ error: 'upstream_error' }, 502);
  }

  const answer = upstreamData?.choices?.[0]?.message?.content;
  if (typeof answer !== 'string') {
    log(env, waitUntil, 'ask', 'upstream_no_answer', 'error', 'no content in choices[0]', Date.now() - start, 502);
    return json({ error: 'upstream_error' }, 502);
  }

  // Extract citations from AI Search response (may be in context or a citations field)
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

  // AE logging (direct writeDataPoint -- returns void, never wrap in waitUntil)
  if (env.EVENTS) {
    const hashedQuery = await hashShort(message);
    const hashedUserId = await hashShort(user.id);
    env.EVENTS.writeDataPoint({
      blobs: ['rrm-academy', 'ask', 'query', String(httpStatus), hashedQuery, hashedUserId],
      doubles: [durationMs, 1, httpStatus],
      indexes: ['ask'],
    });
  }

  return json({ answer, citations });
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method_not_allowed' }, 405);
}
