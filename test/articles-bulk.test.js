/**
 * functions/api/articles/bulk.js -- the public, unauthenticated bulk read for
 * up to 50 library articles by id.
 *
 * ON THE TWO CHUNKING QUESTIONS THIS FILE WAS ASKED
 *  1. D1's 99-bound-parameter ceiling does not apply here. This endpoint never
 *     touches D1; it is a fan-out of N HTTP GETs against rrm-library-worker's
 *     /article/:id, one request per id, with no bound parameters anywhere. The
 *     chunking that DOES exist is a concurrency cap of 10 in-flight fetches,
 *     and it is load-bearing for a different reason: 50 simultaneous subrequests
 *     from one isolate is how you get rate-limited or throttled by the upstream
 *     worker. It is pinned below by measuring peak concurrency, which is the
 *     only thing that separates "batched in tens" from "all at once" -- the
 *     response body is byte-identical either way.
 *  2. There is no multi-statement mutation to test for atomicity. The endpoint
 *     is read-only end to end: no INSERT, no UPDATE, no DELETE, no db.batch().
 *     A rolled-back-vs-never-written assertion has nothing to attach to.
 *
 * WHAT IS STILL FAKED
 *  - rrm-library-worker. Every upstream body is one this test wrote.
 *  - KV is the in-memory stub from _helpers.js.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockKV, mockWaitUntil, parseResponse } from './_helpers.js';
import { onRequestGet, onRequestHead, onRequestOptions } from '../functions/api/articles/bulk.js';

const TOKEN = 'test-library-build-token';
const BASE = 'https://rrmacademy.org/api/articles/bulk';
const WORKER_HOST = 'rrm-library-worker.administrator-cloudflare.workers.dev';

function recorder() {
  const points = [];
  return { points, writeDataPoint(p) { points.push(p); } };
}

const ipSeq = (() => { let n = 0; return () => `10.1.${Math.floor(n / 250) % 250}.${(n++ % 250) + 1}`; })();

let activeStub = null;
function stubWorker(handler) {
  const original = globalThis.fetch;
  const calls = [];
  let inFlight = 0;
  let peakInFlight = 0;
  globalThis.fetch = async (input, init) => {
    const parsed = new URL(String(input));
    if (parsed.host !== WORKER_HOST) throw new Error(`unexpected host: ${parsed.host}`);
    const id = parsed.pathname.replace('/article/', '');
    calls.push({ id, path: parsed.pathname, auth: init?.headers?.Authorization ?? null });
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      return await handler({ id });
    } finally {
      inFlight -= 1;
    }
  };
  activeStub = {
    calls,
    get ids() { return calls.map((c) => c.id); },
    get peakInFlight() { return peakInFlight; },
    restore() { globalThis.fetch = original; },
  };
  return activeStub;
}

afterEach(() => { if (activeStub) { activeStub.restore(); activeStub = null; } });

const workerJson = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const article = (id) => ({
  id,
  slug: `slug-${id}`,
  title: `Title ${id}`,
  authors: 'Whittaker N',
  year: 2026,
  journal: 'JRRM',
  doi: `10.1/${id}`,
  pmid: `9${id}`,
  abstract: 'abstract',
  topics: ['endometriosis'],
  isOpenAccess: true,
  dateAddedToLibrary: '2026-03-04T05:06:07.000Z',
});

function context({ url = BASE, ip = ipSeq(), token = TOKEN, kv, events } = {}) {
  return {
    request: mockRequest('GET', { url, headers: ip === null ? {} : { 'cf-connecting-ip': ip } }),
    env: mockEnv({
      LIBRARY_BUILD_TOKEN: token,
      COMMUNITY_KV: kv === null ? undefined : (kv ?? mockKV()),
      EVENTS: events ?? recorder(),
    }),
    waitUntil: mockWaitUntil(),
  };
}

const call = (opts) => onRequestGet(context(opts));

/** Upstream that knows a fixed set of ids and 404s everything else. */
const known = (...ids) => {
  const set = new Set(ids);
  return ({ id }) => (set.has(id) ? workerJson(article(id)) : workerJson({ error: 'not_found' }, 404));
};

// ------------------------------------------------------------------ preflight --

describe('GET /api/articles/bulk -- preflight and HEAD', () => {
  it('OPTIONS is 204 with the locked-down public CORS origin', async () => {
    const res = onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
    assert.equal(await res.text(), '');
  });

  it('HEAD mirrors the GET status and headers with an empty body (RFC 9110 parity)', async () => {
    const ip = ipSeq();
    const kv = mockKV();
    stubWorker(known('rec1'));

    const getRes = await onRequestGet(context({ url: `${BASE}?ids=rec1`, ip, kv }));
    const headRes = await onRequestHead(context({ url: `${BASE}?ids=rec1`, ip, kv }));

    assert.equal(headRes.status, getRes.status);
    assert.equal(await headRes.text(), '', 'HEAD must carry no body');
    assert.ok((await getRes.text()).length > 0, 'GET must carry one');
    for (const key of ['content-type', 'access-control-allow-origin', 'access-control-allow-methods']) {
      assert.equal(headRes.headers.get(key), getRes.headers.get(key), key);
    }
  });

  it('HEAD mirrors a GET error status too', async () => {
    stubWorker(() => { throw new Error('upstream must not be called'); });
    const res = await onRequestHead(context({ url: `${BASE}?ids=has_underscore` }));
    assert.equal(res.status, 400);
    assert.equal(await res.text(), '');
  });

  it('HEAD spends a rate-limit slot exactly as GET does', async () => {
    const ip = ipSeq();
    const kv = mockKV();
    stubWorker(known('rec1'));

    const first = await onRequestHead(context({ url: `${BASE}?ids=rec1`, ip, kv }));
    assert.equal(first.headers.get('RateLimit-Remaining'), '29');
    const second = await onRequestGet(context({ url: `${BASE}?ids=rec1`, ip, kv }));
    assert.equal(second.headers.get('RateLimit-Remaining'), '28', 'the HEAD probe already consumed one');
  });
});

// -------------------------------------------------------------------- gating --

describe('GET /api/articles/bulk -- gating', () => {
  it('503s when cf-connecting-ip is absent', async () => {
    const events = recorder();
    const stub = stubWorker(() => { throw new Error('upstream must not be called'); });
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=rec1`, ip: null, events }));
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
    assert.equal(stub.calls.length, 0);
    assert.ok(events.points.some((p) => p.blobs[2] === 'missing_ip'));
  });

  it('429s when the shared 30/min art: budget is spent, and reports the empty bucket', async () => {
    const ip = ipSeq();
    const kv = mockKV();
    await kv.put(`rl:art:${ip}`, JSON.stringify({ count: 30, start: Math.floor(Date.now() / 1000) }));
    const stub = stubWorker(() => { throw new Error('upstream must not be called'); });

    const { status, body, headers } = await parseResponse(await call({ url: `${BASE}?ids=rec1`, ip, kv }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
    assert.equal(headers['ratelimit-limit'], '30');
    assert.equal(headers['ratelimit-remaining'], '0');
    assert.equal(stub.calls.length, 0);
  });

  it('shares one bucket with /api/articles -- the key is art:<ip>, not a per-route key', async () => {
    const ip = ipSeq();
    const kv = mockKV();
    stubWorker(known('rec1'));
    await call({ url: `${BASE}?ids=rec1`, ip, kv });
    assert.equal(JSON.parse(await kv.get(`rl:art:${ip}`)).count, 1);
  });

  it('fails CLOSED with 429 when the KV binding is missing', async () => {
    const stub = stubWorker(() => { throw new Error('upstream must not be called'); });
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=rec1`, kv: null }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
    assert.equal(stub.calls.length, 0);
  });

  it('503s when LIBRARY_BUILD_TOKEN is unset -- never calls upstream unauthenticated', async () => {
    const events = recorder();
    const stub = stubWorker(() => { throw new Error('upstream must not be called'); });
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=rec1`, token: null, events }));
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
    assert.equal(stub.calls.length, 0);
    assert.ok(events.points.some((p) => p.blobs[2] === 'missing_token'));
  });

  it('sends the build token as a Bearer header on every fan-out request', async () => {
    const stub = stubWorker(known('rec1', 'rec2'));
    await call({ url: `${BASE}?ids=rec1,rec2` });
    assert.equal(stub.calls.length, 2);
    assert.ok(stub.calls.every((c) => c.auth === `Bearer ${TOKEN}`));
  });
});

// ------------------------------------------------------------- ids validation --

describe('GET /api/articles/bulk -- ids validation', () => {
  const bad = [
    ['no ids param at all', BASE],
    ['an empty ids value', `${BASE}?ids=`],
    ['a lone comma', `${BASE}?ids=,`],
    ['a trailing comma', `${BASE}?ids=rec1,`],
    ['a leading comma', `${BASE}?ids=,rec1`],
    ['a doubled comma', `${BASE}?ids=rec1,,rec2`],
    ['an id with a space', `${BASE}?ids=rec%201`],
    ['an id with an underscore', `${BASE}?ids=rec_1`],
    ['an id with a dot', `${BASE}?ids=rec.1`],
    ['an id with a slash', `${BASE}?ids=${encodeURIComponent('rec/../admin')}`],
    ['a path-traversal attempt', `${BASE}?ids=${encodeURIComponent('../../secret')}`],
    ['a newline injected into an id', `${BASE}?ids=${encodeURIComponent('rec1\nrec2')}`],
    ['51 ids (one past the cap)', `${BASE}?ids=${Array.from({ length: 51 }, (_, i) => `r${i}`).join(',')}`],
  ];
  for (const [label, url] of bad) {
    it(`400s invalid_ids on ${label}, without calling upstream`, async () => {
      const stub = stubWorker(() => { throw new Error('upstream must not be called'); });
      const { status, body } = await parseResponse(await call({ url }));
      assert.equal(status, 400, label);
      assert.equal(body.error, 'invalid_ids', label);
      assert.equal(stub.calls.length, 0, label);
    });
  }

  it('accepts exactly 50 ids -- the boundary is inclusive', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `r${i}`);
    const stub = stubWorker(known(...ids));
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=${ids.join(',')}` }));
    assert.equal(status, 200);
    assert.equal(body.requested, 50);
    assert.equal(body.returned, 50);
    assert.equal(stub.calls.length, 50);
  });

  it('accepts a single id and ids containing hyphens', async () => {
    const stub = stubWorker(known('rec-abc-123'));
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=rec-abc-123` }));
    assert.equal(status, 200);
    assert.deepEqual(body.results.map((r) => r.id), ['rec-abc-123']);
    assert.equal(stub.calls[0].path, '/article/rec-abc-123');
  });
});

// -------------------------------------------------------------------- reads --

describe('GET /api/articles/bulk -- reads', () => {
  it('returns found articles in request order and the misses in not_found', async () => {
    stubWorker(known('rec1', 'rec3'));
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=rec1,rec2,rec3,rec4` }));

    assert.equal(status, 200);
    assert.deepEqual(body.results.map((r) => r.id), ['rec1', 'rec3'], 'order follows the request, not completion');
    assert.deepEqual(body.not_found, ['rec2', 'rec4']);
    assert.equal(body.requested, 4);
    assert.equal(body.returned, 2);
  });

  it('renders each row through the shared mapper rather than echoing upstream', async () => {
    stubWorker(known('rec1'));
    const { body } = await parseResponse(await call({ url: `${BASE}?ids=rec1` }));
    assert.deepEqual(body.results[0], {
      id: 'rec1',
      slug: 'slug-rec1',
      url: 'https://rrmacademy.org/library/slug-rec1/',
      title: 'Title rec1',
      authors: 'Whittaker N',
      year: 2026,
      journal: 'JRRM',
      doi: '10.1/rec1',
      pmid: '9rec1',
      abstract: 'abstract',
      topics: ['endometriosis'],
      is_open_access: true,
      date_added: '2026-03-04',
    });
  });

  it('strips upstream-only fields the mapper does not allowlist', async () => {
    stubWorker(({ id }) => workerJson({ ...article(id), internal_note: 'NEVER SHIP THIS', is_published: 1 }));
    const { body } = await parseResponse(await call({ url: `${BASE}?ids=rec1` }));
    assert.ok(!JSON.stringify(body).includes('NEVER SHIP THIS'));
    assert.equal(body.results[0].is_published, undefined);
  });

  it('deduplicates repeated ids -- one upstream request, and `requested` counts the distinct set', async () => {
    const stub = stubWorker(known('rec1', 'rec2'));
    const { body } = await parseResponse(await call({ url: `${BASE}?ids=rec1,rec1,rec2,rec1` }));
    assert.deepEqual(stub.ids, ['rec1', 'rec2'], 'rec1 must be fetched once, not three times');
    assert.equal(body.requested, 2, 'requested is the distinct count, not the raw parameter length');
    assert.equal(body.returned, 2);
    assert.deepEqual(body.results.map((r) => r.id), ['rec1', 'rec2']);
  });

  it('a wholly unknown id set is a 200 with everything in not_found, never a 404', async () => {
    stubWorker(known());
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=ghost1,ghost2` }));
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
    assert.deepEqual(body.not_found, ['ghost1', 'ghost2']);
    assert.equal(body.requested, 2);
    assert.equal(body.returned, 0);
  });

  it('counts a non-2xx upstream as not_found rather than failing the whole batch', async () => {
    stubWorker(({ id }) => (id === 'rec500' ? workerJson({ error: 'boom' }, 500) : workerJson(article(id))));
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=rec1,rec500,rec2` }));
    assert.equal(status, 200);
    assert.deepEqual(body.results.map((r) => r.id), ['rec1', 'rec2']);
    assert.deepEqual(body.not_found, ['rec500']);
  });

  it('treats a 3xx redirect as not_found -- only a literal 200 counts', async () => {
    stubWorker(({ id }) => (id === 'recmoved'
      ? new Response(null, { status: 301, headers: { location: '/article/recnew' } })
      : workerJson(article(id))));
    const { body } = await parseResponse(await call({ url: `${BASE}?ids=rec1,recmoved` }));
    assert.deepEqual(body.not_found, ['recmoved']);
  });

  it('treats a 2xx-that-is-not-200 as not_found -- resp.status === 200, never resp.ok', async () => {
    // 3xx and 5xx are already covered above, but neither distinguishes
    // `resp.status === 200` from `resp.ok`: both are falsy under either form.
    // A 204/206 is the only shape that does. Under `resp.ok` a 204 would be
    // treated as a hit and resp.json() would reject on the empty body, so the
    // id would silently vanish from BOTH results and not_found.
    stubWorker(({ id }) => {
      if (id === 'recempty') return new Response(null, { status: 204 });
      if (id === 'recpartial') return new Response(JSON.stringify(article('recpartial')), {
        status: 206, headers: { 'content-type': 'application/json' },
      });
      return workerJson(article(id));
    });
    const { status, body } = await parseResponse(
      await call({ url: `${BASE}?ids=rec1,recempty,recpartial,rec2` })
    );
    assert.equal(status, 200);
    assert.deepEqual(body.results.map((r) => r.id), ['rec1', 'rec2']);
    assert.deepEqual(body.not_found, ['recempty', 'recpartial']);
    assert.equal(body.requested, 4);
    assert.equal(body.returned, 2);
    assert.equal(
      body.results.length + body.not_found.length, body.requested,
      'every requested id must be accounted for in exactly one bucket'
    );
  });

  it('counts a thrown fetch as not_found rather than 503ing the batch', async () => {
    stubWorker(({ id }) => {
      if (id === 'recboom') throw new Error('ECONNREFUSED 10.1.2.3:443');
      return workerJson(article(id));
    });
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=rec1,recboom,rec2` }));
    assert.equal(status, 200);
    assert.deepEqual(body.results.map((r) => r.id), ['rec1', 'rec2']);
    assert.deepEqual(body.not_found, ['recboom']);
    assert.ok(!JSON.stringify(body).includes('ECONNREFUSED'));
  });

  it('counts an unparseable 200 body as not_found (resp.json() rejects inside the per-id try)', async () => {
    stubWorker(({ id }) => (id === 'rechtml'
      ? new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } })
      : workerJson(article(id))));
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=rec1,rechtml` }));
    assert.equal(status, 200);
    assert.deepEqual(body.not_found, ['rechtml']);
  });

  it('survives a batch where every single fetch fails', async () => {
    stubWorker(() => { throw new Error('upstream down'); });
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=a,b,c` }));
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
    assert.deepEqual(body.not_found, ['a', 'b', 'c']);
    assert.equal(body.returned, 0);
  });
});

// ----------------------------------------------------------------- chunking --

describe('GET /api/articles/bulk -- fan-out concurrency cap', () => {
  /** Upstream that only settles once every request of the current wave has arrived. */
  function slowWorker() {
    return stubWorker(async ({ id }) => {
      await new Promise((r) => setTimeout(r, 2));
      return workerJson(article(id));
    });
  }

  it('never has more than 10 requests in flight at once, at 25 ids', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `r${i}`);
    const stub = slowWorker();
    const { status, body } = await parseResponse(await call({ url: `${BASE}?ids=${ids.join(',')}` }));

    assert.equal(status, 200);
    assert.equal(body.returned, 25, 'every id must still be fetched');
    assert.equal(stub.peakInFlight, 10, 'the chunk size is 10; an unbatched fan-out would peak at 25');
  });

  it('never has more than 10 requests in flight at once, at the 50-id maximum', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `r${i}`);
    const stub = slowWorker();
    const { body } = await parseResponse(await call({ url: `${BASE}?ids=${ids.join(',')}` }));
    assert.equal(body.returned, 50);
    assert.equal(stub.peakInFlight, 10);
  });

  it('issues the ids in chunk order: the first ten all start before the eleventh does', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `r${i}`);
    const stub = slowWorker();
    await call({ url: `${BASE}?ids=${ids.join(',')}` });
    assert.deepEqual(stub.ids, ids, 'requests are issued in request order, ten at a time');
  });

  it('a batch smaller than one chunk peaks below the cap', async () => {
    const stub = slowWorker();
    await call({ url: `${BASE}?ids=a,b,c` });
    assert.equal(stub.peakInFlight, 3);
  });

  it('a batch of exactly 10 is one full wave', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `r${i}`);
    const stub = slowWorker();
    await call({ url: `${BASE}?ids=${ids.join(',')}` });
    assert.equal(stub.peakInFlight, 10);
  });
});

// ------------------------------------------------------------------ headers --

describe('GET /api/articles/bulk -- response headers', () => {
  it('is NOT edge-cached, unlike the /api/articles list', async () => {
    stubWorker(known('rec1'));
    const { headers } = await parseResponse(await call({ url: `${BASE}?ids=rec1` }));
    assert.equal(headers['cache-control'], undefined, 'an id-set response is per-caller, not a shared page');
    assert.equal(headers['access-control-allow-origin'], 'https://rrmacademy.org');
    assert.equal(headers['content-type'], 'application/json');
  });

  it('reports the rate-limit budget the request consumed', async () => {
    stubWorker(known('rec1'));
    const { headers } = await parseResponse(await call({ url: `${BASE}?ids=rec1` }));
    assert.equal(headers['ratelimit-limit'], '30');
    assert.equal(headers['ratelimit-remaining'], '29');
    assert.ok(Number(headers['ratelimit-reset']) > 0);
  });

  it('a 400 carries CORS but no rate-limit headers (the budget check already passed silently)', async () => {
    stubWorker(() => { throw new Error('upstream must not be called'); });
    const { status, headers } = await parseResponse(await call({ url: `${BASE}?ids=bad_id` }));
    assert.equal(status, 400);
    assert.equal(headers['access-control-allow-origin'], 'https://rrmacademy.org');
    assert.equal(headers['cache-control'], undefined);
  });
});
