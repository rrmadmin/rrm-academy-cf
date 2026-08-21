/**
 * functions/api/endo-quiz/request.js -- the Google Ads landing counterpart to
 * the organic endometriosis survey. 0/224 lines before this file: nothing
 * anywhere imported it.
 *
 * This is part of the national survey system whose totals back federal grant
 * claims, so the things worth the most here are the ones that decide whether a
 * submission is countable and whether it is safe to hold:
 *
 *   1. THE PSEUDONYMIZATION SPLIT. Symptoms and scores go to
 *      SURVEY_SYMPTOMS_DB (rrm-survey-symptoms) keyed by an opaque rec_id; the
 *      address goes to SURVEY_DB (rrm-survey) survey_identities. The two are
 *      SEPARATE SQLite engines here, so "no address reached the symptom store"
 *      is a fact about the store rather than a restatement of a fixture. A
 *      single shared fake cannot fail that assertion.
 *   2. THE SYMPTOM WRITE IS THE TRANSACTION. If it fails the request is a 500
 *      and NO identity row is written, so a stored address never points at a
 *      record that does not exist. If the identity write fails afterwards the
 *      submission still counts, an alert email goes out, and the orphan is
 *      recoverable by rec_id -- that asymmetry is deliberate and is asserted in
 *      both directions.
 *   3. CONSENT. Every stored row is a research record. researchConsent must be
 *      an explicit true or 1; anything else is refused before either write.
 *
 * Both databases run on node:sqlite. survey_symptoms is built from its
 * COMMITTED migration (scripts/migrations/2026-06-26-survey-symptoms.sql), so
 * the 14-column INSERT is prepared for real and a NOT NULL or column-name
 * drift fails here instead of 500ing in production.
 *
 * WHAT IS FAKED, AND WHAT IT CANNOT DISTINGUISH
 *  - Turnstile, EmailListVerify, DNS/MX, SES and GA4 are stubbed by
 *    stubExternalFetch. What is proven is what this endpoint sends and how it
 *    reacts to each answer; nothing here proves those services behave that way.
 *  - survey_identities has no committed migration; its DDL is transcribed from
 *    the plan doc that created it (see test/_survey-sqlite.mjs).
 *  - The Google Ads conversion upload is a genuine no-op because the
 *    GOOGLE_ADS_* secrets are absent, which is the PRODUCTION-DEFAULT arm for
 *    any environment where the integration is not configured.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mockRequest, mockEnv, mockWaitUntil, parseResponse, stubExternalFetch, drainWaitUntil, randomIp,
} from './_helpers.js';
import { surveyD1, symptomsD1 } from './_survey-sqlite.mjs';
import { sqliteD1 } from './_d1-sqlite.mjs';

const endoQuiz = await import('../functions/api/endo-quiz/request.js');

const VALID = {
  email: 'taker@example.com',
  score: { tier1: 30, tier2: 20, tier3: 4, total: 54 },
  symptoms: {
    tier1: ['pain with periods', 'pain with sex'],
    tier2: ['fatigue'],
    tier3: ['bloating'],
  },
  band: 'high',
  researchConsent: true,
  turnstileToken: 'tok',
};

describe('POST /api/endo-quiz/request', () => {
  let symptomsDb, surveyDb, authDb, env, waitUntil, stub, events;

  beforeEach(() => {
    symptomsDb = symptomsD1();
    surveyDb = surveyD1();
    authDb = sqliteD1();
    events = [];
    env = mockEnv({ SURVEY_DB: surveyDb, SURVEY_SYMPTOMS_DB: symptomsDb, DB: authDb });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    waitUntil = mockWaitUntil();
    stub = stubExternalFetch();
  });
  afterEach(() => stub.restore());

  /** Runs the handler and settles its fire-and-forget work (ELV tag, GA4, alert email). */
  async function post(body, { headers = {}, rawBody, context = {} } = {}) {
    const res = await endoQuiz.onRequestPost({
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/endo-quiz/request',
        body,
        rawBody,
        headers: { 'cf-connecting-ip': randomIp(), ...headers },
      }),
      env,
      waitUntil,
      ...context,
    });
    await drainWaitUntil(waitUntil);
    return parseResponse(res);
  }

  const symptomRows = () => symptomsDb._sqlite.prepare('SELECT * FROM survey_symptoms').all().map(r => ({ ...r }));
  const identityRows = () => surveyDb._sqlite.prepare('SELECT * FROM survey_identities').all().map(r => ({ ...r }));
  const emailLog = () => surveyDb._sqlite.prepare('SELECT * FROM email_log').all().map(r => ({ ...r }));
  const actions = () => events.map(e => e.blobs[2]);

  // --- preflight -----------------------------------------------------------

  describe('CORS preflight', () => {
    it('answers OPTIONS with 204 and the locked-down origin', async () => {
      const res = await endoQuiz.onRequestOptions();
      assert.equal(res.status, 204);
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
    });
  });

  // --- configuration guards ------------------------------------------------

  describe('configuration guards', () => {
    it('503s when the identity database is not bound', async () => {
      env.SURVEY_DB = undefined;
      const { status, body } = await post(VALID);
      assert.equal(status, 503);
      assert.deepEqual(body, { error: 'service_unavailable' });
      assert.equal(symptomRows().length, 0, 'symptoms were stored with nowhere to link the identity');
      assert.equal(stub.calls.length, 0, 'a misconfigured endpoint still called out');
    });

    it('503s when the symptom database is not bound', async () => {
      env.SURVEY_SYMPTOMS_DB = undefined;
      const { status, body } = await post(VALID);
      assert.equal(status, 503);
      assert.deepEqual(body, { error: 'service_unavailable' });
      assert.equal(identityRows().length, 0, 'an address was stored with nowhere to put the symptoms');
    });

    it('503s when the Turnstile secret is absent rather than accepting unverified traffic', async () => {
      env.CF_TURNSTILE_SECRET = undefined;
      const { status, body } = await post(VALID);
      assert.equal(status, 503);
      assert.deepEqual(body, { error: 'service_unavailable' });
      assert.equal(symptomRows().length, 0);
    });
  });

  // --- rate limiting -------------------------------------------------------

  describe('rate limiting', () => {
    it('allows five submissions from one IP and refuses the sixth', async () => {
      const ip = randomIp();
      for (let i = 0; i < 5; i++) {
        const { status } = await post({ ...VALID, email: `taker${i}@example.com` }, { headers: { 'cf-connecting-ip': ip } });
        assert.equal(status, 200, `submission ${i + 1} should have been accepted`);
      }
      const { status, body } = await post({ ...VALID, email: 'six@example.com' }, { headers: { 'cf-connecting-ip': ip } });
      assert.equal(status, 429);
      assert.deepEqual(body, { error: 'rate_limited' });
      assert.equal(symptomRows().length, 5, 'the refused submission was still written');
    });

    it('keeps separate buckets per IP', async () => {
      const ip = randomIp();
      for (let i = 0; i < 5; i++) {
        await post({ ...VALID, email: `taker${i}@example.com` }, { headers: { 'cf-connecting-ip': ip } });
      }
      const { status } = await post({ ...VALID, email: 'other@example.com' }, { headers: { 'cf-connecting-ip': randomIp() } });
      assert.equal(status, 200);
    });

    it('fails CLOSED with 429 when the rate-limit KV namespace is missing', async () => {
      env.COMMUNITY_KV = undefined;
      const { status, body } = await post(VALID);
      assert.equal(status, 429);
      assert.deepEqual(body, { error: 'rate_limited' });
    });

    it('buckets by the literal "unknown" when the client IP header is absent', async () => {
      // PRODUCTION DEFAULT, PINNED BY VALUE. Cloudflare sets cf-connecting-ip
      // on real traffic, so `|| 'unknown'` is the arm a direct or internal
      // caller takes. "They share a bucket" alone does NOT pin it -- an empty
      // string, or any other constant, shares a bucket too. So the counter is
      // seeded under the exact key the literal produces and the handler is
      // asked to honour it: a full `rl:endo-quiz:unknown` bucket must be the
      // one an IP-less request lands in, and it must touch no other key.
      const kv = env.COMMUNITY_KV;
      const keysTouched = [];
      env.COMMUNITY_KV = {
        get: (k) => { keysTouched.push(k); return kv.get(k); },
        put: (k, v, o) => { keysTouched.push(k); return kv.put(k, v, o); },
      };
      await kv.put('rl:endo-quiz:unknown', JSON.stringify({ count: 5, start: Math.floor(Date.now() / 1000) }));

      const seeded = await endoQuiz.onRequestPost({
        request: mockRequest('POST', { url: 'https://rrmacademy.org/api/endo-quiz/request', body: { ...VALID, email: 'anon0@example.com' } }),
        env, waitUntil,
      });
      await drainWaitUntil(waitUntil);
      assert.equal(seeded.status, 429, 'a full "rl:endo-quiz:unknown" bucket did not govern an IP-less request');
      assert.deepEqual([...new Set(keysTouched)], ['rl:endo-quiz:unknown'],
        'the IP-less bucket key is not the literal "unknown"');
      assert.equal(symptomRows().length, 0, 'a rate-limited submission was still written');
    });

    it('shares that one bucket across every IP-less request', async () => {
      // The other half of the default: distinct (unstated) clients are not
      // each given their own allowance, so the sixth is refused.
      const noIp = { headers: {}, };
      for (let i = 0; i < 5; i++) {
        const res = await endoQuiz.onRequestPost({
          request: mockRequest('POST', { url: 'https://rrmacademy.org/api/endo-quiz/request', body: { ...VALID, email: `anon${i}@example.com` }, ...noIp }),
          env, waitUntil,
        });
        assert.equal(res.status, 200, `submission ${i + 1} should have been accepted`);
      }
      await drainWaitUntil(waitUntil);
      const res = await endoQuiz.onRequestPost({
        request: mockRequest('POST', { url: 'https://rrmacademy.org/api/endo-quiz/request', body: { ...VALID, email: 'anon6@example.com' }, ...noIp }),
        env, waitUntil,
      });
      assert.equal(res.status, 429);
    });

    it('checks the rate limit before the configuration guards', async () => {
      // Order matters: a misconfigured account must not become an unmetered
      // endpoint that answers 503 as fast as it is asked.
      env.SURVEY_DB = undefined;
      const ip = randomIp();
      for (let i = 0; i < 5; i++) {
        const { status } = await post(VALID, { headers: { 'cf-connecting-ip': ip } });
        assert.equal(status, 503);
      }
      const { status, body } = await post(VALID, { headers: { 'cf-connecting-ip': ip } });
      assert.equal(status, 429);
      assert.deepEqual(body, { error: 'rate_limited' });
    });
  });

  // --- payload validation --------------------------------------------------

  describe('payload validation', () => {
    it('rejects a body that is not JSON', async () => {
      const { status, body } = await post(undefined, { rawBody: '{"email": ' });
      assert.equal(status, 400);
      assert.deepEqual(body, { error: 'invalid_json' });
    });

    it('rejects a JSON array payload', async () => {
      const { status, body } = await post(undefined, { rawBody: '[{"email":"a@b.com"}]' });
      assert.equal(status, 400);
      assert.deepEqual(body, { error: 'invalid_payload' });
    });

    it('rejects a JSON null payload', async () => {
      const { status, body } = await post(undefined, { rawBody: 'null' });
      assert.equal(status, 400);
      assert.deepEqual(body, { error: 'invalid_payload' });
    });

    it('rejects a JSON scalar payload', async () => {
      const { status, body } = await post(undefined, { rawBody: '"just-a-string"' });
      assert.equal(status, 400);
      assert.deepEqual(body, { error: 'invalid_payload' });
    });
  });

  // --- spam check ----------------------------------------------------------

  describe('Turnstile', () => {
    it('403s with the spam-check message when siteverify rejects the token', async () => {
      stub.restore();
      stub = stubExternalFetch({ turnstile: () => ({ ok: true, json: async () => ({ success: false }) }) });
      const { status, body } = await post(VALID);
      assert.equal(status, 403);
      assert.match(body.error, /Spam check failed/);
      assert.equal(symptomRows().length, 0, 'a rejected submission was still stored');
    });

    it('403s with the try-again message when siteverify is unreachable', async () => {
      stub.restore();
      stub = stubExternalFetch({ turnstile: () => { throw new Error('ECONNRESET'); } });
      const { status, body } = await post(VALID);
      assert.equal(status, 403);
      assert.match(body.error, /Verification service unavailable/);
    });

    it('403s when no token was supplied at all', async () => {
      const { status, body } = await post({ ...VALID, turnstileToken: undefined });
      assert.equal(status, 403);
      assert.match(body.error, /Spam check failed/);
      assert.equal(stub.calls.filter(c => c.service === 'turnstile').length, 0, 'a missing token still hit siteverify');
    });
  });

  // --- email validation ----------------------------------------------------

  describe('email validation', () => {
    it('rejects a structurally invalid address before any store is touched', async () => {
      const { status, body } = await post({ ...VALID, email: 'not-an-email' });
      assert.equal(status, 400);
      assert.match(body.error, /valid email address/);
      assert.equal(symptomRows().length, 0);
      assert.equal(identityRows().length, 0);
    });

    it('rejects a missing address', async () => {
      const { status, body } = await post({ ...VALID, email: undefined });
      assert.equal(status, 400);
      assert.match(body.error, /required/i);
    });

    it('returns the did-you-mean suggestion alongside the error for a typo domain', async () => {
      const { status, body } = await post({ ...VALID, email: 'taker@gmial.com' });
      assert.equal(status, 400);
      assert.equal(body.suggestion, 'taker@gmail.com');
      assert.match(body.error, /Did you mean/);
    });

    it('omits the suggestion key when the validator has no correction to offer', async () => {
      const { status, body } = await post({ ...VALID, email: 'taker@mailinator.com' });
      assert.equal(status, 400);
      assert.equal('suggestion' in body, false, 'a suggestion key was invented for a disposable address');
    });

    it('stores the normalised lowercase address, not what was typed', async () => {
      await post({ ...VALID, email: '  TAKER@Example.COM  ' });
      assert.equal(identityRows()[0].email, 'taker@example.com');
    });
  });

  // --- band ----------------------------------------------------------------

  describe('band validation', () => {
    for (const [label, band] of [
      ['a missing band', undefined],
      ['a non-string band', 3],
      ['an unrecognised band', 'catastrophic'],
      ['an empty band', ''],
    ]) {
      it(`rejects ${label}`, async () => {
        const { status, body } = await post({ ...VALID, band });
        assert.equal(status, 400);
        assert.deepEqual(body, { error: 'invalid_band' });
        assert.equal(symptomRows().length, 0);
      });
    }
  });

  // --- score ---------------------------------------------------------------

  describe('score validation', () => {
    for (const [label, score] of [
      ['a non-object score', 54],
      ['a null score', null],
      ['an array score', [30, 20, 4]],
      ['a missing tier', { tier1: 30, tier2: 20, total: 54 }],
      ['a non-numeric tier', { tier1: '30', tier2: 20, tier3: 4, total: 54 }],
      ['a NaN tier', { tier1: NaN, tier2: 20, tier3: 4, total: 54 }],
      ['a negative tier', { tier1: -1, tier2: 20, tier3: 4, total: 54 }],
      ['tier1 above its 45-point ceiling', { tier1: 46, tier2: 20, tier3: 4, total: 54 }],
      ['tier2 above its 30-point ceiling', { tier1: 30, tier2: 31, tier3: 4, total: 54 }],
      ['tier3 above its 6-point ceiling', { tier1: 30, tier2: 20, tier3: 7, total: 54 }],
      ['a total above 81', { tier1: 30, tier2: 20, tier3: 4, total: 82 }],
    ]) {
      it(`rejects ${label}`, async () => {
        const { status, body } = await post({ ...VALID, score });
        assert.equal(status, 400);
        assert.deepEqual(body, { error: 'invalid_score' });
        assert.equal(symptomRows().length, 0);
      });
    }

    it('accepts the ceiling values themselves', async () => {
      const { status } = await post({ ...VALID, score: { tier1: 45, tier2: 30, tier3: 6, total: 81 } });
      assert.equal(status, 200);
      assert.equal(symptomRows()[0].score_total, 81);
    });

    it('accepts an all-zero score', async () => {
      const { status } = await post({ ...VALID, band: 'none', score: { tier1: 0, tier2: 0, tier3: 0, total: 0 } });
      assert.equal(status, 200);
      assert.equal(symptomRows()[0].score_total, 0);
    });
  });

  // --- symptoms ------------------------------------------------------------

  describe('symptom validation', () => {
    const s = (over) => ({ tier1: [], tier2: [], tier3: [], ...over });

    for (const [label, symptoms] of [
      ['a non-object symptoms bag', 'pain'],
      ['a null symptoms bag', null],
      ['an array symptoms bag', [['pain']]],
      ['a missing tier list', { tier1: ['pain'], tier2: ['fatigue'] }],
      ['a non-array tier list', s({ tier2: 'fatigue' })],
      ['a non-string symptom', s({ tier1: [{ text: 'pain' }] })],
    ]) {
      it(`rejects ${label}`, async () => {
        const { status, body } = await post({ ...VALID, symptoms });
        assert.equal(status, 400);
        assert.deepEqual(body, { error: 'invalid_symptoms' });
        assert.equal(symptomRows().length, 0);
      });
    }

    it('rejects a tier1 list longer than the 15 items the quiz can produce', async () => {
      const { status, body } = await post({ ...VALID, symptoms: s({ tier1: Array(16).fill('pain') }) });
      assert.equal(status, 400);
      assert.deepEqual(body, { error: 'invalid_symptoms' });
    });

    it('rejects a tier3 list longer than its own 6-item cap', async () => {
      const { status, body } = await post({ ...VALID, symptoms: s({ tier3: Array(7).fill('bloating') }) });
      assert.equal(status, 400);
      assert.deepEqual(body, { error: 'invalid_symptoms' });
    });

    it('accepts a tier3 list at exactly its cap, proving the caps are per tier', async () => {
      const { status } = await post({ ...VALID, symptoms: s({ tier3: Array(6).fill('bloating') }) });
      assert.equal(status, 200);
      assert.equal(symptomRows()[0].tier3_symptoms.split('\n').length, 6);
    });

    it('rejects a symptom string over 200 characters', async () => {
      const { status, body } = await post({ ...VALID, symptoms: s({ tier2: ['x'.repeat(201)] }) });
      assert.equal(status, 400);
      assert.deepEqual(body, { error: 'invalid_symptoms' });
    });

    it('accepts a symptom string at exactly 200 characters', async () => {
      const { status } = await post({ ...VALID, symptoms: s({ tier2: ['x'.repeat(200)] }) });
      assert.equal(status, 200);
      assert.equal(symptomRows()[0].tier2_symptoms.length, 200);
    });
  });

  // --- consent -------------------------------------------------------------

  describe('research consent', () => {
    for (const [label, researchConsent] of [
      ['absent', undefined],
      ['false', false],
      ['the string "true"', 'true'],
      ['the number 0', 0],
      ['the string "1"', '1'],
    ]) {
      it(`refuses when consent is ${label}, storing nothing`, async () => {
        const { status, body } = await post({ ...VALID, researchConsent });
        assert.equal(status, 400);
        assert.deepEqual(body, { error: 'consent_required' });
        assert.equal(symptomRows().length, 0, 'an un-consented research record was stored');
        assert.equal(identityRows().length, 0);
      });
    }

    it('accepts the numeric 1 as explicit consent', async () => {
      const { status } = await post({ ...VALID, researchConsent: 1 });
      assert.equal(status, 200);
      assert.equal(symptomRows().length, 1);
    });
  });

  // --- the split -----------------------------------------------------------

  describe('the pseudonymization split', () => {
    it('writes symptoms to one database and the address to the other, joined by rec_id', async () => {
      const { status, body } = await post(VALID);
      assert.equal(status, 200);
      assert.deepEqual(body, { ok: true });

      const [symptom] = symptomRows();
      const [identity] = identityRows();
      assert.ok(symptom, 'nothing reached the symptom store');
      assert.ok(identity, 'nothing reached the identity store');
      assert.match(symptom.rec_id, /^[0-9a-f-]{36}$/);
      assert.equal(identity.airtable_record_id, symptom.rec_id, 'the two halves cannot be rejoined');
      assert.equal(identity.email, 'taker@example.com');
      assert.equal(identity.source, 'endo-quiz-ads');
    });

    it('puts no address anywhere in the symptom database', async () => {
      await post(VALID);
      const dumped = JSON.stringify(symptomRows());
      assert.equal(dumped.includes('taker@example.com'), false, 'the address reached the symptom store');
      assert.equal(dumped.includes('@'), false, 'something address-shaped reached the symptom store');
      const symptomSql = symptomsDb._calls.map(c => c.sql).join(' ');
      assert.equal(/email/i.test(symptomSql), false, 'an email column was named in a symptom-store statement');
      for (const call of symptomsDb._calls) {
        for (const bound of call.bound) {
          assert.equal(typeof bound === 'string' && bound.includes('@'), false, `bound an address-shaped value: ${bound}`);
        }
      }
    });

    it('stores no symptom text in the identity database', async () => {
      await post(VALID);
      const dumped = JSON.stringify(identityRows());
      assert.equal(dumped.includes('pain with periods'), false, 'symptom text reached the identity store');
    });

    it('tags the submission source as ads, distinguishing it from the organic survey', async () => {
      await post(VALID);
      assert.equal(symptomRows()[0].source, 'ads');
      assert.equal(identityRows()[0].source, 'endo-quiz-ads');
    });

    it('stores the per-tier scores and the newline-joined symptom lists', async () => {
      await post(VALID);
      const [row] = symptomRows();
      assert.equal(row.score_total, 54);
      assert.equal(row.score_tier1, 30);
      assert.equal(row.score_tier2, 20);
      assert.equal(row.score_tier3, 4);
      assert.equal(row.tier1_symptoms, 'pain with periods\npain with sex');
      assert.equal(row.tier2_symptoms, 'fatigue');
      assert.equal(row.tier3_symptoms, 'bloating');
      assert.equal(row.user_origin, null);
    });

    it('gives every submission its own rec_id', async () => {
      await post(VALID);
      await post({ ...VALID, email: 'second@example.com' });
      const ids = symptomRows().map(r => r.rec_id);
      assert.equal(new Set(ids).size, 2, 'two submissions shared a rec_id');
    });
  });

  // --- device + referrer ---------------------------------------------------

  describe('device and referrer capture', () => {
    for (const [width, expected] of [[375, 'Mobile'], [768, 'Mobile'], [769, 'Tablet'], [1024, 'Tablet'], [1025, 'Desktop'], [1440, 'Desktop']]) {
      it(`classifies a ${width}px viewport as ${expected}`, async () => {
        await post({ ...VALID, device: { viewport_width: width } });
        const [row] = symptomRows();
        assert.equal(row.viewport_width, width);
        assert.equal(row.device_type, expected);
      });
    }

    for (const [label, device] of [
      ['no device object', undefined],
      ['a null device object', null],
      ['a non-numeric width', { viewport_width: '375' }],
      ['a zero width', { viewport_width: 0 }],
      ['a negative width', { viewport_width: -100 }],
      ['an absurd width', { viewport_width: 10001 }],
      ['a NaN width', { viewport_width: NaN }],
    ]) {
      it(`stores no viewport or device type for ${label}`, async () => {
        await post({ ...VALID, device });
        const [row] = symptomRows();
        assert.equal(row.viewport_width, null);
        assert.equal(row.device_type, null);
      });
    }

    it('accepts the 10000px boundary', async () => {
      await post({ ...VALID, device: { viewport_width: 10000 } });
      assert.equal(symptomRows()[0].viewport_width, 10000);
    });

    it('records the referring page, and an empty string when there is none', async () => {
      await post(VALID, { headers: { referer: 'https://rrmacademy.org/endo-quiz/' } });
      assert.equal(symptomRows()[0].referrer, 'https://rrmacademy.org/endo-quiz/');

      await post({ ...VALID, email: 'second@example.com' });
      assert.equal(symptomRows()[1].referrer, '');
    });
  });

  // --- the results email ---------------------------------------------------

  describe('the results email', () => {
    it('sends the score breakdown to the taker and logs the send', async () => {
      await post(VALID);
      const [send] = stub.ses;
      assert.ok(send, 'no SES send was attempted');
      assert.equal(send.body.Destination.ToAddresses[0], 'taker@example.com');
      assert.equal(send.body.Content.Simple.Subject.Data, 'Your endometriosis symptom quiz results');
      assert.equal(send.body.FromEmailAddress, 'RRM Academy <info@mail.rrmacademy.org>');

      const text = send.body.Content.Simple.Body.Text.Data;
      assert.match(text, /Your score: 54 out of 81/);
      assert.match(text, /Tier 1 \(very high suspicion\): 30 \/ 45/);
      assert.match(text, /Tier 2 \(high suspicion\): 20 \/ 30/);
      assert.match(text, /Tier 3 \(suspicion\): 4 \/ 6/);
      assert.match(text, /rrmacademy\.org\/providers\//);

      const sent = emailLog().find(r => r.event === 'send');
      assert.ok(sent, 'the send was not written to email_log');
      assert.equal(sent.email, 'taker@example.com');
      assert.equal(sent.source, 'endo-quiz/request');
      assert.equal(sent.category, 'transactional');
    });

    for (const [band, phrase] of [
      ['high', /strong pattern of symptoms/],
      ['moderate', /across more than one category/],
      ['low', /a few symptoms that research associates/],
      ['none', /did not include symptoms commonly associated/],
    ]) {
      it(`writes the ${band}-band paragraph`, async () => {
        await post({ ...VALID, band });
        const text = stub.ses[0].body.Content.Simple.Body.Text.Data;
        assert.match(text, phrase);
      });
    }

    it('never claims the quiz is a diagnosis on the two highest bands', async () => {
      for (const band of ['high', 'moderate']) {
        stub.restore();
        stub = stubExternalFetch();
        await post({ ...VALID, band, email: `${band}@example.com` });
        assert.match(stub.ses[0].body.Content.Simple.Body.Text.Data, /not a diagnosis/);
      }
    });

    it('still answers 200 when SES rejects the send, and records the failure', async () => {
      stub.restore();
      // A 4xx, not a 5xx: aws4fetch retries 5xx with backoff, so a 554 here
      // would spend ~22 seconds inside the SES client before the assertion.
      stub = stubExternalFetch({ ses: () => ({ ok: false, status: 400, text: async () => 'Message rejected' }) });
      const { status, body } = await post(VALID);
      assert.equal(status, 200);
      assert.deepEqual(body, { ok: true });

      assert.equal(symptomRows().length, 1, 'a failed email discarded the submission');
      assert.equal(identityRows().length, 1);
      assert.ok(actions().includes('email_send_error'), 'the send failure was not logged');
      const failed = emailLog().find(r => r.event === 'failed');
      assert.ok(failed, 'no failure row was written to email_log');
      assert.equal(failed.email, 'taker@example.com');
      assert.equal(failed.source, 'endo-quiz/request');
    });
  });

  // --- downstream beacons --------------------------------------------------

  describe('conversion beacons', () => {
    it('fires a GA4 generate_lead tagged to the ads quiz', async () => {
      await post(VALID);
      const [beacon] = stub.ga4;
      assert.ok(beacon, 'no GA4 event was sent');
      const event = beacon.body.events[0];
      assert.equal(event.name, 'generate_lead');
      assert.equal(event.params.lead_source, 'endo_quiz_ads');
      assert.equal(event.params.page_location, 'https://rrmacademy.org/endo-quiz/results/');
    });

    it('sends no GA4 beacon on a rejected submission', async () => {
      await post({ ...VALID, band: 'nonsense' });
      assert.equal(stub.ga4.length, 0);
    });

    it('uploads no Google Ads conversion when the integration is unconfigured', async () => {
      // PRODUCTION DEFAULT: GOOGLE_ADS_* are absent from mockEnv, which is the
      // arm every environment without the secrets takes. A regression that
      // dropped the guard would show up as an unrouted datamanager call.
      await post(VALID, { headers: { Cookie: 'gclid=abcdefghijklmno' } });
      assert.equal(stub.calls.some(c => c.url.includes('datamanager.googleapis.com')), false);
      assert.equal(stub.calls.some(c => c.url.includes('oauth2.googleapis.com')), false);
    });

    it('tags the address as a contact in the CRM database, separate from both survey stores', async () => {
      await post(VALID);
      const contact = authDb._sqlite.prepare('SELECT * FROM contact WHERE email = ?').get('taker@example.com');
      assert.ok(contact, 'the ELV verify-and-tag pass did not upsert a contact');
      assert.equal(contact.source, 'endo-quiz-ads');
    });
  });

  // --- write failures ------------------------------------------------------

  describe('write failures', () => {
    it('500s and writes NO identity row when the symptom insert fails', async () => {
      symptomsDb._sqlite.exec('DROP TABLE survey_symptoms');
      const { status, body } = await post(VALID);
      assert.equal(status, 500);
      assert.deepEqual(body, { error: 'server_error' });
      assert.equal(identityRows().length, 0, 'an address was kept for a record that was never stored');
      assert.ok(actions().includes('symptom_write_dropped'), 'the dropped write was not logged');
      assert.equal(stub.ses.length, 0, 'a results email was sent for a submission that was not stored');
    });

    it('leaks no SQL detail to the client when the symptom insert fails', async () => {
      symptomsDb._sqlite.exec('DROP TABLE survey_symptoms');
      const { body } = await post(VALID);
      assert.equal(JSON.stringify(body).includes('survey_symptoms'), false);
    });

    it('still answers 200 and alerts an administrator when the identity write fails', async () => {
      surveyDb._sqlite.exec('DROP TABLE survey_identities');
      const { status, body } = await post(VALID);
      assert.equal(status, 200);
      assert.deepEqual(body, { ok: true });

      const [row] = symptomRows();
      assert.ok(row, 'the symptom record was rolled back when only the identity write failed');
      assert.ok(actions().includes('d1_identity_write_error'), 'the identity failure was not logged');

      const alert = stub.ses.find(c => c.body.Destination.ToAddresses[0] === 'administrator@rrmacademy.org');
      assert.ok(alert, 'no alert was sent for an orphaned symptom record');
      assert.equal(alert.body.Content.Simple.Subject.Data, 'ALERT: endo-quiz identity link failed');
      assert.match(alert.body.Content.Simple.Body.Text.Data, new RegExp(`rec_id: ${row.rec_id}`));
    });

    it('keeps the address out of the Analytics Engine record of the identity failure', async () => {
      surveyDb._sqlite.exec('DROP TABLE survey_identities');
      await post(VALID);
      const event = events.find(e => e.blobs[2] === 'd1_identity_write_error');
      assert.ok(event);
      assert.equal(event.blobs.join(' ').includes('taker@example.com'), false);
      assert.match(event.blobs[4], /D1 write failed: record=[0-9a-f-]{36}/);
    });

    it('records an alert-email failure rather than losing it silently', async () => {
      surveyDb._sqlite.exec('DROP TABLE survey_identities');
      stub.restore();
      stub = stubExternalFetch({ ses: () => { throw new Error('SES down'); } });
      const { status } = await post(VALID);
      assert.equal(status, 200);
      assert.ok(actions().includes('d1_alert_email_failed'), 'the failed alert was not logged');
      const failed = emailLog().find(r => r.event === 'failed' && r.email === 'administrator@rrmacademy.org');
      assert.ok(failed, 'no failure row was written for the undeliverable alert');
      assert.equal(failed.subject, 'ALERT: endo-quiz identity link failed');
    });

    it('answers 500 rather than crashing when the platform throws outside every guarded write', async () => {
      // waitUntil is the one call in the happy path with no try/catch around
      // it, and CF Pages does throw from it (documented in functions/api/_log.js:
      // "waitUntil(void) throws in Pages Functions"). This is what the outer
      // catch is for.
      const res = await endoQuiz.onRequestPost({
        request: mockRequest('POST', {
          url: 'https://rrmacademy.org/api/endo-quiz/request',
          body: VALID,
          headers: { 'cf-connecting-ip': randomIp() },
        }),
        env,
        waitUntil: () => { throw new TypeError('Invalid argument passed to waitUntil'); },
      });
      const { status, body } = await parseResponse(res);
      assert.equal(status, 500);
      assert.deepEqual(body, { error: 'server_error' });
      assert.ok(actions().includes('request_fail'), 'the unexpected failure was not logged');
    });
  });
});
