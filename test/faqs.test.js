/**
 * Tests for GET /api/faqs (functions/api/faqs.js)
 * Run with: node --test test/faqs.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/faqs.js';
import { mockRequest, mockDB, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';

const TOKEN = 'test-worker-token';

function makeContext(request, env, waitUntil) {
  return { request, env, waitUntil };
}

function makeRequest(opts = {}) {
  return mockRequest('GET', {
    url: opts.url || 'https://rrmacademy.org/api/faqs',
    headers: opts.headers || { Authorization: `Bearer ${TOKEN}` },
  });
}

describe('GET /api/faqs -- auth', () => {
  it('returns 503 when LIBRARY_BUILD_TOKEN missing', async () => {
    const env = mockEnv({ LIBRARY_BUILD_TOKEN: undefined });
    const req = makeRequest();
    const wt = mockWaitUntil();
    const res = await onRequestGet(makeContext(req, env, wt));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 503);
    assert.equal(body.ok, false);
  });

  it('returns 401 when Bearer token is wrong', async () => {
    const env = mockEnv({ LIBRARY_BUILD_TOKEN: TOKEN });
    const req = makeRequest({ headers: { Authorization: 'Bearer wrong-token' } });
    const wt = mockWaitUntil();
    const res = await onRequestGet(makeContext(req, env, wt));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 401);
    assert.equal(body.ok, false);
  });

  it('returns 503 when DB missing', async () => {
    const env = mockEnv({ LIBRARY_BUILD_TOKEN: TOKEN, DB: undefined });
    const req = makeRequest();
    const wt = mockWaitUntil();
    const res = await onRequestGet(makeContext(req, env, wt));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 503);
    assert.equal(body.ok, false);
  });
});

describe('GET /api/faqs -- all records', () => {
  it('returns all published FAQs with library refs and resources joined', async () => {
    const faqRow = {
      id: 'faq_001',
      faq_code: 'what-is-rrm',
      slug: 'what-is-rrm',
      question: 'What is RRM?',
      basic_answer: 'RRM is restorative reproductive medicine.',
      schema_answer: 'RRM stands for...',
      published_answer: '<p>Full answer</p>',
      category: 'basics',
      seo_title: 'What is RRM?',
      seo_description: 'Learn about RRM.',
      sort_order: 1,
      status: 'published',
      updated_at: '2026-04-10T12:00:00',
      created_at: '2026-01-15T08:00:00',
    };

    const libRef = { faq_id: 'faq_001', article_id: 'rec123', label: 'Study A', sort_order: 1 };
    const resource = { faq_id: 'faq_001', title: 'RRM Overview', url: 'https://example.com', sort_order: 1 };

    const db = mockDB({
      "FROM faq WHERE status": { all: { results: [faqRow] } },
      'FROM faq_library_ref': { all: { results: [libRef] } },
      'FROM faq_resource': { all: { results: [resource] } },
    });

    const env = mockEnv({ LIBRARY_BUILD_TOKEN: TOKEN, DB: db });
    const req = makeRequest();
    const wt = mockWaitUntil();
    const res = await onRequestGet(makeContext(req, env, wt));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.results));
    assert.equal(body.results.length, 1);

    const faq = body.results[0];
    assert.equal(faq.id, 'faq_001');
    assert.equal(faq.faqId, 'what-is-rrm');
    assert.equal(faq.slug, 'what-is-rrm');
    assert.equal(faq.question, 'What is RRM?');
    assert.equal(faq.basicAnswer, 'RRM is restorative reproductive medicine.');
    assert.equal(faq.schemaAnswer, 'RRM stands for...');
    assert.equal(faq.publishedAnswer, '<p>Full answer</p>');
    assert.equal(faq.category, 'basics');
    assert.equal(faq.seoTitle, 'What is RRM?');
    assert.equal(faq.seoDescription, 'Learn about RRM.');
    assert.equal(faq.sortOrder, 1);
    assert.equal(faq.status, 'published');
    assert.equal(faq.updatedAt, '2026-04-10T12:00:00');
    assert.equal(faq.createdAt, '2026-01-15T08:00:00');

    assert.equal(faq.libraryRefs.length, 1);
    assert.equal(faq.libraryRefs[0].articleId, 'rec123');
    assert.equal(faq.libraryRefs[0].label, 'Study A');
    assert.equal(faq.libraryRefs[0].sortOrder, 1);

    assert.equal(faq.evidence.length, 1);
    assert.equal(faq.evidence[0].title, 'RRM Overview');
    assert.equal(faq.evidence[0].url, 'https://example.com');
    assert.equal(faq.evidence[0].sortOrder, 1);
  });

  it('returns empty arrays for FAQs with no refs or resources', async () => {
    const faqRow = {
      id: 'faq_002',
      faq_code: 'faq-no-refs',
      slug: 'faq-no-refs',
      question: 'Q?',
      basic_answer: 'A.',
      schema_answer: null,
      published_answer: null,
      category: 'other',
      seo_title: null,
      seo_description: null,
      sort_order: 2,
      status: 'published',
    };

    const db = mockDB({
      "FROM faq WHERE status": { all: { results: [faqRow] } },
      'FROM faq_library_ref ORDER': { all: { results: [] } },
      'FROM faq_resource ORDER': { all: { results: [] } },
    });

    const env = mockEnv({ LIBRARY_BUILD_TOKEN: TOKEN, DB: db });
    const req = makeRequest();
    const wt = mockWaitUntil();
    const res = await onRequestGet(makeContext(req, env, wt));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.results[0].libraryRefs.length, 0);
    assert.equal(body.results[0].evidence.length, 0);
  });
});

describe('GET /api/faqs -- single record', () => {
  it('returns single FAQ by id (any status, for preview)', async () => {
    const faqRow = {
      id: 'faq_003',
      faq_code: 'draft-faq',
      slug: 'draft-faq',
      question: 'Draft question?',
      basic_answer: 'Draft answer.',
      schema_answer: null,
      published_answer: null,
      category: 'draft',
      seo_title: null,
      seo_description: null,
      sort_order: 99,
      status: 'draft',
      updated_at: '2026-03-01T00:00:00',
      created_at: '2026-03-01T00:00:00',
    };

    const db = mockDB({
      'FROM faq WHERE id': { first: faqRow },
      'FROM faq_library_ref WHERE faq_id': { all: { results: [] } },
      'FROM faq_resource WHERE faq_id': { all: { results: [] } },
    });

    const env = mockEnv({ LIBRARY_BUILD_TOKEN: TOKEN, DB: db });
    const req = makeRequest({ url: 'https://rrmacademy.org/api/faqs?id=faq_003' });
    const wt = mockWaitUntil();
    const res = await onRequestGet(makeContext(req, env, wt));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.data);
    assert.equal(body.data.id, 'faq_003');
    assert.equal(body.data.status, 'draft');
    assert.equal(body.data.updatedAt, '2026-03-01T00:00:00');
    assert.ok(Array.isArray(body.data.libraryRefs));
    assert.ok(Array.isArray(body.data.evidence));
  });

  it('returns 404 for unknown id', async () => {
    const db = mockDB({
      'FROM faq WHERE id': { first: null },
    });

    const env = mockEnv({ LIBRARY_BUILD_TOKEN: TOKEN, DB: db });
    const req = makeRequest({ url: 'https://rrmacademy.org/api/faqs?id=faq_unknown' });
    const wt = mockWaitUntil();
    const res = await onRequestGet(makeContext(req, env, wt));
    const { status, body } = await parseResponse(res);

    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'not_found');
  });
});
