/**
 * Tests for scripts/quality/lib/crap-calc.mjs and the crap.mjs join function.
 * Run with: node --test test/quality-crap.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crap, bandFor } from '../scripts/quality/lib/crap-calc.mjs';
import { joinCrap } from '../scripts/quality/crap.mjs';

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

test('crap: throws on NaN coverage', () => {
  assert.throws(() => crap(5, NaN), /coverage must be in \[0, 1\]/);
});

test('crap: throws on NaN complexity', () => {
  assert.throws(() => crap(NaN, 0.5), /complexity must be >= 1/);
});

test('crap: throws on Infinity coverage', () => {
  assert.throws(() => crap(5, Infinity), /coverage must be in \[0, 1\]/);
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

test('joinCrap: fixture-based smoke test (3 functions across bands)', () => {
  // Synthetic c8-style coverage (already parsed by loadCoverage()).
  const coverageByFile = {
    '/repo/src/lib/foo.ts': [
      { name: 'healthyFn',    line: 10, coverage: 1.0 },
      { name: 'acceptableFn', line: 20, coverage: 0.5 },
    ],
    '/repo/src/lib/bar.mjs': [
      { name: 'dangerFn', line: 5, coverage: 0.0 },
    ],
  };
  // Synthetic ESLint complexity output (already parsed by loadComplexity()).
  const complexityByFile = {
    '/repo/src/lib/foo.ts': [
      { name: 'healthyFn',    line: 10, cc: 2 },
      { name: 'acceptableFn', line: 20, cc: 10 },
    ],
    '/repo/src/lib/bar.mjs': [
      { name: 'dangerFn', line: 5, cc: 25 },
    ],
  };

  const records = joinCrap(coverageByFile, complexityByFile, '/repo');
  assert.equal(records.length, 3);

  const byName = Object.fromEntries(records.map(r => [r.name, r]));

  // healthy band: CC=2, cov=1.0 → 4*0 + 2 = 2
  assert.equal(byName.healthyFn.crap, 2);
  assert.equal(byName.healthyFn.band, 'healthy');
  assert.equal(byName.healthyFn.file, 'src/lib/foo.ts');

  // acceptable band: CC=10, cov=0.5 → 100*0.125 + 10 = 22.5
  assert.equal(byName.acceptableFn.crap, 22.5);
  assert.equal(byName.acceptableFn.band, 'acceptable');

  // danger band: CC=25, cov=0.0 → 625*1 + 25 = 650
  assert.equal(byName.dangerFn.crap, 650);
  assert.equal(byName.dangerFn.band, 'danger');
  assert.equal(byName.dangerFn.file, 'src/lib/bar.mjs');
});

test('joinCrap: (file, name) match wins over line tolerance for adjacent fns', () => {
  // Two fns 1 line apart: line-±2 alone would mis-pair. Name-match must win.
  const coverageByFile = {
    '/repo/src/lib/x.ts': [
      { name: 'second', line: 11, coverage: 0.0 },
      { name: 'first',  line: 10, coverage: 1.0 },
    ],
  };
  const complexityByFile = {
    '/repo/src/lib/x.ts': [
      { name: 'first',  line: 10, cc: 1 },
      { name: 'second', line: 11, cc: 1 },
    ],
  };
  const records = joinCrap(coverageByFile, complexityByFile, '/repo');
  const first = records.find(r => r.name === 'first');
  const second = records.find(r => r.name === 'second');
  assert.equal(first.coverage, 1.0, 'first must pair with cov=1.0 by name');
  assert.equal(second.coverage, 0.0, 'second must pair with cov=0.0 by name');
});
