/**
 * functions/api/courses/quiz.js -- the in-course quiz route.
 *
 * Two things here have consequences beyond a wrong percentage:
 *   - the GET strips `correctIndex` before answering. If that ever stops
 *     happening, the answer key ships to the browser and every certificate
 *     after that is worthless. It is one destructuring line and nothing was
 *     watching it.
 *   - the POST writes step_progress and quiz_response in ONE db.batch(), and
 *     `practice: true` is supposed to record the attempt WITHOUT advancing
 *     progress. A regression either lets practice runs complete a course, or
 *     loses real attempts.
 * Scoring, attempt numbering (`COALESCE(MAX(attempt),0)+1`) and the
 * ON CONFLICT upsert are all SQL, so this runs against a real SQLite engine
 * loaded with the committed schema.
 *
 * WHAT IS FAKED, AND WHAT IT CANNOT DISTINGUISH
 *  - The course catalogue and quizzes.json are the deterministic fixtures in
 *    test/_json-module-hook.mjs. These prove behaviour given a content shape,
 *    not that live content has that shape.
 *  - getQuizContent's D1 arm reads `step_rendition`, which IS in the committed
 *    schema, so the dual-read is exercised for real rather than stubbed.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './_json-module-hook.mjs';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

const quiz = await import('../functions/api/courses/quiz.js');

const USER = 'u_learner';
const RAW = 'sess-learner';
const COURSE = 'test-course-fixed';
const CERT_STEP = 'fx-step-3';
const FEEDBACK_STEP = 'fx-step-2';
const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const cookie = { Cookie: `session=${RAW}` };

async function seededDb({ enrolled = true, unlockAll = true, seed } = {}) {
  const db = sqliteD1({
    seed(s) {
      insertUser(s, { id: USER, email: 'learner@example.com', role: 'member' });
      if (enrolled) s.prepare('INSERT INTO enrollment (id, user_id, course_id) VALUES (?, ?, ?)').run('e1', USER, COURSE);
      if (unlockAll) {
        for (const stepId of ['fx-step-1', 'fx-step-2']) {
          s.prepare('INSERT INTO step_progress (user_id, course_id, step_id, completed) VALUES (?, ?, ?, 1)')
            .run(USER, COURSE, stepId);
        }
      }
      if (seed) seed(s);
    },
  });
  await insertSession(db._sqlite, { rawId: RAW, userId: USER, expiresAt: FUTURE });
  return db;
}

/**
 * ONE env per database, memoised. The POST path is rate limited per user
 * against COMMUNITY_KV, so handing every call a fresh mockEnv would hand it a
 * fresh KV and the limiter could never be observed to bind at all.
 */
const envs = new WeakMap();
function envFor(db) {
  if (!envs.has(db)) envs.set(db, mockEnv({ DB: db }));
  return envs.get(db);
}
const ctx = (db, request) => ({ request, env: envFor(db), waitUntil: mockWaitUntil() });

const get = (db, qs, headers = cookie) => quiz.onRequestGet(ctx(db,
  mockRequest('GET', { url: `https://rrmacademy.org/api/courses/quiz?${qs}`, headers })));

const submit = (db, body, headers = cookie) => quiz.onRequestPost(ctx(db,
  mockRequest('POST', { url: 'https://rrmacademy.org/api/courses/quiz', body, headers })));

/** step_rendition's primary key is (step_id, format); there is no id column. */
function seedRendition(db, { stepId, status = 'published', content }) {
  db._sqlite.prepare(
    "INSERT INTO step_rendition (step_id, format, content_json, status, created_at, updated_at) VALUES (?, 'quiz', ?, ?, datetime('now'), datetime('now'))"
  ).run(stepId, JSON.stringify(content), status);
}

describe('GET /api/courses/quiz', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });

  it('never sends correctIndex to the client', async () => {
    const { status, body } = await parseResponse(await get(db, `courseId=${COURSE}&stepId=${CERT_STEP}`));
    assert.equal(status, 200);
    assert.equal(body.type, 'quiz');
    assert.equal(body.passingScore, 80);
    assert.equal(body.questions.length, 2);
    for (const q of body.questions) {
      assert.ok(Object.hasOwn(q, 'options'));
      assert.equal(Object.hasOwn(q, 'correctIndex'), false, 'the answer key shipped to the browser');
    }
    assert.ok(!JSON.stringify(body).includes('correctIndex'));
  });

  it('leaves questionnaire questions intact -- there is no key to strip', async () => {
    const { body } = await parseResponse(await get(db, `courseId=${COURSE}&stepId=${FEEDBACK_STEP}`));
    assert.equal(body.type, 'questionnaire');
    assert.deepEqual(body.questions.map(q => q.id), ['fq1', 'fq2', 'fq3', 'fq4']);
    assert.deepEqual(body.questions[0].scale, { min: 1, max: 5, labels: ['low', 'high'] });
  });

  it('prefers published D1 step_rendition content over the static fallback', async () => {
    seedRendition(db, { stepId: CERT_STEP, content: {
      type: 'quiz', title: 'From D1', passingScore: 50,
      questions: [{ id: 'd1q', text: 'Live?', options: ['no', 'yes'], correctIndex: 1 }],
    } });
    const { body } = await parseResponse(await get(db, `courseId=${COURSE}&stepId=${CERT_STEP}`));
    assert.equal(body.title, 'From D1');
    assert.equal(body.passingScore, 50);
    assert.equal(body.questions.length, 1);
    assert.equal(Object.hasOwn(body.questions[0], 'correctIndex'), false, 'D1-sourced content skipped the strip');
  });

  it('falls back to static content when the D1 rendition is not published', async () => {
    seedRendition(db, { stepId: CERT_STEP, status: 'draft', content: { type: 'quiz', title: 'Draft', questions: [] } });
    const { body } = await parseResponse(await get(db, `courseId=${COURSE}&stepId=${CERT_STEP}`));
    assert.equal(body.title, 'Certificate Quiz');
  });

  it('falls back to static content when the D1 read throws', async () => {
    db._sqlite.exec('DROP TABLE step_rendition');
    const { status, body } = await parseResponse(await get(db, `courseId=${COURSE}&stepId=${CERT_STEP}`));
    assert.equal(status, 200, 'a D1 outage 404d every quiz including the certificate quiz');
    assert.equal(body.title, 'Certificate Quiz');
  });

  it('404s when the step has no quiz content at all', async () => {
    const { status, body } = await parseResponse(await get(db, `courseId=${COURSE}&stepId=fx-step-1`));
    assert.equal(status, 404);
    assert.equal(body.error, 'No quiz data for this step');
  });

  it('401s without a session and 500s without a DB binding', async () => {
    assert.equal((await parseResponse(await get(db, `courseId=${COURSE}&stepId=${CERT_STEP}`, {}))).status, 401);
    const res = await quiz.onRequestGet({
      request: mockRequest('GET', { url: 'https://rrmacademy.org/api/courses/quiz' }),
      env: mockEnv({ DB: undefined }), waitUntil: mockWaitUntil(),
    });
    assert.equal((await parseResponse(res)).status, 500);
  });

  it('400s without both ids, 404s on an unknown course, 400s on a foreign step', async () => {
    assert.equal((await parseResponse(await get(db, `courseId=${COURSE}`))).status, 400);
    assert.equal((await parseResponse(await get(db, `stepId=${CERT_STEP}`))).status, 400);
    assert.equal((await parseResponse(await get(db, `courseId=nope&stepId=${CERT_STEP}`))).status, 404);
    assert.equal((await parseResponse(await get(db, `courseId=${COURSE}&stepId=step-1`))).status, 400);
  });

  it('403s when not enrolled', async () => {
    const bare = await seededDb({ enrolled: false });
    const { status, body } = await parseResponse(await get(bare, `courseId=${COURSE}&stepId=${CERT_STEP}`));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not enrolled');
  });

  it('403s when an earlier step in a fixed-order course is incomplete', async () => {
    const locked = await seededDb({ unlockAll: false });
    const { status, body } = await parseResponse(await get(locked, `courseId=${COURSE}&stepId=${CERT_STEP}`));
    assert.equal(status, 403);
    assert.equal(body.error, 'Previous step not completed');
  });

  it('500s and logs when the enrollment lookup throws', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE enrollment');
    const res = await quiz.onRequestGet({
      request: mockRequest('GET', {
        url: `https://rrmacademy.org/api/courses/quiz?courseId=${COURSE}&stepId=${CERT_STEP}`, headers: cookie,
      }),
      env, waitUntil: mockWaitUntil(),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(events.some(e => e.blobs.includes('quiz_error')));
  });

  it('answers the preflight with 204 and the locked-down origin', async () => {
    const res = await quiz.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

describe('POST /api/courses/quiz -- scoring', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });

  const progressRow = () => db._sqlite
    .prepare('SELECT completed, score FROM step_progress WHERE user_id = ? AND course_id = ? AND step_id = ?')
    .get(USER, COURSE, CERT_STEP);
  const responses = () => db._sqlite
    .prepare('SELECT attempt, question_id, answer_value, is_correct FROM quiz_response WHERE step_id = ? ORDER BY id')
    .all(CERT_STEP).map(r => ({ ...r }));

  it('scores a perfect submission 100, passes it, and returns the answer key in results', async () => {
    const { status, body } = await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0] }));
    assert.equal(status, 200);
    assert.equal(body.score, 100);
    assert.equal(body.passed, true);
    assert.equal(body.attempt, 1);
    assert.deepEqual(body.results, [
      { questionId: 'q1', correct: true, selected: 1, correctIndex: 1 },
      { questionId: 'q2', correct: true, selected: 0, correctIndex: 0 },
    ]);
  });

  it('rounds a partial score and fails it below the passing mark', async () => {
    const { body } = await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 1] }));
    assert.equal(body.score, 50);
    assert.equal(body.passed, false);
    assert.equal(body.results[1].correct, false);
    assert.equal(progressRow().completed, 0, 'a failed attempt marked the step complete');
    assert.equal(progressRow().score, 50);
  });

  it('records the attempt and the per-question responses in one batch', async () => {
    await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0] });
    assert.deepEqual(responses(), [
      { attempt: 1, question_id: 'q1', answer_value: '1', is_correct: 1 },
      { attempt: 1, question_id: 'q2', answer_value: '0', is_correct: 1 },
    ]);
  });

  it('increments the attempt number across submissions', async () => {
    await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [0, 0] });
    const second = await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0] }));
    assert.equal(second.body.attempt, 2);
    assert.deepEqual([...new Set(responses().map(r => r.attempt))], [1, 2]);
  });

  it('keeps the best score across attempts and never un-completes a passed step', async () => {
    await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0] });   // 100, passes
    assert.deepEqual({ ...progressRow() }, { completed: 1, score: 100 });
    await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [0, 1] });   // 0, fails
    assert.deepEqual({ ...progressRow() }, { completed: 1, score: 100 }, 'a later failure overwrote a passing result');
  });

  it('reports course completion and certificate issuance once the last step passes', async () => {
    const { body } = await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0] }));
    assert.equal(body.courseCompleted, true);
    assert.equal(body.certificateIssued, true);
    const e = db._sqlite.prepare('SELECT completed_at, certificate_issued_at FROM enrollment WHERE id = ?').get('e1');
    assert.ok(e.completed_at && e.certificate_issued_at);
  });

  it('does not run the completion check on a failing submission', async () => {
    const { body } = await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [0, 1] }));
    assert.equal(body.courseCompleted, undefined);
    assert.equal(db._sqlite.prepare('SELECT completed_at FROM enrollment WHERE id = ?').get('e1').completed_at, null);
  });

  it('rejects an answer index outside the option range, and stores nothing', async () => {
    // q1 has 3 options, so 3 is the first out-of-range index.
    for (const answers of [[3, 0], [-1, 0], ['1', 0], [null, 0], [Infinity, 0]]) {
      const { status, body } = await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers }));
      assert.equal(status, 400, `answers ${JSON.stringify(answers)} were accepted`);
      assert.match(body.error, /Invalid answer for question 1/);
    }
    assert.equal(responses().length, 0);
    // Documented, not endorsed: a fractional index is finite and in range, so it
    // is accepted and scored as wrong rather than rejected as malformed.
    const frac = await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1.5, 0] }));
    assert.equal(frac.status, 200);
    assert.equal(frac.body.results[0].correct, false);
  });

  it('rejects a wrong number of answers with a count in the message', async () => {
    const { status, body } = await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1] }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Expected 2 answers, got 1');
  });
});

describe('POST /api/courses/quiz -- questionnaire validation', () => {
  let db;
  beforeEach(async () => { db = await seededDb({ unlockAll: false, seed(s) {
    s.prepare('INSERT INTO step_progress (user_id, course_id, step_id, completed) VALUES (?, ?, ?, 1)')
      .run(USER, COURSE, 'fx-step-1');
  } }); });

  const ok = [3, [0, 2], 'some words', 'anything'];
  const send = (answers) => submit(db, { courseId: COURSE, stepId: FEEDBACK_STEP, answers });

  it('always scores 100 and passes, and stores no answer key', async () => {
    const { status, body } = await parseResponse(await send(ok));
    assert.equal(status, 200);
    assert.equal(body.score, 100);
    assert.equal(body.passed, true);
    assert.equal(body.results, undefined, 'questionnaires must not return a results array');
    const rows = db._sqlite.prepare('SELECT is_correct FROM quiz_response WHERE step_id = ?').all(FEEDBACK_STEP);
    assert.ok(rows.every(r => r.is_correct === null));
  });

  it('accepts the likert bounds and rejects just outside them', async () => {
    for (const v of [1, 5]) assert.equal((await parseResponse(await send([v, [0], 'x', 1]))).status, 200);
    for (const v of [0, 6, '3', null, NaN]) {
      const { status, body } = await parseResponse(await send([v, [0], 'x', 1]));
      assert.equal(status, 400, `likert ${String(v)} was accepted`);
      assert.match(body.error, /question 1/);
    }
  });

  it('requires a non-empty multiselect whose indices are all in range', async () => {
    for (const v of [[], 'not-an-array', [0, 3], [-1], ['0'], [0, 1, 2, 3]]) {
      const { status, body } = await parseResponse(await send([3, v, 'x', 1]));
      assert.equal(status, 400, `multiselect ${JSON.stringify(v)} was accepted`);
      assert.match(body.error, /question 2/);
    }
    assert.equal((await parseResponse(await send([3, [0, 1, 2], 'x', 1]))).status, 200);
  });

  it('caps freetext at 2000 characters', async () => {
    assert.equal((await parseResponse(await send([3, [0], 'x'.repeat(2000), 1]))).status, 200);
    const { status, body } = await parseResponse(await send([3, [0], 'x'.repeat(2001), 1]));
    assert.equal(status, 400);
    assert.match(body.error, /question 3 is too long/);
    assert.equal((await parseResponse(await send([3, [0], 42, 1]))).status, 400);
  });

  it('an untyped question rejects only null and undefined', async () => {
    for (const v of [0, '', false, [], {}]) {
      assert.equal((await parseResponse(await send([3, [0], 'x', v]))).status, 200, `untyped ${JSON.stringify(v)} was rejected`);
    }
    for (const v of [null, undefined]) {
      const { status, body } = await parseResponse(await send([3, [0], 'x', v]));
      assert.equal(status, 400);
      assert.match(body.error, /question 4/);
    }
  });
});

describe('POST /api/courses/quiz -- practice mode and guards', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });

  it('records a practice attempt but does not advance progress', async () => {
    const { status, body } = await parseResponse(await submit(db, {
      courseId: COURSE, stepId: CERT_STEP, answers: [1, 0], practice: true,
    }));
    assert.equal(status, 200);
    assert.equal(body.score, 100);
    assert.equal(body.passed, true);
    assert.equal(body.courseCompleted, undefined, 'a practice run completed the course');

    assert.equal(db._sqlite.prepare('SELECT COUNT(*) c FROM quiz_response WHERE step_id = ?').get(CERT_STEP).c, 2);
    assert.equal(
      db._sqlite.prepare('SELECT COUNT(*) c FROM step_progress WHERE step_id = ?').get(CERT_STEP).c, 0,
      'practice wrote step_progress'
    );
    assert.equal(db._sqlite.prepare('SELECT completed_at FROM enrollment WHERE id = ?').get('e1').completed_at, null);
  });

  it('only `practice === true` is practice -- a truthy string still counts for real', async () => {
    await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0], practice: 'yes' });
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) c FROM step_progress WHERE step_id = ?').get(CERT_STEP).c, 1);
  });

  it('practice attempts share the attempt counter with graded ones', async () => {
    await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0], practice: true });
    const graded = await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0] }));
    assert.equal(graded.body.attempt, 2);
  });

  it('401s, 400s and 403s before writing anything', async () => {
    assert.equal((await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0] }, {}))).status, 401);
    assert.equal((await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: 'nope' }))).body.error, 'answers must be an array');
    assert.equal((await parseResponse(await submit(db, { stepId: CERT_STEP, answers: [] }))).status, 400);
    assert.equal((await parseResponse(await submit(db, { courseId: 'nope', stepId: CERT_STEP, answers: [] }))).status, 404);
    assert.equal((await parseResponse(await submit(db, { courseId: COURSE, stepId: 'step-1', answers: [] }))).status, 400);
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) c FROM quiz_response').get().c, 0);
  });

  it('400s on unparseable JSON and non-object payloads', async () => {
    for (const [rawBody, expected] of [['{oops', 'Invalid JSON'], ['[1]', 'Invalid payload'], ['null', 'Invalid payload']]) {
      const res = await quiz.onRequestPost(ctx(db, mockRequest('POST', {
        url: 'https://rrmacademy.org/api/courses/quiz', rawBody, headers: cookie,
      })));
      assert.equal((await parseResponse(res)).body.error, expected);
    }
  });

  it('403s when the previous step is incomplete, before any quiz content is read', async () => {
    const locked = await seededDb({ unlockAll: false });
    const { status, body } = await parseResponse(await submit(locked, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0] }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Previous step not completed');
  });

  it('429s once the per-user submission window is exhausted', async () => {
    for (let i = 0; i < 20; i++) {
      assert.equal((await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0] }))).status, 200);
    }
    const { status, body } = await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0] }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
  });

  it('404s when the step has quiz content declared but no questions written yet', async () => {
    seedRendition(db, { stepId: CERT_STEP, content: { type: 'quiz', title: 'Empty', questions: [] } });
    const { status, body } = await parseResponse(await submit(db, { courseId: COURSE, stepId: CERT_STEP, answers: [] }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Quiz content not yet available');
  });

  it('500s and logs when the batch write fails', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE quiz_response');
    const res = await quiz.onRequestPost({
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/courses/quiz',
        body: { courseId: COURSE, stepId: CERT_STEP, answers: [1, 0] }, headers: cookie,
      }),
      env, waitUntil: mockWaitUntil(),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(events.some(e => e.blobs.includes('quiz_error')));
    assert.equal(
      db._sqlite.prepare('SELECT COUNT(*) c FROM step_progress WHERE step_id = ?').get(CERT_STEP).c, 0,
      'the batch was not atomic: step_progress advanced while the responses were lost'
    );
  });
});
