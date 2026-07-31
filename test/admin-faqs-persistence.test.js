/**
 * The FAQ surface end to end, on a REAL SQLite engine:
 *   functions/api/admin/faqs/index.js            (list + create)
 *   functions/api/admin/faqs/[id].js             (read + update + delete)
 *   functions/api/admin/faqs/[id]/resources.js   (evidence links)
 *   functions/api/admin/faqs/[id]/library-refs.js(library citations)
 *   functions/api/faqs.js                        (the public/build read)
 *
 * RELATIONSHIP TO test/admin-faqs.test.js
 * ---------------------------------------
 * That file already covers this surface under `mockDB` and is left alone. What
 * it proves is real: the 401/403 role ladder and the 400 validation ladder both
 * return before any query runs, so a canned DB is a fine stand-in there.
 *
 * What it CANNOT prove, and this file does, is every claim about stored state,
 * because mockDB matches SQL by substring and replays canned rows:
 *
 *   - "creates FAQ with valid input -- id starts with faq_, slug generated"
 *     reads `body.data` out of the canned `SELECT * FROM faq WHERE id` row,
 *     which the test itself defined as { id: 'faq_abc123', slug: 'what-is-rrm' }.
 *     Both assertions therefore describe the FIXTURE. Break slugify() outright
 *     and that test still passes; the create test below fails.
 *   - "updates partial fields" asserts `body.data.basicAnswer` against a canned
 *     `updatedRow` the test supplied, so it proves the mock echoes, not that
 *     the UPDATE wrote anything.
 *   - the DELETE tests assert a 200/404 status but cannot observe that the row
 *     (or its children) actually left the table.
 *
 * The child-cleanup case matters most: foreign keys are DISABLED in D1 and in
 * this harness, so `ON DELETE CASCADE` in schema.sql does nothing at runtime.
 * The explicit three-statement batch in [id].js is the only thing preventing
 * orphaned faq_resource / faq_library_ref rows, and only a real engine can show
 * that it works.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1 } from './_d1-sqlite.mjs';
import { onRequestGet as listGet, onRequestPost as createPost, onRequestOptions as listOptions } from '../functions/api/admin/faqs/index.js';
import {
  onRequestGet as oneGet,
  onRequestPut as onePut,
  onRequestDelete as oneDelete,
  onRequestOptions as oneOptions,
} from '../functions/api/admin/faqs/[id].js';
import {
  onRequestPost as resourcePost,
  onRequestDelete as resourceDelete,
  onRequestOptions as resourceOptions,
} from '../functions/api/admin/faqs/[id]/resources.js';
import {
  onRequestPost as refPost,
  onRequestDelete as refDelete,
  onRequestOptions as refOptions,
} from '../functions/api/admin/faqs/[id]/library-refs.js';
import { onRequestGet as publicFaqsGet } from '../functions/api/faqs.js';

const SITE = 'https://rrmacademy.org';
const ADMIN = { id: 'u_admin', email: 'admin@test.com', role: 'admin' };
const SUPERADMIN = { id: 'u_super', email: 'super@test.com', role: 'superadmin' };
const MEMBER = { id: 'u_member', email: 'member@test.com', role: 'member' };
const BUILD_TOKEN = 'library-build-token';

function db(opts) {
  return sqliteD1(opts);
}

function ctx(method, { url = `${SITE}/api/admin/faqs`, body, headers, user, params = {}, env } = {}) {
  return {
    request: mockRequest(method, { url, body, headers }),
    env,
    waitUntil: mockWaitUntil(),
    data: user ? { user } : {},
    params,
  };
}

function envWith(harness, overrides = {}) {
  return mockEnv({ DB: harness, LIBRARY_BUILD_TOKEN: BUILD_TOKEN, ...overrides });
}

function seedFaq(sqlite, { id, slug, question = 'Q?', category = 'Foundational', status = 'draft', sortOrder = 0, ...rest }) {
  sqlite.prepare(
    `INSERT INTO faq (id, faq_code, slug, question, basic_answer, schema_answer, published_answer,
       category, seo_title, seo_description, sort_order, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    rest.faqCode ?? null,
    slug,
    question,
    rest.basicAnswer ?? null,
    rest.schemaAnswer ?? null,
    rest.publishedAnswer ?? null,
    category,
    rest.seoTitle ?? null,
    rest.seoDescription ?? null,
    sortOrder,
    status,
  );
}

function seedResource(sqlite, { faqId, title, url, sortOrder = 0 }) {
  sqlite.prepare(
    'INSERT INTO faq_resource (faq_id, title, url, sort_order) VALUES (?, ?, ?, ?)'
  ).run(faqId, title, url, sortOrder);
}

function seedRef(sqlite, { faqId, articleId, label = null, sortOrder = 0 }) {
  sqlite.prepare(
    'INSERT INTO faq_library_ref (faq_id, article_id, label, sort_order) VALUES (?, ?, ?, ?)'
  ).run(faqId, articleId, label, sortOrder);
}

const rows = (h, sql, ...binds) => h._sqlite.prepare(sql).all(...binds).map(r => ({ ...r }));
const one = (h, sql, ...binds) => {
  const r = h._sqlite.prepare(sql).get(...binds);
  return r ? { ...r } : null;
};

// ================================================================ create ===

describe('POST /api/admin/faqs -- what actually lands in the table', () => {
  it('persists the row and DERIVES the slug from the question', async () => {
    const harness = db();
    try {
      const res = await createPost(ctx('POST', {
        body: { question: "What is Restorative Reproductive Medicine?", category: 'Foundational' },
        user: ADMIN,
        env: envWith(harness),
      }));
      const { status, body } = await parseResponse(res);
      assert.equal(status, 201);

      const stored = one(harness, 'SELECT * FROM faq WHERE id = ?', body.data.id);
      assert.ok(stored, 'the FAQ was actually inserted');
      assert.equal(
        stored.slug,
        'what-is-restorative-reproductive-medicine',
        'slug is generated from the question, not echoed from a fixture',
      );
      assert.equal(stored.question, 'What is Restorative Reproductive Medicine?');
      assert.equal(stored.category, 'Foundational');
      assert.ok(stored.id.startsWith('faq_'), 'the STORED id carries the faq_ prefix');
      assert.equal(body.data.slug, stored.slug, 'the response mirrors the stored row');
    } finally {
      harness.close();
    }
  });

  it('strips punctuation and collapses runs when slugifying', async () => {
    const harness = db();
    try {
      const { body } = await parseResponse(await createPost(ctx('POST', {
        body: { question: "  Doesn't   RRM -- really -- work?!  ", category: 'Common Concerns' },
        user: ADMIN,
        env: envWith(harness),
      })));
      const stored = one(harness, 'SELECT * FROM faq WHERE id = ?', body.data.id);
      assert.equal(stored.slug, 'doesnt-rrm-really-work');
      assert.ok(!stored.slug.startsWith('-') && !stored.slug.endsWith('-'), 'no leading or trailing dash');
    } finally {
      harness.close();
    }
  });

  it('caps the stored slug at 80 characters', async () => {
    const harness = db();
    try {
      const question = `${'word '.repeat(40)}end`;
      const { body } = await parseResponse(await createPost(ctx('POST', {
        body: { question, category: 'Foundational' },
        user: ADMIN,
        env: envWith(harness),
      })));
      const stored = one(harness, 'SELECT * FROM faq WHERE id = ?', body.data.id);
      assert.ok(stored.slug.length <= 80, `slug length ${stored.slug.length} exceeds 80`);
    } finally {
      harness.close();
    }
  });

  it('returns 409 when the derived slug collides with an existing FAQ', async () => {
    // faq.slug is UNIQUE COLLATE NOCASE in schema.sql, so the engine, not the
    // handler, raises this. Only a real engine can produce it.
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_seed', slug: 'what-is-rrm', question: 'What is RRM?' }); } });
    try {
      const { status, body } = await parseResponse(await createPost(ctx('POST', {
        body: { question: 'What is RRM?', category: 'Foundational' },
        user: ADMIN,
        env: envWith(harness),
      })));
      assert.equal(status, 409);
      assert.equal(body.error, 'slug_already_exists');
      assert.equal(rows(harness, 'SELECT * FROM faq').length, 1, 'no duplicate row was written');
    } finally {
      harness.close();
    }
  });

  it('collides case-insensitively, because the UNIQUE index is NOCASE', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_seed', slug: 'what-is-rrm' }); } });
    try {
      const { status } = await parseResponse(await createPost(ctx('POST', {
        body: { question: 'WHAT IS RRM', category: 'Foundational' },
        user: ADMIN,
        env: envWith(harness),
      })));
      assert.equal(status, 409, 'an upper-case question slugifies onto the same NOCASE key');
    } finally {
      harness.close();
    }
  });

  it('stores status=draft by default and honours an explicit status', async () => {
    const harness = db();
    try {
      const env = envWith(harness);
      const a = await parseResponse(await createPost(ctx('POST', {
        body: { question: 'Default status question', category: 'Foundational' }, user: ADMIN, env,
      })));
      const b = await parseResponse(await createPost(ctx('POST', {
        body: { question: 'Explicit status question', category: 'Foundational', status: 'published' }, user: ADMIN, env,
      })));
      assert.equal(one(harness, 'SELECT * FROM faq WHERE id = ?', a.body.data.id).status, 'draft');
      assert.equal(one(harness, 'SELECT * FROM faq WHERE id = ?', b.body.data.id).status, 'published');
    } finally {
      harness.close();
    }
  });

  it('rejects a status outside the enum before writing', async () => {
    const harness = db();
    try {
      const { status, body } = await parseResponse(await createPost(ctx('POST', {
        body: { question: 'Bad status', category: 'Foundational', status: 'live' },
        user: ADMIN,
        env: envWith(harness),
      })));
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_status');
      assert.equal(rows(harness, 'SELECT * FROM faq').length, 0, 'nothing was written');
    } finally {
      harness.close();
    }
  });

  it('persists optional fields verbatim, defaulting the absent ones to NULL', async () => {
    const harness = db();
    try {
      const { body } = await parseResponse(await createPost(ctx('POST', {
        body: {
          question: 'Optional fields question',
          category: 'Condition-Specific',
          basicAnswer: 'BASIC',
          schemaAnswer: 'SCHEMA',
          publishedAnswer: 'PUBLISHED',
          seoTitle: 'SEO TITLE',
          seoDescription: 'SEO DESC',
          sortOrder: 7,
          faqCode: 'CODE-1',
        },
        user: ADMIN,
        env: envWith(harness),
      })));
      const stored = one(harness, 'SELECT * FROM faq WHERE id = ?', body.data.id);
      assert.equal(stored.basic_answer, 'BASIC');
      assert.equal(stored.schema_answer, 'SCHEMA');
      assert.equal(stored.published_answer, 'PUBLISHED');
      assert.equal(stored.seo_title, 'SEO TITLE');
      assert.equal(stored.seo_description, 'SEO DESC');
      assert.equal(stored.sort_order, 7);
      assert.equal(stored.faq_code, 'CODE-1');
    } finally {
      harness.close();
    }
  });

  it('defaults sort_order to 0 when sortOrder is not a number', async () => {
    const harness = db();
    try {
      const { body } = await parseResponse(await createPost(ctx('POST', {
        body: { question: 'String sort order', category: 'Foundational', sortOrder: '9' },
        user: ADMIN,
        env: envWith(harness),
      })));
      assert.equal(one(harness, 'SELECT * FROM faq WHERE id = ?', body.data.id).sort_order, 0);
    } finally {
      harness.close();
    }
  });

  for (const [field, len, err] of [
    ['basicAnswer', 50001, 'basicAnswer_too_long'],
    ['schemaAnswer', 5001, 'schemaAnswer_too_long'],
    ['publishedAnswer', 100001, 'publishedAnswer_too_long'],
    ['seoTitle', 201, 'seoTitle_too_long'],
    ['seoDescription', 501, 'seoDescription_too_long'],
    ['faqCode', 51, 'faqCode_too_long'],
  ]) {
    it(`rejects an over-length ${field} before writing`, async () => {
      const harness = db();
      try {
        const { status, body } = await parseResponse(await createPost(ctx('POST', {
          body: { question: 'Length check', category: 'Foundational', [field]: 'x'.repeat(len) },
          user: ADMIN,
          env: envWith(harness),
        })));
        assert.equal(status, 400);
        assert.equal(body.error, err);
        assert.equal(rows(harness, 'SELECT * FROM faq').length, 0);
      } finally {
        harness.close();
      }
    });
  }

  it('rejects an over-length question', async () => {
    const harness = db();
    try {
      const { status, body } = await parseResponse(await createPost(ctx('POST', {
        body: { question: 'q'.repeat(501), category: 'Foundational' },
        user: ADMIN,
        env: envWith(harness),
      })));
      assert.equal(status, 400);
      assert.equal(body.error, 'question_too_long');
    } finally {
      harness.close();
    }
  });

  it('rejects a non-object JSON body', async () => {
    const harness = db();
    try {
      const { status, body } = await parseResponse(await createPost(ctx('POST', {
        body: ['not', 'an', 'object'],
        user: ADMIN,
        env: envWith(harness),
      })));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid payload');
    } finally {
      harness.close();
    }
  });

  it('rejects malformed JSON', async () => {
    const harness = db();
    try {
      const context = ctx('POST', { user: ADMIN, env: envWith(harness) });
      context.request.json = async () => { throw new SyntaxError('bad json'); };
      const { status, body } = await parseResponse(await createPost(context));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid JSON');
    } finally {
      harness.close();
    }
  });

  it('returns 503 when the DB binding is missing', async () => {
    const { status, body } = await parseResponse(await createPost(ctx('POST', {
      body: { question: 'No DB', category: 'Foundational' },
      user: ADMIN,
      env: mockEnv({ DB: undefined }),
    })));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('returns 500 and writes nothing when the INSERT throws a non-UNIQUE error', async () => {
    const harness = db();
    harness.prepare = () => { throw new Error('D1_ERROR: disk full'); };
    try {
      const { status, body } = await parseResponse(await createPost(ctx('POST', {
        body: { question: 'Insert explodes', category: 'Foundational' },
        user: ADMIN,
        env: envWith(harness),
      })));
      assert.equal(status, 500);
      assert.equal(body.error, 'Internal error');
      assert.doesNotMatch(JSON.stringify(body), /disk full/);
    } finally {
      harness.close();
    }
  });

  it('still returns 201 with a synthesised body when the read-back fails', async () => {
    // The row is committed at this point; failing to re-read it must not tell
    // the caller the create failed, or an admin retries and hits the 409.
    const harness = db();
    const real = harness.prepare.bind(harness);
    harness.prepare = (sql) => {
      if (sql.includes('SELECT * FROM faq WHERE id')) {
        return { bind: () => ({ first: async () => { throw new Error('D1_ERROR: read-back down'); } }) };
      }
      return real(sql);
    };
    try {
      const { status, body } = await parseResponse(await createPost(ctx('POST', {
        body: { question: 'Read back fails', category: 'Foundational' },
        user: ADMIN,
        env: envWith(harness),
      })));
      assert.equal(status, 201);
      assert.equal(body.ok, true);
      assert.equal(body.data.slug, 'read-back-fails');
      assert.equal(rows(harness, 'SELECT * FROM faq').length, 1, 'the row really is committed');
    } finally {
      harness.close();
    }
  });

  it('answers OPTIONS with 204', () => {
    assert.equal(listOptions().status, 204);
    assert.equal(oneOptions().status, 204);
    assert.equal(resourceOptions().status, 204);
    assert.equal(refOptions().status, 204);
  });
});

// ================================================================== list ===

describe('GET /api/admin/faqs -- the list joins children onto the right parent', () => {
  it('attaches each FAQ its OWN resources and refs, never another FAQ\'s', async () => {
    const harness = db({
      seed(s) {
        seedFaq(s, { id: 'faq_a', slug: 'a', question: 'A?', sortOrder: 1 });
        seedFaq(s, { id: 'faq_b', slug: 'b', question: 'B?', sortOrder: 2 });
        seedResource(s, { faqId: 'faq_a', title: 'A resource', url: 'https://a.example' });
        seedResource(s, { faqId: 'faq_b', title: 'B resource', url: 'https://b.example' });
        seedRef(s, { faqId: 'faq_a', articleId: 'art_a', label: 'A ref' });
        seedRef(s, { faqId: 'faq_b', articleId: 'art_b', label: 'B ref' });
      },
    });
    try {
      const { status, body } = await parseResponse(await listGet(ctx('GET', { user: ADMIN, env: envWith(harness) })));
      assert.equal(status, 200);
      const a = body.results.find(r => r.id === 'faq_a');
      const b = body.results.find(r => r.id === 'faq_b');
      assert.deepEqual(a.evidence.map(e => e.title), ['A resource']);
      assert.deepEqual(b.evidence.map(e => e.title), ['B resource']);
      assert.deepEqual(a.libraryRefs.map(r => r.articleId), ['art_a']);
      assert.deepEqual(b.libraryRefs.map(r => r.articleId), ['art_b']);
    } finally {
      harness.close();
    }
  });

  it('orders by sort_order ASC', async () => {
    const harness = db({
      seed(s) {
        seedFaq(s, { id: 'faq_third', slug: 'c', sortOrder: 30 });
        seedFaq(s, { id: 'faq_first', slug: 'a', sortOrder: 10 });
        seedFaq(s, { id: 'faq_second', slug: 'b', sortOrder: 20 });
      },
    });
    try {
      const { body } = await parseResponse(await listGet(ctx('GET', { user: ADMIN, env: envWith(harness) })));
      assert.deepEqual(body.results.map(r => r.id), ['faq_first', 'faq_second', 'faq_third']);
    } finally {
      harness.close();
    }
  });

  it('gives a childless FAQ empty arrays rather than undefined', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_lonely', slug: 'lonely' }); } });
    try {
      const { body } = await parseResponse(await listGet(ctx('GET', { user: ADMIN, env: envWith(harness) })));
      assert.deepEqual(body.results[0].evidence, []);
      assert.deepEqual(body.results[0].libraryRefs, []);
    } finally {
      harness.close();
    }
  });

  it('returns an empty list for an empty table', async () => {
    const harness = db();
    try {
      const { status, body } = await parseResponse(await listGet(ctx('GET', { user: ADMIN, env: envWith(harness) })));
      assert.equal(status, 200);
      assert.deepEqual(body.results, []);
    } finally {
      harness.close();
    }
  });

  it('rejects an anonymous caller and a non-admin role', async () => {
    const harness = db();
    try {
      const env = envWith(harness);
      const anon = await parseResponse(await listGet(ctx('GET', { env })));
      assert.equal(anon.status, 401);
      const member = await parseResponse(await listGet(ctx('GET', { user: MEMBER, env })));
      assert.equal(member.status, 403);
    } finally {
      harness.close();
    }
  });

  it('returns 503 without a DB binding and 500 when the query throws', async () => {
    const noDb = await parseResponse(await listGet(ctx('GET', { user: ADMIN, env: mockEnv({ DB: undefined }) })));
    assert.equal(noDb.status, 503);

    const harness = db();
    harness.prepare = () => { throw new Error('D1_ERROR: list down'); };
    try {
      const { status, body } = await parseResponse(await listGet(ctx('GET', { user: ADMIN, env: envWith(harness) })));
      assert.equal(status, 500);
      assert.doesNotMatch(JSON.stringify(body), /list down/);
    } finally {
      harness.close();
    }
  });
});

// ============================================================ read by id ===

describe('GET /api/admin/faqs/[id] -- single read with children', () => {
  it('returns the stored row and its children in sort_order', async () => {
    const harness = db({
      seed(s) {
        seedFaq(s, { id: 'faq_x', slug: 'x', question: 'X?', basicAnswer: 'BASIC', status: 'published', sortOrder: 4 });
        seedResource(s, { faqId: 'faq_x', title: 'Second', url: 'https://2.example', sortOrder: 2 });
        seedResource(s, { faqId: 'faq_x', title: 'First', url: 'https://1.example', sortOrder: 1 });
        seedRef(s, { faqId: 'faq_x', articleId: 'art_2', sortOrder: 2 });
        seedRef(s, { faqId: 'faq_x', articleId: 'art_1', sortOrder: 1 });
      },
    });
    try {
      const { status, body } = await parseResponse(await oneGet(ctx('GET', {
        user: ADMIN, env: envWith(harness), params: { id: 'faq_x' },
      })));
      assert.equal(status, 200);
      assert.equal(body.data.question, 'X?');
      assert.equal(body.data.basicAnswer, 'BASIC');
      assert.equal(body.data.status, 'published');
      assert.deepEqual(body.data.evidence.map(e => e.title), ['First', 'Second']);
      assert.deepEqual(body.data.libraryRefs.map(r => r.articleId), ['art_1', 'art_2']);
    } finally {
      harness.close();
    }
  });

  it('returns 404 for an id that is not in the table', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_x', slug: 'x' }); } });
    try {
      const { status, body } = await parseResponse(await oneGet(ctx('GET', {
        user: ADMIN, env: envWith(harness), params: { id: 'faq_missing' },
      })));
      assert.equal(status, 404);
      assert.equal(body.error, 'not_found');
    } finally {
      harness.close();
    }
  });

  it('rejects a missing or over-length id', async () => {
    const harness = db();
    try {
      const env = envWith(harness);
      const none = await parseResponse(await oneGet(ctx('GET', { user: ADMIN, env, params: {} })));
      assert.equal(none.status, 400);
      const long = await parseResponse(await oneGet(ctx('GET', { user: ADMIN, env, params: { id: 'x'.repeat(101) } })));
      assert.equal(long.status, 400);
      assert.equal(long.body.error, 'Invalid id');
    } finally {
      harness.close();
    }
  });

  it('enforces the role ladder and the DB binding', async () => {
    const harness = db();
    try {
      const env = envWith(harness);
      assert.equal((await parseResponse(await oneGet(ctx('GET', { env, params: { id: 'faq_x' } })))).status, 401);
      assert.equal((await parseResponse(await oneGet(ctx('GET', { user: MEMBER, env, params: { id: 'faq_x' } })))).status, 403);
      const noDb = await parseResponse(await oneGet(ctx('GET', {
        user: ADMIN, env: mockEnv({ DB: undefined }), params: { id: 'faq_x' },
      })));
      assert.equal(noDb.status, 503);
    } finally {
      harness.close();
    }
  });

  it('returns 500 when the read throws', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_x', slug: 'x' }); } });
    harness.prepare = () => { throw new Error('D1_ERROR: read down'); };
    try {
      const { status } = await parseResponse(await oneGet(ctx('GET', {
        user: ADMIN, env: envWith(harness), params: { id: 'faq_x' },
      })));
      assert.equal(status, 500);
    } finally {
      harness.close();
    }
  });
});

// =============================================================== update ===

describe('PUT /api/admin/faqs/[id] -- the UPDATE actually changes the row', () => {
  it('writes only the supplied field and leaves the rest intact', async () => {
    const harness = db({
      seed(s) {
        seedFaq(s, {
          id: 'faq_u', slug: 'u', question: 'Original?', category: 'Foundational',
          basicAnswer: 'OLD', seoTitle: 'KEEP ME', status: 'draft',
        });
      },
    });
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { basicAnswer: 'NEW' },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 200);

      const stored = one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_u');
      assert.equal(stored.basic_answer, 'NEW', 'the column really changed');
      assert.equal(stored.seo_title, 'KEEP ME', 'an untouched column is untouched');
      assert.equal(stored.question, 'Original?');
      assert.equal(stored.slug, 'u', 'slug is not rewritten when question is absent');
      assert.equal(body.data.basicAnswer, 'NEW');
    } finally {
      harness.close();
    }
  });

  it('re-derives the slug when the question changes', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'old-slug', question: 'Old?' }); } });
    try {
      await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { question: 'A Brand New Question?' },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_u' },
      }));
      const stored = one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_u');
      assert.equal(stored.question, 'A Brand New Question?');
      assert.equal(stored.slug, 'a-brand-new-question', 'the slug follows the question');
    } finally {
      harness.close();
    }
  });

  it('returns 409 when the new question slugs onto another FAQ', async () => {
    const harness = db({
      seed(s) {
        seedFaq(s, { id: 'faq_1', slug: 'taken-slug', question: 'Taken slug?' });
        seedFaq(s, { id: 'faq_2', slug: 'free-slug', question: 'Free slug?' });
      },
    });
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_2`,
        body: { question: 'Taken slug?' },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_2' },
      })));
      assert.equal(status, 409);
      assert.equal(body.error, 'slug_already_exists');
      assert.equal(one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_2').slug, 'free-slug', 'unchanged');
    } finally {
      harness.close();
    }
  });

  it('updates every mapped field in one call', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u', question: 'Q?' }); } });
    try {
      await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: {
          category: 'Common Concerns',
          basicAnswer: 'B',
          schemaAnswer: 'S',
          publishedAnswer: 'P',
          seoTitle: 'T',
          seoDescription: 'D',
          sortOrder: 42,
          status: 'archived',
          faqCode: 'C9',
        },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_u' },
      }));
      const stored = one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_u');
      assert.equal(stored.category, 'Common Concerns');
      assert.equal(stored.basic_answer, 'B');
      assert.equal(stored.schema_answer, 'S');
      assert.equal(stored.published_answer, 'P');
      assert.equal(stored.seo_title, 'T');
      assert.equal(stored.seo_description, 'D');
      assert.equal(stored.sort_order, 42);
      assert.equal(stored.status, 'archived');
      assert.equal(stored.faq_code, 'C9');
    } finally {
      harness.close();
    }
  });

  it('returns 404 and writes nothing when the id does not exist', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_real', slug: 'real', basicAnswer: 'UNCHANGED' }); } });
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_ghost`,
        body: { basicAnswer: 'HELLO' },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_ghost' },
      })));
      assert.equal(status, 404);
      assert.equal(body.error, 'not_found');
      assert.equal(one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_real').basic_answer, 'UNCHANGED');
    } finally {
      harness.close();
    }
  });

  it('returns 400 when no known field is supplied', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u' }); } });
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { notAField: 'x' },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 400);
      assert.equal(body.error, 'no_fields_provided');
    } finally {
      harness.close();
    }
  });

  it('rejects an empty question rather than storing a blank slug', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u', question: 'Keep?' }); } });
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { question: '   ' },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 400);
      assert.equal(body.error, 'question_required');
      assert.equal(one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_u').question, 'Keep?');
    } finally {
      harness.close();
    }
  });

  for (const [field, len, err] of [
    ['basicAnswer', 50001, 'basicAnswer_too_long'],
    ['schemaAnswer', 5001, 'schemaAnswer_too_long'],
    ['publishedAnswer', 100001, 'publishedAnswer_too_long'],
    ['seoTitle', 201, 'seoTitle_too_long'],
    ['seoDescription', 501, 'seoDescription_too_long'],
    ['faqCode', 51, 'faqCode_too_long'],
    ['question', 501, 'question_too_long'],
  ]) {
    it(`rejects an over-length ${field} on update`, async () => {
      const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u' }); } });
      try {
        const { status, body } = await parseResponse(await onePut(ctx('PUT', {
          url: `${SITE}/api/admin/faqs/faq_u`,
          body: { [field]: 'x'.repeat(len) },
          user: ADMIN,
          env: envWith(harness),
          params: { id: 'faq_u' },
        })));
        assert.equal(status, 400);
        assert.equal(body.error, err);
      } finally {
        harness.close();
      }
    });
  }

  it('rejects an invalid status on update', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u' }); } });
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { status: 'nope' },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_status');
    } finally {
      harness.close();
    }
  });

  it('rejects malformed JSON and a non-object payload', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u' }); } });
    try {
      const env = envWith(harness);
      const bad = ctx('PUT', { url: `${SITE}/api/admin/faqs/faq_u`, user: ADMIN, env, params: { id: 'faq_u' } });
      bad.request.json = async () => { throw new SyntaxError('nope'); };
      assert.equal((await parseResponse(await onePut(bad))).body.error, 'Invalid JSON');

      const arr = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`, body: [1, 2], user: ADMIN, env, params: { id: 'faq_u' },
      })));
      assert.equal(arr.body.error, 'Invalid payload');
    } finally {
      harness.close();
    }
  });

  it('returns 500 when the UPDATE throws a non-UNIQUE error', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u' }); } });
    const real = harness.prepare.bind(harness);
    harness.prepare = (sql) => {
      if (sql.startsWith('UPDATE faq SET')) {
        return { bind: () => ({ run: async () => { throw new Error('D1_ERROR: write down'); } }) };
      }
      return real(sql);
    };
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { basicAnswer: 'x' },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 500);
      assert.doesNotMatch(JSON.stringify(body), /write down/);
    } finally {
      harness.close();
    }
  });

  it('rejects a bad id and a missing DB before parsing the body', async () => {
    const harness = db();
    try {
      const long = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/x`, body: { basicAnswer: 'x' }, user: ADMIN,
        env: envWith(harness), params: { id: 'x'.repeat(101) },
      })));
      assert.equal(long.status, 400);
      assert.equal(long.body.error, 'Invalid id');

      const noDb = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`, body: { basicAnswer: 'x' }, user: ADMIN,
        env: mockEnv({ DB: undefined }), params: { id: 'faq_u' },
      })));
      assert.equal(noDb.status, 503);
    } finally {
      harness.close();
    }
  });
});

// ------------------------------------------------- PUT: the bearer lane ---

describe('PUT /api/admin/faqs/[id] -- the ADMIN_API_SECRET bearer lane', () => {
  it('authorises a correct bearer token with NO session user at all', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u', basicAnswer: 'OLD' }); } });
    try {
      const { status } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { basicAnswer: 'VIA BEARER' },
        headers: { Authorization: 'Bearer super-secret' },
        env: envWith(harness, { ADMIN_API_SECRET: 'super-secret' }),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 200);
      assert.equal(one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_u').basic_answer, 'VIA BEARER');
    } finally {
      harness.close();
    }
  });

  it('rejects a wrong bearer token even when a valid admin session is present', async () => {
    // The bearer branch is terminal: presenting Authorization: Bearer commits
    // the caller to that lane, so a bad secret must not fall back to the cookie.
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u', basicAnswer: 'OLD' }); } });
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { basicAnswer: 'SHOULD NOT LAND' },
        headers: { Authorization: 'Bearer wrong-secret' },
        user: ADMIN,
        env: envWith(harness, { ADMIN_API_SECRET: 'super-secret' }),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 401);
      assert.equal(body.error, 'Unauthorized');
      assert.equal(one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_u').basic_answer, 'OLD');
    } finally {
      harness.close();
    }
  });

  // The length guard in [id].js is
  //   let mismatch = authBytes.length !== expectedBytes.length ? 1 : 0;
  // followed by an XOR loop over min(len). Drop it, start mismatch at 0, and
  // the loop compares only the overlap, so ANY string that shares a prefix with
  // the real header authenticates. A token that merely differs at some byte
  // (say "Bearer short" against "Bearer a-much-longer-secret") does not test
  // this at all: it is rejected by the XOR either way. The two below differ
  // from the correct header ONLY in length, in each direction, so they are the
  // pair that actually holds the guard.
  it('rejects a bearer token TRUNCATED to a prefix of the real secret (the length guard)', async () => {
    const SECRET = 'a-much-longer-secret';
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u', basicAnswer: 'OLD' }); } });
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { basicAnswer: 'PREFIX MUST NOT LAND' },
        headers: { Authorization: `Bearer ${SECRET.slice(0, 6)}` },
        env: envWith(harness, { ADMIN_API_SECRET: SECRET }),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 401);
      assert.equal(body.error, 'Unauthorized');
      assert.equal(
        one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_u').basic_answer,
        'OLD',
        'a prefix of the secret must not be able to write',
      );
    } finally {
      harness.close();
    }
  });

  it('rejects a bearer token that is the real secret plus a suffix (the length guard, other direction)', async () => {
    const SECRET = 'a-much-longer-secret';
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u', basicAnswer: 'OLD' }); } });
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { basicAnswer: 'SUFFIX MUST NOT LAND' },
        headers: { Authorization: `Bearer ${SECRET}-and-then-some` },
        env: envWith(harness, { ADMIN_API_SECRET: SECRET }),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 401);
      assert.equal(body.error, 'Unauthorized');
      assert.equal(
        one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_u').basic_answer,
        'OLD',
        'an extension of the secret must not be able to write',
      );
    } finally {
      harness.close();
    }
  });

  it('rejects a bearer token of the same length that differs mid-string (the XOR loop)', async () => {
    const SECRET = 'a-much-longer-secret';
    const wrong = 'a-much-longer-sECRET';
    assert.equal(wrong.length, SECRET.length, 'this case must isolate the XOR, not the length guard');
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u', basicAnswer: 'OLD' }); } });
    try {
      const { status } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { basicAnswer: 'MUST NOT LAND' },
        headers: { Authorization: `Bearer ${wrong}` },
        env: envWith(harness, { ADMIN_API_SECRET: SECRET }),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 401);
      assert.equal(one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_u').basic_answer, 'OLD');
    } finally {
      harness.close();
    }
  });

  it('returns 503 when a bearer is presented but ADMIN_API_SECRET is unset', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u' }); } });
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { basicAnswer: 'x' },
        headers: { Authorization: 'Bearer anything' },
        env: envWith(harness, { ADMIN_API_SECRET: undefined }),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 503);
      assert.equal(body.error, 'Server misconfigured');
    } finally {
      harness.close();
    }
  });

  it('falls through to the session ladder when the header is not a Bearer', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u' }); } });
    try {
      const { status, body } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { basicAnswer: 'x' },
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
        env: envWith(harness, { ADMIN_API_SECRET: 'super-secret' }),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 401, 'no session and a non-Bearer header is unauthorized');
      assert.equal(body.error, 'Unauthorized');
    } finally {
      harness.close();
    }
  });

  it('rejects a member session on the non-bearer lane', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u' }); } });
    try {
      const { status } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { basicAnswer: 'x' },
        user: MEMBER,
        env: envWith(harness),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 403);
    } finally {
      harness.close();
    }
  });

  it('accepts a superadmin session', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_u', slug: 'u' }); } });
    try {
      const { status } = await parseResponse(await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_u`,
        body: { basicAnswer: 'BY SUPER' },
        user: SUPERADMIN,
        env: envWith(harness),
        params: { id: 'faq_u' },
      })));
      assert.equal(status, 200);
      assert.equal(one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_u').basic_answer, 'BY SUPER');
    } finally {
      harness.close();
    }
  });
});

// =============================================================== delete ===

describe('DELETE /api/admin/faqs/[id] -- children go with the parent', () => {
  it('removes the FAQ AND its resources and refs, leaving no orphans', async () => {
    // Foreign keys are off in D1 and in this harness, so ON DELETE CASCADE is
    // inert. The explicit batch in [id].js is the only cleanup there is.
    const harness = db({
      seed(s) {
        seedFaq(s, { id: 'faq_doomed', slug: 'doomed' });
        seedFaq(s, { id: 'faq_keep', slug: 'keep' });
        seedResource(s, { faqId: 'faq_doomed', title: 'R1', url: 'https://r1.example' });
        seedResource(s, { faqId: 'faq_keep', title: 'R2', url: 'https://r2.example' });
        seedRef(s, { faqId: 'faq_doomed', articleId: 'art_1' });
        seedRef(s, { faqId: 'faq_keep', articleId: 'art_2' });
      },
    });
    try {
      const { status, body } = await parseResponse(await oneDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_doomed`,
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_doomed' },
      })));
      assert.equal(status, 200);
      assert.equal(body.ok, true);

      assert.equal(one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_doomed'), null, 'parent gone');
      assert.equal(rows(harness, 'SELECT * FROM faq_resource WHERE faq_id = ?', 'faq_doomed').length, 0, 'no orphan resources');
      assert.equal(rows(harness, 'SELECT * FROM faq_library_ref WHERE faq_id = ?', 'faq_doomed').length, 0, 'no orphan refs');

      assert.ok(one(harness, 'SELECT * FROM faq WHERE id = ?', 'faq_keep'), 'the other FAQ survives');
      assert.equal(rows(harness, 'SELECT * FROM faq_resource WHERE faq_id = ?', 'faq_keep').length, 1, 'its resource survives');
      assert.equal(rows(harness, 'SELECT * FROM faq_library_ref WHERE faq_id = ?', 'faq_keep').length, 1, 'its ref survives');
    } finally {
      harness.close();
    }
  });

  it('returns 404 and deletes nothing for an unknown id', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_real', slug: 'real' }); } });
    try {
      const { status, body } = await parseResponse(await oneDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_ghost`,
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_ghost' },
      })));
      assert.equal(status, 404);
      assert.equal(body.error, 'not_found');
      assert.equal(rows(harness, 'SELECT * FROM faq').length, 1, 'the real FAQ is untouched');
    } finally {
      harness.close();
    }
  });

  it('enforces the role ladder, the id guard, and the DB binding', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_x', slug: 'x' }); } });
    try {
      const env = envWith(harness);
      assert.equal((await parseResponse(await oneDelete(ctx('DELETE', { env, params: { id: 'faq_x' } })))).status, 401);
      assert.equal((await parseResponse(await oneDelete(ctx('DELETE', { user: MEMBER, env, params: { id: 'faq_x' } })))).status, 403);
      assert.equal((await parseResponse(await oneDelete(ctx('DELETE', { user: ADMIN, env, params: { id: 'x'.repeat(101) } })))).status, 400);
      const noDb = await parseResponse(await oneDelete(ctx('DELETE', {
        user: ADMIN, env: mockEnv({ DB: undefined }), params: { id: 'faq_x' },
      })));
      assert.equal(noDb.status, 503);
      assert.equal(rows(harness, 'SELECT * FROM faq').length, 1, 'no rejected call deleted anything');
    } finally {
      harness.close();
    }
  });

  it('returns 500 when the delete batch throws', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_x', slug: 'x' }); } });
    harness.batch = async () => { throw new Error('D1_ERROR: batch down'); };
    try {
      const { status, body } = await parseResponse(await oneDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_x`,
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_x' },
      })));
      assert.equal(status, 500);
      assert.doesNotMatch(JSON.stringify(body), /batch down/);
    } finally {
      harness.close();
    }
  });
});

// ============================================================ resources ===

describe('POST/DELETE /api/admin/faqs/[id]/resources -- evidence links', () => {
  it('inserts the resource against the FAQ in the path', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_r', slug: 'r' }); } });
    try {
      const { status, body } = await parseResponse(await resourcePost(ctx('POST', {
        url: `${SITE}/api/admin/faqs/faq_r/resources`,
        body: { title: '  A study  ', url: '  https://pubmed.example/1  ', sortOrder: 3 },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_r' },
      })));
      assert.equal(status, 201);
      assert.equal(body.created, true);

      const stored = rows(harness, 'SELECT * FROM faq_resource WHERE faq_id = ?', 'faq_r');
      assert.equal(stored.length, 1);
      assert.equal(stored[0].title, 'A study', 'title is trimmed before storage');
      assert.equal(stored[0].url, 'https://pubmed.example/1', 'url is trimmed before storage');
      assert.equal(stored[0].sort_order, 3);
    } finally {
      harness.close();
    }
  });

  it('is idempotent on replay: the same url returns 200 created:false and adds no row', async () => {
    // UNIQUE(faq_id, url) plus INSERT OR IGNORE. A double-submit from the admin
    // UI must not produce a duplicate citation.
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_r', slug: 'r' }); } });
    try {
      const env = envWith(harness);
      const payload = {
        url: `${SITE}/api/admin/faqs/faq_r/resources`,
        body: { title: 'A study', url: 'https://pubmed.example/1' },
        user: ADMIN,
        env,
        params: { id: 'faq_r' },
      };
      const first = await parseResponse(await resourcePost(ctx('POST', payload)));
      const second = await parseResponse(await resourcePost(ctx('POST', payload)));

      assert.equal(first.status, 201);
      assert.equal(first.body.created, true);
      assert.equal(second.status, 200, 'the replay is not a new creation');
      assert.equal(second.body.created, false);
      assert.equal(rows(harness, 'SELECT * FROM faq_resource WHERE faq_id = ?', 'faq_r').length, 1);
    } finally {
      harness.close();
    }
  });

  it('lets the SAME url attach to two different FAQs', async () => {
    const harness = db({
      seed(s) { seedFaq(s, { id: 'faq_a', slug: 'a' }); seedFaq(s, { id: 'faq_b', slug: 'b' }); },
    });
    try {
      const env = envWith(harness);
      const body = { title: 'Shared study', url: 'https://pubmed.example/shared' };
      const a = await parseResponse(await resourcePost(ctx('POST', { body, user: ADMIN, env, params: { id: 'faq_a' } })));
      const b = await parseResponse(await resourcePost(ctx('POST', { body, user: ADMIN, env, params: { id: 'faq_b' } })));
      assert.equal(a.status, 201);
      assert.equal(b.status, 201, 'uniqueness is per (faq_id, url), not per url');
      assert.equal(rows(harness, 'SELECT * FROM faq_resource').length, 2);
    } finally {
      harness.close();
    }
  });

  it('DELETE removes only the resource that belongs to the FAQ in the path (IDOR)', async () => {
    // The DELETE is scoped `WHERE id = ? AND faq_id = ?`. Without the second
    // clause, knowing a resource id would let an admin of one FAQ delete
    // another FAQ's citation.
    const harness = db({
      seed(s) {
        seedFaq(s, { id: 'faq_a', slug: 'a' });
        seedFaq(s, { id: 'faq_b', slug: 'b' });
        seedResource(s, { faqId: 'faq_a', title: 'A', url: 'https://a.example' });
        seedResource(s, { faqId: 'faq_b', title: 'B', url: 'https://b.example' });
      },
    });
    try {
      const victim = rows(harness, 'SELECT * FROM faq_resource WHERE faq_id = ?', 'faq_b')[0];

      const { status, body } = await parseResponse(await resourceDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_a/resources?resourceId=${victim.id}`,
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_a' },
      })));

      assert.equal(status, 404, 'a cross-FAQ delete must not report success');
      assert.equal(body.error, 'not_found');
      assert.ok(
        one(harness, 'SELECT * FROM faq_resource WHERE id = ?', victim.id),
        "the other FAQ's resource still exists",
      );
    } finally {
      harness.close();
    }
  });

  it('DELETE removes the row when the FAQ does own it', async () => {
    const harness = db({
      seed(s) {
        seedFaq(s, { id: 'faq_a', slug: 'a' });
        seedResource(s, { faqId: 'faq_a', title: 'A', url: 'https://a.example' });
      },
    });
    try {
      const own = rows(harness, 'SELECT * FROM faq_resource WHERE faq_id = ?', 'faq_a')[0];
      const { status, body } = await parseResponse(await resourceDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_a/resources?resourceId=${own.id}`,
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_a' },
      })));
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(one(harness, 'SELECT * FROM faq_resource WHERE id = ?', own.id), null, 'row really deleted');
    } finally {
      harness.close();
    }
  });

  it('validates title and url before writing', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_r', slug: 'r' }); } });
    try {
      const env = envWith(harness);
      const cases = [
        [{ url: 'https://x.example' }, 'title_required'],
        [{ title: '   ', url: 'https://x.example' }, 'title_required'],
        [{ title: 'x'.repeat(501), url: 'https://x.example' }, 'title_too_long'],
        [{ title: 'T' }, 'url_required'],
        [{ title: 'T', url: '   ' }, 'url_required'],
        [{ title: 'T', url: `https://x.example/${'y'.repeat(500)}` }, 'url_too_long'],
      ];
      for (const [body, err] of cases) {
        const res = await parseResponse(await resourcePost(ctx('POST', { body, user: ADMIN, env, params: { id: 'faq_r' } })));
        assert.equal(res.status, 400, `${err} should be a 400`);
        assert.equal(res.body.error, err);
      }
      assert.equal(rows(harness, 'SELECT * FROM faq_resource').length, 0, 'no invalid row was written');
    } finally {
      harness.close();
    }
  });

  it('defaults sort_order to 0 when sortOrder is not a number', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_r', slug: 'r' }); } });
    try {
      await resourcePost(ctx('POST', {
        body: { title: 'T', url: 'https://x.example', sortOrder: 'first' },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_r' },
      }));
      assert.equal(rows(harness, 'SELECT * FROM faq_resource')[0].sort_order, 0);
    } finally {
      harness.close();
    }
  });

  it('requires resourceId on DELETE', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_r', slug: 'r' }); } });
    try {
      const { status, body } = await parseResponse(await resourceDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_r/resources`,
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_r' },
      })));
      assert.equal(status, 400);
      assert.equal(body.error, 'resourceId_required');
    } finally {
      harness.close();
    }
  });

  it('enforces auth, the id guard, the DB binding, and JSON validity', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_r', slug: 'r' }); } });
    try {
      const env = envWith(harness);
      const good = { title: 'T', url: 'https://x.example' };

      assert.equal((await parseResponse(await resourcePost(ctx('POST', { body: good, env, params: { id: 'faq_r' } })))).status, 401);
      assert.equal((await parseResponse(await resourcePost(ctx('POST', { body: good, user: MEMBER, env, params: { id: 'faq_r' } })))).status, 403);
      assert.equal((await parseResponse(await resourceDelete(ctx('DELETE', { env, params: { id: 'faq_r' } })))).status, 401);
      assert.equal((await parseResponse(await resourceDelete(ctx('DELETE', { user: MEMBER, env, params: { id: 'faq_r' } })))).status, 403);

      assert.equal((await parseResponse(await resourcePost(ctx('POST', {
        body: good, user: ADMIN, env: mockEnv({ DB: undefined }), params: { id: 'faq_r' },
      })))).status, 503);
      assert.equal((await parseResponse(await resourceDelete(ctx('DELETE', {
        user: ADMIN, env: mockEnv({ DB: undefined }), params: { id: 'faq_r' },
      })))).status, 503);

      assert.equal((await parseResponse(await resourcePost(ctx('POST', {
        body: good, user: ADMIN, env, params: { id: 'x'.repeat(101) },
      })))).status, 400);
      assert.equal((await parseResponse(await resourceDelete(ctx('DELETE', {
        user: ADMIN, env, params: { id: 'x'.repeat(101) },
      })))).status, 400);

      const badJson = ctx('POST', { user: ADMIN, env, params: { id: 'faq_r' } });
      badJson.request.json = async () => { throw new SyntaxError('nope'); };
      assert.equal((await parseResponse(await resourcePost(badJson))).body.error, 'Invalid JSON');

      assert.equal((await parseResponse(await resourcePost(ctx('POST', {
        body: [1], user: ADMIN, env, params: { id: 'faq_r' },
      })))).body.error, 'Invalid payload');
    } finally {
      harness.close();
    }
  });

  it('returns 500 when the insert or the delete throws', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_r', slug: 'r' }); } });
    harness.prepare = () => { throw new Error('D1_ERROR: resource down'); };
    try {
      const env = envWith(harness);
      const ins = await parseResponse(await resourcePost(ctx('POST', {
        body: { title: 'T', url: 'https://x.example' }, user: ADMIN, env, params: { id: 'faq_r' },
      })));
      assert.equal(ins.status, 500);
      assert.doesNotMatch(JSON.stringify(ins.body), /resource down/);

      const del = await parseResponse(await resourceDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_r/resources?resourceId=1`, user: ADMIN, env, params: { id: 'faq_r' },
      })));
      assert.equal(del.status, 500);
    } finally {
      harness.close();
    }
  });
});

// ========================================================= library refs ===

describe('POST/DELETE /api/admin/faqs/[id]/library-refs -- library citations', () => {
  it('inserts the ref against the FAQ in the path', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_l', slug: 'l' }); } });
    try {
      const { status, body } = await parseResponse(await refPost(ctx('POST', {
        body: { articleId: '  rec_123  ', label: 'Smith 2024', sortOrder: 2 },
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_l' },
      })));
      assert.equal(status, 201);
      assert.equal(body.created, true);

      const stored = rows(harness, 'SELECT * FROM faq_library_ref WHERE faq_id = ?', 'faq_l');
      assert.equal(stored.length, 1);
      assert.equal(stored[0].article_id, 'rec_123', 'articleId is trimmed');
      assert.equal(stored[0].label, 'Smith 2024');
      assert.equal(stored[0].sort_order, 2);
    } finally {
      harness.close();
    }
  });

  it('stores a NULL label when none is supplied', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_l', slug: 'l' }); } });
    try {
      await refPost(ctx('POST', {
        body: { articleId: 'rec_1' }, user: ADMIN, env: envWith(harness), params: { id: 'faq_l' },
      }));
      assert.equal(rows(harness, 'SELECT * FROM faq_library_ref')[0].label, null);
    } finally {
      harness.close();
    }
  });

  it('is idempotent on replay for the same article', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_l', slug: 'l' }); } });
    try {
      const env = envWith(harness);
      const payload = { body: { articleId: 'rec_1' }, user: ADMIN, env, params: { id: 'faq_l' } };
      const first = await parseResponse(await refPost(ctx('POST', payload)));
      const second = await parseResponse(await refPost(ctx('POST', payload)));
      assert.equal(first.status, 201);
      assert.equal(second.status, 200);
      assert.equal(second.body.created, false);
      assert.equal(rows(harness, 'SELECT * FROM faq_library_ref').length, 1);
    } finally {
      harness.close();
    }
  });

  it('DELETE removes only the ref belonging to the FAQ in the path (IDOR)', async () => {
    const harness = db({
      seed(s) {
        seedFaq(s, { id: 'faq_a', slug: 'a' });
        seedFaq(s, { id: 'faq_b', slug: 'b' });
        seedRef(s, { faqId: 'faq_b', articleId: 'rec_shared' });
      },
    });
    try {
      const { status, body } = await parseResponse(await refDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_a/library-refs?articleId=rec_shared`,
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_a' },
      })));
      assert.equal(status, 404, 'faq_a cannot delete faq_b\'s citation');
      assert.equal(body.error, 'not_found');
      assert.equal(rows(harness, 'SELECT * FROM faq_library_ref WHERE faq_id = ?', 'faq_b').length, 1);
    } finally {
      harness.close();
    }
  });

  it('DELETE removes the ref the FAQ does own', async () => {
    const harness = db({
      seed(s) { seedFaq(s, { id: 'faq_a', slug: 'a' }); seedRef(s, { faqId: 'faq_a', articleId: 'rec_1' }); },
    });
    try {
      const { status } = await parseResponse(await refDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_a/library-refs?articleId=rec_1`,
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_a' },
      })));
      assert.equal(status, 200);
      assert.equal(rows(harness, 'SELECT * FROM faq_library_ref').length, 0);
    } finally {
      harness.close();
    }
  });

  it('validates articleId before writing', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_l', slug: 'l' }); } });
    try {
      const env = envWith(harness);
      for (const [body, err] of [
        [{}, 'articleId_required'],
        [{ articleId: '   ' }, 'articleId_required'],
        [{ articleId: 'x'.repeat(101) }, 'articleId_too_long'],
      ]) {
        const res = await parseResponse(await refPost(ctx('POST', { body, user: ADMIN, env, params: { id: 'faq_l' } })));
        assert.equal(res.status, 400);
        assert.equal(res.body.error, err);
      }
      assert.equal(rows(harness, 'SELECT * FROM faq_library_ref').length, 0);
    } finally {
      harness.close();
    }
  });

  it('defaults sort_order to 0 when sortOrder is not a number', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_l', slug: 'l' }); } });
    try {
      await refPost(ctx('POST', {
        body: { articleId: 'rec_1', sortOrder: null }, user: ADMIN, env: envWith(harness), params: { id: 'faq_l' },
      }));
      assert.equal(rows(harness, 'SELECT * FROM faq_library_ref')[0].sort_order, 0);
    } finally {
      harness.close();
    }
  });

  it('requires articleId on DELETE', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_l', slug: 'l' }); } });
    try {
      const { status, body } = await parseResponse(await refDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_l/library-refs`,
        user: ADMIN,
        env: envWith(harness),
        params: { id: 'faq_l' },
      })));
      assert.equal(status, 400);
      assert.equal(body.error, 'articleId_required');
    } finally {
      harness.close();
    }
  });

  it('enforces auth, the id guard, the DB binding, and JSON validity', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_l', slug: 'l' }); } });
    try {
      const env = envWith(harness);
      const good = { articleId: 'rec_1' };

      assert.equal((await parseResponse(await refPost(ctx('POST', { body: good, env, params: { id: 'faq_l' } })))).status, 401);
      assert.equal((await parseResponse(await refPost(ctx('POST', { body: good, user: MEMBER, env, params: { id: 'faq_l' } })))).status, 403);
      assert.equal((await parseResponse(await refDelete(ctx('DELETE', { env, params: { id: 'faq_l' } })))).status, 401);
      assert.equal((await parseResponse(await refDelete(ctx('DELETE', { user: MEMBER, env, params: { id: 'faq_l' } })))).status, 403);

      assert.equal((await parseResponse(await refPost(ctx('POST', {
        body: good, user: ADMIN, env: mockEnv({ DB: undefined }), params: { id: 'faq_l' },
      })))).status, 503);
      assert.equal((await parseResponse(await refDelete(ctx('DELETE', {
        user: ADMIN, env: mockEnv({ DB: undefined }), params: { id: 'faq_l' },
      })))).status, 503);

      assert.equal((await parseResponse(await refPost(ctx('POST', {
        body: good, user: ADMIN, env, params: { id: 'x'.repeat(101) },
      })))).status, 400);
      assert.equal((await parseResponse(await refDelete(ctx('DELETE', {
        user: ADMIN, env, params: { id: 'x'.repeat(101) },
      })))).status, 400);

      const badJson = ctx('POST', { user: ADMIN, env, params: { id: 'faq_l' } });
      badJson.request.json = async () => { throw new SyntaxError('nope'); };
      assert.equal((await parseResponse(await refPost(badJson))).body.error, 'Invalid JSON');

      assert.equal((await parseResponse(await refPost(ctx('POST', {
        body: [1], user: ADMIN, env, params: { id: 'faq_l' },
      })))).body.error, 'Invalid payload');
    } finally {
      harness.close();
    }
  });

  it('returns 500 when the insert or the delete throws', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_l', slug: 'l' }); } });
    harness.prepare = () => { throw new Error('D1_ERROR: ref down'); };
    try {
      const env = envWith(harness);
      const ins = await parseResponse(await refPost(ctx('POST', {
        body: { articleId: 'rec_1' }, user: ADMIN, env, params: { id: 'faq_l' },
      })));
      assert.equal(ins.status, 500);
      assert.doesNotMatch(JSON.stringify(ins.body), /ref down/);

      const del = await parseResponse(await refDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_l/library-refs?articleId=rec_1`, user: ADMIN, env, params: { id: 'faq_l' },
      })));
      assert.equal(del.status, 500);
    } finally {
      harness.close();
    }
  });
});

// ======================================= admin writes -> public read ====

describe('GET /api/faqs -- what the admin surface wrote is what the build reads', () => {
  function buildCtx(url) {
    return {
      request: mockRequest('GET', { url, headers: { Authorization: `Bearer ${BUILD_TOKEN}` } }),
      waitUntil: mockWaitUntil(),
    };
  }

  it('publishes an admin-created FAQ, with its evidence, once status is published', async () => {
    const harness = db();
    const env = envWith(harness);
    try {
      const created = await parseResponse(await createPost(ctx('POST', {
        body: { question: 'Does RRM treat endometriosis?', category: 'Condition-Specific' },
        user: ADMIN,
        env,
      })));
      const id = created.body.data.id;

      await resourcePost(ctx('POST', {
        body: { title: 'Cohort study', url: 'https://pubmed.example/9' },
        user: ADMIN, env, params: { id },
      }));
      await refPost(ctx('POST', {
        body: { articleId: 'rec_endo', label: 'Endo 2025' },
        user: ADMIN, env, params: { id },
      }));

      // Still a draft, so the public feed must not carry it yet.
      const draftRead = await parseResponse(await publicFaqsGet({ ...buildCtx(`${SITE}/api/faqs`), env }));
      assert.deepEqual(draftRead.body.results, [], 'a draft FAQ is not published');

      await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/${id}`,
        body: { status: 'published' },
        user: ADMIN, env, params: { id },
      }));

      const liveRead = await parseResponse(await publicFaqsGet({ ...buildCtx(`${SITE}/api/faqs`), env }));
      assert.equal(liveRead.status, 200);
      assert.equal(liveRead.body.results.length, 1);
      const faq = liveRead.body.results[0];
      assert.equal(faq.id, id);
      assert.equal(faq.slug, 'does-rrm-treat-endometriosis');
      assert.deepEqual(faq.evidence, [{ title: 'Cohort study', url: 'https://pubmed.example/9', sortOrder: 0 }]);
      assert.deepEqual(faq.libraryRefs, [{ articleId: 'rec_endo', label: 'Endo 2025', sortOrder: 0 }]);
    } finally {
      harness.close();
    }
  });

  it('drops a FAQ from the public feed when it is archived', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_p', slug: 'p', status: 'published' }); } });
    const env = envWith(harness);
    try {
      const before = await parseResponse(await publicFaqsGet({ ...buildCtx(`${SITE}/api/faqs`), env }));
      assert.equal(before.body.results.length, 1);

      await onePut(ctx('PUT', {
        url: `${SITE}/api/admin/faqs/faq_p`,
        body: { status: 'archived' },
        user: ADMIN, env, params: { id: 'faq_p' },
      }));

      const after = await parseResponse(await publicFaqsGet({ ...buildCtx(`${SITE}/api/faqs`), env }));
      assert.deepEqual(after.body.results, [], 'archiving unpublishes');
    } finally {
      harness.close();
    }
  });

  it('a deleted FAQ leaves no orphan evidence in the public single read', async () => {
    const harness = db({
      seed(s) {
        seedFaq(s, { id: 'faq_d', slug: 'd', status: 'published' });
        seedResource(s, { faqId: 'faq_d', title: 'R', url: 'https://r.example' });
      },
    });
    const env = envWith(harness);
    try {
      await oneDelete(ctx('DELETE', {
        url: `${SITE}/api/admin/faqs/faq_d`, user: ADMIN, env, params: { id: 'faq_d' },
      }));
      const { status, body } = await parseResponse(
        await publicFaqsGet({ ...buildCtx(`${SITE}/api/faqs?id=faq_d`), env })
      );
      assert.equal(status, 404);
      assert.equal(body.error, 'not_found');
    } finally {
      harness.close();
    }
  });

  it('returns 500 without leaking the driver message when the public read throws', async () => {
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_p', slug: 'p', status: 'published' }); } });
    harness.prepare = () => { throw new Error('D1_ERROR: public down'); };
    const env = envWith(harness);
    try {
      const { status, body } = await parseResponse(await publicFaqsGet({ ...buildCtx(`${SITE}/api/faqs`), env }));
      assert.equal(status, 500);
      assert.equal(body.error, 'Internal error');
      assert.doesNotMatch(JSON.stringify(body), /public down/);
    } finally {
      harness.close();
    }
  });

  it('tolerates a driver that returns results: null on the child queries', async () => {
    // `refs || []` / `resources || []` / `(rows || [])` are the guards. A shard
    // that answers with a null results array must yield an empty evidence list,
    // not a TypeError that 500s the whole build feed.
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_n', slug: 'n', status: 'published' }); } });
    const real = harness.prepare.bind(harness);
    harness.prepare = (sql) => {
      const stmt = real(sql);
      if (sql.includes('faq_library_ref') || sql.includes('faq_resource')) {
        const origAll = stmt.all.bind(stmt);
        stmt.all = async (...a) => ({ ...(await origAll(...a)), results: null });
      }
      return stmt;
    };
    const env = envWith(harness);
    try {
      const single = await parseResponse(
        await publicFaqsGet({ ...buildCtx(`${SITE}/api/faqs?id=faq_n`), env })
      );
      assert.equal(single.status, 200);
      assert.deepEqual(single.body.data.evidence, []);
      assert.deepEqual(single.body.data.libraryRefs, []);

      const list = await parseResponse(await publicFaqsGet({ ...buildCtx(`${SITE}/api/faqs`), env }));
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.results[0].evidence, []);
      assert.deepEqual(list.body.results[0].libraryRefs, []);

      const admin = await parseResponse(await oneGet(ctx('GET', {
        user: ADMIN, env, params: { id: 'faq_n' },
      })));
      assert.equal(admin.status, 200);
      assert.deepEqual(admin.body.data.evidence, [], 'the admin read guards the same way');
      assert.deepEqual(admin.body.data.libraryRefs, []);

      const adminList = await parseResponse(await listGet(ctx('GET', { user: ADMIN, env })));
      assert.equal(adminList.status, 200);
      assert.deepEqual(adminList.body.results[0].evidence, []);
    } finally {
      harness.close();
    }
  });

  it('returns an empty list, skipping the child fan-out, when nothing is published', async () => {
    // The early return on an empty `rows` avoids building an IN () clause with
    // zero placeholders, which is a syntax error in SQLite.
    const harness = db({ seed(s) { seedFaq(s, { id: 'faq_draft', slug: 'draft', status: 'draft' }); } });
    const env = envWith(harness);
    try {
      const { status, body } = await parseResponse(await publicFaqsGet({ ...buildCtx(`${SITE}/api/faqs`), env }));
      assert.equal(status, 200);
      assert.deepEqual(body.results, []);
    } finally {
      harness.close();
    }
  });

  it('returns 400 for an over-length id on the public read', async () => {
    const harness = db();
    const env = envWith(harness);
    try {
      const { status, body } = await parseResponse(
        await publicFaqsGet({ ...buildCtx(`${SITE}/api/faqs?id=${'x'.repeat(101)}`), env })
      );
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid id');
    } finally {
      harness.close();
    }
  });
});
