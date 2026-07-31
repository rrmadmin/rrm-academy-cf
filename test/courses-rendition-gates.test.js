/**
 * functions/api/courses/rendition.js -- the runtime read for lesson content,
 * covered against a REAL SQLite engine.
 *
 * test/courses-rendition.test.js covers this endpoint through mockDB, which is
 * enough for the status taxonomy but cannot exercise the parts of the handler
 * that are SQL:
 *   - the trust-anchor JOIN (spec 3.3.1) resolves the owning course from
 *     course_step.course_id. The point of that join is that a caller cannot
 *     name the course; against a canned mock the join result IS the fixture, so
 *     the anchor proves nothing.
 *   - the superadmin auto-enrol is an INSERT ... ON CONFLICT DO UPDATE SET
 *     revoked_at = NULL, and the claim "an admin can always read a paid course"
 *     is only true if that row lands.
 *   - the fixed-step-order lock reads LIVE published-step ordering with a join
 *     to course_section and an ORDER BY across two sort_order columns, then
 *     looks up the previous step's progress. Ordering is the whole gate.
 * Everything below runs on node:sqlite loaded with the committed schema.
 *
 * WHAT IS STILL FAKED
 *  - requireMember's Stripe leg; membership here is granted by the explicit
 *    'STUC Legacy Grandfather' label, which is a real production grant path.
 *  - Analytics Engine is a stub.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser, insertSession, insertLabel } from './_d1-sqlite.mjs';

const rendition = await import('../functions/api/courses/rendition.js');

const LEARNER = 'u_rend_learner';
const MEMBER = 'u_rend_member';
const ADMIN = 'u_rend_admin';
const RAW = { learner: 'rend-session-learner', member: 'rend-session-member', admin: 'rend-session-admin' };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

function course(sqlite, { id, accessType = 'public', isFree = 1, settings = null, status = 'published' }) {
  sqlite.prepare(
    "INSERT INTO course (id, slug, title, access_type, is_free, settings_json, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, id, id, accessType, isFree, settings, status);
}

function section(sqlite, { id, courseId, sortOrder = 1 }) {
  sqlite.prepare('INSERT INTO course_section (id, course_id, title, sort_order) VALUES (?, ?, ?, ?)')
    .run(id, courseId, id, sortOrder);
}

function step(sqlite, { id, sectionId, courseId, sortOrder = 1, status = 'published', type = 'article' }) {
  sqlite.prepare('INSERT INTO course_step (id, section_id, course_id, title, type, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, sectionId, courseId, id, type, sortOrder, status);
}

function renditionRow(sqlite, { stepId, format, content, status = 'published', wordCount = null }) {
  sqlite.prepare(
    "INSERT INTO step_rendition (step_id, format, content_json, status, word_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')"
  ).run(stepId, format, typeof content === 'string' ? content : JSON.stringify(content), status, wordCount);
}

async function seededDb(extra, opts = {}) {
  const db = sqliteD1({
    ...opts,
    seed(sqlite) {
      insertUser(sqlite, { id: LEARNER, email: 'learner@example.com' });
      insertUser(sqlite, { id: MEMBER, email: 'member@example.com' });
      insertUser(sqlite, { id: ADMIN, email: 'admin@example.com', role: 'superadmin' });
      insertLabel(sqlite, MEMBER, 'STUC Legacy Grandfather');
      if (extra) extra(sqlite);
    },
  });
  await insertSession(db._sqlite, { rawId: RAW.learner, userId: LEARNER, expiresAt: FUTURE });
  await insertSession(db._sqlite, { rawId: RAW.member, userId: MEMBER, expiresAt: FUTURE });
  await insertSession(db._sqlite, { rawId: RAW.admin, userId: ADMIN, expiresAt: FUTURE });
  return db;
}

function get(db, query, { session = RAW.learner, env: envOver = {} } = {}) {
  const request = mockRequest('GET', {
    url: `https://rrmacademy.org/api/courses/rendition${query}`,
    headers: session === null ? {} : { Cookie: `session=${session}` },
  });
  return rendition.onRequestGet({ request, env: mockEnv({ DB: db, ...envOver }), waitUntil: mockWaitUntil() });
}

describe('GET /api/courses/rendition -- request shape', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb((sqlite) => {
      course(sqlite, { id: 'c-free' });
      section(sqlite, { id: 'sec-1', courseId: 'c-free' });
      step(sqlite, { id: 'st-1', sectionId: 'sec-1', courseId: 'c-free' });
      renditionRow(sqlite, { stepId: 'st-1', format: 'reading', content: { html: '<p>a b c</p>' }, wordCount: 3 });
    });
  });
  afterEach(() => db.close());

  it('OPTIONS answers the CORS preflight', async () => {
    const res = await rendition.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });

  it('500 when the DB binding is missing, before any session work', async () => {
    const { status, body } = await parseResponse(
      await get(db, '?stepId=st-1&format=reading', { env: { DB: undefined } }),
    );
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('400 invalid_step when stepId is absent or over 100 characters', async () => {
    for (const q of ['?format=reading', `?stepId=${'x'.repeat(101)}&format=reading`, '?stepId=&format=reading']) {
      const { status, body } = await parseResponse(await get(db, q));
      assert.equal(status, 400, q);
      assert.equal(body.error, 'invalid_step');
    }
  });

  it('a 100-character stepId is inside the limit and reaches the lookup', async () => {
    const { status, body } = await parseResponse(await get(db, `?stepId=${'x'.repeat(100)}&format=reading`));
    assert.equal(status, 404);
    assert.equal(body.error, 'rendition_not_available');
  });

  it('reading returns the stored html and word count', async () => {
    const { status, body } = await parseResponse(await get(db, '?stepId=st-1&format=reading'));
    assert.equal(status, 200);
    assert.equal(body.html, '<p>a b c</p>');
    assert.equal(body.wordCount, 3);
  });

  it('a null word_count is reported as null rather than omitted', async () => {
    db._sqlite.exec('UPDATE step_rendition SET word_count = NULL');
    const { body } = await parseResponse(await get(db, '?stepId=st-1&format=reading'));
    assert.equal(body.wordCount, null);
  });

  it('unparseable content becomes a logged 500 server_error', async () => {
    const events = [];
    db._sqlite.exec("UPDATE step_rendition SET content_json = '{not json'");
    const { status, body } = await parseResponse(
      await get(db, '?stepId=st-1&format=reading', { env: { EVENTS: { writeDataPoint: (p) => events.push(p) } } })
    );
    assert.equal(status, 500);
    assert.equal(body.error, 'server_error');
    assert.ok(events.some((e) => e.blobs.includes('rendition_parse_error')));
  });

  it('a D1 failure becomes a logged 500 Internal error', async () => {
    const events = [];
    const throwing = await seededDb(
      (sqlite) => {
        course(sqlite, { id: 'c-free' });
        section(sqlite, { id: 'sec-1', courseId: 'c-free' });
        step(sqlite, { id: 'st-1', sectionId: 'sec-1', courseId: 'c-free' });
        renditionRow(sqlite, { stepId: 'st-1', format: 'reading', content: { html: '<p>x</p>' } });
      },
      { interleave({ sql }) { if (sql.includes('FROM step_rendition r')) throw new Error('D1_ERROR: join failed'); } },
    );
    const { status, body } = await parseResponse(
      await get(throwing, '?stepId=st-1&format=reading', { env: { EVENTS: { writeDataPoint: (p) => events.push(p) } } })
    );
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(events.some((e) => e.blobs.includes('rendition_error')));
    throwing.close();
  });
});

describe('GET /api/courses/rendition -- format payloads', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb((sqlite) => {
      course(sqlite, { id: 'c-free' });
      section(sqlite, { id: 'sec-1', courseId: 'c-free' });
      step(sqlite, { id: 'st-cards', sectionId: 'sec-1', courseId: 'c-free', sortOrder: 1 });
      step(sqlite, { id: 'st-quiz', sectionId: 'sec-1', courseId: 'c-free', sortOrder: 2, type: 'quiz' });
      step(sqlite, { id: 'st-audio', sectionId: 'sec-1', courseId: 'c-free', sortOrder: 3 });
      renditionRow(sqlite, {
        stepId: 'st-cards', format: 'flashcards',
        content: { cards: [{ front: 'F', back: 'B' }] },
      });
      renditionRow(sqlite, { stepId: 'st-audio', format: 'audio', content: { duration_seconds: 120, voice: 'clara', r2_key: 'secret/audio.mp3' } });
    });
  });
  afterEach(() => db.close());

  it('flashcards returns the card list', async () => {
    const { status, body } = await parseResponse(await get(db, '?stepId=st-cards&format=flashcards'));
    assert.equal(status, 200);
    assert.equal(body.format, 'flashcards');
    assert.deepEqual(body.cards, [{ front: 'F', back: 'B' }]);
  });

  it('audio returns metadata only and never the R2 key', async () => {
    const { status, body } = await parseResponse(await get(db, '?stepId=st-audio&format=audio'));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, format: 'audio', duration: 120, voice: 'clara' });
    assert.ok(!('r2_key' in body), 'the storage key must never be exposed');
  });

  it('audio with no metadata reports nulls rather than undefined', async () => {
    db._sqlite.exec("UPDATE step_rendition SET content_json = '{}' WHERE format = 'audio'");
    const { body } = await parseResponse(await get(db, '?stepId=st-audio&format=audio'));
    assert.deepEqual(body, { ok: true, format: 'audio', duration: null, voice: null });
  });

  it('a scored quiz strips correctIndex from every question', async () => {
    renditionRow(db._sqlite, {
      stepId: 'st-quiz', format: 'quiz',
      content: {
        type: 'quiz', title: 'T', description: 'D', passingScore: 80,
        questions: [
          { id: 'q1', text: 'A?', options: ['x', 'y'], correctIndex: 1 },
          { id: 'q2', text: 'B?', options: ['x', 'y'], correctIndex: 0 },
        ],
      },
    });
    const { status, body } = await parseResponse(await get(db, '?stepId=st-quiz&format=quiz'));
    assert.equal(status, 200);
    assert.equal(body.quiz.passingScore, 80);
    assert.equal(body.quiz.questions.length, 2);
    for (const q of body.quiz.questions) {
      assert.ok(!('correctIndex' in q), 'the answer key must not reach the learner');
      assert.ok(q.options, 'the options must survive the strip');
    }
  });

  it('a questionnaire is passed through whole, because it has no answer key', async () => {
    renditionRow(db._sqlite, {
      stepId: 'st-quiz', format: 'quiz',
      content: {
        type: 'questionnaire', title: 'Feedback', description: 'D', passingScore: null,
        questions: [{ id: 'fq1', text: 'How useful?', type: 'likert', scale: { min: 1, max: 5 } }],
      },
    });
    const { body } = await parseResponse(await get(db, '?stepId=st-quiz&format=quiz'));
    assert.equal(body.quiz.type, 'questionnaire');
    assert.deepEqual(body.quiz.questions, [{ id: 'fq1', text: 'How useful?', type: 'likert', scale: { min: 1, max: 5 } }]);
  });

  it('a quiz with no questions array yields an empty question list', async () => {
    renditionRow(db._sqlite, { stepId: 'st-quiz', format: 'quiz', content: { type: 'quiz', title: 'T' } });
    const { body } = await parseResponse(await get(db, '?stepId=st-quiz&format=quiz'));
    assert.deepEqual(body.quiz.questions, []);
  });
});

describe('GET /api/courses/rendition -- access gates', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb((sqlite) => {
      course(sqlite, { id: 'c-members', accessType: 'members', isFree: 1 });
      section(sqlite, { id: 'sec-m', courseId: 'c-members' });
      step(sqlite, { id: 'st-m', sectionId: 'sec-m', courseId: 'c-members' });
      renditionRow(sqlite, { stepId: 'st-m', format: 'reading', content: { html: '<p>members only</p>' } });

      course(sqlite, { id: 'c-paid', accessType: 'public', isFree: 0 });
      section(sqlite, { id: 'sec-p', courseId: 'c-paid' });
      step(sqlite, { id: 'st-p', sectionId: 'sec-p', courseId: 'c-paid' });
      renditionRow(sqlite, { stepId: 'st-p', format: 'reading', content: { html: '<p>paid</p>' } });
    });
  });
  afterEach(() => db.close());

  it('401 without a session', async () => {
    const { status, body } = await parseResponse(await get(db, '?stepId=st-m&format=reading', { session: null }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
  });

  it('a members course refuses a non-member and serves a member', async () => {
    const refused = await parseResponse(await get(db, '?stepId=st-m&format=reading'));
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'Membership required');

    const served = await parseResponse(await get(db, '?stepId=st-m&format=reading', { session: RAW.member }));
    assert.equal(served.status, 200);
    assert.equal(served.body.html, '<p>members only</p>');
  });

  it('a members course needs no enrolment row: membership IS the grant', async () => {
    await get(db, '?stepId=st-m&format=reading', { session: RAW.member });
    const count = db._sqlite.prepare('SELECT COUNT(*) AS n FROM enrollment').get().n;
    assert.equal(count, 0);
  });

  it('a paid course refuses a learner with no enrolment', async () => {
    const { status, body } = await parseResponse(await get(db, '?stepId=st-p&format=reading'));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not enrolled');
  });

  it('a paid course refuses a learner whose enrolment was revoked', async () => {
    db._sqlite.prepare("INSERT INTO enrollment (id, user_id, course_id, revoked_at) VALUES ('e1', ?, 'c-paid', '2026-06-01')").run(LEARNER);
    const { status } = await parseResponse(await get(db, '?stepId=st-p&format=reading'));
    assert.equal(status, 403);
  });

  it('a superadmin is auto-enrolled into the RESOLVED course and then served', async () => {
    const { status, body } = await parseResponse(await get(db, '?stepId=st-p&format=reading', { session: RAW.admin }));
    assert.equal(status, 200);
    assert.equal(body.html, '<p>paid</p>');

    const row = db._sqlite.prepare('SELECT * FROM enrollment WHERE user_id = ? AND course_id = ?').get(ADMIN, 'c-paid');
    assert.ok(row, 'the auto-enrol must actually write a row');
    assert.equal(row.revoked_at, null);
  });

  it('the superadmin auto-enrol un-revokes rather than duplicating', async () => {
    db._sqlite.prepare("INSERT INTO enrollment (id, user_id, course_id, revoked_at) VALUES ('e-admin', ?, 'c-paid', '2026-06-01')").run(ADMIN);
    await get(db, '?stepId=st-p&format=reading', { session: RAW.admin });
    const rows = db._sqlite.prepare('SELECT * FROM enrollment WHERE user_id = ? AND course_id = ?').all(ADMIN, 'c-paid');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].revoked_at, null);
  });

  it('a free course needs a session and nothing else', async () => {
    db._sqlite.exec("UPDATE course SET is_free = 1 WHERE id = 'c-paid'");
    const { status } = await parseResponse(await get(db, '?stepId=st-p&format=reading'));
    assert.equal(status, 200);
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM enrollment').get().n, 0);
  });

  it('a draft course hides its published rendition behind the same 404 as a missing one', async () => {
    db._sqlite.exec("UPDATE course SET status = 'draft' WHERE id = 'c-paid'");
    const { status, body } = await parseResponse(await get(db, '?stepId=st-p&format=reading', { session: RAW.admin }));
    assert.equal(status, 404);
    assert.equal(body.error, 'rendition_not_available');
  });
});

describe('GET /api/courses/rendition -- fixed step order', () => {
  let db;

  async function fixedDb(settingsJson) {
    return seededDb((sqlite) => {
      course(sqlite, { id: 'c-fixed', accessType: 'public', isFree: 1, settings: settingsJson });
      // Two sections, deliberately created in reverse sort order, so the lock
      // has to read ordering from the join rather than from insert order.
      section(sqlite, { id: 'sec-2', courseId: 'c-fixed', sortOrder: 2 });
      section(sqlite, { id: 'sec-1', courseId: 'c-fixed', sortOrder: 1 });
      step(sqlite, { id: 'st-b', sectionId: 'sec-2', courseId: 'c-fixed', sortOrder: 1 });
      step(sqlite, { id: 'st-a', sectionId: 'sec-1', courseId: 'c-fixed', sortOrder: 1 });
      step(sqlite, { id: 'st-hidden', sectionId: 'sec-1', courseId: 'c-fixed', sortOrder: 2, status: 'draft' });
      renditionRow(sqlite, { stepId: 'st-a', format: 'reading', content: { html: '<p>first</p>' } });
      renditionRow(sqlite, { stepId: 'st-b', format: 'reading', content: { html: '<p>second</p>' } });
    });
  }

  afterEach(() => db?.close());

  it('the first step in catalogue order is always readable', async () => {
    db = await fixedDb(JSON.stringify({ stepOrder: 'fixed' }));
    const { status } = await parseResponse(await get(db, '?stepId=st-a&format=reading'));
    assert.equal(status, 200);
  });

  it('a later step is locked until the previous one is complete', async () => {
    db = await fixedDb(JSON.stringify({ stepOrder: 'fixed' }));
    const locked = await parseResponse(await get(db, '?stepId=st-b&format=reading'));
    assert.equal(locked.status, 403);
    assert.equal(locked.body.error, 'Previous step not completed');

    db._sqlite.prepare(
      'INSERT INTO step_progress (user_id, course_id, step_id, completed, last_position_seconds) VALUES (?, ?, ?, 1, 0)'
    ).run(LEARNER, 'c-fixed', 'st-a');

    const open = await parseResponse(await get(db, '?stepId=st-b&format=reading'));
    assert.equal(open.status, 200);
    assert.equal(open.body.html, '<p>second</p>');
  });

  it('a started-but-unfinished previous step does not unlock the next one', async () => {
    db = await fixedDb(JSON.stringify({ stepOrder: 'fixed' }));
    db._sqlite.prepare(
      'INSERT INTO step_progress (user_id, course_id, step_id, completed, last_position_seconds) VALUES (?, ?, ?, 0, 45)'
    ).run(LEARNER, 'c-fixed', 'st-a');
    const { status } = await parseResponse(await get(db, '?stepId=st-b&format=reading'));
    assert.equal(status, 403);
  });

  it('the lock ignores draft steps when deciding what "previous" means', async () => {
    db = await fixedDb(JSON.stringify({ stepOrder: 'fixed' }));
    // st-hidden sits between st-a and st-b in raw sort order but is draft, so
    // completing st-a alone must be enough to open st-b.
    db._sqlite.prepare(
      'INSERT INTO step_progress (user_id, course_id, step_id, completed, last_position_seconds) VALUES (?, ?, ?, 1, 0)'
    ).run(LEARNER, 'c-fixed', 'st-a');
    const { status } = await parseResponse(await get(db, '?stepId=st-b&format=reading'));
    assert.equal(status, 200);
  });

  it('without stepOrder fixed there is no lock at all', async () => {
    db = await fixedDb(JSON.stringify({ stepOrder: 'free' }));
    const { status } = await parseResponse(await get(db, '?stepId=st-b&format=reading'));
    assert.equal(status, 200);
  });

  it('an unreadable settings column is treated as no settings, not as a lock', async () => {
    db = await fixedDb('{not json');
    const { status } = await parseResponse(await get(db, '?stepId=st-b&format=reading'));
    assert.equal(status, 200);
  });

  it('a null settings column is treated as no settings', async () => {
    db = await fixedDb(null);
    const { status } = await parseResponse(await get(db, '?stepId=st-b&format=reading'));
    assert.equal(status, 200);
  });
});
