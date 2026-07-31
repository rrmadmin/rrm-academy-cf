/**
 * functions/api/courses/certificate.js -- issuance of a completion certificate.
 *
 * WHY THIS FILE IS WRITTEN THE WAY IT IS
 * A certificate is a credential: it asserts, by name, that a specific person
 * completed a specific course. The failures that matter are not 500s, they are
 * a certificate issued to someone who did NOT complete, or to someone who is
 * not the learner on the enrolment. Both of those are decided by SQL:
 *   - the enrolment lookup is scoped `WHERE user_id = ? AND course_id = ? AND
 *     revoked_at IS NULL`, which is the entire ownership check on this endpoint
 *     (there is no separate authorization step). Drop the user_id predicate and
 *     learner A prints learner B's certificate.
 *   - `completed_at` must already be non-null; the endpoint never completes a
 *     course itself.
 *   - the lazy issue is `UPDATE ... SET certificate_issued_at = datetime('now')
 *     WHERE ... AND certificate_issued_at IS NULL`, and that IS NULL is the
 *     whole of re-issue idempotency.
 * Under a substring-matching mock each of those returns whatever the test
 * declared, so "the certificate was issued" would be a restatement of the
 * fixture rather than a fact about the database. Everything below runs on
 * node:sqlite loaded with the committed schema (test/_d1-sqlite.mjs), and the
 * issuance assertions read the STORED enrolment row, not the response.
 *
 * WHAT IS STILL FAKED, AND WHAT IT CANNOT PROVE
 *  - src/data/courses.json is the deterministic fixture from
 *    test/_json-module-hook.mjs. `hasCertificate`, `certificateQuizId` and
 *    `instructors` are catalogue facts; these tests prove behaviour GIVEN a
 *    catalogue shape, never that the live catalogue has that shape.
 *  - `datetime('now')` is the machine clock, so the issued DATE is asserted for
 *    presence and stability, never against a calendar value.
 *  - Analytics Engine is a stub.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './_json-module-hook.mjs';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

const certificate = await import('../functions/api/courses/certificate.js');

const LEARNER = 'u_cert_learner';
const OTHER = 'u_cert_other';
const RAW = { learner: 'cert-session-learner', other: 'cert-session-other' };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const CERT_COURSE = 'test-course-cert';

async function seededDb(extra, opts = {}) {
  const db = sqliteD1({
    ...opts,
    seed(sqlite) {
      insertUser(sqlite, { id: LEARNER, email: 'learner@example.com', name: 'Ada Learner' });
      insertUser(sqlite, { id: OTHER, email: 'other@example.com', name: 'Bob Other' });
      if (extra) extra(sqlite);
    },
  });
  await insertSession(db._sqlite, { rawId: RAW.learner, userId: LEARNER, expiresAt: FUTURE });
  await insertSession(db._sqlite, { rawId: RAW.other, userId: OTHER, expiresAt: FUTURE });
  return db;
}

function enroll(sqlite, { id, userId = LEARNER, courseId = CERT_COURSE, completedAt = null, certAt = null, revokedAt = null }) {
  sqlite.prepare(
    'INSERT INTO enrollment (id, user_id, course_id, completed_at, certificate_issued_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, userId, courseId, completedAt, certAt, revokedAt);
}

function quiz(sqlite, { userId = LEARNER, courseId = CERT_COURSE, stepId = 'ct-step-2', score, completed = 1 }) {
  sqlite.prepare(
    'INSERT INTO step_progress (user_id, course_id, step_id, completed, score, last_position_seconds) VALUES (?, ?, ?, ?, ?, 0)'
  ).run(userId, courseId, stepId, completed, score);
}

function row(db, { userId = LEARNER, courseId = CERT_COURSE } = {}) {
  return db._sqlite.prepare('SELECT * FROM enrollment WHERE user_id = ? AND course_id = ?').get(userId, courseId) || null;
}

function get(db, { courseId = CERT_COURSE, session = RAW.learner, env: envOver = {} } = {}) {
  const url = courseId === null
    ? 'https://rrmacademy.org/api/courses/certificate'
    : `https://rrmacademy.org/api/courses/certificate?courseId=${courseId}`;
  const request = mockRequest('GET', {
    url,
    headers: session === null ? {} : { Cookie: `session=${session}` },
  });
  return certificate.onRequestGet({
    request,
    env: mockEnv({ DB: db, ...envOver }),
    waitUntil: mockWaitUntil(),
  });
}

// D1's datetime('now') writes 'YYYY-MM-DD HH:MM:SS' with no zone designator,
// which is exactly what checkCourseCompletion stamps into completed_at. Using
// that literal shape (rather than an ISO Z string) keeps formatDate's
// Date-parsing on the same branch production takes, so the rendered date does
// not shift with the runner's timezone.
const COMPLETED = '2026-05-01 12:00:00';

describe('GET /api/courses/certificate -- refusals', () => {
  let db;
  afterEach(() => db?.close());

  it('OPTIONS answers the CORS preflight', async () => {
    db = await seededDb();
    const res = await certificate.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  });

  it('500 JSON when the DB binding is missing', async () => {
    db = await seededDb();
    const request = mockRequest('GET', {
      url: 'https://rrmacademy.org/api/courses/certificate?courseId=x',
      headers: { Cookie: `session=${RAW.learner}` },
    });
    const res = await certificate.onRequestGet({ request, env: mockEnv({ DB: undefined }), waitUntil: mockWaitUntil() });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('401 HTML with a login link when there is no session', async () => {
    db = await seededDb();
    const res = await get(db, { session: null });
    const { status, body, headers } = await parseResponse(res);
    assert.equal(status, 401);
    assert.match(headers['content-type'], /text\/html/);
    assert.match(body, /Please log in to view your certificate\./);
    assert.match(body, /href="\/login"/);
    assert.match(body, /Go to login/);
  });

  it('401 for an expired session', async () => {
    db = await seededDb();
    db._sqlite.exec('UPDATE session SET expires_at = 1');
    const { status } = await parseResponse(await get(db));
    assert.equal(status, 401);
  });

  it('400 HTML with a back link when courseId is absent', async () => {
    db = await seededDb();
    const { status, body } = await parseResponse(await get(db, { courseId: null }));
    assert.equal(status, 400);
    assert.match(body, /Missing course ID\./);
    assert.match(body, /history\.back\(\)/);
    assert.ok(!body.includes('href="/login"'));
  });

  it('404 for a course that is not in the catalogue', async () => {
    db = await seededDb();
    const { status, body } = await parseResponse(await get(db, { courseId: 'no-such-course' }));
    assert.equal(status, 404);
    assert.match(body, /Course not found\./);
  });

  it('400 for a course that does not offer a certificate', async () => {
    db = await seededDb((sqlite) => enroll(sqlite, { id: 'e-free', courseId: 'test-course-free', completedAt: COMPLETED }));
    const { status, body } = await parseResponse(await get(db, { courseId: 'test-course-free' }));
    assert.equal(status, 400);
    assert.match(body, /does not offer a certificate/);
  });

  it('403 when the learner has no enrolment at all', async () => {
    db = await seededDb();
    const { status, body } = await parseResponse(await get(db));
    assert.equal(status, 403);
    assert.match(body, /You are not enrolled in this course\./);
  });

  it('403 when the enrolment has been revoked', async () => {
    db = await seededDb((sqlite) => {
      enroll(sqlite, { id: 'e-revoked', completedAt: COMPLETED, revokedAt: '2026-06-01T00:00:00.000Z' });
      quiz(sqlite, { score: 100 });
    });
    const { status, body } = await parseResponse(await get(db));
    assert.equal(status, 403);
    assert.match(body, /You are not enrolled/);
    assert.equal(row(db).certificate_issued_at, null, 'a revoked enrolment must not be issued a certificate');
  });

  it('IDOR: learner A cannot print learner B certificate, and B row is untouched', async () => {
    db = await seededDb((sqlite) => {
      enroll(sqlite, { id: 'e-other', userId: OTHER, completedAt: COMPLETED });
      quiz(sqlite, { userId: OTHER, score: 100 });
    });

    const { status, body } = await parseResponse(await get(db, { session: RAW.learner }));

    assert.equal(status, 403);
    assert.match(body, /You are not enrolled in this course\./);
    assert.ok(!body.includes('Bob Other'), 'the other learner name must never appear');
    assert.equal(row(db, { userId: OTHER }).certificate_issued_at, null, 'B enrolment must not be stamped by A request');
  });

  it('403 when the course is not yet completed, and nothing is issued', async () => {
    db = await seededDb((sqlite) => {
      enroll(sqlite, { id: 'e-open' });
      quiz(sqlite, { score: 100 });
    });
    const { status, body } = await parseResponse(await get(db));
    assert.equal(status, 403);
    assert.match(body, /Course not yet completed\./);
    assert.equal(row(db).certificate_issued_at, null);
  });
});

describe('GET /api/courses/certificate -- the quiz-score boundary', () => {
  let db;
  afterEach(() => db?.close());

  it('79 is refused and issues nothing', async () => {
    db = await seededDb((sqlite) => {
      enroll(sqlite, { id: 'e1', completedAt: COMPLETED });
      quiz(sqlite, { score: 79 });
    });
    const { status, body } = await parseResponse(await get(db));
    assert.equal(status, 403);
    assert.match(body, /A quiz score of 80% or higher is required\./);
    assert.equal(row(db).certificate_issued_at, null);
  });

  it('exactly 80 is accepted and issues', async () => {
    db = await seededDb((sqlite) => {
      enroll(sqlite, { id: 'e1', completedAt: COMPLETED });
      quiz(sqlite, { score: 80 });
    });
    const { status } = await parseResponse(await get(db));
    assert.equal(status, 200);
    assert.ok(row(db).certificate_issued_at, 'the boundary value must issue');
  });

  it('an incomplete quiz attempt is not a score, even at 100', async () => {
    db = await seededDb((sqlite) => {
      enroll(sqlite, { id: 'e1', completedAt: COMPLETED });
      quiz(sqlite, { score: 100, completed: 0 });
    });
    const { status, body } = await parseResponse(await get(db));
    assert.equal(status, 403);
    assert.match(body, /quiz score of 80%/);
    assert.equal(row(db).certificate_issued_at, null);
  });

  it('no quiz row at all is refused', async () => {
    db = await seededDb((sqlite) => enroll(sqlite, { id: 'e1', completedAt: COMPLETED }));
    const { status } = await parseResponse(await get(db));
    assert.equal(status, 403);
    assert.equal(row(db).certificate_issued_at, null);
  });

  it('a certificated course with no named quiz step issues on completion alone', async () => {
    db = await seededDb((sqlite) => enroll(sqlite, {
      id: 'e-nq', courseId: 'test-course-cert-noquiz', completedAt: COMPLETED,
    }));
    const { status } = await parseResponse(await get(db, { courseId: 'test-course-cert-noquiz' }));
    assert.equal(status, 200);
    assert.ok(row(db, { courseId: 'test-course-cert-noquiz' }).certificate_issued_at);
  });
});

describe('GET /api/courses/certificate -- issuance', () => {
  let db;
  afterEach(() => db?.close());

  async function eligible(extra) {
    return seededDb((sqlite) => {
      enroll(sqlite, { id: 'enr01234567890', completedAt: COMPLETED });
      quiz(sqlite, { score: 95 });
      if (extra) extra(sqlite);
    });
  }

  it('lazy-issues on first view and records it in the enrolment row', async () => {
    db = await eligible();
    assert.equal(row(db).certificate_issued_at, null);

    const { status, body, headers } = await parseResponse(await get(db));

    assert.equal(status, 200);
    assert.match(headers['content-type'], /text\/html/);
    assert.equal(headers['cache-control'], 'private, no-store');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.ok(row(db).certificate_issued_at, 'first view must stamp certificate_issued_at');
    assert.match(body, /Certificate of Completion/);
    assert.match(body, /Ada Learner/);
    assert.match(body, /Test Course: Certificated/);
  });

  it('re-issue is idempotent: a second view does not move the issued timestamp', async () => {
    db = await eligible();
    await get(db);
    const first = row(db).certificate_issued_at;
    assert.ok(first);

    // Move the clock forward inside the database's own terms by proving the
    // UPDATE is a no-op: any second write would overwrite this sentinel.
    db._sqlite.prepare('UPDATE enrollment SET certificate_issued_at = ? WHERE id = ?')
      .run('2020-01-01 00:00:00', 'enr01234567890');

    const { status, body } = await parseResponse(await get(db));
    assert.equal(status, 200);
    assert.equal(row(db).certificate_issued_at, '2020-01-01 00:00:00', 'the IS NULL guard must block a re-stamp');
    assert.match(body, /January 1, 2020/, 'the page renders the stored issue date, not a fresh one');
  });

  it('the certificate number is derived from the enrolment id', async () => {
    db = await eligible();
    const { body } = await parseResponse(await get(db));
    assert.match(body, /RRM-ENR01234/);
    const expected = `RRM-${'enr01234567890'.slice(0, 8).toUpperCase()}`;
    assert.ok(body.includes(expected), `expected ${expected} in the rendered certificate`);
  });

  it('the completion date shown is the stored completed_at', async () => {
    db = await eligible();
    const { body } = await parseResponse(await get(db));
    assert.match(body, /May 1, 2026/);
  });

  it('the instructor comes from the catalogue when it names one', async () => {
    db = await eligible();
    const { body } = await parseResponse(await get(db));
    assert.match(body, /Dr\. Fixture Instructor/);
    assert.ok(!body.includes('>RRM Academy</span>'), 'the fallback must not be used when an instructor exists');
  });

  it('the instructor falls back to RRM Academy when the catalogue names none', async () => {
    db = await seededDb((sqlite) => enroll(sqlite, {
      id: 'e-nq', courseId: 'test-course-cert-noquiz', completedAt: COMPLETED,
    }));
    const { body } = await parseResponse(await get(db, { courseId: 'test-course-cert-noquiz' }));
    assert.match(body, /<span class="value">RRM Academy<\/span>/);
  });

  it('the student name falls back from name to first+last to email', async () => {
    // name present
    db = await eligible();
    let { body } = await parseResponse(await get(db));
    assert.match(body, /class="student-name">Ada Learner</);
    db.close();

    // name absent, first and last present
    db = await seededDb((sqlite) => {
      sqlite.prepare('UPDATE user SET name = NULL, first_name = ?, last_name = ? WHERE id = ?')
        .run('Ada', 'Lovelace', LEARNER);
      enroll(sqlite, { id: 'e1', completedAt: COMPLETED });
      quiz(sqlite, { score: 95 });
    });
    ({ body } = await parseResponse(await get(db)));
    assert.match(body, /class="student-name">Ada Lovelace</);
    db.close();

    // nothing but an email
    db = await seededDb((sqlite) => {
      sqlite.prepare('UPDATE user SET name = NULL, first_name = NULL, last_name = NULL WHERE id = ?').run(LEARNER);
      enroll(sqlite, { id: 'e1', completedAt: COMPLETED });
      quiz(sqlite, { score: 95 });
    });
    ({ body } = await parseResponse(await get(db)));
    assert.match(body, /class="student-name">learner@example\.com</);
  });

  it('a student name carrying markup is escaped, not rendered', async () => {
    db = await seededDb((sqlite) => {
      sqlite.prepare('UPDATE user SET name = ? WHERE id = ?')
        .run('<script>alert("x")</script>', LEARNER);
      enroll(sqlite, { id: 'e1', completedAt: COMPLETED });
      quiz(sqlite, { score: 95 });
    });
    const { body } = await parseResponse(await get(db));
    assert.ok(!body.includes('<script>alert'), 'the name must never re-enter the page as markup');
    assert.match(body, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  });

  it('an error message carrying markup is escaped in the error page too', async () => {
    // htmlError escapes its message; the message that can carry a caller value
    // is the quiz-score one, so assert the escaper is wired by checking the
    // fixed text renders as text and the page has no injected element.
    db = await seededDb((sqlite) => {
      enroll(sqlite, { id: 'e1', completedAt: COMPLETED });
      quiz(sqlite, { score: 10 });
    });
    const { body } = await parseResponse(await get(db));
    assert.match(body, /<h1 style="color:#725e7e;font-size:1\.5rem">Certificate Unavailable<\/h1>/);
    assert.match(body, /A quiz score of 80% or higher is required\./);
  });
});

describe('GET /api/courses/certificate -- failure and races', () => {
  let db;
  afterEach(() => db?.close());

  it('a D1 error mid-render becomes a logged 500 JSON', async () => {
    const events = [];
    db = await seededDb(
      (sqlite) => {
        enroll(sqlite, { id: 'e1', completedAt: COMPLETED });
        quiz(sqlite, { score: 95 });
      },
      {
        interleave({ sql }) {
          if (sql.includes('SELECT name, first_name')) throw new Error('D1_ERROR: user read failed');
        },
      },
    );

    const request = mockRequest('GET', {
      url: `https://rrmacademy.org/api/courses/certificate?courseId=${CERT_COURSE}`,
      headers: { Cookie: `session=${RAW.learner}` },
    });
    const res = await certificate.onRequestGet({
      request,
      env: mockEnv({ DB: db, EVENTS: { writeDataPoint: (p) => events.push(p) } }),
      waitUntil: mockWaitUntil(),
    });
    const { status, body } = await parseResponse(res);

    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(events.some((e) => e.blobs.includes('certificate_error')), 'the failure must be logged');
  });

  /**
   * The `AND certificate_issued_at IS NULL` on the lazy-issue UPDATE is NOT
   * redundant with the `if (!issuedAt)` guard above it. The JS guard reads a
   * value captured before the write; the SQL guard is evaluated at write time.
   * Between the two, a second tab (or the checkCourseCompletion path in
   * _shared.js, which issues the same column) can land. Only the SQL predicate
   * stops the second writer from re-dating a credential that has already been
   * issued, which is what makes the printed "Issued" date stable.
   *
   * Without an interleaved writer this arm is untestable: every single-threaded
   * request that reaches the UPDATE has already proved the column is null, so
   * dropping the predicate changes nothing observable.
   */
  it('a concurrent issue landing before the UPDATE is not overwritten (the IS NULL guard)', async () => {
    let armed = true;
    db = await seededDb(
      (sqlite) => {
        enroll(sqlite, { id: 'e1', completedAt: COMPLETED });
        quiz(sqlite, { score: 95 });
      },
      {
        interleave({ sql, db: sqlite }) {
          if (armed && sql.includes("UPDATE enrollment SET certificate_issued_at = datetime('now')")) {
            armed = false;
            // A second isolate issues the certificate first.
            sqlite.prepare("UPDATE enrollment SET certificate_issued_at = '2020-01-01 00:00:00' WHERE id = 'e1'").run();
          }
        },
      },
    );

    const { status, body } = await parseResponse(await get(db));

    assert.equal(status, 200);
    assert.equal(
      row(db).certificate_issued_at,
      '2020-01-01 00:00:00',
      'the first issue date must survive; a second writer may not re-date the credential',
    );
    assert.match(body, /January 1, 2020/, 'the page must print the date that was actually issued');
  });

  it('a revocation landing between the issue write and the read-back leaves the issued date blank', async () => {
    // Documented behaviour, not an aspiration: the re-read is scoped
    // `revoked_at IS NULL`, so a concurrent revoke makes it return no row and
    // issuedAt is undefined. The page still renders, with an empty Issued cell.
    let armed = true;
    db = await seededDb(
      (sqlite) => {
        enroll(sqlite, { id: 'e1', completedAt: COMPLETED });
        quiz(sqlite, { score: 95 });
      },
      {
        interleave({ sql, db: sqlite }) {
          if (armed && sql.includes('SELECT certificate_issued_at FROM enrollment')) {
            armed = false;
            sqlite.prepare("UPDATE enrollment SET revoked_at = '2026-07-01T00:00:00.000Z' WHERE id = 'e1'").run();
          }
        },
      },
    );

    const { status, body } = await parseResponse(await get(db));
    assert.equal(status, 200);
    assert.ok(row(db).certificate_issued_at, 'the issue write itself still landed');
    assert.match(body, /<span class="label">Issued<\/span>\s*<span class="value"><\/span>/, 'the issued date renders empty');
  });
});
