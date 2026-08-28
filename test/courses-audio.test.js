import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDB, mockEnv, mockWaitUntil } from './_helpers.js';
import { onRequestGet } from '../functions/api/courses/audio.js';

const FUTURE = Math.floor(Date.now() / 1000) + 86400 * 20;
const KEY = 'courses/audio/step-1.mp3';

function sessionRow(role = 'user') {
  return { id: 'sess1', user_id: 'user1', expires_at: FUTURE, blocked: 0, role };
}

function renditionRow(over = {}) {
  return {
    content_json: JSON.stringify({ r2_key: KEY, voice: 'neutral-1', duration_seconds: 540 }),
    rendition_status: 'published',
    word_count: null,
    course_id: 'course-free',
    step_status: 'published',
    course_status: 'published',
    access_type: 'public',
    is_free: 1,
    settings_json: null,
    ...over,
  };
}

function r2Object(over = {}) {
  return { body: 'ID3-MP3-BYTES', size: 1000, httpEtag: '"etag-1"', ...over };
}

/**
 * R2 stub. `get` records every call so a test can assert the range option that
 * reached the bucket; `impl` may return an object, null, or throw.
 */
function r2Stub(impl = () => r2Object()) {
  return {
    calls: [],
    async get(key, options) {
      this.calls.push({ key, options });
      return impl(key, options);
    },
  };
}

function ctx(queryMap, {
  cookie = 'session=sess1',
  url = 'https://rrmacademy.org/api/courses/audio?stepId=step-1',
  range = null,
  r2 = r2Stub(),
  envOver = {},
} = {}) {
  const db = mockDB(queryMap);
  const env = mockEnv({ DB: db, R2_ASSETS: r2, ...envOver });
  const request = {
    url,
    headers: {
      get: (n) => {
        const name = String(n).toLowerCase();
        if (name === 'cookie') return cookie;
        if (name === 'range') return range;
        return null;
      },
    },
  };
  return { request, env, waitUntil: mockWaitUntil(), db, r2 };
}

test('401 when not authenticated', async () => {
  const { request, env, waitUntil } = ctx({ 'FROM session': { first: null } });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'Not authenticated');
});

test('400 invalid_step when stepId is missing', async () => {
  const { request, env, waitUntil } = ctx(
    { 'FROM session': { first: sessionRow() } },
    { url: 'https://rrmacademy.org/api/courses/audio' }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_step');
});

test('503 service_unavailable when the R2 binding is missing', async () => {
  const { request, env, waitUntil } = ctx({ 'FROM session': { first: sessionRow() } });
  env.R2_ASSETS = undefined;
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'service_unavailable');
});

test('404 rendition_not_available when no audio rendition row exists', async () => {
  const { request, env, waitUntil, r2 } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: null },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'rendition_not_available');
  assert.equal(r2.calls.length, 0);
});

test('404 when the audio rendition is draft (indistinguishable from missing)', async () => {
  const { request, env, waitUntil, r2 } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ rendition_status: 'draft' }) },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'rendition_not_available');
  assert.equal(r2.calls.length, 0, 'a draft rendition must never reach R2');
});

test('404 when the course is not published', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ course_status: 'draft' }) },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 404);
});

test('members course: 403 for a non-member session', async () => {
  const { request, env, waitUntil, r2 } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ access_type: 'members', course_id: 'course-members' }) },
    'FROM user WHERE id = ?': {
      first: {
        id: 'user1', email: 'member@example.com', name: 'M', first_name: 'M', last_name: null,
        role: 'user', stripe_customer_id: null, avatar_url: null, blocked: 0, email_verified: 1,
      },
    },
    'FROM user_label': { first: null },
    'FROM wix_subscription': { first: null },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'Membership required');
  assert.equal(r2.calls.length, 0);
});

test('paid course: 403 without enrollment', async () => {
  const { request, env, waitUntil, r2 } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ is_free: 0, course_id: 'course-paid' }) },
    'FROM enrollment': { first: null },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'Not enrolled');
  assert.equal(r2.calls.length, 0);
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

test('step-lock: 403 when fixed order and previous step incomplete', async () => {
  const { request, env, waitUntil, r2 } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ settings_json: JSON.stringify({ stepOrder: 'fixed' }) }) },
    'ORDER BY sec.sort_order': { all: { results: [{ id: 'step-0' }, { id: 'step-1' }] } },
    'FROM step_progress': { first: { completed: 0 } },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'Previous step not completed');
  assert.equal(r2.calls.length, 0);
});

test('happy path: 200 audio/mpeg with Content-Length, Accept-Ranges and body', async () => {
  const { request, env, waitUntil, r2 } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow() },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal(res.headers.get('Content-Length'), '1000');
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(res.headers.get('ETag'), '"etag-1"');
  assert.equal(await res.text(), 'ID3-MP3-BYTES');
  assert.equal(r2.calls.length, 1);
  assert.equal(r2.calls[0].key, KEY);
  assert.equal(r2.calls[0].options, undefined, 'no Range header means an unranged R2 read');
});

test('the stored r2_key never reaches the client', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow() },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  const body = await res.text();
  assert.ok(!body.includes(KEY));
  for (const [, value] of res.headers) {
    assert.ok(!String(value).includes(KEY), 'no response header may leak the R2 key');
  }
});

test('Range request is passed to R2 and answered 206 with Content-Range', async () => {
  const r2 = r2Stub(() => r2Object({ range: { offset: 100, length: 100 }, body: 'PARTIAL' }));
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow() },
    },
    { range: 'bytes=100-199', r2 }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 206);
  assert.deepEqual(r2.calls[0].options, { range: { offset: 100, length: 100 } });
  assert.equal(res.headers.get('Content-Range'), 'bytes 100-199/1000');
  assert.equal(res.headers.get('Content-Length'), '100');
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(await res.text(), 'PARTIAL');
});

test('open-ended Range (bytes=0-) streams from the offset as 206', async () => {
  const r2 = r2Stub(() => r2Object({ range: { offset: 0 } }));
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow() },
    },
    { range: 'bytes=0-', r2 }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 206);
  assert.deepEqual(r2.calls[0].options, { range: { offset: 0 } });
  assert.equal(res.headers.get('Content-Range'), 'bytes 0-999/1000');
  assert.equal(res.headers.get('Content-Length'), '1000');
});

test('suffix Range (bytes=-100) resolves to absolute Content-Range', async () => {
  const r2 = r2Stub(() => r2Object({ range: { suffix: 100 } }));
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow() },
    },
    { range: 'bytes=-100', r2 }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 206);
  assert.deepEqual(r2.calls[0].options, { range: { suffix: 100 } });
  assert.equal(res.headers.get('Content-Range'), 'bytes 900-999/1000');
});

test('unsupported Range syntax is ignored and the whole object is served 200', async () => {
  const r2 = r2Stub();
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow() },
    },
    { range: 'bytes=0-1, 5-6', r2 }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 200);
  assert.equal(r2.calls[0].options, undefined);
  assert.equal(res.headers.get('Content-Range'), null);
});

test('a rejected ranged read falls back to the whole object rather than failing playback', async () => {
  const r2 = r2Stub((key, options) => {
    if (options) throw new Error('The requested range is not satisfiable');
    return r2Object();
  });
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow() },
    },
    { range: 'bytes=99999-', r2 }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Length'), '1000');
  assert.equal(r2.calls.length, 2, 'ranged read then whole-object retry');
});

test('404 when the R2 object is missing', async () => {
  const r2 = r2Stub(() => null);
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow() },
    },
    { r2 }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'rendition_not_available');
});

test('502 upstream_error when R2 throws, with no error detail leaked', async () => {
  const r2 = r2Stub(() => { throw new Error('r2 exploded: bucket rrm-assets'); });
  const { request, env, waitUntil } = ctx(
    {
      'FROM session': { first: sessionRow() },
      'FROM step_rendition': { first: renditionRow() },
    },
    { r2 }
  );
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 502);
  const body = await res.text();
  assert.equal(JSON.parse(body).error, 'upstream_error');
  assert.ok(!body.includes('exploded'));
});

test('500 server_error on malformed stored content_json', async () => {
  const { request, env, waitUntil, r2 } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ content_json: '{not json' }) },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'server_error');
  assert.equal(r2.calls.length, 0);
});

test('500 server_error when the stored r2_key escapes courses/audio/', async () => {
  const { request, env, waitUntil, r2 } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ content_json: JSON.stringify({ r2_key: 'courses/../secrets/dump.mp3' }) }) },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'server_error');
  assert.equal(r2.calls.length, 0, 'a rejected key must never address the bucket');
});

test('500 server_error when the audio rendition carries no r2_key', async () => {
  const { request, env, waitUntil } = ctx({
    'FROM session': { first: sessionRow() },
    'FROM step_rendition': { first: renditionRow({ content_json: JSON.stringify({ voice: 'neutral-1' }) }) },
  });
  const res = await onRequestGet({ request, env, waitUntil });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'server_error');
});
