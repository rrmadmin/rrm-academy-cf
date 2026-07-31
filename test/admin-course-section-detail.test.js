/**
 * functions/api/admin/courses/[id]/sections/[sectionId].js  (GET, PUT, DELETE)
 *
 * The delete path is the dangerous one: it walks section -> steps ->
 * renditions/attachments, refuses on four kinds of learner reference, and then
 * cleans R2. Every assertion here reads the surviving rows back out of the real
 * SQLite engine rather than inspecting the SQL the handler built, because the
 * question that matters is what is left in the table afterwards.
 *
 * OWNERSHIP (IDOR) is checked on all three verbs: sec-b1 belongs to course-b and
 * must be invisible, unwritable and undeletable through the course-a path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  treeDb, ctx, read, throwingD1, mockR2, drain,
  readSection, readStep, readRendition, sectionOrder, R2_PUBLIC_HOST,
} from './_course-structure-fixtures.mjs';
import {
  onRequestOptions, onRequestGet, onRequestPut, onRequestDelete,
} from '../functions/api/admin/courses/[id]/sections/[sectionId].js';

const A1 = { id: 'course-a', sectionId: 'sec-a1' };

const rendition = (s, stepId, format, contentJson, extra = {}) =>
  s.prepare(`INSERT INTO step_rendition (step_id, format, content_json, status, source, word_count, duration_seconds, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(stepId, format, contentJson, extra.status ?? 'published', extra.source ?? null,
      extra.wordCount ?? null, extra.duration ?? null, '2026-01-01 00:00:00', '2026-01-01 00:00:00');

const progress = (s, stepId, courseId = 'course-a', userId = 'u1') =>
  s.prepare('INSERT INTO step_progress (user_id, course_id, step_id, completed) VALUES (?,?,?,1)').run(userId, courseId, stepId);
const quizResponse = (s, stepId) =>
  s.prepare('INSERT INTO quiz_response (user_id, course_id, step_id, question_id, answer_value) VALUES (?,?,?,?,?)')
    .run('u1', 'course-a', stepId, 'q1', 'a');
const comment = (s, stepId, id = 'lc1') =>
  s.prepare('INSERT INTO lesson_comment (id, user_id, course_id, step_id, content) VALUES (?,?,?,?,?)')
    .run(id, 'u1', 'course-a', stepId, 'hi');
const setAttachments = (s, stepId, raw) =>
  s.prepare('UPDATE course_step SET attachments_json = ? WHERE id = ?').run(raw, stepId);

// ---------------------------------------------------------------- preflight --

test('OPTIONS preflight answers 204', () => {
  assert.equal(onRequestOptions().status, 204);
});

// ------------------------------------------------------------ authorization --

test('section detail: every verb 401s without a user and 403s for a non-admin role', async () => {
  const db = treeDb();
  for (const handler of [onRequestGet, onRequestPut, onRequestDelete]) {
    const anon = await handler(ctx({ db, params: A1, method: 'PUT', body: { title: 'X' }, user: null }));
    assert.equal(anon.status, 401, handler.name);
    const member = await handler(ctx({ db, params: A1, method: 'PUT', body: { title: 'X' }, role: 'member' }));
    assert.equal(member.status, 403, handler.name);
  }
  assert.equal(readSection(db, 'sec-a1').title, 'Section sec-a1', 'no unauthorized write landed');
  db.close();
});

test('section detail: 503 on every verb when the DB binding is absent', async () => {
  for (const handler of [onRequestGet, onRequestPut, onRequestDelete]) {
    const res = await handler(ctx({ db: null, params: A1, body: { title: 'X' } }));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'Server misconfigured');
  }
});

test('section detail: 400 invalid_id for bad course or section path params on every verb', async () => {
  const db = treeDb();
  const bad = [
    {}, { id: 'course-a' }, { id: 123, sectionId: 'sec-a1' },
    { id: 'c'.repeat(101), sectionId: 'sec-a1' },
    { id: 'course-a', sectionId: 9 }, { id: 'course-a', sectionId: 's'.repeat(101) },
  ];
  for (const handler of [onRequestGet, onRequestPut, onRequestDelete]) {
    for (const params of bad) {
      const res = await handler(ctx({ db, params, body: { title: 'X' } }));
      assert.equal(res.status, 400, `${handler.name} ${JSON.stringify(params)}`);
      assert.equal((await res.json()).error, 'invalid_id');
    }
  }
  db.close();
});

// ------------------------------------------------------------------- GET --

test('GET section: returns the section with its steps ordered by sort_order', async () => {
  const db = treeDb();
  const { status, body } = await read(await onRequestGet(ctx({ db, params: A1, method: 'GET' })));
  assert.equal(status, 200);
  assert.equal(body.data.id, 'sec-a1');
  assert.equal(body.data.courseId, 'course-a');
  assert.equal(body.data.title, 'Section sec-a1');
  assert.equal(body.data.sortOrder, 0);
  assert.equal(body.data.createdAt, '2026-01-01 00:00:00');
  assert.equal(body.data.updatedAt, '2026-01-01 00:00:00');
  assert.deepEqual(body.data.steps, [
    { id: 'step-a1', title: 'Step step-a1', type: 'article', sortOrder: 0, status: 'published', streamUid: null, durationSeconds: null },
    { id: 'step-a2', title: 'Step step-a2', type: 'video', sortOrder: 1, status: 'published', streamUid: 'uid-a2', durationSeconds: 120 },
  ]);
  db.close();
});

test('GET section: a section with no steps returns an empty steps array', async () => {
  const db = treeDb({
    extraSeed: (s) => s.prepare("INSERT INTO course_section (id, course_id, title, sort_order) VALUES ('sec-a9','course-a','Empty',9)").run(),
  });
  const { body } = await read(await onRequestGet(ctx({ db, params: { id: 'course-a', sectionId: 'sec-a9' }, method: 'GET' })));
  assert.deepEqual(body.data.steps, []);
  db.close();
});

test('GET section IDOR: sec-b1 is 404 through the course-a path', async () => {
  const db = treeDb();
  const res = await onRequestGet(ctx({ db, params: { id: 'course-a', sectionId: 'sec-b1' }, method: 'GET' }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'section_not_found');
  db.close();
});

test('GET section: 500 when the read throws', async () => {
  const db = treeDb();
  const c = ctx({ db: throwingD1(db, 'FROM course_section WHERE id = ? AND course_id = ?'), params: A1, method: 'GET' });
  const res = await onRequestGet(c);
  assert.equal(res.status, 500);
  assert.ok(c.events.actions().includes('section_get_error'));
  db.close();
});

// ------------------------------------------------------------------- PUT --

test('PUT section: 400 Invalid JSON and Invalid payload', async () => {
  const db = treeDb();
  assert.equal((await onRequestPut(ctx({ db, params: A1, method: 'PUT' }))).status, 400);
  const res = await onRequestPut(ctx({ db, params: A1, method: 'PUT', rawBody: '[]' }));
  assert.equal((await res.json()).error, 'Invalid payload');
  db.close();
});

test('PUT section: immutable keys are refused even when their value is null', async () => {
  const db = treeDb();
  const cases = [
    [{ id: 'sec-x', title: 'T' }, 'cannot_change_id'],
    [{ id: null, title: 'T' }, 'cannot_change_id'],
    [{ course_id: 'course-b', title: 'T' }, 'cannot_change_course_id'],
    [{ courseId: 'course-b', title: 'T' }, 'cannot_change_course_id'],
  ];
  for (const [body, error] of cases) {
    const res = await onRequestPut(ctx({ db, params: A1, method: 'PUT', body }));
    assert.equal(res.status, 400, error);
    assert.equal((await res.json()).error, error);
  }
  assert.equal(readSection(db, 'sec-a1').course_id, 'course-a');
  db.close();
});

test('PUT section: 400 no_fields_provided for an empty body', async () => {
  const db = treeDb();
  const res = await onRequestPut(ctx({ db, params: A1, method: 'PUT', body: {} }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'no_fields_provided');
  db.close();
});

test('PUT section: 400 invalid_title for non-string, blank or over-long titles', async () => {
  const db = treeDb();
  for (const title of [5, '', '   ', 't'.repeat(201)]) {
    const res = await onRequestPut(ctx({ db, params: A1, method: 'PUT', body: { title } }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_title');
  }
  assert.equal(readSection(db, 'sec-a1').title, 'Section sec-a1');
  db.close();
});

test('PUT section: renames the row, trims, stamps updated_at and returns the stored values', async () => {
  const db = treeDb();
  const { status, body } = await read(await onRequestPut(ctx({ db, params: A1, method: 'PUT', body: { title: '  Renamed  ' } })));
  assert.equal(status, 200);
  const row = readSection(db, 'sec-a1');
  assert.equal(row.title, 'Renamed');
  assert.equal(body.data.title, 'Renamed');
  assert.equal(body.data.sortOrder, row.sort_order);
  assert.notEqual(row.updated_at, '2026-01-01 00:00:00');
  db.close();
});

test('PUT section IDOR: renaming sec-b1 through course-a is 404 and course-b keeps its title', async () => {
  const db = treeDb();
  const res = await onRequestPut(ctx({ db, params: { id: 'course-a', sectionId: 'sec-b1' }, method: 'PUT', body: { title: 'Hijacked' } }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'section_not_found');
  assert.equal(readSection(db, 'sec-b1').title, 'Section sec-b1');
  db.close();
});

test('PUT section: 500 when the update throws', async () => {
  const db = treeDb();
  const c = ctx({ db: throwingD1(db, 'UPDATE course_section SET title'), params: A1, method: 'PUT', body: { title: 'X' } });
  const res = await onRequestPut(c);
  assert.equal(res.status, 500);
  assert.ok(c.events.actions().includes('section_update_error'));
  db.close();
});

// ---------------------------------------------------------------- DELETE --

test('DELETE section IDOR: sec-b1 through course-a is 404 and survives', async () => {
  const db = treeDb();
  const res = await onRequestDelete(ctx({ db, params: { id: 'course-a', sectionId: 'sec-b1' }, method: 'DELETE', r2: mockR2() }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'section_not_found');
  assert.ok(readSection(db, 'sec-b1'));
  db.close();
});

test('DELETE section: an empty section is removed without touching the steps branch', async () => {
  const db = treeDb({
    extraSeed: (s) => s.prepare("INSERT INTO course_section (id, course_id, title, sort_order) VALUES ('sec-a9','course-a','Empty',9)").run(),
  });
  const r2 = mockR2();
  const res = await onRequestDelete(ctx({ db, params: { id: 'course-a', sectionId: 'sec-a9' }, method: 'DELETE', r2 }));
  assert.equal(res.status, 200);
  assert.equal(readSection(db, 'sec-a9'), null);
  assert.deepEqual(r2.deleted, []);
  assert.deepEqual(sectionOrder(db, 'course-a').map((r) => r.id), ['sec-a1', 'sec-a2']);
  db.close();
});

test('DELETE section: 409 when one of its steps is a course certificate quiz', async () => {
  const db = treeDb({
    extraSeed: (s) => s.prepare("UPDATE course SET certificate_quiz_step_id = 'step-a1' WHERE id = 'course-b'").run(),
  });
  const { status, body } = await read(await onRequestDelete(ctx({ db, params: A1, method: 'DELETE', r2: mockR2() })));
  assert.equal(status, 409);
  assert.equal(body.error, 'step_referenced_as_certificate_quiz');
  assert.equal(body.courseId, 'course-b');
  assert.ok(readSection(db, 'sec-a1'), 'section survives the refusal');
  assert.ok(readStep(db, 'step-a1'));
  db.close();
});

test('DELETE section: 409 references_exist naming the referenced step, for each learner table', async () => {
  for (const [label, seedRef] of [
    ['step_progress', (s) => progress(s, 'step-a2')],
    ['quiz_response', (s) => quizResponse(s, 'step-a2')],
    ['lesson_comment', (s) => comment(s, 'step-a2')],
  ]) {
    const db = treeDb({ extraSeed: seedRef });
    const { status, body } = await read(await onRequestDelete(ctx({ db, params: A1, method: 'DELETE', r2: mockR2() })));
    assert.equal(status, 409, label);
    assert.equal(body.error, 'references_exist', label);
    assert.deepEqual(body.stepIds, ['step-a2'], label);
    assert.ok(readSection(db, 'sec-a1'), `${label}: section survives`);
    assert.ok(readStep(db, 'step-a1'), `${label}: unreferenced sibling step also survives`);
    db.close();
  }
});

test('DELETE section: removes steps, renditions and the section, then cleans audio + attachment R2 keys', async () => {
  const audioKey = 'courses/audio/step-a1.mp3';
  const attachKey = 'courses/step-a2/deadbeef.pdf';
  const db = treeDb({
    extraSeed(s) {
      rendition(s, 'step-a1', 'audio', JSON.stringify({ r2_key: audioKey }));
      rendition(s, 'step-a1', 'reading', JSON.stringify({ html: '<p>x</p>' }));
      setAttachments(s, 'step-a2', JSON.stringify([
        { name: 'a.pdf', url: R2_PUBLIC_HOST + attachKey },
        { name: 'external', url: 'https://example.com/not-ours.pdf' },
      ]));
    },
  });
  const r2 = mockR2();
  const c = ctx({ db, params: A1, method: 'DELETE', r2 });
  const res = await onRequestDelete(c);
  assert.equal(res.status, 200);
  await drain(c.waitUntil);

  assert.equal(readSection(db, 'sec-a1'), null);
  assert.equal(readStep(db, 'step-a1'), null);
  assert.equal(readStep(db, 'step-a2'), null);
  assert.equal(db._sqlite.prepare("SELECT COUNT(*) c FROM step_rendition WHERE step_id LIKE 'step-a%'").get().c, 0);
  assert.deepEqual(r2.deleted.sort(), [attachKey, audioKey].sort(), 'only R2-hosted urls are deleted');
  assert.ok(readSection(db, 'sec-a2'), 'the sibling section is untouched');
  assert.ok(readStep(db, 'step-b1'), 'course-b is untouched');
  db.close();
});

test('DELETE section: malformed rendition and attachment JSON are skipped, not fatal', async () => {
  const db = treeDb({
    extraSeed(s) {
      rendition(s, 'step-a1', 'audio', 'not-json-at-all');
      rendition(s, 'step-a2', 'audio', JSON.stringify({ voice: 'x' })); // no r2_key
      setAttachments(s, 'step-a1', 'also-not-json');
      setAttachments(s, 'step-a2', JSON.stringify({ notAn: 'array' }));
    },
  });
  const r2 = mockR2();
  const c = ctx({ db, params: A1, method: 'DELETE', r2 });
  const res = await onRequestDelete(c);
  assert.equal(res.status, 200);
  await drain(c.waitUntil);
  assert.equal(readSection(db, 'sec-a1'), null);
  assert.deepEqual(r2.deleted, [], 'nothing parseable to delete');
  db.close();
});

test('DELETE section: attachment entries with a non-string url are skipped', async () => {
  const db = treeDb({
    extraSeed: (s) => setAttachments(s, 'step-a1', JSON.stringify([{ name: 'x', url: 42 }, { name: 'y' }])),
  });
  const r2 = mockR2();
  const c = ctx({ db, params: A1, method: 'DELETE', r2 });
  assert.equal((await onRequestDelete(c)).status, 200);
  await drain(c.waitUntil);
  assert.deepEqual(r2.deleted, []);
  db.close();
});

test('DELETE section: R2 keys are collected but skipped when the R2 binding is absent', async () => {
  const db = treeDb({
    extraSeed: (s) => rendition(s, 'step-a1', 'audio', JSON.stringify({ r2_key: 'courses/audio/orphan.mp3' })),
  });
  const c = ctx({ db, params: A1, method: 'DELETE' }); // no r2 binding at all
  assert.equal((await onRequestDelete(c)).status, 200);
  assert.equal(c.waitUntil.promises.length, 0, 'no R2 work is scheduled without the binding');
  assert.equal(readSection(db, 'sec-a1'), null, 'the D1 delete still completes');
  db.close();
});

test('DELETE section: a failing R2 delete is logged and does not fail the request', async () => {
  const key = 'courses/audio/boom.mp3';
  const db = treeDb({ extraSeed: (s) => rendition(s, 'step-a1', 'audio', JSON.stringify({ r2_key: key })) });
  const c = ctx({ db, params: A1, method: 'DELETE', r2: mockR2({ failDeleteKey: key }) });
  assert.equal((await onRequestDelete(c)).status, 200);
  await drain(c.waitUntil);
  assert.ok(c.events.actions().includes('section_delete_r2_error'));
  db.close();
});

test('DELETE section TOCTOU: a reference landing after the guard refuses the WHOLE delete, destroying nothing', async () => {
  // The ref probe passes, then a learner starts step-a1 in the window before
  // the batch. The batch guard is section-wide, so the refusal covers every
  // step in the section: step-a2 -- which is not referenced and which a
  // per-step guard would have deleted out from under the caller -- is still
  // there when the 409 comes back. A refusal must not be destructive.
  let fired = false;
  const db = treeDb({
    extraSeed: (s) => rendition(s, 'step-a2', 'audio', JSON.stringify({ r2_key: 'courses/audio/a2.mp3' })),
    interleave({ sql, db: raw }) {
      if (!fired && sql.includes('DELETE FROM step_rendition WHERE step_id IN')) {
        fired = true;
        raw.prepare("INSERT INTO step_progress (user_id, course_id, step_id, completed) VALUES ('late','course-a','step-a1',1)").run();
      }
    },
  });
  const r2 = mockR2();
  const c = ctx({ db, params: A1, method: 'DELETE', r2 });
  const { status, body } = await read(await onRequestDelete(c));
  await drain(c.waitUntil);

  assert.ok(fired, 'the scripted concurrent writer actually ran');
  assert.equal(status, 409);
  assert.equal(body.error, 'references_exist');
  assert.deepEqual([...body.stepIds].sort(), ['step-a1', 'step-a2'], 'every step survived, so every step is named');
  assert.ok(readSection(db, 'sec-a1'), 'the section row is NOT deleted');
  assert.ok(readStep(db, 'step-a1'), 'the referenced step survives');
  assert.ok(readStep(db, 'step-a2'), 'the UNREFERENCED sibling survives too: the refusal rolled nothing forward');
  assert.ok(readRendition(db, 'step-a2', 'audio'), "the sibling's rendition row is intact");
  assert.deepEqual(r2.deleted, [], 'no R2 object is deleted on a refusal');

  // And the refusal is retryable rather than terminal: clear the reference and
  // the same request now removes the whole section.
  db._sqlite.prepare("DELETE FROM step_progress WHERE user_id = 'late'").run();
  const retry = ctx({ db, params: A1, method: 'DELETE', r2 });
  assert.equal((await onRequestDelete(retry)).status, 200);
  await drain(retry.waitUntil);
  assert.equal(readSection(db, 'sec-a1'), null);
  assert.equal(readStep(db, 'step-a1'), null);
  assert.equal(readStep(db, 'step-a2'), null);
  assert.deepEqual(r2.deleted, ['courses/audio/a2.mp3'], 'the R2 object goes only once the delete really happens');
  db.close();
});

test('DELETE section TOCTOU: a reference landing on the LAST step refuses the whole delete too', async () => {
  // Order-independence of the section-wide guard: the engine may visit rows in
  // either order, and the referenced row is the one the guard never deletes, so
  // the predicate cannot flip mid-statement whichever row it reaches first.
  let fired = false;
  const db = treeDb({
    interleave({ sql, db: raw }) {
      if (!fired && sql.includes('DELETE FROM step_rendition WHERE step_id IN')) {
        fired = true;
        raw.prepare("INSERT INTO lesson_comment (id, user_id, course_id, step_id, content) VALUES ('lc1','late','course-a','step-a2','hi')").run();
      }
    },
  });
  const c = ctx({ db, params: A1, method: 'DELETE', r2: mockR2() });
  const { status, body } = await read(await onRequestDelete(c));

  assert.ok(fired);
  assert.equal(status, 409);
  assert.equal(body.error, 'references_exist');
  assert.ok(readStep(db, 'step-a1'), 'the unreferenced FIRST step survives');
  assert.ok(readStep(db, 'step-a2'), 'the referenced last step survives');
  assert.ok(readSection(db, 'sec-a1'));
  db.close();
});

test('DELETE section: 500 when the reference probe throws', async () => {
  const db = treeDb();
  const c = ctx({ db: throwingD1(db, 'FROM step_progress WHERE step_id IN'), params: A1, method: 'DELETE', r2: mockR2() });
  const res = await onRequestDelete(c);
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'Internal error');
  assert.ok(c.events.actions().includes('section_delete_error'));
  assert.ok(readSection(db, 'sec-a1'), 'nothing was deleted');
  db.close();
});
