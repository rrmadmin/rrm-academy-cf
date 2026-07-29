/**
 * Executed tests for the three remaining survey endpoints, 0 lines covered
 * before this file:
 *   GET  /api/survey/validate  (functions/api/survey/validate.js, 0/44)
 *   GET  /api/survey/count     (functions/api/survey/count.js,    0/71)
 *   POST /api/survey/event     (functions/api/survey/event.js,    0/96)
 *
 * validate is what the take page calls before rendering the questionnaire, so
 * its "expired" vs "used" vs "valid" answers decide what a participant is told.
 * count is the public "N women have taken this" number quoted in grant
 * material, so the legacy-cohort arithmetic is asserted against the shared
 * constants rather than against hardcoded totals.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as validateRoute from '../functions/api/survey/validate.js';
import * as countRoute from '../functions/api/survey/count.js';
import * as eventRoute from '../functions/api/survey/event.js';
import { SQSP_LEGACY_EXACT, WIX_LEGACY_ESTIMATE } from '../src/lib/survey-legacy-constants.js';
import {
  mockRequest, mockEnv, mockDB, mockKVJson, mockWaitUntil, parseResponse, randomIp,
} from './_helpers.js';

// Generated per run rather than hardcoded -- see the note in
// test/survey-submit.test.js (gitleaks entropy scan).
const TOKEN = randomUUID();

// ---------------------------------------------------------------- validate --

function validateContext({ token = TOKEN, tokenRecord, ip = randomIp(), env: envOverrides = {} } = {}) {
  const env = mockEnv({
    SURVEY_TOKENS: mockKVJson(tokenRecord ? { [`token:${TOKEN}`]: tokenRecord } : {}),
    ...envOverrides,
  });
  const url = token === null
    ? 'https://rrmacademy.org/api/survey/validate'
    : `https://rrmacademy.org/api/survey/validate?token=${encodeURIComponent(token)}`;
  return {
    env,
    request: mockRequest('GET', { url, headers: ip ? { 'cf-connecting-ip': ip } : {} }),
  };
}

describe('survey/validate', () => {
  it('answers OPTIONS with 204 and the locked-down origin', async () => {
    const res = await validateRoute.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });

  it('refuses a request with no client IP (the rate limiter has nothing to key on)', async () => {
    const ctx = validateContext({ ip: null });
    const parsed = await parseResponse(await validateRoute.onRequestGet(ctx));
    assert.equal(parsed.status, 503);
    assert.equal(parsed.body.error, 'service_unavailable');
  });

  it('rate-limits an IP after 30 checks in the window', async () => {
    const ip = randomIp();
    const env = mockEnv({ SURVEY_TOKENS: mockKVJson({ [`token:${TOKEN}`]: { used: false } }) });
    const statuses = [];
    for (let i = 0; i < 31; i++) {
      const res = await validateRoute.onRequestGet({
        env,
        request: mockRequest('GET', {
          url: `https://rrmacademy.org/api/survey/validate?token=${TOKEN}`,
          headers: { 'cf-connecting-ip': ip },
        }),
      });
      statuses.push((await parseResponse(res)).status);
    }
    assert.deepEqual([...new Set(statuses.slice(0, 30))], [200]);
    assert.equal(statuses[30], 429);
  });

  it('refuses with 503 when the token KV namespace is not bound', async () => {
    const ctx = validateContext({ env: { SURVEY_TOKENS: undefined } });
    const parsed = await parseResponse(await validateRoute.onRequestGet(ctx));
    assert.equal(parsed.status, 503);
    assert.equal(parsed.body.error, 'service_unavailable');
  });

  it('answers 400 missing when no token is supplied', async () => {
    const ctx = validateContext({ token: null });
    const parsed = await parseResponse(await validateRoute.onRequestGet(ctx));
    assert.equal(parsed.status, 400);
    assert.deepEqual(parsed.body, { valid: false, reason: 'missing' });
  });

  it('reports an unknown token as expired, with a 200 so the page can explain', async () => {
    const ctx = validateContext({ tokenRecord: null });
    const parsed = await parseResponse(await validateRoute.onRequestGet(ctx));
    assert.equal(parsed.status, 200);
    assert.deepEqual(parsed.body, { valid: false, reason: 'expired' });
  });

  it('distinguishes an already-used token from an expired one', async () => {
    const ctx = validateContext({ tokenRecord: { email: 'x@example.com', used: true } });
    const parsed = await parseResponse(await validateRoute.onRequestGet(ctx));
    assert.equal(parsed.status, 200);
    assert.deepEqual(parsed.body, { valid: false, reason: 'used' });
  });

  it('accepts an unused token and returns nothing else about it', async () => {
    const ctx = validateContext({ tokenRecord: { email: 'x@example.com', used: false, userorigin: 'instagram' } });
    const parsed = await parseResponse(await validateRoute.onRequestGet(ctx));
    assert.equal(parsed.status, 200);
    assert.deepEqual(parsed.body, { valid: true }, 'the validate response must not echo the stored identity');
  });
});

// ------------------------------------------------------------------- count --

describe('survey/count', () => {
  const ROW_SQL = 'FROM survey_identities';

  it('answers OPTIONS with 204', async () => {
    const res = await countRoute.onRequestOptions();
    assert.equal(res.status, 204);
  });

  it('refuses with 503 when the identity DB is not bound', async () => {
    const parsed = await parseResponse(await countRoute.onRequestGet({ env: mockEnv({ SURVEY_DB: undefined }) }));
    assert.equal(parsed.status, 503);
    assert.equal(parsed.body.error, 'service_unavailable');
  });

  it('answers 500 count_failed when the query throws, without leaking the error', async () => {
    const env = mockEnv({ SURVEY_DB: mockDB({ [ROW_SQL]: { throws: 'no such table: survey_identities' } }) });
    const parsed = await parseResponse(await countRoute.onRequestGet({ env }));
    assert.equal(parsed.status, 500);
    assert.deepEqual(parsed.body, { error: 'count_failed' });
  });

  it('adds the two fixed legacy cohorts to the live distinct count', async () => {
    const env = mockEnv({
      SURVEY_DB: mockDB({
        [ROW_SQL]: { first: { submissions: 2100, distinct_takers: 1900, last_updated: '2026-07-20 10:00:00' } },
      }),
    });
    const parsed = await parseResponse(await countRoute.onRequestGet({ env }));
    assert.equal(parsed.status, 200);
    assert.equal(parsed.body.liveDistinct, 1900);
    assert.equal(parsed.body.liveSubmissions, 2100);
    assert.equal(parsed.body.sqspLegacyExact, SQSP_LEGACY_EXACT);
    assert.equal(parsed.body.wixLegacyEstimate, WIX_LEGACY_ESTIMATE);
    // The public number must be distinct takers plus legacy cohorts. Retakes
    // (submissions) must NOT inflate it.
    assert.equal(parsed.body.total, 1900 + SQSP_LEGACY_EXACT + WIX_LEGACY_ESTIMATE);
    assert.equal(parsed.body.lastUpdated, '2026-07-20 10:00:00');
    assert.equal(parsed.body.source, 'endo-survey-v1+ + sqsp-pdf-exact + wix-pdf-legacy-estimate');
  });

  it('scopes the count to endo-survey-v1 sources so other surveys cannot inflate it', async () => {
    const env = mockEnv({ SURVEY_DB: mockDB({ [ROW_SQL]: { first: { submissions: 1, distinct_takers: 1 } } }) });
    await countRoute.onRequestGet({ env });
    const call = env.SURVEY_DB._calls[0];
    assert.match(call.sql, /WHERE source LIKE 'endo-survey-v1%'/);
    assert.match(call.sql, /COUNT\(DISTINCT email\) AS distinct_takers/);
  });

  it('falls back to zero live takers when the row is empty rather than emitting NaN', async () => {
    const env = mockEnv({ SURVEY_DB: mockDB({ [ROW_SQL]: { first: null } }) });
    const parsed = await parseResponse(await countRoute.onRequestGet({ env }));
    assert.equal(parsed.body.liveDistinct, 0);
    assert.equal(parsed.body.liveSubmissions, 0);
    assert.equal(parsed.body.total, SQSP_LEGACY_EXACT + WIX_LEGACY_ESTIMATE);
    assert.equal(parsed.body.lastUpdated, null);
  });

  it('sets a short shared cache so the number is edge-cached but not stale for long', async () => {
    const env = mockEnv({ SURVEY_DB: mockDB({ [ROW_SQL]: { first: { submissions: 5, distinct_takers: 5 } } }) });
    const parsed = await parseResponse(await countRoute.onRequestGet({ env }));
    assert.equal(parsed.headers['cache-control'], 'public, max-age=60, s-maxage=60, stale-while-revalidate=120');
  });
});

// ------------------------------------------------------------------- event --

function eventContext({ body = { action: 'download_pdf', viewport_width: 1440 }, rawBody, ip = randomIp(), userAgent = 'Mozilla/5.0 (iPhone)', cf, env: envOverrides = {} } = {}) {
  const writes = [];
  const env = mockEnv({ EVENTS: { writeDataPoint: (dp) => writes.push(dp) }, ...envOverrides });
  const request = mockRequest('POST', {
    body,
    rawBody,
    url: 'https://rrmacademy.org/api/survey/event',
    headers: { 'cf-connecting-ip': ip, 'User-Agent': userAgent },
  });
  if (cf) request.cf = cf;
  return { env, waitUntil: mockWaitUntil(), request, writes };
}

describe('survey/event', () => {
  it('answers OPTIONS with 204', async () => {
    const res = await eventRoute.onRequestOptions();
    assert.equal(res.status, 204);
  });

  it('refuses with 503 when the Analytics Engine binding is absent', async () => {
    const ctx = eventContext({ env: { EVENTS: undefined } });
    const parsed = await parseResponse(await eventRoute.onRequestPost(ctx));
    assert.equal(parsed.status, 503);
    assert.equal(parsed.body.error, 'service_unavailable');
  });

  it('drops a crawler by user agent without writing a data point', async () => {
    const ctx = eventContext({ userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.0)' });
    const res = await eventRoute.onRequestPost(ctx);
    assert.equal(res.status, 204);
    assert.equal(ctx.writes.length, 0, 'bot traffic must not enter the analytics dataset');
  });

  it('drops a datacenter-ASN request even with a browser user agent', async () => {
    const ctx = eventContext({ cf: { asn: 16509 } }); // AWS
    const res = await eventRoute.onRequestPost(ctx);
    assert.equal(res.status, 204);
    assert.equal(ctx.writes.length, 0);
  });

  it('rate-limits an IP after 60 events in the window', async () => {
    const ip = randomIp();
    const writes = [];
    const env = mockEnv({ EVENTS: { writeDataPoint: (dp) => writes.push(dp) } });
    let last;
    for (let i = 0; i < 61; i++) {
      last = await eventRoute.onRequestPost({
        env,
        waitUntil: mockWaitUntil(),
        request: mockRequest('POST', {
          body: { action: 'calculate', viewport_width: 1200 },
          headers: { 'cf-connecting-ip': ip, 'User-Agent': 'Mozilla/5.0' },
        }),
      });
    }
    assert.equal(last.status, 429);
    assert.equal((await parseResponse(last)).body.error, 'rate_limited');
    assert.equal(writes.length, 60, 'the 61st event must not be recorded');
  });

  it('rejects a body that is not JSON', async () => {
    const ctx = eventContext({ rawBody: '{action:' });
    const parsed = await parseResponse(await eventRoute.onRequestPost(ctx));
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'invalid_json');
  });

  it('rejects a JSON array payload', async () => {
    const ctx = eventContext({ rawBody: '["download_pdf"]' });
    const parsed = await parseResponse(await eventRoute.onRequestPost(ctx));
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'invalid_payload');
  });

  it('rejects an action outside the allowlist', async () => {
    for (const action of ['exfiltrate', 42, undefined]) {
      const ctx = eventContext({ body: { action, viewport_width: 800 } });
      const parsed = await parseResponse(await eventRoute.onRequestPost(ctx));
      assert.equal(parsed.status, 400, `action ${String(action)} should be refused`);
      assert.equal(parsed.body.error, 'invalid_action');
      assert.equal(ctx.writes.length, 0);
    }
  });

  it('rejects a viewport width that is missing, zero, negative, huge or not a number', async () => {
    for (const viewport_width of [undefined, 0, -1, 10001, '1024', Number.NaN]) {
      const ctx = eventContext({ body: { action: 'calculate', viewport_width } });
      const parsed = await parseResponse(await eventRoute.onRequestPost(ctx));
      assert.equal(parsed.status, 400, `viewport ${String(viewport_width)} should be refused`);
      assert.equal(parsed.body.error, 'invalid_viewport');
    }
  });

  it('accepts every allowlisted action and records it with the device bucket', async () => {
    for (const action of ['calculate', 'download_pdf', 'copy_for_ai', 'follow_instagram']) {
      const ctx = eventContext({ body: { action, viewport_width: 390 } });
      const res = await eventRoute.onRequestPost(ctx);
      assert.equal(res.status, 204);
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
      assert.equal(ctx.writes.length, 1);
      assert.deepEqual(ctx.writes[0].blobs, ['survey', 'survey_event', action, 'mobile', '']);
      assert.deepEqual(ctx.writes[0].doubles, [0, 0, 390]);
      assert.deepEqual(ctx.writes[0].indexes, [action]);
    }
  });

  it('buckets the device by viewport at the documented boundaries', async () => {
    for (const [width, expected] of [[768, 'mobile'], [769, 'tablet'], [1024, 'tablet'], [1025, 'desktop']]) {
      const ctx = eventContext({ body: { action: 'calculate', viewport_width: width } });
      await eventRoute.onRequestPost(ctx);
      assert.equal(ctx.writes[0].blobs[3], expected, `viewport ${width} should bucket as ${expected}`);
    }
  });

  it('answers 500 internal_error when the Analytics Engine write throws', async () => {
    // Only the event write fails; the catch block's own log() write succeeds,
    // which is the path that reaches the documented error contract.
    let calls = 0;
    const ctx = eventContext({
      env: {
        EVENTS: {
          writeDataPoint() { if (calls++ === 0) throw new Error('AE dataset over quota'); },
        },
      },
    });
    const res = await eventRoute.onRequestPost(ctx);
    const parsed = await parseResponse(res);
    assert.equal(parsed.status, 500);
    assert.deepEqual(parsed.body, { error: 'internal_error' });
    assert.ok(!JSON.stringify(parsed.body).includes('over quota'), 'internal detail must not reach the client');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });

  it('KNOWN DEFECT: a persistently failing Analytics Engine binding escapes the error handler', async () => {
    // functions/api/_log.js calls env.EVENTS.writeDataPoint() unguarded, and
    // survey/event.js's catch block calls log() before building its 500. So
    // when the binding itself is broken (rather than one bad data point) the
    // SECOND write throws out of the catch and the handler rejects instead of
    // returning { error: 'internal_error' } with CORS headers -- in production
    // the browser sees an opaque platform 500 with no Access-Control headers,
    // i.e. a CORS error rather than a clean failure.
    //
    // Pinned, not asserted away: the fix belongs in _log.js (wrap the
    // writeDataPoint call), which is a change to a module every endpoint
    // imports and is out of scope for a coverage tranche. When it is fixed,
    // this test flips to the contract assertion above.
    const ctx = eventContext({ env: { EVENTS: { writeDataPoint() { throw new Error('AE binding unavailable'); } } } });
    await assert.rejects(
      () => eventRoute.onRequestPost(ctx),
      /AE binding unavailable/,
      'if this now resolves, _log.js was hardened -- assert the 500 contract instead'
    );
  });
});

describe('survey/event -- production defaults (no env override in play)', () => {
  it('falls back to the "unknown" rate-limit bucket when the edge sends no client IP', async () => {
    const communityKv = mockKVJson();
    const writes = [];
    const env = mockEnv({ COMMUNITY_KV: communityKv, EVENTS: { writeDataPoint: (dp) => writes.push(dp) } });
    const res = await eventRoute.onRequestPost({
      env,
      waitUntil: mockWaitUntil(),
      request: mockRequest('POST', {
        body: { action: 'calculate', viewport_width: 1200 },
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }),
    });
    assert.equal(res.status, 204);
    assert.ok(communityKv._store.has('rl:survey-event:unknown'), `buckets: ${[...communityKv._store.keys()]}`);
    assert.equal(writes.length, 1);
  });

  it('logs "internal" when the thrown value carries no message', async () => {
    // A non-Error throw (a bare string, a rejected worker binding) has no
    // .message, so the `|| 'internal'` arm is what actually reaches telemetry.
    const logged = [];
    let calls = 0;
    const env = mockEnv({
      EVENTS: {
        writeDataPoint(dp) {
          if (calls++ === 0) throw 'binding blew up'; // eslint-disable-line no-throw-literal
          logged.push(dp);
        },
      },
    });
    const parsed = await parseResponse(await eventRoute.onRequestPost({
      env,
      waitUntil: mockWaitUntil(),
      request: mockRequest('POST', {
        body: { action: 'calculate', viewport_width: 1200 },
        headers: { 'cf-connecting-ip': randomIp(), 'User-Agent': 'Mozilla/5.0' },
      }),
    }));
    assert.equal(parsed.status, 500);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].blobs[4], 'internal');
  });
});
