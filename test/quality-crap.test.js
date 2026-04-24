/**
 * Tests for scripts/quality/lib/crap-calc.mjs
 * Run with: node --test test/quality-crap.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crap, bandFor } from '../scripts/quality/lib/crap-calc.mjs';

test('crap: fully covered simple function returns CC', () => {
  // CC=1, cov=1.0 → 1² × 0³ + 1 = 1
  assert.equal(crap(1, 1.0), 1);
});

test('crap: uncovered simple function returns CC² + CC', () => {
  // CC=1, cov=0.0 → 1² × 1³ + 1 = 2
  assert.equal(crap(1, 0.0), 2);
});

test('crap: uncovered complex function is red-band', () => {
  // CC=10, cov=0.0 → 100 × 1 + 10 = 110
  assert.equal(crap(10, 0.0), 110);
});

test('crap: half-covered complex function', () => {
  // CC=10, cov=0.5 → 100 × 0.125 + 10 = 22.5
  assert.equal(crap(10, 0.5), 22.5);
});

test('crap: fully covered complex function returns CC', () => {
  // CC=20, cov=1.0 → 400 × 0 + 20 = 20
  assert.equal(crap(20, 1.0), 20);
});

test('crap: throws on negative complexity', () => {
  assert.throws(() => crap(-1, 0.5), /complexity must be >= 1/);
});

test('crap: throws on coverage out of [0,1]', () => {
  assert.throws(() => crap(5, 1.5), /coverage must be in \[0, 1\]/);
  assert.throws(() => crap(5, -0.1), /coverage must be in \[0, 1\]/);
});

test('bandFor: <=5 is healthy', () => {
  assert.equal(bandFor(1), 'healthy');
  assert.equal(bandFor(5), 'healthy');
});

test('bandFor: 5–30 is acceptable', () => {
  assert.equal(bandFor(5.1), 'acceptable');
  assert.equal(bandFor(30), 'acceptable');
});

test('bandFor: >30 is danger', () => {
  assert.equal(bandFor(30.1), 'danger');
  assert.equal(bandFor(110), 'danger');
});
