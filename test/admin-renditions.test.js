import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDB, mockEnv, mockRequest, mockWaitUntil } from './_helpers.js';
import { onRequestGet, onRequestPut, onRequestDelete } from '../functions/api/admin/courses/[id]/steps/[stepId]/renditions.js';
import { onRequestDelete as stepDelete } from '../functions/api/admin/courses/[id]/steps/[stepId].js';
import { onRequestDelete as sectionDelete } from '../functions/api/admin/courses/[id]/sections/[sectionId].js';

function adminCtx(queryMap, { method = 'PUT', body, query = '', role = 'admin' } = {}) {
  const db = mockDB(queryMap);
  const env = mockEnv({ DB: db, R2_ASSETS: { deleted: [], async delete(k) { this.deleted.push(k); } } });
  const request = mockRequest(method, {
    body,
    url: `https://rrmacademy.org/api/admin/courses/course-1/steps/step-1/renditions${query}`,
  });
  return {
    request, env, waitUntil: mockWaitUntil(), db,
    params: { id: 'course-1', stepId: 'step-1' },
    data: { user: { id: 'admin1', role } },
  };
}

const STEP_EXISTS = { 'FROM course_step WHERE id = ? AND course_id = ?': { first: { id: 'step-1' } } };

test('401 without user, 403 for non-admin', async () => {
  const c1 = adminCtx({});
  c1.data = {};
  assert.equal((await onRequestGet(c1)).status, 401);
  const c2 = adminCtx({}, { role: 'user' });
  assert.equal((await onRequestGet(c2)).status, 403);
});

test('PUT 404 when step does not belong to course (ownership chain)', async () => {
  const c = adminCtx(
    { 'FROM course_step WHERE id = ? AND course_id = ?': { first: null } },
    { body: { format: 'reading', content: { html: '<p>x</p>' } } }
  );
  assert.equal((await onRequestPut(c)).status, 404);
});

test('PUT 400 invalid_format', async () => {
  const c = adminCtx(STEP_EXISTS, { body: { format: 'video', content: { html: '<p>x</p>' } } });
  const res = await onRequestPut(c);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_format');
});

test('PUT 400 content_empty on empty cards array', async () => {
  const c = adminCtx(STEP_EXISTS, { body: { format: 'flashcards', content: { cards: [] } } });
  const res = await onRequestPut(c);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'content_empty');
});

test('PUT 400 content_too_large over per-format cap', async () => {
  const big = 'x'.repeat(81000);
  const c = adminCtx(STEP_EXISTS, { body: { format: 'reading', content: { html: `<p>${big}</p>` } } });
  const res = await onRequestPut(c);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'content_too_large');
});

test('PUT sanitizes reading html and computes word_count', async () => {
  const qm = {
    ...STEP_EXISTS,
    'INSERT INTO step_rendition': { run: { success: true, meta: { changes: 1 } } },
    'FROM step_rendition WHERE step_id = ? AND format = ?': {
      first: {
        step_id: 'step-1', format: 'reading', status: 'draft', source: null,
        content_json: JSON.stringify({ html: '<p>clean</p>' }), word_count: 1,
        created_at: 'x', updated_at: 'x', duration_seconds: null,
      },
    },
  };
  const c = adminCtx(qm, { body: { format: 'reading', content: { html: '<p>clean</p><script>alert(1)</script>' } } });
  const res = await onRequestPut(c);
  assert.equal(res.status, 200);
  const insert = c.db._calls.find((x) => x.sql.includes('INSERT INTO step_rendition'));
  assert.ok(insert, 'expected upsert');
  const storedJson = insert.bound.find((b) => typeof b === 'string' && b.startsWith('{'));
  assert.ok(!storedJson.includes('<script'));
});

test('PUT quiz validates question shape', async () => {
  const c = adminCtx(STEP_EXISTS, {
    body: { format: 'quiz', content: { type: 'quiz', questions: [{ id: 'q1', text: 'Q', options: ['a'], correctIndex: 5 }] } },
  });
  const res = await onRequestPut(c);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_content');
});

test('DELETE 409 for cert-quiz quiz rendition', async () => {
  const qm = {
    ...STEP_EXISTS,
    'certificate_quiz_step_id': { first: { id: 'course-1' } },
  };
  const c = adminCtx(qm, { method: 'DELETE', query: '?format=quiz' });
  const res = await onRequestDelete(c);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'step_referenced_as_certificate_quiz');
});

test('DELETE audio removes R2 object', async () => {
  const qm = {
    ...STEP_EXISTS,
    'FROM step_rendition WHERE step_id = ? AND format = ?': {
      first: { content_json: JSON.stringify({ r2_key: 'courses/audio/step-1.mp3' }) },
    },
    'DELETE FROM step_rendition': { run: { success: true, meta: { changes: 1 } } },
  };
  const c = adminCtx(qm, { method: 'DELETE', query: '?format=audio' });
  const res = await onRequestDelete(c);
  assert.equal(res.status, 200);
  assert.deepEqual(c.env.R2_ASSETS.deleted, ['courses/audio/step-1.mp3']);
});

test('PUT status archived on cert-quiz quiz rendition is refused 409', async () => {
  const qm = { ...STEP_EXISTS, 'certificate_quiz_step_id': { first: { id: 'course-1' } } };
  const c = adminCtx(qm, {
    body: { format: 'quiz', status: 'archived', content: { type: 'quiz', questions: [{ id: 'q1', text: 'Q', options: ['a', 'b'], correctIndex: 0 }] } },
  });
  const res = await onRequestPut(c);
  assert.equal(res.status, 409);
});

test('step DELETE batch-cleans step_rendition rows (condition-safe)', async () => {
  const qm = {
    'FROM course_step WHERE id = ? AND course_id = ?': { first: { id: 'step-1', attachments_json: null } },
    'certificate_quiz_step_id': { first: null },
    "format = 'audio'": { first: null },
    'DELETE FROM course_step': { run: { success: true, meta: { changes: 1 } } },
    'DELETE FROM step_rendition': { run: { success: true, meta: { changes: 2 } } },
  };
  const c = adminCtx(qm, { method: 'DELETE' });
  const res = await stepDelete(c);
  assert.equal(res.status, 200);
  const renditionDelete = c.db._calls.find((x) => x.sql.includes('DELETE FROM step_rendition'));
  assert.ok(renditionDelete, 'step DELETE must clean step_rendition');
  assert.ok(renditionDelete.sql.includes('NOT EXISTS'), 'rendition cleanup must be conditional on the step row being gone');
});

test('step DELETE removes audio R2 object when audio rendition exists', async () => {
  const qm = {
    'FROM course_step WHERE id = ? AND course_id = ?': { first: { id: 'step-1', attachments_json: null } },
    'certificate_quiz_step_id': { first: null },
    "format = 'audio'": { first: { content_json: JSON.stringify({ r2_key: 'courses/audio/step-1.mp3' }) } },
    'DELETE FROM course_step': { run: { success: true, meta: { changes: 1 } } },
    'DELETE FROM step_rendition': { run: { success: true, meta: { changes: 1 } } },
  };
  const c = adminCtx(qm, { method: 'DELETE' });
  const res = await stepDelete(c);
  assert.equal(res.status, 200);
  assert.deepEqual(c.env.R2_ASSETS.deleted, ['courses/audio/step-1.mp3']);
});

test('section DELETE batch includes DELETE FROM step_rendition scoped by section subquery', async () => {
  const db = mockDB({
    'FROM course_section WHERE id = ? AND course_id = ?': { first: { id: 'section-1' } },
    "format = 'audio'": { all: { results: [] } },
    'DELETE FROM step_rendition': { run: { success: true, meta: { changes: 0 } } },
    'DELETE FROM course_step WHERE section_id': { run: { success: true, meta: { changes: 1 } } },
    'DELETE FROM course_section': { run: { success: true, meta: { changes: 1 } } },
    'FROM course_step WHERE section_id': { all: { results: [{ id: 'step-1' }] } },
    'certificate_quiz_step_id': { first: null },
    'FROM step_progress': { all: { results: [] } },
    'FROM quiz_response': { all: { results: [] } },
    'FROM lesson_comment': { all: { results: [] } },
  });
  const env = mockEnv({ DB: db, R2_ASSETS: { deleted: [], async delete(k) { this.deleted.push(k); } } });
  const c = {
    env, waitUntil: mockWaitUntil(), db,
    params: { id: 'course-1', sectionId: 'section-1' },
    data: { user: { id: 'admin1', role: 'admin' } },
  };
  const res = await sectionDelete(c);
  assert.equal(res.status, 200);
  const renditionDelete = db._calls.find((x) => x.sql.includes('DELETE FROM step_rendition'));
  assert.ok(renditionDelete, 'section DELETE must include DELETE FROM step_rendition');
  assert.ok(
    renditionDelete.sql.includes('section_id = ?'),
    'rendition cleanup must be scoped by section subquery'
  );
});
