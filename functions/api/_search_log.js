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
  if (!env.ANALYTICS_DB) return;
  if (!query) return;

  try {
    await env.ANALYTICS_DB.prepare(
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
  } catch {
    // Swallow all errors -- logging failure must not break caller
  }
}
