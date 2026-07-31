/**
 * functions/api/blog/posts.js -- the build-time feed that fetch-blog-data.mjs
 * reads to render every post on the site.
 *
 * WHY A REAL ENGINE HERE
 * ----------------------
 * Two of this endpoint's three contracts are claims the SQL engine decides,
 * not claims the handler can be seen making:
 *
 *   1. the unauthenticated list returns ONLY `status = 'published'` rows. Under
 *      test/_helpers.js mockDB the WHERE clause is never executed -- the canned
 *      rows come back whatever the query said -- so "drafts are excluded" can
 *      be asserted while the handler happily ships drafts.
 *   2. the list is ordered by `publish_date DESC`. Same problem: a canned array
 *      is returned in the order the test author wrote it, which proves only
 *      that the author knew the expected order.
 *
 * Both are silent in production: the build succeeds, the site renders, and an
 * unpublished draft is simply live. So the DB here is test/_d1-sqlite.mjs,
 * loaded from the committed schema.sql where `posts.status` really carries
 * CHECK(status IN ('draft','review','published','archived')).
 *
 * The third contract -- the LIMIT/OFFSET validation ladder -- is pure handler
 * logic and is asserted directly against the responses.
 *
 * WHAT IS STILL FAKED
 * -------------------
 *  - "D1 threw" is a throwing stub over harness.prepare, per the harness note
 *    that SQLite cannot reproduce D1's network errors.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1 } from './_d1-sqlite.mjs';
import { onRequestGet, onRequestOptions } from '../functions/api/blog/posts.js';

const SITE = 'https://rrmacademy.org';
const TOKEN = 'build-token-value';

function ctx(url, env, { auth = `Bearer ${TOKEN}` } = {}) {
  const headers = auth === null ? {} : { Authorization: auth };
  return {
    request: mockRequest('GET', { url, headers }),
    env,
    waitUntil: mockWaitUntil(),
  };
}

function envWith(harness, overrides = {}) {
  return mockEnv({ DB: harness, LIBRARY_BUILD_TOKEN: TOKEN, ...overrides });
}

/** Inserts a posts row, defaulting every NOT NULL column the schema declares. */
function seedPost(sqlite, { id, slug, title = 'A title', status = 'published', publishDate = '2026-01-01', ...rest }) {
  sqlite.prepare(
    `INSERT INTO posts (id, slug, title, content, excerpt, author, content_pillar,
      cover_image_url, publish_date, status, word_count, seo_keywords, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    slug,
    title,
    rest.content ?? 'body',
    rest.excerpt ?? 'summary',
    rest.author ?? 'Naomi Whittaker, MD',
    rest.contentPillar ?? 'endometriosis',
    rest.coverImageUrl ?? 'https://cdn.example/c.jpg',
    publishDate,
    status,
    rest.wordCount ?? 1200,
    rest.seoKeywords ?? 'rrm, endo',
    rest.createdAt ?? '2026-01-01 00:00:00',
    rest.updatedAt ?? '2026-02-02 00:00:00',
  );
}

function db(opts) {
  return sqliteD1(opts);
}

// ------------------------------------------------------------------ auth ---

describe('GET /api/blog/posts -- the build token is the only key', () => {
  it('answers OPTIONS with a 204 preflight and no body', async () => {
    const res = onRequestOptions();
    assert.equal(res.status, 204);
  });

  it('returns 503 when LIBRARY_BUILD_TOKEN is unset, without touching the DB', async () => {
    const harness = db();
    let prepared = 0;
    const real = harness.prepare.bind(harness);
    harness.prepare = (sql) => { prepared += 1; return real(sql); };
    try {
      const env = envWith(harness, { LIBRARY_BUILD_TOKEN: undefined });
      const { status, body } = await parseResponse(await onRequestGet(ctx(`${SITE}/api/blog/posts`, env)));
      assert.equal(status, 503);
      assert.equal(body.error, 'Server misconfigured');
      assert.equal(prepared, 0, 'a misconfigured server must not query');
    } finally {
      harness.close();
    }
  });

  it('returns 401 when the Authorization header is absent', async () => {
    const harness = db();
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts`, envWith(harness), { auth: null }))
      );
      assert.equal(status, 401);
      assert.equal(body.error, 'Unauthorized');
    } finally {
      harness.close();
    }
  });

  it('returns 401 for a token that differs by one character', async () => {
    const harness = db({ seed(s) { seedPost(s, { id: 'p1', slug: 'a' }); } });
    try {
      const bad = `Bearer ${TOKEN.slice(0, -1)}X`;
      const { status } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts`, envWith(harness), { auth: bad }))
      );
      assert.equal(status, 401, 'a near-miss token must not authenticate');
    } finally {
      harness.close();
    }
  });

  it('returns 401 for a correct token missing the Bearer scheme', async () => {
    const harness = db();
    try {
      const { status } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts`, envWith(harness), { auth: TOKEN }))
      );
      assert.equal(status, 401);
    } finally {
      harness.close();
    }
  });

  it('returns 503 when the DB binding is missing even with a good token', async () => {
    const env = envWith(null, { DB: undefined });
    const { status, body } = await parseResponse(await onRequestGet(ctx(`${SITE}/api/blog/posts`, env)));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });
});

// ------------------------------------------------------ single post by id ---

describe('GET /api/blog/posts?id= -- single post, any status', () => {
  it('returns a draft by id, because preview must reach unpublished work', async () => {
    const harness = db({
      seed(s) { seedPost(s, { id: 'rec_draft', slug: 'draft-post', title: 'Draft', status: 'draft' }); },
    });
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?id=rec_draft`, envWith(harness)))
      );
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.data.id, 'rec_draft');
      assert.equal(body.data.title, 'Draft');
      assert.equal(body.results, undefined, 'the single-post shape uses data, not results');
    } finally {
      harness.close();
    }
  });

  it('maps every column the site template reads, including the fixed audioUrl', async () => {
    const harness = db({
      seed(s) {
        seedPost(s, {
          id: 'rec_full',
          slug: 'full-post',
          title: 'Full',
          content: 'CONTENT',
          excerpt: 'EXCERPT',
          author: 'Someone Else',
          contentPillar: 'pcos',
          coverImageUrl: 'https://cdn.example/x.png',
          publishDate: '2026-03-04',
          wordCount: 987,
          seoKeywords: 'a, b',
          updatedAt: '2026-05-06 07:08:09',
        });
      },
    });
    try {
      const { body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?id=rec_full`, envWith(harness)))
      );
      assert.deepEqual(body.data, {
        id: 'rec_full',
        slug: 'full-post',
        title: 'Full',
        content: 'CONTENT',
        excerpt: 'EXCERPT',
        author: 'Someone Else',
        contentPillar: 'pcos',
        coverImageUrl: 'https://cdn.example/x.png',
        publishDate: '2026-03-04',
        wordCount: 987,
        seoKeywords: 'a, b',
        audioUrl: '',
        lastModified: '2026-05-06 07:08:09',
      });
    } finally {
      harness.close();
    }
  });

  it('returns 404 for an id that does not exist', async () => {
    const harness = db({ seed(s) { seedPost(s, { id: 'p1', slug: 'a' }); } });
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?id=rec_nope`, envWith(harness)))
      );
      assert.equal(status, 404);
      assert.equal(body.error, 'not_found');
    } finally {
      harness.close();
    }
  });

  it('returns 400 for an id longer than 100 characters', async () => {
    const harness = db();
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?id=${'x'.repeat(101)}`, envWith(harness)))
      );
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid id');
    } finally {
      harness.close();
    }
  });

  it('accepts an id of exactly 100 characters (the boundary is inclusive)', async () => {
    const id = 'y'.repeat(100);
    const harness = db({ seed(s) { seedPost(s, { id, slug: 'boundary' }); } });
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?id=${id}`, envWith(harness)))
      );
      assert.equal(status, 200);
      assert.equal(body.data.id, id);
    } finally {
      harness.close();
    }
  });

  it('an empty id is a lookup for "", not a fall-through to the list', async () => {
    // `id` is checked with `!== null`, so ?id= (empty) takes the single-post
    // branch and 404s. If it fell through, an empty param would dump the corpus.
    const harness = db({ seed(s) { seedPost(s, { id: 'p1', slug: 'a' }); } });
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?id=`, envWith(harness)))
      );
      assert.equal(status, 404);
      assert.equal(body.results, undefined, 'must not return the full list');
    } finally {
      harness.close();
    }
  });
});

// -------------------------------------------------------- published list ---

describe('GET /api/blog/posts -- the published list', () => {
  function seedMixed(s) {
    seedPost(s, { id: 'p_old', slug: 'old', title: 'Oldest', publishDate: '2026-01-01' });
    seedPost(s, { id: 'p_new', slug: 'new', title: 'Newest', publishDate: '2026-06-01' });
    seedPost(s, { id: 'p_mid', slug: 'mid', title: 'Middle', publishDate: '2026-03-01' });
    seedPost(s, { id: 'p_draft', slug: 'draft', title: 'Draft', status: 'draft', publishDate: '2026-07-01' });
    seedPost(s, { id: 'p_arch', slug: 'arch', title: 'Archived', status: 'archived', publishDate: '2026-07-02' });
    seedPost(s, { id: 'p_rev', slug: 'rev', title: 'Review', status: 'review', publishDate: '2026-07-03' });
  }

  it('returns ONLY published rows, so drafts and archives never reach the site', async () => {
    const harness = db({ seed: seedMixed });
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts`, envWith(harness)))
      );
      assert.equal(status, 200);
      const ids = body.results.map(r => r.id);
      assert.deepEqual([...ids].sort(), ['p_mid', 'p_new', 'p_old']);
      for (const excluded of ['p_draft', 'p_arch', 'p_rev']) {
        assert.ok(!ids.includes(excluded), `${excluded} must not be published`);
      }
    } finally {
      harness.close();
    }
  });

  it('orders by publish_date DESC, newest first', async () => {
    const harness = db({ seed: seedMixed });
    try {
      const { body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts`, envWith(harness)))
      );
      assert.deepEqual(body.results.map(r => r.id), ['p_new', 'p_mid', 'p_old']);
    } finally {
      harness.close();
    }
  });

  it('returns an empty results array when nothing is published', async () => {
    const harness = db({
      seed(s) { seedPost(s, { id: 'p_draft', slug: 'draft', status: 'draft' }); },
    });
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts`, envWith(harness)))
      );
      assert.equal(status, 200);
      assert.deepEqual(body.results, []);
    } finally {
      harness.close();
    }
  });
});

// ------------------------------------------------------------ pagination ---

describe('GET /api/blog/posts -- the limit/offset ladder', () => {
  function seedTen(s) {
    for (let i = 0; i < 10; i++) {
      seedPost(s, {
        id: `p${i}`,
        slug: `slug-${i}`,
        title: `Post ${i}`,
        // i=9 newest, i=0 oldest
        publishDate: `2026-01-${String(i + 1).padStart(2, '0')}`,
      });
    }
  }

  it('honours limit, returning the newest N', async () => {
    const harness = db({ seed: seedTen });
    try {
      const { body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?limit=3`, envWith(harness)))
      );
      assert.equal(body.results.length, 3);
      assert.deepEqual(body.results.map(r => r.id), ['p9', 'p8', 'p7']);
    } finally {
      harness.close();
    }
  });

  it('honours offset alongside limit, paging without overlap', async () => {
    const harness = db({ seed: seedTen });
    try {
      const env = envWith(harness);
      const page1 = await parseResponse(await onRequestGet(ctx(`${SITE}/api/blog/posts?limit=3&offset=0`, env)));
      const page2 = await parseResponse(await onRequestGet(ctx(`${SITE}/api/blog/posts?limit=3&offset=3`, env)));
      assert.deepEqual(page1.body.results.map(r => r.id), ['p9', 'p8', 'p7']);
      assert.deepEqual(page2.body.results.map(r => r.id), ['p6', 'p5', 'p4']);
      const overlap = page1.body.results.filter(r => page2.body.results.some(o => o.id === r.id));
      assert.equal(overlap.length, 0, 'consecutive pages must not repeat a row');
    } finally {
      harness.close();
    }
  });

  it('returns every published row when no limit is given (the default contract)', async () => {
    const harness = db({ seed: seedTen });
    try {
      const { body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts`, envWith(harness)))
      );
      assert.equal(body.results.length, 10, 'omitting limit must not silently truncate the build feed');
    } finally {
      harness.close();
    }
  });

  it('accepts limit at the 200 ceiling but rejects 201', async () => {
    const harness = db({ seed: seedTen });
    try {
      const env = envWith(harness);
      const ok = await parseResponse(await onRequestGet(ctx(`${SITE}/api/blog/posts?limit=200`, env)));
      assert.equal(ok.status, 200);
      const over = await parseResponse(await onRequestGet(ctx(`${SITE}/api/blog/posts?limit=201`, env)));
      assert.equal(over.status, 400);
      assert.equal(over.body.error, 'Invalid limit');
    } finally {
      harness.close();
    }
  });

  it('rejects limit=0 rather than returning an empty page', async () => {
    const harness = db({ seed: seedTen });
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?limit=0`, envWith(harness)))
      );
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid limit');
    } finally {
      harness.close();
    }
  });

  for (const bad of ['abc', '-1', '1.5', '12345678', ' 5', '5 ', '', '1e2']) {
    it(`rejects a non-integer limit (${JSON.stringify(bad)})`, async () => {
      const harness = db({ seed: seedTen });
      try {
        const { status, body } = await parseResponse(
          await onRequestGet(ctx(`${SITE}/api/blog/posts?limit=${encodeURIComponent(bad)}`, envWith(harness)))
        );
        assert.equal(status, 400);
        assert.equal(body.error, 'Invalid limit');
      } finally {
        harness.close();
      }
    });
  }

  it('rejects a malformed offset', async () => {
    const harness = db({ seed: seedTen });
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?limit=5&offset=abc`, envWith(harness)))
      );
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid offset');
    } finally {
      harness.close();
    }
  });

  it('rejects an offset above the 1,000,000 ceiling', async () => {
    const harness = db({ seed: seedTen });
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?limit=5&offset=1000001`, envWith(harness)))
      );
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid offset');
    } finally {
      harness.close();
    }
  });

  it('rejects offset supplied without limit', async () => {
    const harness = db({ seed: seedTen });
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?offset=2`, envWith(harness)))
      );
      assert.equal(status, 400);
      assert.equal(body.error, 'offset requires limit');
    } finally {
      harness.close();
    }
  });

  it('treats limit without offset as offset 0', async () => {
    const harness = db({ seed: seedTen });
    try {
      const { body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?limit=2`, envWith(harness)))
      );
      assert.deepEqual(body.results.map(r => r.id), ['p9', 'p8']);
    } finally {
      harness.close();
    }
  });
});

// --------------------------------------------------------------- failure ---

describe('GET /api/blog/posts -- failure handling', () => {
  it('returns 500 without leaking the driver message when D1 throws', async () => {
    const harness = db({ seed(s) { seedPost(s, { id: 'p1', slug: 'a' }); } });
    harness.prepare = () => { throw new Error('D1_ERROR: connection lost to shard 7'); };
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts`, envWith(harness)))
      );
      assert.equal(status, 500);
      assert.equal(body.error, 'Internal error');
      assert.doesNotMatch(JSON.stringify(body), /shard 7/, 'no driver detail reaches the caller');
    } finally {
      harness.close();
    }
  });

  it('returns 500 when the single-post query throws', async () => {
    const harness = db({ seed(s) { seedPost(s, { id: 'p1', slug: 'a' }); } });
    harness.prepare = () => { throw new Error('D1_ERROR: boom'); };
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts?id=p1`, envWith(harness)))
      );
      assert.equal(status, 500);
      assert.equal(body.error, 'Internal error');
    } finally {
      harness.close();
    }
  });

  it('tolerates a driver that returns results: null', async () => {
    // `(results || [])` is the guard; without it the build feed 500s on an
    // empty shard response instead of returning nothing.
    const harness = db();
    const real = harness.prepare.bind(harness);
    harness.prepare = (sql) => {
      const stmt = real(sql);
      const origAll = stmt.all.bind(stmt);
      stmt.all = async (...a) => ({ ...(await origAll(...a)), results: null });
      return stmt;
    };
    try {
      const { status, body } = await parseResponse(
        await onRequestGet(ctx(`${SITE}/api/blog/posts`, envWith(harness)))
      );
      assert.equal(status, 200);
      assert.deepEqual(body.results, []);
    } finally {
      harness.close();
    }
  });
});
