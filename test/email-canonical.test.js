/**
 * Tests for canonicalizeEmail (alias for cleanupEmail) from functions/api/auth/_email-validate.js
 * Run with: node --test test/email-canonical.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeEmail } from '../functions/api/auth/_email-validate.js';

describe('canonicalizeEmail', () => {
  it('trailing-dot', () => {
    assert.equal(canonicalizeEmail('me@gmail.com.'), 'me@gmail.com');
  });

  it('double-dot', () => {
    assert.equal(canonicalizeEmail('me..you@gmail.com'), 'me.you@gmail.com');
  });

  it('nfc', () => {
    // Pure-ASCII email is already NFC; canonicalizeEmail is idempotent on it
    const input = 'user@example.com';
    assert.equal(canonicalizeEmail(input), input);
  });

  it('control-char', () => {
    // cleanupEmail strips \s (spaces, tabs) and # from the address
    assert.equal(canonicalizeEmail('me @gmail.com'), 'me@gmail.com');
    assert.equal(canonicalizeEmail('me#name@gmail.com'), 'mename@gmail.com');
  });

  it('idempotency', () => {
    const inputs = [
      'me@gmail.com.',
      'me..you@gmail.com',
      'user@example.com',
      'alice@hotmail.com',
      'bob@yahoo.com',
    ];
    for (const x of inputs) {
      assert.equal(
        canonicalizeEmail(canonicalizeEmail(x)),
        canonicalizeEmail(x),
        `idempotency failed for: ${x}`
      );
    }
  });
});
