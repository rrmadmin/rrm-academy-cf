import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDB, mockEnv, mockWaitUntil } from './_helpers.js';
import { onRequestGet } from '../functions/api/courses/rendition.js';

const FUTURE = Math.floor(Date.now() / 1000) + 86400 * 20;

function sessionRow(role = 'user') {
  return { id: 'sess1', user_id: 'user1', expires_at: FUTURE, blocked: 0, role };
}

function renditionRow(over = {}) {
  return {
    content_json: JSON.stringify({ html: '<p>hello world</p>' }),
    rendition_status: 'published',
    word_count: 2,
    course_id: 'course-free',
    step_status: 'published',
    course_status: 'published',
    access_type: 'public',
    is_free: 1,
    settings_json: null,
    ...over,
  };
}

function ctx(queryMap, { cookie = 'session=sess1', url = 'https://rrmacademy.org/api/courses/rendition?stepId=step-1&format=reading' } = {}) {
  const db = mockDB(queryMap);
  const env = mockEnv({ DB: db });
  const request = {
    url,
    headers: { get: (n) => (n.toLowerCase() === 'cookie' ? cookie : null) },
  };
  return { request, env, waitUntil: mockWaitUntil(), db };
}

test('401 when not authenticated', async () => {
  const { request, env, waitUntil } = ctx({ 'FROM session': { first: null } });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 401);
});

test('400 on invalid format', async () => {
  const { request, env, waitUntil } = ctx(
    { 'FROM session': { first: sessionRow() } },
    { url: 'https://rrmacademy.org/api/courses/rendition?stepId=step-1&format=video' }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_format');
});

test('404 rendition_not_available when no row (missing)', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: null },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'rendition_not_available');
});

test('404 rendition_not_available when rendition is draft (indistinguishable from missing)', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ rendition_status: 'draft' }) },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'rendition_not_available');
});

test('404 when step is archived even if rendition published', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ step_status: 'archived' }) },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 404);
});

test('free course: session is enough, returns reading html + wordCount', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow() },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.format, 'reading');
  assert.equal(body.html, '<p>hello world</p>');
  assert.equal(body.wordCount, 2);
});

test('paid course: 403 without enrollment', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ is_free: 0, course_id: 'course-paid' }) },
    'FROM enrollment': { first: null },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 403);
});

test('paid course: 200 with active enrollment', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ is_free: 0, course_id: 'course-paid' }) },
    'FROM enrollment': { first: { id: 'enr1' } },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 200);
});

test('quiz format strips correctIndex', async () => {
  const quiz = {
    type: 'quiz', title: 'T', description: 'D', passingScore: 80,
    questions: [{ id: 'q1', text: 'Q?', options: ['a', 'b'], correctIndex: 1 }],
  };
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow({ content_json: JSON.stringify(quiz) }) },
    },
    { url: 'https://rrmacademy.org/api/courses/rendition?stepId=step-1&format=quiz' }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.quiz.questions[0].correctIndex, undefined);
  assert.equal(body.quiz.passingScore, 80);
});

test('audio format returns metadata without r2_key', async () => {
  const audio = { r2_key: 'courses/audio/step-1.mp3', voice: 'neutral-1', duration_seconds: 540 };
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow({ content_json: JSON.stringify(audio) }) },
    },
    { url: 'https://rrmacademy.org/api/courses/rendition?stepId=step-1&format=audio' }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  const body = await res.json();
  assert.equal(body.duration, 540);
  assert.equal(body.voice, 'neutral-1');
  assert.equal(body.r2_key, undefined);
});

test('500 server_error on malformed content_json', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ content_json: '{not json' }) },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'server_error');
});

test('step-lock: 403 when fixed order and previous step incomplete', async () => {
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow({ settings_json: JSON.stringify({ stepOrder: 'fixed' }), course_id: 'course-free' }) },
      'ORDER BY sec.sort_order': { all: { results: [{ id: 'step-0' }, { id: 'step-1' }] } },
      'FROM step_progress': { first: { completed: 0 } },
    },
    { url: 'https://rrmacademy.org/api/courses/rendition?stepId=step-1&format=reading' }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 403);
});
