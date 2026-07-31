/**
 * functions/api/courses/affiliate-click.js -- outbound click attribution for
 * externally-hosted (affiliate) courses.
 *
 * WHY A REAL ENGINE HERE
 * The whole endpoint is one write, and the only interesting thing about that
 * write is what the SCHEMA does to it: affiliate_clicks carries
 * `UNIQUE(user_id, course_id, click_date)` with `click_date` defaulting to
 * `date('now')`, and the statement is `INSERT OR IGNORE`. So "a learner
 * double-clicking the affiliate button does not inflate the count" is a
 * constraint decision, not a handler decision, and a substring-matching mock
 * would report success for the second insert regardless. Everything below runs
 * on node:sqlite loaded with the committed schema (test/_d1-sqlite.mjs), and
 * every attribution assertion re-reads the table.
 *
 * WHAT IT STORES, STATED PLAINLY
 * A row is (auto-increment id, user_id, course_id, click_date, clicked_at).
 * user_id is the internal account id of an authenticated learner -- pseudonymous
 * on its own, but joinable to `user.email` inside the same database, so the row
 * is user-linked behavioural data rather than an anonymous counter. No IP, no
 * user agent, no referrer is captured. `records nothing but the account id and
 * the course` below pins that shape so a future field addition has to be
 * deliberate.
 *
 * WHAT IS STILL FAKED
 *  - src/data/courses.json is the deterministic fixture from
 *    test/_json-module-hook.mjs, so course existence is fixture-decided.
 *  - Analytics Engine is a capturing stub.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './_json-module-hook.mjs';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

const affiliate = await import('../functions/api/courses/affiliate-click.js');

const LEARNER = 'u_learner';
const OTHER = 'u_other';
const RAW = { [LEARNER]: 'raw-session-learner', [OTHER]: 'raw-session-other' };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

const AFFILIATE_COURSE = 'test-course-affiliate';
const OTHER_COURSE = 'test-course-basic';

async function seededDb({ interleave } = {}) {
  const db = sqliteD1({
    interleave,
    seed(sqlite) {
      insertUser(sqlite, { id: LEARNER, email: 'learner@example.com' });
      insertUser(sqlite, { id: OTHER, email: 'other@example.com' });
    },
  });
  await Promise.all(Object.entries(RAW).map(([userId, rawId]) =>
    insertSession(db._sqlite, { rawId, userId, expiresAt: FUTURE })));
  return db;
}

const clicks = (db) => db._sqlite.prepare('SELECT * FROM affiliate_clicks ORDER BY id').all().map(r => ({ ...r }));

const cookie = (userId) => ({ Cookie: `session=${RAW[userId]}` });

function ctx(db, request, overrides = {}) {
  const events = [];
  const env = mockEnv({ DB: db, EVENTS: { writeDataPoint: (dp) => events.push(dp) }, ...overrides });
  return { request, env, waitUntil: mockWaitUntil(), events };
}

const req = (userId, body) => mockRequest('POST', {
  url: 'https://rrmacademy.org/api/courses/affiliate-click',
  headers: userId ? cookie(userId) : {},
  body,
});
const rawReq = (userId, rawBody) => mockRequest('POST', {
  url: 'https://rrmacademy.org/api/courses/affiliate-click',
  headers: userId ? cookie(userId) : {},
  rawBody,
});

describe('OPTIONS /api/courses/affiliate-click', () => {
  it('answers the preflight with 204 and the locked origin', async () => {
    const res = await affiliate.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

describe('POST /api/courses/affiliate-click -- validation', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  const post = async (body, userId = LEARNER) =>
    parseResponse(await affiliate.onRequestPost(ctx(db, req(userId, body))));

  it('returns 500 when the DB binding is missing, never a silent success', async () => {
    const { status, body } = await parseResponse(await affiliate.onRequestPost(
      ctx(db, req(LEARNER, { courseId: AFFILIATE_COURSE }), { DB: undefined })));
    assert.equal(status, 500);
    assert.equal(body.ok, false);
  });

  it('rejects a malformed JSON body', async () => {
    const { status, body } = await parseResponse(await affiliate.onRequestPost(ctx(db, rawReq(LEARNER, 'not json'))));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
    assert.equal(clicks(db).length, 0);
  });

  it('rejects array and null bodies', async () => {
    assert.equal((await post([{ courseId: AFFILIATE_COURSE }])).body.error, 'Invalid payload');
    const { body } = await parseResponse(await affiliate.onRequestPost(ctx(db, rawReq(LEARNER, 'null'))));
    assert.equal(body.error, 'Invalid payload');
    assert.equal(clicks(db).length, 0);
  });

  it('requires a courseId that is a string of at most 100 characters', async () => {
    assert.equal((await post({})).body.error, 'courseId required');
    assert.equal((await post({ courseId: '' })).body.error, 'courseId required');
    assert.equal((await post({ courseId: 12345 })).body.error, 'courseId required');
    assert.equal((await post({ courseId: 'a'.repeat(101) })).body.error, 'courseId required');
    assert.equal(clicks(db).length, 0);
  });

  it('404s an unknown course before touching the database', async () => {
    const { status, body } = await post({ courseId: 'no-such-course' });
    assert.equal(status, 404);
    assert.equal(body.error, 'Course not found');
    assert.equal(clicks(db).length, 0);
  });

  it('a 100-character courseId passes the length cap and then 404s on lookup', async () => {
    const { status } = await post({ courseId: 'a'.repeat(100) });
    assert.equal(status, 404);
  });
});

describe('POST /api/courses/affiliate-click -- attribution', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  const post = async (body, userId = LEARNER) =>
    parseResponse(await affiliate.onRequestPost(ctx(db, req(userId, body))));

  it('records the click against the session user and reports tracked: true', async () => {
    const { status, body } = await post({ courseId: AFFILIATE_COURSE });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, tracked: true });

    const stored = clicks(db);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].user_id, LEARNER);
    assert.equal(stored[0].course_id, AFFILIATE_COURSE);
  });

  it('records nothing but the account id and the course: no IP, agent or referrer column is written', async () => {
    await post({ courseId: AFFILIATE_COURSE });
    const stored = clicks(db)[0];
    assert.deepEqual(Object.keys(stored).sort(),
      ['click_date', 'clicked_at', 'course_id', 'id', 'user_id']);
    assert.match(stored.click_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(stored.clicked_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('ignores any user id supplied in the body', async () => {
    await post({ courseId: AFFILIATE_COURSE, user_id: OTHER, userId: OTHER });
    assert.deepEqual(clicks(db).map(c => c.user_id), [LEARNER]);
  });

  it('is idempotent within a day: a replayed click stays one row and still reports tracked', async () => {
    const first = await post({ courseId: AFFILIATE_COURSE });
    const second = await post({ courseId: AFFILIATE_COURSE });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.tracked, true);
    assert.equal(clicks(db).length, 1, 'UNIQUE(user_id, course_id, click_date) plus INSERT OR IGNORE');
  });

  it('keeps a separate row per course and per learner', async () => {
    await post({ courseId: AFFILIATE_COURSE });
    await post({ courseId: OTHER_COURSE });
    await post({ courseId: AFFILIATE_COURSE }, OTHER);

    assert.deepEqual(clicks(db).map(c => [c.user_id, c.course_id]), [
      [LEARNER, AFFILIATE_COURSE],
      [LEARNER, OTHER_COURSE],
      [OTHER, AFFILIATE_COURSE],
    ]);
  });

  it('a click on a different day is a new row', async () => {
    await post({ courseId: AFFILIATE_COURSE });
    db._sqlite.prepare('UPDATE affiliate_clicks SET click_date = ?').run('2020-01-01');
    await post({ courseId: AFFILIATE_COURSE });
    assert.equal(clicks(db).length, 2);
  });

  it('logs an affiliate_click event carrying the course, not the learner', async () => {
    const c = ctx(db, req(LEARNER, { courseId: AFFILIATE_COURSE }));
    await affiliate.onRequestPost(c);
    const ev = c.events.find(e => e.blobs[2] === 'affiliate_click');
    assert.ok(ev, 'expected an affiliate_click event');
    assert.equal(ev.blobs[3], 'ok');
    assert.equal(ev.blobs[4], AFFILIATE_COURSE);
  });
});

describe('POST /api/courses/affiliate-click -- anonymous and failure paths', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('an anonymous click is accepted but explicitly NOT tracked, and writes no row', async () => {
    const { status, body } = await parseResponse(
      await affiliate.onRequestPost(ctx(db, req(null, { courseId: AFFILIATE_COURSE }))));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, tracked: false });
    assert.equal(clicks(db).length, 0);
  });

  it('an expired or forged session is treated as anonymous, not as an error', async () => {
    const request = mockRequest('POST', {
      url: 'https://rrmacademy.org/api/courses/affiliate-click',
      headers: { Cookie: 'session=not-a-real-session' },
      body: { courseId: AFFILIATE_COURSE },
    });
    const { status, body } = await parseResponse(await affiliate.onRequestPost(ctx(db, request)));
    assert.equal(status, 200);
    assert.equal(body.tracked, false);
    assert.equal(clicks(db).length, 0);
  });

  it('returns 500 and logs when the attribution INSERT throws', async () => {
    let fired = false;
    const raced = await seededDb({
      interleave: ({ sql }) => {
        if (fired || !sql.includes('INSERT OR IGNORE INTO affiliate_clicks')) return;
        fired = true;
        throw new Error('D1_ERROR: write failed');
      },
    });
    const c = ctx(raced, req(LEARNER, { courseId: AFFILIATE_COURSE }));
    const { status, body } = await parseResponse(await affiliate.onRequestPost(c));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(c.events.find(e => e.blobs[2] === 'affiliate_click_error'));
    assert.equal(clicks(raced).length, 0);
    raced.close();
  });

  it('returns 500 and logs when the session lookup itself throws', async () => {
    const deadDb = {
      prepare() {
        return {
          bind() { return this; },
          async first() { throw new Error('D1_ERROR: connection lost'); },
          async all() { throw new Error('D1_ERROR: connection lost'); },
          async run() { throw new Error('D1_ERROR: connection lost'); },
        };
      },
      async batch() { throw new Error('D1_ERROR: connection lost'); },
    };
    const c = ctx(db, req(LEARNER, { courseId: AFFILIATE_COURSE }), { DB: deadDb });
    const { status, body } = await parseResponse(await affiliate.onRequestPost(c));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(c.events.find(e => e.blobs[2] === 'affiliate_click_error'));
  });
});
