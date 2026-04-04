/**
 * Tests for admin FAQ CRUD endpoints.
 * Run with: node --test test/admin-faqs.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, onRequestGet } from '../functions/api/admin/faqs/index.js';
import { onRequestGet as onRequestGetOne, onRequestPut, onRequestDelete } from '../functions/api/admin/faqs/[id].js';
import { mockRequest, mockDB, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';

const ADMIN_USER = { id: 'user_admin', email: 'admin@test.com', role: 'admin' };
const SUPERADMIN_USER = { id: 'user_super', email: 'super@test.com', role: 'superadmin' };
const MEMBER_USER = { id: 'user_member', email: 'member@test.com', role: 'member' };

function makeContext(request, env, waitUntil, user, params = {}) {
  return {
    request,
    env,
    waitUntil,
    data: user ? { user } : {},
    params,
  };
}

const FAQ_ROW = {
  id: 'faq_abc123',
  faq_code: 'what-is-rrm',
  slug: 'what-is-rrm',
  question: 'What is RRM?',
  basic_answer: 'RRM is restorative reproductive medicine.',
  schema_answer: null,
  published_answer: null,
  category: 'Foundational',
  seo_title: null,
  seo_description: null,
  sort_order: 1,
  status: 'draft',
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-01 00:00:00',
};

describe('POST /api/admin/faqs -- auth', () => {
  it('returns 401 without session', async () => {
    const req = mockRequest('POST', { body: { question: 'Test?', category: 'Foundational' } });
    const env = mockEnv();
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt, null));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'Unauthorized');
  });

  it('returns 403 for non-admin role', async () => {
    const req = mockRequest('POST', { body: { question: 'Test?', category: 'Foundational' } });
    const env = mockEnv();
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt, MEMBER_USER));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'Forbidden');
  });
});

describe('POST /api/admin/faqs -- validation', () => {
  it('returns 400 when question is missing', async () => {
    const req = mockRequest('POST', { body: { category: 'Foundational' } });
    const env = mockEnv();
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt, ADMIN_USER));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'question_required');
  });

  it('returns 400 for invalid category', async () => {
    const req = mockRequest('POST', { body: { question: 'What is RRM?', category: 'InvalidCategory' } });
    const env = mockEnv();
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt, ADMIN_USER));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'invalid_category');
  });

  it('returns 400 for empty question string', async () => {
    const req = mockRequest('POST', { body: { question: '   ', category: 'Foundational' } });
    const env = mockEnv();
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt, ADMIN_USER));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'question_required');
  });
});

describe('POST /api/admin/faqs -- create', () => {
  it('creates FAQ with valid input -- id starts with faq_, slug generated', async () => {
    const db = mockDB({
      'INSERT INTO faq': { run: { success: true } },
      'SELECT * FROM faq WHERE id': { first: FAQ_ROW },
    });

    const req = mockRequest('POST', {
      body: { question: 'What is RRM?', category: 'Foundational' },
    });
    const env = mockEnv({ DB: db });
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt, ADMIN_USER));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 201);
    assert.equal(body.ok, true);
    assert.ok(body.data);
    assert.ok(body.data.id.startsWith('faq_'), `Expected id to start with faq_, got: ${body.data.id}`);
    assert.equal(body.data.slug, 'what-is-rrm');
  });

  it('creates FAQ with superadmin role', async () => {
    const db = mockDB({
      'INSERT INTO faq': { run: { success: true } },
      'SELECT * FROM faq WHERE id': { first: FAQ_ROW },
    });

    const req = mockRequest('POST', {
      body: { question: 'What is RRM?', category: 'Foundational' },
    });
    const env = mockEnv({ DB: db });
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt, SUPERADMIN_USER));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 201);
    assert.equal(body.ok, true);
  });

  it('defaults status to draft when not provided', async () => {
    let insertedStatus;
    const db = mockDB({});
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const stmt = origPrepare(sql);
      if (sql.includes('INSERT INTO faq')) {
        const origBind = stmt.bind.bind(stmt);
        stmt.bind = (...args) => {
          insertedStatus = args[11];
          return origBind(...args);
        };
        stmt.run = async () => ({ success: true });
      }
      if (sql.includes('SELECT * FROM faq WHERE id')) {
        stmt.first = async () => ({ ...FAQ_ROW, status: insertedStatus });
      }
      return stmt;
    };

    const req = mockRequest('POST', {
      body: { question: 'What is RRM?', category: 'Foundational' },
    });
    const env = mockEnv({ DB: db });
    const wt = mockWaitUntil();
    const res = await onRequestPost(makeContext(req, env, wt, ADMIN_USER));
    const { status } = await parseResponse(res);

    assert.equal(status, 201);
    assert.equal(insertedStatus, 'draft');
  });
});

describe('GET /api/admin/faqs/[id] -- single FAQ', () => {
  it('returns 404 for non-existent FAQ', async () => {
    const db = mockDB({
      'SELECT * FROM faq WHERE id': { first: null },
    });

    const req = mockRequest('GET', { url: 'https://rrmacademy.org/api/admin/faqs/faq_notexist' });
    const env = mockEnv({ DB: db });
    const wt = mockWaitUntil();
    const res = await onRequestGetOne(makeContext(req, env, wt, ADMIN_USER, { id: 'faq_notexist' }));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'not_found');
  });

  it('returns FAQ data when found', async () => {
    const db = mockDB({
      'SELECT * FROM faq WHERE id': { first: FAQ_ROW },
      'FROM faq_library_ref WHERE faq_id': { all: { results: [] } },
      'FROM faq_resource WHERE faq_id': { all: { results: [] } },
    });

    const req = mockRequest('GET', { url: 'https://rrmacademy.org/api/admin/faqs/faq_abc123' });
    const env = mockEnv({ DB: db });
    const wt = mockWaitUntil();
    const res = await onRequestGetOne(makeContext(req, env, wt, ADMIN_USER, { id: 'faq_abc123' }));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.id, 'faq_abc123');
    assert.equal(body.data.question, 'What is RRM?');
  });
});

describe('PUT /api/admin/faqs/[id] -- update', () => {
  it('updates partial fields', async () => {
    const updatedRow = { ...FAQ_ROW, basic_answer: 'Updated answer.', updated_at: '2026-04-01 00:00:00' };
    const db = mockDB({
      'SELECT id FROM faq WHERE id': { first: { id: 'faq_abc123' } },
      'UPDATE faq SET': { run: { success: true, meta: { changes: 1 } } },
      'SELECT * FROM faq WHERE id': { first: updatedRow },
      'FROM faq_library_ref WHERE faq_id': { all: { results: [] } },
      'FROM faq_resource WHERE faq_id': { all: { results: [] } },
    });

    const req = mockRequest('PUT', {
      url: 'https://rrmacademy.org/api/admin/faqs/faq_abc123',
      body: { basicAnswer: 'Updated answer.' },
    });
    const env = mockEnv({ DB: db });
    const wt = mockWaitUntil();
    const res = await onRequestPut(makeContext(req, env, wt, ADMIN_USER, { id: 'faq_abc123' }));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.basicAnswer, 'Updated answer.');
  });

  it('returns 404 when FAQ does not exist', async () => {
    const db = mockDB({
      'UPDATE faq SET': { run: { success: true, meta: { changes: 0 } } },
    });

    const req = mockRequest('PUT', {
      url: 'https://rrmacademy.org/api/admin/faqs/faq_missing',
      body: { basicAnswer: 'Updated.' },
    });
    const env = mockEnv({ DB: db });
    const wt = mockWaitUntil();
    const res = await onRequestPut(makeContext(req, env, wt, ADMIN_USER, { id: 'faq_missing' }));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 404);
    assert.equal(body.ok, false);
  });

  it('returns 400 for invalid category in update', async () => {
    const req = mockRequest('PUT', {
      url: 'https://rrmacademy.org/api/admin/faqs/faq_abc123',
      body: { category: 'BadCategory' },
    });
    const env = mockEnv();
    const wt = mockWaitUntil();
    const res = await onRequestPut(makeContext(req, env, wt, ADMIN_USER, { id: 'faq_abc123' }));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_category');
  });
});

describe('DELETE /api/admin/faqs/[id]', () => {
  it('returns 200 for existing FAQ', async () => {
    const db = mockDB({
      'SELECT id FROM faq WHERE id': { first: { id: 'faq_abc123' } },
      'DELETE FROM faq WHERE id': { run: { success: true } },
    });

    const req = mockRequest('DELETE', { url: 'https://rrmacademy.org/api/admin/faqs/faq_abc123' });
    const env = mockEnv({ DB: db });
    const wt = mockWaitUntil();
    const res = await onRequestDelete(makeContext(req, env, wt, ADMIN_USER, { id: 'faq_abc123' }));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it('returns 404 for non-existent FAQ', async () => {
    const db = mockDB({
      'SELECT id FROM faq WHERE id': { first: null },
    });

    const req = mockRequest('DELETE', { url: 'https://rrmacademy.org/api/admin/faqs/faq_nope' });
    const env = mockEnv({ DB: db });
    const wt = mockWaitUntil();
    const res = await onRequestDelete(makeContext(req, env, wt, ADMIN_USER, { id: 'faq_nope' }));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'not_found');
  });
});
