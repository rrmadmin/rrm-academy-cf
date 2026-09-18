import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSupporters } from '../../src/scripts/fund-supporters.ts';

// Regression for a two-tracer /arise diff finding on PR 190: the server's
// total_gifts_partial flag (set when the Stripe fallback scan hit its page
// cap in functions/api/billing/_campaign-count.js) used to be dropped by
// sanitizeSupporters, which rebuilds the payload from a fixed field list. A
// truncated count then reached StatCards.astro and FoundingSupporters.astro
// as if it were the real total, and founding_left/founding_closed were
// computed from it -- a false "spots remaining" or, worse, a false
// "Complete" once the lower bound happened to hit 0.

test('total_gifts_partial survives sanitizeSupporters and forces founding_left/founding_closed to null', () => {
  const result = sanitizeSupporters({
    ok: true,
    total_gifts: 100,
    total_gifts_partial: true,
    consented_count: 40,
    recent: [],
    founding: [],
    founding_cap: 100,
    founding_left: 0,
    founding_closed: true,
    anonymous_founders: 5,
  });
  assert.equal(result.total_gifts_partial, true);
  assert.equal(result.founding_left, null, 'a partial total must never present as a real founding_left');
  assert.equal(result.founding_closed, null, 'a partial total must never present as a real founding_closed');
  assert.equal(result.total_gifts, 100, 'the (partial) count itself still passes through');
});

test('total_gifts_partial defaults to false and founding_left/founding_closed stay numeric/boolean', () => {
  const result = sanitizeSupporters({
    ok: true,
    total_gifts: 60,
    consented_count: 20,
    recent: [],
    founding: [],
    founding_cap: 100,
    founding_left: 40,
    founding_closed: false,
    anonymous_founders: 2,
  });
  assert.equal(result.total_gifts_partial, false);
  assert.equal(result.founding_left, 40);
  assert.equal(result.founding_closed, false);
});

test('a non-object payload falls back to EMPTY_SUPPORTERS with total_gifts_partial: false', () => {
  const result = sanitizeSupporters(null);
  assert.equal(result.total_gifts_partial, false);
  assert.equal(result.founding_left, 100);
  assert.equal(result.founding_closed, false);
});

test('a truthy total_gifts_partial forces null even if the server sent numeric founding fields anyway', () => {
  // Defense in depth: sanitizeSupporters must not trust a server response
  // that sets the partial flag but forgets to null the founding fields.
  const result = sanitizeSupporters({
    ok: true,
    total_gifts: 100,
    total_gifts_partial: true,
    founding_cap: 100,
    founding_left: 0,
    founding_closed: true,
  });
  assert.equal(result.founding_left, null);
  assert.equal(result.founding_closed, null);
});
