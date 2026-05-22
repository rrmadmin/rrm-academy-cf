/**
 * RFC 9598 rate-limit header helper.
 *
 * Reads the current rate-limit bucket from COMMUNITY_KV without consuming a
 * slot and returns the three bare RFC 9598 headers. Returns an empty object on
 * any failure — headers are advisory, never a hard requirement.
 *
 * Bucket shape matches checkRateLimit() in auth/_shared.js:
 *   { count: number, start: number }   (start = unix epoch seconds)
 * Stored under key `rl:${key}`.
 */
export async function getRateLimitHeaders(env, key, max, windowS) {
  try {
    if (!env.COMMUNITY_KV) return {};
    const fullKey = `rl:${key}`;
    const raw = await env.COMMUNITY_KV.get(fullKey);
    if (!raw) {
      return {
        'RateLimit-Limit': String(max),
        'RateLimit-Remaining': String(max),
        'RateLimit-Reset': String(windowS),
      };
    }
    let bucket;
    try {
      bucket = JSON.parse(raw);
    } catch {
      return {};
    }
    if (typeof bucket !== 'object' || bucket === null || typeof bucket.count !== 'number' || typeof bucket.start !== 'number') {
      return {};
    }
    const nowS = Math.floor(Date.now() / 1000);
    const remaining = Math.max(0, max - bucket.count);
    const reset = Math.max(0, Math.ceil(bucket.start + windowS - nowS));
    return {
      'RateLimit-Limit': String(max),
      'RateLimit-Remaining': String(remaining),
      'RateLimit-Reset': String(reset),
    };
  } catch {
    return {};
  }
}
