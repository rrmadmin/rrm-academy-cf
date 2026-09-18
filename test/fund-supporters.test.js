/**
 * Tests for functions/api/fund-supporters.js -- the partial-recompute guard.
 *
 * countCampaignGifts falls all the way through to its own internal fallback
 * failure when Stripe is unreachable (no route stubbed for api.stripe.com),
 * returning { count: 0, complete: false, scannedPages: 0 }. That is the same
 * "truncated scan" shape a real MAX_FALLBACK_PAGES cutoff produces, so it is
 * the cheapest way to exercise the partial path without 50 fake pages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockDB, mockWaitUntil, stubExternalFetch, drainWaitUntil, randomIp } from './_helpers.js';

const { onRequestGet } = await import('../functions/api/fund-supporters.js');

function ctx({ env: envOverrides = {} } = {}) {
  const env = mockEnv({ DB: mockDB(), ...envOverrides });
  const waitUntil = mockWaitUntil();
  const request = mockRequest('GET', {
    url: 'https://rrmacademy.org/api/fund-supporters',
    headers: { 'CF-Connecting-IP': randomIp() },
  });
  return { env, waitUntil, request };
}

test('a partial Stripe recompute does not write to KV and logs a warn row', async () => {
  const net = stubExternalFetch(); // no stripe route -> every Stripe call fails
  const events = [];
  const c = ctx({ env: { EVENTS: { writeDataPoint: (row) => events.push(row) } } });

  const res = await onRequestGet(c);
  await drainWaitUntil(c.waitUntil);
  net.restore();

  const body = await res.json();
  assert.equal(body.total_gifts_partial, true);
  assert.equal(body.founding_left, null);
  assert.equal(body.founding_closed, null);

  const cached = await c.env.COMMUNITY_KV.get('fund-supporters:provider-directory');
  assert.equal(cached, null, 'a partial recompute must never be cached');

  const warnRow = events.find((r) => r.blobs[2] === 'fund_supporters_count_partial');
  assert.ok(warnRow, 'a warn row must be logged for the partial recompute');
  assert.equal(warnRow.blobs[0], 'rrm-academy');
  assert.equal(warnRow.blobs[3], 'warn');
  assert.match(warnRow.blobs[4], /scannedPages=/);
});

test('a complete Stripe recompute is cached', async () => {
  const net = stubExternalFetch({
    stripe: (call) => {
      const path = new URL(call.url).pathname;
      if (path.includes('/v1/payment_intents/search')) {
        return new Response(JSON.stringify({ data: [], has_more: false }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'request-id': 'req_stub' },
        });
      }
      return new Response(JSON.stringify({ error: { message: 'not stubbed' } }), { status: 404 });
    },
  });
  const events = [];
  const c = ctx({ env: { EVENTS: { writeDataPoint: (row) => events.push(row) } } });

  const res = await onRequestGet(c);
  await drainWaitUntil(c.waitUntil);
  net.restore();

  const body = await res.json();
  assert.equal(body.total_gifts_partial, false);

  const cached = await c.env.COMMUNITY_KV.get('fund-supporters:provider-directory');
  assert.ok(cached, 'a complete recompute must be cached');
  assert.equal(JSON.parse(cached).total_gifts, 0);

  assert.ok(!events.some((r) => r.blobs[2] === 'fund_supporters_count_partial'));
});

test('a thrown error inside the handler logs an error row and still returns 200 EMPTY', async () => {
  const events = [];
  const throwingDB = mockDB({ 'FROM supporter_recognition': { throws: 'D1 unavailable' } });
  const c = ctx({ env: { DB: throwingDB, EVENTS: { writeDataPoint: (row) => events.push(row) } } });

  const res = await onRequestGet(c);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.total_gifts, 0);

  const errRow = events.find((r) => r.blobs[2] === 'fund_supporters_error');
  assert.ok(errRow, 'an error row must be logged on a thrown handler failure');
  assert.equal(errRow.blobs[3], 'error');
  assert.match(errRow.blobs[4], /D1 unavailable/);
});
