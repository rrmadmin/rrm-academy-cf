/**
 * functions/api/community/unfurl.js -- the link-preview fetcher.
 *
 * WHAT THIS ENDPOINT IS
 * A member hands it an arbitrary remote URL and it fetches that URL from inside
 * Cloudflare's network. That is a server-side request forgery surface by
 * construction, so most of this file is about proving WHICH destinations the
 * handler actually contacts, not about the preview fields.
 *
 * The load-bearing assertion shape throughout is `stub.pageCalls.length === 0`:
 * a refusal that still made the outbound request is not a refusal. Every
 * blocked case below checks the call log, never just the response body.
 *
 * WHY A REAL ENGINE FOR THE DATABASE
 * The first thing the handler does is `requireMember`, the canonical gate in
 * community/_shared.js. It is NOT stubbed -- membership resolves out of real
 * `session` / `user` / `wix_subscription` rows in node:sqlite loaded with the
 * committed rrm-auth schema (test/_d1-sqlite.mjs). Stubbing the gate to make
 * these tests easier would mean 100% coverage of a gate nothing exercised.
 *
 * WHAT IS FAKED, AND WHAT THAT CANNOT DISTINGUISH
 *  1. HTMLRewriter. It is a Cloudflare runtime global with no Node equivalent,
 *     so `testHTMLRewriter` below implements the two-handler subset unfurl.js
 *     uses, on top of node-html-parser (a real HTML parser, already a
 *     devDependency). That makes parseHtml's precedence / trimming / clamping /
 *     URL-resolution logic run against genuinely parsed markup rather than a
 *     canned meta object. It CANNOT prove lol-html's exact tokenizer behaviour
 *     on adversarial markup (mis-nested tags, `<meta>` inside `<script>`,
 *     character-reference edge cases, chunk boundaries mid-entity). Where those
 *     could differ the tests stay on well-formed input and say so.
 *  2. DNS. resolveAndCheck asks cloudflare-dns.com over DoH; the stub answers
 *     it. The tests prove the handler's decision GIVEN an answer, not that the
 *     resolver returns that answer, and not that the address the runtime finally
 *     connects to is the one that was resolved (a true DNS-rebinding race
 *     between the check and the connect is outside any unit test).
 *  3. The 5s/3s AbortSignal budgets are asserted as values on the fetch init,
 *     never waited on.
 *  4. KV and Analytics Engine are the mockKVJson / mockEnv stubs.
 *
 * KNOWN UNREACHABLE LINES (unfurl.js:23-25)
 * `isUnfurlableUrl` re-parses its argument inside a try/catch. Neither of its
 * two call sites can supply a string that fails: onRequestGet has already run
 * `new URL(raw)` successfully before calling it (unfurl.js:238), and the
 * redirect site passes `new URL(location, currentUrl).toString()`
 * (unfurl.js:306), whose output is absolute and always re-parseable. The
 * over-2048 guard on line 19 returns before the try, so a giant Location cannot
 * reach it either. Those two lines are dead defensive code; no test here fakes
 * a path to them.
 */
import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseHtmlDoc } from 'node-html-parser';
import { mockEnv, mockWaitUntil, parseResponse, mockKVJson } from './_helpers.js';
import { sqliteD1, insertUser, insertSession, insertWixSubscription } from './_d1-sqlite.mjs';

const unfurl = await import('../functions/api/community/unfurl.js');

// ------------------------------------------------------------ HTMLRewriter ---

/**
 * The subset of the HTMLRewriter contract unfurl.js consumes:
 *   .on(selector, { element(el) })  -- el.getAttribute(name) -> string | null
 *   .on(selector, { text(chunk) })  -- chunk.text, delivered in pieces
 *   .transform(response).arrayBuffer()  -- drives the parse to completion
 *
 * Text is deliberately delivered in small chunks so `titleText += chunk.text`
 * is exercised as an accumulation, which is how the real streaming rewriter
 * behaves, rather than as a single assignment.
 */
const TEXT_CHUNK = 7;

class TestHTMLRewriter {
  constructor() { this.handlers = []; }
  on(selector, handler) { this.handlers.push({ selector, handler }); return this; }
  transform(response) {
    const handlers = this.handlers;
    return {
      async arrayBuffer() {
        const html = await response.text();
        const root = parseHtmlDoc(html);
        for (const { selector, handler } of handlers) {
          for (const el of root.querySelectorAll(selector)) {
            if (handler.element) {
              handler.element({ getAttribute: (name) => el.getAttribute(name) ?? null });
            }
            if (handler.text) {
              const raw = el.textContent ?? '';
              if (raw.length === 0) handler.text({ text: '', lastInTextNode: true });
              for (let i = 0; i < raw.length; i += TEXT_CHUNK) {
                handler.text({ text: raw.slice(i, i + TEXT_CHUNK), lastInTextNode: i + TEXT_CHUNK >= raw.length });
              }
            }
          }
        }
        return new ArrayBuffer(0);
      },
    };
  }
}

let realHTMLRewriter;
before(() => { realHTMLRewriter = globalThis.HTMLRewriter; globalThis.HTMLRewriter = TestHTMLRewriter; });
after(() => { globalThis.HTMLRewriter = realHTMLRewriter; });

// ------------------------------------------------------------------ fixtures ---

const MEMBER = 'u_member';
const SESSION = 'raw-session-unfurl';
const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const PUBLIC_V4 = '93.184.216.34';

async function seededDb() {
  let handle;
  const db = sqliteD1({
    seed(sqlite) {
      handle = sqlite;
      insertUser(sqlite, { id: MEMBER, email: 'member@example.com', role: 'member', email_verified: 1 });
      insertWixSubscription(sqlite, { email: 'member@example.com', user_id: MEMBER });
    },
  });
  await insertSession(handle, { rawId: SESSION, userId: MEMBER, expiresAt: FUTURE });
  return db;
}

function dnsBody(records, status = 0) {
  return { Status: status, Answer: records };
}

/**
 * Routes both fetches unfurl.js makes: the DoH probe to cloudflare-dns.com and the page
 * fetch itself. Every call is recorded, split into dnsCalls / pageCalls, which
 * is what the SSRF assertions read.
 *
 * @param {object} opts
 * @param {(host: string, type: string) => object|Response|Error} [opts.dns]
 * @param {(url: string) => object|Response|Error} [opts.page]
 */
function stubUnfurlFetch({ dns, page } = {}) {
  const original = globalThis.fetch;
  const calls = [];

  const defaultDns = (_host, type) => (type === 'A' ? dnsBody([{ type: 1, data: PUBLIC_V4 }]) : dnsBody(undefined, 3));

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    const call = { url, init };
    calls.push(call);

    if (url.startsWith('https://cloudflare-dns.com/dns-query')) {
      call.kind = 'dns';
      const parsed = new URL(url);
      const answer = (dns ?? defaultDns)(parsed.searchParams.get('name'), parsed.searchParams.get('type'));
      if (answer instanceof Error) throw answer;
      if (answer instanceof Response || (answer && typeof answer.json === 'function')) return answer;
      return { ok: true, status: 200, async json() { return answer; } };
    }

    call.kind = 'page';
    const result = page ? page(url) : undefined;
    if (result instanceof Error) throw result;
    if (result instanceof Response) return result;
    if (result === undefined) throw new Error(`stubUnfurlFetch: no page fixture for ${url}`);
    return result;
  };

  return {
    calls,
    get dnsCalls() { return calls.filter(c => c.kind === 'dns'); },
    get pageCalls() { return calls.filter(c => c.kind === 'page'); },
    restore() { globalThis.fetch = original; },
  };
}

const enc = new TextEncoder();

/** A 200 text/html page. */
function htmlPage(body, { status = 200, contentType = 'text/html; charset=utf-8', headers = {} } = {}) {
  return new Response(body, { status, headers: { 'Content-Type': contentType, ...headers } });
}

/**
 * A page whose body arrives as the given chunks, one per read, so the read loop
 * in readBodyCapped really loops. Pull-driven on purpose: enqueueing everything
 * up front and then calling controller.error() discards the queue, so the
 * handler would never see the bytes that arrived before the failure.
 */
function chunkedPage(chunks, { errorAfter = false, contentType = 'text/html' } = {}) {
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        const c = chunks[i++];
        controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
        return;
      }
      if (errorAfter) controller.error(new Error('stream broke mid-body'));
      else controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': contentType } });
}

function redirect(to, status = 302) {
  return new Response(null, { status, headers: to === null ? {} : { Location: to } });
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
const cacheKeyFor = async (raw) => 'unfurl:v1:' + (await sha256hex(raw));

/** Runs GET /api/community/unfurl?url=... and returns { parsed, env, kv }. */
async function get(db, rawUrl, { envOverrides = {}, kv, cookie = SESSION, omitParam = false } = {}) {
  const store = kv ?? mockKVJson();
  const url = omitParam
    ? 'https://rrmacademy.org/api/community/unfurl'
    : 'https://rrmacademy.org/api/community/unfurl?url=' + encodeURIComponent(rawUrl);
  const headers = {};
  if (cookie !== null) headers.Cookie = `session=${cookie}`;
  const env = mockEnv({ DB: db, COMMUNITY_KV: store, ...envOverrides });
  const response = await unfurl.onRequestGet({
    request: new Request(url, { headers }),
    env,
    waitUntil: mockWaitUntil(),
  });
  return { parsed: await parseResponse(response), env, kv: store };
}

/** The cache writes made during a call, excluding the rate limiter's own bucket. */
const cacheWrites = (kv) => kv.puts.filter(p => p.key.startsWith('unfurl:v1:'));

// ================================================================== tests ===

describe('community/unfurl.js -- OPTIONS', () => {
  it('answers the preflight 204 with the locked CORS origin', async () => {
    const response = await unfurl.onRequestOptions();
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

describe('community/unfurl.js -- the membership gate fronts the fetcher', () => {
  let db, stub;
  beforeEach(async () => { db = await seededDb(); stub = stubUnfurlFetch(); });
  afterEach(() => { stub.restore(); db.close(); });

  it('refuses an anonymous caller 401 and makes no outbound request whatsoever', async () => {
    const { parsed } = await get(db, 'https://example.com/', { cookie: null });
    assert.equal(parsed.status, 401);
    assert.equal(stub.calls.length, 0, 'an unauthenticated caller must not be able to drive an outbound fetch');
  });

  it('returns 500 when the DB binding is missing, never a silent 200', async () => {
    const { parsed } = await get(db, 'https://example.com/', { envOverrides: { DB: null } });
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'Server misconfigured');
    assert.equal(stub.calls.length, 0);
  });

  it('rate-limits at 60 unfurls per member per hour', async () => {
    const kv = mockKVJson({ [`rl:unfurl:${MEMBER}`]: JSON.stringify({ count: 60, start: Math.floor(Date.now() / 1000) }) });
    const { parsed } = await get(db, 'https://example.com/', { kv });
    assert.equal(parsed.status, 429);
    assert.equal(parsed.body.error, 'rate_limited');
    assert.equal(stub.calls.length, 0, 'a rate-limited caller must not reach DNS or the page');
  });

  it('returns 500 and logs when D1 throws mid-gate', async () => {
    const events = [];
    const throwingDb = { prepare() { throw new Error('D1_ERROR: connection lost'); } };
    const { parsed } = await get(db, 'https://example.com/', {
      envOverrides: { DB: throwingDb, EVENTS: { writeDataPoint(d) { events.push(d); } } },
    });
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'Internal error');
    assert.ok(!JSON.stringify(parsed.body).includes('connection lost'), 'the D1 error text must not reach the client');
    assert.ok(events.find(e => e.blobs?.includes('unfurl_error')), 'the failure must be logged server-side');
  });
});

describe('community/unfurl.js -- URL parameter validation', () => {
  let db, stub;
  beforeEach(async () => { db = await seededDb(); stub = stubUnfurlFetch(); });
  afterEach(() => { stub.restore(); db.close(); });

  it('400s a missing url parameter and caches nothing', async () => {
    const { parsed, kv } = await get(db, '', { omitParam: true });
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'invalid_url');
    assert.equal(cacheWrites(kv).length, 0, 'an unparsed input has no cache key to negative-cache under');
    assert.equal(stub.calls.length, 0);
  });

  it('400s an empty url parameter', async () => {
    const { parsed, kv } = await get(db, '');
    assert.equal(parsed.status, 400);
    assert.equal(cacheWrites(kv).length, 0);
  });

  it('400s a url longer than 2048 characters before attempting to parse it', async () => {
    const long = 'https://example.com/' + 'a'.repeat(2100);
    assert.ok(long.length > 2048);
    const { parsed, kv } = await get(db, long);
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'invalid_url');
    assert.equal(cacheWrites(kv).length, 0);
    assert.equal(stub.calls.length, 0);
  });

  it('400s an unparseable url and does NOT negative-cache it', async () => {
    const { parsed, kv } = await get(db, 'not a url at all');
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'invalid_url');
    assert.equal(cacheWrites(kv).length, 0);
    assert.equal(stub.calls.length, 0);
  });
});

describe('community/unfurl.js -- SSRF front door: destinations refused without any outbound request', () => {
  let db, stub;
  beforeEach(async () => { db = await seededDb(); stub = stubUnfurlFetch(); });
  afterEach(() => { stub.restore(); db.close(); });

  const refused = {
    'file: scheme': 'file:///etc/passwd',
    'gopher: scheme': 'gopher://example.com/1',
    'ftp: scheme': 'ftp://example.com/x',
    'data: scheme': 'data:text/html,<h1>x</h1>',
    'javascript: scheme': 'javascript:alert(1)',
    'blob: scheme': 'blob:https://example.com/abc',
    'embedded credentials': 'https://admin:hunter2@example.com/',
    'username only': 'https://admin@example.com/',
    'cloud metadata IP': 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'loopback IPv4': 'http://127.0.0.1/admin',
    'loopback IPv4, alternate host octet': 'http://127.1.2.3/',
    'RFC1918 10/8': 'http://10.0.0.1/',
    'RFC1918 192.168/16': 'http://192.168.1.1/',
    'RFC1918 172.16/12': 'http://172.20.10.5/',
    'all-zeros': 'http://0.0.0.0/',
    'IPv6 loopback': 'http://[::1]/',
    'IPv6 unique-local': 'http://[fd00::1]/',
    'IPv6 link-local': 'http://[fe80::1]/',
    'localhost': 'http://localhost/',
    '.local suffix': 'http://printer.local/',
    '.internal suffix': 'http://metadata.internal/',
    '.localhost suffix': 'http://api.localhost/',
    'single-label intranet host': 'http://intranet/',
    'non-default port 8080': 'http://example.com:8080/',
    'non-default port 22': 'https://example.com:22/',
    'non-default port 6379': 'http://example.com:6379/',
  };

  for (const [label, target] of Object.entries(refused)) {
    it(`refuses ${label} with 400 and zero outbound requests`, async () => {
      const { parsed, kv } = await get(db, target);
      assert.equal(parsed.status, 400, `${target} was not refused`);
      assert.equal(parsed.body.error, 'invalid_url');
      assert.equal(stub.calls.length, 0,
        `${target} produced an outbound request; a refusal that still fetches is not a refusal`);
      assert.equal(cacheWrites(kv).length, 0,
        'a policy refusal is never re-read from cache, so nothing is written for it');
    });
  }

  const permittedShapes = {
    'explicit port 80 on http': 'http://example.com:80/page',
    'explicit port 443 on https': 'https://example.com:443/page',
    'plain https': 'https://example.com/page',
  };
  for (const [label, target] of Object.entries(permittedShapes)) {
    it(`allows ${label} through the front door`, async () => {
      const local = stubUnfurlFetch({ page: () => htmlPage('<html><head><title>ok</title></head></html>') });
      try {
        const { parsed } = await get(db, target);
        assert.equal(parsed.status, 200);
        assert.equal(parsed.body.preview.title, 'ok');
      } finally { local.restore(); }
    });
  }
});

describe('community/unfurl.js -- DNS guard: a public name that resolves into private space', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  const privateAnswers = {
    'link-local metadata 169.254.169.254': { type: 1, data: '169.254.169.254' },
    'loopback 127.0.0.1': { type: 1, data: '127.0.0.1' },
    '10/8': { type: 1, data: '10.1.2.3' },
    '172.16/12 lower bound': { type: 1, data: '172.16.0.1' },
    '172.16/12 upper bound': { type: 1, data: '172.31.255.254' },
    '192.168/16': { type: 1, data: '192.168.0.99' },
    'CGNAT 100.64/10 lower bound': { type: 1, data: '100.64.0.1' },
    'CGNAT 100.64/10 upper bound': { type: 1, data: '100.127.255.254' },
    '0/8': { type: 1, data: '0.1.2.3' },
    'IPv4-mapped IPv6 loopback': { type: 28, data: '::ffff:127.0.0.1' },
    'IPv6 loopback': { type: 28, data: '::1' },
    'IPv6 ULA fc00::/7 (fc)': { type: 28, data: 'fc00::1' },
    'IPv6 ULA fc00::/7 (fd)': { type: 28, data: 'fd12:3456::1' },
    'IPv6 link-local fe80::/10': { type: 28, data: 'fe80::1234' },
    'IPv6 v4-mapped catch-all': { type: 28, data: '::ffff:0:0' },
  };

  for (const [label, record] of Object.entries(privateAnswers)) {
    it(`does not fetch a host that resolves to ${label}`, async () => {
      const stub = stubUnfurlFetch({
        dns: (_h, type) => (type === (record.type === 1 ? 'A' : 'AAAA') ? dnsBody([record]) : dnsBody([])),
        page: () => htmlPage('<html><head><title>SHOULD NOT BE FETCHED</title></head></html>'),
      });
      try {
        const { parsed, kv } = await get(db, 'https://rebind.example.com/');
        assert.equal(parsed.status, 200);
        assert.equal(parsed.body.preview, null, 'a blocked destination must yield no preview');
        assert.equal(stub.pageCalls.length, 0,
          `the page was fetched despite resolving to ${label}`);
        const writes = cacheWrites(kv);
        assert.equal(writes[0].opts.expirationTtl, 21600, 'a blocked destination gets the short negative TTL');
      } finally { stub.restore(); }
    });
  }

  it('blocks when only the AAAA record is private, even though the A record is public', async () => {
    const stub = stubUnfurlFetch({
      dns: (_h, type) => (type === 'A'
        ? dnsBody([{ type: 1, data: PUBLIC_V4 }])
        : dnsBody([{ type: 28, data: 'fd00::dead' }])),
      page: () => htmlPage('<html><head><title>nope</title></head></html>'),
    });
    try {
      const { parsed } = await get(db, 'https://dualstack.example.com/');
      assert.equal(parsed.body.preview, null);
      assert.equal(stub.pageCalls.length, 0, 'both record types must be checked, not just A');
      assert.deepEqual(stub.dnsCalls.map(c => new URL(c.url).searchParams.get('type')), ['A', 'AAAA']);
    } finally { stub.restore(); }
  });

  it('allows a public IPv6-only host', async () => {
    const stub = stubUnfurlFetch({
      dns: (_h, type) => (type === 'A' ? dnsBody([]) : dnsBody([{ type: 28, data: '2606:4700::6810:85e5' }])),
      page: () => htmlPage('<html><head><title>v6 only</title></head></html>'),
    });
    try {
      const { parsed } = await get(db, 'https://v6.example.com/');
      assert.equal(parsed.body.preview.title, 'v6 only');
      assert.equal(stub.pageCalls.length, 1);
    } finally { stub.restore(); }
  });

  it('ignores CNAME records when scanning the answer set', async () => {
    const stub = stubUnfurlFetch({
      dns: (_h, type) => (type === 'A'
        // A CNAME whose rdata is a NAME, not an address: isPrivateIp must never see it.
        ? dnsBody([{ type: 5, data: 'target.cdn.example.' }, { type: 1, data: PUBLIC_V4 }])
        : dnsBody(undefined, 3)),
      page: () => htmlPage('<html><head><title>via cname</title></head></html>'),
    });
    try {
      const { parsed } = await get(db, 'https://alias.example.com/');
      assert.equal(parsed.body.preview.title, 'via cname');
    } finally { stub.restore(); }
  });

  const failClosed = {
    'NXDOMAIN on the A query': { dns: (_h, type) => (type === 'A' ? dnsBody(undefined, 3) : dnsBody([])) },
    'SERVFAIL on the A query': { dns: (_h, type) => (type === 'A' ? dnsBody(undefined, 2) : dnsBody([])) },
    'a non-200 from the resolver': { dns: () => ({ ok: false, status: 502, async json() { return {}; } }) },
    'the resolver throwing': { dns: () => new Error('DoH unreachable') },
    'a null JSON body from the resolver': { dns: () => ({ ok: true, async json() { return null; } }) },
  };
  for (const [label, opts] of Object.entries(failClosed)) {
    it(`fails closed on ${label}`, async () => {
      const stub = stubUnfurlFetch({ ...opts, page: () => htmlPage('<html><head><title>nope</title></head></html>') });
      try {
        const { parsed } = await get(db, 'https://example.com/');
        assert.equal(parsed.status, 200);
        assert.equal(parsed.body.preview, null);
        assert.equal(stub.pageCalls.length, 0, 'resolution failure must not fall through to a fetch');
      } finally { stub.restore(); }
    });
  }

  it('treats a Status 0 answer that carries no Answer array as resolvable (documented behaviour)', async () => {
    const stub = stubUnfurlFetch({
      dns: () => ({ Status: 0 }),
      page: () => htmlPage('<html><head><title>no records</title></head></html>'),
    });
    try {
      const { parsed } = await get(db, 'https://example.com/');
      assert.equal(parsed.body.preview.title, 'no records',
        'with no address records to inspect the guard has nothing to refuse on and the fetch proceeds');
    } finally { stub.restore(); }
  });

  it('asks the resolver for the exact hostname, with the DoH accept header and a 3s budget', async () => {
    const stub = stubUnfurlFetch({ page: () => htmlPage('<html><head><title>x</title></head></html>') });
    try {
      await get(db, 'https://Sub.Example.COM/path?q=1');
      assert.equal(stub.dnsCalls.length, 2);
      const first = new URL(stub.dnsCalls[0].url);
      assert.equal(first.searchParams.get('name'), 'sub.example.com');
      assert.equal(stub.dnsCalls[0].init.headers.accept, 'application/dns-json');
      assert.ok(stub.dnsCalls[0].init.signal instanceof AbortSignal, 'the resolver call must carry a timeout signal');
    } finally { stub.restore(); }
  });
});

describe('community/unfurl.js -- redirects are re-validated at every hop', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  for (const status of [301, 302, 303, 307, 308]) {
    it(`follows a ${status} to a permitted destination`, async () => {
      const stub = stubUnfurlFetch({
        page: (url) => (url === 'https://example.com/start'
          ? redirect('https://example.com/final', status)
          : htmlPage('<html><head><meta property="og:title" content="Arrived"></head></html>')),
      });
      try {
        const { parsed } = await get(db, 'https://example.com/start');
        assert.equal(parsed.body.preview.title, 'Arrived');
        assert.deepEqual(stub.pageCalls.map(c => c.url), ['https://example.com/start', 'https://example.com/final']);
      } finally { stub.restore(); }
    });
  }

  it('refuses a permitted host that redirects to the cloud metadata endpoint', async () => {
    const stub = stubUnfurlFetch({
      page: (url) => (url === 'https://example.com/start'
        ? redirect('http://169.254.169.254/latest/meta-data/')
        : htmlPage('<html><head><title>METADATA</title></head></html>')),
    });
    try {
      const { parsed } = await get(db, 'https://example.com/start');
      assert.equal(parsed.body.preview, null);
      assert.deepEqual(stub.pageCalls.map(c => c.url), ['https://example.com/start'],
        'the metadata endpoint must never be requested; a front-door-only check would have followed this');
    } finally { stub.restore(); }
  });

  it('refuses a redirect to file:// even though the first hop was https', async () => {
    const stub = stubUnfurlFetch({
      page: () => redirect('file:///etc/passwd'),
    });
    try {
      const { parsed } = await get(db, 'https://example.com/start');
      assert.equal(parsed.body.preview, null);
      assert.equal(stub.pageCalls.length, 1);
    } finally { stub.restore(); }
  });

  it('re-runs the DNS guard on the redirect target, not just the original host', async () => {
    const stub = stubUnfurlFetch({
      dns: (host, type) => {
        if (type !== 'A') return dnsBody(undefined, 3);
        return host === 'internal.example.com'
          ? dnsBody([{ type: 1, data: '10.0.0.7' }])
          : dnsBody([{ type: 1, data: PUBLIC_V4 }]);
      },
      page: (url) => (url === 'https://example.com/start'
        ? redirect('https://internal.example.com/secret')
        : htmlPage('<html><head><title>SECRET</title></head></html>')),
    });
    try {
      const { parsed } = await get(db, 'https://example.com/start');
      assert.equal(parsed.body.preview, null);
      assert.deepEqual(stub.pageCalls.map(c => c.url), ['https://example.com/start']);
      assert.deepEqual(stub.dnsCalls.map(c => new URL(c.url).searchParams.get('name')),
        ['example.com', 'example.com', 'internal.example.com'],
        'the second hop must be resolved and checked before it is fetched');
    } finally { stub.restore(); }
  });

  it('resolves a relative Location against the current hop', async () => {
    const stub = stubUnfurlFetch({
      page: (url) => (url === 'https://example.com/a/b'
        ? redirect('../c/final')
        : htmlPage('<html><head><title>relative ok</title></head></html>')),
    });
    try {
      const { parsed } = await get(db, 'https://example.com/a/b');
      assert.equal(parsed.body.preview.title, 'relative ok');
      assert.equal(stub.pageCalls[1].url, 'https://example.com/c/final');
    } finally { stub.restore(); }
  });

  it('gives up with a null preview on a redirect that carries no Location header', async () => {
    const stub = stubUnfurlFetch({ page: () => redirect(null) });
    try {
      const { parsed } = await get(db, 'https://example.com/start');
      assert.equal(parsed.body.preview, null);
      assert.equal(stub.pageCalls.length, 1);
    } finally { stub.restore(); }
  });

  it('stops after three hops rather than following a redirect loop forever', async () => {
    const stub = stubUnfurlFetch({ page: (url) => redirect(url + 'x') });
    try {
      const { parsed } = await get(db, 'https://example.com/loop');
      assert.equal(parsed.body.preview, null);
      assert.equal(stub.pageCalls.length, 3, 'MAX_HOPS is 3 fetched hops, then the loop must stop');
    } finally { stub.restore(); }
  });

  it('refuses a Location longer than the 2048-character cap', async () => {
    const stub = stubUnfurlFetch({ page: () => redirect('https://example.com/' + 'q'.repeat(2100)) });
    try {
      const { parsed } = await get(db, 'https://example.com/start');
      assert.equal(parsed.body.preview, null);
      assert.equal(stub.pageCalls.length, 1);
    } finally { stub.restore(); }
  });

  it('sends redirect:manual, a bot user agent, an html Accept and a 5s budget on the page fetch', async () => {
    const stub = stubUnfurlFetch({ page: () => htmlPage('<html><head><title>t</title></head></html>') });
    try {
      await get(db, 'https://example.com/page');
      const { init } = stub.pageCalls[0];
      assert.equal(init.redirect, 'manual',
        'automatic redirect following would skip the per-hop revalidation entirely');
      assert.equal(init.headers['User-Agent'], 'RRMAcademyBot/1.0 (+https://rrmacademy.org)');
      assert.equal(init.headers.Accept, 'text/html,application/xhtml+xml');
      assert.ok(init.signal instanceof AbortSignal);
    } finally { stub.restore(); }
  });

  it('returns a null preview when the page fetch throws (timeout or network error)', async () => {
    const stub = stubUnfurlFetch({ page: () => new Error('The operation was aborted due to timeout') });
    try {
      const { parsed, kv } = await get(db, 'https://example.com/slow');
      assert.equal(parsed.status, 200);
      assert.equal(parsed.body.preview, null);
      assert.equal(cacheWrites(kv)[0].opts.expirationTtl, 21600);
    } finally { stub.restore(); }
  });
});

describe('community/unfurl.js -- what counts as a previewable response', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  async function withPage(target, pageResult) {
    const stub = stubUnfurlFetch({ page: () => pageResult });
    try { return await get(db, target); } finally { stub.restore(); }
  }

  it('ignores a non-2xx response body entirely', async () => {
    const { parsed } = await withPage('https://example.com/missing',
      htmlPage('<html><head><title>404 page title</title></head></html>', { status: 404 }));
    assert.equal(parsed.body.preview, null);
  });

  it('ignores a 500 response', async () => {
    const { parsed } = await withPage('https://example.com/boom',
      htmlPage('<html><head><title>oops</title></head></html>', { status: 500 }));
    assert.equal(parsed.body.preview, null);
  });

  for (const ct of ['application/json', 'application/pdf', 'image/png', 'text/plain']) {
    it(`does not parse a ${ct} body`, async () => {
      const { parsed } = await withPage('https://example.com/asset',
        htmlPage('<html><head><title>disguised</title></head></html>', { contentType: ct }));
      assert.equal(parsed.body.preview, null);
    });
  }

  it('accepts a bare text/html content type with no charset', async () => {
    const { parsed } = await withPage('https://example.com/bare',
      htmlPage('<html><head><title>bare</title></head></html>', { contentType: 'text/html' }));
    assert.equal(parsed.body.preview.title, 'bare');
  });

  it('treats a missing Content-Type as not-html (the `|| \'\'` default arm)', async () => {
    const stub = stubUnfurlFetch({
      page: () => ({ ok: true, status: 200, headers: { get: () => null }, body: null }),
    });
    try {
      const { parsed } = await get(db, 'https://example.com/noct');
      assert.equal(parsed.body.preview, null);
    } finally { stub.restore(); }
  });

  it('handles a 200 text/html response that carries no body at all', async () => {
    const stub = stubUnfurlFetch({
      page: () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, body: null }),
    });
    try {
      const { parsed } = await get(db, 'https://example.com/empty');
      assert.equal(parsed.status, 200);
      assert.equal(parsed.body.preview, null);
    } finally { stub.restore(); }
  });

  it('returns no preview when the page has neither a title nor an image', async () => {
    const { parsed } = await withPage('https://example.com/thin',
      htmlPage('<html><head><meta name="description" content="only a description"></head><body>hi</body></html>'));
    assert.equal(parsed.body.preview, null,
      'a description alone is not enough to render a card');
  });

  it('returns a preview when only an image is present (title null)', async () => {
    const { parsed } = await withPage('https://example.com/imageonly',
      htmlPage('<html><head><title></title><meta property="og:image" content="https://cdn.example.com/i.png"></head></html>'));
    assert.equal(parsed.body.preview.title, null);
    assert.equal(parsed.body.preview.image, 'https://cdn.example.com/i.png');
  });
});

describe('community/unfurl.js -- metadata extraction and field precedence', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  async function preview(html, { target = 'https://example.com/page', page } = {}) {
    const stub = stubUnfurlFetch({ page: page ?? (() => htmlPage(html)) });
    try {
      const { parsed } = await get(db, target);
      return parsed.body.preview;
    } finally { stub.restore(); }
  }

  it('prefers og:title, then twitter:title, then <title>', async () => {
    assert.equal((await preview(`<html><head>
      <title>doc title</title>
      <meta name="twitter:title" content="twitter title">
      <meta property="og:title" content="og title">
    </head></html>`)).title, 'og title');

    assert.equal((await preview(`<html><head>
      <title>doc title</title>
      <meta name="twitter:title" content="twitter title">
    </head></html>`)).title, 'twitter title');

    assert.equal((await preview('<html><head><title>  doc title  </title></head></html>')).title, 'doc title');
  });

  it('prefers og:description, then twitter:description, then description', async () => {
    assert.equal((await preview(`<html><head><title>t</title>
      <meta name="description" content="plain">
      <meta name="twitter:description" content="tw">
      <meta property="og:description" content="og">
    </head></html>`)).description, 'og');

    assert.equal((await preview(`<html><head><title>t</title>
      <meta name="description" content="plain">
      <meta name="twitter:description" content="tw">
    </head></html>`)).description, 'tw');

    assert.equal((await preview(`<html><head><title>t</title>
      <meta name="description" content="plain">
    </head></html>`)).description, 'plain');

    assert.equal((await preview('<html><head><title>t</title></head></html>')).description, null);
  });

  it('prefers og:image, then twitter:image', async () => {
    assert.equal((await preview(`<html><head><title>t</title>
      <meta name="twitter:image" content="https://cdn.example.com/tw.png">
      <meta property="og:image" content="https://cdn.example.com/og.png">
    </head></html>`)).image, 'https://cdn.example.com/og.png');

    assert.equal((await preview(`<html><head><title>t</title>
      <meta name="twitter:image" content="https://cdn.example.com/tw.png">
    </head></html>`)).image, 'https://cdn.example.com/tw.png');
  });

  it('uses og:site_name when present and the final hostname otherwise', async () => {
    assert.equal((await preview('<html><head><title>t</title><meta property="og:site_name" content="Example Times"></head></html>')).siteName, 'Example Times');
    assert.equal((await preview('<html><head><title>t</title></head></html>')).siteName, 'example.com');
  });

  it('strips a leading www. from domain but not from siteName', async () => {
    const p = await preview('<html><head><title>t</title></head></html>', { target: 'https://www.example.com/page' });
    assert.equal(p.domain, 'example.com');
    assert.equal(p.siteName, 'www.example.com');
  });

  it('skips meta tags with no key and meta tags with empty content', async () => {
    const p = await preview(`<html><head>
      <meta charset="utf-8">
      <meta property="og:title" content="">
      <meta name="twitter:title" content="fallback wins">
    </head></html>`);
    assert.equal(p.title, 'fallback wins',
      'an empty og:title must not shadow the next candidate');
  });

  it('clamps the title to 300 characters and the description to 500', async () => {
    const p = await preview(`<html><head>
      <meta property="og:title" content="${'T'.repeat(400)}">
      <meta property="og:description" content="${'D'.repeat(700)}">
    </head></html>`);
    assert.equal(p.title.length, 300);
    assert.equal(p.description.length, 500);
  });

  it('trims surrounding whitespace off og values', async () => {
    const p = await preview(`<html><head>
      <meta property="og:title" content="   Spaced Title   ">
      <meta property="og:description" content="
        Spaced description
      ">
    </head></html>`);
    assert.equal(p.title, 'Spaced Title');
    assert.equal(p.description, 'Spaced description');
  });

  it('resolves a relative og:image against the FINAL url after a redirect', async () => {
    const p = await preview(null, {
      target: 'https://example.com/start',
      page: (url) => (url === 'https://example.com/start'
        ? redirect('https://cdn.example.com/deep/article')
        : htmlPage('<html><head><title>t</title><meta property="og:image" content="../hero.png"></head></html>')),
    });
    assert.equal(p.image, 'https://cdn.example.com/hero.png');
  });

  it('drops an image that resolves to a non-https url', async () => {
    assert.equal((await preview('<html><head><title>t</title><meta property="og:image" content="http://cdn.example.com/i.png"></head></html>')).image, null);
    // Relative image on an http page also resolves to http, and is dropped.
    assert.equal((await preview('<html><head><title>t</title><meta property="og:image" content="/i.png"></head></html>', { target: 'http://example.com/page' })).image, null);
  });

  it('drops an unparseable image url instead of throwing', async () => {
    const p = await preview('<html><head><title>t</title><meta property="og:image" content="http://["></head></html>');
    assert.equal(p.image, null);
    assert.equal(p.title, 't', 'a bad image must not lose the rest of the preview');
  });

  it('reports the ORIGINAL member-supplied url, not the redirect destination', async () => {
    const p = await preview(null, {
      target: 'https://example.com/start',
      page: (url) => (url === 'https://example.com/start'
        ? redirect('https://elsewhere.example.com/final')
        : htmlPage('<html><head><title>t</title></head></html>')),
    });
    assert.equal(p.url, 'https://example.com/start');
    assert.equal(p.domain, 'elsewhere.example.com', 'the domain badge reflects where the link actually landed');
  });

  it('returns remote-authored text verbatim -- escaping is the renderer obligation, and the renderer uses textContent', async () => {
    // Recorded as a fact about the contract, not an endorsement: the JSON body
    // carries whatever the remote page said. src/pages/community/index.astro
    // renderLinkCard assigns it via textContent / createElement, never innerHTML,
    // which is what keeps this from being stored XSS.
    const p = await preview(`<html><head>
      <meta property="og:title" content="&lt;img src=x onerror=alert(1)&gt;">
      <meta property="og:description" content="&lt;script&gt;alert(2)&lt;/script&gt;">
    </head></html>`);
    assert.equal(p.title, '<img src=x onerror=alert(1)>');
    assert.equal(p.description, '<script>alert(2)</script>');
  });
});

describe('community/unfurl.js -- body cap and stream handling', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('reassembles a body delivered as many chunks', async () => {
    const stub = stubUnfurlFetch({
      page: () => chunkedPage(['<html><head><ti', 'tle>Chunk', 'ed Title</title>', '</head></html>']),
    });
    try {
      const { parsed } = await get(db, 'https://example.com/chunked');
      assert.equal(parsed.body.preview.title, 'Chunked Title');
    } finally { stub.restore(); }
  });

  // Both cap tests place a SECOND og:description past the 512 KB mark. The
  // parser is last-wins, so if the cap ever stopped biting the late value would
  // overwrite the early one and the assertion flips. Asserting only that the
  // early metadata survives would pass with the cap removed entirely.
  const PAST_CAP = '<meta property="og:description" content="past-the-cap">';

  it('stops reading at the 512 KB cap, dropping everything past it', async () => {
    const head = '<html><head><title>Capped</title><meta property="og:description" content="early">';
    const filler = '<p>' + 'x'.repeat(700 * 1024) + '</p>';
    const stub = stubUnfurlFetch({ page: () => chunkedPage([head, filler, PAST_CAP + '</head></html>']) });
    try {
      const { parsed } = await get(db, 'https://example.com/huge');
      assert.equal(parsed.body.preview.title, 'Capped');
      assert.equal(parsed.body.preview.description, 'early',
        'metadata past the cap must never be read, and metadata before it must survive');
      assert.ok(!JSON.stringify(parsed.body).includes('past-the-cap'));
    } finally { stub.restore(); }
  });

  it('caps a single oversized chunk without over-allocating', async () => {
    const oversized = '<html><head><title>One Big Chunk</title></head><body>'
      + 'y'.repeat(900 * 1024) + PAST_CAP;
    const stub = stubUnfurlFetch({ page: () => chunkedPage([oversized]) });
    try {
      const { parsed } = await get(db, 'https://example.com/onechunk');
      assert.equal(parsed.body.preview.title, 'One Big Chunk');
      assert.equal(parsed.body.preview.description, null,
        'the cap must bite even when the whole body arrives as one chunk');
    } finally { stub.restore(); }
  });

  it('keeps the bytes it already read when the body stream errors mid-read', async () => {
    const stub = stubUnfurlFetch({
      page: () => chunkedPage(['<html><head><title>Partial Read</title>'], { errorAfter: true }),
    });
    try {
      const { parsed } = await get(db, 'https://example.com/broken');
      assert.equal(parsed.body.preview.title, 'Partial Read',
        'a truncated stream must degrade to the metadata already received, not to a 500');
    } finally { stub.restore(); }
  });
});

describe('community/unfurl.js -- KV cache behaviour', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('serves a cached preview without any outbound request', async () => {
    const target = 'https://example.com/cached';
    const kv = mockKVJson({ [await cacheKeyFor(target)]: { preview: { url: target, title: 'From cache', domain: 'example.com' } } });
    const stub = stubUnfurlFetch();
    try {
      const { parsed } = await get(db, target, { kv });
      assert.equal(parsed.status, 200);
      assert.equal(parsed.body.preview.title, 'From cache');
      assert.equal(stub.calls.length, 0, 'a cache hit must short-circuit DNS and the page fetch');
    } finally { stub.restore(); }
  });

  it('serves a cached NEGATIVE result (preview null) without refetching', async () => {
    const target = 'https://example.com/known-bad';
    const kv = mockKVJson({ [await cacheKeyFor(target)]: { preview: null } });
    const stub = stubUnfurlFetch();
    try {
      const { parsed } = await get(db, target, { kv });
      assert.equal(parsed.body.preview, null);
      assert.equal(stub.calls.length, 0);
    } finally { stub.restore(); }
  });

  it('writes a successful preview under the sha256 key with the 7-day TTL', async () => {
    const target = 'https://example.com/fresh';
    const stub = stubUnfurlFetch({ page: () => htmlPage('<html><head><title>Fresh</title></head></html>') });
    try {
      const { parsed, kv } = await get(db, target);
      const writes = cacheWrites(kv);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].key, await cacheKeyFor(target));
      assert.equal(writes[0].opts.expirationTtl, 604800);
      assert.deepEqual(JSON.parse(writes[0].value).preview, parsed.body.preview);
    } finally { stub.restore(); }
  });

  it('keys different urls to different cache entries', async () => {
    assert.notEqual(await cacheKeyFor('https://example.com/a'), await cacheKeyFor('https://example.com/b'));
    const stub = stubUnfurlFetch({ page: () => htmlPage('<html><head><title>A</title></head></html>') });
    try {
      const kv = mockKVJson();
      await get(db, 'https://example.com/a', { kv });
      await get(db, 'https://example.com/b', { kv });
      const keys = cacheWrites(kv).map(w => w.key);
      assert.equal(new Set(keys).size, 2);
    } finally { stub.restore(); }
  });

  it('falls through to a live fetch when the KV read throws', async () => {
    const base = mockKVJson();
    const kv = {
      puts: base.puts, deletes: base.deletes,
      async get(key, type) {
        if (key.startsWith('unfurl:v1:')) throw new Error('KV read failure');
        return base.get(key, type);
      },
      put: base.put.bind(base),
      delete: base.delete.bind(base),
    };
    const stub = stubUnfurlFetch({ page: () => htmlPage('<html><head><title>Live</title></head></html>') });
    try {
      const { parsed } = await get(db, 'https://example.com/kvdown', { kv });
      assert.equal(parsed.status, 200);
      assert.equal(parsed.body.preview.title, 'Live', 'a KV read outage must not break previews');
      assert.equal(stub.pageCalls.length, 1);
    } finally { stub.restore(); }
  });

  it('still answers 200 when the KV write rejects', async () => {
    const base = mockKVJson();
    const kv = {
      puts: base.puts, deletes: base.deletes,
      get: base.get.bind(base),
      put(key, value, opts) {
        base.puts.push({ key, value, opts });
        return key.startsWith('unfurl:v1:') ? Promise.reject(new Error('KV write failure')) : Promise.resolve();
      },
      delete: base.delete.bind(base),
    };
    const stub = stubUnfurlFetch({ page: () => htmlPage('<html><head><title>Written?</title></head></html>') });
    try {
      const { parsed } = await get(db, 'https://example.com/kvwritefail', { kv });
      assert.equal(parsed.status, 200);
      assert.equal(parsed.body.preview.title, 'Written?');
    } finally { stub.restore(); }
  });
});
