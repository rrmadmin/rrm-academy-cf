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
 * Creates a D1-like mock database.
 * @param {object} queryMap - Keys are SQL substrings, values are { first, all, run } return data.
 *   - first: value returned by .first() — use null to simulate no row found
 *   - all: value returned by .all() — defaults to { results: [] }
 *   - run: value returned by .run() — defaults to { success: true }
 *   - throws: if truthy, .first()/.all()/.run() will throw with this message
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
        return spec?.first !== undefined ? spec.first : null;
      },
      async all() {
        _calls.push({ sql: this._sql, bound: this._bindings, method: 'all' });
        const spec = findMatch(this._sql);
        if (spec?.throws) throw new Error(spec.throws);
        return spec?.all !== undefined ? spec.all : { results: [] };
      },
      async run() {
        _calls.push({ sql: this._sql, bound: this._bindings, method: 'run' });
        const spec = findMatch(this._sql);
        if (spec?.throws) throw new Error(spec.throws);
        return spec?.run !== undefined ? spec.run : { success: true };
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
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    GA4_MEASUREMENT_ID: 'G-TEST',
    GA4_API_SECRET: 'test-ga4-secret',
    ELV_API_KEY: 'test-elv-key',
    EVENTS: {
      writeDataPoint() {},
    },
    ...overrides,
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
 * The in-memory rate limiter in _shared.js is keyed by IP, so each test
 * needs a unique IP to avoid cross-contamination between test runs.
 */
export function randomIp() {
  const oct = () => Math.floor(Math.random() * 254) + 1;
  return `${oct()}.${oct()}.${oct()}.${oct()}`;
}
