/**
 * functions/api/articles.js -- the public, unauthenticated library list API,
 * plus functions/api/_map-article.js, the shared row-to-payload mapper it and
 * /api/articles/bulk both render through.
 *
 * There is no D1 on this path: the endpoint is a proxy over rrm-library-worker,
 * so the harness that matters here is a fetch stub, not a database. What the
 * stub is used to pin is the arithmetic the endpoint does to the upstream
 * answer, which is where the bugs live:
 *   - offset = (page - 1) * limit, and the page/limit range gate around it;
 *   - the opaque cursor, which is a base64url-encoded OFFSET and round-trips
 *     through the same endpoint;
 *   - `total`, which is upstream's number only when upstream gives a positive
 *     one and is otherwise ESTIMATED from offset + page size + has_more;
 *   - nextCursor, which must be null on the last page.
 *
 * The last one is the reason this file has a whole describe block for it. A
 * FULL final page is the only shape that separates a correct end-of-walk from a
 * wrong one: a partial page ends the walk under any implementation, so a test
 * that only ever looks at partial pages proves nothing. The exact-multiple case
 * (total 50, limit 25, page 2) is asserted directly, in both the
 * upstream-total and the estimated-total shapes.
 *
 * WHAT IS STILL FAKED
 *  - rrm-library-worker. Every upstream body here is one this test wrote, so
 *    nothing about the worker's real contract is proven -- only what this
 *    endpoint does with a body of that shape.
 *  - KV is the in-memory stub from _helpers.js, so the rate limiter's bucket is
 *    per-test and never crosses isolates the way the real one does.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockKV, mockWaitUntil, parseResponse } from './_helpers.js';
import { onRequestGet, onRequestOptions } from '../functions/api/articles.js';
import { mapArticle } from '../functions/api/_map-article.js';

const TOKEN = 'test-library-build-token';
const BASE = 'https://rrmacademy.org/api/articles';
const WORKER_HOST = 'rrm-library-worker.administrator-cloudflare.workers.dev';

function recorder() {
  const points = [];
  return { points, writeDataPoint(p) { points.push(p); } };
}

const ipSeq = (() => { let n = 0; return () => `10.0.${Math.floor(n / 250) % 250}.${(n++ % 250) + 1}`; })();

/**
 * Replaces globalThis.fetch with a recorder over the one host this endpoint
 * talks to. `handler` receives the parsed upstream URL so a test can answer
 * differently per offset; returning a real Response keeps `resp.ok` and
 * `resp.json()` behaving the way the endpoint expects.
 */
let activeStub = null;
function stubWorker(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const parsed = new URL(url);
    if (parsed.host !== WORKER_HOST) throw new Error(`unexpected host: ${parsed.host}`);
    const call = {
      url,
      init,
      path: parsed.pathname,
      offset: parsed.searchParams.get('offset'),
      limit: parsed.searchParams.get('limit'),
      auth: init?.headers?.Authorization ?? null,
    };
    calls.push(call);
    return handler(call);
  };
  activeStub = { calls, restore() { globalThis.fetch = original; } };
  return activeStub;
}

afterEach(() => { if (activeStub) { activeStub.restore(); activeStub = null; } });

/** A worker response whose body is exactly `body`, at HTTP `status`. */
const workerJson = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** N distinct upstream article rows, ids offset-<i>. */
function rows(n, from = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `rec${from + i}`,
    slug: `slug-${from + i}`,
    title: `Title ${from + i}`,
    authors: 'Whittaker N',
    year: 2026,
    journal: 'JRRM',
    doi: `10.1/${from + i}`,
    pmid: `${1000 + from + i}`,
    abstract: 'abstract',
    topics: ['endometriosis'],
    isOpenAccess: true,
    dateAddedToLibrary: '2026-03-04T05:06:07.000Z',
  }));
}

function call({ url = BASE, method = 'GET', ip = ipSeq(), token = TOKEN, kv, events } = {}) {
  const env = mockEnv({
    LIBRARY_BUILD_TOKEN: token,
    COMMUNITY_KV: kv === null ? undefined : (kv ?? mockKV()),
    EVENTS: events ?? recorder(),
  });
  return onRequestGet({
    request: mockRequest(method, { url, headers: ip === null ? {} : { 'cf-connecting-ip': ip } }),
    env,
    waitUntil: mockWaitUntil(),
  });
}

/** Shorthand: run one request against a fixed upstream body. */
async function against(body, opts = {}, status = 200) {
  const stub = stubWorker(() => workerJson(body, status));
  const res = await call(opts);
  return { ...(await parseResponse(res)), stub };
}

// ----------------------------------------------------------------- preflight --

describe('GET /api/articles -- method and preflight', () => {
  it('OPTIONS is 204 and advertises the locked-down public CORS origin', async () => {
    const res = onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
    assert.equal(await res.text(), '');
  });

  it('405s a non-GET method before any rate-limit or upstream work', async () => {
    const stub = stubWorker(() => { throw new Error('upstream must not be called'); });
    const { status, headers } = await parseResponse(await call({ method: 'POST' }));
    assert.equal(status, 405);
    assert.equal(headers.allow, 'GET');
    assert.equal(headers['access-control-allow-origin'], 'https://rrmacademy.org');
    assert.equal(stub.calls.length, 0);
  });
});

// ------------------------------------------------------------------- gating --

describe('GET /api/articles -- gating', () => {
  it('503s when cf-connecting-ip is absent (the rate limiter has nothing to key on)', async () => {
    const events = recorder();
    const stub = stubWorker(() => { throw new Error('upstream must not be called'); });
    const { status, body } = await parseResponse(await call({ ip: null, events }));
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
    assert.equal(stub.calls.length, 0);
    assert.ok(events.points.some((p) => p.blobs[2] === 'missing_ip'));
  });

  it('429s once the 30/min budget for that IP is spent, and says so in RateLimit-Remaining', async () => {
    const ip = ipSeq();
    const kv = mockKV();
    await kv.put(`rl:art:${ip}`, JSON.stringify({ count: 30, start: Math.floor(Date.now() / 1000) }));
    const stub = stubWorker(() => { throw new Error('upstream must not be called'); });

    const { status, body, headers } = await parseResponse(await call({ ip, kv }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
    assert.equal(headers['ratelimit-limit'], '30');
    assert.equal(headers['ratelimit-remaining'], '0');
    assert.equal(stub.calls.length, 0);
  });

  it('lets the 30th request through and rejects the 31st', async () => {
    const ip = ipSeq();
    const kv = mockKV();
    await kv.put(`rl:art:${ip}`, JSON.stringify({ count: 29, start: Math.floor(Date.now() / 1000) }));
    stubWorker(() => workerJson({ results: [], has_more: false }));

    assert.equal((await parseResponse(await call({ ip, kv }))).status, 200, '30th request must be allowed');
    assert.equal((await parseResponse(await call({ ip, kv }))).status, 429, '31st must be refused');
  });

  it('fails CLOSED with 429 when the KV binding is missing entirely', async () => {
    const stub = stubWorker(() => { throw new Error('upstream must not be called'); });
    const { status, body, headers } = await parseResponse(await call({ kv: null }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
    assert.equal(headers['ratelimit-limit'], undefined, 'no bucket to report when KV is gone');
    assert.equal(stub.calls.length, 0);
  });

  it('503s when LIBRARY_BUILD_TOKEN is unset -- never calls upstream unauthenticated', async () => {
    const events = recorder();
    const stub = stubWorker(() => { throw new Error('upstream must not be called'); });
    const { status, body } = await parseResponse(await call({ token: null, events }));
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
    assert.equal(stub.calls.length, 0);
    assert.ok(events.points.some((p) => p.blobs[2] === 'missing_token'));
  });

  it('sends the build token as a Bearer header upstream', async () => {
    const { stub } = await against({ results: [], has_more: false });
    assert.equal(stub.calls[0].auth, `Bearer ${TOKEN}`);
  });
});

// --------------------------------------------------------------- pagination --

describe('GET /api/articles -- page/limit pagination', () => {
  it('DEFAULTS to page 1, limit 25 when neither param is supplied', async () => {
    const { status, body, stub } = await against({ results: rows(25), total: 400, has_more: true });
    assert.equal(status, 200);
    assert.equal(stub.calls[0].limit, '25');
    assert.equal(stub.calls[0].offset, '0');
    assert.equal(body.page, 1);
    assert.equal(body.limit, 25);
  });

  it('translates page+limit into the upstream offset', async () => {
    const { body, stub } = await against(
      { results: rows(10, 30), total: 400, has_more: true },
      { url: `${BASE}?page=4&limit=10` }
    );
    assert.equal(stub.calls[0].offset, '30');
    assert.equal(stub.calls[0].limit, '10');
    assert.equal(body.page, 4);
    assert.equal(body.limit, 10);
  });

  it('accepts the extreme ends of both ranges (page 1..350, limit 1..50)', async () => {
    for (const [url, offset, limit] of [
      [`${BASE}?page=1&limit=1`, '0', '1'],
      [`${BASE}?page=350&limit=50`, '17450', '50'],
      [`${BASE}?page=1&limit=50`, '0', '50'],
      [`${BASE}?page=350&limit=1`, '349', '1'],
    ]) {
      const { status, stub } = await against({ results: [], has_more: false }, { url });
      assert.equal(status, 200, url);
      assert.equal(stub.calls[0].offset, offset, url);
      assert.equal(stub.calls[0].limit, limit, url);
      activeStub.restore(); activeStub = null;
    }
  });

  const bad = [
    ['page 0', `${BASE}?page=0`],
    ['page 351 (one past the cap)', `${BASE}?page=351`],
    ['limit 0', `${BASE}?limit=0`],
    ['limit 51 (one past the cap)', `${BASE}?limit=51`],
    ['a negative page', `${BASE}?page=-1`],
    ['a non-numeric page', `${BASE}?page=abc`],
    ['a non-numeric limit', `${BASE}?limit=lots`],
    ['a fractional limit', `${BASE}?limit=2.5`],
    ['an empty page value', `${BASE}?page=`],
    ['a whitespace page value', `${BASE}?page=%20`],
    ['Infinity', `${BASE}?limit=Infinity`],
    ['NaN', `${BASE}?page=NaN`],
  ];
  for (const [label, url] of bad) {
    it(`400s invalid_pagination on ${label}, without calling upstream`, async () => {
      const stub = stubWorker(() => { throw new Error('upstream must not be called'); });
      const { status, body } = await parseResponse(await call({ url }));
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_pagination');
      assert.equal(stub.calls.length, 0);
    });
  }

  // Validation is `Number()` + `Number.isInteger()`, not a decimal-digit regex,
  // so every numeric literal form JavaScript understands is accepted. This is
  // pinned rather than asserted-against because it is the CURRENT contract: the
  // resulting page is in range and the offset is computed correctly, so the only
  // consequence is that one page of results is addressable at several distinct
  // URLs. Tightening it to /^\d+$/ would be a deliberate change, and this test
  // is what would tell you that you made it.
  for (const [label, value, expectedOffset] of [
    ['hexadecimal', '0x10', '375'],
    ['exponential', '1e2', '2475'],
    ['binary', '0b10', '25'],
    ['a leading plus', '+3', '50'],
    ['leading whitespace', '%093', '50'],
  ]) {
    it(`accepts a ${label} page value and computes its offset from the parsed number`, async () => {
      const { status, stub } = await against({ results: [], has_more: false }, { url: `${BASE}?page=${value}` });
      assert.equal(status, 200, `page=${value}`);
      assert.equal(stub.calls[0].offset, expectedOffset, `page=${value}`);
    });
  }
});

// ------------------------------------------------------------------- cursor --

describe('GET /api/articles -- opaque cursor', () => {
  it('round-trips: the nextCursor of page 1 fetches exactly the next offset', async () => {
    const first = await against({ results: rows(25), total: 100, has_more: true });
    assert.ok(first.body.nextCursor, 'a full page with more upstream must emit a cursor');
    activeStub.restore(); activeStub = null;

    const second = await against(
      { results: rows(25, 25), total: 100, has_more: true },
      { url: `${BASE}?cursor=${encodeURIComponent(first.body.nextCursor)}` }
    );
    assert.equal(second.stub.calls[0].offset, '25');
    assert.equal(second.stub.calls[0].limit, '25');
    assert.equal(second.body.page, 2, 'page is derived from the encoded offset');
    assert.equal(second.body.limit, 25);
  });

  it('carries a non-default limit through the cursor', async () => {
    const first = await against({ results: rows(10), total: 100, has_more: true }, { url: `${BASE}?limit=10` });
    activeStub.restore(); activeStub = null;
    const second = await against(
      { results: rows(10, 10), total: 100, has_more: true },
      { url: `${BASE}?cursor=${encodeURIComponent(first.body.nextCursor)}` }
    );
    assert.equal(second.stub.calls[0].limit, '10');
    assert.equal(second.stub.calls[0].offset, '10');
    assert.equal(second.body.page, 2);
  });

  it('the cursor is base64url -- no +, / or = ever reaches the query string', async () => {
    const { body } = await against({ results: rows(25), total: 100, has_more: true });
    assert.match(body.nextCursor, /^[A-Za-z0-9_-]+$/);
  });

  it('a cursor overrides page/limit rather than being merged with them', async () => {
    const first = await against({ results: rows(25), total: 100, has_more: true });
    activeStub.restore(); activeStub = null;
    const second = await against(
      { results: rows(25, 25), total: 100, has_more: true },
      { url: `${BASE}?page=9&limit=50&cursor=${encodeURIComponent(first.body.nextCursor)}` }
    );
    assert.equal(second.stub.calls[0].offset, '25');
    assert.equal(second.stub.calls[0].limit, '25');
  });

  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const badCursors = [
    ['an empty cursor', ''],
    ['a cursor longer than 128 chars', 'a'.repeat(129)],
    ['a cursor that is not valid base64', '!!!not-base64!!!'],
    ['base64 that is not JSON', Buffer.from('plain text').toString('base64url')],
    ['JSON that is not an object', Buffer.from('null').toString('base64url')],
    ['a missing offset', b64url({ l: 25 })],
    ['a missing limit', b64url({ o: 0 })],
    ['a fractional offset', b64url({ o: 1.5, l: 25 })],
    ['a fractional limit', b64url({ o: 0, l: 25.5 })],
    ['a string offset', b64url({ o: '0', l: 25 })],
    ['a negative offset', b64url({ o: -1, l: 25 })],
    ['an offset past the 17500 ceiling', b64url({ o: 17501, l: 25 })],
    ['limit 0', b64url({ o: 0, l: 0 })],
    ['limit 51', b64url({ o: 0, l: 51 })],
  ];
  for (const [label, cursor] of badCursors) {
    it(`400s invalid_cursor on ${label}, without calling upstream`, async () => {
      const stub = stubWorker(() => { throw new Error('upstream must not be called'); });
      const { status, body } = await parseResponse(await call({ url: `${BASE}?cursor=${encodeURIComponent(cursor)}` }));
      assert.equal(status, 400, label);
      assert.equal(body.error, 'invalid_cursor', label);
      assert.equal(stub.calls.length, 0, label);
    });
  }

  it('accepts the exact ceiling offset 17500, which page/limit alone cannot reach', async () => {
    const { status, body, stub } = await against(
      { results: rows(50, 17500), has_more: true },
      { url: `${BASE}?cursor=${encodeURIComponent(b64url({ o: 17500, l: 50 }))}` }
    );
    assert.equal(status, 200);
    assert.equal(stub.calls[0].offset, '17500');
    assert.equal(body.page, 351, 'a cursor can address past the page-number cap');
    assert.equal(body.nextCursor, null, 'but the walk stops at the 17500 ceiling');
  });
});

// --------------------------------------------------------- has_more / total --

describe('GET /api/articles -- end of walk', () => {
  it('EXACT-MULTIPLE FINAL PAGE: a full last page with upstream total emits no nextCursor', async () => {
    const { status, body } = await against(
      { results: rows(25, 25), total: 50, has_more: false },
      { url: `${BASE}?page=2&limit=25` }
    );
    assert.equal(status, 200);
    assert.equal(body.results.length, 25, 'the page is FULL -- this is the shape a wrong has_more gets wrong');
    assert.equal(body.total, 50);
    assert.equal(body.total_pages, 2);
    assert.equal(body.nextCursor, null, 'offset 25 + 25 rows == total 50, so the walk is over');
  });

  it('EXACT-MULTIPLE FINAL PAGE, estimated total: a full last page with has_more false also ends the walk', async () => {
    const { body } = await against(
      { results: rows(25, 25), has_more: false },
      { url: `${BASE}?page=2&limit=25` }
    );
    assert.equal(body.results.length, 25);
    assert.equal(body.total, 50, 'estimate = offset 25 + 25 rows + 0 (no has_more)');
    assert.equal(body.nextCursor, null);
  });

  it('a full NON-final page still emits a cursor when upstream total says there is more', async () => {
    const { body } = await against(
      { results: rows(25), total: 50, has_more: false },
      { url: `${BASE}?page=1&limit=25` }
    );
    assert.ok(body.nextCursor, 'offset 0 + 25 < total 50, so there is another page');
  });

  it('a full page with has_more true emits a cursor even when total is unknown', async () => {
    const { body } = await against({ results: rows(25), has_more: true });
    assert.equal(body.total, 50, 'estimate = 0 + 25 + one more page worth');
    assert.ok(body.nextCursor);
  });

  it('a PARTIAL page always ends the walk, even if upstream claims has_more', async () => {
    const { body } = await against(
      { results: rows(7, 25), total: 999, has_more: true },
      { url: `${BASE}?page=2&limit=25` }
    );
    assert.equal(body.nextCursor, null, 'a short page is the end regardless of what upstream says');
  });

  it('an empty result set reports total 0 but never total_pages 0', async () => {
    const { status, body } = await against({ results: [], has_more: false }, { url: `${BASE}?page=9&limit=25` });
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
    assert.equal(body.total, 200, 'estimate = offset 200 + 0 rows');
    assert.equal(body.page, 9);
    assert.equal(body.nextCursor, null);
  });

  it('total_pages floors at 1 when the corpus estimate is 0', async () => {
    const { body } = await against({ results: [], has_more: false });
    assert.equal(body.total, 0);
    assert.equal(body.total_pages, 1, 'Math.ceil(0/25) is 0; the endpoint must report at least one page');
  });

  it('an upstream total of 0 is treated as unknown and re-estimated', async () => {
    const { body } = await against(
      { results: rows(25, 25), total: 0, has_more: true },
      { url: `${BASE}?page=2&limit=25` }
    );
    assert.equal(body.total, 75, 'estimate = offset 25 + 25 rows + 25 for the promised next page');
  });

  it('a non-numeric upstream total is ignored in favour of the estimate', async () => {
    const { body } = await against({ results: rows(25), total: 'many', has_more: false });
    assert.equal(body.total, 25);
  });
});

// ------------------------------------------------------------ upstream fail --

describe('GET /api/articles -- upstream failure', () => {
  it('503s on an upstream non-2xx and logs the status', async () => {
    const events = recorder();
    stubWorker(() => workerJson({ error: 'boom' }, 502));
    const { status, body } = await parseResponse(await call({ events }));
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
    const logged = events.points.find((p) => p.blobs[2] === 'upstream_error');
    assert.ok(logged);
    assert.equal(logged.blobs[4], '502');
  });

  it('503s when the upstream fetch throws, and does not leak the network message', async () => {
    const events = recorder();
    stubWorker(() => { throw new Error('ECONNREFUSED 10.1.2.3:443'); });
    const { status, body } = await parseResponse(await call({ events }));
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
    assert.ok(!JSON.stringify(body).includes('ECONNREFUSED'));
    assert.ok(events.points.some((p) => p.blobs[2] === 'fetch_error'));
  });

  it('503s when the upstream body is not JSON (resp.json() rejects)', async () => {
    stubWorker(() => new Response('<html>504 gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const { status, body } = await parseResponse(await call());
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
  });

  it('serves an empty page rather than 500ing when upstream returns a JSON null', async () => {
    const { status, body } = await against(null);
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
    assert.equal(body.total, 0);
  });

  it('serves an empty page when upstream returns results in the wrong type', async () => {
    const { status, body } = await against({ results: { not: 'an array' }, has_more: false });
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
  });
});

// ------------------------------------------------------------------ headers --

describe('GET /api/articles -- response headers', () => {
  it('a 200 is edge-cacheable for an hour and carries the public CORS origin', async () => {
    const { headers } = await against({ results: rows(3), has_more: false });
    assert.equal(headers['cache-control'], 'public, max-age=3600, s-maxage=3600');
    assert.equal(headers['access-control-allow-origin'], 'https://rrmacademy.org');
    assert.equal(headers['content-type'], 'application/json');
  });

  it('a 200 reports the rate-limit budget that request consumed', async () => {
    const { headers } = await against({ results: [], has_more: false });
    assert.equal(headers['ratelimit-limit'], '30');
    assert.equal(headers['ratelimit-remaining'], '29', 'one slot of thirty is spent by this request');
    assert.ok(Number(headers['ratelimit-reset']) > 0);
  });

  it('an ERROR response is never cached at the edge', async () => {
    const { status, headers } = await parseResponse(await call({ url: `${BASE}?page=0` }));
    assert.equal(status, 400);
    assert.equal(headers['cache-control'], undefined, 'a 400 must not be stored for an hour');
  });

  it('a 503 is never cached at the edge', async () => {
    stubWorker(() => workerJson({}, 500));
    const { status, headers } = await parseResponse(await call());
    assert.equal(status, 503);
    assert.equal(headers['cache-control'], undefined);
  });
});

// -------------------------------------------------------------- the mapper --

describe('_map-article.js -- shared row mapper, through /api/articles', () => {
  it('renders an upstream row into the public payload, deriving the canonical URL from the slug', async () => {
    const upstream = {
      id: 'rec42',
      slug: 'endometriosis-excision-outcomes',
      title: 'Excision outcomes',
      authors: 'Whittaker N; Boyle P',
      year: 2025,
      journal: 'JRRM',
      doi: '10.1234/jrrm.42',
      pmid: '39123456',
      abstract: 'A cohort study.',
      topics: ['endometriosis', 'surgery'],
      isOpenAccess: true,
      dateAddedToLibrary: '2026-03-04T05:06:07.891Z',
      internal_note: 'NEVER SHIP THIS',
      is_published: 1,
    };
    const { body } = await against({ results: [upstream], has_more: false });

    assert.deepEqual(body.results[0], {
      id: 'rec42',
      slug: 'endometriosis-excision-outcomes',
      url: 'https://rrmacademy.org/library/endometriosis-excision-outcomes/',
      title: 'Excision outcomes',
      authors: 'Whittaker N; Boyle P',
      year: 2025,
      journal: 'JRRM',
      doi: '10.1234/jrrm.42',
      pmid: '39123456',
      abstract: 'A cohort study.',
      topics: ['endometriosis', 'surgery'],
      is_open_access: true,
      date_added: '2026-03-04',
    });
    assert.ok(!JSON.stringify(body).includes('NEVER SHIP THIS'), 'the mapper is an allowlist, not a passthrough');
  });
});

describe('_map-article.js -- shared row mapper, called directly', () => {
  it('builds the library URL from the slug on the production site base', () => {
    assert.equal(mapArticle({ slug: 'pcos-metformin' }).url, 'https://rrmacademy.org/library/pcos-metformin/');
  });

  for (const [label, topics] of [
    ['a missing topics key', undefined],
    ['a null topics value', null],
    ['a comma-joined string from an older upstream shape', 'endometriosis,pcos'],
    ['an object', { a: 1 }],
  ]) {
    it(`coerces ${label} to an empty array so consumers can always .map it`, () => {
      assert.deepEqual(mapArticle({ slug: 's', topics }).topics, []);
    });
  }

  it('passes a genuine topics array through unchanged, including the empty one', () => {
    assert.deepEqual(mapArticle({ slug: 's', topics: ['a', 'b'] }).topics, ['a', 'b']);
    assert.deepEqual(mapArticle({ slug: 's', topics: [] }).topics, []);
  });

  for (const [label, value] of [
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['undefined', undefined],
    ['null', null],
    ['false', false],
  ]) {
    it(`reports is_open_access false for ${label} -- only a real boolean true counts`, () => {
      assert.equal(mapArticle({ slug: 's', isOpenAccess: value }).is_open_access, false);
    });
  }

  it('reports is_open_access true only for boolean true', () => {
    assert.equal(mapArticle({ slug: 's', isOpenAccess: true }).is_open_access, true);
  });

  it('truncates the added date to a bare YYYY-MM-DD', () => {
    assert.equal(mapArticle({ slug: 's', dateAddedToLibrary: '2026-03-04T05:06:07.891Z' }).date_added, '2026-03-04');
    assert.equal(mapArticle({ slug: 's', dateAddedToLibrary: '2026-03-04' }).date_added, '2026-03-04');
  });

  for (const [label, value] of [['null', null], ['undefined', undefined], ['an empty string', '']]) {
    it(`reports date_added null for ${label} rather than an empty or sliced value`, () => {
      assert.equal(mapArticle({ slug: 's', dateAddedToLibrary: value }).date_added, null);
    });
  }

  it('leaves absent scalar fields undefined rather than inventing defaults', () => {
    const mapped = mapArticle({ slug: 's' });
    for (const key of ['id', 'title', 'authors', 'year', 'journal', 'doi', 'pmid', 'abstract']) {
      assert.equal(mapped[key], undefined, key);
    }
  });

  it('emits exactly the thirteen public keys and nothing else', () => {
    assert.deepEqual(Object.keys(mapArticle({ slug: 's', secret: 'x' })).sort(), [
      'abstract', 'authors', 'date_added', 'doi', 'id', 'is_open_access',
      'journal', 'pmid', 'slug', 'title', 'topics', 'url', 'year',
    ]);
  });
});
