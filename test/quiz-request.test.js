/**
 * functions/api/quiz/request.js -- the FABM method-match quiz API.
 *
 * The quiz ENGINE (src/lib) is already at 100% and safety-tested. This is the
 * route around it, and it is the part a user actually reaches: a correct engine
 * behind a broken route still produces a wrong or missing answer. Two things
 * here are worth more than the line count suggests:
 *   - research_consent. Every stored row is a research record, and the endpoint
 *     is supposed to refuse outright unless consent is an explicit true/1. A
 *     regression that coerced a truthy value would silently start collecting
 *     un-consented research data.
 *   - the email. The recommendation only exists for the user once it is sent,
 *     and the send is deliberately best-effort -- so the row must persist even
 *     when SES is down, and the failure must be logged rather than swallowed.
 *
 * SURVEY_DB is a real SQLite engine built from the committed rrm-survey
 * migrations (test/_survey-sqlite.mjs), so the nine-column INSERT is prepared
 * for real and a NOT NULL or column-name drift fails here.
 *
 * WHAT IS FAKED, AND WHAT IT CANNOT DISTINGUISH
 *  - Turnstile, EmailListVerify, DNS/MX and SES are stubbed by
 *    stubExternalFetch. What is proven is what this endpoint sends and how it
 *    reacts; nothing proves those services behave as the stub says.
 *  - Google Ads conversion upload is a genuine no-op because the
 *    GOOGLE_ADS_* secrets are absent -- which is the PRODUCTION-DEFAULT arm for
 *    any environment where the integration is not configured.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, stubExternalFetch, drainWaitUntil, randomIp } from './_helpers.js';
import { surveyD1 } from './_survey-sqlite.mjs';

const quizRequest = await import('../functions/api/quiz/request.js');

const VALID = {
  email: 'learner@example.com',
  primary: 'creighton',
  alternate: 'marquette',
  answers: { goal: 'avoid', cycles: 'regular' },
  researchConsent: true,
  turnstileToken: 'tok',
  rulesVersion: 'v2-1',
  answersCode: '123456789',
};

describe('POST /api/quiz/request', () => {
  let db, env, stub, waitUntil, events;

  beforeEach(() => {
    db = surveyD1();
    events = [];
    env = mockEnv({ SURVEY_DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    waitUntil = mockWaitUntil();
    stub = stubExternalFetch();
  });
  afterEach(() => stub.restore());

  const post = (body, { headers = {} } = {}) => quizRequest.onRequestPost({
    request: mockRequest('POST', {
      url: 'https://rrmacademy.org/api/quiz/request',
      body,
      headers: { 'cf-connecting-ip': randomIp(), ...headers },
    }),
    env, waitUntil,
  });

  const results = () => db._sqlite.prepare('SELECT * FROM quiz_result').all().map(r => ({ ...r }));

  // --- happy path -----------------------------------------------------------

  it('stores the result, returns its id, and emails the match', async () => {
    const { status, body } = await parseResponse(await post(VALID));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.match(body.id, /^[0-9a-f-]{36}$/);

    const rows = results();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, body.id);
    assert.equal(rows[0].email, 'learner@example.com');
    assert.equal(rows[0].primary_method, 'creighton');
    assert.equal(rows[0].alternate_method, 'marquette');
    assert.equal(rows[0].research_consent, 1);
    assert.equal(rows[0].source, 'fabm-quiz');
    assert.equal(rows[0].rules_version, 'v2-1');
    assert.deepEqual(JSON.parse(rows[0].answers), { goal: 'avoid', cycles: 'regular' });

    const [send] = stub.ses;
    assert.ok(send, 'no SES send was attempted');
    assert.match(send.body.Content.Simple.Subject.Data, /Creighton Model FertilityCare System/);
    assert.equal(send.body.Destination.ToAddresses[0], 'learner@example.com');
  });

  it('the email names the primary method, its referral body, and the alternate', async () => {
    await post(VALID);
    const text = stub.ses[0].body.Content.Simple.Body.Text.Data;
    assert.match(text, /Creighton Model FertilityCare System/);
    assert.match(text, /FertilityCare Centers of America/);
    assert.match(text, /https:\/\/www\.fertilitycare\.org\//);
    assert.match(text, /Also worth a look: Marquette Model/);
    assert.match(text, /results\/\?a=123456789/);
  });

  it('omits the alternate paragraph and the share link when neither was supplied', async () => {
    await post({ ...VALID, alternate: undefined, answersCode: undefined });
    const text = stub.ses[0].body.Content.Simple.Body.Text.Data;
    assert.ok(!/Also worth a look/.test(text));
    assert.ok(!/results\/\?a=/.test(text));
    assert.equal(results()[0].alternate_method, null);
  });

  it('drops an alternate that equals the primary rather than recommending it twice', async () => {
    await post({ ...VALID, alternate: 'creighton' });
    assert.equal(results()[0].alternate_method, null);
    assert.ok(!/Also worth a look/.test(stub.ses[0].body.Content.Simple.Body.Text.Data));
  });

  it('accepts every method key the quiz can produce', async () => {
    for (const primary of ['sdm', 'twoday', 'billings', 'creighton', 'femm', 'sensiplan', 'marquette']) {
      const { status } = await parseResponse(await post({ ...VALID, primary, alternate: undefined }));
      assert.equal(status, 200, `${primary} was rejected`);
    }
    assert.equal(results().length, 7);
    assert.equal(stub.ses.length, 7, 'a method key with no METHOD_EMAIL entry would silently skip the email');
  });

  // --- consent --------------------------------------------------------------

  it('refuses to store anything without explicit research consent', async () => {
    for (const researchConsent of [false, 0, undefined, null, 'true', 'yes', {}, []]) {
      const { status, body } = await parseResponse(await post({ ...VALID, researchConsent }));
      assert.equal(status, 400, `consent value ${JSON.stringify(researchConsent)} was accepted`);
      assert.equal(body.error, 'consent_required');
    }
    assert.deepEqual(results(), [], 'an un-consented submission was stored');
    assert.equal(stub.ses.length, 0);
  });

  it('accepts the integer 1 as consent as well as boolean true', async () => {
    const { status } = await parseResponse(await post({ ...VALID, researchConsent: 1 }));
    assert.equal(status, 200);
    assert.equal(results()[0].research_consent, 1);
  });

  // --- validation -----------------------------------------------------------

  it('503s when SURVEY_DB is unbound instead of dropping the submission', async () => {
    env = mockEnv({ SURVEY_DB: undefined });
    const { status, body } = await parseResponse(await post(VALID));
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
  });

  it('503s when the Turnstile secret is unset', async () => {
    env = mockEnv({ SURVEY_DB: db, CF_TURNSTILE_SECRET: undefined });
    const { status, body } = await parseResponse(await post(VALID));
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
    assert.deepEqual(results(), []);
  });

  it('429s once the per-IP window is exhausted', async () => {
    const ip = randomIp();
    for (let i = 0; i < 5; i++) {
      assert.equal((await parseResponse(await post(VALID, { headers: { 'cf-connecting-ip': ip } }))).status, 200);
    }
    const { status, body } = await parseResponse(await post(VALID, { headers: { 'cf-connecting-ip': ip } }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
    assert.equal(results().length, 5, 'the 6th submission was stored despite the rate limit');
  });

  it('checks the rate limit before the configuration guards', async () => {
    // Order matters: a misconfigured account must not become an unmetered
    // endpoint that answers 503 as fast as it is asked.
    env.SURVEY_DB = undefined;
    const ip = randomIp();
    for (let i = 0; i < 5; i++) {
      assert.equal((await parseResponse(await post(VALID, { headers: { 'cf-connecting-ip': ip } }))).status, 503);
    }
    const { status, body } = await parseResponse(await post(VALID, { headers: { 'cf-connecting-ip': ip } }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
  });

  it('400s on unparseable JSON and on non-object payloads', async () => {
    for (const [rawBody, expected] of [['{oops', 'invalid_json'], ['[]', 'invalid_payload'], ['null', 'invalid_payload']]) {
      const res = await quizRequest.onRequestPost({
        request: mockRequest('POST', {
          url: 'https://rrmacademy.org/api/quiz/request', rawBody,
          headers: { 'cf-connecting-ip': randomIp() },
        }),
        env, waitUntil,
      });
      assert.equal((await parseResponse(res)).body.error, expected);
    }
  });

  it('403s with a spam-check message when Turnstile rejects the token', async () => {
    stub.restore();
    stub = stubExternalFetch({ turnstile: () => ({ ok: true, json: async () => ({ success: false }) }) });
    const { status, body } = await parseResponse(await post(VALID));
    assert.equal(status, 403);
    assert.match(body.error, /Spam check failed/);
    assert.deepEqual(results(), []);
  });

  it('403s with a try-again message when Turnstile is unreachable', async () => {
    stub.restore();
    stub = stubExternalFetch({ turnstile: () => { throw new Error('network down'); } });
    const { status, body } = await parseResponse(await post(VALID));
    assert.equal(status, 403);
    assert.match(body.error, /Verification service unavailable/);
  });

  it('400s on a structurally invalid email, and surfaces a typo suggestion', async () => {
    const bad = await parseResponse(await post({ ...VALID, email: 'not-an-email' }));
    assert.equal(bad.status, 400);
    assert.ok(bad.body.error);

    const typo = await parseResponse(await post({ ...VALID, email: 'learner@gmial.com' }));
    assert.equal(typo.status, 400);
    assert.equal(typo.body.suggestion, 'learner@gmail.com');
    assert.deepEqual(results(), []);
  });

  it('stores the canonicalized email, not the raw one', async () => {
    await post({ ...VALID, email: '  Learner@Example.COM  ' });
    assert.equal(results()[0].email, 'learner@example.com');
  });

  it('400s on a primary method outside the allowlist', async () => {
    for (const primary of ['symptothermal', '', null, 7, 'CREIGHTON']) {
      const { status, body } = await parseResponse(await post({ ...VALID, primary }));
      assert.equal(status, 400, `primary ${JSON.stringify(primary)} was accepted`);
      assert.equal(body.error, 'invalid_primary_method');
    }
  });

  it('400s on an alternate outside the allowlist but tolerates the empty forms', async () => {
    const { status, body } = await parseResponse(await post({ ...VALID, alternate: 'nope' }));
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_alternate_method');

    for (const alternate of ['', null, undefined]) {
      assert.equal((await parseResponse(await post({ ...VALID, alternate }))).status, 200);
    }
  });

  it('400s when answers is an array, and tolerates null/undefined', async () => {
    assert.equal((await parseResponse(await post({ ...VALID, answers: ['a'] }))).body.error, 'invalid_answers');
    for (const answers of [null, undefined]) {
      const { status } = await parseResponse(await post({ ...VALID, answers }));
      assert.equal(status, 200);
    }
    assert.deepEqual(JSON.parse(results()[0].answers), {}, 'a missing answers object should store {}');
  });

  it('silently drops unknown answer keys but keeps the known ones', async () => {
    await post({ ...VALID, answers: { goal: 'avoid', ssn: '000-00-0000', device: 'none' } });
    assert.deepEqual(JSON.parse(results()[0].answers), { goal: 'avoid', device: 'none' });
  });

  it('400s at the entry-count cap and at the value-length cap', async () => {
    const tooMany = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, 'v']));
    assert.equal((await parseResponse(await post({ ...VALID, answers: tooMany }))).body.error, 'too_many_answer_entries');

    // Exactly 12 entries is allowed even though only the allowlisted keys survive.
    const exactlyTwelve = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, 'v']));
    assert.equal((await parseResponse(await post({ ...VALID, answers: exactlyTwelve }))).status, 200);

    assert.equal((await parseResponse(await post({ ...VALID, answers: { goal: 'x'.repeat(41) } }))).body.error, 'answer_value_too_long');
    assert.equal((await parseResponse(await post({ ...VALID, answers: { goal: 'x'.repeat(40) } }))).status, 200);
    assert.equal((await parseResponse(await post({ ...VALID, answers: { goal: 5 } }))).body.error, 'invalid_answer_value');
  });

  it('stores a malformed rulesVersion or answersCode as null rather than rejecting the submission', async () => {
    const { status } = await parseResponse(await post({ ...VALID, rulesVersion: 'NOT-A-VERSION', answersCode: '12345' }));
    assert.equal(status, 200, 'a bad metadata field must not lose the user their result');
    assert.equal(results()[0].rules_version, null);
    assert.ok(!/results\/\?a=/.test(stub.ses[0].body.Content.Simple.Body.Text.Data), 'a rejected answersCode still reached the email');
  });

  // --- side effects ---------------------------------------------------------

  it('hands the EmailListVerify tag to waitUntil so a hung ELV cannot stall the response', async () => {
    // The promise is CREATED synchronously, so "did the fetch start" proves
    // nothing about blocking. The property that matters is that the handler
    // never awaits it: with ELV hanging forever the user still gets their
    // result, and the row is still stored.
    stub.restore();
    stub = stubExternalFetch({ elv: () => new Promise(() => {}) });
    const { status, body } = await parseResponse(await post(VALID));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(results().length, 1);
    assert.ok(waitUntil.promises.length >= 1, 'nothing was handed to waitUntil');
  });

  it('runs the EmailListVerify tag exactly once per submission', async () => {
    await post(VALID);
    await drainWaitUntil(waitUntil);
    assert.equal(stub.calls.filter(c => c.service === 'elv').length, 1);
  });

  it('still succeeds when the out-of-band ELV call rejects', async () => {
    stub.restore();
    stub = stubExternalFetch({ elv: () => { throw new Error('elv down'); } });
    const { status } = await parseResponse(await post(VALID));
    assert.equal(status, 200);
    await drainWaitUntil(waitUntil);
    assert.equal(results().length, 1);
  });

  it('500s and logs when the insert fails, without leaking the SQL error', async () => {
    db._sqlite.exec('DROP TABLE quiz_result');
    const { status, body } = await parseResponse(await post(VALID));
    assert.equal(status, 500);
    assert.equal(body.error, 'server_error');
    assert.ok(!JSON.stringify(body).includes('no such table'));
    assert.ok(events.some(e => e.blobs.includes('db_insert_error')));
    assert.equal(stub.ses.length, 0, 'the email went out for a result that was never stored');
  });

  it('keeps the stored result and logs a failure row when SES rejects the send', async () => {
    stub.restore();
    stub = stubExternalFetch({ ses: () => { throw new Error('SES down'); } });
    const { status, body } = await parseResponse(await post(VALID));
    assert.equal(status, 200, 'a failed email must not lose the stored result');
    assert.equal(body.ok, true);
    assert.equal(results().length, 1);
    assert.ok(events.some(e => e.blobs.includes('email_send_error')));

    const failures = db._sqlite.prepare("SELECT event, source, email FROM email_log WHERE event = 'failed'").all().map(r => ({ ...r }));
    assert.deepEqual(failures, [{ event: 'failed', source: 'quiz/request', email: 'learner@example.com' }]);
  });

  it('survives a send failure that the failure log cannot record either', async () => {
    stub.restore();
    stub = stubExternalFetch({ ses: () => { throw new Error('SES down'); } });
    db._sqlite.exec('DROP TABLE email_log');
    const { status, body } = await parseResponse(await post(VALID));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(results().length, 1);
  });

  it('does not attempt a Google Ads upload when the integration is unconfigured', async () => {
    // The production default for any environment without GOOGLE_ADS_* secrets.
    await post(VALID);
    await drainWaitUntil(waitUntil);
    assert.equal(stub.calls.filter(c => /googleapis\.com/.test(c.url)).length, 0);
  });

  it('500s and logs generically when something outside the handled paths throws', async () => {
    const req = mockRequest('POST', { url: 'https://rrmacademy.org/api/quiz/request', body: VALID, headers: { 'cf-connecting-ip': randomIp() } });
    req.headers.get = () => { throw new Error('header bag exploded'); };
    const { status, body } = await parseResponse(await quizRequest.onRequestPost({ request: req, env, waitUntil }));
    assert.equal(status, 500);
    assert.equal(body.error, 'server_error');
    assert.ok(events.some(e => e.blobs.includes('request_fail')));
  });

  it('answers the preflight with 204 and the locked-down origin', async () => {
    const res = await quizRequest.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});
