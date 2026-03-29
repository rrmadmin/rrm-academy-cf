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
        body: { lastName: 'Smith', email: 'alice@example.com', password: 'password123', turnstileToken: 'tok' },
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
        body: { firstName: 'Alice', email: 'alice@example.com', password: 'password123', turnstileToken: 'tok' },
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
        body: { firstName: 'Alice', lastName: 'Smith', password: 'password123', turnstileToken: 'tok' },
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
          password: 'password123',
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
          password: 'password123',
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
      body: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', password: 'password123' },
      headers: { 'CF-Connecting-IP': ip },
    });
    const env = mockEnv({ DB: undefined });
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt));
    const { status } = await parseResponse(res);
    assert.notEqual(status, 200, 'Missing DB must not return 200');
    assert.ok(status >= 400, `Expected 4xx/5xx, got ${status}`);
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
          password: 'password123',
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
          password: 'password123',
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
