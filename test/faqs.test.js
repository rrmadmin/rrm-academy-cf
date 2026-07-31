/**
 * Tests for GET /api/faqs (functions/api/faqs.js)
 * Run with: node --test test/faqs.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestOptions } from '../functions/api/faqs.js';
import { mockRequest, mockDB, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1 } from './_d1-sqlite.mjs';

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

// --------------------------------------------- the ordering contract ---

/**
 * Everything above runs on mockDB(), which matches SQL by substring and hands
 * back a canned array. Under it an ORDER BY is a comment: the rows come back in
 * whatever order the fixture literal was written, so flipping
 * `ORDER BY sort_order ASC` to DESC in functions/api/faqs.js changes nothing.
 *
 * That order is a PUBLIC contract. The build consumes GET /api/faqs and renders
 * the FAQ page in the order it receives, so reversing it silently reorders a
 * published page and no test above would notice.
 *
 * These run the statement on a real SQLite engine instead. Rows are INSERTED in
 * an order that matches neither ASC nor DESC, which is what makes the assertion
 * bite three ways: ASC, DESC, and no ORDER BY at all (a rowid scan returns
 * insertion order) are three different sequences.
 */
describe('GET /api/faqs -- ordering and the published filter, on a real engine', () => {
  function seedOutOfOrder(s) {
    const rows = [
      // insertion order c, a, b -- deliberately neither sorted nor reversed
      { id: 'faq_c', slug: 'gamma', sort: 30, status: 'published' },
      { id: 'faq_a', slug: 'alpha', sort: 10, status: 'published' },
      { id: 'faq_b', slug: 'beta', sort: 20, status: 'published' },
      { id: 'faq_d', slug: 'delta', sort: 15, status: 'draft' },
      { id: 'faq_e', slug: 'epsilon', sort: 25, status: 'archived' },
    ];
    for (const r of rows) {
      s.prepare(
        'INSERT INTO faq (id, slug, question, category, sort_order, status) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(r.id, r.slug, `${r.slug}?`, 'basics', r.sort, r.status);
    }
    // Children of faq_a, also inserted against their sort_order.
    s.prepare('INSERT INTO faq_resource (faq_id, title, url, sort_order) VALUES (?, ?, ?, ?)')
      .run('faq_a', 'second', 'https://example.com/2', 20);
    s.prepare('INSERT INTO faq_resource (faq_id, title, url, sort_order) VALUES (?, ?, ?, ?)')
      .run('faq_a', 'first', 'https://example.com/1', 10);
    s.prepare('INSERT INTO faq_library_ref (faq_id, article_id, label, sort_order) VALUES (?, ?, ?, ?)')
      .run('faq_a', 'rec-second', 'B', 20);
    s.prepare('INSERT INTO faq_library_ref (faq_id, article_id, label, sort_order) VALUES (?, ?, ?, ?)')
      .run('faq_a', 'rec-first', 'A', 10);
  }

  async function listFaqs(harness, url = 'https://rrmacademy.org/api/faqs') {
    const env = mockEnv({ LIBRARY_BUILD_TOKEN: TOKEN, DB: harness });
    const res = await onRequestGet(makeContext(makeRequest({ url }), env, mockWaitUntil()));
    return parseResponse(res);
  }

  it('serves published FAQs in sort_order ASC, not insertion order and not reversed', async () => {
    const harness = sqliteD1({ seed: seedOutOfOrder });
    try {
      const { status, body } = await listFaqs(harness);
      assert.equal(status, 200);
      assert.deepEqual(
        body.results.map(r => r.slug),
        ['alpha', 'beta', 'gamma'],
        'ORDER BY sort_order ASC is the contract the FAQ page renders in',
      );
      assert.deepEqual(body.results.map(r => r.sortOrder), [10, 20, 30]);
    } finally {
      harness.close();
    }
  });

  it('omits every FAQ that is not published', async () => {
    const harness = sqliteD1({ seed: seedOutOfOrder });
    try {
      const { body } = await listFaqs(harness);
      const ids = body.results.map(r => r.id);
      assert.equal(ids.includes('faq_d'), false, 'a draft FAQ must not reach the public feed');
      assert.equal(ids.includes('faq_e'), false, 'an archived FAQ must not reach the public feed');
      assert.equal(ids.length, 3);
    } finally {
      harness.close();
    }
  });

  it('orders each FAQ resources and library refs by sort_order ASC too', async () => {
    const harness = sqliteD1({ seed: seedOutOfOrder });
    try {
      const { body } = await listFaqs(harness);
      const alpha = body.results.find(r => r.id === 'faq_a');
      assert.deepEqual(alpha.evidence.map(e => e.title), ['first', 'second']);
      assert.deepEqual(alpha.libraryRefs.map(r => r.articleId), ['rec-first', 'rec-second']);
    } finally {
      harness.close();
    }
  });

  it('orders the single-id lane children the same way', async () => {
    const harness = sqliteD1({ seed: seedOutOfOrder });
    try {
      const { status, body } = await listFaqs(harness, 'https://rrmacademy.org/api/faqs?id=faq_a');
      assert.equal(status, 200);
      assert.deepEqual(body.data.evidence.map(e => e.title), ['first', 'second']);
      assert.deepEqual(body.data.libraryRefs.map(r => r.articleId), ['rec-first', 'rec-second']);
    } finally {
      harness.close();
    }
  });

  it('serves a draft by id even though the list lane hides it', async () => {
    const harness = sqliteD1({ seed: seedOutOfOrder });
    try {
      const { status, body } = await listFaqs(harness, 'https://rrmacademy.org/api/faqs?id=faq_d');
      assert.equal(status, 200);
      assert.equal(body.data.id, 'faq_d');
      assert.equal(body.data.status, 'draft', 'the ?id= lane is the preview lane, any status');
    } finally {
      harness.close();
    }
  });

  it('returns an empty result set rather than 500 when nothing is published', async () => {
    const harness = sqliteD1({
      seed(s) {
        s.prepare('INSERT INTO faq (id, slug, question, category, status) VALUES (?, ?, ?, ?, ?)')
          .run('faq_only_draft', 'only-draft', 'Q?', 'basics', 'draft');
      },
    });
    try {
      const { status, body } = await listFaqs(harness);
      assert.equal(status, 200);
      assert.deepEqual(body.results, []);
    } finally {
      harness.close();
    }
  });
});

describe('OPTIONS /api/faqs -- CORS preflight', () => {
  it('answers 204 with no body, so a browser preflight never reaches the DB', () => {
    const res = onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.body, null, 'a 204 must not carry a body');
  });

  it('advertises the CORS headers the preflight is asking about', () => {
    const res = onRequestOptions();
    assert.ok(res.headers.get('Access-Control-Allow-Origin'), 'origin header is set');
    assert.match(
      res.headers.get('Access-Control-Allow-Methods') || '',
      /GET/,
      'GET is an advertised method',
    );
  });
});
