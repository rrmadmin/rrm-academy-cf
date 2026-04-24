/**
 * Shared retry-with-backoff for pipeline fetch scripts.
 *
 * Two public entry points:
 *   - fetchWithRetry(url, opts, retry)         — returns parsed JSON (or null on allow404)
 *   - fetchResponseWithRetry(url, opts, retry) — returns the Response object (caller parses)
 *
 * Both share retryFetch() internally; they differ only in how the final
 * Response is handled. Retry semantics are identical: retry on network errors,
 * 429, and 5xx; bail on 2xx and non-429 4xx. Exponential backoff (2^n seconds).
 *
 * Used by: fetch-data.mjs (D1 worker), fetch-blog-data.mjs, fetch-faq-data.mjs,
 * fetch-glossary-data.mjs, fetch-partners-data.mjs.
 */

/**
 * Core retry loop. Returns { res, lastError } — callers decide what to do.
 * When lastError is set, res may be undefined (last attempt threw). When res
 * is set and non-ok, that's the terminal non-retryable response (e.g. 404).
 *
 * @param {string} url
 * @param {RequestInit} options
 * @param {{ maxAttempts: number, timeout: number }} retry
 * @returns {Promise<{ res?: Response, lastError?: Error }>}
 */
async function retryFetch(url, options, { maxAttempts, timeout }) {
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
  return { res, lastError };
}

/**
 * Fetch with retry + JSON parse. Throws on network error or non-ok response;
 * returns null if allow404 is true and status is 404.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ maxAttempts?: number, timeout?: number, allow404?: boolean }} [retry]
 * @returns {Promise<any>} Parsed JSON, or null if allow404 and status is 404
 */
export async function fetchWithRetry(url, options = {}, { maxAttempts = 5, timeout = 30000, allow404 = false } = {}) {
  const { res, lastError } = await retryFetch(url, options, { maxAttempts, timeout });

  if (lastError) throw lastError;
  if (allow404 && res?.status === 404) return null;
  if (!res || !res.ok) {
    const err = res ? await res.text() : 'No response';
    throw new Error(`HTTP ${res?.status}: ${err}`);
  }
  return res.json();
}

/**
 * Fetch with retry, returning the raw Response. Caller handles `res.ok`
 * and parsing. Throws only on network-level failure after all retries;
 * 4xx/5xx responses propagate to the caller as non-ok Response objects.
 *
 * Use this variant when the caller needs to read `res.status`/`res.text()`
 * for custom error messages, or when response shape isn't JSON.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ maxAttempts?: number, timeout?: number }} [retry]
 * @returns {Promise<Response>}
 */
export async function fetchResponseWithRetry(url, options = {}, { maxAttempts = 5, timeout = 30000 } = {}) {
  const { res, lastError } = await retryFetch(url, options, { maxAttempts, timeout });

  if (lastError) throw lastError;
  if (!res) throw new Error('No response after retries');
  return res;
}
