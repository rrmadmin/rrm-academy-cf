/**
 * functions/api/_greeting.js
 *
 * The no-name branch is the one that matters: 2,476 of 4,037 user rows carry no
 * name in any column, so this is ordinary copy for well over half the audience,
 * not a rare fallback.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { greetingLine, greetingName } from '../functions/api/_greeting.js';

describe('_greeting -- greetingLine', () => {
  it('greets by a first name', () => {
    assert.equal(greetingLine('Ada'), 'Hi Ada,');
  });

  it('uses the first token of a full name, so a caller can pass user.name or a Stripe name', () => {
    assert.equal(greetingLine('Ada Lovelace'), 'Hi Ada,');
    assert.equal(greetingLine('Laura Beth Moses'), 'Hi Laura,');
  });

  it('trims, and collapses padding rather than greeting a space', () => {
    assert.equal(greetingLine('  Ada  '), 'Hi Ada,');
    assert.equal(greetingLine('Ada   Lovelace'), 'Hi Ada,');
  });

  it('reads as ordinary copy when there is no name at all', () => {
    for (const empty of ['', '   ', null, undefined]) {
      assert.equal(greetingLine(empty), 'Hi there,', `failed for ${JSON.stringify(empty)}`);
    }
  });

  it('never emits a half-rendered greeting for a non-string', () => {
    assert.equal(greetingLine(0), 'Hi there,');
    assert.equal(greetingLine(false), 'Hi there,');
    for (const v of [null, undefined, '', 0, false, NaN]) {
      assert.ok(!/Hi ,|undefined|null|NaN/.test(greetingLine(v)), `leaked for ${String(v)}`);
    }
  });
});

describe('_greeting -- greetingName', () => {
  it('returns the bare first token', () => {
    assert.equal(greetingName('Ada Lovelace'), 'Ada');
  });

  it('returns empty string when there is no name, so callers can branch on it', () => {
    assert.equal(greetingName(''), '');
    assert.equal(greetingName(null), '');
    assert.equal(greetingName('   '), '');
  });
});
