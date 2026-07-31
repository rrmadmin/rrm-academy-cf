/**
 * functions/api/admin/courses/[id]/sections.js  (POST create, PUT reorder)
 *
 * Engine-backed: every mutation is asserted by reading the row back out of the
 * real SQLite engine, never by inspecting the SQL string the handler built.
 *
 * The two shapes this file exists to hold:
 *   ORDERING  - a reorder must persist the new sort_order, and a create must
 *               append at MAX(sort_order)+1 without skipping or duplicating.
 *   OWNERSHIP - sections.js only ever addresses a course by path parameter, so
 *               its IDOR surface is the reorder: ids from another course must be
 *               refused rather than silently renumbered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  treeDb, ctx, read, throwingD1, sectionOrder, readSection,
} from './_course-structure-fixtures.mjs';
import {
  onRequestOptions, onRequestPost, onRequestPut,
} from '../functions/api/admin/courses/[id]/sections.js';

const P = { id: 'course-a' };

function postCtx(db, body, opts = {}) {
  return ctx({ db, params: P, method: 'POST', body, ...opts });
}
function putCtx(db, body, opts = {}) {
  return ctx({ db, params: P, method: 'PUT', body, ...opts });
}

// ---------------------------------------------------------------- preflight --

test('OPTIONS preflight answers 204 with CORS headers', async () => {
  const res = onRequestOptions();
  assert.equal(res.status, 204);
  assert.ok(res.headers.get('Access-Control-Allow-Methods'));
});

// ------------------------------------------------------------ authorization --

test('POST /sections: 401 when the middleware left no user on the context', async () => {
  const db = treeDb();
  const res = await onRequestPost(postCtx(db, { id: 'sec-new', title: 'X' }, { user: null }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'Unauthorized');
  assert.equal(readSection(db, 'sec-new'), null, 'anonymous caller must not write');
  db.close();
});

test('POST /sections: 403 for a signed-in non-admin role (authorization guard)', async () => {
  const db = treeDb();
  const res = await onRequestPost(postCtx(db, { id: 'sec-new', title: 'X' }, { role: 'member' }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'Forbidden');
  assert.equal(readSection(db, 'sec-new'), null, 'member role must not create a section');
  db.close();
});

test('POST /sections: superadmin is accepted by the same guard', async () => {
  const db = treeDb();
  const res = await onRequestPost(postCtx(db, { id: 'sec-super', title: 'Super' }, { role: 'superadmin' }));
  assert.equal(res.status, 201);
  assert.ok(readSection(db, 'sec-super'));
  db.close();
});

test('PUT /sections (reorder): 401 anonymous, 403 non-admin, and order is untouched', async () => {
  const db = treeDb();
  const before = sectionOrder(db, 'course-a');
  assert.equal((await onRequestPut(putCtx(db, { order: ['sec-a2', 'sec-a1'] }, { user: null }))).status, 401);
  assert.equal((await onRequestPut(putCtx(db, { order: ['sec-a2', 'sec-a1'] }, { role: 'member' }))).status, 403);
  assert.deepEqual(sectionOrder(db, 'course-a'), before);
  db.close();
});

// -------------------------------------------------------------- misconfigured --

test('POST and PUT /sections: 503 when the DB binding is absent', async () => {
  assert.equal((await onRequestPost(postCtx(null, { id: 'x', title: 'X' }))).status, 503);
  assert.equal((await onRequestPut(putCtx(null, { order: [] }))).status, 503);
});

// ----------------------------------------------------------- input validation --

test('POST /sections: 400 invalid_id for a missing, non-string or over-long course path param', async () => {
  const db = treeDb();
  for (const params of [{}, { id: 123 }, { id: 'c'.repeat(101) }]) {
    const res = await onRequestPost(ctx({ db, params, method: 'POST', body: { id: 'sec-new', title: 'X' } }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_id');
  }
  db.close();
});

test('POST /sections: 400 Invalid JSON when the body will not parse', async () => {
  const db = treeDb();
  const res = await onRequestPost(ctx({ db, params: P, method: 'POST' }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Invalid JSON');
  db.close();
});

test('POST /sections: 400 Invalid payload for a non-object body', async () => {
  const db = treeDb();
  for (const raw of ['[1,2]', 'null', '"str"']) {
    const res = await onRequestPost(ctx({ db, params: P, method: 'POST', rawBody: raw }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Invalid payload');
  }
  db.close();
});

test('POST /sections: 400 invalid_id for every rejected section-id shape', async () => {
  const db = treeDb();
  const cases = [
    ['non-string', 42],
    ['empty', '   '],
    ['over 80 chars', 'a'.repeat(81)],
    ['leading digit', '1section'],
    ['uppercase', 'Sec-New'],
    ['underscore', 'sec_new'],
    ['path traversal', '../other'],
  ];
  for (const [label, id] of cases) {
    const res = await onRequestPost(postCtx(db, { id, title: 'X' }));
    assert.equal(res.status, 400, label);
    assert.equal((await res.json()).error, 'invalid_id', label);
  }
  assert.equal(sectionOrder(db, 'course-a').length, 2, 'no rejected id reached the table');
  db.close();
});

test('POST /sections: 400 invalid_title for non-string, blank or over-long titles', async () => {
  const db = treeDb();
  for (const title of [undefined, 7, '   ', 't'.repeat(201)]) {
    const res = await onRequestPost(postCtx(db, { id: 'sec-new', title }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_title');
  }
  assert.equal(readSection(db, 'sec-new'), null);
  db.close();
});

test('POST /sections: 400 invalid_sort_order for non-integer or negative positions', async () => {
  const db = treeDb();
  for (const sortOrder of [1.5, -1, '2', null]) {
    const res = await onRequestPost(postCtx(db, { id: 'sec-new', title: 'X', sortOrder }));
    assert.equal(res.status, 400, String(sortOrder));
    assert.equal((await res.json()).error, 'invalid_sort_order');
  }
  db.close();
});

// -------------------------------------------------------------- not-found --

test('POST /sections: 404 course_not_found for an unknown course', async () => {
  const db = treeDb();
  const res = await onRequestPost(ctx({ db, params: { id: 'course-zzz' }, method: 'POST', body: { id: 'sec-new', title: 'X' } }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'course_not_found');
  assert.equal(readSection(db, 'sec-new'), null);
  db.close();
});

// ------------------------------------------------------------ create + order --

test('POST /sections: creates the row and appends at MAX(sort_order)+1', async () => {
  const db = treeDb();
  const { status, body } = await read(await onRequestPost(postCtx(db, { id: 'sec-a3', title: '  Third  ' })));
  assert.equal(status, 201);
  assert.deepEqual(body.data, { id: 'sec-a3', courseId: 'course-a', title: 'Third', sortOrder: 2 });

  const row = readSection(db, 'sec-a3');
  assert.equal(row.title, 'Third', 'title is stored trimmed');
  assert.equal(row.course_id, 'course-a');
  assert.equal(row.sort_order, 2);
  assert.deepEqual(sectionOrder(db, 'course-a'), [
    { id: 'sec-a1', sortOrder: 0 }, { id: 'sec-a2', sortOrder: 1 }, { id: 'sec-a3', sortOrder: 2 },
  ], 'append must not skip or duplicate a position');
  db.close();
});

test('POST /sections: the first section of an empty course lands at sort_order 0, not -1', async () => {
  const db = treeDb({
    extraSeed: (s) => s.prepare("INSERT INTO course (id, slug, title) VALUES ('course-c','course-c','C')").run(),
  });
  const { status, body } = await read(await onRequestPost(ctx({
    db, params: { id: 'course-c' }, method: 'POST', body: { id: 'sec-c1', title: 'First' },
  })));
  assert.equal(status, 201);
  assert.equal(body.data.sortOrder, 0, 'COALESCE(MAX,-1)+1 must produce 0 for an empty course');
  assert.equal(readSection(db, 'sec-c1').sort_order, 0);
  db.close();
});

test('POST /sections: an explicit sortOrder is written verbatim, duplicates included', async () => {
  const db = treeDb();
  const { status, body } = await read(await onRequestPost(postCtx(db, { id: 'sec-mid', title: 'Middle', sortOrder: 1 })));
  assert.equal(status, 201);
  assert.equal(body.data.sortOrder, 1);
  // PINNED, and it is a sharp edge: sections.js accepts a caller-chosen
  // position with no shift of the sections already at or after it, so the
  // course now holds TWO sections at sort_order 1 and the tie is broken by id.
  // steps.js has no equivalent parameter -- it always appends.
  assert.deepEqual(sectionOrder(db, 'course-a'), [
    { id: 'sec-a1', sortOrder: 0 }, { id: 'sec-a2', sortOrder: 1 }, { id: 'sec-mid', sortOrder: 1 },
  ]);
  db.close();
});

test('POST /sections: 409 section_id_already_exists on the UNIQUE conflict', async () => {
  const db = treeDb();
  const res = await onRequestPost(postCtx(db, { id: 'sec-a1', title: 'Clash' }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'section_id_already_exists');
  assert.equal(readSection(db, 'sec-a1').title, 'Section sec-a1', 'the existing row is untouched');
  db.close();
});

test('POST /sections: a section id already used by ANOTHER course is refused (ids are global)', async () => {
  const db = treeDb();
  const res = await onRequestPost(postCtx(db, { id: 'sec-b1', title: 'Steal' }));
  assert.equal(res.status, 409);
  assert.equal(readSection(db, 'sec-b1').course_id, 'course-b', 'course-b keeps its section');
  db.close();
});

test('POST /sections: a non-UNIQUE insert failure is rethrown and surfaces as 500', async () => {
  const db = treeDb();
  const res = await onRequestPost(ctx({
    db: throwingD1(db, 'INSERT INTO course_section'), params: P, method: 'POST', body: { id: 'sec-new', title: 'X' },
  }));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'Internal error');
  assert.equal(readSection(db, 'sec-new'), null);
  db.close();
});

test('POST /sections: 500 when the course lookup itself throws', async () => {
  const db = treeDb();
  const c = ctx({ db: throwingD1(db, 'SELECT id FROM course WHERE id = ?'), params: P, method: 'POST', body: { id: 'sec-new', title: 'X' } });
  const res = await onRequestPost(c);
  assert.equal(res.status, 500);
  assert.equal(c.events.actions().includes('section_create_error'), true);
  db.close();
});

// ---------------------------------------------------------------- reorder --

test('PUT /sections: 400 invalid_id for a bad course path param', async () => {
  const db = treeDb();
  const res = await onRequestPut(ctx({ db, params: { id: '' }, method: 'PUT', body: { order: [] } }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_id');
  db.close();
});

test('PUT /sections: 400 Invalid JSON and 400 Invalid payload', async () => {
  const db = treeDb();
  assert.equal((await onRequestPut(ctx({ db, params: P, method: 'PUT' }))).status, 400);
  const res = await onRequestPut(ctx({ db, params: P, method: 'PUT', rawBody: '[]' }));
  assert.equal((await res.json()).error, 'Invalid payload');
  db.close();
});

test('PUT /sections: 400 incomplete_order when order is not an array', async () => {
  const db = treeDb();
  const res = await onRequestPut(putCtx(db, { order: 'sec-a1' }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'incomplete_order');
  db.close();
});

test('PUT /sections: 400 invalid_id when an order entry is not a non-blank string', async () => {
  const db = treeDb();
  for (const entry of [7, '', '  ', null]) {
    const res = await onRequestPut(putCtx(db, { order: ['sec-a1', entry] }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_id');
  }
  db.close();
});

test('PUT /sections: 404 course_not_found before any write', async () => {
  const db = treeDb();
  const before = sectionOrder(db, 'course-a');
  const res = await onRequestPut(ctx({ db, params: { id: 'nope' }, method: 'PUT', body: { order: ['sec-a2', 'sec-a1'] } }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'course_not_found');
  assert.deepEqual(sectionOrder(db, 'course-a'), before);
  db.close();
});

test('PUT /sections: 400 incomplete_order when the array is shorter than the course', async () => {
  const db = treeDb();
  const before = sectionOrder(db, 'course-a');
  const res = await onRequestPut(putCtx(db, { order: ['sec-a1'] }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'incomplete_order');
  assert.deepEqual(sectionOrder(db, 'course-a'), before, 'a partial order must not renumber anything');
  db.close();
});

test('PUT /sections IDOR: a section id from course-b cannot be reordered through the course-a path', async () => {
  const db = treeDb();
  const before = { a: sectionOrder(db, 'course-a'), b: sectionOrder(db, 'course-b') };
  const res = await onRequestPut(putCtx(db, { order: ['sec-a1', 'sec-b1'] }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'incomplete_order');
  assert.deepEqual(sectionOrder(db, 'course-a'), before.a);
  assert.deepEqual(sectionOrder(db, 'course-b'), before.b, "course-b's section keeps its position");
  db.close();
});

test('PUT /sections: the new order is persisted, 0-based and contiguous', async () => {
  const db = treeDb();
  const res = await onRequestPut(putCtx(db, { order: ['sec-a2', 'sec-a1'] }));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()), { ok: true });
  assert.deepEqual(sectionOrder(db, 'course-a'), [
    { id: 'sec-a2', sortOrder: 0 }, { id: 'sec-a1', sortOrder: 1 },
  ]);
  assert.notEqual(readSection(db, 'sec-a1').updated_at, '2026-01-01 00:00:00', 'updated_at is stamped');
  db.close();
});

test('PUT /sections: reordering course-a leaves course-b untouched', async () => {
  const db = treeDb();
  const beforeB = sectionOrder(db, 'course-b');
  await onRequestPut(putCtx(db, { order: ['sec-a2', 'sec-a1'] }));
  assert.deepEqual(sectionOrder(db, 'course-b'), beforeB);
  db.close();
});

test('PUT /sections: 400 incomplete_order for a duplicated id, and nothing is renumbered', async () => {
  // order.length === existingIds.size and every entry is a member, so
  // ['sec-a1','sec-a1'] satisfies the other two guards on its own. Left
  // unchecked the batch writes sec-a1 twice (0 then 1) and never touches
  // sec-a2, so both sections land on sort_order 1 and one is silently dropped
  // from the caller's ordering. The Set-size check refuses it up front.
  const db = treeDb();
  const before = sectionOrder(db, 'course-a');
  const res = await onRequestPut(putCtx(db, { order: ['sec-a1', 'sec-a1'] }));
  assert.equal(res.status, 400, 'a duplicated id is refused');
  assert.equal((await res.json()).error, 'incomplete_order');
  assert.deepEqual(sectionOrder(db, 'course-a'), before, 'a refused reorder renumbers nothing');
  assert.equal(readSection(db, 'sec-a1').updated_at, '2026-01-01 00:00:00', 'no row was even touched');
  db.close();
});

test('PUT /sections: a duplicate is refused before the section rows are read, so a 3-section course cannot lose one', async () => {
  // Longer array so the duplicate is not the whole payload: the completeness
  // arithmetic still balances (3 entries, 3 sections) and every entry is real.
  const db = treeDb({
    extraSeed: (s) => s.prepare(
      'INSERT INTO course_section (id, course_id, title, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).run('sec-a3', 'course-a', 'Section sec-a3', 2, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
  });
  const before = sectionOrder(db, 'course-a');
  const res = await onRequestPut(putCtx(db, { order: ['sec-a3', 'sec-a1', 'sec-a3'] }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'incomplete_order');
  assert.deepEqual(sectionOrder(db, 'course-a'), before, 'sec-a2 keeps its position instead of being stranded');
  db.close();
});

test('PUT /sections: 500 when the reorder batch throws', async () => {
  const db = treeDb();
  const c = ctx({
    db: throwingD1(db, 'UPDATE course_section SET sort_order'),
    params: P, method: 'PUT', body: { order: ['sec-a2', 'sec-a1'] },
  });
  const res = await onRequestPut(c);
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'Internal error');
  assert.ok(c.events.actions().includes('section_reorder_error'));
  assert.deepEqual(sectionOrder(db, 'course-a'), [
    { id: 'sec-a1', sortOrder: 0 }, { id: 'sec-a2', sortOrder: 1 },
  ], 'a failed batch leaves the old order in place');
  db.close();
});
