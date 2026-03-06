/**
 * Tests for auth utility functions.
 * Run with: node --test test/auth-shared.test.js
 *
 * Tests pure functions from functions/api/auth/_shared.js.
 * These use Web Crypto APIs available in Node 18+.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, verifyPassword, hashToken,
  generateId, generateSessionId, generateToken,
  isValidEmail, isValidPassword, isSafeRedirect,
} from '../functions/api/auth/_shared.js';

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
    assert.equal(parts[0], '100000', 'expected 100000 iterations');
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
    assert.ok(isValidPassword('12345678'));
    assert.ok(isValidPassword('a'.repeat(128)));
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
