/**
 * Executed tests for POST /api/survey/submit (functions/api/survey/submit.js).
 * 0/204 lines before this file.
 *
 * This endpoint is the pseudonymization boundary of the national endometriosis
 * self-survey. Two invariants carry the whole design and both are asserted by
 * executing the handler against separate fake databases:
 *
 *   SPLIT     Symptoms and scores go to SURVEY_SYMPTOMS_DB (rrm-survey-symptoms)
 *             keyed only by an opaque rec_id. The email goes to SURVEY_DB
 *             (rrm-survey) alongside that rec_id and nowhere else. If those two
 *             stores ever converge, the survey stops being pseudonymized. The
 *             tests here assert the symptom write's SQL and every bound value
 *             are free of the address, not merely that "an insert happened".
 *
 *   ROLLBACK  Symptoms are written BEFORE the identity link, and a failed
 *             symptom write un-claims the token in D1 AND restores the original
 *             KV record so the person can resubmit. Without it a dropped write
 *             burns the magic link and the response is lost for good.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { onRequestPost, onRequestOptions } from '../functions/api/survey/submit.js';
import {
  mockRequest, mockEnv, mockDB, mockKVJson, mockWaitUntil, parseResponse, randomIp,
  stubExternalFetch, drainWaitUntil,
} from './_helpers.js';

// Generated per run, not a literal: a fixed UUID string trips the repo's
// gitleaks entropy scan as a generic-api-key, and a fresh token each run also
// proves nothing here depends on one particular value.
const TOKEN = randomUUID();
const EMAIL = 'participant@example.com';
const TOKEN_TTL = 24 * 60 * 60;

function goodBody(overrides = {}) {
  return {
    token: TOKEN,
    symptoms: {
      tier1: ['Painful periods', 'Pain with intercourse'],
      tier2: ['Fatigue'],
      tier3: [],
    },
    score: { total: 12, tier1: 8, tier2: 3, tier3: 1 },
    device: { viewport_width: 390 },
    ...overrides,
  };
}

function makeContext({
  body = goodBody(),
  rawBody,
  tokenRecord = { email: EMAIL, created: Date.now(), used: false, userorigin: 'instagram', utmSource: 'ig_bio' },
  surveyDbMap = {},
  symptomsDbMap = {},
  env: envOverrides = {},
  ip = randomIp(),
  headers = {},
} = {}) {
  const SURVEY_TOKENS = mockKVJson(tokenRecord ? { [`token:${TOKEN}`]: tokenRecord } : {});
  const env = mockEnv({
    SURVEY_TOKENS,
    SURVEY_DB: mockDB(surveyDbMap),
    SURVEY_SYMPTOMS_DB: mockDB(symptomsDbMap),
    ...envOverrides,
  });
  const waitUntil = mockWaitUntil();
  return {
    env,
    waitUntil,
    request: mockRequest('POST', {
      body,
      rawBody,
      url: 'https://rrmacademy.org/api/survey/submit',
      headers: { 'cf-connecting-ip': ip, referer: 'https://rrmacademy.org/endo-survey/take/', ...headers },
    }),
  };
}

async function run(ctx) {
  const res = await onRequestPost(ctx);
  await drainWaitUntil(ctx.waitUntil);
  return parseResponse(res);
}

const symptomInsert = (env) => env.SURVEY_SYMPTOMS_DB._calls.find(c => c.sql.includes('INSERT INTO survey_symptoms'));
const identityInsert = (env) => env.SURVEY_DB._calls.find(c => c.sql.includes('INSERT INTO survey_identities'));
const claimInsert = (env) => env.SURVEY_DB._calls.find(c => c.sql.includes('INSERT INTO survey_token_claims'));
const claimDelete = (env) => env.SURVEY_DB._calls.find(c => c.sql.includes('DELETE FROM survey_token_claims'));

describe('survey/submit -- CORS preflight', () => {
  it('answers OPTIONS with 204 and the locked-down origin', async () => {
    const res = await onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

describe('survey/submit -- binding guards', () => {
  for (const binding of ['SURVEY_TOKENS', 'SURVEY_DB', 'SURVEY_SYMPTOMS_DB']) {
    it(`refuses with 500 when ${binding} is not bound`, async () => {
      const ctx = makeContext({ env: { [binding]: undefined } });
      const parsed = await run(ctx);
      assert.equal(parsed.status, 500);
      assert.deepEqual(parsed.body, { ok: false, error: 'Server misconfigured' });
    });
  }
});

describe('survey/submit -- input validation', () => {
  const cases = [
    ['a body that is not JSON', { rawBody: '{"token":' }, 400, 'Invalid JSON'],
    ['a JSON array payload', { rawBody: '[]' }, 400, 'Invalid payload'],
    ['a missing token', { body: goodBody({ token: undefined }) }, 400, 'Missing required fields'],
    ['missing symptoms', { body: goodBody({ symptoms: undefined }) }, 400, 'Missing required fields'],
    ['a missing score', { body: goodBody({ score: undefined }) }, 400, 'Missing required fields'],
    ['a non-string token', { body: goodBody({ token: 12345 }) }, 400, 'Invalid token'],
    ['an over-long token', { body: goodBody({ token: 'x'.repeat(41) }) }, 400, 'Invalid token'],
  ];
  for (const [label, ctxArgs, status, error] of cases) {
    it(`rejects ${label}`, async () => {
      const ctx = makeContext(ctxArgs);
      const parsed = await run(ctx);
      assert.equal(parsed.status, status);
      assert.equal(parsed.body.error, error);
      assert.equal(symptomInsert(ctx.env), undefined, 'invalid input must never reach the symptom store');
    });
  }

  it('rejects symptoms that are not three arrays', async () => {
    const ctx = makeContext({ body: goodBody({ symptoms: { tier1: [], tier2: [], tier3: 'nope' } }) });
    const parsed = await run(ctx);
    assert.equal(parsed.status, 400);
    assert.match(parsed.body.error, /tier1, tier2, tier3 arrays/);
  });

  it('caps the number of symptoms per tier at 50', async () => {
    const ctx = makeContext({ body: goodBody({ symptoms: { tier1: new Array(51).fill('x'), tier2: [], tier3: [] } }) });
    const parsed = await run(ctx);
    assert.equal(parsed.status, 400);
    assert.match(parsed.body.error, /Too many symptoms \(max 50 per tier\)/);
  });

  it('accepts exactly 50 symptoms in a tier (boundary is inclusive)', async () => {
    const ctx = makeContext({ body: goodBody({ symptoms: { tier1: new Array(50).fill('x'), tier2: [], tier3: [] } }) });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 200);
    } finally { stub.restore(); }
  });

  it('rejects a non-string symptom and an over-long symptom', async () => {
    for (const tier1 of [[42], ['x'.repeat(201)]]) {
      const ctx = makeContext({ body: goodBody({ symptoms: { tier1, tier2: [], tier3: [] } }) });
      const parsed = await run(ctx);
      assert.equal(parsed.status, 400);
      assert.match(parsed.body.error, /at most 200 characters/);
    }
  });

  it('rejects scores that are negative, over 200, or not finite', async () => {
    const bad = [
      { total: -1, tier1: 0, tier2: 0, tier3: 0 },
      { total: 201, tier1: 0, tier2: 0, tier3: 0 },
      { total: Number.NaN, tier1: 0, tier2: 0, tier3: 0 },
      { total: 1, tier1: 'x', tier2: 0, tier3: 0 },
    ];
    for (const score of bad) {
      const ctx = makeContext({ body: goodBody({ score }) });
      const parsed = await run(ctx);
      assert.equal(parsed.status, 400, `score ${JSON.stringify(score)} should be refused`);
      assert.match(parsed.body.error, /score values must be finite/);
    }
  });
});

describe('survey/submit -- token lifecycle', () => {
  it('rate-limits a single IP after 10 submissions', async () => {
    const ip = randomIp();
    const env = mockEnv({ SURVEY_TOKENS: mockKVJson(), SURVEY_DB: mockDB(), SURVEY_SYMPTOMS_DB: mockDB() });
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const res = await onRequestPost({
        env,
        waitUntil: mockWaitUntil(),
        request: mockRequest('POST', { body: goodBody(), headers: { 'cf-connecting-ip': ip } }),
      });
      statuses.push((await parseResponse(res)).status);
    }
    // The first ten get past the limiter and fail on the (absent) token, 404.
    assert.deepEqual([...new Set(statuses.slice(0, 10))], [404]);
    assert.equal(statuses[10], 429);
    assert.equal((await parseResponse(await onRequestPost({
      env,
      waitUntil: mockWaitUntil(),
      request: mockRequest('POST', { body: goodBody(), headers: { 'cf-connecting-ip': ip } }),
    }))).body.error, 'rate_limited');
  });

  it('answers 404 for a token that is not in KV', async () => {
    const ctx = makeContext({ tokenRecord: null });
    const parsed = await run(ctx);
    assert.equal(parsed.status, 404);
    assert.equal(parsed.body.error, 'Token not found');
    assert.equal(claimInsert(ctx.env), undefined);
  });

  it('answers 409 for a token already marked used in KV', async () => {
    const ctx = makeContext({ tokenRecord: { email: EMAIL, created: Date.now(), used: true } });
    const parsed = await run(ctx);
    assert.equal(parsed.status, 409);
    assert.equal(parsed.body.error, 'Survey already completed');
    assert.equal(symptomInsert(ctx.env), undefined);
  });

  it('answers 409 when the D1 claim insert loses the race (UNIQUE constraint)', async () => {
    const ctx = makeContext({ surveyDbMap: { 'INSERT INTO survey_token_claims': { throws: 'UNIQUE constraint failed: survey_token_claims.token' } } });
    const parsed = await run(ctx);
    assert.equal(parsed.status, 409);
    assert.equal(parsed.body.error, 'Survey already completed');
    assert.equal(symptomInsert(ctx.env), undefined, 'a lost claim race must not double-write symptoms');
  });

  it('answers 409 when the claim insert reports success:false', async () => {
    const ctx = makeContext({ surveyDbMap: { 'INSERT INTO survey_token_claims': { run: { success: false } } } });
    const parsed = await run(ctx);
    assert.equal(parsed.status, 409);
    assert.equal(symptomInsert(ctx.env), undefined);
  });

  it('surfaces a non-UNIQUE claim error as a generic 500, not a false 409', async () => {
    const ctx = makeContext({ surveyDbMap: { 'INSERT INTO survey_token_claims': { throws: 'no such table: survey_token_claims' } } });
    const parsed = await run(ctx);
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'An unexpected error occurred. Please try again.');
  });
});

describe('survey/submit -- pseudonymization split', () => {
  it('writes symptoms to the symptom DB with no identity, and the identity to the other DB', async () => {
    const ctx = makeContext();
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 200);
      assert.deepEqual(parsed.body, { ok: true });

      const symptoms = symptomInsert(ctx.env);
      const identity = identityInsert(ctx.env);
      assert.ok(symptoms, 'symptoms must be written');
      assert.ok(identity, 'identity must be written');

      // 1. The two writes go to two different bindings.
      assert.equal(ctx.env.SURVEY_DB._calls.some(c => c.sql.includes('INSERT INTO survey_symptoms')), false);
      assert.equal(ctx.env.SURVEY_SYMPTOMS_DB._calls.some(c => c.sql.includes('survey_identities')), false);

      // 2. NOTHING in the symptom write carries the address, in the SQL or in
      //    any bound value. This is the assertion that would fail the moment a
      //    well-meaning change adds an email column "for convenience".
      assert.ok(!/email/i.test(symptoms.sql), `symptom SQL mentions email: ${symptoms.sql}`);
      for (const value of symptoms.bound) {
        assert.ok(
          String(value ?? '').toLowerCase().indexOf(EMAIL.toLowerCase()) === -1,
          `symptom write leaked the address in a bound value: ${value}`
        );
        assert.ok(!/@/.test(String(value ?? '')), `symptom write bound an address-shaped value: ${value}`);
      }

      // 3. The join key is a fresh opaque rec_id, present on both sides.
      const recId = symptoms.bound[0];
      assert.match(recId, /^[0-9a-f-]{36}$/);
      assert.deepEqual(identity.bound, [EMAIL, recId, 'endo-survey-v1']);
    } finally { stub.restore(); }
  });

  it('binds the scores, tier text, origin and device shape the schema expects', async () => {
    const ctx = makeContext();
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      const bound = symptomInsert(ctx.env).bound;
      // rec_id, total, t1, t2, t3, tier1 text, tier2 text, tier3 text, origin, vw, device, referrer
      assert.deepEqual(bound.slice(1, 5), [12, 8, 3, 1]);
      assert.equal(bound[5], 'Painful periods\nPain with intercourse');
      assert.equal(bound[6], 'Fatigue');
      assert.equal(bound[7], '');
      assert.equal(bound[8], 'instagram', 'user origin comes from the token record, not the request body');
      assert.equal(bound[9], 390);
      assert.equal(bound[10], 'Mobile');
      assert.equal(bound[11], 'https://rrmacademy.org/endo-survey/take/');
    } finally { stub.restore(); }
  });

  it('classifies device type from viewport width at the documented boundaries', async () => {
    const expectations = [[768, 'Mobile'], [769, 'Tablet'], [1024, 'Tablet'], [1025, 'Desktop']];
    const stub = stubExternalFetch();
    try {
      for (const [width, expected] of expectations) {
        const ctx = makeContext({ body: goodBody({ device: { viewport_width: width } }) });
        await run(ctx);
        const bound = symptomInsert(ctx.env).bound;
        assert.equal(bound[9], width);
        assert.equal(bound[10], expected, `viewport ${width} should classify as ${expected}`);
      }
    } finally { stub.restore(); }
  });

  it('stores null device fields when the viewport is absent or out of range', async () => {
    const stub = stubExternalFetch();
    try {
      for (const device of [undefined, { viewport_width: 0 }, { viewport_width: 10001 }, { viewport_width: 'wide' }]) {
        const ctx = makeContext({ body: goodBody({ device }) });
        await run(ctx);
        const bound = symptomInsert(ctx.env).bound;
        assert.equal(bound[9], null, `device ${JSON.stringify(device)} should not store a width`);
        assert.equal(bound[10], null);
      }
    } finally { stub.restore(); }
  });

  it('stores a null user_origin when the token carried none', async () => {
    const ctx = makeContext({ tokenRecord: { email: EMAIL, created: Date.now(), used: false } });
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      assert.equal(symptomInsert(ctx.env).bound[8], null);
    } finally { stub.restore(); }
  });

  it('strips the address from the KV token record once the identity link lands', async () => {
    const ctx = makeContext();
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      const record = ctx.env.SURVEY_TOKENS.read(`token:${TOKEN}`);
      assert.equal(record.used, true);
      assert.equal(typeof record.completedAt, 'number');
      assert.ok(!('email' in record), `the address must not remain in KV after the D1 link: ${JSON.stringify(record)}`);
      const finalPut = ctx.env.SURVEY_TOKENS.puts.at(-1);
      assert.equal(finalPut.opts.expirationTtl, TOKEN_TTL);
    } finally { stub.restore(); }
  });
});

describe('survey/submit -- rollback when the symptom write fails', () => {
  it('un-claims the token, restores the KV record and answers 502', async () => {
    const original = { email: EMAIL, created: 1738000000000, used: false, userorigin: 'instagram', utmSource: 'ig_bio' };
    const ctx = makeContext({
      tokenRecord: original,
      symptomsDbMap: { 'INSERT INTO survey_symptoms': { throws: 'D1_ERROR: no such table' } },
    });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 502);
      assert.equal(parsed.body.error, 'Failed to save results. Please try again.');

      // The D1 claim is released so the token is not permanently burned.
      const del = claimDelete(ctx.env);
      assert.ok(del, 'the token claim row must be deleted');
      assert.deepEqual(del.bound, [TOKEN]);

      // And KV is restored to the pre-submit record, byte for byte.
      assert.deepEqual(ctx.env.SURVEY_TOKENS.read(`token:${TOKEN}`), original);
      const restorePut = ctx.env.SURVEY_TOKENS.puts.at(-1);
      assert.equal(restorePut.opts.expirationTtl, TOKEN_TTL);

      // Nothing downstream ran: no identity row, no completion event.
      assert.equal(identityInsert(ctx.env), undefined);
      assert.equal(stub.ga4.length, 0, 'a dropped submission must not report survey_complete');
    } finally { stub.restore(); }
  });

  it('leaves the token usable so the same person can resubmit', async () => {
    const ctx = makeContext({ symptomsDbMap: { 'INSERT INTO survey_symptoms': { throws: 'D1_ERROR' } } });
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      const record = ctx.env.SURVEY_TOKENS.read(`token:${TOKEN}`);
      assert.equal(record.used, false, 'a rolled-back submission must not mark the link consumed');
      assert.equal(record.email, EMAIL, 'the identity must survive so the retry can still link');
    } finally { stub.restore(); }
  });
});

describe('survey/submit -- identity link failure is recoverable, not fatal', () => {
  it('keeps the symptom row, answers 200, and alerts the administrator', async () => {
    const ctx = makeContext({ surveyDbMap: { 'INSERT INTO survey_identities': { throws: 'D1_ERROR: database is locked' } } });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      // Clinical data already landed; failing the request would ask the person
      // to redo the survey and would double-write the symptom row.
      assert.equal(parsed.status, 200);
      assert.ok(symptomInsert(ctx.env), 'the symptom row stays');
      assert.equal(claimDelete(ctx.env), undefined, 'the claim is NOT rolled back on an identity failure');

      const alert = stub.ses[0];
      assert.ok(alert, 'an alert email must be sent so the orphan can be re-linked by hand');
      assert.deepEqual(alert.body.Destination.ToAddresses, ['administrator@rrmacademy.org']);
      assert.equal(alert.body.Content.Simple.Subject.Data, 'ALERT: Survey identity link failed');
      const text = alert.body.Content.Simple.Body.Text.Data;
      assert.ok(text.includes(symptomInsert(ctx.env).bound[0]), 'the alert must name the orphaned rec_id');
      assert.ok(!text.includes(EMAIL), 'the alert must not carry the address into the mail transport');
    } finally { stub.restore(); }
  });

  it('retains the address in KV when the identity link failed, so it can still be recovered', async () => {
    const ctx = makeContext({ surveyDbMap: { 'INSERT INTO survey_identities': { throws: 'D1_ERROR' } } });
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      const record = ctx.env.SURVEY_TOKENS.read(`token:${TOKEN}`);
      assert.equal(record.email, EMAIL, 'stripping here would strand the symptom row with no way back');
      assert.equal(record.used, true);
    } finally { stub.restore(); }
  });

  it('logs a failed alert send instead of throwing when SES is also down', async () => {
    const ctx = makeContext({ surveyDbMap: { 'INSERT INTO survey_identities': { throws: 'D1_ERROR' } } });
    const stub = stubExternalFetch({ ses: () => { throw new Error('SES unreachable'); } });
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 200);
      const failLog = ctx.env.SURVEY_DB._calls.find(c => c.sql.includes('INSERT INTO email_log') && c.bound[0] === 'failed');
      assert.ok(failLog, 'a failed alert must still be recorded in email_log');
      assert.equal(failLog.bound[3], 'survey/d1-alert');
    } finally { stub.restore(); }
  });
});

describe('survey/submit -- conversion reporting', () => {
  it('reports survey_complete and generate_lead with no health data attached', async () => {
    const ctx = makeContext();
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      const names = stub.ga4.map(c => c.body.events[0].name);
      assert.deepEqual(names.sort(), ['generate_lead', 'survey_complete']);
      const serialized = JSON.stringify(stub.ga4.map(c => c.body));
      for (const term of ['Painful periods', 'Fatigue', EMAIL]) {
        assert.ok(!serialized.includes(term), `"${term}" must never reach GA4`);
      }
      assert.ok(!/"value":\s*12/.test(serialized), 'the symptom score must never reach GA4');
    } finally { stub.restore(); }
  });

  it('adopts a valid GA4 identity override for the completion event', async () => {
    const cid = '3f2b1a4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c';
    const ctx = makeContext({ body: goodBody({ ga: { cid, sid: 1738000000, sn: 3 } }) });
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      const complete = stub.ga4.find(c => c.body.events[0].name === 'survey_complete');
      assert.equal(complete.body.client_id, cid);
      assert.equal(complete.body.events[0].params.session_id, 1738000000);
      assert.equal(complete.body.events[0].params.session_number, 3);
    } finally { stub.restore(); }
  });

  it('ignores a malformed GA4 identity override rather than failing the submission', async () => {
    const ctx = makeContext({ body: goodBody({ ga: { cid: 'not a cid!', sid: 'nope' } }) });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 200);
      const complete = stub.ga4.find(c => c.body.events[0].name === 'survey_complete');
      assert.notEqual(complete.body.client_id, 'not a cid!');
    } finally { stub.restore(); }
  });
});

describe('survey/submit -- unexpected failure', () => {
  it('answers a generic 500 without leaking the internal error', async () => {
    const ctx = makeContext();
    ctx.env.SURVEY_TOKENS.get = async () => { throw new Error('KV namespace unavailable'); };
    const parsed = await run(ctx);
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'An unexpected error occurred. Please try again.');
    assert.ok(!JSON.stringify(parsed.body).includes('KV namespace unavailable'));
  });
});

describe('survey/submit -- production defaults (no env override in play)', () => {
  it('falls back to the "unknown" rate-limit bucket when the edge sends no client IP', async () => {
    const communityKv = mockKVJson();
    const ctx = makeContext({ env: { COMMUNITY_KV: communityKv } });
    ctx.request = mockRequest('POST', { body: goodBody(), url: 'https://rrmacademy.org/api/survey/submit' });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 200);
      assert.ok(communityKv._store.has('rl:survey-submit:unknown'), `buckets: ${[...communityKv._store.keys()]}`);
    } finally { stub.restore(); }
  });

  it('stores an empty referrer rather than null when the request carries no Referer', async () => {
    const ctx = makeContext();
    ctx.request = mockRequest('POST', {
      body: goodBody(),
      url: 'https://rrmacademy.org/api/survey/submit',
      headers: { 'cf-connecting-ip': randomIp() },
    });
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      assert.equal(symptomInsert(ctx.env).bound[11], '');
    } finally { stub.restore(); }
  });
});
