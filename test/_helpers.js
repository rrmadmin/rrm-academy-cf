/**
 * Shared test mock factories for CF Pages Functions unit tests.
 * Used by auth-login.test.js, auth-signup.test.js, validate.test.js, etc.
 */

/**
 * Creates a Request-like object suitable for CF Pages Function handlers.
 * @param {string} method - HTTP method
 * @param {object} opts
 * @param {object} [opts.body] - Request body (will be JSON-serialized)
 * @param {object} [opts.headers] - Header key/value pairs
 * @param {string} [opts.url] - Request URL
 * @param {string} [opts.rawBody] - Raw body string (mutually exclusive with body)
 */
export function mockRequest(method, { body, headers = {}, url = 'https://rrmacademy.org/api/test', rawBody } = {}) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

  return {
    method,
    url,
    headers: {
      get(name) {
        return headerMap.get(name.toLowerCase()) ?? null;
      },
    },
    async json() {
      if (rawBody !== undefined) {
        return JSON.parse(rawBody);
      }
      if (body === undefined) throw new SyntaxError('No body provided');
      return body;
    },
    async text() {
      if (rawBody !== undefined) return rawBody;
      if (body === undefined) return '';
      return JSON.stringify(body);
    },
  };
}

/**
 * Reads the collating sequence SQLite would use for each bound parameter.
 *
 * SQLite applies a `COLLATE NOCASE` suffix to the ONE comparison it trails, so
 * this scopes it the same way: a placeholder is case-insensitive only when
 * `COLLATE NOCASE` immediately follows it (an intervening `ESCAPE '<literal>'`
 * from a LIKE comparison is skipped). Everything else is BINARY, i.e. SQLite's
 * default, i.e. case-SENSITIVE.
 *
 * Numbered placeholders (`?2`) bind by their number; bare `?` bind by order of
 * appearance, exactly as D1 does.
 *
 * @param {string} sql
 * @returns {Array<'nocase'|'binary'>} collation per zero-based binding index
 */
export function bindingCollations(sql) {
  const collations = [];
  let ordinal = 0;
  for (const match of sql.matchAll(/\?(\d*)/g)) {
    const index = match[1] ? Number(match[1]) - 1 : ordinal;
    ordinal += 1;
    const trailing = sql.slice(match.index + match[0].length).replace(/^\s*ESCAPE\s+'(?:[^']|'')*'/i, '');
    collations[index] = /^\s*COLLATE\s+NOCASE\b/i.test(trailing) ? 'nocase' : 'binary';
  }
  return collations;
}

/**
 * Decides whether a canned row is visible to this statement.
 *
 * With no `stored` in the spec the row is unconditionally visible (the original
 * behaviour). With `stored` present, each stored value is compared against the
 * bound value using the collation the STATEMENT ITSELF declares -- so dropping
 * `COLLATE NOCASE` from a query turns a case-mismatched lookup into a miss,
 * which is what makes a case-sensitivity assertion able to fail.
 */
function rowVisible(sql, bindings, spec) {
  if (!spec || spec.stored === undefined) return true;
  const stored = Array.isArray(spec.stored) ? spec.stored : [spec.stored];
  const collations = bindingCollations(sql);
  return stored.every((value, i) => {
    if (value === undefined || value === null) return true; // wildcard slot
    const bound = bindings[i];
    if (bound === undefined || bound === null) return false;
    return collations[i] === 'nocase'
      ? String(bound).toLowerCase() === String(value).toLowerCase()
      : String(bound) === String(value);
  });
}

/**
 * Creates a D1-like mock database.
 * @param {object} queryMap - Keys are SQL substrings, values are { first, all, run } return data.
 *   - first: value returned by .first() — use null to simulate no row found
 *   - all: value returned by .all() — defaults to { results: [] }
 *   - run: value returned by .run() — defaults to { success: true }
 *   - throws: if truthy, .first()/.all()/.run() will throw with this message
 *   - stored: the value(s) the mocked row actually HOLDS, positionally against
 *     the statement's bindings (null/undefined = wildcard, single value = one
 *     binding). The canned first/all/run is returned only when every bound
 *     value matches its stored counterpart under the collation the statement
 *     declares -- case-insensitively only where the query says COLLATE NOCASE,
 *     case-sensitively otherwise. On a miss the mock answers the way D1 does:
 *     first -> null, all -> no results, run -> 0 changes.
 *
 *     Without `stored` the mock hands back the canned row whatever was bound,
 *     which silently makes every "this lookup is case-insensitive" assertion
 *     vacuous. Use `stored` on any lookup whose collation matters.
 *
 * The mock tracks every prepare() call in _calls for assertion inspection.
 * Each _calls entry: { sql, bound, method }
 */
export function mockDB(queryMap = {}) {
  const _calls = [];

  function findMatch(sql) {
    for (const [substring, spec] of Object.entries(queryMap)) {
      if (sql.includes(substring)) return spec;
    }
    return null;
  }

  function makeStmt(sql) {
    const stmt = {
      _sql: sql,
      _bindings: [],
      bind(...args) {
        this._bindings = args;
        return this;
      },
      async first() {
        _calls.push({ sql: this._sql, bound: this._bindings, method: 'first' });
        const spec = findMatch(this._sql);
        if (spec?.throws) throw new Error(spec.throws);
        if (!rowVisible(this._sql, this._bindings, spec)) return null;
        return spec?.first !== undefined ? spec.first : null;
      },
      async all() {
        _calls.push({ sql: this._sql, bound: this._bindings, method: 'all' });
        const spec = findMatch(this._sql);
        if (spec?.throws) throw new Error(spec.throws);
        if (!rowVisible(this._sql, this._bindings, spec)) return { results: [] };
        return spec?.all !== undefined ? spec.all : { results: [] };
      },
      async run() {
        _calls.push({ sql: this._sql, bound: this._bindings, method: 'run' });
        const spec = findMatch(this._sql);
        if (spec?.throws) throw new Error(spec.throws);
        if (!rowVisible(this._sql, this._bindings, spec)) return { success: true, meta: { changes: 0 } };
        return spec?.run !== undefined ? spec.run : { success: true, meta: { changes: 1 } };
      },
    };
    return stmt;
  }

  return {
    _calls,
    prepare(sql) {
      return makeStmt(sql);
    },
    async batch(stmts) {
      const results = [];
      for (const stmt of stmts) {
        _calls.push({ sql: stmt._sql, bound: stmt._bindings, method: 'run(batch)' });
        const spec = findMatch(stmt._sql);
        if (spec?.throws) throw new Error(spec.throws);
        if (!rowVisible(stmt._sql, stmt._bindings, spec)) {
          results.push({ success: true, meta: { changes: 0 } });
          continue;
        }
        results.push(spec?.run !== undefined ? spec.run : { success: true });
      }
      return results;
    },
  };
}

/**
 * Creates a minimal env bag matching CF Pages Function env expectations.
 * @param {object} overrides - Override any default key/value
 */
export function mockEnv(overrides = {}) {
  return {
    DB: mockDB(),
    CF_TURNSTILE_SECRET: 'test-turnstile-secret',
    AWS_ACCESS_KEY_ID: 'test-aws-key',
    AWS_SECRET_ACCESS_KEY: 'test-aws-secret',
    AWS_SES_REGION: 'us-east-1',
    // Cloudflare Email Sending, the rail RRM transactional mail rides since
    // 2026-09-09. Every sender in this repo is on @mail.rrmacademy.org, the
    // onboarded sending subdomain, so vendor/mail resolves lane cf_rrm for
    // them and these two bindings are what the rail needs. The account id
    // must be alphanumeric: the package refuses anything else rather than
    // building a URL out of it.
    EMAIL_SEND_ACCOUNT_ID: 'testaccountid0000000000000000000',
    EMAIL_SEND_TOKEN: 'test-email-send-token',
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    GA4_MEASUREMENT_ID: 'G-TEST',
    GA4_API_SECRET: 'test-ga4-secret',
    ELV_API_KEY: 'test-elv-key',
    COMMUNITY_KV: mockKV(),
    EVENTS: {
      writeDataPoint() {},
    },
    ...overrides,
  };
}

/**
 * Minimal in-memory KV stub matching the subset of the CF KV interface used
 * by checkRateLimit / cooldown counters: get(key), put(key, value, opts).
 * checkRateLimit fails CLOSED on missing KV (returns 429), so tests that
 * exercise rate-limited endpoints need a working KV stub. Each test should
 * still call randomIp() so per-test bucket keys don't collide.
 */
export function mockKV() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value /* , opts */) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

/**
 * Creates a waitUntil mock that collects promises for later inspection.
 * Returns a function with a .promises array.
 */
export function mockWaitUntil() {
  const promises = [];
  const fn = (p) => promises.push(p);
  fn.promises = promises;
  return fn;
}

/**
 * Parses a Response object into { status, body, headers }.
 * @param {Response} response
 */
export async function parseResponse(response) {
  let body;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { status: response.status, body, headers };
}

/**
 * Generates a random IP address string for isolating rate limiter state per test.
 * The KV-backed rate limiter in _shared.js is keyed by `rl:<scope>:<ip>`, so
 * each test needs a unique IP to keep its bucket independent (the COMMUNITY_KV
 * stub in mockEnv is shared across the file). Without per-test IPs, sequential
 * subtests on the same scope would accumulate counts and trip 429.
 */
export function randomIp() {
  const oct = () => Math.floor(Math.random() * 254) + 1;
  return `${oct()}.${oct()}.${oct()}.${oct()}`;
}

/**
 * KV stub that honors the CF Workers KV `get(key, 'json')` type argument.
 *
 * The plain mockKV() above always returns the raw stored string, which is fine
 * for the rate limiter (it JSON.parses itself) but silently wrong for callers
 * that ask KV to deserialize -- e.g. survey/request.js and survey/submit.js do
 * `SURVEY_TOKENS.get('token:x', 'json')` and then read `.used` / `.email` off
 * the result. Against the raw-string stub those reads are `undefined` and every
 * token would look unused, so the stub would hide exactly the bug the tests
 * exist to catch.
 *
 * Records every write in `.puts` (key, value, opts) so tests can assert the
 * expirationTtl a caller chose, and `.deletes` so token-rollback paths can be
 * asserted by key rather than by absence alone.
 */
export function mockKVJson(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const puts = [];
  const deletes = [];
  return {
    _store: store,
    puts,
    deletes,
    /** Read the current value of a key as parsed JSON (null when absent). */
    read(key) {
      return store.has(key) ? JSON.parse(store.get(key)) : null;
    },
    async get(key, type) {
      if (!store.has(key)) return null;
      const raw = store.get(key);
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value, opts = {}) {
      puts.push({ key, value, opts });
      store.set(key, value);
    },
    async delete(key) {
      deletes.push(key);
      store.delete(key);
    },
  };
}

/**
 * Replaces globalThis.fetch with a router over the external services the
 * functions/ surface talks to, and records every call.
 *
 * Routed hosts: Cloudflare DoH (email MX validation), EmailListVerify, AWS SES
 * (aws4fetch hands the stub a signed Request, so the body is read off the
 * Request itself), Cloudflare Email Sending, GA4 Measurement Protocol, and
 * Turnstile siteverify.
 *
 * Returns a handle with:
 *   calls    -- [{ url, body }] in call order, body parsed as JSON when possible
 *   ses      -- SES sends only, body already parsed (FromEmailAddress/Destination/Content)
 *   cfEmail  -- Cloudflare Email Sending sends only (to/from/subject/text/html)
 *   mail     -- both rails, in call order
 *   ga4      -- GA4 MP sends only, body already parsed
 *   restore()-- puts the real fetch back
 *
 * `overrides` lets a single test change one service's response without
 * rebuilding the router, e.g. { ses: () => { throw new Error('SES down'); } }.
 */
/**
 * One outbound message, whichever rail carried it. `raw` is the decoded MIME
 * document for an SES Raw send and null otherwise; `html` and `text` are the
 * parts, empty strings when the message had none, so an assertion can match
 * against them without a null check.
 */
export function normaliseMail(call) {
  const body = call.body || {};
  if (call.service === 'cf_email') {
    return {
      rail: 'cf_rrm',
      call,
      from: body.from ?? '',
      to: body.to === undefined ? [] : [body.to],
      subject: body.subject ?? '',
      html: body.html ?? '',
      text: body.text ?? '',
      headers: body.headers ?? {},
      replyTo: body.reply_to ?? null,
      raw: null,
    };
  }
  const simple = body?.Content?.Simple;
  const rawData = body?.Content?.Raw?.Data;
  const raw = rawData ? Buffer.from(rawData, 'base64').toString('utf8') : null;
  return {
    rail: 'ses_rrm',
    call,
    from: body.FromEmailAddress ?? '',
    to: body?.Destination?.ToAddresses ?? [],
    subject: simple?.Subject?.Data ?? '',
    html: simple?.Body?.Html?.Data ?? '',
    text: simple?.Body?.Text?.Data ?? '',
    headers: {},
    replyTo: body.ReplyToAddresses?.[0] ?? null,
    raw,
  };
}

export function stubExternalFetch(overrides = {}) {
  const original = globalThis.fetch;
  const calls = [];

  async function readBody(input, init) {
    const raw = init?.body ?? (input && typeof input.text === 'function' ? await input.text() : null);
    if (typeof raw !== 'string') return raw ?? null;
    try { return JSON.parse(raw); } catch { return raw; }
  }

  globalThis.fetch = async (input, init) => {
    const url = (input && typeof input === 'object' && input.url) ? input.url : String(input);
    const body = await readBody(input, init);
    const call = { url, body };
    calls.push(call);

    if (url.includes('cloudflare-dns.com')) {
      call.service = 'dns';
      if (overrides.dns) return overrides.dns(call);
      return { ok: true, json: async () => ({ Answer: [{ data: 'mx.example.com' }] }) };
    }
    if (url.includes('emaillistverify.com')) {
      call.service = 'elv';
      if (overrides.elv) return overrides.elv(call);
      return { ok: true, text: async () => 'ok' };
    }
    if (url.includes('amazonaws.com')) {
      call.service = 'ses';
      if (overrides.ses) return overrides.ses(call);
      return { ok: true, status: 200, json: async () => ({ MessageId: 'mock-ses-message-id' }), text: async () => '{}' };
    }
    if (url.includes('/email/sending/send')) {
      // Cloudflare Email Sending, lane cf_rrm. Success is `success: true`
      // plus no permanent bounce, and `message_id` is the only evidence a
      // queued send leaves; the three arrays are empty on a real queued send,
      // so the default answers exactly that rather than something friendlier.
      call.service = 'cf_email';
      if (overrides.cfEmail) return overrides.cfEmail(call);
      /**
       * A test that injected `ses` meant "the mail rail is down", written
       * when there was one rail. It still means that: the override answers
       * for Cloudflare too, so a delivery-failure test keeps failing the send
       * rather than quietly succeeding on the new rail. When the injected
       * answer is a 5xx or a throw, the adapter's `fallback: 'ses'` then
       * takes the SES leg and this same override fails that too, which is the
       * production shape a cutover failure actually has.
       */
      if (overrides.ses) return overrides.ses(call);
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, errors: [], result: { message_id: 'mock-cf-message-id', delivered: [], queued: [], permanent_bounces: [] } }),
        text: async () => '{"success":true}',
      };
    }
    if (url.includes('google-analytics.com')) {
      call.service = 'ga4';
      if (overrides.ga4) return overrides.ga4(call);
      return { ok: true, status: 204, text: async () => '' };
    }
    if (url.includes('siteverify')) {
      call.service = 'turnstile';
      if (overrides.turnstile) return overrides.turnstile(call);
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (url.includes('api.stripe.com')) {
      // No default: a test that needs the Stripe API must opt in via
      // `{ stripe: stripeRoutes({...}) }`. Falling through to the throw below
      // keeps "Stripe is unreachable" as the default shape, which is what the
      // fail-soft branches in the billing handlers are written for.
      call.service = 'stripe';
      if (overrides.stripe) return overrides.stripe(call);
    }

    call.service = call.service ?? 'unrouted';
    if (overrides.default) return overrides.default(call);
    throw new Error(`stubExternalFetch: unrouted request to ${url}`);
  };

  return {
    calls,
    get ses() { return calls.filter(c => c.service === 'ses'); },
    /** Cloudflare Email Sending calls, body already parsed (to/from/subject/text/html). */
    get cfEmail() { return calls.filter(c => c.service === 'cf_email'); },
    /**
     * Every outbound message on either RRM rail, in call order, NORMALISED:
     * `{ rail, from, to, subject, html, text, headers, raw }`.
     *
     * The two rails carry the same message in different shapes (SES nests it
     * under `Content.Simple` or base64s a whole MIME document under
     * `Content.Raw`; Cloudflare sends flat `to`/`from`/`subject`/`html`), and
     * a test asserting "the link is in the body" has no business caring which.
     * Reading the rail-specific payload is still possible through `ses` and
     * `cfEmail`; this is for everything that only wants the message.
     */
    get mail() { return calls.filter(c => c.service === 'ses' || c.service === 'cf_email').map(normaliseMail); },
    get ga4() { return calls.filter(c => c.service === 'ga4'); },
    restore() { globalThis.fetch = original; },
  };
}

/**
 * Awaits every promise handed to a mockWaitUntil() so fire-and-forget work
 * (GA4 beacons, admin alert emails) has actually run before assertions.
 * Rejections are swallowed: production wraps these in .catch(() => {}), and a
 * test asserting on the resulting side effects should see the same outcome.
 */
export async function drainWaitUntil(waitUntil) {
  await Promise.allSettled(waitUntil.promises.slice());
}

/**
 * Builds a `stripe` route handler for stubExternalFetch.
 *
 * `routes` maps a substring of the Stripe REST path to either a resource
 * object or a function (call) => resource. The stripe-node fetch HTTP client
 * needs a genuine Response (it reads .status, .headers and the body stream),
 * so a plain object literal is not enough -- this returns real Responses.
 *
 *   stubExternalFetch({ stripe: stripeRoutes({
 *     '/v1/checkout/sessions/': { id: 'cs_1', payment_intent: 'pi_resolved' },
 *     '/v1/subscriptions/sub_': { id: 'sub_1', status: 'active' },
 *   }) })
 *
 * An unmatched path answers 404 with a Stripe-shaped error, so a test that
 * forgets a route gets a resource_missing rather than a silent empty success.
 */
export function stripeRoutes(routes = {}) {
  return (call) => {
    const path = new URL(call.url).pathname;
    for (const [needle, value] of Object.entries(routes)) {
      if (path.includes(needle)) {
        const body = typeof value === 'function' ? value(call) : value;
        // A Response passes straight through, so a test can make one Stripe
        // endpoint fail (e.g. force the search-to-list fallback) while others
        // succeed. Routes are matched in insertion order, so list the more
        // specific path first.
        if (body instanceof Response) return body;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json', 'request-id': 'req_stub' },
        });
      }
    }
    return new Response(
      JSON.stringify({ error: { type: 'invalid_request_error', code: 'resource_missing', message: `stripeRoutes: no route for ${path}` } }),
      { status: 404, headers: { 'content-type': 'application/json', 'request-id': 'req_stub' } }
    );
  };
}
