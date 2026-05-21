/**
 * Unit tests for the Idempotency-Key wrapper at functions/api/_idempotency.js
 *
 * Covers the six rows of the behaviour table in the wrapper module:
 *   1. No header           -> handler default, no extra headers
 *   2. Header malformed    -> 400 invalid-idempotency-key
 *   3. KV unavailable      -> handler default, key echoed
 *   4. Cache miss          -> handler default, cached, key echoed
 *   5. Cache hit + match   -> cached body, Idempotency-Replayed: true
 *   6. Cache hit + mismatch-> 422 idempotency-mismatch
 *
 * Plus: streaming responses are not cached; non-2xx responses are not cached.
 *
 * Run with: node --test test/idempotency.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withIdempotency } from '../functions/api/_idempotency.js';

function makeKV() {
  const store = new Map();
  return {
    store,
    async get(key, opts) {
      const v = store.get(key);
      if (v === undefined) return null;
      if (opts && opts.type === 'json') return JSON.parse(v);
      return v;
    },
    async put(key, value /* , opts */) {
      store.set(key, value);
    },
  };
}

function makeContext({ method = 'POST', body = { foo: 'bar' }, key = null, url = 'https://rrmacademy.org/api/community/posts', kv } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (key !== null) headers.set('Idempotency-Key', key);
  const request = new Request(url, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const env = kv === false ? {} : { IDEMPOTENCY_KV: kv || makeKV() };
  const waitUntils = [];
  return {
    context: { request, env, waitUntil: (p) => waitUntils.push(p) },
    waitUntils,
    env,
  };
}

const VALID_KEY = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('idempotency: no header', () => {
  it('passes through, no extra headers', async () => {
    const { context } = makeContext({ key: null });
    let called = 0;
    const resp = await withIdempotency(context, async () => {
      called++;
      return new Response(JSON.stringify({ ok: true, id: '1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    });
    assert.equal(called, 1);
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('Idempotency-Replayed'), null);
    assert.equal(resp.headers.get('Idempotency-Key'), null);
  });
});

describe('idempotency: malformed header', () => {
  it('rejects with 400 when key is too short', async () => {
    const { context } = makeContext({ key: 'short' });
    let called = 0;
    const resp = await withIdempotency(context, async () => {
      called++;
      return new Response('{}');
    });
    assert.equal(called, 0);
    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.equal(body.error, 'invalid-idempotency-key');
  });

  it('rejects with 400 when key contains a space (outside printable-ASCII range 0x21-0x7e)', async () => {
    const { context } = makeContext({ key: 'has spaces in this key 123456' });
    const resp = await withIdempotency(context, async () => new Response('{}'));
    assert.equal(resp.status, 400);
  });

  it('accepts a 16-char key', async () => {
    const { context } = makeContext({ key: 'a'.repeat(16) });
    const resp = await withIdempotency(context, async () =>
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    assert.equal(resp.status, 200);
  });
});

describe('idempotency: KV unavailable', () => {
  it('passes through and echoes key when IDEMPOTENCY_KV is not bound', async () => {
    const { context } = makeContext({ key: VALID_KEY, kv: false });
    const resp = await withIdempotency(
      context,
      async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('Idempotency-Key'), VALID_KEY);
    assert.equal(resp.headers.get('Idempotency-Replayed'), null);
  });
});

describe('idempotency: cache miss', () => {
  it('runs handler, stores result, echoes key', async () => {
    const kv = makeKV();
    const { context, waitUntils } = makeContext({ key: VALID_KEY, kv });
    const resp = await withIdempotency(context, async () =>
      new Response(JSON.stringify({ ok: true, id: 'p1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('Idempotency-Key'), VALID_KEY);
    assert.equal(resp.headers.get('Idempotency-Replayed'), null);

    await Promise.all(waitUntils);
    assert.equal(kv.store.size, 1);
    const stored = JSON.parse([...kv.store.values()][0]);
    assert.equal(stored.status, 201);
    assert.match(stored.body, /"id":"p1"/);
    assert.equal(stored.headers['content-type'], 'application/json');
  });
});

describe('idempotency: cache hit (matching fingerprint)', () => {
  it('returns cached body with Idempotency-Replayed: true', async () => {
    const kv = makeKV();
    const body = { foo: 'bar' };

    // First call: populates the cache.
    const first = makeContext({ key: VALID_KEY, body, kv });
    let calls = 0;
    await withIdempotency(first.context, async () => {
      calls++;
      return new Response(JSON.stringify({ ok: true, id: 'p1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    });
    await Promise.all(first.waitUntils);

    // Second call with same key + body: replays cache, handler not called.
    const second = makeContext({ key: VALID_KEY, body, kv });
    const resp = await withIdempotency(second.context, async () => {
      calls++;
      return new Response('SHOULD NOT RUN', { status: 500 });
    });

    assert.equal(calls, 1, 'handler ran exactly once across both calls');
    assert.equal(resp.status, 201);
    assert.equal(resp.headers.get('Idempotency-Replayed'), 'true');
    assert.equal(resp.headers.get('Idempotency-Key'), VALID_KEY);
    const parsed = await resp.json();
    assert.equal(parsed.id, 'p1');
  });
});

describe('idempotency: cache hit with mismatched body', () => {
  it('returns 422 idempotency-mismatch', async () => {
    const kv = makeKV();

    // First call: stores fingerprint of {foo: 'bar'}
    const first = makeContext({ key: VALID_KEY, body: { foo: 'bar' }, kv });
    await withIdempotency(first.context, async () =>
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await Promise.all(first.waitUntils);

    // Second call: same key, different body.
    const second = makeContext({ key: VALID_KEY, body: { foo: 'DIFFERENT' }, kv });
    let secondCalled = 0;
    const resp = await withIdempotency(second.context, async () => {
      secondCalled++;
      return new Response('{}');
    });

    assert.equal(secondCalled, 0, 'handler must not run when fingerprint mismatches');
    assert.equal(resp.status, 422);
    const body = await resp.json();
    assert.equal(body.error, 'idempotency-mismatch');
  });
});

describe('idempotency: non-cacheable responses', () => {
  it('does not cache 5xx responses', async () => {
    const kv = makeKV();
    const { context, waitUntils } = makeContext({ key: VALID_KEY, kv });
    await withIdempotency(context, async () =>
      new Response('{"error":"oops"}', { status: 500, headers: { 'content-type': 'application/json' } }),
    );
    await Promise.all(waitUntils);
    assert.equal(kv.store.size, 0);
  });

  it('does not cache text/event-stream responses', async () => {
    const kv = makeKV();
    const { context, waitUntils } = makeContext({ key: VALID_KEY, kv });
    await withIdempotency(context, async () =>
      new Response('data: hi\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    await Promise.all(waitUntils);
    assert.equal(kv.store.size, 0);
  });
});

describe('idempotency: cache scoping by URL path', () => {
  it('separates keys by request path so the same key on two endpoints does not collide', async () => {
    const kv = makeKV();
    const a = makeContext({ key: VALID_KEY, url: 'https://rrmacademy.org/api/community/posts', body: { x: 1 }, kv });
    await withIdempotency(a.context, async () =>
      new Response('{"ok":true,"who":"posts"}', { status: 201, headers: { 'content-type': 'application/json' } }),
    );
    await Promise.all(a.waitUntils);

    const b = makeContext({ key: VALID_KEY, url: 'https://rrmacademy.org/api/community/comments', body: { x: 1 }, kv });
    const resp = await withIdempotency(b.context, async () =>
      new Response('{"ok":true,"who":"comments"}', { status: 201, headers: { 'content-type': 'application/json' } }),
    );
    await Promise.all(b.waitUntils);

    // The second call should NOT replay the first's result -- different URL path means different cache key.
    assert.equal(resp.headers.get('Idempotency-Replayed'), null);
    const parsed = await resp.json();
    assert.equal(parsed.who, 'comments');
    assert.equal(kv.store.size, 2);
  });
});
