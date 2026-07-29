/**
 * functions/api/courses/progress.js -- the training-analytics read/write path.
 *
 * WHY A REAL ENGINE HERE
 * This endpoint is what "who trained, and what did they complete" resolves to.
 * Its two hardest behaviours are pure SQL and invisible to a substring-matching
 * mock:
 *   - the correlated subquery in getProgressSummary that counts completed steps
 *     per enrollment, including the `sp.completed = 1` filter and the
 *     `revoked_at IS NULL` exclusion;
 *   - the ON CONFLICT upsert in handleProgressUpdate, whose whole contract is
 *     `completed = MAX(...)` (monotonic: once complete, never un-completes),
 *     `score = MAX(COALESCE(...))` (never regresses), and a CASE WHEN that
 *     leaves last_position_seconds alone when the caller omits it.
 * mockDB would return whatever the test declared for each of those, so the
 * assertions would be restatements of the fixture. Everything below runs on
 * node:sqlite loaded with the committed schema (test/_d1-sqlite.mjs).
 *
 * WHAT IS STILL FAKED, AND WHAT THAT CANNOT DISTINGUISH
 *  - src/data/courses.json is the deterministic fixture from
 *    test/_json-module-hook.mjs, not the deployed catalogue. These tests prove
 *    the endpoint's behaviour GIVEN a catalogue shape; they cannot prove the
 *    live catalogue has that shape. The CS1/CS2 courses-schema gates hold that.
 *  - Analytics Engine is the mockEnv stub, so `log()` is executed but its
 *    payload is only asserted where a test says so.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './_json-module-hook.mjs';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

const progress = await import('../functions/api/courses/progress.js');

const USER = 'u_learner';
const ADMIN = 'u_admin';
const RAW_SESSION = 'session-cookie-value-learner';
const RAW_ADMIN_SESSION = 'session-cookie-value-admin';
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

/** Builds the rrm-auth harness with a learner, a superadmin, and live sessions. */
async function seededDb(extra) {
  let db;
  const pending = [];
  db = sqliteD1({
    seed(sqlite) {
      insertUser(sqlite, { id: USER, email: 'learner@example.com', role: 'member' });
      insertUser(sqlite, { id: ADMIN, email: 'admin@example.com', role: 'superadmin' });
      if (extra) extra(sqlite);
    },
  });
  pending.push(insertSession(db._sqlite, { rawId: RAW_SESSION, userId: USER, expiresAt: FUTURE }));
  pending.push(insertSession(db._sqlite, { rawId: RAW_ADMIN_SESSION, userId: ADMIN, expiresAt: FUTURE }));
  await Promise.all(pending);
  return db;
}

function enroll(sqlite, { id, userId = USER, courseId, revokedAt = null, completedAt = null, certAt = null, enrolledAt = '2026-01-01T00:00:00.000Z' }) {
  sqlite.prepare(
    'INSERT INTO enrollment (id, user_id, course_id, enrolled_at, completed_at, certificate_issued_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, courseId, enrolledAt, completedAt, certAt, revokedAt);
}

function stepDone(sqlite, { userId = USER, courseId, stepId, completed = 1, score = null, pos = 0 }) {
  sqlite.prepare(
    'INSERT INTO step_progress (user_id, course_id, step_id, completed, score, last_position_seconds) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, courseId, stepId, completed, score, pos);
}

const cookie = (raw) => ({ Cookie: `session=${raw}` });

function ctx(db, request) {
  return { request, env: mockEnv({ DB: db }), waitUntil: mockWaitUntil() };
}

describe('GET /api/courses/progress -- summary', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });

  it('returns one row per live enrollment with a real completed-step count', async () => {
    enroll(db._sqlite, { id: 'e1', courseId: 'test-course-fixed', enrolledAt: '2026-02-01T00:00:00.000Z' });
    enroll(db._sqlite, { id: 'e2', courseId: 'test-course-basic', enrolledAt: '2026-01-01T00:00:00.000Z' });
    stepDone(db._sqlite, { courseId: 'test-course-fixed', stepId: 'fx-step-1', completed: 1 });
    stepDone(db._sqlite, { courseId: 'test-course-fixed', stepId: 'fx-step-2', completed: 1 });
    // Started but not finished: must NOT be counted.
    stepDone(db._sqlite, { courseId: 'test-course-fixed', stepId: 'fx-step-3', completed: 0, pos: 42 });

    const res = await progress.onRequestGet(ctx(db, mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/progress', headers: cookie(RAW_SESSION),
    })));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 200);
    // ORDER BY e.enrolled_at DESC -- newest first, decided by SQLite not by the fixture order.
    assert.deepEqual(body.courses.map(c => c.courseId), ['test-course-fixed', 'test-course-basic']);
    assert.equal(body.courses[0].completedSteps, 2);
    assert.equal(body.courses[0].totalSteps, 3);
    assert.equal(body.courses[1].completedSteps, 0);
    assert.equal(body.courses[0].accessType, 'members');
  });

  it('excludes revoked enrollments (a refunded learner is not a trained learner)', async () => {
    enroll(db._sqlite, { id: 'e1', courseId: 'test-course-basic' });
    enroll(db._sqlite, { id: 'e2', courseId: 'test-course-fixed', revokedAt: '2026-03-01T00:00:00.000Z' });

    const res = await progress.onRequestGet(ctx(db, mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/progress', headers: cookie(RAW_SESSION),
    })));
    const { body } = await parseResponse(res);
    assert.deepEqual(body.courses.map(c => c.courseId), ['test-course-basic']);
  });

  it('counts only the requesting user\'s own step progress', async () => {
    enroll(db._sqlite, { id: 'e1', courseId: 'test-course-fixed' });
    enroll(db._sqlite, { id: 'e2', userId: ADMIN, courseId: 'test-course-fixed' });
    stepDone(db._sqlite, { userId: ADMIN, courseId: 'test-course-fixed', stepId: 'fx-step-1' });
    stepDone(db._sqlite, { userId: ADMIN, courseId: 'test-course-fixed', stepId: 'fx-step-2' });

    const res = await progress.onRequestGet(ctx(db, mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/progress', headers: cookie(RAW_SESSION),
    })));
    const { body } = await parseResponse(res);
    assert.equal(body.courses.length, 1);
    assert.equal(body.courses[0].completedSteps, 0, 'another user\'s completions leaked into this report');
  });

  it('reports a course the catalogue no longer knows without throwing', async () => {
    enroll(db._sqlite, { id: 'e1', courseId: 'course-deleted-from-catalogue' });
    const res = await progress.onRequestGet(ctx(db, mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/progress', headers: cookie(RAW_SESSION),
    })));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 200);
    assert.equal(body.courses[0].totalSteps, 0);
    assert.equal(body.courses[0].accessType, null);
  });

  it('401s without a session cookie', async () => {
    const res = await progress.onRequestGet(ctx(db, mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/progress',
    })));
    assert.equal((await parseResponse(res)).status, 401);
  });

  it('500s when the DB binding is missing rather than returning an empty report', async () => {
    const res = await progress.onRequestGet({
      request: mockRequest('GET', { url: 'https://rrmacademy.org/api/courses/progress' }),
      env: mockEnv({ DB: undefined }),
      waitUntil: mockWaitUntil(),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.ok, false);
  });

  it('logs and 500s on a database error instead of leaking the message', async () => {
    const env = mockEnv({ DB: db });
    const waitUntil = mockWaitUntil();
    const events = [];
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE enrollment');

    const res = await progress.onRequestGet({
      request: mockRequest('GET', { url: 'https://rrmacademy.org/api/courses/progress', headers: cookie(RAW_SESSION) }),
      env, waitUntil,
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(!JSON.stringify(body).includes('no such table'), 'SQL error text reached the client');
    assert.ok(events.some(e => e.blobs.includes('progress_error')), 'the failure was not logged');
  });
});

describe('GET /api/courses/progress?courseId= -- detail', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });

  it('returns per-step state with completed coerced to boolean', async () => {
    enroll(db._sqlite, { id: 'e1', courseId: 'test-course-fixed', completedAt: '2026-04-01T00:00:00.000Z' });
    stepDone(db._sqlite, { courseId: 'test-course-fixed', stepId: 'fx-step-1', completed: 1, score: 90, pos: 120 });
    stepDone(db._sqlite, { courseId: 'test-course-fixed', stepId: 'fx-step-2', completed: 0, pos: 7 });

    const res = await progress.onRequestGet(ctx(db, mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/progress?courseId=test-course-fixed', headers: cookie(RAW_SESSION),
    })));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 200);
    assert.equal(body.enrollment.completedAt, '2026-04-01T00:00:00.000Z');
    assert.deepEqual(body.steps['fx-step-1'], {
      completed: true, score: 90, lastPositionSeconds: 120, updatedAt: body.steps['fx-step-1'].updatedAt,
    });
    assert.equal(body.steps['fx-step-2'].completed, false);
    assert.equal(body.steps['fx-step-3'], undefined);
  });

  it('404s for a course id that is not in the catalogue', async () => {
    const res = await progress.onRequestGet(ctx(db, mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/progress?courseId=nope', headers: cookie(RAW_SESSION),
    })));
    assert.equal((await parseResponse(res)).status, 404);
  });

  it('403s when the learner is not enrolled', async () => {
    const res = await progress.onRequestGet(ctx(db, mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/progress?courseId=test-course-fixed', headers: cookie(RAW_SESSION),
    })));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 403);
    assert.equal(body.error, 'Not enrolled');
  });

  it('403s when the enrollment exists but was revoked', async () => {
    enroll(db._sqlite, { id: 'e1', courseId: 'test-course-fixed', revokedAt: '2026-03-01T00:00:00.000Z' });
    const res = await progress.onRequestGet(ctx(db, mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/progress?courseId=test-course-fixed', headers: cookie(RAW_SESSION),
    })));
    assert.equal((await parseResponse(res)).status, 403);
  });

  it('auto-enrolls a superadmin on first access and un-revokes on return', async () => {
    const url = 'https://rrmacademy.org/api/courses/progress?courseId=test-course-fixed';
    const first = await progress.onRequestGet(ctx(db, mockRequest('GET', { url, headers: cookie(RAW_ADMIN_SESSION) })));
    assert.equal((await parseResponse(first)).status, 200);

    const row = db._sqlite.prepare('SELECT revoked_at FROM enrollment WHERE user_id = ? AND course_id = ?')
      .get(ADMIN, 'test-course-fixed');
    assert.ok(row, 'superadmin was not auto-enrolled');

    db._sqlite.prepare('UPDATE enrollment SET revoked_at = ? WHERE user_id = ?').run('2026-05-01T00:00:00.000Z', ADMIN);
    const second = await progress.onRequestGet(ctx(db, mockRequest('GET', { url, headers: cookie(RAW_ADMIN_SESSION) })));
    assert.equal((await parseResponse(second)).status, 200, 'ON CONFLICT DO UPDATE SET revoked_at = NULL did not fire');
    const after = db._sqlite.prepare('SELECT revoked_at FROM enrollment WHERE user_id = ? AND course_id = ?')
      .get(ADMIN, 'test-course-fixed');
    assert.equal(after.revoked_at, null);
  });

  it('does NOT auto-enroll a superadmin into an affiliate course', async () => {
    const res = await progress.onRequestGet(ctx(db, mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/progress?courseId=test-course-affiliate', headers: cookie(RAW_ADMIN_SESSION),
    })));
    assert.equal((await parseResponse(res)).status, 403);
    const row = db._sqlite.prepare('SELECT id FROM enrollment WHERE user_id = ?').get(ADMIN);
    assert.equal(row, undefined, 'affiliate course must not create a local enrollment row');
  });

  it('does not auto-enroll a plain member', async () => {
    const res = await progress.onRequestGet(ctx(db, mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/progress?courseId=test-course-fixed', headers: cookie(RAW_SESSION),
    })));
    assert.equal((await parseResponse(res)).status, 403);
    assert.equal(db._sqlite.prepare('SELECT id FROM enrollment WHERE user_id = ?').get(USER), undefined);
  });
});

describe('PATCH /api/courses/progress -- validation', () => {
  let db;
  beforeEach(async () => { db = await seededDb((s) => enroll(s, { id: 'e1', courseId: 'test-course-basic' })); });

  const patch = (body, headers = cookie(RAW_SESSION)) => progress.onRequestPatch(ctx(db,
    mockRequest('PATCH', { url: 'https://rrmacademy.org/api/courses/progress', body, headers })));

  it('401s without a session', async () => {
    assert.equal((await parseResponse(await patch({ courseId: 'x', stepId: 'y' }, {}))).status, 401);
  });

  it('400s on unparseable JSON', async () => {
    const res = await progress.onRequestPatch(ctx(db, mockRequest('PATCH', {
      url: 'https://rrmacademy.org/api/courses/progress', rawBody: '{oops', headers: cookie(RAW_SESSION),
    })));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('400s on an array payload', async () => {
    const res = await progress.onRequestPatch(ctx(db, mockRequest('PATCH', {
      url: 'https://rrmacademy.org/api/courses/progress', rawBody: '[1,2]', headers: cookie(RAW_SESSION),
    })));
    assert.equal((await parseResponse(res)).body.error, 'Invalid payload');
  });

  it('400s when courseId or stepId is missing', async () => {
    assert.equal((await parseResponse(await patch({ stepId: 'step-1' }))).status, 400);
    assert.equal((await parseResponse(await patch({ courseId: 'test-course-basic' }))).status, 400);
  });

  it('400s when completed is not a boolean', async () => {
    const { body } = await parseResponse(await patch({ courseId: 'test-course-basic', stepId: 'step-1', completed: 'yes' }));
    assert.equal(body.error, 'completed must be a boolean');
  });

  it('accepts score 0 and 100 and rejects the values just outside', async () => {
    for (const score of [0, 100]) {
      const { status } = await parseResponse(await patch({ courseId: 'test-course-basic', stepId: 'step-1', score }));
      assert.equal(status, 200, `score ${score} should be accepted`);
    }
    for (const score of [-1, 101, Number.NaN, Infinity, '90']) {
      const { status, body } = await parseResponse(await patch({ courseId: 'test-course-basic', stepId: 'step-1', score }));
      assert.equal(status, 400, `score ${String(score)} should be rejected`);
      assert.equal(body.error, 'score must be a number 0-100');
    }
  });

  it('accepts lastPositionSeconds 0 and 86400 and rejects the values just outside', async () => {
    for (const pos of [0, 86400]) {
      const { status } = await parseResponse(await patch({ courseId: 'test-course-basic', stepId: 'step-1', lastPositionSeconds: pos }));
      assert.equal(status, 200, `position ${pos} should be accepted`);
    }
    for (const pos of [-1, 86401, Number.NaN]) {
      const { status, body } = await parseResponse(await patch({ courseId: 'test-course-basic', stepId: 'step-1', lastPositionSeconds: pos }));
      assert.equal(status, 400, `position ${pos} should be rejected`);
      assert.equal(body.error, 'lastPositionSeconds must be a number 0-86400');
    }
  });

  it('404s for an unknown course and 400s for a step outside that course', async () => {
    assert.equal((await parseResponse(await patch({ courseId: 'nope', stepId: 'step-1' }))).status, 404);
    const { status, body } = await parseResponse(await patch({ courseId: 'test-course-basic', stepId: 'fx-step-1' }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid step');
  });
});

describe('PATCH /api/courses/progress -- upsert semantics', () => {
  let db;
  beforeEach(async () => { db = await seededDb((s) => enroll(s, { id: 'e1', courseId: 'test-course-fixed' })); });

  const patch = (body) => progress.onRequestPatch(ctx(db,
    mockRequest('PATCH', { url: 'https://rrmacademy.org/api/courses/progress', body, headers: cookie(RAW_SESSION) })));

  const row = (stepId) => db._sqlite
    .prepare('SELECT completed, score, last_position_seconds FROM step_progress WHERE user_id = ? AND course_id = ? AND step_id = ?')
    .get(USER, 'test-course-fixed', stepId);

  it('inserts on first write with COALESCE defaulting position to 0', async () => {
    const { status } = await parseResponse(await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', score: 55 }));
    assert.equal(status, 200);
    assert.deepEqual({ ...row('fx-step-1') }, { completed: 0, score: 55, last_position_seconds: 0 });
  });

  it('completion is monotonic: a later completed:false does not un-complete', async () => {
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', completed: true });
    assert.equal(row('fx-step-1').completed, 1);
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', completed: false });
    assert.equal(row('fx-step-1').completed, 1, 'MAX(step_progress.completed, ?) regressed');
  });

  it('score never regresses, and omitting score preserves it', async () => {
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', score: 90 });
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', score: 40 });
    assert.equal(row('fx-step-1').score, 90, 'MAX(COALESCE(...)) let a worse score overwrite a better one');
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', lastPositionSeconds: 10 });
    assert.equal(row('fx-step-1').score, 90);
  });

  it('omitting lastPositionSeconds preserves the stored position; sending it overwrites', async () => {
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', lastPositionSeconds: 300 });
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', score: 10 });
    assert.equal(row('fx-step-1').last_position_seconds, 300, 'the CASE WHEN clobbered a position the caller did not send');
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', lastPositionSeconds: 12 });
    assert.equal(row('fx-step-1').last_position_seconds, 12);
    // Rewinding to 0 must stick: 0 is a value, not "absent".
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', lastPositionSeconds: 0 });
    assert.equal(row('fx-step-1').last_position_seconds, 0, '0 was treated as omitted');
  });
});

describe('PATCH /api/courses/progress -- step locking and completion', () => {
  let db;
  beforeEach(async () => { db = await seededDb((s) => enroll(s, { id: 'e1', courseId: 'test-course-fixed' })); });

  const patch = (body) => progress.onRequestPatch(ctx(db,
    mockRequest('PATCH', { url: 'https://rrmacademy.org/api/courses/progress', body, headers: cookie(RAW_SESSION) })));

  it('refuses a later step while its predecessor is incomplete', async () => {
    const { status, body } = await parseResponse(await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-2', completed: true }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Previous step not completed');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) c FROM step_progress').get().c, 0, 'a refused write still landed');
  });

  it('refuses when the predecessor row exists but completed = 0', async () => {
    stepDone(db._sqlite, { courseId: 'test-course-fixed', stepId: 'fx-step-1', completed: 0, pos: 5 });
    assert.equal((await parseResponse(await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-2' }))).status, 403);
  });

  it('allows the first step unconditionally (no predecessor)', async () => {
    assert.equal((await parseResponse(await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1' }))).status, 200);
  });

  it('does not lock steps for a course without fixed step order', async () => {
    db._sqlite.prepare('INSERT INTO enrollment (id, user_id, course_id) VALUES (?, ?, ?)').run('e2', USER, 'test-course-basic');
    assert.equal((await parseResponse(await patch({ courseId: 'test-course-basic', stepId: 'step-1', completed: true }))).status, 200);
  });

  it('completing the final step marks the course complete but issues no certificate below 80', async () => {
    for (const [stepId, score] of [['fx-step-1', null], ['fx-step-2', null], ['fx-step-3', 79]]) {
      await patch({ courseId: 'test-course-fixed', stepId, completed: true, ...(score === null ? {} : { score }) });
    }
    const enrollment = db._sqlite.prepare('SELECT completed_at, certificate_issued_at FROM enrollment WHERE id = ?').get('e1');
    assert.ok(enrollment.completed_at, 'course completion was not recorded');
    assert.equal(enrollment.certificate_issued_at, null, 'certificate issued on a failing quiz score');
  });

  it('issues the certificate at exactly the 80 boundary and reports it once', async () => {
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', completed: true });
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-2', completed: true });
    const { body } = await parseResponse(await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-3', completed: true, score: 80 }));
    assert.equal(body.courseCompleted, true);
    assert.equal(body.certificateIssued, true);

    const issuedAt = db._sqlite.prepare('SELECT certificate_issued_at FROM enrollment WHERE id = ?').get('e1').certificate_issued_at;
    assert.ok(issuedAt);
    // Re-completing must not re-stamp: the UPDATE is guarded by IS NULL.
    const again = await parseResponse(await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-3', completed: true, score: 95 }));
    assert.equal(again.body.certificateIssued, true, 'handler reports the current state');
    assert.equal(
      db._sqlite.prepare('SELECT certificate_issued_at FROM enrollment WHERE id = ?').get('e1').certificate_issued_at,
      issuedAt,
      'certificate_issued_at was re-stamped on a repeat completion'
    );
  });

  it('does not run the completion check when completed is falsy', async () => {
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-1', completed: true });
    await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-2', completed: true });
    const { body } = await parseResponse(await patch({ courseId: 'test-course-fixed', stepId: 'fx-step-3', lastPositionSeconds: 5 }));
    assert.equal(body.courseCompleted, false);
    assert.equal(db._sqlite.prepare('SELECT completed_at FROM enrollment WHERE id = ?').get('e1').completed_at, null);
  });

  it('500s and logs when the upsert throws', async () => {
    const env = mockEnv({ DB: db });
    const events = [];
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE step_progress');
    const res = await progress.onRequestPatch({
      request: mockRequest('PATCH', {
        url: 'https://rrmacademy.org/api/courses/progress',
        body: { courseId: 'test-course-fixed', stepId: 'fx-step-1' },
        headers: cookie(RAW_SESSION),
      }),
      env, waitUntil: mockWaitUntil(),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(events.some(e => e.blobs.includes('progress_error')));
  });
});

describe('OPTIONS /api/courses/progress', () => {
  it('answers the preflight with 204 and the locked-down origin', async () => {
    const res = await progress.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});
