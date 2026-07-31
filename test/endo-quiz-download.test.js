/**
 * functions/api/endo-quiz/download.js -- the PDF-download conversion hook.
 *
 * It landed on 2026-07-29 with no test and, because it is inside
 * functions/api/endo-quiz/, it sits in the same product surface as the
 * national survey system. 0/45 lines: the sibling request.js could reach 100%
 * and the product row would still not close.
 *
 * What is worth asserting here is not the response shape (it is always
 * { ok: true }) but WHEN a conversion is uploaded, because this endpoint
 * exists to satisfy an Ad Grants policy that requires a real conversion each
 * month and forbids inventing one:
 *   - configured account + a gclid cookie -> exactly one upload, carrying that
 *     gclid and the Endo Quiz conversion action;
 *   - configured account + no gclid (an organic visitor) -> 200 and NOTHING
 *     uploaded, because a synthetic conversion is worse than a missing one;
 *   - unconfigured account -> 503, so a silent no-op is not mistaken for a
 *     working hook.
 *
 * The Google token and Data Manager endpoints are stubbed through
 * stubExternalFetch's default route, so what is proven is what this endpoint
 * sends; nothing here proves Google accepts it.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, stubExternalFetch, drainWaitUntil, randomIp } from './_helpers.js';

const download = await import('../functions/api/endo-quiz/download.js');

const ADS_SECRETS = {
  GOOGLE_ADS_CLIENT_ID: 'client-id',
  GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
  GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
};

/** Routes the two Google hosts this path talks to; everything else still throws. */
function googleRoutes({ token = { access_token: 'ya29.stub' }, ingestOk = true } = {}) {
  return (call) => {
    if (call.url.includes('oauth2.googleapis.com')) {
      call.service = 'google-token';
      return { ok: true, status: 200, json: async () => token };
    }
    if (call.url.includes('datamanager.googleapis.com')) {
      call.service = 'google-ingest';
      return ingestOk
        ? { ok: true, status: 200, text: async () => '{}' }
        : { ok: false, status: 403, text: async () => 'USER_PERMISSION_DENIED' };
    }
    throw new Error(`unrouted request to ${call.url}`);
  };
}

describe('POST /api/endo-quiz/download', () => {
  let env, waitUntil, stub, events;

  beforeEach(() => {
    events = [];
    env = mockEnv(ADS_SECRETS);
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    waitUntil = mockWaitUntil();
    stub = stubExternalFetch({ default: googleRoutes() });
  });
  afterEach(() => stub.restore());

  async function post({ headers = {}, ip = randomIp() } = {}) {
    const res = await download.onRequestPost({
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/endo-quiz/download',
        headers: { 'cf-connecting-ip': ip, ...headers },
      }),
      env,
      waitUntil,
    });
    await drainWaitUntil(waitUntil);
    return parseResponse(res);
  }

  const uploads = () => stub.calls.filter(c => c.url.includes('datamanager.googleapis.com'));
  const actions = () => events.map(e => e.blobs[2]);

  it('answers OPTIONS with 204 and the locked-down origin', async () => {
    const res = await download.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });

  // --- configuration -------------------------------------------------------

  for (const missing of ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN']) {
    it(`503s rather than silently no-opping when ${missing} is absent`, async () => {
      env[missing] = undefined;
      const { status, body } = await post({ headers: { Cookie: 'gclid=abcdefghijklmno' } });
      assert.equal(status, 503);
      assert.deepEqual(body, { error: 'service_unavailable' });
      assert.equal(uploads().length, 0);
    });
  }

  // --- rate limiting -------------------------------------------------------

  it('allows ten downloads from one IP and refuses the eleventh', async () => {
    const ip = randomIp();
    for (let i = 0; i < 10; i++) {
      assert.equal((await post({ ip })).status, 200, `download ${i + 1} should have been accepted`);
    }
    const { status, body } = await post({ ip });
    assert.equal(status, 429);
    assert.deepEqual(body, { error: 'rate_limited' });
  });

  it('keeps a bucket per IP', async () => {
    const ip = randomIp();
    for (let i = 0; i < 10; i++) await post({ ip });
    assert.equal((await post({ ip: randomIp() })).status, 200);
  });

  it('buckets every IP-less request together under the literal "unknown"', async () => {
    // PRODUCTION DEFAULT: `cf-connecting-ip` is set by Cloudflare on real
    // traffic, so the `|| 'unknown'` arm is what a direct or internal caller
    // takes. Eleven of those share one bucket rather than each getting ten.
    const bare = () => download.onRequestPost({
      request: mockRequest('POST', { url: 'https://rrmacademy.org/api/endo-quiz/download' }),
      env, waitUntil,
    });
    for (let i = 0; i < 10; i++) assert.equal((await bare()).status, 200, `download ${i + 1} should have been accepted`);
    assert.equal((await bare()).status, 429);
  });

  it('fails CLOSED with 429 when the rate-limit KV namespace is missing', async () => {
    env.COMMUNITY_KV = undefined;
    const { status, body } = await post();
    assert.equal(status, 429);
    assert.deepEqual(body, { error: 'rate_limited' });
    assert.equal(uploads().length, 0);
  });

  it('checks the rate limit before the configuration guard', async () => {
    // Order matters: a misconfigured account must not become an unmetered
    // endpoint that answers 503 as fast as it is asked.
    env.GOOGLE_ADS_CLIENT_ID = undefined;
    const ip = randomIp();
    for (let i = 0; i < 10; i++) assert.equal((await post({ ip })).status, 503);
    assert.equal((await post({ ip })).status, 429);
  });

  // --- the conversion ------------------------------------------------------

  it('uploads one conversion carrying the visitor\'s gclid and the Endo Quiz action', async () => {
    const { status, body } = await post({ headers: { Cookie: 'foo=bar; gclid=Cj0KCQjw_abcdef123; other=1' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });

    const [upload] = uploads();
    assert.ok(upload, 'no conversion was uploaded for an ad visitor');
    assert.equal(upload.body.events[0].adIdentifiers.gclid, 'Cj0KCQjw_abcdef123');
    assert.equal(upload.body.destinations[0].productDestinationId, '7671519551');
    assert.equal(upload.body.destinations[0].operatingAccount.accountId, '4262268858');
    assert.equal(upload.body.events[0].conversionValue, 1);
    assert.equal(upload.body.events[0].eventSource, 'WEB');
    assert.equal(actions().includes('conversion_error'), false);
  });

  it('uploads nothing for an organic visitor with no gclid cookie', async () => {
    const { status, body } = await post({ headers: { Cookie: 'session=abc' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(stub.calls.length, 0, 'a synthetic conversion was uploaded for a non-ad visitor');
  });

  it('uploads nothing when there is no Cookie header at all', async () => {
    assert.equal((await post()).status, 200);
    assert.equal(stub.calls.length, 0);
  });

  it('uploads nothing for a malformed gclid', async () => {
    const { status } = await post({ headers: { Cookie: 'gclid=short' } });
    assert.equal(status, 200);
    assert.equal(stub.calls.length, 0, 'a gclid that fails the format check was still uploaded');
  });

  it('still answers 200 and logs when Google rejects the upload', async () => {
    stub.restore();
    stub = stubExternalFetch({ default: googleRoutes({ ingestOk: false }) });
    const { status, body } = await post({ headers: { Cookie: 'gclid=abcdefghijklmno' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.ok(actions().includes('conversion_error'), 'the rejected upload was not logged');
  });

  it('still answers 200 when the OAuth token exchange fails', async () => {
    stub.restore();
    stub = stubExternalFetch({ default: googleRoutes({ token: {} }) });
    const { status } = await post({ headers: { Cookie: 'gclid=abcdefghijklmno' } });
    assert.equal(status, 200);
    assert.equal(uploads().length, 0, 'an upload was attempted with no access token');
    assert.ok(actions().includes('conversion_error'));
  });

  // --- the error contract --------------------------------------------------

  it('answers 500 generically instead of propagating an unexpected failure', async () => {
    // Synthetic trigger: sendGoogleAdsConversion swallows its own errors, so
    // the only way into the outer catch is a platform object misbehaving. What
    // is asserted is the CONTRACT -- a generic 500 body and a download_fail
    // event -- not the trigger.
    const request = mockRequest('POST', {
      url: 'https://rrmacademy.org/api/endo-quiz/download',
      headers: { 'cf-connecting-ip': randomIp() },
    });
    const realGet = request.headers.get.bind(request.headers);
    request.headers.get = (name) => {
      if (name === 'Cookie') throw new TypeError('header read failed');
      return realGet(name);
    };

    const { status, body } = await parseResponse(await download.onRequestPost({ request, env, waitUntil }));
    assert.equal(status, 500);
    assert.deepEqual(body, { error: 'server_error' });
    assert.ok(actions().includes('download_fail'), 'the unexpected failure was not logged');
    assert.equal(JSON.stringify(body).includes('header read failed'), false, 'the internal reason reached the client');
  });
});
