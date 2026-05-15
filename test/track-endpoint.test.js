/**
 * Integration tests for POST /api/track (functions/api/track.js)
 * Run with: node --test test/track-endpoint.test.js
 *
 * Stubs sendGA4Event and env.ANALYTICS.writeDataPoint to assert side effects
 * without making real network calls. Validates the endpoint's validation logic,
 * rate limiting, PII stripping, reserved key dropping, and service guard.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, onRequestOptions } from '../functions/api/track.js';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, randomIp } from './_helpers.js';

// --- GA4 stub ---
// track.js imports sendGA4Event from ./_ga4.js. We stub globalThis.fetch so
// sendGA4Event's internal fetch() call is intercepted. Each test gets its own
// counter via makeFetchStub() so there's no cross-test contamination.

function makeFetchStub() {
  const state = { callCount: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('google-analytics.com')) {
      state.callCount++;
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    if (original) return original(url);
    return new Response('', { status: 200 });
  };
  const restore = () => { globalThis.fetch = original; };
  return { state, restore };
}

// --- Analytics Engine stub ---
function makeAnalyticsStub() {
  const calls = [];
  return {
    stub: {
      writeDataPoint(point) { calls.push(point); },
    },
    calls,
  };
}

// --- Context factory ---
function makeContext({ body, ipOverride, envOverrides = {} } = {}) {
  const ip = ipOverride || randomIp();
  const ae = makeAnalyticsStub();
  const env = mockEnv({
    GA4_MEASUREMENT_ID: 'G-TEST123',
    GA4_API_SECRET: 'test-secret',
    ANALYTICS: ae.stub,
    ...envOverrides,
  });
  const waitUntil = mockWaitUntil();
  const request = mockRequest('POST', {
    body,
    headers: { 'CF-Connecting-IP': ip },
    url: 'https://rrmacademy.org/api/track',
  });
  return { request, env, waitUntil, data: {}, ae };
}

describe('POST /api/track -- happy path', () => {
  it('returns 204 for valid cta_click event', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: 'cta_click', params: { id: 'donate-hero', page: '/' } } });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204, 'expected 204 No Content');
      // Drain waitUntil promises before restoring fetch so there's no cross-test leak
      await Promise.all(ctx.waitUntil.promises);
    } finally { restore(); }
  });

  it('calls sendGA4Event once via waitUntil on valid event', async () => {
    const { state, restore } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: 'cta_click', params: { id: 'donate-hero', page: '/' } } });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      assert.equal(ctx.waitUntil.promises.length, 1, 'sendGA4Event must be queued via waitUntil');
      // Await the GA4 promise to flush the fetch stub
      await ctx.waitUntil.promises[0];
      assert.equal(state.callCount, 1, 'GA4 fetch must be called exactly once');
    } finally { restore(); }
  });

  it('calls writeDataPoint once (synchronous) on valid event', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: 'scroll_depth', params: { depth: 75, page: '/library/some-article/' } } });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      assert.equal(ctx.ae.calls.length, 1, 'Analytics Engine writeDataPoint must be called once');
      const dp = ctx.ae.calls[0];
      assert.ok(Array.isArray(dp.blobs), 'writeDataPoint must have blobs array');
      assert.equal(dp.blobs[0], 'track', 'first blob must be "track" dataset marker');
      assert.equal(dp.blobs[1], 'scroll_depth', 'second blob must be the event name');
      assert.ok(Array.isArray(dp.indexes), 'writeDataPoint must have indexes array');
      assert.equal(dp.indexes[0], 'scroll_depth', 'index must be the event name');
    } finally { restore(); }
  });
});

describe('POST /api/track -- validation failures', () => {
  it('returns 400 for unknown event name', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: 'fake_event', params: { page: '/' } } });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.error, 'invalid_request');
      assert.equal(ctx.waitUntil.promises.length, 0, 'no GA4 call on invalid event');
      assert.equal(ctx.ae.calls.length, 0, 'no AE call on invalid event');
    } finally { restore(); }
  });

  it('returns 400 for server-only event (purchase) -- AG3 invariant', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: 'purchase', params: { value: 10 } } });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 400, 'server-only events must be rejected by client endpoint');
      assert.equal(parsed.body.error, 'invalid_request');
      assert.equal(ctx.waitUntil.promises.length, 0, 'no GA4 call for server-only event');
    } finally { restore(); }
  });

  it('returns 400 for server-only event (sign_up)', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: 'sign_up', params: { method: 'email' } } });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 400);
    } finally { restore(); }
  });

  it('returns 400 for server-only event (page_view)', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: 'page_view', params: { page: '/' } } });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 400);
    } finally { restore(); }
  });

  it('returns 400 for missing required param (cta_click without page)', async () => {
    const { restore } = makeFetchStub();
    try {
      // cta_click requires: id, page
      const ctx = makeContext({ body: { event: 'cta_click', params: { id: 'donate-hero' } } });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.error, 'invalid_request');
      assert.match(parsed.body.detail, /missing required param.*page/i);
    } finally { restore(); }
  });

  it('returns 400 for too many keys (26 keys)', async () => {
    const { restore } = makeFetchStub();
    try {
      const params = {};
      for (let i = 0; i < 26; i++) params[`key${i}`] = 'val';
      const ctx = makeContext({ body: { event: 'cta_click', params } });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 400);
      assert.match(parsed.body.detail, /1-25 keys/);
    } finally { restore(); }
  });

  it('returns 400 for non-primitive param value (object)', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: 'cta_click', params: { id: { nested: true }, page: '/' } } });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.error, 'invalid_request');
    } finally { restore(); }
  });

  it('returns 400 for non-primitive param value (array)', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: 'cta_click', params: { id: ['a', 'b'], page: '/' } } });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 400);
    } finally { restore(); }
  });

  it('returns 400 for event name with invalid format (uppercase)', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: 'CtaClick', params: { id: 'x', page: '/' } } });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 400);
    } finally { restore(); }
  });

  it('returns 400 for event name starting with digit', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: '1cta_click', params: { id: 'x', page: '/' } } });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 400);
    } finally { restore(); }
  });
});

describe('POST /api/track -- rate limiting', () => {
  it('returns 429 when rate limit exceeded (no COMMUNITY_KV = fail-closed)', async () => {
    const { restore } = makeFetchStub();
    try {
      // checkRateLimit fails-closed when COMMUNITY_KV is missing -- returns false → 429
      const ctx = makeContext({
        body: { event: 'cta_click', params: { id: 'x', page: '/' } },
        envOverrides: { COMMUNITY_KV: undefined },
      });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 429);
      assert.equal(parsed.body.error, 'rate_limited');
      assert.equal(ctx.waitUntil.promises.length, 0, 'no GA4 call on rate limit');
      assert.equal(ctx.ae.calls.length, 0, 'no AE call on rate limit');
    } finally { restore(); }
  });
});

describe('POST /api/track -- service guard', () => {
  it('returns 503 with { error: service_unavailable } when GA4_MEASUREMENT_ID missing', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: { event: 'cta_click', params: { id: 'x', page: '/' } },
        envOverrides: { GA4_MEASUREMENT_ID: undefined },
      });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 503);
      assert.equal(parsed.body.error, 'service_unavailable');
    } finally { restore(); }
  });

  it('returns 503 when GA4_API_SECRET missing', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: { event: 'cta_click', params: { id: 'x', page: '/' } },
        envOverrides: { GA4_API_SECRET: undefined },
      });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 503);
      assert.equal(parsed.body.error, 'service_unavailable');
    } finally { restore(); }
  });

  it('returns 503 when ANALYTICS binding missing', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: { event: 'cta_click', params: { id: 'x', page: '/' } },
        envOverrides: { ANALYTICS: undefined },
      });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 503);
      assert.equal(parsed.body.error, 'service_unavailable');
    } finally { restore(); }
  });
});

describe('POST /api/track -- PII and reserved param stripping', () => {
  it('strips PII keys silently and returns 204', async () => {
    const { restore } = makeFetchStub();
    try {
      // email matches PII_REGEX -- should be stripped, not rejected
      // cta_click requires id + page; after PII strip id='donate' and page='/' survive
      const ctx = makeContext({
        body: {
          event: 'cta_click',
          params: { id: 'donate', page: '/', email: 'foo@bar.com' },
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204, 'PII keys should be stripped silently, not cause rejection');
      assert.equal(ctx.waitUntil.promises.length, 1, 'GA4 must still be called after PII strip');
      assert.equal(ctx.ae.calls.length, 1, 'AE must still be called after PII strip');
    } finally { restore(); }
  });

  it('strips username (matches PII_REGEX "user") silently', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: {
          event: 'cta_click',
          params: { id: 'hero', page: '/', username: 'alice' },
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
    } finally { restore(); }
  });

  it('drops reserved keys (page_location, engagement_time_msec) silently and returns 204', async () => {
    const { restore } = makeFetchStub();
    try {
      // cta_click required: id, page
      // page_location and engagement_time_msec are reserved -- dropped before forwarding
      const ctx = makeContext({
        body: {
          event: 'cta_click',
          params: { id: 'hero', page: '/', page_location: 'https://rrmacademy.org/', engagement_time_msec: 100 },
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204, 'reserved keys should be dropped silently');
      assert.equal(ctx.ae.calls.length, 1);
    } finally { restore(); }
  });

  it('does not reject when params become empty after PII strip if required params survive', async () => {
    const { restore } = makeFetchStub();
    try {
      // All required params (id, page) are non-PII. Extra PII key stripped. Should be 204.
      const ctx = makeContext({
        body: {
          event: 'cta_click',
          params: { id: 'hero', page: '/', password: 'secret123' },
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
    } finally { restore(); }
  });
});

describe('OPTIONS /api/track -- CORS preflight', () => {
  it('returns 204 with CORS headers', () => {
    const res = onRequestOptions();
    assert.equal(res.status, 204);
    assert.ok(
      res.headers.get('access-control-allow-origin') || res.headers.get('Access-Control-Allow-Origin'),
      'OPTIONS must include CORS origin header'
    );
  });
});
