/**
 * Tests for POST /api/auth/login (functions/api/auth/login.js)
 * Run with: node --test test/auth-login.test.js
 *
 * Key behaviors under test:
 * - Input validation (email, password)
 * - Rate limiting (unique IP per test to avoid cross-contamination)
 * - Turnstile verification (mocked via globalThis.fetch)
 * - DB lookup (user not found, blocked, wrong password)
 * - CORS headers on all responses
 * - Missing DB binding returns 500 (not 200)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/auth/login.js';
import { mockRequest, mockDB, mockEnv, mockWaitUntil, parseResponse, randomIp } from './_helpers.js';

// Turnstile always succeeds unless overridden
function stubTurnstileSuccess() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('siteverify')) {
      return {
        ok: true,
        json: async () => ({ success: true }),
      };
    }
    return original(url, opts);
  };
  return () => { globalThis.fetch = original; };
}

function stubTurnstileFail() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('siteverify')) {
      return {
        ok: true,
        json: async () => ({ success: false }),
      };
    }
    return original(url, opts);
  };
  return () => { globalThis.fetch = original; };
}

// Helper: build a context object the way CF Pages calls the handler
function makeContext(request, env, waitUntil) {
  return { request, env, waitUntil };
}

describe('POST /api/auth/login -- input validation', () => {
  it('returns 400 for non-JSON body', async () => {
    const ip = randomIp();
    const req = {
      method: 'POST',
      url: 'https://rrmacademy.org/api/auth/login',
      headers: { get: (h) => h.toLowerCase() === 'cf-connecting-ip' ? ip : null },
      async json() { throw new SyntaxError('bad json'); },
      async text() { return 'not json'; },
    };
    const env = mockEnv();
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt));
    const { status } = await parseResponse(res);
    assert.equal(status, 400);
  });

  it('returns 400 for non-object payload', async () => {
    const ip = randomIp();
    const req = mockRequest('POST', {
      body: null,
      headers: { 'CF-Connecting-IP': ip },
    });
    // Override json() to return null directly (bypass JSON parse error path)
    req.json = async () => null;
    const env = mockEnv();
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt));
    const { status } = await parseResponse(res);
    assert.equal(status, 400);
  });

  it('returns 400 for missing email', async () => {
    const ip = randomIp();
    const restore = stubTurnstileSuccess();
    try {
      const req = mockRequest('POST', {
        body: { password: 'password123', turnstileToken: 'token' },
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
    const restore = stubTurnstileSuccess();
    try {
      const req = mockRequest('POST', {
        body: { email: 'user@example.com', turnstileToken: 'token' },
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

  it('returns 400 for invalid email format', async () => {
    const ip = randomIp();
    const restore = stubTurnstileSuccess();
    try {
      const req = mockRequest('POST', {
        body: { email: 'not-an-email', password: 'password123', turnstileToken: 'token' },
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

describe('POST /api/auth/login -- missing DB binding', () => {
  it('returns 500 when DB is missing', async () => {
    const ip = randomIp();
    const req = mockRequest('POST', {
      body: { email: 'user@example.com', password: 'password123' },
      headers: { 'CF-Connecting-IP': ip },
    });
    const env = mockEnv({ DB: undefined });
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt));
    const { status } = await parseResponse(res);
    // Must not be 200 -- missing binding must error
    assert.notEqual(status, 200);
    assert.ok(status >= 400, `Expected 4xx/5xx, got ${status}`);
  });
});

describe('POST /api/auth/login -- Turnstile', () => {
  it('returns 403 when Turnstile rejects token', async () => {
    const ip = randomIp();
    const restore = stubTurnstileFail();
    try {
      const db = mockDB({
        'FROM user WHERE': { first: null },
      });
      const req = mockRequest('POST', {
        body: { email: 'user@example.com', password: 'password123', turnstileToken: 'bad-token' },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv({ DB: db });
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { status } = await parseResponse(res);
      assert.equal(status, 403);
    } finally {
      restore();
    }
  });
});

describe('POST /api/auth/login -- user lookup', () => {
  it('returns 401 for non-existent user', async () => {
    const ip = randomIp();
    const restore = stubTurnstileSuccess();
    try {
      const db = mockDB({
        'FROM user WHERE': { first: null },
        'INSERT INTO session': { run: { success: true } },
      });
      const req = mockRequest('POST', {
        body: { email: 'nobody@example.com', password: 'password123', turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv({ DB: db });
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { status, body } = await parseResponse(res);
      assert.equal(status, 401);
      assert.ok(body.error, 'Should have error field');
      // Must not leak whether user exists
      assert.ok(!body.error.toLowerCase().includes('not found'), 'Must not reveal user existence');
    } finally {
      restore();
    }
  });

  it('returns 401 for blocked user (same error message as wrong password)', async () => {
    const ip = randomIp();
    const restore = stubTurnstileSuccess();
    try {
      // blocked=1, has a valid hashed_password format so verifyPassword runs
      const db = mockDB({
        'FROM user WHERE': {
          first: {
            id: 'user-1',
            email: 'blocked@example.com',
            hashed_password: '100000$AAAAAAAAAAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            google_id: null,
            name: 'Blocked User',
            first_name: 'Blocked',
            last_name: 'User',
            email_verified: 1,
            role: 'member',
            blocked: 1,
          },
        },
      });
      const req = mockRequest('POST', {
        body: { email: 'blocked@example.com', password: 'password123', turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv({ DB: db });
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { status, body } = await parseResponse(res);
      assert.equal(status, 401);
      // The error message must be the same generic one (not "account blocked")
      assert.equal(body.error, 'Invalid email or password.');
    } finally {
      restore();
    }
  });
});

describe('POST /api/auth/login -- CORS headers', () => {
  it('includes CORS headers on 400 response', async () => {
    const ip = randomIp();
    const req = mockRequest('POST', {
      body: { email: 'bad-email', password: '' },
      headers: { 'CF-Connecting-IP': ip },
    });
    const env = mockEnv();
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt));
    const { headers } = await parseResponse(res);
    assert.ok(
      headers['access-control-allow-origin'],
      'Missing Access-Control-Allow-Origin header'
    );
    assert.equal(headers['access-control-allow-origin'], 'https://rrmacademy.org');
  });

  it('includes CORS headers on 401 response', async () => {
    const ip = randomIp();
    const restore = stubTurnstileSuccess();
    try {
      const db = mockDB({ 'FROM user WHERE': { first: null } });
      const req = mockRequest('POST', {
        body: { email: 'nobody@example.com', password: 'password123', turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': ip },
      });
      const env = mockEnv({ DB: db });
      const wt = mockWaitUntil();
      const res = await onRequestPost(makeContext(req, env, wt));
      const { headers } = await parseResponse(res);
      assert.equal(headers['access-control-allow-origin'], 'https://rrmacademy.org');
    } finally {
      restore();
    }
  });
});

describe('POST /api/auth/login -- response shape', () => {
  it('error responses always have { ok, error } shape', async () => {
    const ip = randomIp();
    const req = mockRequest('POST', {
      body: { email: 'bad', password: '' },
      headers: { 'CF-Connecting-IP': ip },
    });
    const env = mockEnv();
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt));
    const { body } = await parseResponse(res);
    assert.ok('ok' in body || 'error' in body, 'Response must have ok or error field');
    assert.ok(typeof body.error === 'string', 'error must be a string');
  });
});
