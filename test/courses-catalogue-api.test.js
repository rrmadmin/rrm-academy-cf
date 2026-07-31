/**
 * functions/api/courses.js -- the build-time catalogue read.
 *
 * This endpoint is what the site build fetches to render every course page, so
 * a wrong answer here does not 500, it SHIPS. The three things that decide the
 * payload are all SQL or engine behaviour:
 *   - `WHERE status = 'published'` on courses AND on steps, plus the JS-side
 *     filter that drops sections left with no published steps. A draft lesson
 *     that leaks into the published payload is a page that advertises content
 *     nobody can open.
 *   - `SELECT COUNT(*) ... FROM enrollment WHERE revoked_at IS NULL` is the
 *     "participants" figure printed on the course page. A refunded learner must
 *     not be counted.
 *   - `ORDER BY created_at DESC, id DESC` decides catalogue order.
 * A substring-matching mock returns whatever the test declares for each of
 * those, so every assertion about them would restate the fixture. Everything
 * below runs on node:sqlite loaded with the committed schema
 * (test/_d1-sqlite.mjs).
 *
 * WHAT IS STILL FAKED, AND WHAT IT CANNOT PROVE
 *  - Analytics Engine is a stub; the log payload is asserted only where a test
 *    says so.
 *  - `datetime('now')` defaults come from the machine clock. Rows that need a
 *    deterministic order set created_at explicitly instead of relying on it.
 *  - This proves the endpoint's SHAPE, not that the live D1 rows match it.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockDB, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser } from './_d1-sqlite.mjs';

const courses = await import('../functions/api/courses.js');

const TOKEN = 'library-build-token-fixture';

function insertCourse(sqlite, row) {
  const full = {
    id: row.id,
    slug: row.slug ?? row.id,
    title: row.title ?? row.id,
    description: null,
    short_description: null,
    image_url: null,
    image_alt: null,
    price_cents: 0,
    stripe_price_id: null,
    is_free: 0,
    has_certificate: 0,
    certificate_quiz_step_id: null,
    self_paced: 1,
    access_type: 'public',
    coming_soon: 0,
    participants: 0,
    instructors_json: null,
    includes_json: null,
    included_in_json: null,
    settings_json: null,
    seo_json: null,
    faqs_json: null,
    sort_order: 0,
    status: 'published',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...row,
  };
  const cols = Object.keys(full);
  sqlite.prepare(`INSERT INTO course (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => full[c]));
}

function insertSection(sqlite, { id, courseId, title = 'Section', sortOrder = 0 }) {
  sqlite.prepare('INSERT INTO course_section (id, course_id, title, sort_order) VALUES (?, ?, ?, ?)')
    .run(id, courseId, title, sortOrder);
}

function insertStep(sqlite, { id, sectionId, courseId, title = 'Step', type = 'video', status = 'published', streamUid = null, duration = null, sortOrder = 0, attachments = null }) {
  sqlite.prepare(
    'INSERT INTO course_step (id, section_id, course_id, title, type, stream_uid, duration_seconds, sort_order, attachments_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, sectionId, courseId, title, type, streamUid, duration, sortOrder, attachments, status);
}

function insertRendition(sqlite, { stepId, format, status = 'published' }) {
  sqlite.prepare(
    "INSERT INTO step_rendition (step_id, format, content_json, status, word_count, created_at, updated_at) VALUES (?, ?, '{}', ?, 10, '2026-01-01', '2026-01-01')"
  ).run(stepId, format, status);
}

function insertEnrollment(sqlite, { id, userId, courseId, revokedAt = null }) {
  sqlite.prepare('INSERT INTO enrollment (id, user_id, course_id, revoked_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, courseId, revokedAt);
}

function req(url, { token = TOKEN } = {}) {
  const headers = token === null ? {} : { Authorization: `Bearer ${token}` };
  return mockRequest('GET', { url: `https://rrmacademy.org${url}`, headers });
}

function ctx(db, request, envOver = {}) {
  return {
    request,
    env: mockEnv({ DB: db, LIBRARY_BUILD_TOKEN: TOKEN, ...envOver }),
    waitUntil: mockWaitUntil(),
  };
}

describe('GET /api/courses -- authorization', () => {
  let db;
  beforeEach(() => { db = sqliteD1(); });
  afterEach(() => db.close());

  it('OPTIONS answers the CORS preflight with no body', async () => {
    const res = await courses.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'POST, GET, PATCH, DELETE, OPTIONS');
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });

  it('503 when LIBRARY_BUILD_TOKEN is not configured, before any auth comparison', async () => {
    const c = ctx(db, req('/api/courses'), { LIBRARY_BUILD_TOKEN: undefined });
    const { status, body } = await parseResponse(await courses.onRequestGet(c));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
    assert.equal(db._calls.length, 0, 'a misconfigured worker must not query D1');
  });

  it('401 with no Authorization header', async () => {
    const { status, body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses', { token: null }))));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('401 for a same-length token that differs by one character', async () => {
    const nearMiss = TOKEN.slice(0, -1) + 'X';
    assert.equal(nearMiss.length, TOKEN.length);
    const { status } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses', { token: nearMiss }))));
    assert.equal(status, 401);
  });

  it('401 for a token that is a prefix of the real one', async () => {
    const { status } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses', { token: TOKEN.slice(0, 8) }))));
    assert.equal(status, 401);
  });

  it('503 when the DB binding is missing even with a valid token', async () => {
    const c = { request: req('/api/courses'), env: mockEnv({ DB: undefined, LIBRARY_BUILD_TOKEN: TOKEN }), waitUntil: mockWaitUntil() };
    const { status, body } = await parseResponse(await courses.onRequestGet(c));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('200 with the exact token', async () => {
    const { status, body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses'))));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, results: [] });
  });
});

describe('GET /api/courses?id= -- single course', () => {
  let db;

  beforeEach(() => {
    db = sqliteD1({
      seed(sqlite) {
        insertUser(sqlite, { id: 'u1', email: 'a@example.com' });
        insertUser(sqlite, { id: 'u2', email: 'b@example.com' });
        insertUser(sqlite, { id: 'u3', email: 'c@example.com' });

        insertCourse(sqlite, {
          id: 'c-solo',
          slug: 'solo',
          title: 'Solo Course',
          description: 'Long form',
          short_description: 'Short form',
          image_url: '/img/solo.png',
          image_alt: 'Solo',
          price_cents: 4900,
          stripe_price_id: 'price_solo',
          is_free: 1,
          has_certificate: 1,
          certificate_quiz_step_id: 's-quiz',
          self_paced: 0,
          access_type: 'members',
          coming_soon: 1,
          sort_order: 7,
          instructors_json: JSON.stringify([{ name: 'Dr. A' }]),
          settings_json: JSON.stringify({ stepOrder: 'fixed' }),
          seo_json: JSON.stringify({ title: 'SEO' }),
          includes_json: JSON.stringify(['other-slug']),
          included_in_json: JSON.stringify(['parent-slug']),
          faqs_json: JSON.stringify([{ q: 'Q', a: 'A' }]),
          created_at: '2026-03-01T00:00:00.000Z',
        });
        // Sections deliberately inserted out of order to prove ORDER BY.
        insertSection(sqlite, { id: 'sec-b', courseId: 'c-solo', title: 'Second', sortOrder: 2 });
        insertSection(sqlite, { id: 'sec-a', courseId: 'c-solo', title: 'First', sortOrder: 1 });
        insertSection(sqlite, { id: 'sec-empty', courseId: 'c-solo', title: 'Drafts Only', sortOrder: 3 });

        insertStep(sqlite, { id: 's-2', sectionId: 'sec-a', courseId: 'c-solo', title: 'A2', sortOrder: 2 });
        insertStep(sqlite, { id: 's-1', sectionId: 'sec-a', courseId: 'c-solo', title: 'A1', sortOrder: 1, streamUid: 'uid-1', duration: 300, attachments: JSON.stringify([{ name: 'slides.pdf' }]) });
        insertStep(sqlite, { id: 's-quiz', sectionId: 'sec-b', courseId: 'c-solo', title: 'Quiz', type: 'quiz', sortOrder: 1 });
        insertStep(sqlite, { id: 's-draft', sectionId: 'sec-empty', courseId: 'c-solo', title: 'Draft', status: 'draft', sortOrder: 1 });

        // Renditions: inserted audio-first to prove FORMAT_ORDER, plus a draft
        // that must not surface.
        insertRendition(sqlite, { stepId: 's-1', format: 'audio' });
        insertRendition(sqlite, { stepId: 's-1', format: 'reading' });
        insertRendition(sqlite, { stepId: 's-1', format: 'quiz', status: 'draft' });

        insertEnrollment(sqlite, { id: 'e1', userId: 'u1', courseId: 'c-solo' });
        insertEnrollment(sqlite, { id: 'e2', userId: 'u2', courseId: 'c-solo' });
        insertEnrollment(sqlite, { id: 'e3', userId: 'u3', courseId: 'c-solo', revokedAt: '2026-04-01T00:00:00.000Z' });
      },
    });
  });
  afterEach(() => db.close());

  it('400 on an empty id', async () => {
    const { status, body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses?id='))));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid id');
  });

  it('400 on an id longer than 100 characters, 200 at exactly 100', async () => {
    const at = 'x'.repeat(100);
    const over = 'x'.repeat(101);
    const overRes = await parseResponse(await courses.onRequestGet(ctx(db, req(`/api/courses?id=${over}`))));
    assert.equal(overRes.status, 400);
    assert.equal(overRes.body.error, 'Invalid id');
    // 100 is inside the limit, so it reaches the lookup and 404s instead.
    const atRes = await parseResponse(await courses.onRequestGet(ctx(db, req(`/api/courses?id=${at}`))));
    assert.equal(atRes.status, 404);
    assert.equal(atRes.body.error, 'not_found');
  });

  it('404 for an unknown id', async () => {
    const { status, body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses?id=nope'))));
    assert.equal(status, 404);
    assert.deepEqual(body, { ok: false, error: 'not_found' });
  });

  it('maps every column, orders sections, and drops sections with no published step', async () => {
    const { status, body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses?id=c-solo'))));
    assert.equal(status, 200);
    const c = body.data;

    assert.equal(c.id, 'c-solo');
    assert.equal(c.slug, 'solo');
    assert.equal(c.description, 'Long form');
    assert.equal(c.shortDescription, 'Short form');
    assert.equal(c.image, '/img/solo.png');
    assert.equal(c.imageAlt, 'Solo');
    assert.equal(c.priceCents, 4900);
    assert.equal(c.stripePriceId, 'price_solo');
    assert.equal(c.accessType, 'members');
    assert.equal(c.sortOrder, 7);
    assert.equal(c.status, 'published');
    assert.equal(c.createdAt, '2026-03-01T00:00:00.000Z');
    // 0/1 integers become real booleans, not truthy numbers.
    assert.strictEqual(c.isFree, true);
    assert.strictEqual(c.hasCertificate, true);
    assert.strictEqual(c.selfPaced, false);
    assert.strictEqual(c.comingSoon, true);
    assert.equal(c.certificateQuizId, 's-quiz');
    assert.deepEqual(c.instructors, [{ name: 'Dr. A' }]);
    assert.deepEqual(c.settings, { stepOrder: 'fixed' });
    assert.deepEqual(c.seo, { title: 'SEO' });
    assert.deepEqual(c.includes, ['other-slug']);
    assert.deepEqual(c.includedIn, ['parent-slug']);
    assert.deepEqual(c.faqs, [{ q: 'Q', a: 'A' }]);

    assert.deepEqual(c.sections.map((s) => s.title), ['First', 'Second'], 'sort_order decides order; the draft-only section is dropped');
    assert.deepEqual(c.sections[0].steps.map((s) => s.id), ['s-1', 's-2']);
  });

  it('participants counts live enrolments only', async () => {
    const { body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses?id=c-solo'))));
    assert.equal(body.data.participants, 2, 'the revoked enrolment must not be counted');
  });

  it('participants is 0 for a course nobody is enrolled in', async () => {
    db._sqlite.exec("DELETE FROM enrollment");
    const { body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses?id=c-solo'))));
    assert.equal(body.data.participants, 0);
  });

  it('step extras appear only when the row has them', async () => {
    const { body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses?id=c-solo'))));
    const [first, second] = body.data.sections[0].steps;
    assert.equal(first.streamUid, 'uid-1');
    assert.equal(first.duration, 300);
    assert.deepEqual(first.attachments, [{ name: 'slides.pdf' }]);
    assert.equal(second.streamUid, undefined);
    assert.equal(second.duration, undefined);
    assert.equal(second.attachments, undefined, 'an empty attachment list must be omitted, not sent as []');
  });

  it('renditions are listed in FORMAT_ORDER and exclude drafts', async () => {
    const { body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses?id=c-solo'))));
    const [first, second] = body.data.sections[0].steps;
    assert.deepEqual(first.renditions, ['reading', 'audio'], 'reading precedes audio regardless of insert order');
    assert.equal(second.renditions, undefined, 'a step with no published rendition has no renditions key');
  });

  it('preview=1 includes draft steps and keeps every section', async () => {
    const { body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses?id=c-solo&preview=1'))));
    assert.deepEqual(body.data.sections.map((s) => s.title), ['First', 'Second', 'Drafts Only']);
    assert.deepEqual(body.data.sections[2].steps.map((s) => s.id), ['s-draft']);
  });

  it('preview accepts only the literal "1"', async () => {
    const { body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses?id=c-solo&preview=true'))));
    assert.deepEqual(body.data.sections.map((s) => s.title), ['First', 'Second'], 'preview=true is not preview mode');
  });

  it('a course with no certificate quiz omits certificateQuizId entirely', async () => {
    db._sqlite.exec("UPDATE course SET certificate_quiz_step_id = NULL WHERE id = 'c-solo'");
    const { body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses?id=c-solo'))));
    assert.ok(!('certificateQuizId' in body.data));
  });

  it('malformed and mistyped JSON columns fall back instead of throwing', async () => {
    db._sqlite.exec(`UPDATE course SET
      instructors_json = '{not json',
      faqs_json = '{"a":1}',
      settings_json = '[1,2]',
      seo_json = 'null',
      includes_json = NULL,
      included_in_json = 'nope'
      WHERE id = 'c-solo'`);
    const { status, body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses?id=c-solo'))));
    assert.equal(status, 200);
    assert.deepEqual(body.data.instructors, [], 'unparseable -> []');
    assert.deepEqual(body.data.faqs, [], 'an object where an array is expected -> []');
    assert.deepEqual(body.data.settings, {}, 'an array where an object is expected -> {}');
    assert.deepEqual(body.data.seo, {}, 'JSON null -> {}');
    assert.deepEqual(body.data.includes, [], 'SQL NULL -> []');
    assert.deepEqual(body.data.includedIn, []);
  });
});

describe('GET /api/courses -- full list', () => {
  let db;

  beforeEach(() => {
    db = sqliteD1({
      seed(sqlite) {
        insertUser(sqlite, { id: 'u1', email: 'a@example.com' });
        insertCourse(sqlite, { id: 'c-old', slug: 'old', title: 'Older', created_at: '2026-01-01T00:00:00.000Z' });
        insertCourse(sqlite, { id: 'c-new', slug: 'new', title: 'Newer', created_at: '2026-06-01T00:00:00.000Z' });
        insertCourse(sqlite, { id: 'c-draft', slug: 'draftish', title: 'Draft', status: 'draft', created_at: '2026-09-01T00:00:00.000Z' });

        insertSection(sqlite, { id: 'so-1', courseId: 'c-old', title: 'Old Section', sortOrder: 1 });
        insertStep(sqlite, { id: 'so-step', sectionId: 'so-1', courseId: 'c-old', sortOrder: 1 });
        insertStep(sqlite, { id: 'so-draft', sectionId: 'so-1', courseId: 'c-old', status: 'draft', sortOrder: 2 });

        insertSection(sqlite, { id: 'sn-1', courseId: 'c-new', title: 'New Section', sortOrder: 1 });
        insertStep(sqlite, { id: 'sn-step', sectionId: 'sn-1', courseId: 'c-new', sortOrder: 1 });

        // Draft course carries content that must never appear in the list.
        insertSection(sqlite, { id: 'sd-1', courseId: 'c-draft', title: 'Hidden', sortOrder: 1 });
        insertStep(sqlite, { id: 'sd-step', sectionId: 'sd-1', courseId: 'c-draft', sortOrder: 1 });

        insertRendition(sqlite, { stepId: 'sn-step', format: 'flashcards' });
        insertRendition(sqlite, { stepId: 'sn-step', format: 'reading' });

        insertEnrollment(sqlite, { id: 'e1', userId: 'u1', courseId: 'c-new' });
      },
    });
  });
  afterEach(() => db.close());

  it('returns published courses newest first and never a draft course', async () => {
    const { status, body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses'))));
    assert.equal(status, 200);
    assert.deepEqual(body.results.map((c) => c.id), ['c-new', 'c-old']);
  });

  it('a draft step is excluded from the list payload', async () => {
    const { body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses'))));
    const old = body.results.find((c) => c.id === 'c-old');
    assert.deepEqual(old.sections[0].steps.map((s) => s.id), ['so-step']);
  });

  it('per-course participant counts come from the GROUP BY, defaulting to 0', async () => {
    const { body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses'))));
    assert.equal(body.results.find((c) => c.id === 'c-new').participants, 1);
    assert.equal(body.results.find((c) => c.id === 'c-old').participants, 0);
  });

  it('renditions are attached to the right step in the list view', async () => {
    const { body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses'))));
    const fresh = body.results.find((c) => c.id === 'c-new');
    assert.deepEqual(fresh.sections[0].steps[0].renditions, ['reading', 'flashcards']);
    const old = body.results.find((c) => c.id === 'c-old');
    assert.equal(old.sections[0].steps[0].renditions, undefined);
  });

  it('a published course whose only section has no published step keeps an empty sections array', async () => {
    db._sqlite.exec("UPDATE course_step SET status = 'draft' WHERE course_id = 'c-old'");
    const { body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses'))));
    const old = body.results.find((c) => c.id === 'c-old');
    assert.deepEqual(old.sections, []);
  });

  it('an empty catalogue short-circuits to results: []', async () => {
    db._sqlite.exec("UPDATE course SET status = 'archived'");
    const { status, body } = await parseResponse(await courses.onRequestGet(ctx(db, req('/api/courses'))));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, results: [] });
  });
});

describe('GET /api/courses -- failure', () => {
  it('a D1 error becomes a logged 500 rather than a stack trace', async () => {
    const throwingDb = mockDB({ 'FROM course': { throws: 'D1_ERROR: connection lost' } });
    const events = [];
    const env = mockEnv({ DB: throwingDb, LIBRARY_BUILD_TOKEN: TOKEN, EVENTS: { writeDataPoint: (p) => events.push(p) } });
    const { status, body } = await parseResponse(
      await courses.onRequestGet({ request: req('/api/courses'), env, waitUntil: mockWaitUntil() })
    );
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    const logged = events.find((e) => e.blobs.includes('list_error'));
    assert.ok(logged, 'the failure must be logged');
    assert.ok(logged.blobs.includes('D1_ERROR: connection lost'));
  });

  it('a D1 error on the single-course path is caught the same way', async () => {
    const throwingDb = mockDB({ 'FROM course WHERE id': { throws: 'D1_ERROR: timeout' } });
    const env = mockEnv({ DB: throwingDb, LIBRARY_BUILD_TOKEN: TOKEN });
    const { status, body } = await parseResponse(
      await courses.onRequestGet({ request: req('/api/courses?id=c1'), env, waitUntil: mockWaitUntil() })
    );
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
  });
});
