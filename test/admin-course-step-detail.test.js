/**
 * functions/api/admin/courses/[id]/steps/[stepId].js  (GET, PUT, DELETE)
 *
 * The deepest node of the course-structure tree. Two things are load-bearing
 * here and are asserted against the real engine rather than against SQL text:
 *
 *   OWNERSHIP - every verb scopes its lookup `WHERE id = ? AND course_id = ?`,
 *               so step-b1 must be unreadable, unwritable and undeletable
 *               through the course-a path parameter.
 *   DELETE    - a guarded batch refuses any step a learner has touched, then
 *               cleans the audio rendition and attachment objects out of R2.
 *               Both the refusal and the cleanup are checked by reading rows
 *               back and by inspecting what the R2 stub was actually asked for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  treeDb, ctx, read, throwingD1, mockR2, drain, readStep, R2_PUBLIC_HOST,
} from './_course-structure-fixtures.mjs';
import {
  onRequestOptions, onRequestGet, onRequestPut, onRequestDelete,
} from '../functions/api/admin/courses/[id]/steps/[stepId].js';

const A1 = { id: 'course-a', stepId: 'step-a1' };
const A2 = { id: 'course-a', stepId: 'step-a2' };

const rendition = (s, stepId, format, contentJson) =>
  s.prepare(`INSERT INTO step_rendition (step_id, format, content_json, status, created_at, updated_at)
             VALUES (?,?,?,'published','2026-01-01 00:00:00','2026-01-01 00:00:00')`)
    .run(stepId, format, contentJson);
const progress = (s, stepId, userId) =>
  s.prepare('INSERT INTO step_progress (user_id, course_id, step_id, completed) VALUES (?,?,?,1)').run(userId, 'course-a', stepId);
const quizResponse = (s, stepId) =>
  s.prepare('INSERT INTO quiz_response (user_id, course_id, step_id, question_id, answer_value) VALUES (?,?,?,?,?)')
    .run('u1', 'course-a', stepId, 'q1', 'a');
const comment = (s, stepId, id = 'lc1') =>
  s.prepare('INSERT INTO lesson_comment (id, user_id, course_id, step_id, content) VALUES (?,?,?,?,?)')
    .run(id, 'u1', 'course-a', stepId, 'hi');
const setAttachments = (s, stepId, raw) =>
  s.prepare('UPDATE course_step SET attachments_json = ? WHERE id = ?').run(raw, stepId);

const put = (db, body, params = A1, opts = {}) => onRequestPut(ctx({ db, params, method: 'PUT', body, ...opts }));

// ---------------------------------------------------------------- preflight --

test('OPTIONS preflight answers 204', () => {
  assert.equal(onRequestOptions().status, 204);
});

// ------------------------------------------------------------ authorization --

test('step detail: every verb 401s without a user and 403s for a non-admin role', async () => {
  const db = treeDb();
  for (const handler of [onRequestGet, onRequestPut, onRequestDelete]) {
    assert.equal((await handler(ctx({ db, params: A1, body: { title: 'X' }, user: null, r2: mockR2() }))).status, 401, handler.name);
    assert.equal((await handler(ctx({ db, params: A1, body: { title: 'X' }, role: 'member', r2: mockR2() }))).status, 403, handler.name);
  }
  assert.equal(readStep(db, 'step-a1').title, 'Step step-a1', 'no unauthorized write landed');
  db.close();
});

test('step detail: superadmin passes the guard on the read path', async () => {
  const db = treeDb();
  assert.equal((await onRequestGet(ctx({ db, params: A1, method: 'GET', role: 'superadmin' }))).status, 200);
  db.close();
});

test('step detail: 503 on every verb without a DB binding', async () => {
  for (const handler of [onRequestGet, onRequestPut, onRequestDelete]) {
    assert.equal((await handler(ctx({ db: null, params: A1, body: {} }))).status, 503, handler.name);
  }
});

test('step detail: 400 invalid_id for bad course or step path params on every verb', async () => {
  const db = treeDb();
  const bad = [
    {}, { id: 'course-a' }, { id: 4, stepId: 'step-a1' }, { id: 'c'.repeat(101), stepId: 'step-a1' },
    { id: 'course-a', stepId: 4 }, { id: 'course-a', stepId: 's'.repeat(101) },
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

test('GET step: returns the mapped step, omitting null stream uid, duration and attachments', async () => {
  const db = treeDb();
  const { status, body } = await read(await onRequestGet(ctx({ db, params: A1, method: 'GET' })));
  assert.equal(status, 200);
  assert.deepEqual(body.data, {
    id: 'step-a1', courseId: 'course-a', sectionId: 'sec-a1', title: 'Step step-a1',
    type: 'article', sortOrder: 0, status: 'published',
    createdAt: '2026-01-01 00:00:00', updatedAt: '2026-01-01 00:00:00',
  });
  db.close();
});

test('GET step: a video step carries streamUid, duration and parsed attachments', async () => {
  const attachments = [{ name: 'a.pdf', url: 'https://example.com/a.pdf' }];
  const db = treeDb({ extraSeed: (s) => setAttachments(s, 'step-a2', JSON.stringify(attachments)) });
  const { body } = await read(await onRequestGet(ctx({ db, params: A2, method: 'GET' })));
  assert.equal(body.data.streamUid, 'uid-a2');
  assert.equal(body.data.duration, 120);
  assert.deepEqual(body.data.attachments, attachments);
  db.close();
});

test('GET step: a stored attachments array that is empty or malformed is omitted', async () => {
  for (const raw of ['[]', '{"not":"an array"}', 'garbage']) {
    const db = treeDb({ extraSeed: (s) => setAttachments(s, 'step-a1', raw) });
    const { body } = await read(await onRequestGet(ctx({ db, params: A1, method: 'GET' })));
    assert.equal('attachments' in body.data, false, raw);
    db.close();
  }
});

test('GET step IDOR: step-b1 is 404 through the course-a path', async () => {
  const db = treeDb();
  const res = await onRequestGet(ctx({ db, params: { id: 'course-a', stepId: 'step-b1' }, method: 'GET' }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'step_not_found');
  db.close();
});

test('GET step: 500 when the read throws', async () => {
  const db = treeDb();
  const c = ctx({ db: throwingD1(db, 'FROM course_step WHERE id = ? AND course_id = ?'), params: A1, method: 'GET' });
  assert.equal((await onRequestGet(c)).status, 500);
  assert.ok(c.events.actions().includes('step_get_error'));
  db.close();
});

// ------------------------------------------------------------------- PUT --

test('PUT step: 400 Invalid JSON and Invalid payload', async () => {
  const db = treeDb();
  assert.equal((await onRequestPut(ctx({ db, params: A1, method: 'PUT' }))).status, 400);
  const res = await onRequestPut(ctx({ db, params: A1, method: 'PUT', rawBody: '["a"]' }));
  assert.equal((await res.json()).error, 'Invalid payload');
  db.close();
});

test('PUT step: identity keys are immutable, including when sent as null', async () => {
  const db = treeDb();
  const cases = [
    [{ id: 'other' }, 'cannot_change_id'],
    [{ id: null }, 'cannot_change_id'],
    [{ course_id: 'course-b' }, 'cannot_change_course_id'],
    [{ courseId: 'course-b' }, 'cannot_change_course_id'],
    [{ section_id: 'sec-b1' }, 'cannot_change_section_id'],
    [{ sectionId: 'sec-b1' }, 'cannot_change_section_id'],
  ];
  for (const [body, error] of cases) {
    const res = await put(db, body);
    assert.equal(res.status, 400, error);
    assert.equal((await res.json()).error, error);
  }
  const row = readStep(db, 'step-a1');
  assert.equal(row.course_id, 'course-a');
  assert.equal(row.section_id, 'sec-a1');
  db.close();
});

test('PUT step: 400 for every rejected field value', async () => {
  const db = treeDb();
  const cases = [
    [{ title: 9 }, 'invalid_title'],
    [{ title: '   ' }, 'invalid_title'],
    [{ title: 't'.repeat(201) }, 'invalid_title'],
    [{ type: 'podcast' }, 'invalid_type'],
    [{ status: 'live' }, 'invalid_status'],
    [{ duration: 2.5 }, 'invalid_duration'],
    [{ duration: -3 }, 'invalid_duration'],
    [{ duration: 90000 }, 'invalid_duration'],
    [{ attachments: 'nope' }, 'invalid_attachments'],
    [{ attachments: [{ name: 'a', url: 'mailto:x@y.test' }] }, 'invalid_attachments'],
  ];
  for (const [body, error] of cases) {
    const res = await put(db, body);
    assert.equal(res.status, 400, error);
    assert.equal((await res.json()).error, error, JSON.stringify(body));
  }
  db.close();
});

test('PUT step IDOR: step-b1 cannot be renamed through the course-a path', async () => {
  const db = treeDb();
  const res = await put(db, { title: 'Hijacked' }, { id: 'course-a', stepId: 'step-b1' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'step_not_found');
  assert.equal(readStep(db, 'step-b1').title, 'Step step-b1');
  db.close();
});

test('PUT step: a body with no updatable field returns the row unchanged', async () => {
  const db = treeDb();
  const { status, body } = await read(await put(db, {}));
  assert.equal(status, 200);
  assert.equal(body.data.title, 'Step step-a1');
  assert.equal(readStep(db, 'step-a1').updated_at, '2026-01-01 00:00:00', 'no write, so no timestamp bump');
  db.close();
});

test('PUT step: an empty body on a video step keeps its existing stream uid', async () => {
  const db = treeDb();
  const { status, body } = await read(await put(db, {}, A2));
  assert.equal(status, 200);
  assert.equal(body.data.streamUid, 'uid-a2');
  db.close();
});

test('PUT step: renames and persists the trimmed title', async () => {
  const db = treeDb();
  const { body } = await read(await put(db, { title: '  Renamed  ' }));
  const row = readStep(db, 'step-a1');
  assert.equal(row.title, 'Renamed');
  assert.equal(body.data.title, 'Renamed');
  assert.notEqual(row.updated_at, '2026-01-01 00:00:00');
  db.close();
});

test('PUT step: stream_uid_required_for_video for every way the uid can be missing or oversized', async () => {
  const db = treeDb();
  // article -> video with no uid at all
  assert.equal((await (await put(db, { type: 'video' })).json()).error, 'stream_uid_required_for_video');
  // article -> video with a blank uid
  assert.equal((await (await put(db, { type: 'video', streamUid: '  ' })).json()).error, 'stream_uid_required_for_video');
  // existing video, uid replaced by a blank
  assert.equal((await (await put(db, { streamUid: '' }, A2)).json()).error, 'stream_uid_required_for_video');
  // existing video, uid replaced by an over-long value
  assert.equal((await (await put(db, { streamUid: 'u'.repeat(65) }, A2)).json()).error, 'stream_uid_required_for_video');
  assert.equal(readStep(db, 'step-a1').type, 'article', 'nothing was written');
  assert.equal(readStep(db, 'step-a2').stream_uid, 'uid-a2');
  db.close();
});

test('PUT step: stream_uid_only_for_video when a uid is sent for a non-video step', async () => {
  const db = treeDb();
  const res = await put(db, { streamUid: 'uid-x' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'stream_uid_only_for_video');
  assert.equal(readStep(db, 'step-a1').stream_uid, null);
  db.close();
});

test('PUT step: converting a video to an article clears stream_uid', async () => {
  const db = treeDb();
  const { status, body } = await read(await put(db, { type: 'article' }, A2));
  assert.equal(status, 200);
  assert.equal(readStep(db, 'step-a2').stream_uid, null);
  assert.equal(readStep(db, 'step-a2').type, 'article');
  assert.equal('streamUid' in body.data, false);
  db.close();
});

test('PUT step: re-asserting type video without a uid keeps the existing one', async () => {
  const db = treeDb();
  const { body } = await read(await put(db, { type: 'video', title: 'Still video' }, A2));
  assert.equal(body.data.streamUid, 'uid-a2');
  assert.equal(readStep(db, 'step-a2').stream_uid, 'uid-a2');
  db.close();
});

test('PUT step: a new uid on a video step is stored trimmed', async () => {
  const db = treeDb();
  await put(db, { type: 'video', streamUid: '  uid-replaced  ' }, A2);
  assert.equal(readStep(db, 'step-a2').stream_uid, 'uid-replaced');
  await put(db, { streamUid: '  uid-again  ' }, A2);
  assert.equal(readStep(db, 'step-a2').stream_uid, 'uid-again', 'uid alone, no type, also trims');
  db.close();
});

test('PUT step: an explicit null stream uid on a non-video step writes null', async () => {
  const db = treeDb();
  const res = await put(db, { streamUid: null });
  assert.equal(res.status, 200);
  assert.equal(readStep(db, 'step-a1').stream_uid, null);
  db.close();
});

test('PUT step: duration and attachments round-trip, and null clears both', async () => {
  const db = treeDb();
  const attachments = [{ name: 'handout.pdf', url: 'https://example.com/handout.pdf' }];
  const { body } = await read(await put(db, { duration: 45, attachments }));
  assert.equal(readStep(db, 'step-a1').duration_seconds, 45);
  assert.deepEqual(JSON.parse(readStep(db, 'step-a1').attachments_json), attachments);
  assert.deepEqual(body.data.attachments, attachments);

  await put(db, { duration: null, attachments: null });
  assert.equal(readStep(db, 'step-a1').duration_seconds, null);
  assert.equal(readStep(db, 'step-a1').attachments_json, null);
  db.close();
});

test('PUT step: status transitions are persisted', async () => {
  const db = treeDb();
  await put(db, { status: 'draft' });
  assert.equal(readStep(db, 'step-a1').status, 'draft');
  await put(db, { status: 'archived' });
  assert.equal(readStep(db, 'step-a1').status, 'archived');
  db.close();
});

test('PUT step: 409 when drafting or archiving a step a course uses as its certificate quiz', async () => {
  for (const status of ['draft', 'archived']) {
    const db = treeDb({
      extraSeed: (s) => s.prepare("UPDATE course SET certificate_quiz_step_id = 'step-a3' WHERE id = 'course-a'").run(),
    });
    const { status: code, body } = await read(await put(db, { status }, { id: 'course-a', stepId: 'step-a3' }));
    assert.equal(code, 409, status);
    assert.equal(body.error, 'step_referenced_as_certificate_quiz');
    assert.equal(body.courseId, 'course-a');
    assert.equal(readStep(db, 'step-a3').status, 'published', 'the step keeps its published status');
    db.close();
  }
});

test('PUT step: publishing a certificate-quiz step is allowed', async () => {
  const db = treeDb({
    extraSeed: (s) => s.prepare("UPDATE course SET certificate_quiz_step_id = 'step-a3' WHERE id = 'course-a'").run(),
  });
  const res = await put(db, { status: 'published' }, { id: 'course-a', stepId: 'step-a3' });
  assert.equal(res.status, 200);
  db.close();
});

test('PUT step: 409 when converting a certificate-quiz step away from type quiz', async () => {
  const db = treeDb({
    extraSeed: (s) => s.prepare("UPDATE course SET certificate_quiz_step_id = 'step-a3' WHERE id = 'course-a'").run(),
  });
  const { status, body } = await read(await put(db, { type: 'article' }, { id: 'course-a', stepId: 'step-a3' }));
  assert.equal(status, 409);
  assert.equal(body.error, 'step_referenced_as_certificate_quiz');
  assert.equal(readStep(db, 'step-a3').type, 'quiz');
  db.close();
});

test('PUT step: converting a NON-certificate quiz step away from quiz is allowed', async () => {
  const db = treeDb();
  const res = await put(db, { type: 'article' }, { id: 'course-a', stepId: 'step-a3' });
  assert.equal(res.status, 200);
  assert.equal(readStep(db, 'step-a3').type, 'article');
  db.close();
});

test('PUT step: 500 when the update throws', async () => {
  const db = treeDb();
  const c = ctx({ db: throwingD1(db, 'UPDATE course_step SET'), params: A1, method: 'PUT', body: { title: 'X' } });
  assert.equal((await onRequestPut(c)).status, 500);
  assert.ok(c.events.actions().includes('step_update_error'));
  assert.equal(readStep(db, 'step-a1').title, 'Step step-a1');
  db.close();
});

// ---------------------------------------------------------------- DELETE --

test('DELETE step IDOR: step-b1 through the course-a path is 404 and survives', async () => {
  const db = treeDb();
  const res = await onRequestDelete(ctx({ db, params: { id: 'course-a', stepId: 'step-b1' }, method: 'DELETE', r2: mockR2() }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'step_not_found');
  assert.ok(readStep(db, 'step-b1'));
  db.close();
});

test('DELETE step: removes the row and its renditions, leaving siblings alone', async () => {
  const db = treeDb({
    extraSeed(s) {
      rendition(s, 'step-a1', 'reading', JSON.stringify({ html: '<p>x</p>' }));
      rendition(s, 'step-a2', 'reading', JSON.stringify({ html: '<p>y</p>' }));
    },
  });
  const r2 = mockR2();
  const c = ctx({ db, params: A1, method: 'DELETE', r2 });
  assert.equal((await onRequestDelete(c)).status, 200);
  await drain(c.waitUntil);
  assert.equal(readStep(db, 'step-a1'), null);
  assert.equal(db._sqlite.prepare("SELECT COUNT(*) c FROM step_rendition WHERE step_id='step-a1'").get().c, 0);
  assert.equal(db._sqlite.prepare("SELECT COUNT(*) c FROM step_rendition WHERE step_id='step-a2'").get().c, 1);
  assert.ok(readStep(db, 'step-a2'));
  assert.deepEqual(r2.deleted, []);
  db.close();
});

test('DELETE step: 409 when the step is a course certificate quiz', async () => {
  const db = treeDb({
    extraSeed: (s) => s.prepare("UPDATE course SET certificate_quiz_step_id = 'step-a1' WHERE id = 'course-b'").run(),
  });
  const { status, body } = await read(await onRequestDelete(ctx({ db, params: A1, method: 'DELETE', r2: mockR2() })));
  assert.equal(status, 409);
  assert.equal(body.error, 'step_referenced_as_certificate_quiz');
  assert.equal(body.courseId, 'course-b');
  assert.ok(readStep(db, 'step-a1'));
  db.close();
});

test('DELETE step: 409 references_exist naming each referencing table with its row count', async () => {
  const db = treeDb({
    extraSeed(s) {
      progress(s, 'step-a1', 'u1');
      progress(s, 'step-a1', 'u2');
      quizResponse(s, 'step-a1');
      comment(s, 'step-a1');
      comment(s, 'step-a1', 'lc2');
    },
  });
  const { status, body } = await read(await onRequestDelete(ctx({ db, params: A1, method: 'DELETE', r2: mockR2() })));
  assert.equal(status, 409);
  assert.equal(body.error, 'references_exist');
  assert.deepEqual(body.tables, ['step_progress', 'quiz_response', 'lesson_comment']);
  assert.deepEqual(body.counts, { step_progress: 2, quiz_response: 1, lesson_comment: 2 });
  assert.ok(readStep(db, 'step-a1'), 'the step survives the refusal');
  db.close();
});

test('DELETE step: a refused delete leaves the renditions in place', async () => {
  const db = treeDb({
    extraSeed(s) {
      progress(s, 'step-a1', 'u1');
      rendition(s, 'step-a1', 'reading', JSON.stringify({ html: '<p>x</p>' }));
    },
  });
  const res = await onRequestDelete(ctx({ db, params: A1, method: 'DELETE', r2: mockR2() }));
  assert.equal(res.status, 409);
  assert.equal(db._sqlite.prepare("SELECT COUNT(*) c FROM step_rendition WHERE step_id='step-a1'").get().c, 1);
  db.close();
});

test('DELETE step: only the quiz_response reference is reported when it is the only one', async () => {
  const db = treeDb({ extraSeed: (s) => quizResponse(s, 'step-a1') });
  const { body } = await read(await onRequestDelete(ctx({ db, params: A1, method: 'DELETE', r2: mockR2() })));
  assert.deepEqual(body.tables, ['quiz_response']);
  assert.deepEqual(body.counts, { quiz_response: 1 });
  db.close();
});

test('DELETE step TOCTOU: a row that vanishes between the lookup and the batch answers 404, not 409', async () => {
  let fired = false;
  const db = treeDb({
    interleave({ sql, db: raw }) {
      if (!fired && sql.startsWith('DELETE FROM course_step WHERE id = ?')) {
        fired = true;
        raw.prepare("DELETE FROM course_step WHERE id = 'step-a1'").run();
      }
    },
  });
  const res = await onRequestDelete(ctx({ db, params: A1, method: 'DELETE', r2: mockR2() }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'step_not_found');
  db.close();
});

test('DELETE step: the audio rendition R2 object is deleted, awaited inline', async () => {
  const key = 'courses/audio/step-a1.mp3';
  const db = treeDb({ extraSeed: (s) => rendition(s, 'step-a1', 'audio', JSON.stringify({ r2_key: key })) });
  const r2 = mockR2();
  const c = ctx({ db, params: A1, method: 'DELETE', r2 });
  assert.equal((await onRequestDelete(c)).status, 200);
  assert.deepEqual(r2.deleted, [key], 'awaited before the response, not deferred');
  db.close();
});

test('DELETE step: a failing audio R2 delete is logged and the request still succeeds', async () => {
  const key = 'courses/audio/step-a1.mp3';
  const db = treeDb({ extraSeed: (s) => rendition(s, 'step-a1', 'audio', JSON.stringify({ r2_key: key })) });
  const c = ctx({ db, params: A1, method: 'DELETE', r2: mockR2({ failDeleteKey: key }) });
  assert.equal((await onRequestDelete(c)).status, 200);
  assert.ok(c.events.actions().includes('step_delete_r2_error'));
  assert.equal(readStep(db, 'step-a1'), null, 'the D1 delete still stands');
  db.close();
});

test('DELETE step: malformed or key-less audio content_json yields no R2 delete', async () => {
  for (const contentJson of ['not-json', JSON.stringify({ voice: 'x' })]) {
    const db = treeDb({ extraSeed: (s) => rendition(s, 'step-a1', 'audio', contentJson) });
    const r2 = mockR2();
    const c = ctx({ db, params: A1, method: 'DELETE', r2 });
    assert.equal((await onRequestDelete(c)).status, 200);
    await drain(c.waitUntil);
    assert.deepEqual(r2.deleted, [], contentJson);
    db.close();
  }
});

test('DELETE step: R2-hosted attachments are cleaned and foreign urls are left alone', async () => {
  const key = 'courses/step-a1/abc123.pdf';
  const db = treeDb({
    extraSeed: (s) => setAttachments(s, 'step-a1', JSON.stringify([
      { name: 'ours.pdf', url: R2_PUBLIC_HOST + key },
      { name: 'theirs.pdf', url: 'https://example.com/theirs.pdf' },
      { name: 'no url' },
    ])),
  });
  const r2 = mockR2();
  const c = ctx({ db, params: A1, method: 'DELETE', r2 });
  assert.equal((await onRequestDelete(c)).status, 200);
  await drain(c.waitUntil);
  assert.deepEqual(r2.deleted, [key]);
  db.close();
});

test('DELETE step: a failing attachment R2 delete is logged, not thrown', async () => {
  const key = 'courses/step-a1/abc123.pdf';
  const db = treeDb({
    extraSeed: (s) => setAttachments(s, 'step-a1', JSON.stringify([{ name: 'ours.pdf', url: R2_PUBLIC_HOST + key }])),
  });
  const c = ctx({ db, params: A1, method: 'DELETE', r2: mockR2({ failDeleteKey: key }) });
  assert.equal((await onRequestDelete(c)).status, 200);
  await drain(c.waitUntil);
  assert.ok(c.events.actions().includes('step_delete_r2_error'));
  db.close();
});

test('DELETE step: attachments_json that is empty, foreign-only or malformed schedules no R2 work', async () => {
  for (const raw of ['[]', '{"a":1}', 'garbage', JSON.stringify([{ name: 'x', url: 'https://example.com/x.pdf' }])]) {
    const db = treeDb({ extraSeed: (s) => setAttachments(s, 'step-a1', raw) });
    const r2 = mockR2();
    const c = ctx({ db, params: A1, method: 'DELETE', r2 });
    assert.equal((await onRequestDelete(c)).status, 200, raw);
    await drain(c.waitUntil);
    assert.deepEqual(r2.deleted, [], raw);
    db.close();
  }
});

test('DELETE step: without an R2 binding the D1 delete still completes and nothing is scheduled', async () => {
  const key = 'courses/step-a1/abc123.pdf';
  const db = treeDb({
    extraSeed(s) {
      rendition(s, 'step-a1', 'audio', JSON.stringify({ r2_key: 'courses/audio/step-a1.mp3' }));
      setAttachments(s, 'step-a1', JSON.stringify([{ name: 'ours.pdf', url: R2_PUBLIC_HOST + key }]));
    },
  });
  const c = ctx({ db, params: A1, method: 'DELETE' });
  assert.equal((await onRequestDelete(c)).status, 200);
  assert.equal(c.waitUntil.promises.length, 0);
  assert.equal(readStep(db, 'step-a1'), null);
  db.close();
});

test('DELETE step: 500 when the ownership lookup throws', async () => {
  const db = treeDb();
  const c = ctx({
    db: throwingD1(db, 'SELECT id, attachments_json FROM course_step'),
    params: A1, method: 'DELETE', r2: mockR2(),
  });
  assert.equal((await onRequestDelete(c)).status, 500);
  assert.ok(c.events.actions().includes('step_delete_error'));
  assert.ok(readStep(db, 'step-a1'));
  db.close();
});
