/**
 * functions/api/admin/enrollments.js -- the training-analytics reporting view.
 *
 * This is the endpoint behind "how many people trained, on what, and when": the
 * numbers an ITC or Title X reviewer asks to see. Every one of them is produced
 * by SQL, not by JavaScript:
 *   - COUNT(DISTINCT e.user_id) for unique students;
 *   - two SUM(CASE WHEN e.enrolled_at >= datetime('now','-30 days')) rolling
 *     windows, which decide whether a report says 4 or 40;
 *   - GROUP BY e.course_id ... ORDER BY total DESC for the per-course table;
 *   - `WHERE e.revoked_at IS NULL` on every one of them, so a refunded
 *     enrollment stops being counted as a trained person;
 *   - a JOIN to `user` on the list view, which silently drops orphan rows.
 * A substring-matching mock returns whatever the test declared for each of
 * those, which makes an assertion about a window boundary a restatement of the
 * fixture. These run on node:sqlite loaded with the committed schema.
 *
 * WHAT IS STILL FAKED
 *  - `datetime('now')` is the machine clock, and rows are seeded relative to it.
 *    A test that pins an absolute date would rot; these pin OFFSETS, so what is
 *    proven is the shape of the window, not a calendar date.
 *  - Analytics Engine and console are stubs; the log payload is asserted only
 *    where a test says so.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

const enrollments = await import('../functions/api/admin/enrollments.js');

const ADMIN = 'u_super';
const MEMBER = 'u_member';
const BLOCKED = 'u_blocked';
const RAW = { admin: 'sess-super', member: 'sess-member', blocked: 'sess-blocked' };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString();

async function seededDb(seed) {
  const db = sqliteD1({
    seed(sqlite) {
      insertUser(sqlite, { id: ADMIN, email: 'super@example.com', role: 'superadmin', name: 'Super' });
      insertUser(sqlite, { id: MEMBER, email: 'member@example.com', role: 'member', name: 'Member' });
      insertUser(sqlite, { id: BLOCKED, email: 'blocked@example.com', role: 'superadmin', blocked: 1 });
      if (seed) seed(sqlite);
    },
  });
  await insertSession(db._sqlite, { rawId: RAW.admin, userId: ADMIN, expiresAt: FUTURE });
  await insertSession(db._sqlite, { rawId: RAW.member, userId: MEMBER, expiresAt: FUTURE });
  await insertSession(db._sqlite, { rawId: RAW.blocked, userId: BLOCKED, expiresAt: FUTURE });
  return db;
}

function enroll(sqlite, { id, userId, courseId, enrolledAt, revokedAt = null, completedAt = null, pi = null }) {
  sqlite.prepare(
    'INSERT INTO enrollment (id, user_id, course_id, enrolled_at, completed_at, stripe_payment_intent, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, courseId, enrolledAt, completedAt, pi, revokedAt);
}

function get(db, { url = 'https://rrmacademy.org/api/admin/enrollments', who = 'admin' } = {}) {
  return enrollments.onRequestGet({
    request: mockRequest('GET', { url, headers: who ? { Cookie: `session=${RAW[who]}` } : {} }),
    env: mockEnv({ DB: db }),
  });
}

describe('GET /api/admin/enrollments -- authorization', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });

  it('401s with no session', async () => {
    assert.equal((await parseResponse(await get(db, { who: null }))).status, 401);
  });

  it('403s for a signed-in non-superadmin', async () => {
    const { status, body } = await parseResponse(await get(db, { who: 'member' }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
  });

  it('denies a blocked superadmin -- as 401, because validateSession drops blocked users first', async () => {
    // Documented on purpose. requireSuperAdmin() has an explicit
    // `if (user.blocked) return 403 Account suspended` branch, but
    // validateSession() already returns null for a blocked user, so that branch
    // is unreachable through any session-cookie caller and the observable
    // answer is 401. The access decision is right either way; the 403 arm is
    // dead code, and a test asserting 403 here would have been asserting a
    // behaviour the deployed endpoint does not have.
    const { status, body } = await parseResponse(await get(db, { who: 'blocked' }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
  });

  it('500s when the DB binding is absent -- the endpoint\'s own 503 branch is unreachable', async () => {
    // requireSuperAdmin(request, env.DB) already answers 500 "Server
    // misconfigured" when db is falsy, so the `if (!env.DB) return 503
    // Database unavailable` two lines below it can never run. Asserting 503
    // here would have been asserting a response this endpoint cannot produce.
    const res = await enrollments.onRequestGet({
      request: mockRequest('GET', { url: 'https://rrmacademy.org/api/admin/enrollments' }),
      env: mockEnv({ DB: undefined }),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('500s generically when request URL parsing throws, without leaking the reason', async () => {
    // The only reachable path into the outer catch: handleSummary and handleList
    // each catch their own database errors, so this is what is left.
    const res = await enrollments.onRequestGet({
      request: mockRequest('GET', { url: 'not-a-url', headers: { Cookie: `session=${RAW.admin}` } }),
      env: mockEnv({ DB: db }),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.error, 'Failed to fetch enrollment data');
  });

  it('400s on an unknown view rather than defaulting to one', async () => {
    const { status, body } = await parseResponse(await get(db, {
      url: 'https://rrmacademy.org/api/admin/enrollments?view=everything',
    }));
    assert.equal(status, 400);
    assert.match(body.error, /summary or list/);
  });

  it('OPTIONS preflight answers 204 with the locked-down origin', async () => {
    const res = await enrollments.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

describe('GET /api/admin/enrollments?view=summary', () => {
  it('is the default view', async () => {
    const db = await seededDb((s) => enroll(s, { id: 'e1', userId: MEMBER, courseId: 'c1', enrolledAt: daysAgo(1) }));
    const { body } = await parseResponse(await get(db));
    assert.equal(body.data.totals.total_enrollments, 1);
  });

  it('counts unique students, not rows', async () => {
    const db = await seededDb((s) => {
      enroll(s, { id: 'e1', userId: MEMBER, courseId: 'c1', enrolledAt: daysAgo(1) });
      enroll(s, { id: 'e2', userId: MEMBER, courseId: 'c2', enrolledAt: daysAgo(1) });
      enroll(s, { id: 'e3', userId: ADMIN, courseId: 'c1', enrolledAt: daysAgo(1) });
    });
    const { body } = await parseResponse(await get(db, { url: 'https://rrmacademy.org/api/admin/enrollments?view=summary' }));
    assert.equal(body.data.totals.total_enrollments, 3);
    assert.equal(body.data.totals.unique_students, 2);
  });

  it('the 7 and 30 day windows are real windows, and revoked rows are outside every count', async () => {
    const db = await seededDb((s) => {
      // UNIQUE(user_id, course_id) is real here, so each row needs a distinct pair.
      enroll(s, { id: 'e-now', userId: MEMBER, courseId: 'c1', enrolledAt: daysAgo(1) });
      enroll(s, { id: 'e-20d', userId: ADMIN, courseId: 'c1', enrolledAt: daysAgo(20) });
      enroll(s, { id: 'e-old', userId: MEMBER, courseId: 'c2', enrolledAt: daysAgo(200) });
      enroll(s, { id: 'e-revoked', userId: MEMBER, courseId: 'c3', enrolledAt: daysAgo(1), revokedAt: daysAgo(0) });
    });
    const { body } = await parseResponse(await get(db, { url: 'https://rrmacademy.org/api/admin/enrollments?view=summary' }));
    assert.equal(body.data.totals.total_enrollments, 3, 'revoked enrollment counted as a trained learner');
    assert.equal(body.data.totals.last_30d, 2);
    assert.equal(body.data.totals.last_7d, 1);
  });

  it('per-course rows carry completed and paid counts and sort by total descending', async () => {
    const db = await seededDb((s) => {
      enroll(s, { id: 'a1', userId: MEMBER, courseId: 'popular', enrolledAt: daysAgo(2), completedAt: daysAgo(1), pi: 'pi_1' });
      enroll(s, { id: 'a2', userId: ADMIN, courseId: 'popular', enrolledAt: daysAgo(2) });
      enroll(s, { id: 'a3', userId: BLOCKED, courseId: 'popular', enrolledAt: daysAgo(2), pi: 'pi_2' });
      enroll(s, { id: 'b1', userId: MEMBER, courseId: 'quiet', enrolledAt: daysAgo(2) });
    });
    const { body } = await parseResponse(await get(db, { url: 'https://rrmacademy.org/api/admin/enrollments?view=summary' }));
    assert.deepEqual(body.data.by_course.map(r => r.course_id), ['popular', 'quiet']);
    assert.equal(body.data.by_course[0].total, 3);
    assert.equal(body.data.by_course[0].completed, 1);
    assert.equal(body.data.by_course[0].paid, 2);
    assert.equal(body.data.by_course[1].paid, 0);
  });

  it('signup sources bucket NULL as unknown and are limited to the last 30 days', async () => {
    const db = await seededDb((s) => {
      s.prepare('UPDATE user SET signup_source = ?, created_at = ? WHERE id = ?').run('quiz', daysAgo(3), MEMBER);
      s.prepare('UPDATE user SET signup_source = NULL, created_at = ? WHERE id = ?').run(daysAgo(3), ADMIN);
      s.prepare('UPDATE user SET signup_source = ?, created_at = ? WHERE id = ?').run('ancient', daysAgo(400), BLOCKED);
    });
    const { body } = await parseResponse(await get(db, { url: 'https://rrmacademy.org/api/admin/enrollments?view=summary' }));
    const sources = Object.fromEntries(body.data.signup_sources.map(r => [r.source, r.count]));
    assert.deepEqual(sources, { quiz: 1, unknown: 1 }, 'expected the 400-day-old signup to fall outside the window');
  });

  it('reports zeros rather than nulls on an empty database', async () => {
    const db = await seededDb();
    const { status, body } = await parseResponse(await get(db, { url: 'https://rrmacademy.org/api/admin/enrollments?view=summary' }));
    assert.equal(status, 200);
    assert.deepEqual(body.data.totals, { total_enrollments: 0, unique_students: 0, last_30d: 0, last_7d: 0 });
    assert.deepEqual(body.data.by_course, []);
  });

  it('500s with a generic error when the summary query fails', async () => {
    const db = await seededDb();
    db._sqlite.exec('DROP TABLE enrollment');
    const { status, body } = await parseResponse(await get(db, { url: 'https://rrmacademy.org/api/admin/enrollments?view=summary' }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Database error');
    assert.ok(!JSON.stringify(body).includes('no such table'), 'SQL error text reached the client');
  });
});

describe('GET /api/admin/enrollments?view=list', () => {
  const LIST = 'https://rrmacademy.org/api/admin/enrollments?view=list';

  /** n enrollments for one learner, one per course (UNIQUE(user_id, course_id) is enforced). */
  async function withRows(n) {
    return seededDb((s) => {
      for (let i = 0; i < n; i++) {
        enroll(s, { id: `e${i}`, userId: MEMBER, courseId: `c${i}`, enrolledAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() });
      }
    });
  }

  it('joins the learner email and name onto each row, newest first', async () => {
    const db = await withRows(3);
    const { status, body } = await parseResponse(await get(db, { url: LIST }));
    assert.equal(status, 200);
    assert.equal(body.data.enrollments.length, 3);
    assert.equal(body.data.enrollments[0].id, 'e2', 'ORDER BY enrolled_at DESC not honoured');
    assert.equal(body.data.enrollments[0].email, 'member@example.com');
    assert.equal(body.data.enrollments[0].name, 'Member');
  });

  it('excludes revoked rows from both the page and the total', async () => {
    const db = await seededDb((s) => {
      enroll(s, { id: 'live', userId: MEMBER, courseId: 'c1', enrolledAt: daysAgo(1) });
      enroll(s, { id: 'gone', userId: ADMIN, courseId: 'c1', enrolledAt: daysAgo(1), revokedAt: daysAgo(0) });
    });
    const { body } = await parseResponse(await get(db, { url: LIST }));
    assert.equal(body.data.total, 1);
    assert.deepEqual(body.data.enrollments.map(r => r.id), ['live']);
  });

  it('drops an enrollment whose user row is gone -- the JOIN is inner', async () => {
    const db = await seededDb((s) => {
      enroll(s, { id: 'orphan', userId: 'u_vanished', courseId: 'c1', enrolledAt: daysAgo(1) });
      enroll(s, { id: 'kept', userId: MEMBER, courseId: 'c1', enrolledAt: daysAgo(2) });
    });
    const { body } = await parseResponse(await get(db, { url: LIST }));
    // COUNT(*) does not join, so total and page length legitimately disagree here.
    assert.equal(body.data.total, 2);
    assert.deepEqual(body.data.enrollments.map(r => r.id), ['kept']);
  });

  it('paginates: page 2 of a 3-per-page window returns the next slice', async () => {
    const db = await withRows(7);
    const { body } = await parseResponse(await get(db, { url: `${LIST}&page=2&limit=3` }));
    assert.equal(body.data.page, 2);
    assert.equal(body.data.total, 7);
    assert.equal(body.data.pages, 3);
    assert.deepEqual(body.data.enrollments.map(r => r.id), ['e3', 'e2', 'e1']);
  });

  it('clamps out-of-range paging inputs to the documented defaults', async () => {
    const db = await withRows(3);
    for (const [qs, expectPage, expectLimit] of [
      ['&page=0&limit=10', 1, 10],
      ['&page=-5&limit=10', 1, 10],
      ['&page=abc&limit=10', 1, 10],
      ['&limit=0', 1, 50],
      ['&limit=201', 1, 50],
      ['&limit=abc', 1, 50],
    ]) {
      const { body } = await parseResponse(await get(db, { url: LIST + qs }));
      assert.equal(body.data.page, expectPage, `page for "${qs}"`);
      assert.equal(body.data.pages, Math.ceil(3 / expectLimit), `pages for "${qs}"`);
    }
  });

  it('honours limit=200 and clamps limit=201 to 50, measured by rows returned', async () => {
    // Asserting `pages` alone cannot see this: with a handful of rows, ceil(n/200)
    // and ceil(n/20000) are both 1, so a widened cap survives. Seeding past the
    // default page size makes the clamp observable in the payload itself.
    const db = await withRows(60);
    const at200 = await parseResponse(await get(db, { url: `${LIST}&limit=200` }));
    assert.equal(at200.body.data.enrollments.length, 60, 'limit=200 is inside the accepted range');

    const at201 = await parseResponse(await get(db, { url: `${LIST}&limit=201` }));
    assert.equal(at201.body.data.enrollments.length, 50, 'limit=201 was not clamped to the default 50');
    assert.equal(at201.body.data.pages, 2);
  });

  it('filters by course_id on both the count and the page', async () => {
    const db = await seededDb((s) => {
      enroll(s, { id: 'x1', userId: MEMBER, courseId: 'wanted', enrolledAt: daysAgo(1) });
      enroll(s, { id: 'x2', userId: ADMIN, courseId: 'wanted', enrolledAt: daysAgo(2) });
      enroll(s, { id: 'y1', userId: MEMBER, courseId: 'other', enrolledAt: daysAgo(1) });
    });
    const { body } = await parseResponse(await get(db, { url: `${LIST}&course_id=wanted` }));
    assert.equal(body.data.total, 2);
    assert.deepEqual(body.data.enrollments.map(r => r.course_id), ['wanted', 'wanted']);
  });

  it('ignores an over-long course_id and falls back to the unfiltered query', async () => {
    const db = await seededDb((s) => {
      enroll(s, { id: 'x1', userId: MEMBER, courseId: 'wanted', enrolledAt: daysAgo(1) });
      enroll(s, { id: 'y1', userId: ADMIN, courseId: 'other', enrolledAt: daysAgo(2) });
    });
    const { body } = await parseResponse(await get(db, { url: `${LIST}&course_id=${'z'.repeat(201)}` }));
    assert.equal(body.data.total, 2, 'a 201-char course_id should be dropped, not matched');
  });

  it('binds course_id as a parameter -- a SQL fragment matches nothing', async () => {
    const db = await seededDb((s) => enroll(s, { id: 'x1', userId: MEMBER, courseId: 'wanted', enrolledAt: daysAgo(1) }));
    const injected = encodeURIComponent("' OR '1'='1");
    const { status, body } = await parseResponse(await get(db, { url: `${LIST}&course_id=${injected}` }));
    assert.equal(status, 200);
    assert.equal(body.data.total, 0);
    assert.deepEqual(body.data.enrollments, []);
  });

  it('500s generically and emits an admin log event when the list query fails', async () => {
    const db = await seededDb();
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE enrollment');

    const res = await enrollments.onRequestGet({
      request: mockRequest('GET', { url: LIST, headers: { Cookie: `session=${RAW.admin}` } }),
      env,
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.error, 'Database error');
    assert.ok(events.some(e => e.blobs.includes('enrollments_list_error')), 'the list failure was not logged');
  });
});
