import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeThermo, fmtDollars } from '../../src/scripts/fund-thermo.ts';

// fmtDollars
test('fmtDollars(250000) === "$2,500"', () => {
  assert.equal(fmtDollars(250000), '$2,500');
});

test('fmtDollars(0) === "$0"', () => {
  assert.equal(fmtDollars(0), '$0');
});

// computeThermo happy path
test('computeThermo happy path', () => {
  const result = computeThermo({ raised_cents: 250000, goal_cents: 1000000, supporters: 12 }, 1000000);
  assert.deepEqual(result, {
    raisedText: '$2,500',
    pct: 25,
    raisedCents: 250000,
    met: false,
    supportersText: '12 supporters so far',
  });
});

// over-goal clamps pct to 100 and sets met=true
test('computeThermo over-goal: pct === 100 and met === true', () => {
  const result = computeThermo({ raised_cents: 1200000, goal_cents: 1000000, supporters: 80 }, 1000000);
  assert.ok(result !== null);
  assert.equal(result!.pct, 100);
  assert.equal(result!.met, true);
});

// singular supporter
test('computeThermo: one supporter produces singular text', () => {
  const result = computeThermo({ raised_cents: 250000, goal_cents: 1000000, supporters: 1 }, 1000000);
  assert.ok(result !== null);
  assert.equal(result!.supportersText, '1 supporter so far');
});

// zero supporters
test('computeThermo: supporters=0 => supportersText === null', () => {
  const result = computeThermo({ raised_cents: 250000, goal_cents: 1000000, supporters: 0 }, 1000000);
  assert.ok(result !== null);
  assert.equal(result!.supportersText, null);
});

// absent supporters field
test('computeThermo: absent supporters => supportersText === null', () => {
  const result = computeThermo({ raised_cents: 250000, goal_cents: 1000000 }, 1000000);
  assert.ok(result !== null);
  assert.equal(result!.supportersText, null);
});

// missing raised_cents
test('computeThermo: missing raised_cents => null', () => {
  const result = computeThermo({ goal_cents: 1000000 }, 1000000);
  assert.equal(result, null);
});

// garbage payloads
test('computeThermo: null payload => null', () => {
  assert.equal(computeThermo(null, 1000000), null);
});

test('computeThermo: string payload => null', () => {
  assert.equal(computeThermo('x', 1000000), null);
});

// data goal 0 with positive fallback: uses fallback
test('computeThermo: data goal_cents=0 with positive fallback uses fallback', () => {
  const result = computeThermo({ raised_cents: 5000, goal_cents: 0 }, 1000000);
  assert.ok(result !== null, 'should not be null');
  assert.equal(result!.pct, Math.min(100, Math.round((5000 / 1000000) * 100)));
});

// data goal 0 AND fallback 0: returns null
test('computeThermo: data goal_cents=0 AND fallback=0 => null', () => {
  assert.equal(computeThermo({ raised_cents: 5000, goal_cents: 0 }, 0), null);
});

// negative raised clamps to 0
test('computeThermo: negative raised_cents clamps to 0', () => {
  const result = computeThermo({ raised_cents: -100, goal_cents: 1000000 }, 1000000);
  assert.ok(result !== null);
  assert.equal(result!.raisedCents, 0);
});
