/**
 * functions/api/courses/comments.js -- learner-authored discussion under a lesson.
 *
 * WHY A REAL ENGINE HERE
 * This is an untrusted-input surface with a four-verb authorization matrix, and
 * every consequential decision it makes is a database decision:
 *   - "is this person enrolled" is a row lookup with `revoked_at IS NULL`, so a
 *     refunded learner losing write access is decided by SQL, not by the handler;
 *   - "is this my comment" is a stored `user_id` compared against the session
 *     user, and the PATCH additionally re-scopes its UPDATE to
 *     `WHERE id = ? AND user_id = ?` so a lost ownership check would still have
 *     to get past the write;
 *   - DELETE fans out to `db.batch()` because ON DELETE CASCADE is inert in D1,
 *     so whether a thread's replies actually disappear is only observable by
 *     reading the table back.
 * Under test/_helpers.js mockDB every one of those would be a canned row, and an
 * assertion that "learner B could not edit learner A's comment" would be an
 * assertion about the fixture. Everything below runs on node:sqlite loaded with
 * the committed schema (test/_d1-sqlite.mjs), so the rows asserted on are rows
 * the handler actually wrote.
 *
 * WHAT IS STILL FAKED, AND WHAT THAT CANNOT DISTINGUISH
 *  - src/data/courses.json is the deterministic fixture from
 *    test/_json-module-hook.mjs, not the deployed catalogue. These tests prove
 *    behaviour GIVEN a catalogue shape (one public course, one `members` course);
 *    they cannot prove the live catalogue has that shape.
 *  - Stripe is never reached: the members-only gate is satisfied through the
 *    explicit `STUC Legacy Grandfather` allowlist row and refused by the absence
 *    of any membership signal, both of which are pure D1 paths inside
 *    requireMember(). The Stripe arm of that helper is covered by the community
 *    membership-gate suite, not here.
 *  - Analytics Engine is a capturing stub, asserted only where a test says so.
 *
 * ESCAPING, STATED EXPLICITLY
 * The endpoint stores comment bodies VERBATIM apart from a .trim(); it performs
 * no HTML escaping and no sanitisation. That is not a defect on its own -- the
 * only renderer, src/pages/courses/[slug]/[stepId].astro, escapes through
 * textContent before it ever builds markup -- but it IS a load-bearing contract,
 * so `stores markup verbatim` below pins it. Any future server-rendered view of
 * these rows must escape at render time.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './_json-module-hook.mjs';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser, insertSession, insertLabel } from './_d1-sqlite.mjs';

const comments = await import('../functions/api/courses/comments.js');

// --- fixture identities ------------------------------------------------------
const LEARNER = 'u_learner';
const OTHER = 'u_other';
const ADMIN = 'u_admin';
const MEMBER = 'u_member';      // passes requireMember via the grandfather allowlist
const NONMEMBER = 'u_nonmember'; // enrolled in the members course, no membership signal
const NAMELESS = 'u_nameless';   // no name, no first_name, no last_name
const FIRST_ONLY = 'u_first';
const LAST_ONLY = 'u_last';
const BOTH_NAMES = 'u_both';

const RAW = {
  [LEARNER]: 'raw-session-learner',
  [OTHER]: 'raw-session-other',
  [ADMIN]: 'raw-session-admin',
  [MEMBER]: 'raw-session-member',
  [NONMEMBER]: 'raw-session-nonmember',
  [NAMELESS]: 'raw-session-nameless',
};
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

const PUBLIC_COURSE = 'test-course-basic';   // fixture has no accessType -> gate skipped
const PUBLIC_STEP = 'step-1';
const MEMBERS_COURSE = 'test-course-fixed';  // fixture accessType: 'members'
const MEMBERS_STEP = 'fx-step-1';

/** Builds the rrm-auth harness with every fixture identity and a live session each. */
async function seededDb({ seed, interleave } = {}) {
  const db = sqliteD1({
    interleave,
    seed(sqlite) {
      insertUser(sqlite, { id: LEARNER, email: 'learner@example.com', name: 'Learner One' });
      insertUser(sqlite, { id: OTHER, email: 'other@example.com', name: 'Other Two' });
      insertUser(sqlite, { id: ADMIN, email: 'admin@example.com', name: 'Admin Three', role: 'admin' });
      insertUser(sqlite, { id: MEMBER, email: 'member@example.com', name: 'Member Four' });
      insertUser(sqlite, { id: NONMEMBER, email: 'nonmember@example.com', name: 'Nonmember Five' });
      insertUser(sqlite, { id: NAMELESS, email: 'nameless@example.com' });
      insertUser(sqlite, { id: FIRST_ONLY, email: 'first@example.com', first_name: 'Ada' });
      insertUser(sqlite, { id: LAST_ONLY, email: 'last@example.com', last_name: 'Lovelace' });
      insertUser(sqlite, { id: BOTH_NAMES, email: 'both@example.com', first_name: 'Grace', last_name: 'Hopper' });
      // The one membership signal these tests rely on: an explicit allowlist row,
      // which requireMember honours before any Stripe or Wix lookup.
      insertLabel(sqlite, MEMBER, 'STUC Legacy Grandfather');
      if (seed) seed(sqlite);
    },
  });
  await Promise.all(Object.entries(RAW).map(([userId, rawId]) =>
    insertSession(db._sqlite, { rawId, userId, expiresAt: FUTURE })));
  return db;
}

function enroll(sqlite, { userId, courseId, revokedAt = null }) {
  sqlite.prepare('INSERT INTO enrollment (id, user_id, course_id, revoked_at) VALUES (?, ?, ?, ?)')
    .run(`e_${userId}_${courseId}`, userId, courseId, revokedAt);
}

function insertComment(sqlite, {
  id, userId, courseId = PUBLIC_COURSE, stepId = PUBLIC_STEP, content = 'hello',
  parentId = null, createdAt = '2026-01-01 00:00:00',
}) {
  sqlite.prepare(
    'INSERT INTO lesson_comment (id, user_id, course_id, step_id, content, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, courseId, stepId, content, parentId, createdAt, createdAt);
}

const rows = (db, sql, ...args) => db._sqlite.prepare(sql).all(...args).map(r => ({ ...r }));
const one = (db, sql, ...args) => {
  const r = db._sqlite.prepare(sql).get(...args);
  return r === undefined ? null : { ...r };
};

const cookie = (userId) => ({ Cookie: `session=${RAW[userId]}` });

/** env + a capturing Analytics Engine, so log() calls are observable. */
function envFor(db, overrides = {}) {
  const events = [];
  const env = mockEnv({
    DB: db,
    EVENTS: { writeDataPoint: (dp) => events.push(dp) },
    ...overrides,
  });
  return { env, events };
}

function ctx(db, request, overrides) {
  const { env, events } = envFor(db, overrides);
  return { request, env, waitUntil: mockWaitUntil(), events };
}

const getReq = (userId, qs) => mockRequest('GET', {
  url: `https://rrmacademy.org/api/courses/comments${qs}`,
  headers: userId ? cookie(userId) : {},
});
const bodyReq = (method, userId, body) => mockRequest(method, {
  url: 'https://rrmacademy.org/api/courses/comments',
  headers: userId ? cookie(userId) : {},
  body,
});
const rawBodyReq = (method, userId, rawBody) => mockRequest(method, {
  url: 'https://rrmacademy.org/api/courses/comments',
  headers: userId ? cookie(userId) : {},
  rawBody,
});

/** A stub whose every statement throws, for "D1 is down" without a live engine. */
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

// ---------------------------------------------------------------- OPTIONS ---

describe('OPTIONS /api/courses/comments', () => {
  it('answers the CORS preflight with 204 and the locked origin', async () => {
    const res = await comments.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  });
});

// -------------------------------------------------------------------- GET ---

describe('GET /api/courses/comments -- gating', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('503-class misconfiguration: no DB binding returns 500, never an empty 200', async () => {
    const res = await comments.onRequestGet(ctx(db, getReq(LEARNER, `?courseId=${PUBLIC_COURSE}&stepId=${PUBLIC_STEP}`), { DB: undefined }));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.ok, false);
  });

  it('rejects an anonymous reader with 401', async () => {
    const res = await comments.onRequestGet(ctx(db, getReq(null, `?courseId=${PUBLIC_COURSE}&stepId=${PUBLIC_STEP}`)));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
  });

  it('rejects a forged session cookie with 401', async () => {
    const req = mockRequest('GET', {
      url: `https://rrmacademy.org/api/courses/comments?courseId=${PUBLIC_COURSE}&stepId=${PUBLIC_STEP}`,
      headers: { Cookie: 'session=not-a-real-session' },
    });
    const { status } = await parseResponse(await comments.onRequestGet(ctx(db, req)));
    assert.equal(status, 401);
  });

  it('requires courseId', async () => {
    const { status, body } = await parseResponse(
      await comments.onRequestGet(ctx(db, getReq(LEARNER, `?stepId=${PUBLIC_STEP}`))));
    assert.equal(status, 400);
    assert.equal(body.error, 'courseId and stepId required');
  });

  it('requires stepId', async () => {
    const { status, body } = await parseResponse(
      await comments.onRequestGet(ctx(db, getReq(LEARNER, `?courseId=${PUBLIC_COURSE}`))));
    assert.equal(status, 400);
    assert.equal(body.error, 'courseId and stepId required');
  });

  it('rejects a step that does not belong to the course', async () => {
    enroll(db._sqlite, { userId: LEARNER, courseId: PUBLIC_COURSE });
    const { status, body } = await parseResponse(
      await comments.onRequestGet(ctx(db, getReq(LEARNER, `?courseId=${PUBLIC_COURSE}&stepId=${MEMBERS_STEP}`))));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid step');
  });

  it('rejects an unknown course before it ever touches the database', async () => {
    const { status, body } = await parseResponse(
      await comments.onRequestGet(ctx(db, getReq(LEARNER, '?courseId=no-such-course&stepId=step-1'))));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid step');
  });

  it('refuses a signed-in reader who is not enrolled', async () => {
    insertComment(db._sqlite, { id: 'c1', userId: OTHER });
    const { status, body } = await parseResponse(
      await comments.onRequestGet(ctx(db, getReq(LEARNER, `?courseId=${PUBLIC_COURSE}&stepId=${PUBLIC_STEP}`))));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not enrolled');
  });

  it('refuses a reader whose enrollment was revoked (refund removes read access)', async () => {
    enroll(db._sqlite, { userId: LEARNER, courseId: PUBLIC_COURSE, revokedAt: '2026-03-01 00:00:00' });
    const { status, body } = await parseResponse(
      await comments.onRequestGet(ctx(db, getReq(LEARNER, `?courseId=${PUBLIC_COURSE}&stepId=${PUBLIC_STEP}`))));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not enrolled');
  });

  it('returns 500 and logs when D1 throws', async () => {
    const c = ctx(db, getReq(LEARNER, `?courseId=${PUBLIC_COURSE}&stepId=${PUBLIC_STEP}`), { DB: deadDb });
    const { status, body } = await parseResponse(await comments.onRequestGet(c));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    const logged = c.events.find(e => e.blobs[2] === 'course_comment_error');
    assert.ok(logged, 'expected a course_comment_error event');
    assert.ok(logged.blobs[4].startsWith('GET: '));
  });
});

describe('GET /api/courses/comments -- thread assembly', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb();
    enroll(db._sqlite, { userId: LEARNER, courseId: PUBLIC_COURSE });
  });
  afterEach(() => db.close());

  const list = async (userId = LEARNER, courseId = PUBLIC_COURSE, stepId = PUBLIC_STEP) =>
    parseResponse(await comments.onRequestGet(ctx(db, getReq(userId, `?courseId=${courseId}&stepId=${stepId}`))));

  it('nests replies under their parent and orders both by created_at ascending', async () => {
    insertComment(db._sqlite, { id: 'top-b', userId: OTHER, content: 'second top', createdAt: '2026-02-02 00:00:00' });
    insertComment(db._sqlite, { id: 'top-a', userId: LEARNER, content: 'first top', createdAt: '2026-02-01 00:00:00' });
    insertComment(db._sqlite, { id: 'r2', userId: OTHER, content: 'later reply', parentId: 'top-a', createdAt: '2026-02-04 00:00:00' });
    insertComment(db._sqlite, { id: 'r1', userId: OTHER, content: 'early reply', parentId: 'top-a', createdAt: '2026-02-03 00:00:00' });

    const { status, body } = await list();
    assert.equal(status, 200);
    assert.equal(body.count, 4);
    assert.deepEqual(body.comments.map(c => c.id), ['top-a', 'top-b']);
    assert.deepEqual(body.comments[0].replies.map(r => r.id), ['r1', 'r2']);
    assert.deepEqual(body.comments[1].replies, []);
  });

  it('drops a reply whose parent is not in this step, but still counts the row', async () => {
    insertComment(db._sqlite, { id: 'top-a', userId: LEARNER, createdAt: '2026-02-01 00:00:00' });
    // Parent lives in a different course/step, so it is absent from this result set.
    insertComment(db._sqlite, { id: 'orphan', userId: OTHER, parentId: 'ghost-parent', createdAt: '2026-02-02 00:00:00' });

    const { body } = await list();
    assert.equal(body.count, 2);
    assert.deepEqual(body.comments.map(c => c.id), ['top-a']);
    assert.deepEqual(body.comments[0].replies, []);
  });

  it('scopes the list to one step of one course', async () => {
    enroll(db._sqlite, { userId: LEARNER, courseId: MEMBERS_COURSE });
    insertComment(db._sqlite, { id: 'here', userId: LEARNER });
    insertComment(db._sqlite, { id: 'other-step', userId: LEARNER, courseId: MEMBERS_COURSE, stepId: MEMBERS_STEP });

    const { body } = await list();
    assert.deepEqual(body.comments.map(c => c.id), ['here']);
  });

  it('flags only the reader\'s own comments as isOwn', async () => {
    insertComment(db._sqlite, { id: 'mine', userId: LEARNER, createdAt: '2026-02-01 00:00:00' });
    insertComment(db._sqlite, { id: 'theirs', userId: OTHER, createdAt: '2026-02-02 00:00:00' });

    const { body } = await list();
    assert.deepEqual(body.comments.map(c => [c.id, c.isOwn]), [['mine', true], ['theirs', false]]);
    assert.equal(body.comments[1].userId, OTHER);
  });

  it('derives a display name from whichever name fields exist, falling back to Student', async () => {
    insertComment(db._sqlite, { id: 'c1', userId: LEARNER, createdAt: '2026-02-01 00:00:00' });      // user.name
    insertComment(db._sqlite, { id: 'c2', userId: BOTH_NAMES, createdAt: '2026-02-02 00:00:00' });   // first + last
    insertComment(db._sqlite, { id: 'c3', userId: FIRST_ONLY, createdAt: '2026-02-03 00:00:00' });   // first only
    insertComment(db._sqlite, { id: 'c4', userId: LAST_ONLY, createdAt: '2026-02-04 00:00:00' });    // last only
    insertComment(db._sqlite, { id: 'c5', userId: NAMELESS, createdAt: '2026-02-05 00:00:00' });     // nothing

    const { body } = await list();
    assert.deepEqual(body.comments.map(c => c.userName),
      ['Learner One', 'Grace H.', 'Ada', 'Lovelace', 'Student']);
  });

  it('names an author whose user row is gone as Student rather than failing the read', async () => {
    insertComment(db._sqlite, { id: 'c1', userId: 'u_deleted' });
    const { status, body } = await list();
    assert.equal(status, 200);
    assert.equal(body.comments[0].userName, 'Student');
    assert.equal(body.comments[0].userId, 'u_deleted');
  });

  it('returns stored markup verbatim -- escaping is the renderer\'s job, not this endpoint\'s', async () => {
    insertComment(db._sqlite, { id: 'c1', userId: LEARNER, content: '<img src=x onerror=alert(1)>' });
    const { body } = await list();
    assert.equal(body.comments[0].content, '<img src=x onerror=alert(1)>');
  });

  it('returns an empty thread rather than 404 when nobody has commented', async () => {
    const { status, body } = await list();
    assert.equal(status, 200);
    assert.deepEqual(body.comments, []);
    assert.equal(body.count, 0);
  });
});

// ------------------------------------------------------------------- POST ---

describe('POST /api/courses/comments -- validation', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb();
    enroll(db._sqlite, { userId: LEARNER, courseId: PUBLIC_COURSE });
  });
  afterEach(() => db.close());

  const post = async (body, userId = LEARNER) =>
    parseResponse(await comments.onRequestPost(ctx(db, bodyReq('POST', userId, body))));

  const valid = { courseId: PUBLIC_COURSE, stepId: PUBLIC_STEP, content: 'hello' };

  it('returns 500 when the DB binding is missing', async () => {
    const { status } = await parseResponse(
      await comments.onRequestPost(ctx(db, bodyReq('POST', LEARNER, valid), { DB: undefined })));
    assert.equal(status, 500);
  });

  it('rejects an anonymous poster with 401 and writes nothing', async () => {
    const { status } = await post(valid, null);
    assert.equal(status, 401);
    assert.equal(rows(db, 'SELECT id FROM lesson_comment').length, 0);
  });

  it('rejects a malformed JSON body', async () => {
    const { status, body } = await parseResponse(
      await comments.onRequestPost(ctx(db, rawBodyReq('POST', LEARNER, '{not json'))));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('rejects a JSON array body', async () => {
    const { status, body } = await post([valid]);
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  it('rejects a JSON null body', async () => {
    const { status, body } = await parseResponse(
      await comments.onRequestPost(ctx(db, rawBodyReq('POST', LEARNER, 'null'))));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  it('requires courseId and stepId', async () => {
    assert.equal((await post({ stepId: PUBLIC_STEP, content: 'x' })).body.error, 'courseId and stepId required');
    assert.equal((await post({ courseId: PUBLIC_COURSE, content: 'x' })).body.error, 'courseId and stepId required');
  });

  it('requires non-empty string content', async () => {
    assert.equal((await post({ ...valid, content: undefined })).status, 400);
    assert.equal((await post({ ...valid, content: 42 })).body.error, 'content required');
    assert.equal((await post({ ...valid, content: '   \n  ' })).body.error, 'content required');
    assert.equal(rows(db, 'SELECT id FROM lesson_comment').length, 0);
  });

  it('caps content at 2000 characters', async () => {
    const { status, body } = await post({ ...valid, content: 'x'.repeat(2001) });
    assert.equal(status, 400);
    assert.equal(body.error, 'Comment too long (max 2000 chars)');
    assert.equal(rows(db, 'SELECT id FROM lesson_comment').length, 0);
  });

  it('accepts exactly 2000 characters (the cap is inclusive)', async () => {
    const { status } = await post({ ...valid, content: 'x'.repeat(2000) });
    assert.equal(status, 201);
    assert.equal(one(db, 'SELECT length(content) AS n FROM lesson_comment').n, 2000);
  });

  it('rejects a step that is not part of the course', async () => {
    const { status, body } = await post({ ...valid, stepId: 'fx-step-2' });
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid step');
  });

  it('refuses a poster who is not enrolled', async () => {
    const { status, body } = await post(valid, OTHER);
    assert.equal(status, 403);
    assert.equal(body.error, 'Not enrolled');
    assert.equal(rows(db, 'SELECT id FROM lesson_comment').length, 0);
  });
});

describe('POST /api/courses/comments -- writes', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb();
    enroll(db._sqlite, { userId: LEARNER, courseId: PUBLIC_COURSE });
  });
  afterEach(() => db.close());

  const post = async (body, userId = LEARNER) =>
    parseResponse(await comments.onRequestPost(ctx(db, bodyReq('POST', userId, body))));

  it('stores the comment against the SESSION user, not any user id in the body', async () => {
    const { status, body } = await post({
      courseId: PUBLIC_COURSE, stepId: PUBLIC_STEP, content: '  spaces trimmed  ',
      user_id: OTHER, userId: OTHER,
    });
    assert.equal(status, 201);

    const stored = one(db, 'SELECT * FROM lesson_comment WHERE id = ?', body.comment.id);
    assert.ok(stored, 'the row must actually exist');
    assert.equal(stored.user_id, LEARNER);
    assert.equal(stored.content, 'spaces trimmed');
    assert.equal(stored.course_id, PUBLIC_COURSE);
    assert.equal(stored.step_id, PUBLIC_STEP);
    assert.equal(stored.parent_id, null);
  });

  it('echoes back the created comment with an empty replies array and isOwn true', async () => {
    const { body } = await post({ courseId: PUBLIC_COURSE, stepId: PUBLIC_STEP, content: 'hi' });
    assert.equal(body.comment.userId, LEARNER);
    assert.equal(body.comment.userName, 'Learner One');
    assert.equal(body.comment.isOwn, true);
    assert.deepEqual(body.comment.replies, []);
    assert.match(body.comment.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('falls back to Student when the poster has no name fields at all', async () => {
    enroll(db._sqlite, { userId: NAMELESS, courseId: PUBLIC_COURSE });
    const { body } = await post({ courseId: PUBLIC_COURSE, stepId: PUBLIC_STEP, content: 'hi' }, NAMELESS);
    assert.equal(body.comment.userName, 'Student');
  });

  it('stores markup verbatim (documented contract: the renderer escapes)', async () => {
    const payload = '<script>alert(1)</script>';
    const { body } = await post({ courseId: PUBLIC_COURSE, stepId: PUBLIC_STEP, content: payload });
    assert.equal(one(db, 'SELECT content FROM lesson_comment WHERE id = ?', body.comment.id).content, payload);
  });

  it('attaches a reply to an existing top-level parent', async () => {
    insertComment(db._sqlite, { id: 'parent', userId: OTHER });
    const { status, body } = await post({ courseId: PUBLIC_COURSE, stepId: PUBLIC_STEP, content: 'reply', parentId: 'parent' });
    assert.equal(status, 201);
    assert.equal(body.comment.parentId, 'parent');
    assert.equal(one(db, 'SELECT parent_id FROM lesson_comment WHERE id = ?', body.comment.id).parent_id, 'parent');
  });

  it('refuses a reply to a parent in a different step', async () => {
    enroll(db._sqlite, { userId: LEARNER, courseId: MEMBERS_COURSE });
    insertComment(db._sqlite, { id: 'elsewhere', userId: OTHER, courseId: MEMBERS_COURSE, stepId: MEMBERS_STEP });
    const { status, body } = await post({ courseId: PUBLIC_COURSE, stepId: PUBLIC_STEP, content: 'x', parentId: 'elsewhere' });
    assert.equal(status, 400);
    assert.equal(body.error, 'Parent comment not found');
    assert.equal(rows(db, 'SELECT id FROM lesson_comment WHERE content = ?', 'x').length, 0);
  });

  it('refuses a reply to a reply -- threading stays one level deep', async () => {
    insertComment(db._sqlite, { id: 'parent', userId: OTHER });
    insertComment(db._sqlite, { id: 'child', userId: OTHER, parentId: 'parent' });
    const { status, body } = await post({ courseId: PUBLIC_COURSE, stepId: PUBLIC_STEP, content: 'x', parentId: 'child' });
    assert.equal(status, 400);
    assert.equal(body.error, 'Parent comment not found');
  });

  it('refuses a reply to a parent id that does not exist', async () => {
    const { status } = await post({ courseId: PUBLIC_COURSE, stepId: PUBLIC_STEP, content: 'x', parentId: 'nope' });
    assert.equal(status, 400);
  });

  it('returns 500 and logs when the INSERT throws', async () => {
    const dbThrow = await seededDb({
      interleave: ({ sql }) => { if (sql.includes('INSERT INTO lesson_comment')) throw new Error('D1_ERROR: write failed'); },
    });
    enroll(dbThrow._sqlite, { userId: LEARNER, courseId: PUBLIC_COURSE });
    const c = ctx(dbThrow, bodyReq('POST', LEARNER, { courseId: PUBLIC_COURSE, stepId: PUBLIC_STEP, content: 'x' }));
    const { status, body } = await parseResponse(await comments.onRequestPost(c));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(c.events.find(e => e.blobs[2] === 'course_comment_error' && e.blobs[4].startsWith('POST: ')));
    assert.equal(rows(dbThrow, 'SELECT id FROM lesson_comment').length, 0);
    dbThrow.close();
  });
});

describe('POST /api/courses/comments -- members-only course gate', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb();
    enroll(db._sqlite, { userId: MEMBER, courseId: MEMBERS_COURSE });
    enroll(db._sqlite, { userId: NONMEMBER, courseId: MEMBERS_COURSE });
  });
  afterEach(() => db.close());

  const post = (userId) => comments.onRequestPost(ctx(db, bodyReq('POST', userId, {
    courseId: MEMBERS_COURSE, stepId: MEMBERS_STEP, content: 'members only',
  })));

  it('lets an enrolled ACTIVE member post', async () => {
    const { status } = await parseResponse(await post(MEMBER));
    assert.equal(status, 201);
    assert.equal(rows(db, 'SELECT id FROM lesson_comment WHERE user_id = ?', MEMBER).length, 1);
  });

  it('blocks an enrolled learner whose membership has lapsed, and writes nothing', async () => {
    const { status, body } = await parseResponse(await post(NONMEMBER));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
    assert.equal(rows(db, 'SELECT id FROM lesson_comment').length, 0);
  });
});

// ------------------------------------------------------------------ PATCH ---

describe('PATCH /api/courses/comments', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb();
    enroll(db._sqlite, { userId: LEARNER, courseId: PUBLIC_COURSE });
    enroll(db._sqlite, { userId: OTHER, courseId: PUBLIC_COURSE });
    insertComment(db._sqlite, { id: 'c-learner', userId: LEARNER, content: 'original' });
  });
  afterEach(() => db.close());

  const patch = async (body, userId = LEARNER) =>
    parseResponse(await comments.onRequestPatch(ctx(db, bodyReq('PATCH', userId, body))));

  it('returns 500 when the DB binding is missing', async () => {
    const { status } = await parseResponse(await comments.onRequestPatch(
      ctx(db, bodyReq('PATCH', LEARNER, { commentId: 'c-learner', content: 'x' }), { DB: undefined })));
    assert.equal(status, 500);
  });

  it('rejects an anonymous editor with 401', async () => {
    const { status } = await patch({ commentId: 'c-learner', content: 'x' }, null);
    assert.equal(status, 401);
    assert.equal(one(db, 'SELECT content FROM lesson_comment WHERE id = ?', 'c-learner').content, 'original');
  });

  it('rejects a malformed JSON body', async () => {
    const { status, body } = await parseResponse(
      await comments.onRequestPatch(ctx(db, rawBodyReq('PATCH', LEARNER, 'oops'))));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('rejects a non-object body', async () => {
    assert.equal((await patch([])).body.error, 'Invalid payload');
    const { body } = await parseResponse(await comments.onRequestPatch(ctx(db, rawBodyReq('PATCH', LEARNER, 'null'))));
    assert.equal(body.error, 'Invalid payload');
  });

  it('validates commentId shape', async () => {
    assert.equal((await patch({ content: 'x' })).body.error, 'commentId required');
    assert.equal((await patch({ commentId: 99, content: 'x' })).body.error, 'commentId required');
    assert.equal((await patch({ commentId: 'a'.repeat(101), content: 'x' })).body.error, 'commentId required');
  });

  it('validates content', async () => {
    assert.equal((await patch({ commentId: 'c-learner' })).body.error, 'content required');
    assert.equal((await patch({ commentId: 'c-learner', content: '  ' })).body.error, 'content required');
    assert.equal((await patch({ commentId: 'c-learner', content: 'y'.repeat(2001) })).body.error,
      'Comment too long (max 2000 chars)');
    assert.equal(one(db, 'SELECT content FROM lesson_comment WHERE id = ?', 'c-learner').content, 'original');
  });

  it('404s on an unknown comment', async () => {
    const { status, body } = await patch({ commentId: 'nope', content: 'x' });
    assert.equal(status, 404);
    assert.equal(body.error, 'Comment not found');
  });

  it('AUTHORIZATION: a learner cannot edit another learner\'s comment', async () => {
    const { status, body } = await patch({ commentId: 'c-learner', content: 'hijacked' }, OTHER);
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(one(db, 'SELECT content FROM lesson_comment WHERE id = ?', 'c-learner').content, 'original');
  });

  it('AUTHORIZATION: an admin cannot edit someone else\'s comment either (delete-only moderation)', async () => {
    const { status, body } = await patch({ commentId: 'c-learner', content: 'moderated' }, ADMIN);
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(one(db, 'SELECT content FROM lesson_comment WHERE id = ?', 'c-learner').content, 'original');
  });

  it('refuses an author whose enrollment was revoked', async () => {
    db._sqlite.prepare('UPDATE enrollment SET revoked_at = ? WHERE user_id = ?').run('2026-03-01 00:00:00', LEARNER);
    const { status, body } = await patch({ commentId: 'c-learner', content: 'x' });
    assert.equal(status, 403);
    assert.equal(body.error, 'Not enrolled');
    assert.equal(one(db, 'SELECT content FROM lesson_comment WHERE id = ?', 'c-learner').content, 'original');
  });

  it('updates the row and stamps updated_at', async () => {
    const before = one(db, 'SELECT updated_at FROM lesson_comment WHERE id = ?', 'c-learner').updated_at;
    const { status, body } = await patch({ commentId: 'c-learner', content: '  edited text  ' });
    assert.equal(status, 200);
    assert.equal(body.ok, true);

    const after = one(db, 'SELECT content, updated_at FROM lesson_comment WHERE id = ?', 'c-learner');
    assert.equal(after.content, 'edited text');
    assert.notEqual(after.updated_at, before);
  });

  it('does not disturb any other comment', async () => {
    insertComment(db._sqlite, { id: 'c-other', userId: OTHER, content: 'untouched' });
    await patch({ commentId: 'c-learner', content: 'edited' });
    assert.equal(one(db, 'SELECT content FROM lesson_comment WHERE id = ?', 'c-other').content, 'untouched');
  });

  it('returns 403 when the row vanishes between the ownership check and the UPDATE', async () => {
    let fired = false;
    const raced = await seededDb({
      seed(sqlite) {
        sqlite.prepare('INSERT INTO enrollment (id, user_id, course_id) VALUES (?, ?, ?)')
          .run('e_race', LEARNER, PUBLIC_COURSE);
        sqlite.prepare('INSERT INTO lesson_comment (id, user_id, course_id, step_id, content) VALUES (?, ?, ?, ?, ?)')
          .run('c-race', LEARNER, PUBLIC_COURSE, PUBLIC_STEP, 'original');
      },
      interleave: ({ sql, db: sqlite }) => {
        if (fired || !sql.includes('UPDATE lesson_comment SET content')) return;
        fired = true;
        sqlite.prepare('DELETE FROM lesson_comment WHERE id = ?').run('c-race');
      },
    });
    const { status, body } = await parseResponse(await comments.onRequestPatch(
      ctx(raced, bodyReq('PATCH', LEARNER, { commentId: 'c-race', content: 'edited' }))));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    raced.close();
  });

  it('returns 500 and logs when D1 throws', async () => {
    const c = ctx(db, bodyReq('PATCH', LEARNER, { commentId: 'c-learner', content: 'x' }), { DB: deadDb });
    const { status } = await parseResponse(await comments.onRequestPatch(c));
    assert.equal(status, 500);
    assert.ok(c.events.find(e => e.blobs[2] === 'course_comment_error' && e.blobs[4].startsWith('PATCH: ')));
  });
});

describe('PATCH /api/courses/comments -- members-only course gate', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb({
      seed(sqlite) {
        sqlite.prepare('INSERT INTO lesson_comment (id, user_id, course_id, step_id, content) VALUES (?, ?, ?, ?, ?)')
          .run('c-member', MEMBER, MEMBERS_COURSE, MEMBERS_STEP, 'member text');
        sqlite.prepare('INSERT INTO lesson_comment (id, user_id, course_id, step_id, content) VALUES (?, ?, ?, ?, ?)')
          .run('c-nonmember', NONMEMBER, MEMBERS_COURSE, MEMBERS_STEP, 'lapsed text');
      },
    });
    enroll(db._sqlite, { userId: MEMBER, courseId: MEMBERS_COURSE });
    enroll(db._sqlite, { userId: NONMEMBER, courseId: MEMBERS_COURSE });
  });
  afterEach(() => db.close());

  it('lets an active member edit their own comment', async () => {
    const { status } = await parseResponse(await comments.onRequestPatch(
      ctx(db, bodyReq('PATCH', MEMBER, { commentId: 'c-member', content: 'revised' }))));
    assert.equal(status, 200);
    assert.equal(one(db, 'SELECT content FROM lesson_comment WHERE id = ?', 'c-member').content, 'revised');
  });

  it('blocks a lapsed member from editing their own comment, and leaves it unchanged', async () => {
    const { status, body } = await parseResponse(await comments.onRequestPatch(
      ctx(db, bodyReq('PATCH', NONMEMBER, { commentId: 'c-nonmember', content: 'revised' }))));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
    assert.equal(one(db, 'SELECT content FROM lesson_comment WHERE id = ?', 'c-nonmember').content, 'lapsed text');
  });

  it('skips the membership gate for a comment whose course is no longer in the catalogue', async () => {
    db._sqlite.prepare('INSERT INTO lesson_comment (id, user_id, course_id, step_id, content) VALUES (?, ?, ?, ?, ?)')
      .run('c-retired', NONMEMBER, 'retired-course', 'retired-step', 'old');
    db._sqlite.prepare('INSERT INTO enrollment (id, user_id, course_id) VALUES (?, ?, ?)')
      .run('e_retired', NONMEMBER, 'retired-course');
    const { status } = await parseResponse(await comments.onRequestPatch(
      ctx(db, bodyReq('PATCH', NONMEMBER, { commentId: 'c-retired', content: 'still editable' }))));
    assert.equal(status, 200);
    assert.equal(one(db, 'SELECT content FROM lesson_comment WHERE id = ?', 'c-retired').content, 'still editable');
  });
});

// ----------------------------------------------------------------- DELETE ---

describe('DELETE /api/courses/comments', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb();
    enroll(db._sqlite, { userId: LEARNER, courseId: PUBLIC_COURSE });
    enroll(db._sqlite, { userId: OTHER, courseId: PUBLIC_COURSE });
    insertComment(db._sqlite, { id: 'c-learner', userId: LEARNER, content: 'original' });
  });
  afterEach(() => db.close());

  const del = async (body, userId = LEARNER) =>
    parseResponse(await comments.onRequestDelete(ctx(db, bodyReq('DELETE', userId, body))));

  it('returns 500 when the DB binding is missing', async () => {
    const { status } = await parseResponse(await comments.onRequestDelete(
      ctx(db, bodyReq('DELETE', LEARNER, { commentId: 'c-learner' }), { DB: undefined })));
    assert.equal(status, 500);
  });

  it('rejects an anonymous caller with 401 and deletes nothing', async () => {
    const { status } = await del({ commentId: 'c-learner' }, null);
    assert.equal(status, 401);
    assert.ok(one(db, 'SELECT id FROM lesson_comment WHERE id = ?', 'c-learner'));
  });

  it('rejects a malformed JSON body', async () => {
    const { status, body } = await parseResponse(
      await comments.onRequestDelete(ctx(db, rawBodyReq('DELETE', LEARNER, '<<<'))));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('rejects a non-object body', async () => {
    assert.equal((await del([])).body.error, 'Invalid payload');
    const { body } = await parseResponse(await comments.onRequestDelete(ctx(db, rawBodyReq('DELETE', LEARNER, 'null'))));
    assert.equal(body.error, 'Invalid payload');
  });

  it('validates commentId shape', async () => {
    assert.equal((await del({})).body.error, 'commentId required');
    assert.equal((await del({ commentId: { $ne: null } })).body.error, 'commentId required');
    assert.equal((await del({ commentId: 'a'.repeat(101) })).body.error, 'commentId required');
  });

  it('404s on an unknown comment', async () => {
    const { status, body } = await del({ commentId: 'nope' });
    assert.equal(status, 404);
    assert.equal(body.error, 'Comment not found');
  });

  it('AUTHORIZATION: a learner cannot delete another learner\'s comment', async () => {
    const { status, body } = await del({ commentId: 'c-learner' }, OTHER);
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.ok(one(db, 'SELECT id FROM lesson_comment WHERE id = ?', 'c-learner'), 'row must survive');
  });

  it('refuses an author whose enrollment was revoked', async () => {
    db._sqlite.prepare('UPDATE enrollment SET revoked_at = ? WHERE user_id = ?').run('2026-03-01 00:00:00', LEARNER);
    const { status, body } = await del({ commentId: 'c-learner' });
    assert.equal(status, 403);
    assert.equal(body.error, 'Not enrolled');
    assert.ok(one(db, 'SELECT id FROM lesson_comment WHERE id = ?', 'c-learner'));
  });

  it('removes the author\'s own comment and every reply under it, in one batch', async () => {
    insertComment(db._sqlite, { id: 'r1', userId: OTHER, parentId: 'c-learner' });
    insertComment(db._sqlite, { id: 'r2', userId: LEARNER, parentId: 'c-learner' });
    insertComment(db._sqlite, { id: 'unrelated', userId: OTHER });

    const { status, body } = await del({ commentId: 'c-learner' });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(rows(db, 'SELECT id FROM lesson_comment ORDER BY id').map(r => r.id), ['unrelated']);
  });

  it('MODERATION: an admin deletes any comment without an enrollment row of their own', async () => {
    insertComment(db._sqlite, { id: 'r1', userId: OTHER, parentId: 'c-learner' });
    assert.equal(rows(db, 'SELECT id FROM enrollment WHERE user_id = ?', ADMIN).length, 0);

    const { status } = await del({ commentId: 'c-learner' }, ADMIN);
    assert.equal(status, 200);
    assert.equal(rows(db, 'SELECT id FROM lesson_comment').length, 0);
  });

  it('MODERATION: staff bypass is admin+, not any signed-in learner', async () => {
    db._sqlite.prepare('UPDATE user SET role = ? WHERE id = ?').run('mod', OTHER);
    const { status } = await del({ commentId: 'c-learner' }, OTHER);
    assert.equal(status, 403, 'a mod is below the admin bar this endpoint sets');
    assert.ok(one(db, 'SELECT id FROM lesson_comment WHERE id = ?', 'c-learner'));
  });

  it('returns 500 and logs when the batch throws, leaving the thread intact', async () => {
    let fired = false;
    const raced = await seededDb({
      seed(sqlite) {
        sqlite.prepare('INSERT INTO enrollment (id, user_id, course_id) VALUES (?, ?, ?)')
          .run('e_x', LEARNER, PUBLIC_COURSE);
        sqlite.prepare('INSERT INTO lesson_comment (id, user_id, course_id, step_id, content) VALUES (?, ?, ?, ?, ?)')
          .run('c-x', LEARNER, PUBLIC_COURSE, PUBLIC_STEP, 'keep me');
      },
      interleave: ({ sql }) => {
        if (fired || !sql.includes('DELETE FROM lesson_comment')) return;
        fired = true;
        throw new Error('D1_ERROR: batch failed');
      },
    });
    const c = ctx(raced, bodyReq('DELETE', LEARNER, { commentId: 'c-x' }));
    const { status, body } = await parseResponse(await comments.onRequestDelete(c));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(c.events.find(e => e.blobs[2] === 'course_comment_error' && e.blobs[4].startsWith('DELETE: ')));
    assert.ok(one(raced, 'SELECT id FROM lesson_comment WHERE id = ?', 'c-x'));
    raced.close();
  });
});

describe('DELETE /api/courses/comments -- members-only course gate', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb({
      seed(sqlite) {
        sqlite.prepare('INSERT INTO lesson_comment (id, user_id, course_id, step_id, content) VALUES (?, ?, ?, ?, ?)')
          .run('c-member', MEMBER, MEMBERS_COURSE, MEMBERS_STEP, 'member text');
        sqlite.prepare('INSERT INTO lesson_comment (id, user_id, course_id, step_id, content) VALUES (?, ?, ?, ?, ?)')
          .run('c-nonmember', NONMEMBER, MEMBERS_COURSE, MEMBERS_STEP, 'lapsed text');
      },
    });
    enroll(db._sqlite, { userId: MEMBER, courseId: MEMBERS_COURSE });
    enroll(db._sqlite, { userId: NONMEMBER, courseId: MEMBERS_COURSE });
  });
  afterEach(() => db.close());

  it('lets an active member delete their own comment', async () => {
    const { status } = await parseResponse(await comments.onRequestDelete(
      ctx(db, bodyReq('DELETE', MEMBER, { commentId: 'c-member' }))));
    assert.equal(status, 200);
    assert.equal(one(db, 'SELECT id FROM lesson_comment WHERE id = ?', 'c-member'), null);
  });

  it('blocks a lapsed member from deleting their own comment', async () => {
    const { status, body } = await parseResponse(await comments.onRequestDelete(
      ctx(db, bodyReq('DELETE', NONMEMBER, { commentId: 'c-nonmember' }))));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
    assert.ok(one(db, 'SELECT id FROM lesson_comment WHERE id = ?', 'c-nonmember'));
  });

  it('lets an admin moderate a members-only comment without a membership of their own', async () => {
    const { status } = await parseResponse(await comments.onRequestDelete(
      ctx(db, bodyReq('DELETE', ADMIN, { commentId: 'c-nonmember' }))));
    assert.equal(status, 200);
    assert.equal(one(db, 'SELECT id FROM lesson_comment WHERE id = ?', 'c-nonmember'), null);
  });
});
