/**
 * Shared retry-with-backoff for pipeline fetch scripts.
 * Used by fetch-data.mjs (D1 worker) and fetch-blog-data.mjs (Airtable).
 */

/**
 * @param {string} url
 * @param {RequestInit} options
 * @param {{ maxAttempts?: number, timeout?: number, allow404?: boolean }} [retry]
 * @returns {Promise<any>} Parsed JSON, or null if allow404 and status is 404
 */
export async function fetchWithRetry(url, options = {}, { maxAttempts = 5, timeout = 30000, allow404 = false } = {}) {
  let res;
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeout),
      });
      lastError = undefined;
      if (res.ok || (res.status !== 429 && res.status < 500)) break;
    } catch (e) {
      lastError = e;
    }
    const delay = Math.pow(2, attempt) * 1000;
    console.warn(`Retry ${attempt + 1}/${maxAttempts} in ${delay / 1000}s...`);
    await new Promise(r => setTimeout(r, delay));
  }

  if (lastError) throw lastError;
  if (allow404 && res?.status === 404) return null;
  if (!res || !res.ok) {
    const err = res ? await res.text() : 'No response';
    throw new Error(`HTTP ${res?.status}: ${err}`);
  }
  return res.json();
}
