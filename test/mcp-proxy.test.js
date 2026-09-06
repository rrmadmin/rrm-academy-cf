/**
 * functions/mcp/index.js -- the apex -> MCP Worker proxy (RRMA-RT-4).
 *
 * WHY THIS FILE EXISTS AT ALL. This module is the only place in the repo where
 * a response composed by a DIFFERENT deployment is handed back to a client on
 * the apex origin, and where an apex request's `Authorization` is handed to
 * something else. Both directions are security decisions written as two flat
 * arrays of header names, and until this file there was no test anywhere in
 * the repo naming either of them: a rewrite that dropped `set-cookie` from
 * `STRIP_RESPONSE_HEADERS` would have shipped green. The red-team harness
 * cannot cover it, because the GATE it would attack lives in the Worker, which
 * is a different deployment and not this repo's code -- so `coverage.mjs`
 * exempts the route and the header policy is pinned here instead.
 *
 * WHAT IS ASSERTED, and from the principle rather than from the code:
 *  1. the caller's credential reaches upstream BYTE FOR BYTE. A proxy that
 *     normalised, re-cased or re-encoded it would break bearer tokens for every
 *     agent client while still "forwarding Authorization".
 *  2. nothing the upstream says can set state on the apex origin. `Set-Cookie`
 *     is the whole reason the strip list exists: mcp.rrmacademy.org is a
 *     sibling host, so a cookie it set through this proxy would land on
 *     rrmacademy.org itself, next to the session cookie.
 *  3. the upstream is the CONFIGURED host and nothing in the request can move
 *     it. Path, query, Host and forwarded-host are all attacker-chosen, and a
 *     proxy whose destination is a concatenation is exactly where an SSRF
 *     hides.
 *  4. a broken upstream produces a bounded, self-composed error. An upstream
 *     exception message can carry internal hostnames; echoing it is a leak.
 *
 * WHAT IS FAKED, and why that is honest here. `env.MCP_BACKEND` is a capturing
 * stub, so every assertion reads the REAL `Request` the module built -- the
 * URL, the header set, the method and the body -- rather than a description of
 * it. The fallback branch (no service binding, i.e. local wrangler dev) is
 * driven separately against a stubbed `globalThis.fetch` so the destination is
 * proven on BOTH paths, since they compose the URL independently of each other.
 *
 * Request bodies here are strings, not streams. Production is workerd, which
 * accepts `new Request(url, { body: <ReadableStream> })`; Node's undici refuses
 * it without `duplex: 'half'` and the module's try/catch would turn that into a
 * 502, testing the harness instead of the proxy. A string body travels the same
 * `init.body = request.body` line, so the passthrough assertion is unaffected.
 *
 * NOTED RESIDUAL, deliberately not asserted either way: the strip list is
 * cookie- and hop-by-hop-focused, so other origin-scoped response headers from
 * upstream (`Clear-Site-Data`, `Strict-Transport-Security`, `Content-Security-
 * Policy`) still reach the apex response. The upstream is first-party and the
 * worst of those is a logout, not a privilege, so pinning them in either
 * direction would freeze a decision nobody has made.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const mcp = await import('../functions/mcp/index.js');

const UPSTREAM_ORIGIN = 'https://mcp.rrmacademy.org';

/**
 * A stand-in for the CF `Request` the Pages runtime hands the handler. Only the
 * four members the module touches are present -- `url`, `method`, `headers.get`
 * and `body` -- so the test cannot accidentally pass because of a member the
 * production runtime does not provide.
 */
function apexRequest(method, { url = 'https://rrmacademy.org/mcp', headers = {}, body = null } = {}) {
  const h = new Headers(headers);
  return { method, url, headers: h, body };
}

/**
 * Capturing service binding. Records the Request the module built and answers
 * whatever the test asked for.
 */
function backend({ status = 200, statusText = 'OK', headers = {}, body = 'upstream-body', throws = null } = {}) {
  const calls = [];
  return {
    calls,
    binding: {
      async fetch(request) {
        calls.push({
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: await request.text().catch(() => ''),
        });
        if (throws) throw throws;
        const sendable = request.method === 'HEAD' ? null : body;
        return new Response(sendable, { status, statusText, headers });
      },
    },
  };
}

async function call(handler, request, env) {
  return handler({ request, env });
}

describe('functions/mcp -- request headers forwarded upstream', () => {
  it('forwards Authorization byte for byte, including case and spacing', async () => {
    // Deliberately awkward: mixed-case scheme, a token with base64 padding and
    // a dot, and no normalisation opportunity the proxy could take.
    const token = 'BeArEr eyJhbGciOi.J9==.sig-value_-';
    const up = backend();
    const res = await call(mcp.onRequestPost, apexRequest('POST', {
      headers: { authorization: token },
      body: '{}',
    }), { MCP_BACKEND: up.binding });

    assert.equal(res.status, 200);
    assert.equal(up.calls.length, 1);
    assert.equal(up.calls[0].headers.get('authorization'), token);
  });

  it('forwards every header on the allow list and nothing else', async () => {
    const up = backend();
    await call(mcp.onRequestPost, apexRequest('POST', {
      headers: {
        authorization: 'Bearer t',
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'mcp-session-id': 'sess-123',
        'mcp-protocol-version': '2025-06-18',
        'last-event-id': '42',
        'user-agent': 'ora-scanner/1.0',
        origin: 'https://ora.run',
        // Everything below is apex-side state or apex-side routing that the
        // upstream has no business seeing.
        cookie: 'rrma_session=super-secret-session-value',
        'x-forwarded-host': 'evil.example',
        'cf-access-jwt-assertion': 'apex-access-jwt',
        'x-real-ip': '10.0.0.1',
      },
      body: '{}',
    }), { MCP_BACKEND: up.binding });

    const sent = up.calls[0].headers;
    for (const [name, expected] of [
      ['authorization', 'Bearer t'],
      ['content-type', 'application/json'],
      ['accept', 'text/event-stream'],
      ['mcp-session-id', 'sess-123'],
      ['mcp-protocol-version', '2025-06-18'],
      ['last-event-id', '42'],
      ['user-agent', 'ora-scanner/1.0'],
      ['origin', 'https://ora.run'],
    ]) {
      assert.equal(sent.get(name), expected, `${name} must be forwarded`);
    }

    // The session cookie is the one that matters: this proxy is reachable
    // unauthenticated from the apex, so a browser with an apex session would
    // otherwise hand it to a sibling deployment on every call.
    assert.equal(sent.get('cookie'), null);
    assert.equal(sent.get('x-forwarded-host'), null);
    assert.equal(sent.get('cf-access-jwt-assertion'), null);
    assert.equal(sent.get('x-real-ip'), null);
    const serialized = JSON.stringify([...sent]);
    assert.ok(!serialized.includes('super-secret-session-value'), 'no apex cookie value may appear upstream');
  });

  it('translates cf-connecting-ip into x-forwarded-for and never invents one', async () => {
    const withIp = backend();
    await call(mcp.onRequestGet, apexRequest('GET', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    }), { MCP_BACKEND: withIp.binding });
    assert.equal(withIp.calls[0].headers.get('x-forwarded-for'), '203.0.113.7');
    assert.equal(withIp.calls[0].headers.get('cf-connecting-ip'), null);

    // A client-supplied x-forwarded-for must not survive on its own: upstream
    // rate limiting reads that header, so a spoofable one is a bypass.
    const spoof = backend();
    await call(mcp.onRequestGet, apexRequest('GET', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    }), { MCP_BACKEND: spoof.binding });
    assert.equal(spoof.calls[0].headers.get('x-forwarded-for'), null);
  });
});

describe('functions/mcp -- upstream response headers stripped', () => {
  it('never lets Set-Cookie reach the apex response, in any spelling', async () => {
    const up = backend({
      headers: {
        'set-cookie': 'apex_session=attacker-chosen; Domain=rrmacademy.org; Path=/',
        'set-cookie2': 'legacy=1',
        'content-type': 'application/json',
      },
    });
    const res = await call(mcp.onRequestPost, apexRequest('POST', { body: '{}' }), { MCP_BACKEND: up.binding });

    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(res.headers.get('Set-Cookie'), null);
    assert.equal(res.headers.get('set-cookie2'), null);
    assert.deepEqual(res.headers.getSetCookie?.() ?? [], []);
    const serialized = JSON.stringify([...res.headers]);
    assert.ok(!/attacker-chosen/.test(serialized), 'no cookie value may survive under any header name');
    // The proxy must still be a proxy: the legitimate header survives.
    assert.equal(res.headers.get('content-type'), 'application/json');
  });

  it('strips a Set-Cookie the upstream sent with unusual casing', async () => {
    // Headers normalises names, so this pins the module against a future
    // rewrite that compared raw names instead of using Headers.delete.
    const up = backend({ headers: { 'SET-COOKIE': 'a=b' } });
    const res = await call(mcp.onRequestGet, apexRequest('GET'), { MCP_BACKEND: up.binding });
    assert.deepEqual(res.headers.getSetCookie?.() ?? [], []);
    assert.equal(res.headers.get('set-cookie'), null);
  });

  it('strips each hop-by-hop header the module names, and only those', async () => {
    const up = backend({
      headers: {
        connection: 'keep-alive',
        'keep-alive': 'timeout=5',
        'set-cookie': 'x=1',
        'set-cookie2': 'y=2',
        'content-type': 'text/event-stream',
        'mcp-session-id': 'sess-abc',
        'cache-control': 'no-store',
      },
    });
    const res = await call(mcp.onRequestGet, apexRequest('GET'), { MCP_BACKEND: up.binding });

    // Every name on STRIP_RESPONSE_HEADERS, pinned individually so removing any
    // one of them from the module turns exactly one assertion red.
    // (`transfer-encoding` is asserted below; undici will not let a stub set it.)
    for (const name of ['connection', 'keep-alive', 'set-cookie', 'set-cookie2']) {
      assert.equal(res.headers.get(name), null, `${name} must be stripped`);
    }
    assert.ok(!/transfer-encoding/i.test(JSON.stringify([...res.headers])), 'transfer-encoding must be stripped');

    // Pass-through is the other half of the contract: strip too much and SSE
    // and session continuity break.
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    assert.equal(res.headers.get('mcp-session-id'), 'sess-abc');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  it('strips Set-Cookie on an upstream ERROR response too', async () => {
    // The error path is the one a misbehaving upstream controls most easily.
    const up = backend({ status: 500, statusText: 'Internal Server Error', headers: { 'set-cookie': 'x=1' }, body: 'boom' });
    const res = await call(mcp.onRequestPost, apexRequest('POST', { body: '{}' }), { MCP_BACKEND: up.binding });
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('set-cookie'), null);
    // A non-2xx upstream is still proxied verbatim: this is a transparent
    // proxy, and swallowing upstream errors would hide the Worker's own gate.
    assert.equal(await res.text(), 'boom');
  });
});

describe('functions/mcp -- the upstream destination cannot be steered', () => {
  const steering = [
    ['a plain path', 'https://rrmacademy.org/mcp'],
    ['a sub-path', 'https://rrmacademy.org/mcp/messages'],
    ['a protocol-relative path', 'https://rrmacademy.org//evil.example/mcp'],
    ['a traversal', 'https://rrmacademy.org/mcp/../../admin'],
    ['an encoded traversal', 'https://rrmacademy.org/mcp/%2e%2e%2f%2e%2e'],
    ['an at-sign userinfo trick', 'https://rrmacademy.org/mcp@evil.example/x'],
    ['a spoofed apex host', 'https://evil.example/mcp'],
  ];

  for (const [label, url] of steering) {
    it(`sends ${label} to the configured Worker origin`, async () => {
      const up = backend();
      await call(mcp.onRequestGet, apexRequest('GET', {
        url,
        headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
      }), { MCP_BACKEND: up.binding });

      const sent = new URL(up.calls[0].url);
      assert.equal(sent.origin, UPSTREAM_ORIGIN, `${label} must not move the origin`);
    });
  }

  it('carries the path and query through to the Worker unchanged', async () => {
    const up = backend();
    await call(mcp.onRequestGet, apexRequest('GET', {
      url: 'https://rrmacademy.org/mcp/messages?sessionId=abc&x=1',
    }), { MCP_BACKEND: up.binding });
    assert.equal(up.calls[0].url, `${UPSTREAM_ORIGIN}/mcp/messages?sessionId=abc&x=1`);
  });

  it('uses the same configured origin on the no-binding fallback path', async () => {
    // Local wrangler dev has no service binding, so the destination is composed
    // a second time against globalThis.fetch. Both compositions must agree.
    const original = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (input, init) => {
      seen.push({ url: String(input), method: init.method, headers: init.headers });
      return new Response('ok', { status: 200, headers: { 'set-cookie': 'x=1' } });
    };
    try {
      const res = await call(mcp.onRequestPost, apexRequest('POST', {
        url: 'https://evil.example/mcp?q=1',
        headers: { authorization: 'Bearer fallback-token' },
        body: '{}',
      }), {});
      assert.equal(seen.length, 1);
      assert.equal(new URL(seen[0].url).origin, UPSTREAM_ORIGIN);
      assert.equal(seen[0].url, `${UPSTREAM_ORIGIN}/mcp?q=1`);
      assert.equal(seen[0].headers.get('authorization'), 'Bearer fallback-token');
      assert.equal(res.headers.get('set-cookie'), null);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('functions/mcp -- method and body passthrough', () => {
  it('preserves the method on each exported verb', async () => {
    const cases = [
      [mcp.onRequestGet, 'GET'],
      [mcp.onRequestPost, 'POST'],
      [mcp.onRequestOptions, 'OPTIONS'],
      [mcp.onRequestDelete, 'DELETE'],
      [mcp.onRequestHead, 'HEAD'],
    ];
    for (const [handler, method] of cases) {
      const up = backend();
      const body = method === 'GET' || method === 'HEAD' ? null : '{"jsonrpc":"2.0"}';
      await call(handler, apexRequest(method, { body }), { MCP_BACKEND: up.binding });
      assert.equal(up.calls[0].method, method, `${method} must reach upstream as ${method}`);
    }
  });

  it('delivers the request body upstream verbatim', async () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'sear ch', arguments: { q: 'ünicode ✓' } } });
    const up = backend();
    await call(mcp.onRequestPost, apexRequest('POST', { body: payload, headers: { 'content-type': 'application/json' } }),
      { MCP_BACKEND: up.binding });
    assert.equal(up.calls[0].body, payload);
  });

  it('sends no body on GET or HEAD', async () => {
    for (const [handler, method] of [[mcp.onRequestGet, 'GET'], [mcp.onRequestHead, 'HEAD']]) {
      const up = backend();
      await call(handler, apexRequest(method, { body: 'should-not-be-sent' }), { MCP_BACKEND: up.binding });
      assert.equal(up.calls[0].body, '', `${method} must not carry a body upstream`);
    }
  });

  it('returns the upstream status, statusText and body unchanged', async () => {
    const up = backend({ status: 202, statusText: 'Accepted', body: 'event: message\ndata: {}\n\n' });
    const res = await call(mcp.onRequestPost, apexRequest('POST', { body: '{}' }), { MCP_BACKEND: up.binding });
    assert.equal(res.status, 202);
    assert.equal(await res.text(), 'event: message\ndata: {}\n\n');
  });
});

describe('functions/mcp -- upstream failure is bounded and quiet', () => {
  it('answers a fixed JSON-RPC 502 and echoes nothing from the exception', async () => {
    const up = backend({ throws: new Error('connect ECONNREFUSED 10.7.0.42:8787 mcp-internal.rrm.local secret-binding-name') });
    const res = await call(mcp.onRequestPost, apexRequest('POST', { body: '{}' }), { MCP_BACKEND: up.binding });

    assert.equal(res.status, 502);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Upstream unavailable' },
    });
    for (const leak of ['ECONNREFUSED', '10.7.0.42', 'mcp-internal', 'secret-binding-name']) {
      assert.ok(!text.includes(leak), `error body must not echo ${leak}`);
    }
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(res.headers.get('set-cookie'), null);
  });

  it('answers the same bounded error when the public fetch fallback throws', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('fetch failed: internal-hostname.workers.dev'); };
    try {
      const res = await call(mcp.onRequestGet, apexRequest('GET'), {});
      assert.equal(res.status, 502);
      const text = await res.text();
      assert.ok(!text.includes('internal-hostname'), 'error body must not echo the exception');
      assert.equal(JSON.parse(text).error.code, -32000);
    } finally {
      globalThis.fetch = original;
    }
  });
});
