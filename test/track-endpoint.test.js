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
  const state = { callCount: 0, bodies: [] };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('google-analytics.com')) {
      state.callCount++;
      // Parsed Measurement Protocol payload, so tests can assert on what
      // actually egresses (attribution params, session_id, page_location).
      try { state.bodies.push(JSON.parse(init.body)); } catch { state.bodies.push(null); }
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
function makeContext({ body, ipOverride, envOverrides = {}, headers = {} } = {}) {
  const ip = ipOverride || randomIp();
  const ae = makeAnalyticsStub();
  const env = mockEnv({
    GA4_MEASUREMENT_ID: 'G-TEST123',
    GA4_API_SECRET: 'test-secret',
    EVENTS: ae.stub,
    ...envOverrides,
  });
  const waitUntil = mockWaitUntil();
  const request = mockRequest('POST', {
    body,
    headers: { 'CF-Connecting-IP': ip, ...headers },
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
      assert.match(parsed.body.detail, /at most 25 keys/);
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

  // EVENTS binding (Analytics Engine) is now OPTIONAL. If missing, the
  // endpoint still accepts events and relays them to GA4 -- AE is a
  // secondary mirror and silently no-ops via optional chaining.
  it('still returns 204 (degrades silently) when EVENTS binding missing', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: { event: 'cta_click', params: { id: 'x', page: '/' } },
        envOverrides: { EVENTS: undefined },
      });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 204, '/api/track must accept events when EVENTS missing (GA4 is primary)');
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

  it('strips a client-sent transaction_id before it reaches GA4', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: {
          event: 'cta_click',
          params: { id: 'donate', page: '/', transaction_id: 'pi_client_spoofed' },
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204, 'reserved keys should be dropped silently, not cause rejection');
      await Promise.all(ctx.waitUntil.promises);
      const sent = state.bodies[0]?.events?.[0]?.params || {};
      assert.equal('transaction_id' in sent, false, 'transaction_id is server-supplied only; a client value must be stripped');
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

  it('AE writeDataPoint blobs carry entry_category/device_type hints when they match the fixed enum, even though those keys are RESERVED_PARAMS and dropped before the GA4-bound sanitizedParams read', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: {
          event: 'cta_click',
          params: { id: 'hero', page: '/', entry_category: 'organic', device_type: 'mobile' },
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      assert.equal(ctx.ae.calls.length, 1);
      const dp = ctx.ae.calls[0];
      assert.equal(dp.blobs[2], 'organic', 'valid enum entry_category hint must reach the AE write despite being a reserved param');
      assert.equal(dp.blobs[3], 'mobile', 'valid enum device_type hint must reach the AE write despite being a reserved param');
    } finally { restore(); }
  });

  it('AE hint blobs become empty string for any value outside the fixed enum (arbitrary/PII-looking strings, spoofed values, absent)', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: {
          event: 'cta_click',
          params: { id: 'hero', page: '/', entry_category: 'brian@rrmacademy.org', device_type: 'iPhone 15 Pro Max' },
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      const dp = ctx.ae.calls[0];
      assert.equal(dp.blobs[2], '', 'entry_category hint outside the fixed enum (PII-looking value) must become empty string');
      assert.equal(dp.blobs[3], '', 'device_type hint outside the fixed enum (arbitrary client string) must become empty string');
    } finally { restore(); }
  });

  it('AE hint blobs are empty string when entry_category/device_type are absent from params', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: {
          event: 'cta_click',
          params: { id: 'hero', page: '/' },
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      const dp = ctx.ae.calls[0];
      assert.equal(dp.blobs[2], '', 'entry_category hint must be empty string when absent');
      assert.equal(dp.blobs[3], '', 'device_type hint must be empty string when absent');
    } finally { restore(); }
  });
});

describe('POST /api/track -- long-param clamping (GA4 MP limits)', () => {
  // page_location/page_referrer/page_title are clamped to GA4 Measurement
  // Protocol's own limits instead of the generic 100-char reject (bug: paid
  // Google Ads landing page_views 400'd since 2026-07-11 because
  // page_location carries utm_*/gclid and easily exceeds 100 chars).
  const CID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const SID = 1757100000;

  async function captureGa4Params(ctx, state) {
    await Promise.all(ctx.waitUntil.promises);
    const beacons = state.bodies.filter((b) => b && b.client_id === CID);
    assert.equal(beacons.length, 1, 'exactly one GA4 Measurement Protocol call for this beacon');
    return beacons[0];
  }

  it('accepts a page_view whose page_location carries utm_*/gclid and is ~150 chars (the reproduced bug)', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const adPageLocation = 'https://rrmacademy.org/endo-quiz/?utm_source=google&utm_medium=cpc' +
        '&utm_campaign=google_ads_endo_quiz&utm_content=818477153915&gclid=EAIaIQobChMI-test';
      assert.ok(adPageLocation.length > 100 && adPageLocation.length < 200, 'fixture must reproduce the ~150-char bug case');
      const ctx = makeContext({
        body: { event: 'page_view', params: { page_location: adPageLocation, page_referrer: '' }, cid: CID, sid: SID, sn: 1 },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204, 'a >100-char page_location must no longer be rejected');
      await captureGa4Params(ctx, state);
    } finally { restore(); }
  });

  it('accepts and truncates page_location to exactly 1000 chars when it exceeds the limit', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const base = 'https://rrmacademy.org/';
      const overLong = base + 'a'.repeat(1050 - base.length); // 1050 chars total, no query string
      assert.equal(overLong.length, 1050);
      const ctx = makeContext({
        body: { event: 'page_view', params: { page_location: overLong, page_referrer: '' }, cid: CID, sid: SID, sn: 1 },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204, 'an oversized page_location must be truncated, not rejected');
      const mp = await captureGa4Params(ctx, state);
      const p = mp.events[0].params;
      assert.equal(p.page_location.length, 1000, 'page_location forwarded to GA4 must be truncated to exactly 1000 chars');
      assert.equal(p.page_location, overLong.slice(0, 1000), 'truncation must be a plain 1000-char prefix');
    } finally { restore(); }
  });

  it('accepts and truncates page_referrer to exactly 420 chars when it exceeds the limit', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const base = 'https://google.com/';
      const overLong = base + 'a'.repeat(421 - base.length); // 421 chars total
      assert.equal(overLong.length, 421);
      const ctx = makeContext({
        body: {
          event: 'page_view',
          params: { page_location: 'https://rrmacademy.org/', page_referrer: overLong },
          cid: CID,
          sid: SID,
          sn: 1,
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204, 'an oversized page_referrer must be truncated, not rejected');
      const mp = await captureGa4Params(ctx, state);
      const p = mp.events[0].params;
      assert.equal(p.page_referrer.length, 420, 'page_referrer forwarded to GA4 must be truncated to exactly 420 chars');
      assert.equal(p.page_referrer, overLong.slice(0, 420), 'truncation must be a plain 420-char prefix');
    } finally { restore(); }
  });

  it('still returns 400 for a non-exempt param (surface) exceeding 100 chars', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: { event: 'search_submit', params: { query_length: 5, surface: 'x'.repeat(101) } },
      });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 400, 'a non-exempt param over 100 chars must still be rejected');
      assert.equal(parsed.body.error, 'invalid_request');
      assert.match(parsed.body.detail, /param "surface" string value exceeds 100 chars/);
    } finally { restore(); }
  });

  it('drops a page_referrer whose PII email straddles the 420-char truncation boundary, instead of leaking the local part', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const prefix = 'https://example.com/?r=' + 'a'.repeat(390);
      const emailReferrer = prefix + 'user@evil-tracker.com'; // full email present in the RAW value
      assert.ok(emailReferrer.length > 420, 'fixture must exceed the 420-char limit');
      assert.ok(emailReferrer.slice(0, 420).length === 420 && !/user@evil-tracker\.com/.test(emailReferrer.slice(0, 420)),
        'fixture must split the email across the naive truncation boundary');
      const ctx = makeContext({
        body: {
          event: 'page_view',
          params: { page_location: 'https://rrmacademy.org/', page_referrer: emailReferrer },
          cid: CID,
          sid: SID,
          sn: 1,
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      const mp = await captureGa4Params(ctx, state);
      const p = mp.events[0].params;
      assert.ok(!('page_referrer' in p), 'a PII-valued page_referrer must be dropped entirely, screened on the raw value');
    } finally { restore(); }
  });

  it('accepts a page_referrer carrying a 13-19 digit cache-buster/epoch query param and strips only that param', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const referrer = 'https://google.com/search?q=endometriosis&ts=1787344117289';
      const ctx = makeContext({
        body: {
          event: 'page_view',
          params: { page_location: 'https://rrmacademy.org/', page_referrer: referrer },
          cid: CID,
          sid: SID,
          sn: 1,
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204, 'a long digit-run in a URL query value must not 400 the page_view');
      const mp = await captureGa4Params(ctx, state);
      const p = mp.events[0].params;
      assert.ok(p.page_referrer, 'page_referrer must survive with the offending query param stripped, not dropped entirely');
      assert.ok(!p.page_referrer.includes('1787344117289'), 'the digit-run query value must be stripped');
      assert.ok(p.page_referrer.includes('q=endometriosis'), 'unrelated query params must be preserved');
    } finally { restore(); }
  });

  it('returns 400 for a non-string page_location', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: { event: 'page_view', params: { page_location: 123, page_referrer: '' } },
      });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 400, 'a non-string page_location must be rejected, not coerced');
      assert.equal(parsed.body.error, 'invalid_request');
      assert.match(parsed.body.detail, /param "page_location" must be a string/);
    } finally { restore(); }
  });

  it('truncates page_referrer without splitting a UTF-16 surrogate pair at the 420-char boundary', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const base = 'https://google.com/';
      const prefix = base + 'a'.repeat(419 - base.length); // 419 chars, boundary at index 419
      const overLong = prefix + '\u{1F600}' + 'a'.repeat(10); // surrogate pair spans indices 419-420
      assert.equal(overLong.charCodeAt(419), 0xD83D, 'fixture must place a high surrogate exactly at the 420-char cut boundary');
      const ctx = makeContext({
        body: {
          event: 'page_view',
          params: { page_location: 'https://rrmacademy.org/', page_referrer: overLong },
          cid: CID,
          sid: SID,
          sn: 1,
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      const mp = await captureGa4Params(ctx, state);
      const p = mp.events[0].params;
      const lastCode = p.page_referrer.charCodeAt(p.page_referrer.length - 1);
      assert.ok(lastCode < 0xD800 || lastCode > 0xDBFF, 'truncated page_referrer must not end on a lone high surrogate');
      assert.ok(p.page_referrer.length <= 420, 'truncated page_referrer must not exceed the 420-char limit');
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

describe('POST /api/track -- bot short-circuit', () => {
  it('missing User-Agent and no request.cf is processed normally, not treated as a bot', async () => {
    const { restore, state } = makeFetchStub();
    try {
      // makeContext's mockRequest never sets a User-Agent header and has no
      // `cf` property -- this must NOT short-circuit (fail-open on missing UA).
      const ctx = makeContext({ body: { event: 'cta_click', params: { id: 'donate-hero', page: '/' } } });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      assert.equal(ctx.waitUntil.promises.length, 1, 'GA4 must still be called with no UA/cf present');
      assert.equal(ctx.ae.calls.length, 1, 'AE must still be called with no UA/cf present');
    } finally { restore(); }
  });

  it('returns 204 with no GA4/AE call when request.cf.asn is a known datacenter ASN', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const ctx = makeContext({ body: { event: 'cta_click', params: { id: 'donate-hero', page: '/' } } });
      ctx.request.cf = { asn: 16509 }; // Amazon AWS
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204, 'bot short-circuit must still return the normal 204 success shape');
      assert.equal(ctx.waitUntil.promises.length, 0, 'no GA4 call for a datacenter-ASN request');
      assert.equal(ctx.ae.calls.length, 1, 'a cheap bot_skipped AE counter event is written, not the normal event');
      assert.equal(ctx.ae.calls[0].blobs[1], 'bot_skipped');
    } finally { restore(); }
  });
});

describe('POST /api/track -- beacon attribution forwarding', () => {
  // The client beacon sends cid/sid/sn at the top level, so sendGA4Event takes
  // its overrides branch. Attribution on that branch comes from the entry_ref/
  // entry_url cookies via buildSourceParams; the client's own utm_*/entry_*
  // params are RESERVED_PARAMS and never reach GA4.
  const CID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const SID = 1757000000;

  const AD_ENTRY_URL = 'https://rrmacademy.org/endo-quiz/?utm_source=google&utm_medium=cpc' +
    '&utm_campaign=google_ads_endometriosis_symptom_quiz_2026-q3' +
    '&utm_content=818477153915&gclid=EAIaIQobChMI-test';
  const AD_PAGE_LOCATION = 'https://rrmacademy.org/endo-quiz/?utm_source=google&utm_medium=cpc&gclid=x';

  function adCookie() {
    return 'entry_ref=; entry_url=' + encodeURIComponent(AD_ENTRY_URL);
  }

  // Earlier tests in this file leave un-awaited waitUntil promises whose GA4
  // fetches land on whichever stub is installed when they settle, so scope the
  // lookup to this beacon's own client_id rather than to the whole capture.
  async function captureGa4Params(ctx, state) {
    await Promise.all(ctx.waitUntil.promises);
    const beacons = state.bodies.filter((b) => b && b.client_id === CID);
    assert.equal(beacons.length, 1, 'exactly one GA4 Measurement Protocol call for this beacon');
    return beacons[0];
  }

  it('forwards the full paid attribution set from the entry_url cookie', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: {
          event: 'page_view',
          params: { page_location: AD_PAGE_LOCATION, page_referrer: '' },
          cid: CID,
          sid: SID,
          sn: 1,
        },
        headers: { Cookie: adCookie() },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      const mp = await captureGa4Params(ctx, state);
      const p = mp.events[0].params;
      assert.equal(mp.client_id, CID, 'client_id must be the client cid');
      assert.equal(p.session_id, SID, 'session_id must be the client sid, never the server-derived one');
      assert.equal(p.session_number, 1);
      assert.equal(p.entry_category, 'paid');
      assert.equal(p.entry_platform, 'google');
      assert.equal(p.utm_medium, 'cpc');
      assert.equal(p.utm_campaign, 'google_ads_endometriosis_symptom_quiz_2026-q3');
      assert.equal(p.utm_content, '818477153915');
      assert.equal(p.page_location, 'https://rrmacademy.org/endo-quiz/', 'page_location must egress with no query string');
    } finally { restore(); }
  });

  it('ignores client-supplied utm_campaign/entry_category in favor of the cookie-derived values', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: {
          event: 'page_view',
          params: {
            page_location: AD_PAGE_LOCATION,
            page_referrer: '',
            utm_campaign: 'client_spoof',
            entry_category: 'organic',
          },
          cid: CID,
          sid: SID,
          sn: 1,
        },
        headers: { Cookie: adCookie() },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      const mp = await captureGa4Params(ctx, state);
      const p = mp.events[0].params;
      assert.equal(p.utm_campaign, 'google_ads_endometriosis_symptom_quiz_2026-q3', 'client utm_campaign must be dropped');
      assert.equal(p.entry_category, 'paid', 'client entry_category must be dropped');
    } finally { restore(); }
  });

  it('forwards organic attribution with no utm keys when the entry URL carries none', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: {
          event: 'page_view',
          params: { page_location: 'https://rrmacademy.org/library/', page_referrer: 'https://www.google.com/' },
          cid: CID,
          sid: SID,
          sn: 1,
        },
        headers: {
          Cookie: 'entry_ref=' + encodeURIComponent('https://www.google.com/') +
            '; entry_url=' + encodeURIComponent('https://rrmacademy.org/library/'),
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      const mp = await captureGa4Params(ctx, state);
      const p = mp.events[0].params;
      assert.equal(p.entry_category, 'organic');
      assert.equal(p.entry_platform, 'google');
      assert.ok(!('utm_campaign' in p), 'utm_campaign must be absent when the entry URL has none');
      assert.ok(!('utm_content' in p), 'utm_content must be absent when the entry URL has none');
    } finally { restore(); }
  });

  it('sends no attribution keys and keeps the client session_id when no cookies are present', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: {
          event: 'page_view',
          params: { page_location: 'https://rrmacademy.org/', page_referrer: '' },
          cid: CID,
          sid: SID,
          sn: 1,
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      const mp = await captureGa4Params(ctx, state);
      const p = mp.events[0].params;
      assert.equal(p.session_id, SID);
      assert.ok(!('entry_category' in p), 'entry_category must be absent with no entry cookies');
      assert.ok(!('entry_platform' in p), 'entry_platform must be absent with no entry cookies');
      assert.ok(!('utm_campaign' in p), 'utm_campaign must be absent with no entry cookies');
    } finally { restore(); }
  });

  it('forwards email_type and list_source, which the beacon branch previously dropped', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const entryUrl = 'https://rrmacademy.org/?utm_source=email&utm_medium=newsletter&list_source=endo_survey_signup';
      const ctx = makeContext({
        body: {
          event: 'page_view',
          params: { page_location: 'https://rrmacademy.org/', page_referrer: '' },
          cid: CID,
          sid: SID,
          sn: 1,
        },
        headers: {
          Cookie: 'entry_url=' + encodeURIComponent(entryUrl) + '; list_source=endo_survey_signup',
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      const mp = await captureGa4Params(ctx, state);
      const p = mp.events[0].params;
      assert.equal(p.entry_category, 'email');
      assert.equal(p.email_type, 'broadcast');
      assert.equal(p.list_source, 'endo_survey_signup');
    } finally { restore(); }
  });

  it('accepts paid as an AE entry_category hint', async () => {
    const { restore } = makeFetchStub();
    try {
      const ctx = makeContext({
        body: {
          event: 'cta_click',
          params: { id: 'hero', page: '/', entry_category: 'paid' },
        },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      assert.equal(ctx.ae.calls.length, 1);
      assert.equal(ctx.ae.calls[0].blobs[2], 'paid', 'paid must be a valid AE entry_category hint');
      await Promise.all(ctx.waitUntil.promises);
    } finally { restore(); }
  });

  it('drops a PII-valued utm_term from the cookie-derived set and keeps the numeric ad id', async () => {
    const { restore, state } = makeFetchStub();
    const piiEntryUrl = 'https://rrmacademy.org/endo-quiz/?utm_source=google&utm_medium=cpc' +
      '&utm_campaign=google_ads_endometriosis_symptom_quiz_2026-q3' +
      '&utm_content=818477153915&utm_term=jane.doe%40example.com&gclid=EAIaIQobChMI-test';
    try {
      const ctx = makeContext({
        body: {
          event: 'page_view',
          params: { page_location: AD_PAGE_LOCATION, page_referrer: '' },
          cid: CID,
          sid: SID,
          sn: 1,
        },
        headers: { Cookie: 'entry_ref=; entry_url=' + encodeURIComponent(piiEntryUrl) },
      });
      const res = await onRequestPost(ctx);
      assert.equal(res.status, 204);
      const mp = await captureGa4Params(ctx, state);
      const p = mp.events[0].params;
      assert.ok(!('utm_term' in p), 'an email address in utm_term must never reach GA4');
      assert.equal(p.entry_category, 'paid');
      assert.equal(p.utm_campaign, 'google_ads_endometriosis_symptom_quiz_2026-q3');
      assert.equal(p.utm_content, '818477153915', 'a 12-digit ad id must survive the phone/card patterns');
    } finally { restore(); }
  });
});
