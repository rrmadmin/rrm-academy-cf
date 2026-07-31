/**
 * functions/api/admin/courses/[id]/steps.js  (POST create, PUT reorder)
 *
 * Sibling of sections.js and the same two shapes apply:
 *   ORDERING  - a create appends at MAX(sort_order)+1 within its SECTION (not
 *               its course), and a reorder must persist 0-based contiguous
 *               positions.
 *   OWNERSHIP - the create and the reorder both address a section by body
 *               parameter, so both must refuse a section that belongs to
 *               another course. That guard is the IDOR line for this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  treeDb, ctx, read, throwingD1, readStep, stepOrder,
} from './_course-structure-fixtures.mjs';
import {
  onRequestOptions, onRequestPost, onRequestPut,
} from '../functions/api/admin/courses/[id]/steps.js';

const P = { id: 'course-a' };
const base = { id: 'step-new', sectionId: 'sec-a1', title: 'New step', type: 'article' };

const post = (db, body, opts = {}) => onRequestPost(ctx({ db, params: P, method: 'POST', body, ...opts }));
const put = (db, body, opts = {}) => onRequestPut(ctx({ db, params: P, method: 'PUT', body, ...opts }));

// ---------------------------------------------------------------- preflight --

test('OPTIONS preflight answers 204', () => {
  assert.equal(onRequestOptions().status, 204);
});

// ------------------------------------------------------------ authorization --

test('POST /steps: 401 anonymous and 403 non-admin, with no row written', async () => {
  const db = treeDb();
  assert.equal((await post(db, base, { user: null })).status, 401);
  assert.equal((await post(db, base, { role: 'member' })).status, 403);
  assert.equal(readStep(db, 'step-new'), null);
  db.close();
});

test('PUT /steps (reorder): 401 anonymous and 403 non-admin, with the order untouched', async () => {
  const db = treeDb();
  const before = stepOrder(db, 'sec-a1');
  assert.equal((await put(db, { sectionId: 'sec-a1', order: ['step-a2', 'step-a1'] }, { user: null })).status, 401);
  assert.equal((await put(db, { sectionId: 'sec-a1', order: ['step-a2', 'step-a1'] }, { role: 'member' })).status, 403);
  assert.deepEqual(stepOrder(db, 'sec-a1'), before);
  db.close();
});

test('POST /steps: superadmin passes the same guard', async () => {
  const db = treeDb();
  assert.equal((await post(db, base, { role: 'superadmin' })).status, 201);
  assert.ok(readStep(db, 'step-new'));
  db.close();
});

test('POST and PUT /steps: 503 without a DB binding', async () => {
  assert.equal((await post(null, base)).status, 503);
  assert.equal((await put(null, { sectionId: 'sec-a1', order: [] })).status, 503);
});

// ----------------------------------------------------------- input validation --

test('POST /steps: 400 invalid_id for a bad course path param', async () => {
  const db = treeDb();
  for (const params of [{}, { id: 5 }, { id: 'c'.repeat(101) }]) {
    const res = await onRequestPost(ctx({ db, params, method: 'POST', body: base }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_id');
  }
  db.close();
});

test('POST /steps: 400 Invalid JSON and Invalid payload', async () => {
  const db = treeDb();
  assert.equal((await onRequestPost(ctx({ db, params: P, method: 'POST' }))).status, 400);
  const res = await onRequestPost(ctx({ db, params: P, method: 'POST', rawBody: '[]' }));
  assert.equal((await res.json()).error, 'Invalid payload');
  db.close();
});

test('POST /steps: 400 invalid_id for every rejected step-id shape', async () => {
  const db = treeDb();
  for (const id of [7, '  ', 'a'.repeat(81), '9lead', 'Step-New', 'step_new', '../escape']) {
    const res = await post(db, { ...base, id });
    assert.equal(res.status, 400, String(id));
    assert.equal((await res.json()).error, 'invalid_id');
  }
  db.close();
});

test('POST /steps: 400 invalid_section_id for a missing, blank or over-long section id', async () => {
  const db = treeDb();
  for (const sectionId of [undefined, 3, '   ', 's'.repeat(101)]) {
    const res = await post(db, { ...base, sectionId });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_section_id');
  }
  db.close();
});

test('POST /steps: 400 invalid_title, invalid_type, invalid_status, invalid_duration', async () => {
  const db = treeDb();
  const cases = [
    [{ title: undefined }, 'invalid_title'],
    [{ title: '  ' }, 'invalid_title'],
    [{ title: 't'.repeat(201) }, 'invalid_title'],
    [{ type: 'audio' }, 'invalid_type'],
    [{ type: undefined }, 'invalid_type'],
    [{ status: 'live' }, 'invalid_status'],
    [{ duration: 1.5 }, 'invalid_duration'],
    [{ duration: -1 }, 'invalid_duration'],
    [{ duration: 86401 }, 'invalid_duration'],
    [{ duration: '60' }, 'invalid_duration'],
  ];
  for (const [patch, error] of cases) {
    const res = await post(db, { ...base, ...patch });
    assert.equal(res.status, 400, error);
    assert.equal((await res.json()).error, error, JSON.stringify(patch));
  }
  assert.equal(readStep(db, 'step-new'), null);
  db.close();
});

test('POST /steps: stream_uid rules are enforced in both directions', async () => {
  const db = treeDb();
  const missing = await post(db, { ...base, type: 'video' });
  assert.equal((await missing.json()).error, 'stream_uid_required_for_video');
  const blank = await post(db, { ...base, type: 'video', streamUid: '   ' });
  assert.equal((await blank.json()).error, 'stream_uid_required_for_video');
  const tooLong = await post(db, { ...base, type: 'video', streamUid: 'u'.repeat(65) });
  assert.equal((await tooLong.json()).error, 'stream_uid_required_for_video');
  const notVideo = await post(db, { ...base, type: 'article', streamUid: 'uid-1' });
  assert.equal((await notVideo.json()).error, 'stream_uid_only_for_video');
  assert.equal(readStep(db, 'step-new'), null);
  db.close();
});

test('POST /steps: 400 invalid_attachments for every rejected attachment shape', async () => {
  const db = treeDb();
  const bad = [
    'not-an-array',
    [null],
    ['string-entry'],
    [{ name: 1, url: 'https://x.test/a' }],
    [{ name: 'a', url: 9 }],
    [{ name: 'n'.repeat(201), url: 'https://x.test/a' }],
    [{ name: 'a', url: 'https://x.test/' + 'u'.repeat(2000) }],
    [{ name: 'a', url: 'not a url' }],
    [{ name: 'a', url: 'javascript:alert(1)' }],
    [{ name: 'a', url: 'ftp://x.test/a' }],
  ];
  for (const attachments of bad) {
    const res = await post(db, { ...base, attachments });
    assert.equal(res.status, 400, JSON.stringify(attachments));
    assert.equal((await res.json()).error, 'invalid_attachments');
  }
  db.close();
});

// ------------------------------------------------------------- not-found --

test('POST /steps: 404 course_not_found for an unknown course', async () => {
  const db = treeDb();
  const res = await onRequestPost(ctx({ db, params: { id: 'course-zz' }, method: 'POST', body: base }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'course_not_found');
  db.close();
});

test('POST /steps IDOR: a section belonging to course-b is 404 through the course-a path', async () => {
  const db = treeDb();
  const res = await post(db, { ...base, sectionId: 'sec-b1' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'section_not_found');
  assert.equal(readStep(db, 'step-new'), null, 'no step was grafted onto course-b');
  assert.deepEqual(stepOrder(db, 'sec-b1'), [{ id: 'step-b1', sortOrder: 0 }]);
  db.close();
});

test('POST /steps: 404 section_not_found for a section that does not exist at all', async () => {
  const db = treeDb();
  const res = await post(db, { ...base, sectionId: 'sec-nope' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'section_not_found');
  db.close();
});

// ------------------------------------------------------------ create + order --

test('POST /steps: creates the row, defaults status to published and appends within the section', async () => {
  const db = treeDb();
  const { status, body } = await read(await post(db, { ...base, title: '  Trimmed  ' }));
  assert.equal(status, 201);
  const row = readStep(db, 'step-new');
  assert.equal(row.title, 'Trimmed');
  assert.equal(row.section_id, 'sec-a1');
  assert.equal(row.course_id, 'course-a');
  assert.equal(row.type, 'article');
  assert.equal(row.status, 'published');
  assert.equal(row.stream_uid, null);
  assert.equal(row.duration_seconds, null);
  assert.equal(row.attachments_json, null);
  assert.equal(row.sort_order, 2, 'appended after step-a1(0) and step-a2(1)');
  assert.deepEqual(body.data, {
    id: 'step-new', courseId: 'course-a', sectionId: 'sec-a1', title: 'Trimmed',
    type: 'article', sortOrder: 2, status: 'published',
    createdAt: row.created_at, updatedAt: row.updated_at,
  });
  assert.deepEqual(stepOrder(db, 'sec-a1').map((r) => r.sortOrder), [0, 1, 2], 'no gap, no duplicate');
  db.close();
});

test('POST /steps: sort_order is per-section, so the first step of a sibling section is 0', async () => {
  const db = treeDb({
    extraSeed: (s) => s.prepare("INSERT INTO course_section (id, course_id, title, sort_order) VALUES ('sec-a9','course-a','Empty',9)").run(),
  });
  const { body } = await read(await post(db, { ...base, sectionId: 'sec-a9' }));
  assert.equal(body.data.sortOrder, 0);
  assert.deepEqual(stepOrder(db, 'sec-a1').map((r) => r.sortOrder), [0, 1], 'the busy section is untouched');
  db.close();
});

test('POST /steps: a video step persists its stream uid, duration, status and attachments', async () => {
  const db = treeDb();
  const attachments = [{ name: 'slides.pdf', url: 'https://example.com/slides.pdf' }];
  const { status, body } = await read(await post(db, {
    ...base, type: 'video', streamUid: '  uid-new  ', duration: 300, status: 'draft', attachments,
  }));
  assert.equal(status, 201);
  const row = readStep(db, 'step-new');
  assert.equal(row.stream_uid, 'uid-new', 'stream uid is stored trimmed');
  assert.equal(row.duration_seconds, 300);
  assert.equal(row.status, 'draft');
  assert.deepEqual(JSON.parse(row.attachments_json), attachments);
  assert.equal(body.data.streamUid, 'uid-new');
  assert.equal(body.data.duration, 300);
  assert.deepEqual(body.data.attachments, attachments);
  db.close();
});

test('POST /steps: duration null and an empty attachments array are stored, and the empty array is omitted from the response', async () => {
  const db = treeDb();
  const { body } = await read(await post(db, { ...base, duration: null, attachments: [] }));
  const row = readStep(db, 'step-new');
  assert.equal(row.duration_seconds, null);
  assert.equal(row.attachments_json, '[]');
  assert.equal('duration' in body.data, false);
  assert.equal('attachments' in body.data, false, 'an empty array is not echoed back as attachments');
  db.close();
});

test('POST /steps: a stored attachments_json that is not a JSON array is omitted from the response', async () => {
  // Written by an older code path or a manual repair; mapStep must not throw.
  let fired = false;
  const db = treeDb({
    interleave({ sql, db: raw }) {
      if (!fired && sql.startsWith('SELECT * FROM course_step WHERE id = ?')) {
        fired = true;
        raw.prepare("UPDATE course_step SET attachments_json = '{\"a\":1}' WHERE id = 'step-new'").run();
      }
    },
  });
  const { status, body } = await read(await post(db, base));
  assert.equal(status, 201);
  assert.equal('attachments' in body.data, false);
  db.close();
});

test('POST /steps: malformed stored attachments_json is swallowed rather than 500ing', async () => {
  let fired = false;
  const db = treeDb({
    interleave({ sql, db: raw }) {
      if (!fired && sql.startsWith('SELECT * FROM course_step WHERE id = ?')) {
        fired = true;
        raw.prepare("UPDATE course_step SET attachments_json = 'definitely-not-json' WHERE id = 'step-new'").run();
      }
    },
  });
  const { status, body } = await read(await post(db, base));
  assert.equal(status, 201);
  assert.equal('attachments' in body.data, false);
  db.close();
});

test('POST /steps: 409 step_id_already_exists, including an id owned by another course', async () => {
  const db = treeDb();
  const same = await post(db, { ...base, id: 'step-a1' });
  assert.equal(same.status, 409);
  assert.equal((await same.json()).error, 'step_id_already_exists');

  const other = await post(db, { ...base, id: 'step-b1' });
  assert.equal(other.status, 409);
  assert.equal(readStep(db, 'step-b1').course_id, 'course-b', 'course-b keeps its step');
  db.close();
});

test('POST /steps: a non-UNIQUE insert failure is rethrown as 500 and writes nothing', async () => {
  const db = treeDb();
  const c = ctx({ db: throwingD1(db, 'INSERT INTO course_step'), params: P, method: 'POST', body: base });
  const res = await onRequestPost(c);
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'Internal error');
  assert.equal(readStep(db, 'step-new'), null);
  assert.ok(c.events.actions().includes('step_create_error'));
  db.close();
});

// ---------------------------------------------------------------- reorder --

test('PUT /steps: 400 invalid_id, Invalid JSON and Invalid payload', async () => {
  const db = treeDb();
  const badParams = await onRequestPut(ctx({ db, params: { id: '' }, method: 'PUT', body: { sectionId: 'sec-a1', order: [] } }));
  assert.equal((await badParams.json()).error, 'invalid_id');
  assert.equal((await onRequestPut(ctx({ db, params: P, method: 'PUT' }))).status, 400);
  const payload = await onRequestPut(ctx({ db, params: P, method: 'PUT', rawBody: 'null' }));
  assert.equal((await payload.json()).error, 'Invalid payload');
  db.close();
});

test('PUT /steps: 400 invalid_section_id and 400 incomplete_order for a non-array order', async () => {
  const db = treeDb();
  for (const sectionId of [undefined, 5, ' ', 's'.repeat(101)]) {
    const res = await put(db, { sectionId, order: [] });
    assert.equal((await res.json()).error, 'invalid_section_id');
  }
  const res = await put(db, { sectionId: 'sec-a1', order: 'step-a1' });
  assert.equal((await res.json()).error, 'incomplete_order');
  db.close();
});

test('PUT /steps: 400 invalid_id when an order entry is not a non-blank string', async () => {
  const db = treeDb();
  for (const entry of [1, '', '  ', {}]) {
    const res = await put(db, { sectionId: 'sec-a1', order: ['step-a1', entry] });
    assert.equal((await res.json()).error, 'invalid_id');
  }
  db.close();
});

test('PUT /steps: 404 course_not_found and 404 section_not_found', async () => {
  const db = treeDb();
  const noCourse = await onRequestPut(ctx({ db, params: { id: 'course-zz' }, method: 'PUT', body: { sectionId: 'sec-a1', order: [] } }));
  assert.equal((await noCourse.json()).error, 'course_not_found');
  const noSection = await put(db, { sectionId: 'sec-zz', order: [] });
  assert.equal((await noSection.json()).error, 'section_not_found');
  db.close();
});

test('PUT /steps IDOR: a section from course-b cannot be reordered through the course-a path', async () => {
  const db = treeDb();
  const before = stepOrder(db, 'sec-b1');
  const res = await put(db, { sectionId: 'sec-b1', order: ['step-b1'] });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'section_not_found');
  assert.deepEqual(stepOrder(db, 'sec-b1'), before);
  db.close();
});

test('PUT /steps: 400 incomplete_order for a short list or a step from a sibling section', async () => {
  const db = treeDb();
  const before = stepOrder(db, 'sec-a1');
  const short = await put(db, { sectionId: 'sec-a1', order: ['step-a1'] });
  assert.equal((await short.json()).error, 'incomplete_order');
  const foreign = await put(db, { sectionId: 'sec-a1', order: ['step-a1', 'step-a3'] });
  assert.equal((await foreign.json()).error, 'incomplete_order');
  assert.deepEqual(stepOrder(db, 'sec-a1'), before);
  assert.deepEqual(stepOrder(db, 'sec-a2'), [{ id: 'step-a3', sortOrder: 0 }]);
  db.close();
});

test('PUT /steps: the new order is persisted 0-based and contiguous, and stamps updated_at', async () => {
  const db = treeDb();
  const res = await put(db, { sectionId: 'sec-a1', order: ['step-a2', 'step-a1'] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(stepOrder(db, 'sec-a1'), [
    { id: 'step-a2', sortOrder: 0 }, { id: 'step-a1', sortOrder: 1 },
  ]);
  assert.notEqual(readStep(db, 'step-a1').updated_at, '2026-01-01 00:00:00');
  assert.deepEqual(stepOrder(db, 'sec-a2'), [{ id: 'step-a3', sortOrder: 0 }], 'sibling section untouched');
  db.close();
});

test('PUT /steps: 400 incomplete_order for a duplicated id, and no step is renumbered', async () => {
  // Same hole as sections.js PUT: order.length === existingIds.size and every
  // entry is a member, so ['step-a1','step-a1'] clears the other two guards.
  // Unrefused it writes step-a1 twice (0 then 1) and never writes step-a2, so
  // both steps end at sort_order 1 and the learner's "next lesson" falls to an
  // id tiebreak. The Set-size check refuses it before the batch is built.
  const db = treeDb();
  const before = stepOrder(db, 'sec-a1');
  const res = await put(db, { sectionId: 'sec-a1', order: ['step-a1', 'step-a1'] });
  assert.equal(res.status, 400, 'a duplicated id is refused');
  assert.equal((await res.json()).error, 'incomplete_order');
  assert.deepEqual(stepOrder(db, 'sec-a1'), before, 'a refused reorder renumbers nothing');
  assert.equal(readStep(db, 'step-a1').updated_at, '2026-01-01 00:00:00', 'no row was even touched');
  db.close();
});

test('PUT /steps: a duplicate is refused in a 3-step section, so the omitted step is not stranded', async () => {
  const db = treeDb({
    extraSeed: (s) => s.prepare(`INSERT INTO course_step
        (id, section_id, course_id, title, type, sort_order, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('step-a4', 'sec-a1', 'course-a', 'Step step-a4', 'article', 2, 'published', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
  });
  const before = stepOrder(db, 'sec-a1');
  const res = await put(db, { sectionId: 'sec-a1', order: ['step-a4', 'step-a1', 'step-a4'] });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'incomplete_order');
  assert.deepEqual(stepOrder(db, 'sec-a1'), before, 'step-a2 keeps its position instead of being stranded');
  db.close();
});

test('PUT /steps: 500 when the reorder batch throws, leaving the old order in place', async () => {
  const db = treeDb();
  const c = ctx({
    db: throwingD1(db, 'UPDATE course_step SET sort_order'),
    params: P, method: 'PUT', body: { sectionId: 'sec-a1', order: ['step-a2', 'step-a1'] },
  });
  const res = await onRequestPut(c);
  assert.equal(res.status, 500);
  assert.ok(c.events.actions().includes('step_reorder_error'));
  assert.deepEqual(stepOrder(db, 'sec-a1'), [
    { id: 'step-a1', sortOrder: 0 }, { id: 'step-a2', sortOrder: 1 },
  ]);
  db.close();
});

test('PUT /steps: 500 when the existing-step probe throws', async () => {
  const db = treeDb();
  const c = ctx({
    db: throwingD1(db, 'SELECT id FROM course_step WHERE section_id = ?'),
    params: P, method: 'PUT', body: { sectionId: 'sec-a1', order: ['step-a2', 'step-a1'] },
  });
  assert.equal((await onRequestPut(c)).status, 500);
  db.close();
});
