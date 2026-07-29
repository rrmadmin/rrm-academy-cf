/**
 * functions/api/quiz/event.js -- the FABM quiz beacon collector.
 *
 * Every branch in this file answers 204. That is the whole difficulty: a beacon
 * caller never reads the body, so "validated and dropped", "rate limited",
 * "bot", "written", and "insert exploded" are indistinguishable from the
 * outside. A test that only asserts the status code asserts nothing at all.
 *
 * So every case here asserts the SIDE EFFECT instead: what landed in quiz_event,
 * and what did not. The database is a real SQLite engine built from the
 * committed rrm-survey migrations (test/_survey-sqlite.mjs), so the four-column
 * INSERT is genuinely prepared and a drifted column list fails here rather than
 * in production.
 *
 * WHAT IS FAKED
 *  - request.cf.asn is supplied by hand; the datacenter-ASN half of isBotRequest
 *    is exercised through it, but nothing proves Cloudflare populates it the way
 *    these tests assume.
 *  - KV is the in-memory stub, so the rate limiter's counting is exercised but
 *    not its cross-isolate behaviour.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockEnv, mockWaitUntil, randomIp } from './_helpers.js';
import { surveyD1 } from './_survey-sqlite.mjs';

const quizEvent = await import('../functions/api/quiz/event.js');

/** quiz/event.js reads the body with request.text(), and `cf` for the ASN. */
function beacon({ body, rawBody, ip = randomIp(), ua = 'Mozilla/5.0 (iPhone)', asn } = {}) {
  const headers = new Map([['cf-connecting-ip', ip], ['user-agent', ua]]);
  return {
    method: 'POST',
    url: 'https://rrmacademy.org/api/quiz/event',
    cf: asn === undefined ? undefined : { asn },
    headers: { get: (n) => headers.get(n.toLowerCase()) ?? null },
    async text() { return rawBody !== undefined ? rawBody : JSON.stringify(body); },
  };
}

describe('POST /api/quiz/event', () => {
  let db, env, rows;
  beforeEach(() => {
    db = surveyD1();
    env = mockEnv({ SURVEY_DB: db });
    // node:sqlite rows have a null prototype, which trips deepEqual.
    rows = () => db._sqlite.prepare('SELECT sid, event, qid, rules_version FROM quiz_event ORDER BY id').all().map(r => ({ ...r }));
  });

  const post = (req) => quizEvent.onRequestPost({ request: req, env, waitUntil: mockWaitUntil() });

  it('writes a valid beacon and answers 204 with the locked-down CORS origin', async () => {
    const res = await post(beacon({ body: { sid: 'abcd-1234-efgh', event: 'quiz_start' } }));
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
    assert.equal(await res.text(), '');
    assert.deepEqual(rows(), [{ sid: 'abcd-1234-efgh', event: 'quiz_start', qid: null, rules_version: null }]);
  });

  it('persists qid and rulesVersion when both are valid', async () => {
    await post(beacon({ body: { sid: 'abcd-1234-efgh', event: 'question_answer', qid: 'postpartum', rulesVersion: 'v2-1' } }));
    assert.deepEqual(rows(), [{ sid: 'abcd-1234-efgh', event: 'question_answer', qid: 'postpartum', rules_version: 'v2-1' }]);
  });

  it('accepts every event name on the allowlist', async () => {
    const events = ['gate_view', 'consent_checked', 'quiz_start', 'question_view', 'question_answer',
      'back_tap', 'result_view', 'print_tap', 'cta_click', 'start_over', 'submit_ok', 'submit_fail'];
    for (const event of events) await post(beacon({ body: { sid: 'abcdefgh', event } }));
    assert.deepEqual(rows().map(r => r.event), events);
  });

  it('drops an event name that is not on the allowlist', async () => {
    await post(beacon({ body: { sid: 'abcdefgh', event: 'quiz_started' } }));
    assert.deepEqual(rows(), []);
  });

  it('drops a qid that is not a known question, keeping the row out entirely', async () => {
    await post(beacon({ body: { sid: 'abcdefgh', event: 'question_view', qid: 'age' } }));
    assert.deepEqual(rows(), [], 'an unknown qid should reject the beacon, not be stored as null');
  });

  it('treats an empty qid or rulesVersion as absent rather than invalid', async () => {
    await post(beacon({ body: { sid: 'abcdefgh', event: 'quiz_start', qid: '', rulesVersion: '' } }));
    assert.deepEqual(rows(), [{ sid: 'abcdefgh', event: 'quiz_start', qid: null, rules_version: null }]);
  });

  it('drops a malformed rulesVersion', async () => {
    for (const rulesVersion of ['2', 'V2', 'v' + 'x'.repeat(33), 'v2!', 7]) {
      await post(beacon({ body: { sid: 'abcdefgh', event: 'quiz_start', rulesVersion } }));
    }
    assert.deepEqual(rows(), []);
  });

  it('enforces the sid format at both ends of the 8..64 range', async () => {
    await post(beacon({ body: { sid: 'a'.repeat(8), event: 'quiz_start' } }));
    await post(beacon({ body: { sid: 'a'.repeat(64), event: 'quiz_start' } }));
    assert.equal(rows().length, 2, 'the inclusive bounds of SID_RE were rejected');

    for (const sid of ['a'.repeat(7), 'a'.repeat(65), 'has space!', 'under_score', 42, null]) {
      await post(beacon({ body: { sid, event: 'quiz_start' } }));
    }
    assert.equal(rows().length, 2, 'an out-of-format sid was stored');
  });

  it('drops unparseable and non-object bodies', async () => {
    for (const rawBody of ['{oops', '[]', 'null', '"a string"', '']) {
      const res = await post(beacon({ rawBody }));
      assert.equal(res.status, 204);
    }
    assert.deepEqual(rows(), []);
  });

  it('ignores extra keys instead of rejecting the beacon', async () => {
    await post(beacon({ body: { sid: 'abcdefgh', event: 'quiz_start', email: 'x@y.com', answers: { a: 1 } } }));
    assert.deepEqual(rows(), [{ sid: 'abcdefgh', event: 'quiz_start', qid: null, rules_version: null }]);
  });

  it('short-circuits a declared crawler before any database write', async () => {
    const res = await post(beacon({ body: { sid: 'abcdefgh', event: 'quiz_start' }, ua: 'GPTBot/1.0' }));
    assert.equal(res.status, 204);
    assert.deepEqual(rows(), []);
    assert.equal(db._calls.length, 0, 'a bot request reached D1');
  });

  it('short-circuits a browser-UA crawl from a datacenter ASN', async () => {
    await post(beacon({ body: { sid: 'abcdefgh', event: 'quiz_start' }, ua: 'Mozilla/5.0 (Macintosh)', asn: 16509 }));
    assert.deepEqual(rows(), [], 'AWS-hosted traffic with a browser UA was counted');
  });

  it('does not treat a residential ASN as a bot', async () => {
    await post(beacon({ body: { sid: 'abcdefgh', event: 'quiz_start' }, ua: 'Mozilla/5.0 (Macintosh)', asn: 7922 }));
    assert.equal(rows().length, 1);
  });

  it('stops writing once the per-IP window is exhausted', async () => {
    const ip = randomIp();
    for (let i = 0; i < 121; i++) {
      await post(beacon({ body: { sid: 'abcdefgh', event: 'quiz_start' }, ip }));
    }
    assert.equal(rows().length, 120, 'the 120-per-minute beacon cap did not bind');
  });

  it('drops the write when KV is missing (checkRateLimit fails closed)', async () => {
    env = mockEnv({ SURVEY_DB: db, COMMUNITY_KV: undefined });
    const res = await post(beacon({ body: { sid: 'abcdefgh', event: 'quiz_start' } }));
    assert.equal(res.status, 204);
    assert.deepEqual(rows(), []);
  });

  it('answers 204 without touching D1 when SURVEY_DB is unbound', async () => {
    env = mockEnv({ SURVEY_DB: undefined });
    const res = await post(beacon({ body: { sid: 'abcdefgh', event: 'quiz_start' } }));
    assert.equal(res.status, 204);
    assert.equal(db._calls.length, 0);
  });

  it('logs and still answers 204 when the insert throws', async () => {
    const events = [];
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE quiz_event');
    const res = await post(beacon({ body: { sid: 'abcdefgh', event: 'quiz_start' } }));
    assert.equal(res.status, 204);
    assert.ok(events.some(e => e.blobs.includes('event_insert_error')), 'a lost beacon was not logged');
  });

  it('logs and still answers 204 when parsing the request itself throws', async () => {
    const events = [];
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    const req = beacon({ body: { sid: 'abcdefgh', event: 'quiz_start' } });
    req.headers.get = () => { throw new Error('header bag exploded'); };
    const res = await quizEvent.onRequestPost({ request: req, env, waitUntil: mockWaitUntil() });
    assert.equal(res.status, 204);
    assert.ok(events.some(e => e.blobs.includes('event_fail')));
  });

  it('answers the preflight with 204 and the locked-down origin', async () => {
    const res = await quizEvent.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});
