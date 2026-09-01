/**
 * Search query logging helper.
 * Writes to ANALYTICS_DB (rrm-analytics) search_log table.
 * Fail-open: if the binding is missing or the insert throws, swallows the error silently.
 * Logging failure must never break the caller's response path.
 */

export async function hashIp(ip) {
  if (!ip) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export function extractRequestMeta(request) {
  const ua = request.headers.get('user-agent') || null;
  const user_agent_short = ua ? ua.slice(0, 80) : null;

  const refererHeader = request.headers.get('referer') || null;
  let referer_path = null;
  if (refererHeader) {
    try {
      referer_path = new URL(refererHeader).pathname;
    } catch {
      referer_path = null;
    }
  }

  return { user_agent_short, referer_path };
}

export async function logSearchQuery(env, {
  source,
  query,
  user_id = null,
  ip_hash = null,
  results_count = null,
  duration_ms = null,
  http_status = null,
  user_agent_short = null,
  referer_path = null,
} = {}) {
  if (!env.ANALYTICS_DB) return null;
  if (!query) return null;

  try {
    const result = await env.ANALYTICS_DB.prepare(
      `INSERT INTO search_log
         (source, query, user_id, ip_hash, results_count, duration_ms, http_status, user_agent_short, referer_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      source,
      query.slice(0, 500),
      user_id || null,
      ip_hash || null,
      results_count !== undefined ? results_count : null,
      duration_ms !== undefined ? duration_ms : null,
      http_status !== undefined ? http_status : null,
      user_agent_short || null,
      referer_path || null,
    ).run();
    return result?.meta?.last_row_id ?? null;
  } catch (err) {
    // Fail-open per the module doc: the D1 insert failure must never break the
    // caller's response path. But swallowing it silently is what let months of
    // CHECK-constraint rejections go unnoticed, so surface it to Analytics
    // Engine -- the '_dropped' suffix is what the observatory's
    // data_loss_symptoms alert matches on. Shape mirrors log() (_log.js) /
    // logKvFailure (auth/_shared.js): blob1 'rrm-academy', event, action,
    // status, detail.
    try {
      env.EVENTS?.writeDataPoint({
        blobs: ['rrm-academy', 'search', 'search_log_dropped', 'error', String(err?.message || err).slice(0, 200)],
        doubles: [0, 1, 0],
        indexes: ['search_log_dropped'],
      });
    } catch {
      // AE write failure must never break the response path either.
    }
    return null;
  }
}

/**
 * Archives the answer a successful /api/ask call actually gave, so it can be
 * reviewed later. Fail-open, same posture as logSearchQuery(): a missing
 * binding or a failed insert must never break the caller's response path.
 * Callers run this off the response hot path via waitUntil().
 */
export async function logAskAnswer(env, {
  search_log_id = null,
  source,
  query,
  answer,
  citations = [],
  fallback = false,
  model = null,
  prompt_hash = null,
  tokens_in = null,
  tokens_out = null,
  duration_ms = null,
  user_id = null,
  ip_hash = null,
  eval_tag = null,
} = {}) {
  if (!env.ANALYTICS_DB) return null;
  if (!answer) return null;

  try {
    const result = await env.ANALYTICS_DB.prepare(
      `INSERT INTO ask_answer
         (search_log_id, source, query, answer, citations_json, fallback, model, prompt_hash, tokens_in, tokens_out, duration_ms, user_id, ip_hash, eval_tag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      search_log_id !== undefined ? search_log_id : null,
      source,
      query.slice(0, 500),
      answer,
      JSON.stringify(citations || []),
      fallback ? 1 : 0,
      model || null,
      prompt_hash || null,
      tokens_in !== undefined ? tokens_in : null,
      tokens_out !== undefined ? tokens_out : null,
      duration_ms !== undefined ? duration_ms : null,
      user_id || null,
      ip_hash || null,
      eval_tag || null,
    ).run();
    return result?.meta?.last_row_id ?? null;
  } catch (err) {
    // Same fail-open + surface-to-Analytics-Engine posture as
    // logSearchQuery()'s catch above.
    try {
      env.EVENTS?.writeDataPoint({
        blobs: ['rrm-academy', 'ask', 'ask_answer_dropped', 'error', String(err?.message || err).slice(0, 200)],
        doubles: [0, 1, 0],
        indexes: ['ask_answer_dropped'],
      });
    } catch {
      // AE write failure must never break the response path either.
    }
    return null;
  }
}

const _promptHashCache = new Map();

/**
 * sha256 of the UTF-8 bytes of `text`, hex, first 16 chars. Shared verbatim
 * with a separate eval worker -- this exact definition must not vary.
 * Cached per isolate so a stable prompt (e.g. SYSTEM_PROMPT) is hashed once.
 */
export async function promptHash(text) {
  if (_promptHashCache.has(text)) return _promptHashCache.get(text);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hash = Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  _promptHashCache.set(text, hash);
  return hash;
}
