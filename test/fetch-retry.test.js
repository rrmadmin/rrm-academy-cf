/**
 * Tests for src/lib/fetch-retry.mjs.
 *
 * Pins current behavior of fetchWithRetry (JSON-returning) AND the new
 * fetchResponseWithRetry (Response-returning) added by the dedupe work.
 *
 * Strategy: monkey-patch global fetch with a queue-driven stub. Each test
 * enqueues one or more responses (or errors); the stub pops the next entry
 * on each call. setTimeout is stubbed to fire immediately so tests don't
 * actually wait for backoff.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---- shared test harness ----

let fetchQueue = [];
let fetchCalls = [];
const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;

function mockResponse({ status = 200, body = {}, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() { return body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

function installStubs() {
  fetchQueue = [];
  fetchCalls = [];
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    if (fetchQueue.length === 0) {
      throw new Error(`fetch stub: queue empty (call #${fetchCalls.length} to ${url})`);
    }
    const next = fetchQueue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  // Zero-delay setTimeout so backoff waits don't slow the test suite.
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
}

function restoreStubs() {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
}

beforeEach(() => installStubs());
afterEach(() => restoreStubs());

// ---- fetchWithRetry (JSON-returning) ----

test('fetchWithRetry: returns parsed JSON on 200 first try', async () => {
  const { fetchWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(mockResponse({ body: { hello: 'world' } }));

  const result = await fetchWithRetry('https://example.test/api');

  assert.deepEqual(result, { hello: 'world' });
  assert.equal(fetchCalls.length, 1);
});

test('fetchWithRetry: retries on 429 then succeeds', async () => {
  const { fetchWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(mockResponse({ status: 429 }));
  fetchQueue.push(mockResponse({ status: 429 }));
  fetchQueue.push(mockResponse({ body: { ok: true } }));

  const result = await fetchWithRetry('https://example.test/api', {}, { maxAttempts: 5 });

  assert.deepEqual(result, { ok: true });
  assert.equal(fetchCalls.length, 3);
});

test('fetchWithRetry: retries on 500 then succeeds', async () => {
  const { fetchWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(mockResponse({ status: 500 }));
  fetchQueue.push(mockResponse({ body: { ok: true } }));

  const result = await fetchWithRetry('https://example.test/api');

  assert.deepEqual(result, { ok: true });
  assert.equal(fetchCalls.length, 2);
});

test('fetchWithRetry: does NOT retry on 404 (client error)', async () => {
  const { fetchWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(mockResponse({ status: 404, body: 'missing' }));

  await assert.rejects(
    () => fetchWithRetry('https://example.test/api'),
    /HTTP 404/,
  );
  assert.equal(fetchCalls.length, 1);
});

test('fetchWithRetry: allow404 returns null on 404 instead of throwing', async () => {
  const { fetchWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(mockResponse({ status: 404 }));

  const result = await fetchWithRetry('https://example.test/api', {}, { allow404: true });

  assert.equal(result, null);
});

test('fetchWithRetry: throws last error after maxAttempts exhausted', async () => {
  const { fetchWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(new Error('network down'));
  fetchQueue.push(new Error('network down'));
  fetchQueue.push(new Error('network down'));

  await assert.rejects(
    () => fetchWithRetry('https://example.test/api', {}, { maxAttempts: 3 }),
    /network down/,
  );
  assert.equal(fetchCalls.length, 3);
});

test('fetchWithRetry: forwards options to fetch', async () => {
  const { fetchWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(mockResponse({ body: {} }));

  await fetchWithRetry('https://example.test/api', {
    method: 'POST',
    headers: { 'X-Test': 'yes' },
    body: JSON.stringify({ a: 1 }),
  });

  assert.equal(fetchCalls[0].opts.method, 'POST');
  assert.equal(fetchCalls[0].opts.headers['X-Test'], 'yes');
  assert.equal(fetchCalls[0].opts.body, JSON.stringify({ a: 1 }));
});

// ---- fetchResponseWithRetry (Response-returning) ----

test('fetchResponseWithRetry: returns Response object unparsed on 200', async () => {
  const { fetchResponseWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(mockResponse({ body: { hello: 'world' } }));

  const res = await fetchResponseWithRetry('https://example.test/api');

  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { hello: 'world' });
});

test('fetchResponseWithRetry: retries on 500 then returns Response', async () => {
  const { fetchResponseWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(mockResponse({ status: 500 }));
  fetchQueue.push(mockResponse({ body: { ok: true } }));

  const res = await fetchResponseWithRetry('https://example.test/api');

  assert.equal(res.ok, true);
  assert.equal(fetchCalls.length, 2);
});

test('fetchResponseWithRetry: returns non-ok Response for 4xx (no retry, no throw)', async () => {
  const { fetchResponseWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(mockResponse({ status: 404 }));

  const res = await fetchResponseWithRetry('https://example.test/api');

  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
  assert.equal(fetchCalls.length, 1);
});

test('fetchResponseWithRetry: throws last error after maxAttempts on network failure', async () => {
  const { fetchResponseWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(new Error('timeout'));
  fetchQueue.push(new Error('timeout'));

  await assert.rejects(
    () => fetchResponseWithRetry('https://example.test/api', {}, { maxAttempts: 2 }),
    /timeout/,
  );
  assert.equal(fetchCalls.length, 2);
});

test('fetchResponseWithRetry: retries on 429', async () => {
  const { fetchResponseWithRetry } = await import('../src/lib/fetch-retry.mjs');
  fetchQueue.push(mockResponse({ status: 429 }));
  fetchQueue.push(mockResponse({ body: {} }));

  const res = await fetchResponseWithRetry('https://example.test/api');

  assert.equal(res.ok, true);
  assert.equal(fetchCalls.length, 2);
});
