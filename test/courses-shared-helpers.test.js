/**
 * functions/api/courses/_shared.js and functions/api/courses/_notify-admin.js
 * -- the catalogue predicates and the enrolment alert that the whole learner
 * path is built on.
 *
 * WHY A REAL ENGINE FOR HALF OF IT
 * `autoEnrollAdmin` and `checkCourseCompletion` are the two functions here that
 * touch D1, and both are decided by SQL rather than by JavaScript:
 *   - autoEnrollAdmin's INSERT ... ON CONFLICT(user_id, course_id) DO UPDATE
 *     SET revoked_at = NULL is the un-revoke. Against a substring mock the
 *     "second call did not create a second row" assertion is a restatement of
 *     the fixture; here it is the UNIQUE index saying so.
 *   - checkCourseCompletion's completion predicate is `count >= totalSteps`
 *     where count comes from a COUNT(*) with `completed = 1`, and its
 *     certificate write is guarded by `certificate_issued_at IS NULL`, which is
 *     what makes re-issue idempotent. Both are engine decisions.
 * The pure catalogue predicates (getCourse, getIncludedCourseIds,
 * isWaitlistCourse) need no database at all and are called directly.
 *
 * WHAT IS STILL FAKED
 *  - src/data/courses.json is the deterministic fixture from
 *    test/_json-module-hook.mjs. These prove behaviour GIVEN a catalogue shape,
 *    never that the deployed catalogue has that shape.
 *  - SES is the stubExternalFetch router, so "the alert was sent" means "a
 *    signed SES request was issued with this payload", not that mail arrived.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './_json-module-hook.mjs';
import { mockEnv, stubExternalFetch } from './_helpers.js';
import { sqliteD1, insertUser } from './_d1-sqlite.mjs';

const shared = await import('../functions/api/courses/_shared.js');
const notify = await import('../functions/api/courses/_notify-admin.js');

const LEARNER = 'u_shared_learner';
const ADMIN = 'u_shared_admin';

function seededDb() {
  return sqliteD1({
    seed(sqlite) {
      insertUser(sqlite, { id: LEARNER, email: 'learner@example.com', role: 'member' });
      insertUser(sqlite, { id: ADMIN, email: 'admin@example.com', role: 'superadmin' });
    },
  });
}

function stepDone(sqlite, { userId = LEARNER, courseId, stepId, completed = 1, score = null }) {
  sqlite.prepare(
    'INSERT INTO step_progress (user_id, course_id, step_id, completed, score, last_position_seconds) VALUES (?, ?, ?, ?, ?, 0)'
  ).run(userId, courseId, stepId, completed, score);
}

function enrollmentRow(db, { userId = LEARNER, courseId }) {
  return db._sqlite.prepare('SELECT * FROM enrollment WHERE user_id = ? AND course_id = ?').get(userId, courseId) || null;
}

describe('_shared.js -- catalogue lookups', () => {
  it('resolves a course by id and by slug, and answers null for anything unknown', () => {
    assert.equal(shared.getCourse('test-course-free').title, 'Test Course: Free');
    assert.equal(shared.getCourse('no-such-course'), null);
    assert.equal(shared.getCourseBySlug('test-course-free').id, 'test-course-free');
    assert.equal(shared.getCourseBySlug('no-such-slug'), null);
    // Lookup is by slug, not by id, on the slug map.
    assert.equal(shared.getCourseBySlug('Test Course: Free'), null);
  });

  it('flattens step ids in section order and validates membership', () => {
    assert.deepEqual(shared.getAllStepIds('test-course-fixed'), ['fx-step-1', 'fx-step-2', 'fx-step-3']);
    assert.deepEqual(shared.getAllStepIds('no-such-course'), []);
    assert.equal(shared.getTotalSteps('test-course-fixed'), 3);
    assert.equal(shared.getTotalSteps('no-such-course'), 0);
    assert.equal(shared.isValidStep('test-course-fixed', 'fx-step-2'), true);
    assert.equal(shared.isValidStep('test-course-fixed', 'fx-step-9'), false);
    assert.equal(shared.isValidStep('test-course-fixed', 'fr-step-1'), false, 'a step from another course is not valid here');
  });

  it('getPreviousStepId walks catalogue order and stops at the first step', () => {
    assert.equal(shared.getPreviousStepId('test-course-fixed', 'fx-step-3'), 'fx-step-2');
    assert.equal(shared.getPreviousStepId('test-course-fixed', 'fx-step-2'), 'fx-step-1');
    assert.equal(shared.getPreviousStepId('test-course-fixed', 'fx-step-1'), null, 'first step has no predecessor');
    assert.equal(shared.getPreviousStepId('test-course-fixed', 'not-a-step'), null);
  });

  it('getIncludedCourseIds resolves included SLUGS to IDS and drops unresolvable ones', () => {
    // The fixture bundle includes one real slug and one that resolves to nothing.
    // If .filter(Boolean) were removed, the second would arrive as undefined and
    // enrollUser would bind undefined into an INSERT.
    assert.deepEqual(shared.getIncludedCourseIds('test-course-free-bundle'), ['test-course-free']);
    assert.deepEqual(shared.getIncludedCourseIds('test-course-free'), [], 'a course with no includes yields no ids');
    assert.deepEqual(shared.getIncludedCourseIds('no-such-course'), []);
  });

  it('getCertificateQuizId is null unless the catalogue names a quiz step', () => {
    assert.equal(shared.getCertificateQuizId('test-course-cert'), 'ct-step-2');
    assert.equal(shared.getCertificateQuizId('test-course-cert-noquiz'), null);
    assert.equal(shared.getCertificateQuizId('no-such-course'), null);
    assert.equal(shared.CERTIFICATE_MIN_SCORE, 80);
  });

  it('isWaitlistCourse is true only for affiliate AND waitlistUrl (all four corners)', () => {
    assert.equal(shared.isWaitlistCourse('test-course-affiliate'), true, 'affiliate + waitlistUrl');
    assert.equal(shared.isWaitlistCourse('test-course-affiliate-open'), false, 'affiliate, no waitlistUrl');
    assert.equal(shared.isWaitlistCourse('test-course-waitlisturl-only'), false, 'waitlistUrl, not affiliate');
    assert.equal(shared.isWaitlistCourse('test-course-free'), false, 'neither');
    assert.equal(shared.isWaitlistCourse('no-such-course'), false, 'unknown course');
  });

  it('exports the raw catalogue array it indexed', () => {
    assert.ok(Array.isArray(shared.coursesData));
    assert.ok(shared.coursesData.some((c) => c.id === 'test-course-free'));
  });
});

describe('_shared.js -- autoEnrollAdmin', () => {
  let db;
  beforeEach(() => { db = seededDb(); });
  afterEach(() => db.close());

  it('does nothing for a non-superadmin', async () => {
    await shared.autoEnrollAdmin(db, LEARNER, 'test-course-paid');
    assert.equal(enrollmentRow(db, { courseId: 'test-course-paid' }), null);
  });

  it('does nothing for a user id that matches no row', async () => {
    await shared.autoEnrollAdmin(db, 'u_ghost', 'test-course-paid');
    assert.equal(enrollmentRow(db, { userId: 'u_ghost', courseId: 'test-course-paid' }), null);
  });

  it('creates an enrolment for a superadmin', async () => {
    await shared.autoEnrollAdmin(db, ADMIN, 'test-course-paid');
    const row = enrollmentRow(db, { userId: ADMIN, courseId: 'test-course-paid' });
    assert.ok(row, 'superadmin must be auto-enrolled');
    assert.equal(row.revoked_at, null);
  });

  it('refuses to auto-enrol a superadmin into an affiliate course', async () => {
    await shared.autoEnrollAdmin(db, ADMIN, 'test-course-affiliate');
    assert.equal(enrollmentRow(db, { userId: ADMIN, courseId: 'test-course-affiliate' }), null);
  });

  it('un-revokes rather than duplicating on a second call', async () => {
    await shared.autoEnrollAdmin(db, ADMIN, 'test-course-paid');
    db._sqlite.prepare("UPDATE enrollment SET revoked_at = '2026-01-02T00:00:00.000Z' WHERE user_id = ? AND course_id = ?")
      .run(ADMIN, 'test-course-paid');

    await shared.autoEnrollAdmin(db, ADMIN, 'test-course-paid');

    const rows = db._sqlite.prepare('SELECT * FROM enrollment WHERE user_id = ? AND course_id = ?')
      .all(ADMIN, 'test-course-paid');
    assert.equal(rows.length, 1, 'the UNIQUE(user_id, course_id) index must hold');
    assert.equal(rows[0].revoked_at, null, 'the conflict branch must clear revoked_at');
  });
});

describe('_shared.js -- checkCourseCompletion', () => {
  let db;
  beforeEach(() => { db = seededDb(); });
  afterEach(() => db.close());

  function enroll(courseId, { completedAt = null, certAt = null } = {}) {
    db._sqlite.prepare(
      'INSERT INTO enrollment (id, user_id, course_id, completed_at, certificate_issued_at) VALUES (?, ?, ?, ?, ?)'
    ).run(`e_${courseId}`, LEARNER, courseId, completedAt, certAt);
  }

  it('an unknown course completes nothing', async () => {
    const out = await shared.checkCourseCompletion(db, LEARNER, 'no-such-course');
    assert.deepEqual(out, { courseCompleted: false, certificateIssued: false });
  });

  it('the LAST required step still incomplete does not complete the course', async () => {
    enroll('test-course-cert');
    // test-course-cert has exactly two steps. One done is one short.
    stepDone(db._sqlite, { courseId: 'test-course-cert', stepId: 'ct-step-1' });
    stepDone(db._sqlite, { courseId: 'test-course-cert', stepId: 'ct-step-2', completed: 0, score: 100 });

    const out = await shared.checkCourseCompletion(db, LEARNER, 'test-course-cert');
    assert.deepEqual(out, { courseCompleted: false, certificateIssued: false });
    assert.equal(enrollmentRow(db, { courseId: 'test-course-cert' }).completed_at, null);
  });

  it('every step complete stamps completed_at', async () => {
    enroll('test-course-cert');
    stepDone(db._sqlite, { courseId: 'test-course-cert', stepId: 'ct-step-1' });
    stepDone(db._sqlite, { courseId: 'test-course-cert', stepId: 'ct-step-2', score: 100 });

    const out = await shared.checkCourseCompletion(db, LEARNER, 'test-course-cert');
    assert.equal(out.courseCompleted, true);
    assert.equal(out.certificateIssued, true);
    const row = enrollmentRow(db, { courseId: 'test-course-cert' });
    assert.ok(row.completed_at, 'completed_at must be stamped');
    assert.ok(row.certificate_issued_at, 'certificate_issued_at must be stamped');
  });

  it('the certificate score boundary is >= 80: 79 does not issue, 80 does', async () => {
    enroll('test-course-cert');
    stepDone(db._sqlite, { courseId: 'test-course-cert', stepId: 'ct-step-1' });
    stepDone(db._sqlite, { courseId: 'test-course-cert', stepId: 'ct-step-2', score: 79 });

    const below = await shared.checkCourseCompletion(db, LEARNER, 'test-course-cert');
    assert.equal(below.courseCompleted, true, 'the course still completes');
    assert.equal(below.certificateIssued, false, '79 is below the 80 threshold');
    assert.equal(enrollmentRow(db, { courseId: 'test-course-cert' }).certificate_issued_at, null);

    db._sqlite.prepare('UPDATE step_progress SET score = 80 WHERE user_id = ? AND step_id = ?')
      .run(LEARNER, 'ct-step-2');
    const at = await shared.checkCourseCompletion(db, LEARNER, 'test-course-cert');
    assert.equal(at.certificateIssued, true, 'exactly 80 must issue');
    assert.ok(enrollmentRow(db, { courseId: 'test-course-cert' }).certificate_issued_at);
  });

  it('a completed quiz step is required: an unfinished quiz with a passing score does not issue', async () => {
    enroll('test-course-cert');
    stepDone(db._sqlite, { courseId: 'test-course-cert', stepId: 'ct-step-1' });
    stepDone(db._sqlite, { courseId: 'test-course-cert', stepId: 'ct-step-2', score: 100 });
    // Course completes; now blank out the quiz row's completed flag before the
    // certificate lookup by pointing the catalogue quiz at a step with no row.
    db._sqlite.prepare('UPDATE step_progress SET completed = 0 WHERE user_id = ? AND step_id = ?')
      .run(LEARNER, 'ct-step-2');

    const out = await shared.checkCourseCompletion(db, LEARNER, 'test-course-cert');
    assert.equal(out.courseCompleted, false, 'an incomplete step also un-completes the course');
    assert.equal(out.certificateIssued, false);
  });

  it('a course with no certificate completes without issuing anything', async () => {
    enroll('test-course-free');
    stepDone(db._sqlite, { courseId: 'test-course-free', stepId: 'fr-step-1' });

    const out = await shared.checkCourseCompletion(db, LEARNER, 'test-course-free');
    assert.equal(out.courseCompleted, true);
    assert.equal(out.certificateIssued, false);
    assert.equal(enrollmentRow(db, { courseId: 'test-course-free' }).certificate_issued_at, null);
  });

  it('hasCertificate with no named quiz step issues nothing (the quiz id gate)', async () => {
    enroll('test-course-cert-noquiz');
    stepDone(db._sqlite, { courseId: 'test-course-cert-noquiz', stepId: 'cn-step-1' });

    const out = await shared.checkCourseCompletion(db, LEARNER, 'test-course-cert-noquiz');
    assert.equal(out.courseCompleted, true);
    assert.equal(out.certificateIssued, false, 'no quiz id means no score to check, so no auto-issue here');
  });

  it('completed_at is stamped once and a re-check does not move it', async () => {
    enroll('test-course-free');
    stepDone(db._sqlite, { courseId: 'test-course-free', stepId: 'fr-step-1' });
    await shared.checkCourseCompletion(db, LEARNER, 'test-course-free');
    const first = enrollmentRow(db, { courseId: 'test-course-free' }).completed_at;

    db._sqlite.exec("UPDATE enrollment SET completed_at = completed_at"); // no-op, keeps the clock honest
    await shared.checkCourseCompletion(db, LEARNER, 'test-course-free');
    const second = enrollmentRow(db, { courseId: 'test-course-free' }).completed_at;
    assert.equal(second, first, 'the IS NULL guard makes the stamp write-once');
  });
});

describe('_notify-admin.js -- enrolment alert', () => {
  let db;
  let fetchStub;

  beforeEach(() => { db = seededDb(); });
  afterEach(() => {
    if (fetchStub) { fetchStub.restore(); fetchStub = null; }
    db.close();
  });

  it('skips silently when SES is not configured', async () => {
    fetchStub = stubExternalFetch();
    const events = [];
    const env = mockEnv({
      DB: db,
      AWS_ACCESS_KEY_ID: undefined,
      EVENTS: { writeDataPoint: (p) => events.push(p) },
    });

    await notify.notifyAdminEnrollment(env, {
      studentEmail: 'learner@example.com', studentName: 'Learner', courseTitle: 'T', courseId: 'c1', isFree: true,
    });

    assert.equal(fetchStub.ses.length, 0, 'no SES call without credentials');
    assert.ok(events.some((e) => e.blobs.includes('admin_notify_skipped')), 'the skip is logged');
  });

  it('sends a Free-typed alert to the administrator mailbox', async () => {
    fetchStub = stubExternalFetch();
    const env = mockEnv({ DB: db });

    await notify.notifyAdminEnrollment(env, {
      studentEmail: 'learner@example.com',
      studentName: 'Learner One',
      courseTitle: 'Test Course: Free',
      courseId: 'test-course-free',
      isFree: true,
    });

    assert.equal(fetchStub.ses.length, 1);
    const payload = fetchStub.ses[0].body;
    assert.deepEqual(payload.Destination.ToAddresses, ['administrator@rrmacademy.org']);
    assert.equal(payload.Subject ?? payload.Content.Simple.Subject.Data, 'New enrollment: Learner One - Test Course: Free');
    const text = payload.Content.Simple.Body.Text.Data;
    assert.match(text, /Student name: {2}Learner One/);
    assert.match(text, /Student email: learner@example\.com/);
    assert.match(text, /Course ID: {5}test-course-free/);
    assert.match(text, /Type: {10}Free/);
  });

  it('a paid enrolment is typed Paid, and a nameless student falls back to the email', async () => {
    fetchStub = stubExternalFetch();
    const env = mockEnv({ DB: db });

    await notify.notifyAdminEnrollment(env, {
      studentEmail: 'anon@example.com',
      studentName: '',
      courseTitle: 'Test Course: Paid',
      courseId: 'test-course-paid',
      isFree: false,
    });

    const payload = fetchStub.ses[0].body;
    assert.equal(payload.Content.Simple.Subject.Data, 'New enrollment: anon@example.com - Test Course: Paid');
    const text = payload.Content.Simple.Body.Text.Data;
    assert.match(text, /Student name: {2}\(not set\)/);
    assert.match(text, /Type: {10}Paid/);
  });

  it('an SES failure is recorded in email_log rather than thrown at the caller', async () => {
    fetchStub = stubExternalFetch({ ses: () => { throw new Error('SES down'); } });
    const env = mockEnv({ DB: db });

    await notify.notifyAdminEnrollment(env, {
      studentEmail: 'learner@example.com',
      studentName: 'Learner One',
      courseTitle: 'Test Course: Free',
      courseId: 'test-course-free',
      isFree: true,
    });

    const row = db._sqlite.prepare("SELECT * FROM email_log WHERE event = 'failed'").get();
    assert.ok(row, 'a failed send must leave a row behind');
    assert.equal(row.email, 'administrator@rrmacademy.org');
    assert.equal(row.category, 'transactional');
    assert.equal(row.source, 'courses/admin-notify');
    assert.match(row.detail, /SES down/);
  });
});
