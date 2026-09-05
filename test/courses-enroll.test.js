/**
 * functions/api/courses/enroll.js -- the enrolment endpoint, free and paid.
 *
 * WHY A REAL ENGINE
 * Every consequential decision here is a row, not a response field:
 *   - "already enrolled" is `SELECT ... WHERE user_id = ? AND course_id = ? AND
 *     revoked_at IS NULL`, and the guarantee is that a second POST does not
 *     create a second row. That is the UNIQUE(user_id, course_id) index doing
 *     the work, which a substring mock cannot model at all.
 *   - enrollUser's UPSERT has a CASE expression that clears revoked_at ONLY
 *     when a NEW stripe_payment_intent arrives. The free path passes null, so
 *     an admin-revoked learner must NOT get access back by clicking Enrol.
 *     That is the single most security-relevant line in the file and it is
 *     pure SQL.
 *   - included-course rows use INSERT OR IGNORE, not the UPSERT, so a revoked
 *     included course stays revoked.
 * So the assertions below read the STORED enrolment rows. The response shape is
 * checked too, but it is never the proof.
 *
 * WHAT IS STILL FAKED, AND WHAT IT CANNOT PROVE
 *  - Stripe, SES, GA4 and Turnstile come from test/_helpers.js
 *    stubExternalFetch. "A checkout session was created" means "a POST to
 *    /v1/checkout/sessions was issued with this form body".
 *  - KV is the in-memory mockKV, so the 10-second Stripe lock is proven as
 *    counter behaviour, not as a distributed lock.
 *  - src/data/courses.json is the deterministic fixture from
 *    test/_json-module-hook.mjs; catalogue SHAPE is given, never proven.
 *  - The idempotency replay test uses a genuine Request so request.clone()
 *    works. It proves the wrapper is wired into this endpoint; the wrapper's
 *    own matrix lives with _idempotency.js.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './_json-module-hook.mjs';
import {
  mockRequest, mockEnv, mockWaitUntil, parseResponse, stubExternalFetch, stripeRoutes, drainWaitUntil,
} from './_helpers.js';
import { sqliteD1, insertUser, insertSession, insertLabel } from './_d1-sqlite.mjs';

const enroll = await import('../functions/api/courses/enroll.js');

const LEARNER = 'u_enroll_learner';
const MEMBER = 'u_enroll_member';
const RAW = { learner: 'enroll-session-learner', member: 'enroll-session-member' };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_fixture';

async function seededDb(extra) {
  const db = sqliteD1({
    seed(sqlite) {
      insertUser(sqlite, { id: LEARNER, email: 'learner@example.com', name: 'Ada Learner' });
      insertUser(sqlite, { id: MEMBER, email: 'member@example.com', name: 'Mo Member' });
      // The grandfather label is the explicit, non-payment membership grant.
      insertLabel(sqlite, MEMBER, 'STUC Legacy Grandfather');
      if (extra) extra(sqlite);
    },
  });
  await insertSession(db._sqlite, { rawId: RAW.learner, userId: LEARNER, expiresAt: FUTURE });
  await insertSession(db._sqlite, { rawId: RAW.member, userId: MEMBER, expiresAt: FUTURE });
  return db;
}

function rows(db, userId = LEARNER) {
  return db._sqlite.prepare('SELECT * FROM enrollment WHERE user_id = ? ORDER BY course_id').all(userId);
}

function post(db, body, { session = RAW.learner, env: envOver = {}, cookieExtra = '', waitUntil } = {}) {
  const cookie = session === null ? cookieExtra : `session=${session}${cookieExtra}`;
  const headers = cookie ? { Cookie: cookie, 'CF-Connecting-IP': '203.0.113.9' } : { 'CF-Connecting-IP': '203.0.113.9' };
  const request = mockRequest('POST', {
    url: 'https://rrmacademy.org/api/courses/enroll',
    headers,
    ...(typeof body === 'string' ? { rawBody: body } : { body }),
  });
  const wu = waitUntil || mockWaitUntil();
  const ctx = { request, env: mockEnv({ DB: db, ...envOver }), waitUntil: wu };
  return { ctx, promise: enroll.onRequestPost(ctx), waitUntil: wu };
}

async function run(db, body, opts = {}) {
  const { promise, waitUntil, ctx } = post(db, body, opts);
  const res = await promise;
  await drainWaitUntil(waitUntil);
  return { ...(await parseResponse(res)), waitUntil, env: ctx.env };
}

describe('POST /api/courses/enroll -- rejections before any write', () => {
  let db;
  let net;

  beforeEach(async () => { db = await seededDb(); net = stubExternalFetch(); });
  afterEach(() => { net.restore(); db.close(); });

  it('OPTIONS answers the CORS preflight', async () => {
    const res = await enroll.onRequestOptions();
    assert.equal(res.status, 204);
  });

  it('500 when the DB binding is missing', async () => {
    const request = mockRequest('POST', {
      url: 'https://rrmacademy.org/api/courses/enroll',
      headers: { Cookie: `session=${RAW.learner}` },
      body: { courseId: 'test-course-free' },
    });
    const res = await enroll.onRequestPost({ request, env: mockEnv({ DB: undefined }), waitUntil: mockWaitUntil() });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('401 without a session', async () => {
    const { status, body } = await run(db, { courseId: 'test-course-free' }, { session: null });
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
    assert.equal(rows(db).length, 0);
  });

  it('400 on a body that is not JSON', async () => {
    const { status, body } = await run(db, 'not json at all');
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('400 on a JSON array body', async () => {
    const { status, body } = await run(db, '[1,2,3]');
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  it('400 on a JSON null body', async () => {
    const { status, body } = await run(db, 'null');
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  it('400 when courseId is missing, non-string, or over 100 characters', async () => {
    for (const payload of [{}, { courseId: 42 }, { courseId: '' }, { courseId: 'x'.repeat(101) }]) {
      const { status, body } = await run(db, payload);
      assert.equal(status, 400, `payload ${JSON.stringify(payload)}`);
      assert.equal(body.error, 'courseId required');
    }
    assert.equal(rows(db).length, 0);
  });

  it('404 for a course that is not in the catalogue', async () => {
    const { status, body } = await run(db, { courseId: 'no-such-course' });
    assert.equal(status, 404);
    assert.equal(body.error, 'Course not found');
  });

  it('400 for a coming-soon public course', async () => {
    const { status, body } = await run(db, { courseId: 'test-course-soon' });
    assert.equal(status, 400);
    assert.equal(body.error, 'Course not yet available');
    assert.equal(rows(db).length, 0);
  });

  it('400 for an affiliate course, which enrols externally', async () => {
    const { status, body } = await run(db, { courseId: 'test-course-affiliate' });
    assert.equal(status, 400);
    assert.equal(body.error, 'External enrollment only');
    assert.equal(rows(db).length, 0);
  });
});

describe('POST /api/courses/enroll -- the members gate', () => {
  let db;
  let net;

  beforeEach(async () => { db = await seededDb(); net = stubExternalFetch(); });
  afterEach(() => { net.restore(); db.close(); });

  it('a non-member is refused a members course and no row is written', async () => {
    const { status, body } = await run(db, { courseId: 'test-course-members-free' });
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
    assert.equal(rows(db).length, 0);
  });

  it('a member is enrolled in a members course', async () => {
    const { status, body } = await run(db, { courseId: 'test-course-members-free' }, { session: RAW.member });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, enrolled: true });
    const stored = rows(db, MEMBER);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].course_id, 'test-course-members-free');
  });

  it('coming-soon does not block a members course; membership still does', async () => {
    const refused = await run(db, { courseId: 'test-course-soon-members' });
    assert.equal(refused.status, 403, 'a non-member is stopped by membership, not by coming-soon');
    assert.equal(refused.body.error, 'Membership required');

    const allowed = await run(db, { courseId: 'test-course-soon-members' }, { session: RAW.member });
    assert.equal(allowed.status, 200);
    assert.equal(rows(db, MEMBER).length, 1);
  });

  it('a members enrolment does not email the administrator, but does raise a member_course lead', async () => {
    const { waitUntil } = await run(db, { courseId: 'test-course-members-free' }, { session: RAW.member });
    await drainWaitUntil(waitUntil);
    assert.equal(net.ses.length, 0, 'members enrolments are deliberately not alerted');
    assert.equal(net.ga4.length, 1);
    assert.equal(net.ga4[0].body.events[0].params.lead_source, 'member_course');
  });
});

describe('POST /api/courses/enroll -- free courses', () => {
  let db;
  let net;

  beforeEach(async () => { db = await seededDb(); net = stubExternalFetch(); });
  afterEach(() => { net.restore(); db.close(); });

  it('creates exactly one enrolment row and reports enrolled', async () => {
    const { status, body } = await run(db, { courseId: 'test-course-free' });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, enrolled: true });

    const stored = rows(db);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].course_id, 'test-course-free');
    assert.equal(stored[0].revoked_at, null);
    assert.equal(stored[0].stripe_payment_intent, null);
    assert.ok(stored[0].enrolled_at, 'enrolled_at defaults from the schema');
  });

  it('a second enrolment does not create a second row', async () => {
    await run(db, { courseId: 'test-course-free' });
    const firstId = rows(db)[0].id;

    const { status, body } = await run(db, { courseId: 'test-course-free' });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, enrolled: true });

    const stored = rows(db);
    assert.equal(stored.length, 1, 'the UNIQUE(user_id, course_id) index must hold');
    assert.equal(stored[0].id, firstId, 'the original row id survives');
  });

  it('the repeat enrolment sends no second alert and no second lead event', async () => {
    await run(db, { courseId: 'test-course-free' });
    const sesAfterFirst = net.ses.length;
    const ga4AfterFirst = net.ga4.length;
    assert.equal(sesAfterFirst, 1);
    assert.equal(ga4AfterFirst, 1);

    await run(db, { courseId: 'test-course-free' });
    assert.equal(net.ses.length, sesAfterFirst, 'the idempotent path must not re-alert');
    assert.equal(net.ga4.length, ga4AfterFirst, 'the idempotent path must not re-count the lead');
  });

  it('the administrator alert carries the learner identity and the free type', async () => {
    await run(db, { courseId: 'test-course-free' });
    assert.equal(net.ses.length, 1);
    const payload = net.ses[0].body;
    assert.deepEqual(payload.Destination.ToAddresses, ['administrator@rrmacademy.org']);
    assert.equal(payload.Content.Simple.Subject.Data, 'New enrollment: Ada Learner - Test Course: Free');
    assert.match(payload.Content.Simple.Body.Text.Data, /Type: {10}Free/);
  });

  it('a free-course lead is reported to GA4 as free_course', async () => {
    await run(db, { courseId: 'test-course-free' });
    assert.equal(net.ga4.length, 1);
    const event = net.ga4[0].body.events[0];
    assert.equal(event.name, 'generate_lead');
    assert.equal(event.params.lead_source, 'free_course');
    assert.deepEqual(event.params.items, [{ item_name: 'Course: test-course-free' }]);
  });

  it('a bundle also enrols the included course, and skips an unresolvable include', async () => {
    const { status } = await run(db, { courseId: 'test-course-free-bundle' });
    assert.equal(status, 200);
    const stored = rows(db);
    assert.deepEqual(stored.map((r) => r.course_id), ['test-course-free', 'test-course-free-bundle']);
    assert.equal(stored.length, 2, 'the unresolvable include must not become a third row');
  });

  it('a revoked learner does NOT get access back by re-enrolling in a free course', async () => {
    db._sqlite.prepare(
      "INSERT INTO enrollment (id, user_id, course_id, revoked_at) VALUES ('e-revoked', ?, 'test-course-free', '2026-06-01T00:00:00.000Z')"
    ).run(LEARNER);

    const { status, body } = await run(db, { courseId: 'test-course-free' });

    assert.equal(status, 403);
    assert.equal(body.error, 'Not enrolled');
    const stored = rows(db);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].revoked_at, '2026-06-01T00:00:00.000Z', 'the revocation must survive the enrol attempt');
    assert.equal(net.ses.length, 0, 'a refused enrolment raises no alert');
  });

  it('an included-course revocation is not cleared by re-enrolling in the parent bundle', async () => {
    db._sqlite.prepare(
      "INSERT INTO enrollment (id, user_id, course_id, revoked_at) VALUES ('e-inc', ?, 'test-course-free', '2026-06-01T00:00:00.000Z')"
    ).run(LEARNER);

    await run(db, { courseId: 'test-course-free-bundle' });

    const included = db._sqlite.prepare('SELECT * FROM enrollment WHERE user_id = ? AND course_id = ?')
      .get(LEARNER, 'test-course-free');
    assert.equal(included.revoked_at, '2026-06-01T00:00:00.000Z', 'INSERT OR IGNORE must not un-revoke');
  });

  it('the alert falls back to "unknown" and a blank name when the user row is gone', async () => {
    // Production default arm. The alert is built inside waitUntil from a SECOND
    // read of the user row, so it can miss even though validateSession just
    // succeeded (account deletion landing between the two). Both defaults live
    // on that read: `user?.email || 'unknown'` and `user?.name || ''`.
    const gone = sqliteD1({
      seed(sqlite) {
        insertUser(sqlite, { id: LEARNER, email: 'learner@example.com', name: 'Ada Learner' });
      },
      interleave({ sql, db: sqlite }) {
        if (sql === 'SELECT email, name FROM user WHERE id = ?') {
          sqlite.prepare('DELETE FROM user WHERE id = ?').run(LEARNER);
        }
      },
    });
    await insertSession(gone._sqlite, { rawId: RAW.learner, userId: LEARNER, expiresAt: FUTURE });

    const { status } = await run(gone, { courseId: 'test-course-free' });

    assert.equal(status, 200);
    assert.equal(net.ses.length, 1, 'the alert must still be sent');
    const payload = net.ses[0].body;
    assert.equal(payload.Content.Simple.Subject.Data, 'New enrollment: unknown - Test Course: Free');
    const text = payload.Content.Simple.Body.Text.Data;
    assert.match(text, /Student name: {2}\(not set\)/, 'a blank name falls through to the alert placeholder');
    assert.match(text, /Student email: unknown/);
    gone.close();
  });

  it('a failure while re-running the included-course enrolment is logged, not surfaced', async () => {
    // Seed an active enrolment so the "already enrolled" branch runs, then make
    // the batch throw. The learner still gets a success, because they ARE
    // enrolled; the retry failure is a warning for operators.
    const events = [];
    let armed = false;
    const throwingDb = sqliteD1({
      seed(sqlite) {
        insertUser(sqlite, { id: LEARNER, email: 'learner@example.com', name: 'Ada Learner' });
        sqlite.prepare("INSERT INTO enrollment (id, user_id, course_id) VALUES ('e1', ?, 'test-course-free')").run(LEARNER);
      },
      interleave({ sql }) {
        if (armed && sql.includes('INSERT INTO enrollment')) throw new Error('D1_ERROR: write failed');
      },
    });
    await insertSession(throwingDb._sqlite, { rawId: RAW.learner, userId: LEARNER, expiresAt: FUTURE });
    armed = true;

    const { status, body } = await run(throwingDb, { courseId: 'test-course-free' }, {
      env: { EVENTS: { writeDataPoint: (p) => events.push(p) } },
    });

    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, enrolled: true });
    assert.ok(events.some((e) => e.blobs.includes('enroll_retry_warn')), 'the retry failure must be logged');
    throwingDb.close();
  });

  it('an unexpected throw becomes a logged 500', async () => {
    const events = [];
    const throwingDb = sqliteD1({
      seed(sqlite) {
        insertUser(sqlite, { id: LEARNER, email: 'learner@example.com' });
      },
      interleave({ sql }) {
        if (sql.includes('FROM enrollment WHERE user_id')) throw new Error('D1_ERROR: read failed');
      },
    });
    await insertSession(throwingDb._sqlite, { rawId: RAW.learner, userId: LEARNER, expiresAt: FUTURE });

    const { status, body } = await run(throwingDb, { courseId: 'test-course-free' }, {
      env: { EVENTS: { writeDataPoint: (p) => events.push(p) } },
    });

    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(events.some((e) => e.blobs.includes('enroll_error')));
    throwingDb.close();
  });
});

describe('POST /api/courses/enroll -- paid courses', () => {
  let db;
  let net;

  beforeEach(async () => {
    db = await seededDb();
    net = stubExternalFetch({
      stripe: stripeRoutes({ '/v1/checkout/sessions': { id: 'cs_test_fixture', url: CHECKOUT_URL } }),
    });
  });
  afterEach(() => { net.restore(); db.close(); });

  it('500 when Stripe is not configured', async () => {
    const { status, body } = await run(db, { courseId: 'test-course-paid' }, { env: { STRIPE_SECRET_KEY: undefined } });
    assert.equal(status, 500);
    assert.equal(body.error, 'Payments not configured');
    assert.equal(rows(db).length, 0);
  });

  it('500 when the catalogue has no Stripe price for the course', async () => {
    const { status, body } = await run(db, { courseId: 'test-course-bundle' });
    assert.equal(status, 500);
    assert.equal(body.error, 'Course pricing not configured');
    assert.equal(rows(db).length, 0);
  });

  it('returns a checkout URL and writes NO enrolment row', async () => {
    const { status, body } = await run(db, { courseId: 'test-course-paid' });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.enrolled, false);
    assert.equal(body.checkoutUrl, CHECKOUT_URL);
    assert.equal(rows(db).length, 0, 'a paid course must not be granted before payment');
  });

  it('the checkout session carries the price, the course metadata and the user reference', async () => {
    await run(db, { courseId: 'test-course-paid' });
    const call = net.calls.find((c) => c.service === 'stripe');
    assert.ok(call, 'a Stripe checkout session must be created');
    const form = new URLSearchParams(call.body);
    assert.equal(form.get('mode'), 'payment');
    assert.equal(form.get('line_items[0][price]'), 'price_test_paid');
    assert.equal(form.get('line_items[0][quantity]'), '1');
    assert.equal(form.get('success_url'), 'https://rrmacademy.org/courses/test-course-paid/?enrolled=1');
    assert.equal(form.get('cancel_url'), 'https://rrmacademy.org/courses/test-course-paid/');
    assert.equal(form.get('metadata[type]'), 'course');
    assert.equal(form.get('metadata[courseId]'), 'test-course-paid');
    assert.equal(form.get('client_reference_id'), LEARNER);
    assert.equal(form.get('payment_intent_data[metadata][courseId]'), 'test-course-paid');
    assert.equal(form.get('payment_intent_data[statement_descriptor_suffix]'), 'COURSE');
  });

  it('an unlinked user has their email pre-filled; a linked user is passed by customer id', async () => {
    await run(db, { courseId: 'test-course-paid' });
    let form = new URLSearchParams(net.calls.find((c) => c.service === 'stripe').body);
    assert.equal(form.get('customer_email'), 'learner@example.com');
    assert.equal(form.get('customer'), null);

    db._sqlite.prepare('UPDATE user SET stripe_customer_id = ? WHERE id = ?').run('cus_linked', LEARNER);
    const fresh = stubExternalFetch({
      stripe: stripeRoutes({ '/v1/checkout/sessions': { id: 'cs_2', url: CHECKOUT_URL } }),
    });
    try {
      await run(db, { courseId: 'test-course-paid' });
      form = new URLSearchParams(fresh.calls.find((c) => c.service === 'stripe').body);
      assert.equal(form.get('customer'), 'cus_linked');
      assert.equal(form.get('customer_email'), null, 'a linked customer must not also get customer_email');
    } finally {
      fresh.restore();
    }
  });

  it('entry cookies drive the GA4 attribution stamped onto the session metadata', async () => {
    await run(db, { courseId: 'test-course-paid' }, {
      cookieExtra: '; entry_ref=https%3A%2F%2Fwww.google.com%2F; entry_url=https%3A%2F%2Frrmacademy.org%2Fcourses%2F%3Futm_source%3Dnewsletter%26utm_medium%3Demail%26utm_campaign%3Dspring',
    });
    const form = new URLSearchParams(net.calls.find((c) => c.service === 'stripe').body);
    assert.equal(form.get('metadata[ga_source]'), 'newsletter', 'utm_source wins over the referrer classification');
    assert.equal(form.get('metadata[ga_medium]'), 'email');
    assert.equal(form.get('metadata[ga_campaign]'), 'spring');
    assert.ok(form.get('metadata[ga_client_id]'), 'a client id is always stamped');
    assert.ok(Number(form.get('metadata[ga_session_id]')) > 0);
  });

  it('with no entry cookies the referrer classification is used and no campaign is sent', async () => {
    await run(db, { courseId: 'test-course-paid' });
    const form = new URLSearchParams(net.calls.find((c) => c.service === 'stripe').body);
    assert.equal(form.get('metadata[ga_source]'), '(direct)');
    assert.equal(form.get('metadata[ga_medium]'), '(none)');
    assert.equal(form.get('metadata[ga_campaign]'), null, 'an empty campaign is omitted, not sent blank');
  });

  it('an rrm_ft cookie stamps ft_* onto the checkout session metadata, same shape as create-checkout.js', async () => {
    // Wire format matches BaseLayout.astro's writer -- see
    // test/ga4-source.test.js's ftCookie() for the rationale.
    const ftCookie = 'rrm_ft=' + ['s=google', 'm=cpc', 'c=q3_push', 'l=%2Fcourses%2F'].join('&');
    await run(db, { courseId: 'test-course-paid' }, { cookieExtra: `; ${ftCookie}` });
    const form = new URLSearchParams(net.calls.find((c) => c.service === 'stripe').body);
    assert.equal(form.get('metadata[ft_campaign]'), 'q3_push');
    assert.equal(form.get('metadata[ft_source]'), 'google');
    assert.equal(form.get('metadata[ft_medium]'), 'cpc');
    assert.equal(form.get('payment_intent_data[metadata][ft_campaign]'), 'q3_push');
  });

  it('a malformed percent-encoded entry cookie is ignored rather than throwing', async () => {
    const { status } = await run(db, { courseId: 'test-course-paid' }, { cookieExtra: '; entry_url=%E0%A4%A' });
    assert.equal(status, 200, 'a bad cookie must not take the endpoint down');
    const form = new URLSearchParams(net.calls.find((c) => c.service === 'stripe').body);
    assert.equal(form.get('metadata[ga_source]'), '(direct)');
  });

  it('begin_checkout carries the price when the catalogue has one, and omits it when it does not', async () => {
    await run(db, { courseId: 'test-course-paid' });
    const withValue = net.ga4.at(-1).body.events[0];
    assert.equal(withValue.name, 'begin_checkout');
    assert.equal(withValue.params.currency, 'USD');
    assert.equal(withValue.params.value, 49);
    assert.deepEqual(withValue.params.items, [{ item_name: 'Course: test-course-paid' }]);

    await run(db, { courseId: 'test-course-paid-nofigure' });
    const withoutValue = net.ga4.at(-1).body.events[0];
    assert.equal(withoutValue.name, 'begin_checkout');
    assert.ok(!('value' in withoutValue.params), 'no priceCents means no value on the event');
  });

  it('a second tap inside the lock window is refused with 429 and creates no second session', async () => {
    const sharedEnv = {};
    const first = await run(db, { courseId: 'test-course-paid' });
    assert.equal(first.status, 200);
    const stripeCalls = net.calls.filter((c) => c.service === 'stripe').length;

    // Re-use the SAME env so the KV-backed lock counter is shared, exactly as a
    // second tap from the same browser would hit the same namespace.
    sharedEnv.COMMUNITY_KV = first.env.COMMUNITY_KV;
    const second = await run(db, { courseId: 'test-course-paid' }, { env: sharedEnv });

    assert.equal(second.status, 429);
    assert.match(second.body.error, /already being processed/);
    assert.equal(net.calls.filter((c) => c.service === 'stripe').length, stripeCalls, 'no second checkout session');
  });

  it('the lock is per user and course, so a different course is not blocked', async () => {
    const first = await run(db, { courseId: 'test-course-paid' });
    const second = await run(db, { courseId: 'test-course-paid-nofigure' }, {
      env: { COMMUNITY_KV: first.env.COMMUNITY_KV },
    });
    assert.equal(second.status, 200, 'a different course has its own lock key');
  });

  it('a missing KV binding fails the lock CLOSED, so no checkout is created', async () => {
    const { status, body } = await run(db, { courseId: 'test-course-paid' }, { env: { COMMUNITY_KV: undefined } });
    assert.equal(status, 429);
    assert.match(body.error, /already being processed/);
    assert.equal(net.calls.filter((c) => c.service === 'stripe').length, 0);
  });

  it('a Stripe outage becomes a 503 with a retryable message, and is logged', async () => {
    const events = [];
    net.restore();
    net = stubExternalFetch({ stripe: () => { throw new Error('connect ECONNREFUSED'); } });

    const { status, body } = await run(db, { courseId: 'test-course-paid' }, {
      env: { EVENTS: { writeDataPoint: (p) => events.push(p) } },
    });

    assert.equal(status, 503);
    assert.match(body.error, /Payment service unavailable/);
    assert.equal(rows(db).length, 0);
    const logged = events.find((e) => e.blobs.includes('enroll_error'));
    assert.ok(logged, 'the Stripe failure must be logged');
    assert.match(logged.blobs.join('|'), /stripe checkout/);
  });

  it('an already-enrolled learner never reaches Stripe on a paid course', async () => {
    db._sqlite.prepare("INSERT INTO enrollment (id, user_id, course_id, stripe_payment_intent) VALUES ('e-paid', ?, 'test-course-paid', 'pi_prior')")
      .run(LEARNER);

    const { status, body } = await run(db, { courseId: 'test-course-paid' });

    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, enrolled: true });
    assert.equal(net.calls.filter((c) => c.service === 'stripe').length, 0);
    const stored = rows(db);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].stripe_payment_intent, 'pi_prior', 'the prior payment intent is preserved');
  });
});

describe('POST /api/courses/enroll -- Idempotency-Key replay', () => {
  let db;
  let net;

  beforeEach(async () => {
    db = await seededDb();
    net = stubExternalFetch({
      stripe: stripeRoutes({ '/v1/checkout/sessions': (call) => ({ id: `cs_${net.calls.length}`, url: `${CHECKOUT_URL}?n=${call.body.length}` }) }),
    });
  });
  afterEach(() => { net.restore(); db.close(); });

  /** CF KV accepts both `get(key, 'json')` and `get(key, { type: 'json' })`. */
  function kvJson() {
    const store = new Map();
    return {
      async get(key, type) {
        if (!store.has(key)) return null;
        const raw = store.get(key);
        const wantsJson = type === 'json' || (type && type.type === 'json');
        return wantsJson ? JSON.parse(raw) : raw;
      },
      async put(key, value) { store.set(key, value); },
      async delete(key) { store.delete(key); },
    };
  }

  it('replays the cached checkout response instead of opening a second Stripe session', async () => {
    const idempotencyKv = kvJson();
    const communityKv = mockEnv().COMMUNITY_KV;
    // Deliberately repetitive and >= 16 chars: the handler's KEY_RE demands
    // 16-128 printable characters, and a random-looking literal here trips the
    // gitleaks generic-api-key entropy rule in CI.
    const key = 'enroll-replay-enroll-replay';

    async function call() {
      const request = new Request('https://rrmacademy.org/api/courses/enroll', {
        method: 'POST',
        headers: {
          Cookie: `session=${RAW.learner}`,
          'Idempotency-Key': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ courseId: 'test-course-paid' }),
      });
      const waitUntil = mockWaitUntil();
      const res = await enroll.onRequestPost({
        request,
        env: mockEnv({ DB: db, IDEMPOTENCY_KV: idempotencyKv, COMMUNITY_KV: communityKv }),
        waitUntil,
      });
      await drainWaitUntil(waitUntil);
      return res;
    }

    const first = await call();
    const firstBody = await first.clone().json();
    assert.equal(first.status, 200);
    assert.ok(firstBody.checkoutUrl.startsWith(CHECKOUT_URL));
    const stripeCalls = net.calls.filter((c) => c.service === 'stripe').length;
    assert.equal(stripeCalls, 1);

    const second = await call();
    const secondBody = await second.json();

    assert.equal(second.status, 200);
    assert.equal(second.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(secondBody, firstBody, 'the replay must return the SAME checkout url');
    assert.equal(net.calls.filter((c) => c.service === 'stripe').length, 1, 'no second Stripe session');
  });
});

describe('enrollUser -- the exported writer used by the Stripe webhook', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('a paid enrolment clears a prior revocation when the payment intent is new', async () => {
    db._sqlite.prepare("INSERT INTO enrollment (id, user_id, course_id, stripe_payment_intent, revoked_at) VALUES ('e1', ?, 'test-course-paid', 'pi_old', '2026-06-01')")
      .run(LEARNER);

    const changed = await enroll.enrollUser(db, LEARNER, 'test-course-paid', 'pi_new');

    assert.equal(changed, true);
    const stored = db._sqlite.prepare('SELECT * FROM enrollment WHERE user_id = ? AND course_id = ?').get(LEARNER, 'test-course-paid');
    assert.equal(stored.revoked_at, null, 'a new payment must restore access');
    assert.equal(stored.stripe_payment_intent, 'pi_new');
  });

  it('replaying the SAME payment intent does not clear a revocation', async () => {
    db._sqlite.prepare("INSERT INTO enrollment (id, user_id, course_id, stripe_payment_intent, revoked_at) VALUES ('e1', ?, 'test-course-paid', 'pi_same', '2026-06-01')")
      .run(LEARNER);

    await enroll.enrollUser(db, LEARNER, 'test-course-paid', 'pi_same');

    const stored = db._sqlite.prepare('SELECT * FROM enrollment WHERE user_id = ? AND course_id = ?').get(LEARNER, 'test-course-paid');
    assert.equal(stored.revoked_at, '2026-06-01', 'a refunded learner must not be restored by a webhook replay');
  });

  it('a null payment intent never overwrites a stored one', async () => {
    db._sqlite.prepare("INSERT INTO enrollment (id, user_id, course_id, stripe_payment_intent) VALUES ('e1', ?, 'test-course-paid', 'pi_kept')")
      .run(LEARNER);

    await enroll.enrollUser(db, LEARNER, 'test-course-paid', null);

    const stored = db._sqlite.prepare('SELECT stripe_payment_intent FROM enrollment WHERE user_id = ? AND course_id = ?')
      .get(LEARNER, 'test-course-paid');
    assert.equal(stored.stripe_payment_intent, 'pi_kept');
  });

  it('included courses inherit the parent payment intent', async () => {
    await enroll.enrollUser(db, LEARNER, 'test-course-free-bundle', 'pi_bundle');
    const stored = db._sqlite.prepare('SELECT course_id, stripe_payment_intent FROM enrollment WHERE user_id = ? ORDER BY course_id').all(LEARNER);
    assert.deepEqual(stored.map((r) => r.course_id), ['test-course-free', 'test-course-free-bundle']);
    assert.ok(stored.every((r) => r.stripe_payment_intent === 'pi_bundle'));
  });

  it('reports false when D1 answers a batch statement with success: false', async () => {
    // D1 batch atomicity is not something the SQLite harness can model, so the
    // defence-in-depth arm gets an explicit stub, per the harness header.
    const failing = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => [{ success: false }],
    };
    assert.equal(await enroll.enrollUser(failing, LEARNER, 'test-course-free', null), false);
  });

  it('reports false when the batch reports zero rows written', async () => {
    // The return value is `results[0].meta.changes > 0`, and it is the ONLY
    // thing gating the administrator alert and the generate_lead event in the
    // free path. SQLite (and therefore D1) counts this upsert's DO UPDATE as a
    // change even when nothing moves -- pinned by the test below -- so the
    // engine can never produce the zero here. Driving the value the code
    // actually reads is what keeps the expression from silently becoming a
    // constant: replace it with `return true` and only this assertion notices.
    const zeroChange = {
      prepare: (sql) => db.prepare(sql),
      batch: async (stmts) => {
        const out = await db.batch(stmts);
        return out.map((r, i) => (i === 0 ? { ...r, meta: { ...r.meta, changes: 0 } } : r));
      },
    };
    assert.equal(await enroll.enrollUser(zeroChange, LEARNER, 'test-course-free', null), false);
    assert.equal(
      db._sqlite.prepare('SELECT COUNT(*) AS n FROM enrollment WHERE user_id = ?').get(LEARNER).n,
      1,
      'the row is still written; only the reported count was zeroed',
    );
  });

  it('reports true even when the conflict branch changed nothing, which is why callers re-check access', async () => {
    // SQLite counts a DO UPDATE as a change even when every assigned column
    // keeps its value, so `meta.changes > 0` cannot distinguish "newly enrolled"
    // from "already enrolled". This is precisely why the free path in
    // handleEnroll re-reads the enrolment before reporting success: without that
    // re-read, a revoked learner would be told they are enrolled.
    await enroll.enrollUser(db, LEARNER, 'test-course-free', null);
    const again = await enroll.enrollUser(db, LEARNER, 'test-course-free', null);
    assert.equal(again, true);

    const stored = db._sqlite.prepare('SELECT COUNT(*) AS n FROM enrollment WHERE user_id = ? AND course_id = ?')
      .get(LEARNER, 'test-course-free');
    assert.equal(stored.n, 1, 'the repeated write is still a single row');
  });
});
