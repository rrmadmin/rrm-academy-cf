/**
 * functions/api/admin/courses/index.js, functions/api/admin/courses/[id].js and
 * the helper both of them import, functions/api/admin/courses/_shared.js.
 *
 * This is the whole authoring surface for a course: the rows that decide what
 * /courses/ sells, what price Stripe is asked for, whether a certificate can be
 * issued, and -- on DELETE -- whether a published course and its lesson tree
 * stop existing. Nothing here had ever been imported by a test.
 *
 * WHY A REAL SQLITE ENGINE AND NOT mockDB()
 * Every consequential decision in these two files is made by the database, not
 * by JavaScript:
 *   - `slug TEXT UNIQUE NOT NULL COLLATE NOCASE` is what turns a duplicate
 *     course into a 409, and `id TEXT PRIMARY KEY` is what distinguishes
 *     `id_already_exists` from `slug_already_exists`. Both are read out of the
 *     text of a driver error;
 *   - PUT's publish transition is a single UPDATE whose WHERE clause carries
 *     `EXISTS (SELECT 1 FROM course_step ... status = 'published')`, so whether
 *     a course may be published is answered by SQL and reported through
 *     `meta.changes === 0`;
 *   - DELETE's reference guard is six LIMIT-1 probes plus two correlated
 *     subqueries over `course` itself;
 *   - the CHECK constraints on `access_type` and `status` are the last line
 *     between an admin typo and a row the public endpoint cannot render.
 * A substring-matching mock returns whatever the test declared for each of
 * those, which would make every assertion here a restatement of its own
 * fixture. These run on node:sqlite loaded with the committed schema
 * (test/_d1-sqlite.mjs). mockDB is used ONLY where the point is "D1 threw".
 *
 * WHAT IS STILL FAKED
 *  - Foreign keys are OFF, matching D1. Nothing below proves referential
 *    integrity; the explicit child cleanup in the endpoint's db.batch() is what
 *    holds that line, so the delete tests read the child tables back by hand.
 *  - R2 is a stub that records keys. It proves the endpoint asked for the right
 *    deletions, not that the bucket honoured them.
 *  - Analytics Engine is mockEnv's writeDataPoint stub.
 *  - `context.data.user` is injected directly. That is the endpoint's real
 *    contract: functions/api/admin/_middleware.js populates it best-effort from
 *    a session cookie and deliberately does NOT enforce anything, so the
 *    authorization decision under test genuinely lives in these two files.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockEnv, mockRequest, mockWaitUntil, mockDB, parseResponse } from './_helpers.js';
import { sqliteD1 } from './_d1-sqlite.mjs';

import * as shared from '../functions/api/admin/courses/_shared.js';
import * as list from '../functions/api/admin/courses/index.js';
import * as one from '../functions/api/admin/courses/[id].js';

const ADMIN = { id: 'u_admin', role: 'admin' };
const SUPERADMIN = { id: 'u_super', role: 'superadmin' };
const MEMBER = { id: 'u_member', role: 'member' };

const R2_HOST = 'https://pub-4af88159ce884265baba8fb4f3470625.r2.dev/';

// --------------------------------------------------------------- fixtures ---

function insertRow(sqlite, table, row) {
  const cols = Object.keys(row);
  sqlite
    .prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

function seedCourse(sqlite, row = {}) {
  return insertRow(sqlite, 'course', {
    id: 'c-endo', slug: 'endo-surgery', title: 'Endo Surgery', status: 'draft', ...row,
  });
}

function seedSection(sqlite, row = {}) {
  return insertRow(sqlite, 'course_section', {
    id: 'sec-1', course_id: 'c-endo', title: 'Module One', sort_order: 0, ...row,
  });
}

function seedStep(sqlite, row = {}) {
  return insertRow(sqlite, 'course_step', {
    id: 'step-1', section_id: 'sec-1', course_id: 'c-endo', title: 'Lesson One',
    type: 'video', status: 'published', sort_order: 0, ...row,
  });
}

function db(seed) {
  return sqliteD1({ seed });
}

/** Records every delete it is asked for; optionally throws on named keys. */
function r2Stub({ failOn = [] } = {}) {
  const fail = new Set(failOn);
  return {
    deleted: [],
    async delete(key) {
      this.deleted.push(key);
      if (fail.has(key)) throw new Error('r2 unavailable');
    },
  };
}

/**
 * A binding whose .all() answers with no `results` key at all.
 *
 * Both handlers guard every list read with `|| []` (`courses || []`,
 * `sections || []`, `stepsBySectionId[id] || []`). The real SQLite harness
 * always returns a real array, so those right-hand arms are exactly the dead
 * short-circuit operands V8 reports as covered because the enclosing line ran.
 * This stub is the only way to execute them, and what it pins is that a
 * degenerate result shape yields an empty catalog rather than a 500 from
 * `.map of undefined`.
 */
function noResultsDb({ course = null } = {}) {
  const stmt = (sql) => ({
    bind() { return this; },
    async first() { return sql.includes('FROM course WHERE id = ?') ? course : null; },
    async all() { return {}; },
    async run() { return { success: true, meta: { changes: 0 } }; },
  });
  return { prepare: (sql) => stmt(sql), batch: async () => [] };
}

/**
 * Wraps the real harness so the NAMED reads answer `{}` instead of
 * `{ results: [...] }`, delegating everything else untouched.
 *
 * Same reason as noResultsDb, applied inside DELETE: the two R2-key harvests
 * are written `for (const row of (stepsWithAttachments || []))`, and the real
 * engine can never make that `|| []` fire. The rest of the delete -- the six
 * reference probes and the db.batch() cleanup -- has to keep working for the
 * test to say anything, so it runs on SQLite as usual.
 */
function withEmptyReads(database, matchers) {
  return {
    _sqlite: database._sqlite,
    prepare(sql) {
      const inner = database.prepare(sql);
      if (!matchers.some((m) => sql.includes(m))) return inner;
      return {
        bind(...args) { inner.bind(...args); return this; },
        first: () => inner.first(),
        all: async () => { await inner.all(); return {}; },
        run: () => inner.run(),
      };
    },
    batch: (stmts) => database.batch(stmts),
  };
}

/** A binding whose every statement rejects -- the "D1 threw" case. */
function throwingDb(message = 'D1 unreachable') {
  const make = () => ({
    bind() { return this; },
    async first() { throw new Error(message); },
    async all() { throw new Error(message); },
    async run() { throw new Error(message); },
  });
  return { prepare: () => make(), batch: async () => { throw new Error(message); } };
}

function ctx(database, { method = 'GET', body, rawBody, params = {}, user = ADMIN, env = {}, url } = {}) {
  return {
    request: mockRequest(method, {
      body, rawBody,
      url: url || 'https://rrmacademy.org/api/admin/courses',
    }),
    env: mockEnv({ DB: database, ...env }),
    waitUntil: mockWaitUntil(),
    params,
    data: user ? { user } : {},
  };
}

const post = (database, opts = {}) => list.onRequestPost(ctx(database, { method: 'POST', ...opts }));
const getList = (database, opts = {}) => list.onRequestGet(ctx(database, { method: 'GET', ...opts }));
const getOne = (database, opts = {}) =>
  one.onRequestGet(ctx(database, { method: 'GET', params: { id: 'c-endo' }, ...opts }));
const putOne = (database, opts = {}) =>
  one.onRequestPut(ctx(database, { method: 'PUT', params: { id: 'c-endo' }, ...opts }));

/** DELETE needs its own context back for the R2 + waitUntil assertions. */
function deleteCtx(database, opts = {}) {
  const c = ctx(database, { method: 'DELETE', params: { id: 'c-endo' }, ...opts });
  return { c, res: one.onRequestDelete(c) };
}
const delOne = async (database, opts = {}) => (await deleteCtx(database, opts)).res;

function row(database, sql, ...binds) {
  return database._sqlite.prepare(sql).get(...binds);
}
function rows(database, sql, ...binds) {
  return database._sqlite.prepare(sql).all(...binds);
}

// ====================================================== _shared.js, direct ===

describe('admin/courses/_shared.js -- constants', () => {
  it('declares the three value sets the courses schema gate holds against live D1', () => {
    // CS1 in scripts/gates/validate-courses-schema.mjs compares these exact
    // Sets against the CHECK(... IN (...)) clauses in the committed migration,
    // so a change here without a matching schema change is a deploy blocker.
    assert.deepEqual([...shared.VALID_STATUSES].sort(), ['archived', 'draft', 'published']);
    assert.deepEqual([...shared.VALID_ACCESS_TYPES].sort(), ['members', 'private', 'public']);
    assert.deepEqual([...shared.VALID_TYPES].sort(), ['article', 'quiz', 'video']);
  });

  it('caps topics at 20 entries of 60 characters', () => {
    assert.equal(shared.TOPICS_MAX_COUNT, 20);
    assert.equal(shared.TOPIC_MAX_LENGTH, 60);
  });

  it('ID_PATTERN admits a lowercase kebab id and nothing else', () => {
    for (const ok of ['a', 'c1', 'masterclass-endo-surgery', 'a1-2-3'])
      assert.equal(shared.ID_PATTERN.test(ok), true, ok);
    for (const bad of ['', '1abc', '-abc', 'Abc', 'a_b', 'a b', 'a.b', 'a/b', 'ábc', 'abc '])
      assert.equal(shared.ID_PATTERN.test(bad), false, bad);
  });
});

describe('admin/courses/_shared.js -- validateTopics', () => {
  it('accepts a well-formed list', () => {
    assert.equal(shared.validateTopics(['Endometriosis', 'Postpartum']), null);
  });

  it('accepts an empty list (clearing every topic is legitimate)', () => {
    assert.equal(shared.validateTopics([]), null);
  });

  it('rejects a non-array', () => {
    assert.equal(shared.validateTopics('Endometriosis'), 'topics_must_be_array');
    assert.equal(shared.validateTopics({ 0: 'Endo' }), 'topics_must_be_array');
    assert.equal(shared.validateTopics(null), 'topics_must_be_array');
  });

  it('rejects more than TOPICS_MAX_COUNT entries, and admits exactly that many', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `t${i}`);
    assert.equal(shared.validateTopics(twenty), null);
    assert.equal(shared.validateTopics([...twenty, 't20']), 'topics_too_many');
  });

  it('rejects a non-string or blank entry', () => {
    assert.equal(shared.validateTopics(['ok', 7]), 'topic_invalid');
    assert.equal(shared.validateTopics(['ok', null]), 'topic_invalid');
    assert.equal(shared.validateTopics(['ok', '']), 'topic_invalid');
    assert.equal(shared.validateTopics(['   ']), 'topic_invalid');
  });

  it('rejects an entry longer than TOPIC_MAX_LENGTH, and admits exactly that length', () => {
    assert.equal(shared.validateTopics(['x'.repeat(60)]), null);
    assert.equal(shared.validateTopics(['x'.repeat(61)]), 'topic_too_long');
  });

  it("rejects a pipe, which is the client-side encoding's field separator", () => {
    assert.equal(shared.validateTopics(['Endo|PCOS']), 'topic_invalid_char');
  });

  it('rejects anything normalizing to the reserved "all" sentinel', () => {
    for (const reserved of ['all', 'All', 'ALL', '  all  '])
      assert.equal(shared.validateTopics([reserved]), 'topic_reserved_value', reserved);
  });

  it('reports the FIRST failing entry, so the message names the real problem', () => {
    assert.equal(shared.validateTopics(['a|b', 'x'.repeat(61)]), 'topic_invalid_char');
    assert.equal(shared.validateTopics(['x'.repeat(61), 'a|b']), 'topic_too_long');
  });
});

describe('admin/courses/_shared.js -- bool', () => {
  it('maps only true, 1 and "1" to 1', () => {
    for (const truthy of [true, 1, '1']) assert.equal(shared.bool(truthy), 1, String(truthy));
  });

  it('maps everything else to 0, including strings JavaScript would call truthy', () => {
    for (const falsy of [false, 0, '0', 'true', 'yes', null, undefined, '', [], {}, 2])
      assert.equal(shared.bool(falsy), 0, JSON.stringify(falsy));
  });
});

describe('admin/courses/_shared.js -- groupBy', () => {
  it('buckets rows by a key, preserving input order inside each bucket', () => {
    const input = [
      { section_id: 's1', id: 'a' },
      { section_id: 's2', id: 'b' },
      { section_id: 's1', id: 'c' },
    ];
    assert.deepEqual(shared.groupBy(input, 'section_id'), {
      s1: [{ section_id: 's1', id: 'a' }, { section_id: 's1', id: 'c' }],
      s2: [{ section_id: 's2', id: 'b' }],
    });
  });

  it('returns an empty map for no rows', () => {
    assert.deepEqual(shared.groupBy([], 'section_id'), {});
  });
});

describe('admin/courses/_shared.js -- JSON column parsers', () => {
  it('parseJson returns the fallback for null and undefined without parsing', () => {
    assert.equal(shared.parseJson(null, 'fb'), 'fb');
    assert.equal(shared.parseJson(undefined, 'fb'), 'fb');
  });

  it('parseJson parses valid JSON and falls back on malformed text', () => {
    assert.deepEqual(shared.parseJson('{"a":1}', 'fb'), { a: 1 });
    assert.equal(shared.parseJson('{not json', 'fb'), 'fb');
  });

  it('parseArray keeps arrays and rejects every other JSON shape', () => {
    assert.deepEqual(shared.parseArray('["a","b"]'), ['a', 'b']);
    assert.deepEqual(shared.parseArray('{"a":1}'), []);
    assert.deepEqual(shared.parseArray('"a"'), []);
    assert.deepEqual(shared.parseArray('null'), []);
    assert.deepEqual(shared.parseArray(null), []);
    assert.deepEqual(shared.parseArray('nope'), []);
  });

  it('parseObject keeps plain objects and rejects arrays and null', () => {
    assert.deepEqual(shared.parseObject('{"a":1}'), { a: 1 });
    assert.deepEqual(shared.parseObject('["a"]'), {});
    assert.deepEqual(shared.parseObject('null'), {});
    assert.deepEqual(shared.parseObject('5'), {});
    assert.deepEqual(shared.parseObject(null), {});
    assert.deepEqual(shared.parseObject('nope'), {});
  });
});

// ============================================ GET /api/admin/courses (list) ===

describe('GET /api/admin/courses -- authorization', () => {
  it('401s with no user on the context', async () => {
    const { status, body } = await parseResponse(await getList(db(), { user: null }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('403s a signed-in member', async () => {
    const { status, body } = await parseResponse(await getList(db(), { user: MEMBER }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
  });

  it('admits both admin and superadmin', async () => {
    for (const user of [ADMIN, SUPERADMIN]) {
      const { status } = await parseResponse(await getList(db(), { user }));
      assert.equal(status, 200, user.role);
    }
  });

  it('503s when the DB binding is missing rather than answering 200 with nothing', async () => {
    const { status, body } = await parseResponse(await getList(undefined, { env: { DB: undefined } }));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('OPTIONS preflight answers 204 with the locked-down origin', async () => {
    const res = list.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

describe('GET /api/admin/courses -- the catalog an admin sees', () => {
  it('returns an empty list when there are no courses', async () => {
    const { status, body } = await parseResponse(await getList(db()));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, results: [] });
  });

  it('orders by sort_order then id, not by insertion', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-zulu', slug: 'zulu', sort_order: 0 });
      seedCourse(s, { id: 'c-alpha', slug: 'alpha', sort_order: 5 });
      seedCourse(s, { id: 'c-bravo', slug: 'bravo', sort_order: 0 });
    });
    const { body } = await parseResponse(await getList(d));
    assert.deepEqual(body.results.map((c) => c.id), ['c-bravo', 'c-zulu', 'c-alpha']);
  });

  it('shows drafts and archived courses -- unlike the public endpoint, admin sees every status', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-draft', slug: 'draft-one', status: 'draft' });
      seedCourse(s, { id: 'c-pub', slug: 'pub-one', status: 'published' });
      seedCourse(s, { id: 'c-arch', slug: 'arch-one', status: 'archived' });
    });
    const { body } = await parseResponse(await getList(d));
    assert.deepEqual(body.results.map((c) => c.status).sort(), ['archived', 'draft', 'published']);
  });

  it('nests each course\'s own sections and steps, and never another course\'s', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-endo', slug: 'endo' });
      seedCourse(s, { id: 'c-other', slug: 'other' });
      seedSection(s, { id: 'sec-2', course_id: 'c-endo', title: 'Second', sort_order: 1 });
      seedSection(s, { id: 'sec-1', course_id: 'c-endo', title: 'First', sort_order: 0 });
      seedSection(s, { id: 'sec-x', course_id: 'c-other', title: 'Elsewhere', sort_order: 0 });
      seedStep(s, { id: 'step-b', section_id: 'sec-1', course_id: 'c-endo', title: 'B', sort_order: 1 });
      seedStep(s, { id: 'step-a', section_id: 'sec-1', course_id: 'c-endo', title: 'A', sort_order: 0 });
      seedStep(s, { id: 'step-x', section_id: 'sec-x', course_id: 'c-other', title: 'X' });
    });
    const { body } = await parseResponse(await getList(d));
    const endo = body.results.find((c) => c.id === 'c-endo');
    const other = body.results.find((c) => c.id === 'c-other');

    assert.deepEqual(endo.sections.map((sec) => sec.id), ['sec-1', 'sec-2']);
    assert.deepEqual(endo.sections[0].steps.map((st) => st.id), ['step-a', 'step-b']);
    assert.deepEqual(endo.sections[1].steps, []);
    assert.deepEqual(other.sections.map((sec) => sec.id), ['sec-x']);
    assert.deepEqual(other.sections[0].steps.map((st) => st.id), ['step-x']);
  });

  it('maps every stored column onto its API name, decoding the JSON columns', async () => {
    const d = db((s) => {
      seedCourse(s, {
        id: 'c-endo', slug: 'endo-surgery', title: 'Endo Surgery',
        description: 'Long body', short_description: 'Short body',
        image_url: '/img/endo.webp', image_alt: 'Endo cover',
        price_cents: 29900, stripe_price_id: 'price_123',
        is_free: 0, has_certificate: 1, self_paced: 1, coming_soon: 0,
        access_type: 'members', participants: 42, sort_order: 3, status: 'published',
        instructors_json: '["Naomi Whittaker"]',
        includes_json: '["c-other"]',
        included_in_json: '["bundle"]',
        settings_json: '{"drip":false}',
        seo_json: '{"title":"Endo"}',
        faqs_json: '[{"q":"Why?","a":"Because"}]',
        topics_json: '["Endometriosis"]',
        created_at: '2026-01-01 00:00:00', updated_at: '2026-02-02 00:00:00',
      });
    });
    const { body } = await parseResponse(await getList(d));
    const c = body.results[0];
    assert.equal(c.shortDescription, 'Short body');
    assert.equal(c.image, '/img/endo.webp');
    assert.equal(c.imageAlt, 'Endo cover');
    assert.equal(c.priceCents, 29900);
    assert.equal(c.stripePriceId, 'price_123');
    assert.equal(c.isFree, false);
    assert.equal(c.hasCertificate, true);
    assert.equal(c.selfPaced, true);
    assert.equal(c.comingSoon, false);
    assert.equal(c.accessType, 'members');
    assert.equal(c.participants, 42);
    assert.equal(c.sortOrder, 3);
    assert.deepEqual(c.instructors, ['Naomi Whittaker']);
    assert.deepEqual(c.includes, ['c-other']);
    assert.deepEqual(c.includedIn, ['bundle']);
    assert.deepEqual(c.settings, { drip: false });
    assert.deepEqual(c.seo, { title: 'Endo' });
    assert.deepEqual(c.faqs, [{ q: 'Why?', a: 'Because' }]);
    assert.deepEqual(c.topics, ['Endometriosis']);
    assert.equal(c.createdAt, '2026-01-01 00:00:00');
    assert.equal(c.updatedAt, '2026-02-02 00:00:00');
  });

  it('degrades a malformed JSON column to an empty value instead of 500ing the whole catalog', async () => {
    const d = db((s) => seedCourse(s, { instructors_json: '{not json', settings_json: '[1,2]' }));
    const { status, body } = await parseResponse(await getList(d));
    assert.equal(status, 200);
    assert.deepEqual(body.results[0].instructors, []);
    assert.deepEqual(body.results[0].settings, {});
  });

  it('omits certificateQuizId entirely when the course has no certificate quiz', async () => {
    const d = db((s) => seedCourse(s));
    const { body } = await parseResponse(await getList(d));
    assert.equal('certificateQuizId' in body.results[0], false);
  });

  it('surfaces certificateQuizId when one is set', async () => {
    const d = db((s) => {
      seedCourse(s, { certificate_quiz_step_id: 'step-quiz' });
      seedSection(s);
      seedStep(s, { id: 'step-quiz', type: 'quiz' });
    });
    const { body } = await parseResponse(await getList(d));
    assert.equal(body.results[0].certificateQuizId, 'step-quiz');
  });

  it('carries the per-step video fields only when the step has them', async () => {
    const d = db((s) => {
      seedCourse(s);
      seedSection(s);
      seedStep(s, {
        id: 'step-video', sort_order: 0, stream_uid: 'uid-abc', duration_seconds: 610,
        attachments_json: '[{"name":"Handout","url":"https://example.org/h.pdf"}]',
      });
      seedStep(s, { id: 'step-plain', sort_order: 1, type: 'article', status: 'draft' });
    });
    const { body } = await parseResponse(await getList(d));
    const [video, plain] = body.results[0].sections[0].steps;
    assert.equal(video.streamUid, 'uid-abc');
    assert.equal(video.duration, 610);
    assert.deepEqual(video.attachments, [{ name: 'Handout', url: 'https://example.org/h.pdf' }]);
    assert.equal(video.status, 'published');
    assert.equal('streamUid' in plain, false);
    assert.equal('duration' in plain, false);
    assert.equal('attachments' in plain, false);
    assert.equal(plain.type, 'article');
    assert.equal(plain.status, 'draft');
  });

  it('drops an empty attachments array rather than emitting attachments: []', async () => {
    const d = db((s) => {
      seedCourse(s); seedSection(s); seedStep(s, { attachments_json: '[]' });
    });
    const { body } = await parseResponse(await getList(d));
    assert.equal('attachments' in body.results[0].sections[0].steps[0], false);
  });

  it('answers an empty catalog when a read comes back without a results array', async () => {
    const { status, body } = await parseResponse(await getList(noResultsDb()));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, results: [] });
  });

  it('500s generically when D1 throws, leaking nothing to the client', async () => {
    const { status, body } = await parseResponse(await getList(throwingDb('table course is locked')));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('locked'), false);
  });
});

// =========================================== POST /api/admin/courses (create) ===

const MINIMAL = { id: 'c-new', slug: 'new-course', title: 'New Course' };

describe('POST /api/admin/courses -- authorization and envelope', () => {
  it('401s with no user', async () => {
    const { status, body } = await parseResponse(await post(db(), { body: MINIMAL, user: null }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('403s a member -- and writes nothing', async () => {
    const d = db();
    const { status } = await parseResponse(await post(d, { body: MINIMAL, user: MEMBER }));
    assert.equal(status, 403);
    assert.equal(rows(d, 'SELECT id FROM course').length, 0);
  });

  it('503s with no DB binding', async () => {
    const { status, body } = await parseResponse(await post(undefined, { body: MINIMAL, env: { DB: undefined } }));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('400s on a body that is not JSON', async () => {
    const { status, body } = await parseResponse(await post(db(), { rawBody: '{"id":' }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('400s on a JSON array or null payload', async () => {
    for (const payload of [[], null]) {
      const { status, body } = await parseResponse(await post(db(), { body: payload }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid payload');
    }
  });
});

describe('POST /api/admin/courses -- input validation', () => {
  const cases = [
    ['id_required', {}],
    ['id_required', { id: '   ' }],
    ['id_required', { id: 7 }],
    ['invalid_id', { id: 'c'.repeat(81) }],
    ['invalid_id', { id: 'Not-Kebab' }],
    ['invalid_id', { id: '1-leading-digit' }],
    ['slug_required', { id: 'c-new' }],
    ['slug_required', { id: 'c-new', slug: '  ' }],
    ['invalid_slug', { id: 'c-new', slug: 's'.repeat(101) }],
    ['title_required', { id: 'c-new', slug: 'new-course' }],
    ['title_required', { id: 'c-new', slug: 'new-course', title: '\t' }],
    ['title_too_long', { ...MINIMAL, title: 't'.repeat(201) }],
    ['description_too_long', { ...MINIMAL, description: 'd'.repeat(50001) }],
    ['short_description_too_long', { ...MINIMAL, shortDescription: 's'.repeat(50001) }],
    ['image_too_long', { ...MINIMAL, image: 'i'.repeat(501) }],
    ['image_alt_too_long', { ...MINIMAL, imageAlt: 'a'.repeat(501) }],
    ['stripe_price_id_too_long', { ...MINIMAL, stripePriceId: 'p'.repeat(101) }],
    ['invalid_price_cents', { ...MINIMAL, priceCents: -1 }],
    ['invalid_price_cents', { ...MINIMAL, priceCents: 1000000 }],
    ['invalid_price_cents', { ...MINIMAL, priceCents: 9.5 }],
    ['invalid_price_cents', { ...MINIMAL, priceCents: '2900' }],
    ['invalid_participants', { ...MINIMAL, participants: -1 }],
    ['invalid_participants', { ...MINIMAL, participants: 1000001 }],
    ['invalid_participants', { ...MINIMAL, participants: 1.5 }],
    ['invalid_access_type', { ...MINIMAL, accessType: 'secret' }],
    ['invalid_status', { ...MINIMAL, status: 'live' }],
    ['invalid_certificate_quiz_step_id', { ...MINIMAL, certificateQuizId: 'step-1' }],
    ['instructors_must_be_array', { ...MINIMAL, instructors: 'Naomi' }],
    ['includes_must_be_array', { ...MINIMAL, includes: 'c-other' }],
    ['included_in_must_be_array', { ...MINIMAL, includedIn: 'bundle' }],
    ['faqs_must_be_array', { ...MINIMAL, faqs: { q: 'x' } }],
    ['topics_must_be_array', { ...MINIMAL, topics: 'Endometriosis' }],
    ['topic_too_long', { ...MINIMAL, topics: ['x'.repeat(61)] }],
    ['settings_must_be_object', { ...MINIMAL, settings: ['a'] }],
    ['settings_must_be_object', { ...MINIMAL, settings: null }],
    ['seo_must_be_object', { ...MINIMAL, seo: ['a'] }],
    ['invalid_sort_order', { ...MINIMAL, sortOrder: 1.5 }],
  ];

  for (const [error, payload] of cases) {
    it(`400s ${error} for ${JSON.stringify(payload).slice(0, 70)}`, async () => {
      const d = db();
      const { status, body } = await parseResponse(await post(d, { body: payload }));
      assert.equal(status, 400);
      assert.equal(body.error, error);
      assert.equal(rows(d, 'SELECT id FROM course').length, 0, 'a rejected create must not write');
    });
  }

  it('accepts the boundary values just inside each cap', async () => {
    const d = db();
    const { status } = await parseResponse(await post(d, {
      body: {
        id: 'c'.repeat(80), slug: 's'.repeat(100), title: 't'.repeat(200),
        description: 'd'.repeat(50000), shortDescription: 's'.repeat(50000),
        image: 'i'.repeat(500), imageAlt: 'a'.repeat(500), stripePriceId: 'p'.repeat(100),
        priceCents: 999999, participants: 1000000, sortOrder: -7,
      },
    }));
    assert.equal(status, 201);
    const stored = row(d, 'SELECT price_cents, participants, sort_order FROM course');
    assert.equal(stored.price_cents, 999999);
    assert.equal(stored.participants, 1000000);
    assert.equal(stored.sort_order, -7);
  });

  it('refuses to create a course already published -- publishing is a PUT, after steps exist', async () => {
    const d = db();
    const { status, body } = await parseResponse(await post(d, { body: { ...MINIMAL, status: 'published' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'not_publishable');
    assert.equal(rows(d, 'SELECT id FROM course').length, 0);
  });

  it('accepts an explicit draft or archived status', async () => {
    for (const status of ['draft', 'archived']) {
      const d = db();
      const res = await parseResponse(await post(d, { body: { ...MINIMAL, status } }));
      assert.equal(res.status, 201);
      assert.equal(row(d, 'SELECT status FROM course').status, status);
    }
  });
});

describe('POST /api/admin/courses -- the row it actually writes', () => {
  it('creates the course and reports 201 with the id and trimmed slug', async () => {
    const d = db();
    const { status, body } = await parseResponse(await post(d, {
      body: { id: 'c-new', slug: '  new-course  ', title: '  New Course  ' },
    }));
    assert.equal(status, 201);
    assert.deepEqual(body, { ok: true, data: { id: 'c-new', slug: 'new-course' } });

    const stored = row(d, 'SELECT * FROM course WHERE id = ?', 'c-new');
    assert.equal(stored.slug, 'new-course');
    assert.equal(stored.title, 'New Course');
  });

  it('applies the PRODUCTION DEFAULTS for every field the caller omitted', async () => {
    // The create form sends a partial body constantly; these defaults are what
    // a course looks like when nobody chose. self_paced defaults to 1 in the
    // ENDPOINT (`selfPaced !== undefined ? selfPaced : true`), not in the
    // schema, so an omitted flag must still land as 1 and not as bool(undefined).
    const d = db();
    assert.equal((await post(d, { body: MINIMAL })).status, 201);
    const c = row(d, 'SELECT * FROM course WHERE id = ?', 'c-new');
    assert.equal(c.description, null);
    assert.equal(c.short_description, null);
    assert.equal(c.image_url, null);
    assert.equal(c.image_alt, null);
    assert.equal(c.price_cents, 0);
    assert.equal(c.stripe_price_id, null);
    assert.equal(c.is_free, 0);
    assert.equal(c.has_certificate, 0);
    assert.equal(c.certificate_quiz_step_id, null);
    assert.equal(c.self_paced, 1);
    assert.equal(c.access_type, 'public');
    assert.equal(c.coming_soon, 0);
    assert.equal(c.participants, 0);
    assert.equal(c.instructors_json, null);
    assert.equal(c.includes_json, null);
    assert.equal(c.included_in_json, null);
    assert.equal(c.settings_json, null);
    assert.equal(c.seo_json, null);
    assert.equal(c.faqs_json, null);
    assert.equal(c.topics_json, null);
    assert.equal(c.sort_order, 0);
    assert.equal(c.status, 'draft');
  });

  it('honours selfPaced: false instead of falling back to the default', async () => {
    const d = db();
    await post(d, { body: { ...MINIMAL, selfPaced: false } });
    assert.equal(row(d, 'SELECT self_paced FROM course').self_paced, 0);
  });

  it('coerces every boolean flag through bool() for recognized boolean-ish values', async () => {
    const d = db();
    await post(d, { body: { ...MINIMAL, isFree: '1', hasCertificate: true, comingSoon: '0' } });
    const c = row(d, 'SELECT is_free, has_certificate, coming_soon FROM course');
    assert.equal(c.is_free, 1);
    assert.equal(c.has_certificate, 1);
    assert.equal(c.coming_soon, 0);
  });

  it('rejects an unrecognized boolean-ish string instead of silently coercing it to false', async () => {
    const d = db();
    const { status, body } = await parseResponse(await post(d, { body: { ...MINIMAL, comingSoon: 'true' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_coming_soon');
    assert.equal(rows(d, 'SELECT id FROM course').length, 0, 'a rejected create must not write');
  });

  it('serialises the JSON columns, and round-trips them through the read endpoint', async () => {
    const d = db();
    await post(d, {
      body: {
        ...MINIMAL,
        instructors: ['Naomi Whittaker'], includes: ['c-other'], includedIn: ['bundle'],
        settings: { drip: true }, seo: { title: 'New' }, faqs: [{ q: 'Q', a: 'A' }],
        topics: ['Endometriosis', 'Postpartum'], accessType: 'members', priceCents: 12300,
      },
    });
    const c = row(d, 'SELECT * FROM course WHERE id = ?', 'c-new');
    assert.equal(c.topics_json, '["Endometriosis","Postpartum"]');
    assert.equal(c.access_type, 'members');
    assert.equal(c.price_cents, 12300);

    const { body } = await parseResponse(await getList(d));
    assert.deepEqual(body.results[0].topics, ['Endometriosis', 'Postpartum']);
    assert.deepEqual(body.results[0].settings, { drip: true });
  });

  it('writes an empty topics array as [], distinguishable from "never set"', async () => {
    const d = db();
    await post(d, { body: { ...MINIMAL, topics: [] } });
    assert.equal(row(d, 'SELECT topics_json FROM course').topics_json, '[]');
  });
});

describe('POST /api/admin/courses -- conflicts and failures', () => {
  it('409s id_already_exists when the primary key is taken', async () => {
    const d = db((s) => seedCourse(s, { id: 'c-endo', slug: 'endo-surgery' }));
    const { status, body } = await parseResponse(await post(d, {
      body: { id: 'c-endo', slug: 'a-different-slug', title: 'Clash' },
    }));
    assert.equal(status, 409);
    assert.equal(body.error, 'id_already_exists');
    assert.equal(row(d, 'SELECT title FROM course WHERE id = ?', 'c-endo').title, 'Endo Surgery');
  });

  it('409s slug_already_exists when the unique slug is taken', async () => {
    const d = db((s) => seedCourse(s, { id: 'c-endo', slug: 'endo-surgery' }));
    const { status, body } = await parseResponse(await post(d, {
      body: { id: 'c-fresh', slug: 'endo-surgery', title: 'Clash' },
    }));
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_already_exists');
  });

  it('409s on a slug that differs only by case -- the column is COLLATE NOCASE', async () => {
    // The uniqueness that matters is the database's, not the endpoint's: there
    // is no application-level slug check at all here, so a BINARY column would
    // have let /courses/Endo-Surgery/ and /courses/endo-surgery/ both exist.
    const d = db((s) => seedCourse(s, { id: 'c-endo', slug: 'endo-surgery' }));
    const { status, body } = await parseResponse(await post(d, {
      body: { id: 'c-fresh', slug: 'ENDO-Surgery', title: 'Clash' },
    }));
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_already_exists');
    assert.equal(rows(d, 'SELECT id FROM course').length, 1);
  });

  it('500s generically on any other D1 failure', async () => {
    const d = mockDB({ 'INSERT INTO course': { throws: 'no such table: course' } });
    const { status, body } = await parseResponse(await post(d, { body: MINIMAL }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('no such table'), false);
  });
});

// ================================== GET /api/admin/courses/[id] (read one) ===

describe('GET /api/admin/courses/[id]', () => {
  it('401s with no user, 403s a member', async () => {
    assert.equal((await getOne(db(), { user: null })).status, 401);
    assert.equal((await getOne(db(), { user: MEMBER })).status, 403);
  });

  it('503s with no DB binding', async () => {
    const { status, body } = await parseResponse(await getOne(undefined, { env: { DB: undefined } }));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('400s on a missing or over-long path id', async () => {
    for (const params of [{}, { id: '' }, { id: 'x'.repeat(101) }]) {
      const { status, body } = await parseResponse(await getOne(db(), { params }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid id');
    }
  });

  it('404s for a course that does not exist', async () => {
    const { status, body } = await parseResponse(await getOne(db()));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('returns the course with its own nested sections and steps only', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-endo', slug: 'endo', certificate_quiz_step_id: 'step-quiz' });
      seedCourse(s, { id: 'c-other', slug: 'other' });
      seedSection(s, { id: 'sec-2', sort_order: 1, title: 'Second' });
      seedSection(s, { id: 'sec-1', sort_order: 0, title: 'First' });
      seedSection(s, { id: 'sec-3', sort_order: 2, title: 'Empty' });
      seedSection(s, { id: 'sec-x', course_id: 'c-other', title: 'Elsewhere' });
      seedStep(s, { id: 'step-quiz', section_id: 'sec-1', type: 'quiz', sort_order: 0, attachments_json: '[]' });
      seedStep(s, {
        id: 'step-two', section_id: 'sec-2', sort_order: 0, stream_uid: 'uid-1', duration_seconds: 90,
        attachments_json: '[{"name":"Slides","url":"https://example.org/s.pdf"}]',
      });
      seedStep(s, { id: 'step-x', section_id: 'sec-x', course_id: 'c-other' });
    });
    const { status, body } = await parseResponse(await getOne(d));
    assert.equal(status, 200);
    assert.equal(body.data.id, 'c-endo');
    assert.equal(body.data.certificateQuizId, 'step-quiz');
    assert.deepEqual(body.data.sections.map((s) => s.id), ['sec-1', 'sec-2', 'sec-3']);
    assert.deepEqual(body.data.sections[0].steps.map((s) => s.id), ['step-quiz']);
    assert.equal('attachments' in body.data.sections[0].steps[0], false);
    assert.equal(body.data.sections[1].steps[0].streamUid, 'uid-1');
    assert.equal(body.data.sections[1].steps[0].duration, 90);
    assert.deepEqual(body.data.sections[1].steps[0].attachments, [{ name: 'Slides', url: 'https://example.org/s.pdf' }]);
    assert.deepEqual(body.data.sections[2].steps, [], 'a section with no steps is an empty list, not undefined');
    assert.equal(
      JSON.stringify(body.data).includes('step-x'), false,
      "another course's step must never appear in this course's tree"
    );
  });

  it('returns a course with no sections as an empty tree, not a 404', async () => {
    const d = db((s) => seedCourse(s));
    const { status, body } = await parseResponse(await getOne(d));
    assert.equal(status, 200);
    assert.deepEqual(body.data.sections, []);
  });

  it('returns an empty tree when the nested reads come back without a results array', async () => {
    const stub = noResultsDb({ course: { id: 'c-endo', slug: 'endo', title: 'Endo', status: 'draft' } });
    const { status, body } = await parseResponse(await getOne(stub));
    assert.equal(status, 200);
    assert.equal(body.data.id, 'c-endo');
    assert.deepEqual(body.data.sections, []);
  });

  it('500s generically when D1 throws', async () => {
    const { status, body } = await parseResponse(await getOne(throwingDb('disk I/O error')));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('I/O'), false);
  });
});

// ================================= PUT /api/admin/courses/[id] (update) ======

describe('PUT /api/admin/courses/[id] -- authorization and envelope', () => {
  it('401s with no user', async () => {
    const { status, body } = await parseResponse(await putOne(db(), { body: { title: 'x' }, user: null }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('403s a member and leaves the row untouched', async () => {
    const d = db((s) => seedCourse(s, { title: 'Endo Surgery' }));
    const { status } = await parseResponse(await putOne(d, { body: { title: 'Hijacked' }, user: MEMBER }));
    assert.equal(status, 403);
    assert.equal(row(d, 'SELECT title FROM course').title, 'Endo Surgery');
  });

  it('503s with no DB binding', async () => {
    const { status, body } = await parseResponse(await putOne(undefined, { body: { title: 'x' }, env: { DB: undefined } }));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('400s on a missing or over-long path id', async () => {
    for (const params of [{}, { id: 'x'.repeat(101) }]) {
      const { status, body } = await parseResponse(await putOne(db(), { params, body: { title: 'x' } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid id');
    }
  });

  it('400s on malformed JSON and on a non-object payload', async () => {
    assert.equal((await parseResponse(await putOne(db(), { rawBody: 'nope' }))).body.error, 'Invalid JSON');
    assert.equal((await parseResponse(await putOne(db(), { body: ['a'] }))).body.error, 'Invalid payload');
    assert.equal((await parseResponse(await putOne(db(), { body: null }))).body.error, 'Invalid payload');
  });

  it('400s no_fields_provided for an empty object rather than touching updated_at', async () => {
    const d = db((s) => seedCourse(s, { updated_at: '2026-01-01 00:00:00' }));
    const { status, body } = await parseResponse(await putOne(d, { body: {} }));
    assert.equal(status, 400);
    assert.equal(body.error, 'no_fields_provided');
    assert.equal(row(d, 'SELECT updated_at FROM course').updated_at, '2026-01-01 00:00:00');
  });
});

describe('PUT /api/admin/courses/[id] -- input validation', () => {
  const cases = [
    ['slug_required', { slug: '' }],
    ['slug_required', { slug: '   ' }],
    ['slug_required', { slug: 5 }],
    ['invalid_slug', { slug: 's'.repeat(101) }],
    ['title_required', { title: '' }],
    ['title_required', { title: 9 }],
    ['title_too_long', { title: 't'.repeat(201) }],
    ['description_too_long', { description: 'd'.repeat(50001) }],
    ['short_description_too_long', { shortDescription: 's'.repeat(50001) }],
    ['image_too_long', { image: 'i'.repeat(501) }],
    ['image_alt_too_long', { imageAlt: 'a'.repeat(501) }],
    ['stripe_price_id_too_long', { stripePriceId: 'p'.repeat(101) }],
    ['invalid_price_cents', { priceCents: -1 }],
    ['invalid_price_cents', { priceCents: 1000000 }],
    ['invalid_price_cents', { priceCents: '100' }],
    ['invalid_participants', { participants: -1 }],
    ['invalid_participants', { participants: 1000001 }],
    ['invalid_sort_order', { sortOrder: 'first' }],
    ['invalid_access_type', { accessType: 'secret' }],
    ['invalid_status', { status: 'live' }],
    ['instructors_must_be_array', { instructors: 'Naomi' }],
    ['includes_must_be_array', { includes: 'c-other' }],
    ['included_in_must_be_array', { includedIn: 'bundle' }],
    ['faqs_must_be_array', { faqs: {} }],
    ['topics_must_be_array', { topics: 'Endo' }],
    ['topic_reserved_value', { topics: ['All'] }],
    ['topics_too_many', { topics: Array.from({ length: 21 }, (_, i) => `t${i}`) }],
    ['settings_must_be_object', { settings: [] }],
    ['settings_must_be_object', { settings: null }],
    ['seo_must_be_object', { seo: null }],
  ];

  for (const [error, payload] of cases) {
    it(`400s ${error} for ${JSON.stringify(payload).slice(0, 60)}`, async () => {
      const d = db((s) => seedCourse(s, { title: 'Endo Surgery', slug: 'endo-surgery' }));
      const { status, body } = await parseResponse(await putOne(d, { body: payload }));
      assert.equal(status, 400);
      assert.equal(body.error, error);
      const after = row(d, 'SELECT title, slug FROM course');
      assert.equal(after.title, 'Endo Surgery');
      assert.equal(after.slug, 'endo-surgery');
    });
  }

  it('lets an explicit null through on the nullable text fields (length checks skip non-strings)', async () => {
    const d = db((s) => seedCourse(s, { description: 'Old' }));
    const { status } = await parseResponse(await putOne(d, { body: { description: null } }));
    assert.equal(status, 200);
    assert.equal(row(d, 'SELECT description FROM course').description, null);
  });
});

describe('PUT /api/admin/courses/[id] -- the update it actually performs', () => {
  it('writes only the fields present in the body and leaves the rest alone', async () => {
    const d = db((s) => seedCourse(s, { title: 'Endo Surgery', short_description: 'Keep me', price_cents: 100 }));
    const { status, body } = await parseResponse(await putOne(d, { body: { title: 'Renamed' } }));
    assert.equal(status, 200);
    assert.equal(body.data.title, 'Renamed');
    const c = row(d, 'SELECT * FROM course');
    assert.equal(c.title, 'Renamed');
    assert.equal(c.short_description, 'Keep me');
    assert.equal(c.price_cents, 100);
  });

  it('maps every camelCase field onto its column', async () => {
    const d = db((s) => seedCourse(s));
    const { status } = await parseResponse(await putOne(d, {
      body: {
        slug: 'renamed-slug', title: 'Renamed', description: 'Body', shortDescription: 'Short',
        image: '/img/new.webp', imageAlt: 'Alt', priceCents: 4900, stripePriceId: 'price_new',
        accessType: 'private', status: 'archived', sortOrder: 9, participants: 12,
      },
    }));
    assert.equal(status, 200);
    const c = row(d, 'SELECT * FROM course');
    assert.equal(c.slug, 'renamed-slug');
    assert.equal(c.description, 'Body');
    assert.equal(c.short_description, 'Short');
    assert.equal(c.image_url, '/img/new.webp');
    assert.equal(c.image_alt, 'Alt');
    assert.equal(c.price_cents, 4900);
    assert.equal(c.stripe_price_id, 'price_new');
    assert.equal(c.access_type, 'private');
    assert.equal(c.status, 'archived');
    assert.equal(c.sort_order, 9);
    assert.equal(c.participants, 12);
  });

  it('coerces the four boolean flags through bool() for recognized boolean-ish values', async () => {
    const d = db((s) => seedCourse(s, { is_free: 1, has_certificate: 1, self_paced: 1, coming_soon: 1 }));
    await putOne(d, { body: { isFree: false, hasCertificate: '1', selfPaced: 0, comingSoon: '0' } });
    const c = row(d, 'SELECT is_free, has_certificate, self_paced, coming_soon FROM course');
    assert.equal(c.is_free, 0);
    assert.equal(c.has_certificate, 1);
    assert.equal(c.self_paced, 0);
    assert.equal(c.coming_soon, 0);
  });

  it('rejects an unrecognized boolean-ish string on PUT instead of silently coercing it to false', async () => {
    const d = db((s) => seedCourse(s, { coming_soon: 1 }));
    const { status, body } = await parseResponse(await putOne(d, { body: { comingSoon: 'yes' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_coming_soon');
    assert.equal(row(d, 'SELECT coming_soon FROM course').coming_soon, 1, 'a rejected update must not write');
  });

  it('re-serialises each JSON column from the request value', async () => {
    const d = db((s) => seedCourse(s));
    await putOne(d, {
      body: {
        instructors: ['A'], includes: ['c-x'], includedIn: ['b'],
        settings: { drip: true }, seo: { title: 'S' }, faqs: [{ q: 'Q', a: 'A' }],
        topics: ['Endometriosis'],
      },
    });
    const c = row(d, 'SELECT * FROM course');
    assert.equal(c.instructors_json, '["A"]');
    assert.equal(c.includes_json, '["c-x"]');
    assert.equal(c.included_in_json, '["b"]');
    assert.equal(c.settings_json, '{"drip":true}');
    assert.equal(c.seo_json, '{"title":"S"}');
    assert.equal(c.faqs_json, '[{"q":"Q","a":"A"}]');
    assert.equal(c.topics_json, '["Endometriosis"]');
  });

  it('stamps updated_at on every successful write', async () => {
    const d = db((s) => seedCourse(s, { updated_at: '2020-01-01 00:00:00' }));
    await putOne(d, { body: { title: 'Renamed' } });
    assert.notEqual(row(d, 'SELECT updated_at FROM course').updated_at, '2020-01-01 00:00:00');
  });

  it('returns the freshly re-read course, including its nested tree', async () => {
    const d = db((s) => {
      seedCourse(s); seedSection(s); seedStep(s, { title: 'Lesson One' });
    });
    const { body } = await parseResponse(await putOne(d, { body: { title: 'Renamed' } }));
    assert.equal(body.data.title, 'Renamed');
    assert.equal(body.data.sections[0].steps[0].title, 'Lesson One');
  });

  it('404s when the course does not exist, without creating it', async () => {
    const d = db();
    const { status, body } = await parseResponse(await putOne(d, { body: { title: 'Ghost' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(rows(d, 'SELECT id FROM course').length, 0);
  });

  it('409s slug_already_exists when the new slug collides, case-insensitively', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-endo', slug: 'endo-surgery' });
      seedCourse(s, { id: 'c-pcos', slug: 'pcos-basics' });
    });
    const { status, body } = await parseResponse(await putOne(d, { body: { slug: 'PCOS-Basics' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_already_exists');
    assert.equal(row(d, 'SELECT slug FROM course WHERE id = ?', 'c-endo').slug, 'endo-surgery');
  });

  it('500s generically on any other D1 failure during the update', async () => {
    const d = mockDB({ 'UPDATE course': { throws: 'database is locked' } });
    const { status, body } = await parseResponse(await putOne(d, { body: { title: 'x' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('locked'), false);
  });

  it('rejects a status outside the schema CHECK before SQL ever sees it', async () => {
    const d = db((s) => seedCourse(s));
    const { status } = await parseResponse(await putOne(d, { body: { status: 'retired' } }));
    assert.equal(status, 400);
    assert.equal(row(d, 'SELECT status FROM course').status, 'draft');
  });
});

describe('PUT /api/admin/courses/[id] -- the publish transition', () => {
  it('refuses to publish a course with no published step', async () => {
    const d = db((s) => {
      seedCourse(s, { status: 'draft' });
      seedSection(s);
      seedStep(s, { status: 'draft' });
    });
    const { status, body } = await parseResponse(await putOne(d, { body: { status: 'published' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'not_publishable');
    assert.equal(body.detail, 'course has no published steps');
    assert.equal(row(d, 'SELECT status FROM course').status, 'draft');
  });

  it('refuses to publish a course with no steps at all', async () => {
    const d = db((s) => seedCourse(s, { status: 'draft' }));
    const { status, body } = await parseResponse(await putOne(d, { body: { status: 'published' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'not_publishable');
  });

  it('does not count another course\'s published step as this course\'s', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-endo', slug: 'endo', status: 'draft' });
      seedCourse(s, { id: 'c-other', slug: 'other', status: 'published' });
      seedSection(s, { id: 'sec-x', course_id: 'c-other' });
      seedStep(s, { id: 'step-x', section_id: 'sec-x', course_id: 'c-other', status: 'published' });
    });
    const { status, body } = await parseResponse(await putOne(d, { body: { status: 'published' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'not_publishable');
  });

  it('publishes once at least one step is published, and applies the sibling fields in the same write', async () => {
    const d = db((s) => {
      seedCourse(s, { status: 'draft' });
      seedSection(s);
      seedStep(s, { id: 'step-draft', status: 'draft', sort_order: 0 });
      seedStep(s, { id: 'step-live', status: 'published', sort_order: 1 });
    });
    const { status, body } = await parseResponse(await putOne(d, {
      body: { status: 'published', priceCents: 19900 },
    }));
    assert.equal(status, 200);
    assert.equal(body.data.status, 'published');
    const c = row(d, 'SELECT status, price_cents FROM course');
    assert.equal(c.status, 'published');
    assert.equal(c.price_cents, 19900);
  });

  it('lets an already-published course be updated without re-proving publishability', async () => {
    const d = db((s) => {
      seedCourse(s, { status: 'published' });
      seedSection(s);
      seedStep(s, { status: 'draft' });
    });
    const { status } = await parseResponse(await putOne(d, { body: { status: 'published', title: 'Renamed' } }));
    assert.equal(status, 200);
    const c = row(d, 'SELECT status, title FROM course');
    assert.equal(c.status, 'published');
    assert.equal(c.title, 'Renamed');
  });

  it('does not gate an un-publish: draft and archived need no published step', async () => {
    for (const status of ['draft', 'archived']) {
      const d = db((s) => seedCourse(s, { status: 'published' }));
      const res = await parseResponse(await putOne(d, { body: { status } }));
      assert.equal(res.status, 200);
      assert.equal(row(d, 'SELECT status FROM course').status, status);
    }
  });

  it('404s a publish attempt on a course that does not exist', async () => {
    const d = db();
    const { status, body } = await parseResponse(await putOne(d, { body: { status: 'published' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });
});

describe('PUT /api/admin/courses/[id] -- the certificate quiz reference', () => {
  const withQuiz = (extra = {}) => (s) => {
    seedCourse(s, { ...extra });
    seedSection(s);
    seedStep(s, { id: 'step-quiz', type: 'quiz', status: 'published' });
  };

  it('accepts a published quiz step belonging to this course', async () => {
    const d = db(withQuiz());
    const { status, body } = await parseResponse(await putOne(d, { body: { certificateQuizId: 'step-quiz' } }));
    assert.equal(status, 200);
    assert.equal(body.data.certificateQuizId, 'step-quiz');
    assert.equal(row(d, 'SELECT certificate_quiz_step_id FROM course').certificate_quiz_step_id, 'step-quiz');
  });

  it('400s for a step id that does not exist', async () => {
    const d = db(withQuiz());
    const { status, body } = await parseResponse(await putOne(d, { body: { certificateQuizId: 'step-nope' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_certificate_quiz_step_id');
    assert.equal(row(d, 'SELECT certificate_quiz_step_id FROM course').certificate_quiz_step_id, null);
  });

  it('400s for a quiz step that belongs to ANOTHER course -- the ownership check', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-endo', slug: 'endo' });
      seedCourse(s, { id: 'c-other', slug: 'other' });
      seedSection(s, { id: 'sec-x', course_id: 'c-other' });
      seedStep(s, { id: 'step-foreign', section_id: 'sec-x', course_id: 'c-other', type: 'quiz', status: 'published' });
    });
    const { status, body } = await parseResponse(await putOne(d, { body: { certificateQuizId: 'step-foreign' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_certificate_quiz_step_id');
  });

  it('400s for a step of this course that is not a quiz, or not published', async () => {
    const notQuiz = db((s) => { seedCourse(s); seedSection(s); seedStep(s, { id: 'step-vid', type: 'video', status: 'published' }); });
    assert.equal(
      (await parseResponse(await putOne(notQuiz, { body: { certificateQuizId: 'step-vid' } }))).body.error,
      'invalid_certificate_quiz_step_id'
    );

    const draftQuiz = db((s) => { seedCourse(s); seedSection(s); seedStep(s, { id: 'step-q', type: 'quiz', status: 'draft' }); });
    assert.equal(
      (await parseResponse(await putOne(draftQuiz, { body: { certificateQuizId: 'step-q' } }))).body.error,
      'invalid_certificate_quiz_step_id'
    );
  });

  it('clears the reference on an explicit null, skipping the lookup', async () => {
    const d = db(withQuiz({ certificate_quiz_step_id: 'step-quiz' }));
    const { status, body } = await parseResponse(await putOne(d, { body: { certificateQuizId: null } }));
    assert.equal(status, 200);
    assert.equal('certificateQuizId' in body.data, false);
    assert.equal(row(d, 'SELECT certificate_quiz_step_id FROM course').certificate_quiz_step_id, null);
  });

  it('leaves the reference untouched when the key is absent from the body', async () => {
    const d = db(withQuiz({ certificate_quiz_step_id: 'step-quiz' }));
    await putOne(d, { body: { title: 'Renamed' } });
    assert.equal(row(d, 'SELECT certificate_quiz_step_id FROM course').certificate_quiz_step_id, 'step-quiz');
  });

  it('500s generically when the lookup itself throws, before any write happens', async () => {
    const d = mockDB({ 'FROM course_step WHERE id = ?': { throws: 'no such table: course_step' } });
    const { status, body } = await parseResponse(await putOne(d, { body: { certificateQuizId: 'step-quiz' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(d._calls.some((c) => c.sql.startsWith('UPDATE course')), false, 'must not reach the UPDATE');
  });
});

// ================================ DELETE /api/admin/courses/[id] ============

describe('DELETE /api/admin/courses/[id] -- authorization', () => {
  it('401s with no user and deletes nothing', async () => {
    const d = db((s) => seedCourse(s));
    const { status, body } = await parseResponse(await delOne(d, { user: null }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
    assert.equal(rows(d, 'SELECT id FROM course').length, 1);
  });

  it('403s a member and deletes nothing -- the most consequential line in the file', async () => {
    const d = db((s) => { seedCourse(s); seedSection(s); seedStep(s); });
    const { status, body } = await parseResponse(await delOne(d, { user: MEMBER }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(rows(d, 'SELECT id FROM course').length, 1);
    assert.equal(rows(d, 'SELECT id FROM course_section').length, 1);
    assert.equal(rows(d, 'SELECT id FROM course_step').length, 1);
  });

  it('admits both admin and superadmin', async () => {
    for (const user of [ADMIN, SUPERADMIN]) {
      const d = db((s) => seedCourse(s));
      assert.equal((await delOne(d, { user })).status, 200, user.role);
    }
  });

  it('503s with no DB binding', async () => {
    const { status, body } = await parseResponse(await delOne(undefined, { env: { DB: undefined } }));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('400s on a missing or over-long path id', async () => {
    for (const params of [{}, { id: 'x'.repeat(101) }]) {
      const { status, body } = await parseResponse(await delOne(db(), { params }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid id');
    }
  });

  it('404s for a course that does not exist', async () => {
    const { status, body } = await parseResponse(await delOne(db()));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('500s generically when D1 throws', async () => {
    const { status, body } = await parseResponse(await delOne(throwingDb('connection reset')));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('connection reset'), false);
  });
});

describe('DELETE /api/admin/courses/[id] -- the reference guard', () => {
  const guarded = [
    ['enrollment', (s) => insertRow(s, 'enrollment', { id: 'e1', user_id: 'u1', course_id: 'c-endo' })],
    ['step_progress', (s) => insertRow(s, 'step_progress', { user_id: 'u1', course_id: 'c-endo', step_id: 'step-1' })],
    ['quiz_response', (s) => insertRow(s, 'quiz_response', { user_id: 'u1', course_id: 'c-endo', step_id: 'step-1', question_id: 'q1', answer_value: 'a' })],
    ['lesson_comment', (s) => insertRow(s, 'lesson_comment', { id: 'lc1', user_id: 'u1', course_id: 'c-endo', step_id: 'step-1', content: 'hi' })],
    ['affiliate_clicks', (s) => insertRow(s, 'affiliate_clicks', { user_id: 'u1', course_id: 'c-endo' })],
    ['course_waitlist', (s) => insertRow(s, 'course_waitlist', { id: 'cw1', course_id: 'c-endo', email: 'a@example.org' })],
  ];

  for (const [table, seedRef] of guarded) {
    it(`409s references_exist naming ${table}, and the course survives`, async () => {
      const d = db((s) => { seedCourse(s); seedSection(s); seedStep(s); seedRef(s); });
      const { status, body } = await parseResponse(await delOne(d));
      assert.equal(status, 409);
      assert.equal(body.error, 'references_exist');
      assert.deepEqual(body.detail.tables, [table]);
      assert.equal(rows(d, 'SELECT id FROM course').length, 1);
      assert.equal(rows(d, 'SELECT id FROM course_step').length, 1);
    });
  }

  it('names every referencing table at once, in a stable order', async () => {
    const d = db((s) => {
      seedCourse(s); seedSection(s); seedStep(s);
      for (const [, seedRef] of guarded) seedRef(s);
    });
    const { status, body } = await parseResponse(await delOne(d));
    assert.equal(status, 409);
    assert.deepEqual(body.detail.tables, guarded.map(([t]) => t));
  });

  it('does not confuse another course\'s rows for this one\'s', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-endo', slug: 'endo' });
      seedCourse(s, { id: 'c-other', slug: 'other' });
      insertRow(s, 'enrollment', { id: 'e1', user_id: 'u1', course_id: 'c-other' });
      insertRow(s, 'course_waitlist', { id: 'cw1', course_id: 'c-other', email: 'a@example.org' });
    });
    assert.equal((await delOne(d)).status, 200);
    assert.equal(rows(d, 'SELECT id FROM course').length, 1);
    assert.equal(row(d, 'SELECT id FROM course').id, 'c-other');
  });

  it('a REVOKED enrollment still blocks the delete -- the receipt outlives the refund', async () => {
    const d = db((s) => {
      seedCourse(s);
      insertRow(s, 'enrollment', { id: 'e1', user_id: 'u1', course_id: 'c-endo', revoked_at: '2026-01-01T00:00:00.000Z' });
    });
    const { status, body } = await parseResponse(await delOne(d));
    assert.equal(status, 409);
    assert.deepEqual(body.detail.tables, ['enrollment']);
  });

  it('409s when another course lists this one in includes_json', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-endo', slug: 'endo-surgery' });
      seedCourse(s, { id: 'c-bundle', slug: 'bundle', includes_json: '["c-endo"]' });
    });
    const { status, body } = await parseResponse(await delOne(d));
    assert.equal(status, 409);
    assert.equal(body.error, 'references_exist');
    assert.equal(body.detail, 'Another course includes this one');
    assert.equal(rows(d, 'SELECT id FROM course').length, 2);
  });

  it('409s when another course lists this one by SLUG in included_in_json', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-endo', slug: 'endo-surgery' });
      seedCourse(s, { id: 'c-bundle', slug: 'bundle', included_in_json: '["endo-surgery"]' });
    });
    const { status, body } = await parseResponse(await delOne(d));
    assert.equal(status, 409);
    assert.equal(body.detail, 'Another course includes this one');
  });

  it('ignores a SELF reference in includes_json -- a course cannot block its own delete', async () => {
    const d = db((s) => seedCourse(s, { id: 'c-endo', slug: 'endo-surgery', includes_json: '["c-endo"]' }));
    assert.equal((await delOne(d)).status, 200);
    assert.equal(rows(d, 'SELECT id FROM course').length, 0);
  });

  it('409s when another course uses one of this course\'s steps as its certificate quiz', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-endo', slug: 'endo' });
      seedCourse(s, { id: 'c-other', slug: 'other', certificate_quiz_step_id: 'step-quiz' });
      seedSection(s);
      seedStep(s, { id: 'step-quiz', type: 'quiz' });
    });
    const { status, body } = await parseResponse(await delOne(d));
    assert.equal(status, 409);
    assert.equal(body.error, 'step_referenced_as_certificate_quiz');
    assert.equal(body.courseId, 'c-other');
    assert.equal(rows(d, 'SELECT id FROM course_step').length, 1);
  });

  it('ignores this course\'s own certificate-quiz self reference', async () => {
    const d = db((s) => {
      seedCourse(s, { certificate_quiz_step_id: 'step-quiz' });
      seedSection(s);
      seedStep(s, { id: 'step-quiz', type: 'quiz' });
    });
    assert.equal((await delOne(d)).status, 200);
    assert.equal(rows(d, 'SELECT id FROM course').length, 0);
  });
});

describe('DELETE /api/admin/courses/[id] -- the cascade the engine will not run', () => {
  it('removes the course, its sections, its steps and their renditions in one batch', async () => {
    // Foreign keys are OFF in D1 and in this harness, so every ON DELETE
    // CASCADE in schema.sql is decorative. What is asserted here is the
    // endpoint's own explicit cleanup: read the child tables back and require
    // them empty, because nothing else will empty them.
    const d = db((s) => {
      seedCourse(s);
      seedSection(s, { id: 'sec-1' });
      seedSection(s, { id: 'sec-2', sort_order: 1 });
      seedStep(s, { id: 'step-1', section_id: 'sec-1' });
      seedStep(s, { id: 'step-2', section_id: 'sec-2' });
      insertRow(s, 'step_rendition', {
        step_id: 'step-1', format: 'reading', content_json: '{"html":"<p>x</p>"}',
        status: 'published', created_at: 'now', updated_at: 'now',
      });
    });
    const { status, body } = await parseResponse(await delOne(d));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(rows(d, 'SELECT id FROM course').length, 0);
    assert.equal(rows(d, 'SELECT id FROM course_section').length, 0);
    assert.equal(rows(d, 'SELECT id FROM course_step').length, 0);
    assert.equal(rows(d, 'SELECT step_id FROM step_rendition').length, 0);
  });

  it('leaves every other course\'s tree standing', async () => {
    const d = db((s) => {
      seedCourse(s, { id: 'c-endo', slug: 'endo' });
      seedCourse(s, { id: 'c-other', slug: 'other' });
      seedSection(s, { id: 'sec-1', course_id: 'c-endo' });
      seedSection(s, { id: 'sec-x', course_id: 'c-other' });
      seedStep(s, { id: 'step-1', section_id: 'sec-1', course_id: 'c-endo' });
      seedStep(s, { id: 'step-x', section_id: 'sec-x', course_id: 'c-other' });
      insertRow(s, 'step_rendition', {
        step_id: 'step-x', format: 'reading', content_json: '{}', status: 'draft',
        created_at: 'now', updated_at: 'now',
      });
    });
    assert.equal((await delOne(d)).status, 200);
    assert.deepEqual(rows(d, 'SELECT id FROM course').map((r) => r.id), ['c-other']);
    assert.deepEqual(rows(d, 'SELECT id FROM course_section').map((r) => r.id), ['sec-x']);
    assert.deepEqual(rows(d, 'SELECT id FROM course_step').map((r) => r.id), ['step-x']);
    assert.deepEqual(rows(d, 'SELECT step_id FROM step_rendition').map((r) => r.step_id), ['step-x']);
  });
});

describe('DELETE /api/admin/courses/[id] -- R2 attachment and audio cleanup', () => {
  const attach = (...urls) => JSON.stringify(urls.map((u, i) => ({ name: `a${i}`, url: u })));

  it('deletes every R2-hosted attachment key and skips foreign-hosted ones', async () => {
    const d = db((s) => {
      seedCourse(s); seedSection(s);
      seedStep(s, { id: 'step-1', attachments_json: attach(`${R2_HOST}courses/one.pdf`, 'https://example.org/elsewhere.pdf') });
      seedStep(s, { id: 'step-2', attachments_json: attach(`${R2_HOST}courses/two.pdf`) });
      seedStep(s, { id: 'step-3' });
    });
    const R2_ASSETS = r2Stub();
    const { c, res } = deleteCtx(d, { env: { R2_ASSETS } });
    assert.equal((await res).status, 200);
    await Promise.all(c.waitUntil.promises);
    assert.deepEqual(R2_ASSETS.deleted.sort(), ['courses/one.pdf', 'courses/two.pdf']);
  });

  it('deletes the audio rendition object recorded in content_json', async () => {
    const d = db((s) => {
      seedCourse(s); seedSection(s); seedStep(s, { id: 'step-1' });
      insertRow(s, 'step_rendition', {
        step_id: 'step-1', format: 'audio', content_json: '{"r2_key":"courses/audio/step-1.mp3"}',
        status: 'published', created_at: 'now', updated_at: 'now',
      });
      insertRow(s, 'step_rendition', {
        step_id: 'step-1', format: 'reading', content_json: '{"r2_key":"not-audio.txt"}',
        status: 'published', created_at: 'now', updated_at: 'now',
      });
    });
    const R2_ASSETS = r2Stub();
    const { c, res } = deleteCtx(d, { env: { R2_ASSETS } });
    assert.equal((await res).status, 200);
    await Promise.all(c.waitUntil.promises);
    assert.deepEqual(R2_ASSETS.deleted, ['courses/audio/step-1.mp3']);
  });

  it('tolerates malformed, non-array and url-less attachment records', async () => {
    const d = db((s) => {
      seedCourse(s); seedSection(s);
      seedStep(s, { id: 'step-bad', attachments_json: '{not json' });
      seedStep(s, { id: 'step-obj', attachments_json: '{"url":"' + R2_HOST + 'nope.pdf"}' });
      seedStep(s, { id: 'step-partial', attachments_json: JSON.stringify([{ name: 'no url' }, { url: 42 }, null]) });
      seedStep(s, { id: 'step-good', attachments_json: attach(`${R2_HOST}courses/good.pdf`) });
    });
    const R2_ASSETS = r2Stub();
    const { c, res } = deleteCtx(d, { env: { R2_ASSETS } });
    assert.equal((await res).status, 200);
    await Promise.all(c.waitUntil.promises);
    assert.deepEqual(R2_ASSETS.deleted, ['courses/good.pdf']);
    assert.equal(rows(d, 'SELECT id FROM course').length, 0);
  });

  it('tolerates a malformed or key-less audio content_json', async () => {
    const d = db((s) => {
      seedCourse(s); seedSection(s); seedStep(s, { id: 'step-1' }); seedStep(s, { id: 'step-2' });
      insertRow(s, 'step_rendition', {
        step_id: 'step-1', format: 'audio', content_json: '{not json',
        status: 'published', created_at: 'now', updated_at: 'now',
      });
      insertRow(s, 'step_rendition', {
        step_id: 'step-2', format: 'audio', content_json: '{"duration":10}',
        status: 'published', created_at: 'now', updated_at: 'now',
      });
    });
    const R2_ASSETS = r2Stub();
    const { c, res } = deleteCtx(d, { env: { R2_ASSETS } });
    assert.equal((await res).status, 200);
    await Promise.all(c.waitUntil.promises);
    assert.deepEqual(R2_ASSETS.deleted, []);
  });

  it('still reports success when an R2 attachment delete fails -- the D1 rows are already gone', async () => {
    const d = db((s) => {
      seedCourse(s); seedSection(s);
      seedStep(s, { id: 'step-1', attachments_json: attach(`${R2_HOST}courses/one.pdf`, `${R2_HOST}courses/two.pdf`) });
    });
    const R2_ASSETS = r2Stub({ failOn: ['courses/one.pdf'] });
    const { c, res } = deleteCtx(d, { env: { R2_ASSETS } });
    assert.equal((await res).status, 200);
    await Promise.all(c.waitUntil.promises);
    assert.deepEqual(R2_ASSETS.deleted.sort(), ['courses/one.pdf', 'courses/two.pdf']);
    assert.equal(rows(d, 'SELECT id FROM course').length, 0);
  });

  it('still reports success when an R2 audio delete fails, and keeps deleting the rest', async () => {
    const d = db((s) => {
      seedCourse(s); seedSection(s); seedStep(s, { id: 'step-1' }); seedStep(s, { id: 'step-2' });
      insertRow(s, 'step_rendition', {
        step_id: 'step-1', format: 'audio', content_json: '{"r2_key":"audio/a.mp3"}',
        status: 'published', created_at: 'now', updated_at: 'now',
      });
      insertRow(s, 'step_rendition', {
        step_id: 'step-2', format: 'audio', content_json: '{"r2_key":"audio/b.mp3"}',
        status: 'published', created_at: 'now', updated_at: 'now',
      });
    });
    const R2_ASSETS = r2Stub({ failOn: ['audio/a.mp3'] });
    const { c, res } = deleteCtx(d, { env: { R2_ASSETS } });
    assert.equal((await res).status, 200);
    await Promise.all(c.waitUntil.promises);
    assert.deepEqual(R2_ASSETS.deleted.sort(), ['audio/a.mp3', 'audio/b.mp3']);
  });

  it('completes the delete when the two key-harvest reads answer without a results array', async () => {
    const base = db((s) => {
      seedCourse(s); seedSection(s);
      seedStep(s, { id: 'step-1', attachments_json: attach(`${R2_HOST}courses/one.pdf`) });
      insertRow(s, 'step_rendition', {
        step_id: 'step-1', format: 'audio', content_json: '{"r2_key":"audio/a.mp3"}',
        status: 'published', created_at: 'now', updated_at: 'now',
      });
    });
    const shaped = withEmptyReads(base, [
      'SELECT attachments_json FROM course_step',
      "FROM step_rendition WHERE format = 'audio'",
    ]);
    const R2_ASSETS = r2Stub();
    const { c, res } = deleteCtx(shaped, { env: { R2_ASSETS } });
    assert.equal((await res).status, 200);
    await Promise.all(c.waitUntil.promises);
    assert.deepEqual(R2_ASSETS.deleted, [], 'no keys were harvested, so nothing may be deleted');
    assert.equal(rows(base, 'SELECT id FROM course').length, 0);
    assert.equal(rows(base, 'SELECT step_id FROM step_rendition').length, 0);
  });

  it('deletes the D1 rows even with no R2 binding at all, and orphans the objects rather than 500ing', async () => {
    // Documented on purpose: with R2_ASSETS unbound the attachment and audio
    // objects are LEFT IN THE BUCKET. That is the endpoint's chosen behaviour
    // (an unbound binding is a deploy problem, not a reason to refuse the
    // delete), and the assertion pins it so a change is a decision.
    const d = db((s) => {
      seedCourse(s); seedSection(s);
      seedStep(s, { id: 'step-1', attachments_json: attach(`${R2_HOST}courses/one.pdf`) });
      insertRow(s, 'step_rendition', {
        step_id: 'step-1', format: 'audio', content_json: '{"r2_key":"audio/a.mp3"}',
        status: 'published', created_at: 'now', updated_at: 'now',
      });
    });
    const { c, res } = deleteCtx(d, { env: { R2_ASSETS: undefined } });
    assert.equal((await res).status, 200);
    await Promise.all(c.waitUntil.promises);
    assert.equal(rows(d, 'SELECT id FROM course').length, 0);
    assert.equal(rows(d, 'SELECT step_id FROM step_rendition').length, 0);
  });
});

describe('DELETE /api/admin/courses/[id] -- the step_progress reference probe', () => {
  it('probes step_progress by a column that exists, so the guard can run at all', async () => {
    // REGRESSION PIN. This probe used to read `SELECT id FROM step_progress`.
    // step_progress has no `id` column -- its primary key is the composite
    // (user_id, course_id, step_id) -- so SQLite rejected the statement, the
    // Promise.all rejected with it, and EVERY course DELETE fell into the outer
    // catch as a 500 "Internal error". No course could be deleted, and the
    // reference guard below the probe never executed once in production.
    //
    // Both halves are asserted because either alone would pass over the bug:
    // a clean course must delete, and a course with progress must be refused.
    const clean = db((s) => seedCourse(s));
    assert.equal((await delOne(clean)).status, 200);
    assert.equal(rows(clean, 'SELECT id FROM course').length, 0);

    const withProgress = db((s) => {
      seedCourse(s);
      insertRow(s, 'step_progress', { user_id: 'u1', course_id: 'c-endo', step_id: 'step-1', completed: 1 });
    });
    const { status, body } = await parseResponse(await delOne(withProgress));
    assert.equal(status, 409);
    assert.deepEqual(body.detail.tables, ['step_progress']);
    assert.equal(rows(withProgress, 'SELECT id FROM course').length, 1);
  });
});
