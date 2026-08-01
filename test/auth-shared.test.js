/**
 * Tests for auth utility functions.
 * Run with: node --test test/auth-shared.test.js
 *
 * Tests utility functions from functions/api/auth/_shared.js.
 * These use Web Crypto APIs available in Node 18+.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, verifyPassword, hashToken, PBKDF2_ITERATIONS,
  generateId, generateSessionId, generateToken,
  isValidEmail, isValidPassword, isSafeRedirect, checkRateLimit,
} from '../functions/api/auth/_shared.js';
import { randomIp } from './_helpers.js';

describe('hashPassword + verifyPassword', () => {
  it('roundtrips correctly', async () => {
    const password = 'testPassword123!';
    const hashed = await hashPassword(password);
    assert.ok(await verifyPassword(password, hashed));
  });

  it('rejects wrong password', async () => {
    const hashed = await hashPassword('correct-horse-battery-staple');
    assert.ok(!(await verifyPassword('wrong-password', hashed)));
  });

  it('produces different hashes for same password (random salt)', async () => {
    const h1 = await hashPassword('same-password');
    const h2 = await hashPassword('same-password');
    assert.notEqual(h1, h2);
  });

  it('stores iterations$salt$hash format', async () => {
    const hashed = await hashPassword('test');
    const parts = hashed.split('$');
    assert.equal(parts.length, 3, 'expected 3 parts separated by $');
    assert.equal(parts[0], String(PBKDF2_ITERATIONS), 'expected PBKDF2_ITERATIONS iterations');
    // Workers runtime hard-caps crypto.subtle PBKDF2 at 100K; Node (this test
    // env) allows more, so CI cannot catch an over-cap bump at runtime --
    // assert the ceiling here instead.
    assert.ok(PBKDF2_ITERATIONS <= 100000, 'PBKDF2_ITERATIONS exceeds the Workers runtime cap of 100000');
  });
});

describe('hashToken', () => {
  it('returns hex string', async () => {
    const hash = await hashToken('test-token');
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it('is deterministic', async () => {
    const h1 = await hashToken('same-token');
    const h2 = await hashToken('same-token');
    assert.equal(h1, h2);
  });

  it('differs for different inputs', async () => {
    const h1 = await hashToken('token-a');
    const h2 = await hashToken('token-b');
    assert.notEqual(h1, h2);
  });
});

describe('generateId / generateSessionId / generateToken', () => {
  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    assert.equal(ids.size, 100);
  });

  it('generateSessionId returns 50-char hex', () => {
    const id = generateSessionId();
    assert.match(id, /^[0-9a-f]{50}$/);
  });

  it('generateToken returns 64-char hex', () => {
    const token = generateToken();
    assert.match(token, /^[0-9a-f]{64}$/);
  });
});

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    assert.ok(isValidEmail('user@example.com'));
    assert.ok(isValidEmail('a@b.co'));
    assert.ok(isValidEmail('name+tag@domain.org'));
  });

  it('rejects invalid emails', () => {
    assert.ok(!isValidEmail(''));
    assert.ok(!isValidEmail('no-at-sign'));
    assert.ok(!isValidEmail('@no-local.com'));
    assert.ok(!isValidEmail('spaces in@email.com'));
    assert.ok(!isValidEmail(null));
    assert.ok(!isValidEmail(123));
  });

  it('rejects emails over 254 chars', () => {
    const long = 'a'.repeat(250) + '@b.co';
    assert.ok(!isValidEmail(long));
  });
});

describe('isValidPassword', () => {
  it('accepts valid passwords', () => {
    assert.ok(isValidPassword('aaaa-bbbb-cccc-dddd'));
    assert.ok(isValidPassword('a'.repeat(128)));
  });

  it('rejects common/breached passwords (AUTHCRYPTO-03)', () => {
    assert.ok(!isValidPassword('password123'));
    assert.ok(!isValidPassword('12345678'));
  });

  it('rejects too short', () => {
    assert.ok(!isValidPassword('1234567'));
  });

  it('rejects too long', () => {
    assert.ok(!isValidPassword('a'.repeat(129)));
  });

  it('rejects non-strings', () => {
    assert.ok(!isValidPassword(null));
    assert.ok(!isValidPassword(12345678));
  });
});

describe('isSafeRedirect', () => {
  it('accepts relative paths on same origin', () => {
    assert.ok(isSafeRedirect('/account'));
    assert.ok(isSafeRedirect('/courses/my-course'));
  });

  it('rejects external URLs', () => {
    assert.ok(!isSafeRedirect('https://evil.com/steal'));
    assert.ok(!isSafeRedirect('//evil.com'));
  });
});

// KV stub with put-error injection and write recording — mockKV() in _helpers
// has neither, and both are the point of these tests. randomIp() keeps each
// test on its own bucket key: checkRateLimit's write-coalescing cache is
// module-level and lives for the whole test process.
function makeRateLimitKv({ putError } = {}) {
  const store = new Map();
  const puts = [];
  return {
    puts,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      puts.push({ key, value });
      if (putError) throw putError;
      store.set(key, value);
    },
  };
}

function makeEventsStub() {
  const points = [];
  return { points, writeDataPoint(point) { points.push(point); } };
}

describe('checkRateLimit', () => {
  it('fails closed when the KV binding is missing', async () => {
    assert.equal(await checkRateLimit({}, `track:${randomIp()}`, 60, 60), false);
  });

  it('logs a KV write 429 as status "limited", not "error"', async () => {
    const EVENTS = makeEventsStub();
    const env = {
      COMMUNITY_KV: makeRateLimitKv({ putError: new Error('KV PUT failed: 429 Too Many Requests') }),
      EVENTS,
    };
    assert.equal(await checkRateLimit(env, `track:${randomIp()}`, 60, 60), false, 'still fails closed');
    assert.equal(EVENTS.points.length, 1);
    assert.equal(EVENTS.points[0].blobs[2], 'kv_write_limited');
    assert.equal(EVENTS.points[0].blobs[3], 'limited');
  });

  it('logs a genuine KV failure as status "error"', async () => {
    const EVENTS = makeEventsStub();
    const env = {
      COMMUNITY_KV: makeRateLimitKv({ putError: new Error('KV PUT failed: 500 internal error') }),
      EVENTS,
    };
    assert.equal(await checkRateLimit(env, `track:${randomIp()}`, 60, 60), false);
    assert.equal(EVENTS.points[0].blobs[2], 'kv_error');
    assert.equal(EVENTS.points[0].blobs[3], 'error');
  });

  it('coalesces a same-key burst into a single KV write', async () => {
    const kv = makeRateLimitKv();
    const env = { COMMUNITY_KV: kv, EVENTS: makeEventsStub() };
    const key = `track:${randomIp()}`;
    for (let i = 0; i < 20; i++) {
      assert.equal(await checkRateLimit(env, key, 60, 60), true, `request ${i} should be allowed`);
    }
    assert.equal(kv.puts.length, 1, 'burst collapses to one KV write');
  });

  it('still enforces max while writes are coalesced', async () => {
    const kv = makeRateLimitKv();
    const env = { COMMUNITY_KV: kv, EVENTS: makeEventsStub() };
    const key = `track:${randomIp()}`;
    assert.equal(await checkRateLimit(env, key, 3, 60), true);
    assert.equal(await checkRateLimit(env, key, 3, 60), true);
    assert.equal(await checkRateLimit(env, key, 3, 60), true);
    assert.equal(await checkRateLimit(env, key, 3, 60), false, '4th request exceeds max=3');
    assert.equal(kv.puts.length, 1);
  });

  it('writes again once the coalescing interval has elapsed', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const kv = makeRateLimitKv();
    const env = { COMMUNITY_KV: kv, EVENTS: makeEventsStub() };
    const key = `track:${randomIp()}`;
    assert.equal(await checkRateLimit(env, key, 60, 60), true);
    assert.equal(await checkRateLimit(env, key, 60, 60), true);
    assert.equal(kv.puts.length, 1);
    t.mock.timers.tick(2000);
    assert.equal(await checkRateLimit(env, key, 60, 60), true);
    assert.equal(kv.puts.length, 2);
    assert.equal(JSON.parse(kv.puts[1].value).count, 3, 'coalesced increments are carried forward');
  });

  it('resets a malformed KV bucket instead of counting NaN', async () => {
    const kv = makeRateLimitKv();
    const key = `track:${randomIp()}`;
    await kv.put(`rl:${key}`, '"not-a-bucket"');
    kv.puts.length = 0;
    const env = { COMMUNITY_KV: kv, EVENTS: makeEventsStub() };
    assert.equal(await checkRateLimit(env, key, 2, 60), true);
    assert.equal(JSON.parse(kv.puts[0].value).count, 1);
  });
});
