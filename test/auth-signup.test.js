/**
 * Tests for POST /api/auth/signup (functions/api/auth/signup.js)
 * Run with: node --test test/auth-signup.test.js
 *
 * Key behaviors under test:
 * - Input validation (firstName, lastName, email, password)
 * - Rate limiting (unique IP per test to avoid cross-contamination)
 * - Missing DB binding returns non-200
 * - SQL injection prevention (raw user input never appears in SQL strings)
 *
 * Note: signup.js calls validateEmail (MX lookup via fetch) and
 * verifyAndTagEmail (ELV API via fetch). Tests stub globalThis.fetch
 * to return success for DNS/MX lookups, turnstile, and ELV.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/auth/signup.js';
import { mockRequest, mockDB, mockEnv, mockWaitUntil, parseResponse, randomIp } from './_helpers.js';

// Stub all external fetch calls needed for a "happy path" signup:
//   - Cloudflare DNS-over-HTTPS (MX check in _email-validate.js)
//   - Turnstile siteverify
//   - ELV API
// Returns a restore function.
function stubAllExternalFetchSuccess() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, _opts) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    // Turnstile
    if (urlStr.includes('siteverify')) {
      return { ok: true, json: async () => ({ success: true }) };
    }
    // Cloudflare DoH MX check
    if (urlStr.includes('cloudflare-dns.com') && urlStr.includes('type=MX')) {
      return {
        ok: true,
        json: async () => ({ Answer: [{ data: 'mail.example.com' }] }),
      };
    }
    // Cloudflare DoH A record fallback
    if (urlStr.includes('cloudflare-dns.com') && urlStr.includes('type=A')) {
      return {
        ok: true,
        json: async () => ({ Answer: [{ data: '93.184.216.34' }] }),
      };
    }
    // ELV API
    if (urlStr.includes('emaillistverify.com')) {
      return { ok: true, text: async () => 'ok' };
    }
    // AWS SES -- allow but swallow (we don't care about email delivery in unit tests)
    if (urlStr.includes('amazonaws.com')) {
      return { ok: true, text: async () => '<SendEmailResponse/>' };
    }
    return original(url, _opts);
  };
  return () => { globalThis.fetch = original; };
}

function makeContext(request, env, waitUntil) {
  return { request, env, waitUntil };
}

describe('POST /api/auth/signup -- required field validation', () => {
  it('returns 400 for missing firstName', async () => {
    const ip = randomIp();
    const restore = stubAllExternalFetchSuccess();
    try {
      const req = mockRequest('POST', {
        body: { lastName: 'Smith', email: 'alice@example.com', password: 'aaaa-bbbb-cccc-dddd', turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv();
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { status, body } = await parseResponse(res);
      assert.equal(status, 400);
      assert.ok(body.error, 'Should have error field');
    } finally {
      restore();
    }
  });

  it('returns 400 for missing lastName', async () => {
    const ip = randomIp();
    const restore = stubAllExternalFetchSuccess();
    try {
      const req = mockRequest('POST', {
        body: { firstName: 'Alice', email: 'alice@example.com', password: 'aaaa-bbbb-cccc-dddd', turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv();
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { status } = await parseResponse(res);
      assert.equal(status, 400);
    } finally {
      restore();
    }
  });

  it('returns 400 for missing email', async () => {
    const ip = randomIp();
    const restore = stubAllExternalFetchSuccess();
    try {
      const req = mockRequest('POST', {
        body: { firstName: 'Alice', lastName: 'Smith', password: 'aaaa-bbbb-cccc-dddd', turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv();
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { status } = await parseResponse(res);
      assert.equal(status, 400);
    } finally {
      restore();
    }
  });

  it('returns 400 for missing password', async () => {
    const ip = randomIp();
    const restore = stubAllExternalFetchSuccess();
    try {
      const req = mockRequest('POST', {
        body: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv();
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { status } = await parseResponse(res);
      assert.equal(status, 400);
    } finally {
      restore();
    }
  });
});

describe('POST /api/auth/signup -- password validation', () => {
  it('returns 400 for password under 8 chars', async () => {
    const ip = randomIp();
    const restore = stubAllExternalFetchSuccess();
    try {
      const req = mockRequest('POST', {
        body: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', password: 'short', turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv();
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { status, body } = await parseResponse(res);
      assert.equal(status, 400);
      assert.ok(body.error, 'Should have error field');
    } finally {
      restore();
    }
  });

  it('returns 400 for password exactly 7 chars', async () => {
    const ip = randomIp();
    const restore = stubAllExternalFetchSuccess();
    try {
      const req = mockRequest('POST', {
        body: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', password: '1234567', turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv();
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { status } = await parseResponse(res);
      assert.equal(status, 400);
    } finally {
      restore();
    }
  });
});

describe('POST /api/auth/signup -- name length limits', () => {
  it('returns 400 for firstName over 100 chars', async () => {
    const ip = randomIp();
    const restore = stubAllExternalFetchSuccess();
    try {
      const req = mockRequest('POST', {
        body: {
          firstName: 'A'.repeat(101),
          lastName: 'Smith',
          email: 'alice@example.com',
          password: 'aaaa-bbbb-cccc-dddd',
          turnstileToken: 'tok',
        },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv();
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { status } = await parseResponse(res);
      assert.equal(status, 400);
    } finally {
      restore();
    }
  });

  it('returns 400 for lastName over 100 chars', async () => {
    const ip = randomIp();
    const restore = stubAllExternalFetchSuccess();
    try {
      const req = mockRequest('POST', {
        body: {
          firstName: 'Alice',
          lastName: 'S'.repeat(101),
          email: 'alice@example.com',
          password: 'aaaa-bbbb-cccc-dddd',
          turnstileToken: 'tok',
        },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv();
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { status } = await parseResponse(res);
      assert.equal(status, 400);
    } finally {
      restore();
    }
  });
});

describe('POST /api/auth/signup -- missing DB binding', () => {
  it('returns non-200 when DB is missing', async () => {
    const ip = randomIp();
    const req = mockRequest('POST', {
      body: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', password: 'aaaa-bbbb-cccc-dddd' },
      headers: { 'CF-Connecting-IP': ip },
    });
    const env = mockEnv({ DB: undefined });
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt));
    const { status } = await parseResponse(res);
    assert.notEqual(status, 200, 'Missing DB must not return 200');
    assert.ok(status >= 400, `Expected 4xx/5xx, got ${status}`);
  });

  it('checks the rate limit before the DB binding guard', async () => {
    // Order matters: a misconfigured account must not become an unmetered
    // endpoint that answers 500 as fast as it is asked.
    const ip = randomIp();
    const env = mockEnv({ DB: undefined });
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const req = mockRequest('POST', {
        body: { firstName: 'Alice', lastName: 'Smith', email: `alice${i}@example.com`, password: 'aaaa-bbbb-cccc-dddd' },
        headers: { 'CF-Connecting-IP': ip },
      });
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      statuses.push((await parseResponse(res)).status);
    }
    assert.deepEqual(statuses, [500, 500, 500, 500, 500]);
    const req = mockRequest('POST', {
      body: { firstName: 'Alice', lastName: 'Smith', email: 'alice5@example.com', password: 'aaaa-bbbb-cccc-dddd' },
      headers: { 'CF-Connecting-IP': ip },
    });
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 429, 'the 6th attempt from one IP must be rate-limited even while misconfigured');
    assert.match(body.error, /Too many attempts/);
  });
});

describe('POST /api/auth/signup -- SQL injection prevention', () => {
  it('never interpolates raw user input into SQL strings', async () => {
    const ip = randomIp();
    const restore = stubAllExternalFetchSuccess();
    try {
      // Use SQL-injection-style input for all user-controlled fields
      const maliciousInput = "'; DROP TABLE user; --";

      const db = mockDB({
        'FROM user WHERE': { first: null },           // no existing user
        'INSERT INTO contact': { run: { success: true } },
        'SELECT id FROM contact': { first: { id: 'contact-1' } },
        'INSERT OR REPLACE INTO contact_tag': { run: { success: true } },
        'INSERT INTO user': { run: { success: true } },
        'INSERT INTO email_verification': { run: { success: true } },
        'INSERT INTO session': { run: { success: true } },
      });

      const req = mockRequest('POST', {
        body: {
          firstName: maliciousInput,
          lastName: maliciousInput,
          email: 'injtest@example.com',
          password: 'aaaa-bbbb-cccc-dddd',
          turnstileToken: 'tok',
        },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv({ DB: db });
      const wt = mockWaitUntil();

      await onRequestPost(makeContext(req, env, wt));

      // Inspect every SQL call made -- raw user input must NEVER appear in the SQL string itself.
      // It should only appear in the bound parameters array.
      for (const call of db._calls) {
        assert.ok(
          !call.sql.includes(maliciousInput),
          `SQL string contains raw user input: "${call.sql}"`
        );
        assert.ok(
          !call.sql.includes('DROP TABLE'),
          `SQL string contains injected DROP TABLE: "${call.sql}"`
        );
      }
    } finally {
      restore();
    }
  });

  it('binds user-supplied values as parameters, not in SQL template', async () => {
    const ip = randomIp();
    const restore = stubAllExternalFetchSuccess();
    try {
      const db = mockDB({
        'FROM user WHERE': { first: null },
        'INSERT INTO contact': { run: { success: true } },
        'SELECT id FROM contact': { first: { id: 'contact-1' } },
        'INSERT OR REPLACE INTO contact_tag': { run: { success: true } },
        'INSERT INTO user': { run: { success: true } },
        'INSERT INTO email_verification': { run: { success: true } },
        'INSERT INTO session': { run: { success: true } },
      });

      const testEmail = 'bindtest@example.com';
      const req = mockRequest('POST', {
        body: {
          firstName: 'Alice',
          lastName: 'Smith',
          email: testEmail,
          password: 'aaaa-bbbb-cccc-dddd',
          turnstileToken: 'tok',
        },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv({ DB: db });
      const wt = mockWaitUntil();

      await onRequestPost(makeContext(req, env, wt));

      // For calls that involve the email, verify it appears in bound params, not in SQL
      const emailCalls = db._calls.filter(c => c.bound && c.bound.some(b => b === testEmail));
      assert.ok(emailCalls.length > 0, 'Email should appear in at least one bound parameter set');

      for (const call of db._calls) {
        assert.ok(
          !call.sql.includes(testEmail),
          `Email found directly in SQL string, not as a parameter: "${call.sql}"`
        );
      }
    } finally {
      restore();
    }
  });
});

/**
 * RRMA-RT-2: signup answered a fresh address and an already-registered one
 * with the same status and almost the same body -- almost, because the
 * new-account arm alone carried `resendPath`. One key is a complete
 * enumeration oracle: 201 either way, no timing measurement needed.
 *
 * These tests compare the two answers as an ATTACKER reads them (status, key
 * set, bytes, and the number of Set-Cookie headers), not as the endpoint
 * intends them. Asserting the literal body of one arm would go green again
 * the day the other arm drifts.
 */
describe('POST /api/auth/signup -- a registered address is indistinguishable from a fresh one', () => {
  const BASE_ROWS = {
    'INSERT INTO contact': { run: { success: true } },
    'SELECT id FROM contact': { first: { id: 'contact-1' } },
    'INSERT OR REPLACE INTO contact_tag': { run: { success: true } },
    'INSERT INTO user': { run: { success: true } },
    'INSERT INTO email_verification': { run: { success: true } },
    'INSERT INTO session': { run: { success: true } },
  };

  const FAR_FUTURE = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  const freshDb = () => mockDB({ 'FROM user WHERE': { first: null }, ...BASE_ROWS });
  const registeredDb = () => mockDB({ 'FROM user WHERE': { first: { id: 'u_already_here' } }, ...BASE_ROWS });

  async function attempt(db, email) {
    const req = mockRequest('POST', {
      body: { firstName: 'Alice', lastName: 'Smith', email, password: 'aaaa-bbbb-cccc-dddd', turnstileToken: 'tok' },
      headers: { 'CF-Connecting-IP': randomIp() },
    });
    const res = await onRequestPost(makeContext(req, mockEnv({ DB: db }), mockWaitUntil()));
    const { status, body } = await parseResponse(res);
    return { status, body, setCookies: res.headers.getSetCookie(), db };
  }

  /** Both arms, run under one stubbed network so neither can differ by fixture. */
  async function bothArms() {
    const restore = stubAllExternalFetchSuccess();
    try {
      return {
        fresh: await attempt(freshDb(), 'nobody-has-this@example.com'),
        registered: await attempt(registeredDb(), 'already-here@example.com'),
      };
    } finally {
      restore();
    }
  }

  it('answers the same status', async () => {
    const { fresh, registered } = await bothArms();
    assert.equal(fresh.status, 201);
    assert.equal(registered.status, fresh.status, 'the status must not say which address exists');
  });

  it('answers the same KEY SET -- the shape RRMA-RT-2 was hiding in', async () => {
    const { fresh, registered } = await bothArms();
    assert.deepEqual(
      Object.keys(registered.body).sort(),
      Object.keys(fresh.body).sort(),
      'one surplus key on either arm is a complete enumeration oracle'
    );
    assert.ok(
      Object.keys(fresh.body).includes('resendPath'),
      'the assertion above is only worth running while resendPath is actually emitted'
    );
  });

  it('answers byte-identical bodies', async () => {
    const { fresh, registered } = await bothArms();
    assert.equal(JSON.stringify(registered.body), JSON.stringify(fresh.body));
  });

  it('emits the same Set-Cookie shape, so the header is not the oracle either', async () => {
    const { fresh, registered } = await bothArms();
    assert.equal(fresh.setCookies.length, 2, 'a real signup sets the session cookie and the auth hint');
    assert.equal(
      registered.setCookies.length,
      fresh.setCookies.length,
      'a missing Set-Cookie on the registered arm tells the attacker exactly what the body no longer does'
    );
    assert.deepEqual(
      registered.setCookies.map((c) => c.split('=')[0]).sort(),
      fresh.setCookies.map((c) => c.split('=')[0]).sort()
    );
  });

  /**
   * /arise fix #4 (766e35f5, 2026-05-25) added a guard here because minting a
   * decoy cookie over a REAL session logged a signed-in user out of their own
   * account on an accidental form re-submit. Closing RRMA-RT-2 must not undo
   * that, so both halves are pinned: a session that VALIDATES is re-issued
   * untouched, and a cookie-shaped string that validates as nothing gets the
   * decoy -- because skipping Set-Cookie for anyone merely holding a cookie
   * handed an attacker the same tell the body used to give them.
   */
  it('re-issues a signed-in user their own session rather than logging them out', async () => {
    const restore = stubAllExternalFetchSuccess();
    try {
      const db = mockDB({
        'FROM session s': { first: { id: 'stored-hash', user_id: 'u_signed_in', expires_at: FAR_FUTURE, blocked: 0, role: 'member' } },
        'FROM user WHERE': { first: { id: 'u_already_here' } },
        ...BASE_ROWS,
      });
      const req = mockRequest('POST', {
        body: { firstName: 'Alice', lastName: 'Smith', email: 'already-here@example.com', password: 'aaaa-bbbb-cccc-dddd', turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': randomIp(), Cookie: 'session=live-cookie' },
      });
      const res = await onRequestPost(makeContext(req, mockEnv({ DB: db }), mockWaitUntil()));
      const cookies = res.headers.getSetCookie();

      assert.equal((await parseResponse(res)).status, 201);
      assert.equal(cookies.length, 2, 'the shape still matches the new-account arm');
      assert.ok(
        cookies.some((c) => c.startsWith('session=live-cookie;')),
        'a live session must survive its owner re-submitting the signup form'
      );
    } finally {
      restore();
    }
  });

  it('gives a cookie that validates as nothing the decoy, not silence', async () => {
    const restore = stubAllExternalFetchSuccess();
    try {
      const db = mockDB({ 'FROM session s': { first: null }, 'FROM user WHERE': { first: { id: 'u_already_here' } }, ...BASE_ROWS });
      const req = mockRequest('POST', {
        body: { firstName: 'Alice', lastName: 'Smith', email: 'already-here@example.com', password: 'aaaa-bbbb-cccc-dddd', turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': randomIp(), Cookie: 'session=not-a-session' },
      });
      const res = await onRequestPost(makeContext(req, mockEnv({ DB: db }), mockWaitUntil()));
      const cookies = res.headers.getSetCookie();

      assert.equal(cookies.length, 2, 'no Set-Cookie here would be the oracle the body no longer is');
      assert.ok(
        !cookies.some((c) => c.includes('not-a-session')),
        'the attacker-supplied value is never echoed back as a session'
      );
    } finally {
      restore();
    }
  });

  it('never writes an account or a session for the registered address', async () => {
    const restore = stubAllExternalFetchSuccess();
    try {
      const { db } = await attempt(registeredDb(), 'already-here@example.com');
      const writes = db._calls.filter((c) => /^\s*INSERT INTO (user|session|email_verification)\b/i.test(c.sql));
      assert.equal(writes.length, 0, 'the decoy cookie is a decoy: nothing behind it is stored');
    } finally {
      restore();
    }
  });
});

describe('POST /api/auth/signup -- CORS headers', () => {
  it('includes CORS headers on 400 response', async () => {
    const ip = randomIp();
    const req = mockRequest('POST', {
      body: { firstName: '', lastName: '', email: '', password: '' },
      headers: { 'CF-Connecting-IP': ip },
    });
    const env = mockEnv();
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt));
    const { headers } = await parseResponse(res);
    assert.ok(headers['access-control-allow-origin'], 'Missing Access-Control-Allow-Origin header');
    assert.equal(headers['access-control-allow-origin'], 'https://rrmacademy.org');
  });
});
