/**
 * functions/api/admin/courses/[id]/attachments.js  (POST upload, DELETE remove)
 *
 * The only handler in the course-structure tree that writes to R2, so three
 * things are asserted beyond the usual guard/validation/mutation set:
 *
 *   KEY SAFETY - the storage key is `courses/<stepId>/<uuid>.<ext>`. The only
 *                caller-supplied component is stepId, which is pattern-locked,
 *                so no request can steer the key out of its prefix or onto
 *                another course's object. The display name never reaches it.
 *   ROLLBACK   - when the D1 write fails after the R2 put succeeded, the
 *                handler deletes the just-written object. Pinned here as a
 *                rollback (no orphan), because the opposite choice would be
 *                just as plausible and callers depend on knowing which it is.
 *   OWNERSHIP  - the step must belong to the course in the path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  treeDb, ctx, read, throwingD1, mockR2, drain, mockFile, formRequest,
  attachmentsOf, readStep, R2_PUBLIC_HOST,
} from './_course-structure-fixtures.mjs';
import {
  onRequestOptions, onRequestPost, onRequestDelete,
} from '../functions/api/admin/courses/[id]/attachments.js';

const P = { id: 'course-a' };
const KEY_RE = /^courses\/step-a1\/[0-9a-f]{32}\.pdf$/;

const setAttachments = (s, stepId, raw) =>
  s.prepare('UPDATE course_step SET attachments_json = ? WHERE id = ?').run(raw, stepId);

function upload(db, fields = {}, opts = {}) {
  const request = formRequest({ stepId: 'step-a1', file: mockFile(), ...fields }, opts.requestOpts);
  return onRequestPost(ctx({ db, params: opts.params ?? P, request, r2: opts.r2 ?? mockR2(), ...opts.ctx }));
}

// ---------------------------------------------------------------- preflight --

test('OPTIONS preflight answers 204', () => {
  assert.equal(onRequestOptions().status, 204);
});

// ------------------------------------------------------------ authorization --

test('POST attachment: 401 anonymous and 403 non-admin, with no R2 write', async () => {
  const db = treeDb();
  const r2 = mockR2();
  assert.equal((await upload(db, {}, { r2, ctx: { user: null } })).status, 401);
  assert.equal((await upload(db, {}, { r2, ctx: { role: 'member' } })).status, 403);
  assert.deepEqual(r2.puts, []);
  assert.equal(attachmentsOf(db, 'step-a1'), null);
  db.close();
});

test('DELETE attachment: 401 anonymous and 403 non-admin', async () => {
  const db = treeDb();
  const body = { stepId: 'step-a1', url: `${R2_PUBLIC_HOST}courses/step-a1/x.pdf` };
  assert.equal((await onRequestDelete(ctx({ db, params: P, method: 'DELETE', body, r2: mockR2(), user: null }))).status, 401);
  assert.equal((await onRequestDelete(ctx({ db, params: P, method: 'DELETE', body, r2: mockR2(), role: 'member' }))).status, 403);
  db.close();
});

test('POST attachment: superadmin passes the guard', async () => {
  const db = treeDb();
  assert.equal((await upload(db, {}, { ctx: { role: 'superadmin' } })).status, 201);
  db.close();
});

// -------------------------------------------------------------- misconfigured --

test('attachments: 503 server_misconfigured when either the DB or the R2 binding is missing', async () => {
  const db = treeDb();
  const noDb = await onRequestPost(ctx({ db: null, params: P, request: formRequest({}), r2: mockR2() }));
  assert.equal(noDb.status, 503);
  assert.equal((await noDb.json()).error, 'server_misconfigured');

  const noR2 = await onRequestPost(ctx({ db, params: P, request: formRequest({}) }));
  assert.equal(noR2.status, 503);
  assert.equal((await noR2.json()).error, 'server_misconfigured');

  const body = { stepId: 'step-a1', url: 'https://x.test/a' };
  assert.equal((await onRequestDelete(ctx({ db: null, params: P, method: 'DELETE', body, r2: mockR2() }))).status, 503);
  assert.equal((await onRequestDelete(ctx({ db, params: P, method: 'DELETE', body }))).status, 503);
  db.close();
});

// ----------------------------------------------------------- input validation --

test('attachments: 400 invalid_id for a bad course path param on both verbs', async () => {
  const db = treeDb();
  for (const params of [{}, { id: 6 }, { id: 'c'.repeat(101) }]) {
    const post = await upload(db, {}, { params });
    assert.equal((await post.json()).error, 'invalid_id');
    const del = await onRequestDelete(ctx({ db, params, method: 'DELETE', body: { stepId: 'step-a1', url: 'https://x.test/a' }, r2: mockR2() }));
    assert.equal((await del.json()).error, 'invalid_id');
  }
  db.close();
});

test('POST attachment: 400 invalid_form_data when the body is not multipart', async () => {
  const db = treeDb();
  const res = await upload(db, {}, { requestOpts: { throwOnFormData: true } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_form_data');
  db.close();
});

test('POST attachment: 400 invalid_step_id, including the path-traversal attempt', async () => {
  const db = treeDb();
  const bad = [null, '', '   ', 's'.repeat(101), '../../secrets', 'step/a1', 'Step-A1', '1step', 'step_a1'];
  for (const stepId of bad) {
    const res = await upload(db, { stepId });
    assert.equal(res.status, 400, JSON.stringify(stepId));
    assert.equal((await res.json()).error, 'invalid_step_id', JSON.stringify(stepId));
  }
  db.close();
});

test('POST attachment: 400 file_required when the file part is missing or empty', async () => {
  const db = treeDb();
  for (const file of [null, mockFile({ size: 0 })]) {
    const res = await upload(db, { file });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'file_required');
  }
  db.close();
});

test('POST attachment: 400 file_too_large just over the 25MB cap, accepted just under it', async () => {
  const db = treeDb();
  const over = await upload(db, { file: mockFile({ size: 25 * 1024 * 1024 + 1 }) });
  assert.equal(over.status, 400);
  assert.equal((await over.json()).error, 'file_too_large');

  const at = await upload(db, { file: mockFile({ size: 25 * 1024 * 1024 }) });
  assert.equal(at.status, 201, 'exactly at the cap is allowed');
  db.close();
});

test('POST attachment: 400 unsupported_file_type for anything outside the allow-list', async () => {
  const db = treeDb();
  for (const type of ['application/zip', 'text/html', 'image/svg+xml', 'application/x-msdownload', '']) {
    const res = await upload(db, { file: mockFile({ type }) });
    assert.equal(res.status, 400, type);
    assert.equal((await res.json()).error, 'unsupported_file_type', type);
  }
  db.close();
});

test('POST attachment: each allowed content type maps to its own extension', async () => {
  const cases = [
    ['application/pdf', 'pdf'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
  ];
  for (const [type, ext] of cases) {
    const db = treeDb();
    const r2 = mockR2();
    const { status, body } = await read(await upload(db, { file: mockFile({ type }) }, { r2 }));
    assert.equal(status, 201, type);
    assert.match(body.data.url, new RegExp(`^${R2_PUBLIC_HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}courses/step-a1/[0-9a-f]{32}\\.${ext}$`), type);
    assert.equal(r2.puts[0].contentType, type, 'the R2 object records its content type');
    db.close();
  }
});

test('POST attachment: 400 invalid_name for a non-string, empty-after-sanitising or over-long name', async () => {
  const db = treeDb();
  const nonString = await upload(db, { name: mockFile() });
  assert.equal((await nonString.json()).error, 'invalid_name');

  for (const name of ['///', '\\\\', '\u0000\u0007', '   ']) {
    // '   ' is falsy-after-trim only via sanitizeName, and an all-separator
    // name sanitises to the empty string.
    const res = await upload(db, { name });
    assert.equal(res.status, 400, JSON.stringify(name));
    assert.equal((await res.json()).error, 'invalid_name', JSON.stringify(name));
  }

  const tooLong = await upload(db, { name: 'n'.repeat(201) });
  assert.equal((await tooLong.json()).error, 'invalid_name');
  db.close();
});

test('POST attachment: the display name is sanitised of separators and control characters', async () => {
  const db = treeDb();
  const { body } = await read(await upload(db, { name: '  ../../etc/pass\u0001wd.pdf  ' }));
  assert.equal(body.data.name, '....etcpasswd.pdf', 'slashes and control chars are stripped, then trimmed');
  assert.match(body.data.url.slice(R2_PUBLIC_HOST.length), KEY_RE, 'the sanitised name never reaches the storage key');
  db.close();
});

test("POST attachment: the name falls back to the file's own name, then to 'attachment'", async () => {
  const db = treeDb();
  const fromFile = await read(await upload(db, { file: mockFile({ name: 'lecture.pdf' }) }));
  assert.equal(fromFile.body.data.name, 'lecture.pdf');

  const fallback = await read(await upload(db, { file: mockFile({ name: '' }) }));
  assert.equal(fallback.body.data.name, 'attachment');
  db.close();
});

// -------------------------------------------------------------- not-found --

test('POST attachment: 404 course_not_found and 404 step_not_found', async () => {
  const db = treeDb();
  const noCourse = await upload(db, {}, { params: { id: 'course-zz' } });
  assert.equal(noCourse.status, 404);
  assert.equal((await noCourse.json()).error, 'course_not_found');

  const noStep = await upload(db, { stepId: 'step-zz' });
  assert.equal(noStep.status, 404);
  assert.equal((await noStep.json()).error, 'step_not_found');
  db.close();
});

test('POST attachment IDOR: step-b1 cannot receive an upload through the course-a path', async () => {
  const db = treeDb();
  const r2 = mockR2();
  const res = await upload(db, { stepId: 'step-b1' }, { r2 });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'step_not_found');
  assert.deepEqual(r2.puts, [], 'nothing was written to R2 for another course');
  assert.equal(attachmentsOf(db, 'step-b1'), null);
  db.close();
});

test('POST attachment: 500 when the ownership lookup throws, before any R2 write', async () => {
  const db = treeDb();
  const r2 = mockR2();
  const c = ctx({
    db: throwingD1(db, 'SELECT id, attachments_json FROM course_step'),
    params: P, request: formRequest({ stepId: 'step-a1', file: mockFile() }), r2,
  });
  const res = await onRequestPost(c);
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'Internal error');
  assert.deepEqual(r2.puts, []);
  assert.ok(c.events.actions().includes('db_lookup_error'));
  db.close();
});

// ------------------------------------------------------------ happy path --

test('POST attachment: appends to attachments_json and returns the stored entry', async () => {
  const db = treeDb();
  const r2 = mockR2();
  const { status, body } = await read(await upload(db, { name: 'Handout.pdf', file: mockFile({ size: 4096 }) }, { r2 }));
  assert.equal(status, 201);

  const key = body.data.url.slice(R2_PUBLIC_HOST.length);
  assert.match(key, KEY_RE, 'key is scoped to the step and has a random basename');
  assert.deepEqual(r2.puts.map((p) => p.key), [key], 'the object written is the object linked');

  const stored = attachmentsOf(db, 'step-a1');
  assert.deepEqual(stored, [{ name: 'Handout.pdf', url: R2_PUBLIC_HOST + key, size: 4096, type: 'application/pdf' }]);
  assert.deepEqual(body.data, stored[0]);
  assert.notEqual(readStep(db, 'step-a1').updated_at, '2026-01-01 00:00:00');
  db.close();
});

test('POST attachment: a second upload appends rather than replacing, and gets a distinct key', async () => {
  const db = treeDb();
  const r2 = mockR2();
  const first = await read(await upload(db, { name: 'one.pdf' }, { r2 }));
  const second = await read(await upload(db, { name: 'two.pdf' }, { r2 }));
  assert.notEqual(first.body.data.url, second.body.data.url, 'a fresh uuid per upload, so no overwrite');

  const stored = attachmentsOf(db, 'step-a1');
  assert.deepEqual(stored.map((a) => a.name), ['one.pdf', 'two.pdf']);
  assert.equal(new Set(r2.puts.map((p) => p.key)).size, 2);
  db.close();
});

test('POST attachment: an existing attachments array is preserved, not clobbered', async () => {
  const existing = [{ name: 'old.pdf', url: 'https://example.com/old.pdf', size: 1, type: 'application/pdf' }];
  const db = treeDb({ extraSeed: (s) => setAttachments(s, 'step-a1', JSON.stringify(existing)) });
  await upload(db, { name: 'new.pdf' });
  const stored = attachmentsOf(db, 'step-a1');
  assert.equal(stored.length, 2);
  assert.deepEqual(stored[0], existing[0]);
  db.close();
});

// ------------------------------------------------------------ R2 failures --

test('POST attachment: 500 when the R2 put fails, and no D1 row is written', async () => {
  const db = treeDb();
  const c = ctx({
    db, params: P, request: formRequest({ stepId: 'step-a1', file: mockFile() }),
    r2: mockR2({ failPut: true }),
  });
  const res = await onRequestPost(c);
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'Internal error');
  assert.equal(attachmentsOf(db, 'step-a1'), null);
  assert.ok(c.events.actions().includes('r2_put_error'));
  db.close();
});

test('POST attachment ROLLBACK: a failed D1 write deletes the object just put to R2, leaving no orphan', async () => {
  const db = treeDb();
  const r2 = mockR2();
  const c = ctx({
    db: throwingD1(db, 'UPDATE course_step SET attachments_json = json_insert'),
    params: P, request: formRequest({ stepId: 'step-a1', file: mockFile() }), r2,
  });
  const res = await onRequestPost(c);
  assert.equal(res.status, 500);
  await drain(c.waitUntil);

  assert.equal(r2.puts.length, 1);
  assert.deepEqual(r2.deleted, [r2.puts[0].key], 'PINNED: the R2 write is rolled back, not orphaned');
  assert.equal(attachmentsOf(db, 'step-a1'), null);
  assert.deepEqual(c.events.actions().slice(0, 2), ['db_write_error', 'r2_cleanup_after_d1_fail']);
  db.close();
});

test('POST attachment: a rollback whose R2 delete also fails is logged rather than thrown', async () => {
  const db = treeDb();
  let key = null;
  const r2 = mockR2();
  const realPut = r2.put.bind(r2);
  r2.put = async (k, body, opts) => { key = k; return realPut(k, body, opts); };
  r2.delete = async () => { throw new Error('R2 delete failed'); };
  const c = ctx({
    db: throwingD1(db, 'UPDATE course_step SET attachments_json = json_insert'),
    params: P, request: formRequest({ stepId: 'step-a1', file: mockFile() }), r2,
  });
  assert.equal((await onRequestPost(c)).status, 500);
  await drain(c.waitUntil);
  assert.ok(key);
  assert.ok(c.events.actions().includes('r2_cleanup_after_d1_fail_r2_error'));
  db.close();
});

// ---------------------------------------------------------------- DELETE --

test('DELETE attachment: 400 Invalid JSON and Invalid payload', async () => {
  const db = treeDb();
  assert.equal((await onRequestDelete(ctx({ db, params: P, method: 'DELETE', r2: mockR2() }))).status, 400);
  const res = await onRequestDelete(ctx({ db, params: P, method: 'DELETE', rawBody: '[]', r2: mockR2() }));
  assert.equal((await res.json()).error, 'Invalid payload');
  db.close();
});

test('DELETE attachment: 400 invalid_step_id for every rejected id shape', async () => {
  const db = treeDb();
  for (const stepId of [undefined, '', '  ', 's'.repeat(101), '../evil', 'Step-A1']) {
    const res = await onRequestDelete(ctx({ db, params: P, method: 'DELETE', body: { stepId, url: 'https://x.test/a' }, r2: mockR2() }));
    assert.equal(res.status, 400, JSON.stringify(stepId));
    assert.equal((await res.json()).error, 'invalid_step_id');
  }
  db.close();
});

test('DELETE attachment: 400 attachment_not_found for a missing, blank or over-long url', async () => {
  const db = treeDb();
  for (const url of [undefined, '', '   ', `https://x.test/${'u'.repeat(2000)}`]) {
    const res = await onRequestDelete(ctx({ db, params: P, method: 'DELETE', body: { stepId: 'step-a1', url }, r2: mockR2() }));
    assert.equal(res.status, 400, String(url).slice(0, 40));
    assert.equal((await res.json()).error, 'attachment_not_found');
  }
  db.close();
});

test('DELETE attachment: 500 when the ownership lookup throws', async () => {
  const db = treeDb();
  const c = ctx({
    db: throwingD1(db, 'SELECT id, attachments_json FROM course_step'),
    params: P, method: 'DELETE', body: { stepId: 'step-a1', url: `${R2_PUBLIC_HOST}courses/step-a1/x.pdf` }, r2: mockR2(),
  });
  assert.equal((await onRequestDelete(c)).status, 500);
  assert.ok(c.events.actions().includes('db_lookup_error'));
  db.close();
});

test('DELETE attachment: 404 course_not_found and 404 step_not_found, including the IDOR case', async () => {
  const db = treeDb();
  const url = `${R2_PUBLIC_HOST}courses/step-a1/x.pdf`;
  const noCourse = await onRequestDelete(ctx({ db, params: { id: 'course-zz' }, method: 'DELETE', body: { stepId: 'step-a1', url }, r2: mockR2() }));
  assert.equal((await noCourse.json()).error, 'course_not_found');

  const noStep = await onRequestDelete(ctx({ db, params: P, method: 'DELETE', body: { stepId: 'step-zz', url }, r2: mockR2() }));
  assert.equal((await noStep.json()).error, 'step_not_found');

  const foreign = await onRequestDelete(ctx({ db, params: P, method: 'DELETE', body: { stepId: 'step-b1', url }, r2: mockR2() }));
  assert.equal(foreign.status, 404);
  assert.equal((await foreign.json()).error, 'step_not_found');
  db.close();
});

test('DELETE attachment: 404 attachment_not_found when the step has no matching entry', async () => {
  for (const raw of [null, '[]', 'garbage', '{"not":"array"}', JSON.stringify([{ name: 'x', url: 'https://example.com/other.pdf' }])]) {
    const db = treeDb({ extraSeed: (s) => setAttachments(s, 'step-a1', raw) });
    const r2 = mockR2();
    const res = await onRequestDelete(ctx({
      db, params: P, method: 'DELETE',
      body: { stepId: 'step-a1', url: `${R2_PUBLIC_HOST}courses/step-a1/missing.pdf` }, r2,
    }));
    assert.equal(res.status, 404, String(raw));
    assert.equal((await res.json()).error, 'attachment_not_found');
    assert.deepEqual(r2.deleted, []);
    db.close();
  }
});

test('DELETE attachment: 400 when the matched entry is not hosted on the R2 public host', async () => {
  const foreignUrl = 'https://example.com/theirs.pdf';
  const db = treeDb({
    extraSeed: (s) => setAttachments(s, 'step-a1', JSON.stringify([{ name: 'theirs', url: foreignUrl }])),
  });
  const r2 = mockR2();
  const res = await onRequestDelete(ctx({ db, params: P, method: 'DELETE', body: { stepId: 'step-a1', url: foreignUrl }, r2 }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'attachment_not_found');
  assert.deepEqual(r2.deleted, [], 'a foreign host is never handed to R2.delete');
  assert.equal(attachmentsOf(db, 'step-a1').length, 1, 'and the row is left alone');
  db.close();
});

test('DELETE attachment: removes only the matching entry and deletes its R2 object', async () => {
  const db = treeDb();
  const r2 = mockR2();
  const one = await read(await upload(db, { name: 'one.pdf' }, { r2 }));
  const two = await read(await upload(db, { name: 'two.pdf' }, { r2 }));

  const c = ctx({ db, params: P, method: 'DELETE', body: { stepId: 'step-a1', url: `  ${one.body.data.url}  ` }, r2 });
  const res = await onRequestDelete(c);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  await drain(c.waitUntil);

  const stored = attachmentsOf(db, 'step-a1');
  assert.deepEqual(stored.map((a) => a.name), ['two.pdf'], 'the sibling entry survives');
  assert.deepEqual(stored[0], two.body.data, 'and keeps its full shape, not a re-quoted string');
  assert.deepEqual(r2.deleted, [one.body.data.url.slice(R2_PUBLIC_HOST.length)]);
  db.close();
});

test('DELETE attachment: removing the last entry leaves an empty array, not null', async () => {
  const db = treeDb();
  const r2 = mockR2();
  const only = await read(await upload(db, { name: 'only.pdf' }, { r2 }));
  const c = ctx({ db, params: P, method: 'DELETE', body: { stepId: 'step-a1', url: only.body.data.url }, r2 });
  assert.equal((await onRequestDelete(c)).status, 200);
  await drain(c.waitUntil);
  assert.deepEqual(attachmentsOf(db, 'step-a1'), []);
  db.close();
});

test('DELETE attachment: 500 when the D1 rewrite throws, and the R2 object is left in place', async () => {
  const db = treeDb();
  const r2 = mockR2();
  const only = await read(await upload(db, { name: 'only.pdf' }, { r2 }));
  const c = ctx({
    db: throwingD1(db, 'UPDATE course_step SET attachments_json = (SELECT json_group_array'),
    params: P, method: 'DELETE', body: { stepId: 'step-a1', url: only.body.data.url }, r2,
  });
  assert.equal((await onRequestDelete(c)).status, 500);
  await drain(c.waitUntil);
  assert.deepEqual(r2.deleted, [], 'the object is not deleted when its D1 reference survives');
  assert.equal(attachmentsOf(db, 'step-a1').length, 1);
  assert.ok(c.events.actions().includes('db_write_error'));
  db.close();
});

test('DELETE attachment: a failing R2 delete is logged and the request still succeeds', async () => {
  const db = treeDb();
  const r2 = mockR2();
  const only = await read(await upload(db, { name: 'only.pdf' }, { r2 }));
  const key = only.body.data.url.slice(R2_PUBLIC_HOST.length);
  r2.delete = async () => { throw new Error(`R2 delete failed for ${key}`); };

  const c = ctx({ db, params: P, method: 'DELETE', body: { stepId: 'step-a1', url: only.body.data.url }, r2 });
  assert.equal((await onRequestDelete(c)).status, 200);
  await drain(c.waitUntil);
  assert.ok(c.events.actions().includes('r2_delete_error'));
  assert.deepEqual(attachmentsOf(db, 'step-a1'), [], 'the D1 removal stands even though R2 failed');
  db.close();
});
