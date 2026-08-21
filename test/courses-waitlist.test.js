/**
 * functions/api/courses/waitlist.js -- the public waitlist capture for
 * affiliate courses that are not open yet.
 *
 * WHY A REAL ENGINE
 * This endpoint is a write path fronted by four gates (eligibility, two rate
 * limits, Turnstile, mailbox verification) and its outcome is three rows in
 * three tables. Every interesting claim is about a ROW:
 *   - the waitlist upsert is `ON CONFLICT(course_id, email) DO UPDATE SET
 *     user_id = COALESCE(course_waitlist.user_id, excluded.user_id),
 *     unsubscribed_at = NULL`, so a re-signup must not orphan an existing
 *     user_id and must un-unsubscribe. The `email TEXT COLLATE NOCASE` +
 *     UNIQUE(course_id, email) pair is what makes a differently-cased repeat a
 *     duplicate rather than a second row; a substring mock models neither.
 *   - the newsletter merge reads the existing segments array and only writes
 *     when the segment is absent.
 *   - `user_id` is bound ONLY when the session email matches the submitted
 *     email. That is the IDOR guard, and the assertion has to read the stored
 *     row to mean anything.
 * So the tests below assert on stored rows. Everything runs on node:sqlite
 * loaded with the committed schema (test/_d1-sqlite.mjs).
 *
 * WHAT IS STILL FAKED, AND WHAT IT CANNOT PROVE
 *  - Turnstile, EmailListVerify and GA4 are the stubExternalFetch router.
 *  - KV is the in-memory mockKV, so the rate limits are proven as counter
 *    behaviour inside one isolate, not as a global limit.
 *  - src/data/courses.json is the deterministic fixture from
 *    test/_json-module-hook.mjs, so course ELIGIBILITY here is fixture-given.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './_json-module-hook.mjs';
import {
  mockRequest, mockEnv, mockKV, mockWaitUntil, parseResponse, stubExternalFetch, drainWaitUntil, randomIp,
} from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

const waitlist = await import('../functions/api/courses/waitlist.js');

const COURSE = 'test-course-affiliate';
const USER = 'u_wl_user';
const OTHER = 'u_wl_other';
const RAW = { user: 'waitlist-session-user', other: 'waitlist-session-other' };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

async function seededDb(extra, opts = {}) {
  const db = sqliteD1({
    ...opts,
    seed(sqlite) {
      insertUser(sqlite, { id: USER, email: 'learner@example.com' });
      insertUser(sqlite, { id: OTHER, email: 'someone.else@example.com' });
      if (extra) extra(sqlite);
    },
  });
  await insertSession(db._sqlite, { rawId: RAW.user, userId: USER, expiresAt: FUTURE });
  await insertSession(db._sqlite, { rawId: RAW.other, userId: OTHER, expiresAt: FUTURE });
  return db;
}

/**
 * Inserts a session row keyed by the RAW cookie value, i.e. the pre-hash shape
 * that auth/_shared.js validateSession still dual-reads for legacy rows.
 *
 * This endpoint does its own session lookup with `WHERE s.id = ?` bound to the
 * raw cookie, so ONLY a row of this shape can ever match here (see the
 * DEFECT-marked tests below).
 */
function insertPlaintextSession(sqlite, { rawId, userId, expiresAt = FUTURE }) {
  sqlite.prepare('INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)').run(rawId, userId, expiresAt);
}

function waitlistRows(db) {
  return db._sqlite.prepare('SELECT * FROM course_waitlist ORDER BY email').all();
}

function subscriberRows(db) {
  return db._sqlite.prepare('SELECT * FROM newsletter_subscriber ORDER BY email').all();
}

/** One env per test group so the KV rate-limit buckets are shared on purpose. */
function makeEnv(db, over = {}) {
  return mockEnv({ DB: db, COMMUNITY_KV: mockKV(), ...over });
}

function request(body, { session, ip } = {}) {
  const headers = { 'CF-Connecting-IP': ip || randomIp() };
  if (session) headers.Cookie = `session=${session}`;
  return mockRequest('POST', {
    url: 'https://rrmacademy.org/api/courses/waitlist',
    headers,
    ...(typeof body === 'string' ? { rawBody: body } : { body }),
  });
}

async function submit(env, body, opts = {}) {
  const waitUntil = mockWaitUntil();
  const res = await waitlist.onRequestPost({ request: request(body, opts), env, waitUntil });
  await drainWaitUntil(waitUntil);
  return { ...(await parseResponse(res)), waitUntil };
}

const VALID = { courseId: COURSE, email: 'signup@example.com', turnstileToken: 'tok' };

describe('POST /api/courses/waitlist -- refusals', () => {
  let db;
  let net;
  let env;

  beforeEach(async () => {
    db = await seededDb();
    net = stubExternalFetch();
    env = makeEnv(db);
  });
  afterEach(() => { net.restore(); db.close(); });

  it('OPTIONS answers the CORS preflight', async () => {
    const res = await waitlist.onRequestOptions();
    assert.equal(res.status, 204);
  });

  it('503 when the DB binding is missing', async () => {
    const { status, body } = await submit(makeEnv(undefined, { DB: undefined }), VALID);
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
  });

  it('503 when Turnstile is not configured', async () => {
    const { status, body } = await submit(makeEnv(db, { CF_TURNSTILE_SECRET: undefined }), VALID);
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
    assert.equal(waitlistRows(db).length, 0);
  });

  it('400 on a body that is not JSON', async () => {
    const { status, body } = await submit(env, 'nope');
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_json');
  });

  it('400 with a field-named message on each missing or malformed field', async () => {
    const cases = [
      [{ email: 'a@example.com', turnstileToken: 't' }, 'courseId is required'],
      [{ courseId: COURSE, turnstileToken: 't' }, 'email is required'],
      [{ courseId: COURSE, email: 'a@example.com' }, 'turnstileToken is required'],
      [{ courseId: COURSE, email: 'not-an-email', turnstileToken: 't' }, 'email must be a valid email address'],
      [{ courseId: 'x'.repeat(101), email: 'a@example.com', turnstileToken: 't' }, 'courseId is too long (max 100 characters)'],
    ];
    for (const [payload, message] of cases) {
      const { status, body } = await submit(env, payload);
      assert.equal(status, 400, JSON.stringify(payload));
      assert.equal(body.error, message);
    }
    assert.equal(waitlistRows(db).length, 0);
  });

  it('400 for a course that is not in waitlist mode, before any external call', async () => {
    for (const courseId of ['test-course-free', 'test-course-affiliate-open', 'test-course-waitlisturl-only', 'no-such-course']) {
      const { status, body } = await submit(env, { ...VALID, courseId });
      assert.equal(status, 400, courseId);
      assert.equal(body.error, 'not_waitlist_course');
    }
    assert.equal(net.calls.length, 0, 'no Turnstile or ELV credits may be burned on an ineligible course');
    assert.equal(waitlistRows(db).length, 0);
  });

  it('403 when Turnstile rejects the token', async () => {
    net.restore();
    net = stubExternalFetch({ turnstile: () => ({ ok: true, json: async () => ({ success: false }) }) });
    const { status, body } = await submit(env, VALID);
    assert.equal(status, 403);
    assert.equal(body.error, 'spam_check_failed');
    assert.equal(waitlistRows(db).length, 0);
  });

  it('400 when the mailbox is rejected by verification', async () => {
    net.restore();
    net = stubExternalFetch({ elv: () => ({ ok: true, text: async () => 'disposable' }) });
    const { status, body } = await submit(env, VALID);
    assert.equal(status, 400);
    assert.equal(body.error, 'email_rejected');
    assert.equal(waitlistRows(db).length, 0, 'a rejected mailbox must not be stored');
  });

  it('checks the rate limit before the configuration guards', async () => {
    // Order matters: a misconfigured account must not become an unmetered
    // endpoint that answers 503 as fast as it is asked.
    const ip = randomIp();
    const misconfigured = makeEnv(undefined, { DB: undefined });
    for (let i = 1; i <= 10; i++) {
      const { status, body } = await submit(misconfigured, { ...VALID, email: `bot${i}@example.com` }, { ip });
      assert.equal(status, 503, `request ${i} must still be a config error`);
      assert.equal(body.error, 'service_unavailable');
    }
    const eleventh = await submit(misconfigured, { ...VALID, email: 'bot11@example.com' }, { ip });
    assert.equal(eleventh.status, 429, 'the 11th attempt from one IP must be rate-limited even while misconfigured');
    assert.equal(eleventh.body.error, 'rate_limited');
  });
});

describe('POST /api/courses/waitlist -- rate limits at their exact boundaries', () => {
  let db;
  let net;
  let env;

  beforeEach(async () => {
    db = await seededDb();
    net = stubExternalFetch();
    env = makeEnv(db);
  });
  afterEach(() => { net.restore(); db.close(); });

  it('the 10th request from an IP is served and the 11th is refused', async () => {
    const ip = '198.51.100.7';
    // The honeypot returns before the email limit, so these consume the IP
    // bucket only. That isolates the IP boundary from the email boundary.
    for (let i = 1; i <= 10; i++) {
      const { status, body } = await submit(env, { ...VALID, email: `bot${i}@example.com`, website: 'x' }, { ip });
      assert.equal(status, 200, `request ${i} must be served`);
      assert.deepEqual(body, { ok: true });
    }
    const eleventh = await submit(env, { ...VALID, email: 'bot11@example.com', website: 'x' }, { ip });
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.body.error, 'rate_limited');
  });

  it('a different IP has its own bucket', async () => {
    const ip = '198.51.100.8';
    for (let i = 1; i <= 10; i++) {
      await submit(env, { ...VALID, email: `bot${i}@example.com`, website: 'x' }, { ip });
    }
    assert.equal((await submit(env, { ...VALID, website: 'x' }, { ip })).status, 429);
    assert.equal((await submit(env, { ...VALID, website: 'x' }, { ip: '198.51.100.9' })).status, 200);
  });

  it('the 3rd signup for one email is served and the 4th is refused', async () => {
    const email = 'repeat@example.com';
    for (let i = 1; i <= 3; i++) {
      const { status } = await submit(env, { ...VALID, email }, { ip: `198.51.100.${100 + i}` });
      assert.equal(status, 200, `signup ${i} must be served`);
    }
    const fourth = await submit(env, { ...VALID, email }, { ip: '198.51.100.199' });
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.error, 'rate_limited');
    assert.equal(waitlistRows(db).length, 1, 'three accepted signups are still one waitlist row');
  });

  it('a missing KV binding fails CLOSED at the first limit', async () => {
    const { status, body } = await submit(makeEnv(db, { COMMUNITY_KV: undefined }), VALID);
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
    assert.equal(waitlistRows(db).length, 0);
  });

  it('the honeypot answers 200 and stores nothing, but is logged as a block', async () => {
    const events = [];
    const honeypotEnv = makeEnv(db, { EVENTS: { writeDataPoint: (p) => events.push(p) } });
    const { status, body } = await submit(honeypotEnv, { ...VALID, website: 'https://spam.example' });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true }, 'a bot must not be able to tell it was caught');
    assert.equal(waitlistRows(db).length, 0);
    assert.equal(net.calls.length, 0, 'the honeypot short-circuits before Turnstile');
    assert.ok(events.some((e) => e.blobs.includes('waitlist_honeypot')));
  });
});

describe('POST /api/courses/waitlist -- what gets stored', () => {
  let db;
  let net;
  let env;

  beforeEach(async () => {
    db = await seededDb();
    net = stubExternalFetch();
    env = makeEnv(db);
  });
  afterEach(() => { net.restore(); db.close(); });

  it('stores the waitlist row, a newsletter subscriber and a contact tag', async () => {
    const { status, body } = await submit(env, VALID);
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });

    const [row] = waitlistRows(db);
    assert.equal(row.course_id, COURSE);
    assert.equal(row.email, 'signup@example.com');
    assert.equal(row.user_id, null, 'an anonymous signup carries no user id');
    assert.equal(row.unsubscribed_at, null);

    const [sub] = subscriberRows(db);
    assert.equal(sub.email, 'signup@example.com');
    assert.equal(sub.status, 'active');
    assert.equal(sub.source, `waitlist-${COURSE}`);
    assert.deepEqual(JSON.parse(sub.segments), [`waitlist:${COURSE}`]);

    const tag = db._sqlite.prepare("SELECT * FROM contact_tag WHERE source = 'waitlist'").get();
    assert.ok(tag, 'the CRM contact must be tagged with the waitlist segment');
    assert.equal(tag.tag, `waitlist:${COURSE}`);
  });

  it('reports a new signup to GA4 and logs it, once', async () => {
    const events = [];
    const gaEnv = makeEnv(db, { EVENTS: { writeDataPoint: (p) => events.push(p) } });
    await submit(gaEnv, VALID);

    assert.equal(net.ga4.length, 1);
    const event = net.ga4[0].body.events[0];
    assert.equal(event.name, 'generate_lead');
    assert.equal(event.params.lead_source, 'course_waitlist');
    assert.deepEqual(event.params.items, [{ item_name: `Course: ${COURSE}` }]);
    assert.ok(events.some((e) => e.blobs.includes('waitlist_signup')));
  });

  it('DEFECT: a repeat signup stores one row but is still counted as a NEW lead', async () => {
    // Step 11 of the handler intends to "gate analytics on actual new
    // insertion" via `results[0].meta.changes > 0`. SQLite counts an
    // `ON CONFLICT ... DO UPDATE` as a change even when every assigned column
    // keeps its value, and this upsert has no WHERE on the DO UPDATE, so
    // `changes` is 1 on a duplicate exactly as it is on an insert.
    //
    // Consequence: `wasNew` is ALWAYS true here. Every repeat signup fires a
    // second generate_lead to GA4 and logs waitlist_signup, and the
    // waitlist_duplicate branch never runs. This test pins the behaviour that
    // ships today; it is not an endorsement of it.
    const events = [];
    const dupEnv = makeEnv(db, { EVENTS: { writeDataPoint: (p) => events.push(p) } });
    await submit(dupEnv, VALID);
    const ga4AfterFirst = net.ga4.length;
    assert.equal(ga4AfterFirst, 1);

    await submit(dupEnv, VALID);

    assert.equal(waitlistRows(db).length, 1, 'the database is right: still one person');
    assert.equal(net.ga4.length, 2, 'the analytics gate is wrong: the duplicate is counted again');
    assert.equal(events.filter((e) => e.blobs.includes('waitlist_signup')).length, 2);
    assert.equal(events.filter((e) => e.blobs.includes('waitlist_duplicate')).length, 0);
  });

  it('a differently-cased email is the same person (COLLATE NOCASE on the unique key)', async () => {
    await submit(env, { ...VALID, email: 'Signup@Example.com' });
    await submit(env, { ...VALID, email: 'signup@example.com' });
    const rows = waitlistRows(db);
    assert.equal(rows.length, 1, 'case must not create a second waitlist row');
    assert.equal(rows[0].email, 'signup@example.com', 'validateBody lowercases before the write');
  });

  it('a re-signup clears unsubscribed_at and keeps the existing user_id', async () => {
    db._sqlite.prepare(
      "INSERT INTO course_waitlist (id, course_id, email, user_id, unsubscribed_at) VALUES ('cw1', ?, 'learner@example.com', ?, '2026-05-05')"
    ).run(COURSE, USER);

    await submit(env, { ...VALID, email: 'learner@example.com' });

    const [row] = waitlistRows(db);
    assert.equal(row.unsubscribed_at, null, 'a re-signup must re-subscribe');
    assert.equal(row.user_id, USER, 'COALESCE must preserve the linked account');
  });

  it('DEFECT: a current (hashed) session never links the signup to the account', async () => {
    // auth/_shared.js stores session ids as their SHA-256 hash and
    // validateSession hashes the cookie before looking it up. This endpoint
    // does its own lookup and binds the RAW cookie value:
    //     WHERE s.id = ? ... .bind(sessionId)
    // so it can only ever match a legacy plaintext row. For every session
    // issued by the current login flow the lookup misses, userId stays null,
    // and both the account link and the blocked-account 403 below are dead.
    await submit(env, { ...VALID, email: 'learner@example.com' }, { session: RAW.user });
    const [row] = waitlistRows(db);
    assert.equal(row.email, 'learner@example.com');
    assert.equal(row.user_id, null, 'a hashed session cannot be resolved by this endpoint');
  });

  it('a legacy plaintext session does link the signup to the account', async () => {
    insertPlaintextSession(db._sqlite, { rawId: 'legacy-plaintext-session', userId: USER });
    await submit(env, { ...VALID, email: 'learner@example.com' }, { session: 'legacy-plaintext-session' });
    const [row] = waitlistRows(db);
    assert.equal(row.user_id, USER);
  });

  it('IDOR: a session is never bound to a foreign email address', async () => {
    insertPlaintextSession(db._sqlite, { rawId: 'legacy-plaintext-session', userId: USER });
    await submit(env, { ...VALID, email: 'victim@example.com' }, { session: 'legacy-plaintext-session' });
    const [row] = waitlistRows(db);
    assert.equal(row.email, 'victim@example.com');
    assert.equal(row.user_id, null, 'the session must not be bound to a foreign email');
  });

  it('the session email match is case-insensitive on the account side', async () => {
    db._sqlite.prepare('UPDATE user SET email = ? WHERE id = ?').run('Learner@Example.com', USER);
    insertPlaintextSession(db._sqlite, { rawId: 'legacy-plaintext-session', userId: USER });
    await submit(env, { ...VALID, email: 'learner@example.com' }, { session: 'legacy-plaintext-session' });
    const [row] = waitlistRows(db);
    assert.equal(row.user_id, USER);
  });

  it('an expired session row is not resolved', async () => {
    insertPlaintextSession(db._sqlite, { rawId: 'legacy-expired', userId: USER, expiresAt: 1 });
    await submit(env, { ...VALID, email: 'learner@example.com' }, { session: 'legacy-expired' });
    assert.equal(waitlistRows(db)[0].user_id, null);
  });

  it('403 for a blocked account, and nothing is stored', async () => {
    db._sqlite.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run(USER);
    insertPlaintextSession(db._sqlite, { rawId: 'legacy-plaintext-session', userId: USER });
    const { status, body } = await submit(env, { ...VALID, email: 'learner@example.com' }, { session: 'legacy-plaintext-session' });
    assert.equal(status, 403);
    assert.equal(body.error, 'forbidden');
    assert.equal(waitlistRows(db).length, 0);
  });

  it('an unknown session cookie is ignored rather than fatal', async () => {
    const { status } = await submit(env, VALID, { session: 'not-a-real-session' });
    assert.equal(status, 200);
    assert.equal(waitlistRows(db)[0].user_id, null);
  });

  it('an existing subscriber gains the segment without losing the ones they had', async () => {
    db._sqlite.prepare(
      "INSERT INTO newsletter_subscriber (id, email, status, source, segments) VALUES ('n1', 'signup@example.com', 'unsubscribed', 'import', ?)"
    ).run(JSON.stringify(['general']));

    await submit(env, VALID);

    const [sub] = subscriberRows(db);
    assert.deepEqual(JSON.parse(sub.segments), ['general', `waitlist:${COURSE}`]);
    assert.equal(sub.status, 'unsubscribed', 'the waitlist must not resurrect a newsletter unsubscribe');
    assert.equal(subscriberRows(db).length, 1);
  });

  it('an existing subscriber who already has the segment is not written again', async () => {
    db._sqlite.prepare(
      "INSERT INTO newsletter_subscriber (id, email, status, source, segments) VALUES ('n1', 'signup@example.com', 'active', 'import', ?)"
    ).run(JSON.stringify([`waitlist:${COURSE}`]));

    await submit(env, VALID);

    assert.equal(
      db._calls.filter((c) => c.sql.includes('UPDATE newsletter_subscriber')).length,
      0,
      'no redundant UPDATE may be issued',
    );
    assert.deepEqual(JSON.parse(subscriberRows(db)[0].segments), [`waitlist:${COURSE}`]);
  });

  it('a subscriber row with an unreadable segments column falls back to a fresh list', async () => {
    db._sqlite.prepare(
      "INSERT INTO newsletter_subscriber (id, email, status, source, segments) VALUES ('n1', 'signup@example.com', 'active', 'import', NULL)"
    ).run();

    await submit(env, VALID);

    assert.deepEqual(JSON.parse(subscriberRows(db)[0].segments), [`waitlist:${COURSE}`]);
  });

  it('a segments column holding the JSON literal null also falls back to a fresh list', async () => {
    // The merge is `JSON.parse(existingSub.segments || '[]') || []`. A NULL
    // column takes the first default; the string "null" parses cleanly to null
    // and can only be caught by the SECOND one. Without it, `segs.includes`
    // throws and the whole signup 500s on a row that is merely untidy.
    db._sqlite.prepare(
      "INSERT INTO newsletter_subscriber (id, email, status, source, segments) VALUES ('n1', 'signup@example.com', 'active', 'import', 'null')"
    ).run();

    const { status } = await submit(env, VALID);

    assert.equal(status, 200);
    assert.deepEqual(JSON.parse(subscriberRows(db)[0].segments), [`waitlist:${COURSE}`]);
    assert.equal(waitlistRows(db).length, 1);
  });

  it('a request with no CF-Connecting-IP header rate-limits under the "unknown" bucket', async () => {
    // Production default arm. Every rate-limit key on this endpoint is built
    // from that header, so if the fallback were dropped the key would become
    // `waitlist-ip:null` and still work by accident. What proves the default is
    // that the bucket is SHARED: two header-less requests must land in the same
    // counter, which is what makes the limit hold for a client that strips it.
    const headless = mockRequest('POST', {
      url: 'https://rrmacademy.org/api/courses/waitlist',
      headers: {},
      body: { ...VALID, website: 'x' },
    });
    const wu = mockWaitUntil();
    const res = await waitlist.onRequestPost({ request: headless, env, waitUntil: wu });
    await drainWaitUntil(wu);
    assert.equal((await parseResponse(res)).status, 200);

    const kvKeys = [];
    const spyEnv = makeEnv(db);
    spyEnv.COMMUNITY_KV = {
      get: async (k) => { kvKeys.push(k); return null; },
      put: async () => {},
    };
    const second = mockRequest('POST', {
      url: 'https://rrmacademy.org/api/courses/waitlist',
      headers: {},
      body: { ...VALID, website: 'x' },
    });
    await waitlist.onRequestPost({ request: second, env: spyEnv, waitUntil: mockWaitUntil() });
    assert.ok(
      kvKeys.some((k) => k.includes('waitlist-ip:unknown')),
      `the header-less bucket must be keyed "unknown", saw ${JSON.stringify(kvKeys)}`,
    );
  });

  it('with mailbox verification unconfigured the signup still lands, without a contact tag', async () => {
    const noElv = makeEnv(db, { ELV_API_KEY: undefined });
    const events = [];
    noElv.EVENTS = { writeDataPoint: (p) => events.push(p) };

    const { status } = await submit(noElv, VALID);

    assert.equal(status, 200);
    assert.equal(waitlistRows(db).length, 1);
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM contact_tag').get().n, 0);
    assert.ok(events.some((e) => e.blobs.includes('waitlist_contact_missing')), 'the missing contact id is logged');
  });
});

describe('POST /api/courses/waitlist -- database failures', () => {
  let net;

  beforeEach(() => { net = stubExternalFetch(); });
  afterEach(() => net.restore());

  it('a failing session lookup does not stop the signup', async () => {
    const db = await seededDb(undefined, {
      interleave({ sql }) {
        if (sql.includes('FROM session s JOIN user u')) throw new Error('D1_ERROR: session read failed');
      },
    });
    const { status } = await submit(makeEnv(db), { ...VALID, email: 'learner@example.com' }, { session: RAW.user });
    assert.equal(status, 200);
    const [row] = waitlistRows(db);
    assert.equal(row.user_id, null, 'without the session read the row is stored unlinked');
    db.close();
  });

  it('a failing newsletter lookup falls through to the insert path', async () => {
    const db = await seededDb(undefined, {
      interleave({ sql }) {
        if (sql.includes('SELECT id, status, segments FROM newsletter_subscriber')) {
          throw new Error('D1_ERROR: newsletter read failed');
        }
      },
    });
    const { status } = await submit(makeEnv(db), VALID);
    assert.equal(status, 200);
    assert.equal(subscriberRows(db).length, 1);
    db.close();
  });

  it('a failing write batch becomes a logged 500 and stores nothing', async () => {
    const events = [];
    const db = await seededDb(undefined, {
      interleave({ sql }) {
        if (sql.includes('INSERT INTO course_waitlist')) throw new Error('D1_ERROR: write failed');
      },
    });
    const { status, body } = await submit(makeEnv(db, { EVENTS: { writeDataPoint: (p) => events.push(p) } }), VALID);
    assert.equal(status, 500);
    assert.equal(body.error, 'server_error');
    assert.equal(waitlistRows(db).length, 0);
    assert.ok(events.some((e) => e.blobs.includes('waitlist_error')));
    db.close();
  });

  it('the write batch is atomic: a later statement failing rolls the waitlist row back', async () => {
    const db = await seededDb(undefined, {
      interleave({ sql }) {
        if (sql.includes('INSERT INTO newsletter_subscriber')) throw new Error('D1_ERROR: second statement failed');
      },
    });
    const { status } = await submit(makeEnv(db), VALID);
    assert.equal(status, 500);
    assert.equal(waitlistRows(db).length, 0, 'the batch must not leave a half-written signup behind');
    db.close();
  });
});

describe('POST /api/courses/waitlist -- arms the engine cannot reach on its own', () => {
  let db;
  let net;

  beforeEach(async () => { db = await seededDb(); net = stubExternalFetch(); });
  afterEach(() => { net.restore(); db.close(); });

  /**
   * The step-8 `catch` around verifyAndTagEmail is the endpoint's only mapping
   * from "mailbox verification blew up" to a 500 with the waitlist_elv_error
   * taxonomy, and onRequestPost has no outer try, so deleting that catch turns
   * this input into an unhandled rejection rather than a response.
   *
   * It cannot be reached by breaking the network: functions/api/_elv.js is
   * TOTAL over its own body. verifyEmailELV wraps every fetch, parse and
   * timeout in try/catch and fails open; verifyAndTagEmail wraps every D1 write
   * in try/catch and swallows it; even its logging call has its own try. The
   * two reads that sit OUTSIDE any try are `env.ELV_API_KEY` (_elv.js:46) and
   * `env.DB` (_elv.js:82), so a throwing binding read is the only lever there
   * is. `env.ELV_API_KEY` is the one waitlist.js itself never touches, which is
   * why the throw lands inside the helper and nowhere else.
   *
   * Worth stating plainly: under a plain-object `env` (what workerd hands a
   * Pages Function) this arm is dead code. That is a finding, not a licence to
   * leave the branch unpinned.
   */
  it('a rejecting mailbox-verification helper is a logged 500 that stores nothing', async () => {
    const events = [];
    const env = makeEnv(db, { EVENTS: { writeDataPoint: (p) => events.push(p) } });
    Object.defineProperty(env, 'ELV_API_KEY', {
      configurable: true,
      get() { throw new Error('ELV binding unavailable'); },
    });

    const { status, body } = await submit(env, VALID);

    assert.equal(status, 500);
    assert.equal(body.error, 'server_error');
    assert.equal(waitlistRows(db).length, 0, 'a failed verification must not leave a signup behind');
    assert.equal(subscriberRows(db).length, 0);
    assert.ok(
      events.some((e) => e.blobs.includes('waitlist_elv_error')),
      'the failure must be logged under its own taxonomy, not the generic write error',
    );
    assert.ok(!events.some((e) => e.blobs.includes('waitlist_error')), 'this is not the write-batch failure');
  });

  /**
   * The duplicate arm (step 11's `else`). The DEFECT test above pins the fact
   * that SQLite -- and therefore D1 -- reports `changes = 1` for this upsert
   * even when the DO UPDATE assigns every column its existing value, so no
   * input reaches this branch through the engine today. What the branch is
   * written against is the VALUE it reads, `results[0].meta.changes`, so that
   * is what this drives: a batch that reports zero rows written must log
   * waitlist_duplicate and must NOT report a second lead to GA4.
   *
   * This is the arm that becomes live the moment anyone adds a `WHERE` to the
   * DO UPDATE to fix the defect, which is exactly when a silently-broken
   * duplicate path would start double-counting in reverse.
   */
  it('a batch reporting zero rows written logs a duplicate and sends no lead event', async () => {
    const events = [];
    const zeroChangeDb = {
      _sqlite: db._sqlite,
      _calls: db._calls,
      prepare: (sql) => db.prepare(sql),
      close: () => db.close(),
      async batch(stmts) {
        const out = await db.batch(stmts);
        // Report the first statement as a no-op write; leave the rest, and the
        // rows themselves, exactly as the engine wrote them.
        out[0] = { ...out[0], meta: { ...out[0].meta, changes: 0, rows_written: 0 } };
        return out;
      },
    };
    const env = makeEnv(zeroChangeDb, { EVENTS: { writeDataPoint: (p) => events.push(p) } });

    const { status, body } = await submit(env, VALID);

    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(waitlistRows(db).length, 1, 'the row is still written; only the reported count changed');
    assert.ok(events.some((e) => e.blobs.includes('waitlist_duplicate')), 'the duplicate must be logged');
    assert.ok(!events.some((e) => e.blobs.includes('waitlist_signup')), 'a duplicate is not a new signup');
    assert.equal(net.ga4.length, 0, 'a duplicate must not be counted as a new lead');
  });
});
