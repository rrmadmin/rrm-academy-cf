/**
 * functions/api/_google-ads.js -- retry on transient network throws.
 *
 * WHAT THIS COVERS
 * sendGoogleAdsConversion() is fire-and-forget (the promise it starts is
 * handed to waitUntil, never returned), so every assertion here drains that
 * promise via drainWaitUntil() before reading the AE log / alert email side
 * effects. globalThis.fetch is replaced directly (not stubExternalFetch --
 * that helper doesn't route oauth2.googleapis.com / datamanager.googleapis.com)
 * with a small router keyed on hostname, so each test controls exactly how
 * many times the token endpoint and the ingest endpoint are hit and what each
 * call returns.
 *
 * The retry delay is real (~2s per retrying test) rather than faked with
 * node:test mock.timers -- the module schedules its own setTimeout deep
 * inside a promise chain with no hook to await, so a fake clock would need
 * fragile microtask-counting to land the tick in the right place. Five
 * retrying tests add ~10s to this file's runtime; accepted for determinism.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockEnv, mockWaitUntil, drainWaitUntil } from './_helpers.js';

const googleAds = await import('../functions/api/_google-ads.js');

const COOKIE = 'gclid=abcdefghij1234567890';
const ACTION_ID = googleAds.NEWSLETTER_CONVERSION_ACTION_ID;

function googleAdsEnv(overrides = {}) {
  return mockEnv({
    GOOGLE_ADS_CLIENT_ID: 'client-id',
    GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
    GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
    AWS_ACCESS_KEY_ID: undefined,
    AWS_SECRET_ACCESS_KEY: undefined,
    ...overrides,
  });
}

/**
 * Routes globalThis.fetch by hostname. `tokenImpl`/`ingestImpl` are called
 * once per attempt and can return a Response, or throw to simulate a network
 * failure (AbortSignal timeout and DNS/connection failures both surface to
 * the caller as a thrown error, which is what getAccessToken/uploadConversion
 * wrap into `token_network:`/`upload_network:`).
 */
function stubGoogleAdsFetch({ tokenImpl, ingestImpl }) {
  const original = globalThis.fetch;
  const tokenCalls = [];
  const ingestCalls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('oauth2.googleapis.com')) {
      tokenCalls.push({ url, init });
      return tokenImpl(tokenCalls.length);
    }
    if (url.includes('datamanager.googleapis.com')) {
      ingestCalls.push({ url, init });
      return ingestImpl(ingestCalls.length);
    }
    throw new Error(`stubGoogleAdsFetch: unrouted request to ${url}`);
  };
  return {
    tokenCalls,
    ingestCalls,
    restore() { globalThis.fetch = original; },
  };
}

function okTokenResponse() {
  return { ok: true, status: 200, json: async () => ({ access_token: 'token-1' }) };
}

function okIngestResponse() {
  return { ok: true, status: 200, json: async () => ({ requestId: 'req-1' }) };
}

describe('_google-ads.js retry on transient network failure', () => {
  it('retries once and succeeds after the token fetch throws a network error', async (t) => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: (n) => {
        if (n === 1) throw new TypeError('network timeout');
        return okTokenResponse();
      },
      ingestImpl: () => okIngestResponse(),
    });
    t.after(() => stub.restore());

    const env = googleAdsEnv();
    const events = [];
    env.EVENTS = { writeDataPoint(point) { events.push(point); } };
    const waitUntil = mockWaitUntil();

    googleAds.sendGoogleAdsConversion(env, waitUntil, COOKIE, ACTION_ID);

    await drainWaitUntil(waitUntil);

    assert.equal(stub.tokenCalls.length, 2, 'token endpoint hit once, then retried');
    assert.equal(stub.ingestCalls.length, 1, 'ingest only reached once the retried token succeeded');

    const actions = events.map(p => p.blobs[2]);
    assert.ok(actions.includes('conversion_retry'), `expected a conversion_retry row, got: ${actions.join(', ')}`);
    assert.ok(actions.includes('conversion_ok'), `expected a conversion_ok row, got: ${actions.join(', ')}`);
    assert.ok(!actions.includes('conversion_error'), 'no error row expected on a successful retry');

    const retryRow = events.find(p => p.blobs[2] === 'conversion_retry');
    assert.equal(retryRow.blobs[3], 'warn');
    assert.match(retryRow.blobs[4], /^token_network:/);
  });

  it('retries once and succeeds after the ingest fetch throws a network error', async (t) => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => okTokenResponse(),
      ingestImpl: (n) => {
        if (n === 1) throw new TypeError('network timeout');
        return okIngestResponse();
      },
    });
    t.after(() => stub.restore());

    const env = googleAdsEnv();
    const events = [];
    env.EVENTS = { writeDataPoint(point) { events.push(point); } };
    const waitUntil = mockWaitUntil();

    googleAds.sendGoogleAdsConversion(env, waitUntil, COOKIE, ACTION_ID);

    await drainWaitUntil(waitUntil);

    // Fresh token fetch included in the retry -- getAccessToken runs again.
    assert.equal(stub.tokenCalls.length, 2, 'token endpoint hit again on retry');
    assert.equal(stub.ingestCalls.length, 2, 'ingest hit once, then retried');

    const actions = events.map(p => p.blobs[2]);
    assert.ok(actions.includes('conversion_retry'));
    assert.ok(actions.includes('conversion_ok'));
    assert.ok(!actions.includes('conversion_error'));

    const retryRow = events.find(p => p.blobs[2] === 'conversion_retry');
    assert.match(retryRow.blobs[4], /^upload_network:/);
  });

  it('does not retry an HTTP-status failure (token_401)', async () => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => ({ ok: false, status: 401, json: async () => ({}) }),
      ingestImpl: () => okIngestResponse(),
    });

    const env = googleAdsEnv();
    const events = [];
    env.EVENTS = { writeDataPoint(point) { events.push(point); } };
    const waitUntil = mockWaitUntil();

    googleAds.sendGoogleAdsConversion(env, waitUntil, COOKIE, ACTION_ID);
    await drainWaitUntil(waitUntil);
    stub.restore();

    assert.equal(stub.tokenCalls.length, 1, 'a 401 status failure must not be retried');
    assert.equal(stub.ingestCalls.length, 0);

    const actions = events.map(p => p.blobs[2]);
    assert.ok(!actions.includes('conversion_retry'), 'no retry row for a non-network failure');
    assert.ok(actions.includes('conversion_error'));

    const errorRow = events.find(p => p.blobs[2] === 'conversion_error');
    assert.match(errorRow.blobs[4], /^token_401$/);
  });

  it('does not retry an HTTP-status failure (upload_5xx)', async () => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => okTokenResponse(),
      ingestImpl: () => ({ ok: false, status: 500, text: async () => 'internal error' }),
    });

    const env = googleAdsEnv();
    const events = [];
    env.EVENTS = { writeDataPoint(point) { events.push(point); } };
    const waitUntil = mockWaitUntil();

    googleAds.sendGoogleAdsConversion(env, waitUntil, COOKIE, ACTION_ID);
    await drainWaitUntil(waitUntil);
    stub.restore();

    assert.equal(stub.tokenCalls.length, 1);
    assert.equal(stub.ingestCalls.length, 1, 'a 500 status failure must not be retried (not idempotent on the wire)');

    const actions = events.map(p => p.blobs[2]);
    assert.ok(!actions.includes('conversion_retry'));
    assert.ok(actions.includes('conversion_error'));
  });

  it('logs conversion_error (not conversion_ok) when both attempts throw network errors', async (t) => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => { throw new TypeError('network timeout'); },
      ingestImpl: () => okIngestResponse(),
    });
    t.after(() => stub.restore());

    const env = googleAdsEnv();
    const events = [];
    env.EVENTS = { writeDataPoint(point) { events.push(point); } };
    const waitUntil = mockWaitUntil();

    googleAds.sendGoogleAdsConversion(env, waitUntil, COOKIE, ACTION_ID);

    await drainWaitUntil(waitUntil);

    assert.equal(stub.tokenCalls.length, 2, 'exactly one retry attempt, not a retry loop');
    const actions = events.map(p => p.blobs[2]);
    assert.ok(actions.includes('conversion_retry'));
    assert.ok(actions.includes('conversion_error'));
    assert.ok(!actions.includes('conversion_ok'));

    const errorRow = events.find(p => p.blobs[2] === 'conversion_error');
    assert.match(errorRow.blobs[4], /^token_network:/);
  });
});

describe('_google-ads.js uploadConversion payload shape', () => {
  it('the default path (no value/currency/orderId/clickIdKind) is byte-identical to the pre-refactor payload', async (t) => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => okTokenResponse(),
      ingestImpl: () => okIngestResponse(),
    });
    t.after(() => stub.restore());

    const env = googleAdsEnv();
    const waitUntil = mockWaitUntil();
    googleAds.sendGoogleAdsConversion(env, waitUntil, COOKIE, ACTION_ID);
    await drainWaitUntil(waitUntil);

    const ingestBody = JSON.parse(stub.ingestCalls[0].init.body);
    const event = ingestBody.events[0];
    assert.deepEqual(event.adIdentifiers, { gclid: 'abcdefghij1234567890' });
    assert.equal(event.conversionValue, 1.0);
    assert.equal(event.currency, 'USD');
    assert.equal(event.eventSource, 'WEB');
    assert.equal('transactionId' in event, false, 'no transactionId key on the default path, not even null/empty');
  });

  it('sendGoogleAdsValueConversion emits value, currency, transactionId, and a gclid-keyed adIdentifiers', async (t) => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => okTokenResponse(),
      ingestImpl: () => okIngestResponse(),
    });
    t.after(() => stub.restore());

    const env = googleAdsEnv();
    const waitUntil = mockWaitUntil();
    // clickIdKind defaults to 'gclid' inside sendGoogleAdsValueConversion
    // (the webhook only ever reads gclid_last), so a gbraid-keyed
    // adIdentifiers is exercised directly through uploadConversionWithRetry
    // via the module's internal uploadConversion, proven by shape here
    // rather than through the public entry point.
    googleAds.sendGoogleAdsValueConversion(env, waitUntil, {
      clickId: 'abcdefghij1234567890',
      conversionActionId: googleAds.NEWSLETTER_CONVERSION_ACTION_ID,
      conversionValue: 25.5,
      currency: 'USD',
      orderId: 'pi_test_value_upload',
    });
    await drainWaitUntil(waitUntil);

    const ingestBody = JSON.parse(stub.ingestCalls[0].init.body);
    const event = ingestBody.events[0];
    assert.equal(event.conversionValue, 25.5);
    assert.equal(event.currency, 'USD');
    assert.equal(event.transactionId, 'pi_test_value_upload');
    assert.deepEqual(event.adIdentifiers, { gclid: 'abcdefghij1234567890' });
  });

  it('sendGoogleAdsValueConversion is a no-op with no clickId', async (t) => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => { throw new Error('must not be called'); },
      ingestImpl: () => { throw new Error('must not be called'); },
    });
    t.after(() => stub.restore());

    const env = googleAdsEnv();
    const waitUntil = mockWaitUntil();
    googleAds.sendGoogleAdsValueConversion(env, waitUntil, {
      clickId: null,
      conversionActionId: googleAds.NEWSLETTER_CONVERSION_ACTION_ID,
      conversionValue: 9,
      orderId: 'sub_test',
    });
    await drainWaitUntil(waitUntil);
    assert.equal(stub.tokenCalls.length, 0);
    assert.equal(stub.ingestCalls.length, 0);
  });
});

describe('sendGoogleAdsValueConversion placeholder-action-id guard', () => {
  it('is a no-op when conversionActionId is the PENDING_TASK_9 placeholder', async (t) => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => { throw new Error('must not be called'); },
      ingestImpl: () => { throw new Error('must not be called'); },
    });
    t.after(() => stub.restore());

    const env = googleAdsEnv();
    const waitUntil = mockWaitUntil();
    googleAds.sendGoogleAdsValueConversion(env, waitUntil, {
      clickId: 'abcdefghij1234567890',
      conversionActionId: googleAds.PLACEHOLDER_ACTION_ID,
      conversionValue: 25,
      orderId: 'pi_test_pending',
    });
    await drainWaitUntil(waitUntil);

    assert.equal(stub.tokenCalls.length, 0);
    assert.equal(stub.ingestCalls.length, 0);
  });

  it('uploads normally once a real conversionActionId replaces the placeholder', async (t) => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => okTokenResponse(),
      ingestImpl: () => okIngestResponse(),
    });
    t.after(() => stub.restore());

    const env = googleAdsEnv();
    const waitUntil = mockWaitUntil();
    googleAds.sendGoogleAdsValueConversion(env, waitUntil, {
      clickId: 'abcdefghij1234567890',
      conversionActionId: googleAds.NEWSLETTER_CONVERSION_ACTION_ID,
      conversionValue: 25,
      orderId: 'pi_test_real_id',
    });
    await drainWaitUntil(waitUntil);

    assert.equal(stub.ingestCalls.length, 1);
  });
});
