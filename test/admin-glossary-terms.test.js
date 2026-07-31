/**
 * functions/api/admin/glossary/terms/index.js  (list + create)
 * functions/api/admin/glossary/terms/[id].js   (read + update + delete)
 *
 * The write path for rrmacademy.org/glossary/. A defect here corrupts published
 * patient education content, and until this file existed neither endpoint had
 * ever been executed by a test.
 *
 * These run against test/_d1-sqlite.mjs, a real SQLite engine loaded with the
 * committed rrm-auth schema, because almost everything worth asserting about
 * these two files is decided by the database rather than by JavaScript:
 *   - the auto sort_order is `COALESCE(MAX(sort_order),0)+1 ... WHERE part = ?`,
 *     so proving it is scoped per part requires a second part to exist;
 *   - `slug TEXT UNIQUE NOT NULL COLLATE NOCASE` is what turns a duplicate
 *     create into a 409, via INSERT OR IGNORE returning no row;
 *   - the archive and delete paths unlink `glossary_abbreviation.term_slug`
 *     through an explicit `COLLATE NOCASE` on a column declared BINARY, so the
 *     collation is load-bearing and a canned mock cannot decide it;
 *   - foreign keys are OFF here exactly as they are in D1, so the abbreviation
 *     unlink is endpoint discipline, not something the engine does for us.
 * Every mutation below is asserted by reading the row back out of the engine.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { insertUser, insertSession } from './_d1-sqlite.mjs';
import {
  SUPERADMIN, ADMIN, MEMBER, EDITOR,
  glossaryDb, insertTerm, insertAbbr,
  readTerm, countRows,
  faultyDb, nullResultsDb, resultlessDb, recordingEvents,
} from './_glossary-fixtures.mjs';

const list = await import('../functions/api/admin/glossary/terms/index.js');
const byId = await import('../functions/api/admin/glossary/terms/[id].js');
const adminMiddleware = await import('../functions/api/admin/_middleware.js');

const HTML = '<p>Four visible words here.</p>';

function call(handler, { db, user = SUPERADMIN, body, params = {}, events, noBody = false } = {}) {
  const request = noBody
    ? mockRequest('POST', {})
    : mockRequest('POST', { body: body === undefined ? {} : body });
  return handler({
    request,
    env: mockEnv({ DB: db, EVENTS: events ?? { writeDataPoint() {} } }),
    params,
    data: user ? { user } : {},
    waitUntil: mockWaitUntil(),
  });
}

const parse = async (res) => parseResponse(await res);

// ===================================================================== OPTIONS

describe('glossary terms -- CORS preflight', () => {
  it('index answers 204 with the locked-down origin', () => {
    const res = list.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });

  it('[id] answers 204 with the locked-down origin', () => {
    const res = byId.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

// ================================================================ GET /terms

describe('GET /api/admin/glossary/terms -- authorization', () => {
  let db;
  beforeEach(() => { db = glossaryDb((s) => insertTerm(s, { id: 'term_a', slug: 'a' })); });

  it('401s when the middleware populated no user', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db, user: null }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('403s a signed-in member', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db, user: MEMBER }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
  });

  it('403s any other non-admin role -- the check is an allowlist, not a member denylist', async () => {
    const { status } = await parse(call(list.onRequestGet, { db, user: EDITOR }));
    assert.equal(status, 403);
  });

  it('admits role=admin', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db, user: ADMIN }));
    assert.equal(status, 200);
    assert.equal(body.results.length, 1);
  });

  it('admits role=superadmin', async () => {
    const { status } = await parse(call(list.onRequestGet, { db, user: SUPERADMIN }));
    assert.equal(status, 200);
  });

  it('503s when the DB binding is missing, rather than 200 with an empty list', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db: undefined }));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });
});

describe('GET /api/admin/glossary/terms -- listing', () => {
  it('orders by part then sort_order, not by insertion order', async () => {
    const db = glossaryDb((s) => {
      insertTerm(s, { id: 'term_z', slug: 'z', part: 'III', sort_order: 1 });
      insertTerm(s, { id: 'term_y', slug: 'y', part: 'I', sort_order: 9 });
      insertTerm(s, { id: 'term_x', slug: 'x', part: 'I', sort_order: 2 });
    });
    const { body } = await parse(call(list.onRequestGet, { db }));
    assert.deepEqual(body.results.map((r) => r.slug), ['x', 'y', 'z']);
  });

  it('projects only the six admin-list columns -- body_html is never shipped to a list view', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_a', slug: 'a', body_html: '<p>secret heavy payload</p>' }));
    const { body } = await parse(call(list.onRequestGet, { db }));
    assert.deepEqual(
      Object.keys(body.results[0]).sort(),
      ['id', 'name', 'part', 'slug', 'sort_order', 'status']
    );
  });

  it('returns an empty array when the table is empty', async () => {
    const { body } = await parse(call(list.onRequestGet, { db: glossaryDb() }));
    assert.deepEqual(body.results, []);
  });

  it('falls back to [] if the driver hands back no results key', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db: nullResultsDb() }));
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
  });

  it('500s generically when D1 throws, logging terms_list_error and leaking nothing', async () => {
    const events = recordingEvents();
    const db = faultyDb(glossaryDb(), { on: 'FROM glossary_term', message: 'D1_ERROR: no such column secret_internal' });
    const { status, body } = await parse(call(list.onRequestGet, { db, events }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('secret_internal'), false);
    assert.deepEqual(events.actions, ['terms_list_error']);
  });
});

// =============================================================== POST /terms

describe('POST /api/admin/glossary/terms -- authorization', () => {
  const valid = { slug: 'new-term', name: 'New Term', part: 'I', body_html: HTML };

  it('401s with no user and writes nothing', async () => {
    const db = glossaryDb();
    const { status } = await parse(call(list.onRequestPost, { db, user: null, body: valid }));
    assert.equal(status, 401);
    assert.equal(countRows(db, 'glossary_term'), 0);
  });

  it('403s a member and writes nothing -- the single most consequential line in the file', async () => {
    const db = glossaryDb();
    const { status, body } = await parse(call(list.onRequestPost, { db, user: MEMBER, body: valid }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(countRows(db, 'glossary_term'), 0);
  });

  it('403s an editor and writes nothing', async () => {
    const db = glossaryDb();
    assert.equal((await parse(call(list.onRequestPost, { db, user: EDITOR, body: valid }))).status, 403);
    assert.equal(countRows(db, 'glossary_term'), 0);
  });

  it('503s with no DB binding', async () => {
    const { status, body } = await parse(call(list.onRequestPost, { db: undefined, body: valid }));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });
});

describe('POST /api/admin/glossary/terms -- input validation refuses the write', () => {
  const base = { slug: 'ok-slug', name: 'Ok Name', part: 'I', body_html: HTML };
  const cases = [
    ['slug absent', { ...base, slug: undefined }, 'slug_required'],
    ['slug whitespace only', { ...base, slug: '   ' }, 'slug_required'],
    ['slug not a string', { ...base, slug: 42 }, 'slug_required'],
    ['slug over 100 chars', { ...base, slug: 'a'.repeat(101) }, 'slug_too_long'],
    ['slug with spaces and capitals', { ...base, slug: 'Bad Slug' }, 'invalid_slug_format'],
    ['slug with a trailing hyphen', { ...base, slug: 'trailing-' }, 'invalid_slug_format'],
    ['slug in the ref- namespace', { ...base, slug: 'ref-12' }, 'slug_reserved_ref_prefix'],
    ['slug colliding with a page anchor', { ...base, slug: 'abbreviations' }, 'slug_reserved'],
    ['name absent', { ...base, name: undefined }, 'name_required'],
    ['name whitespace only', { ...base, name: '  ' }, 'name_required'],
    ['name over 300 chars', { ...base, name: 'n'.repeat(301) }, 'name_too_long'],
    ['part absent', { ...base, part: undefined }, 'invalid_part'],
    ['part outside I-VIII', { ...base, part: 'IX' }, 'invalid_part'],
    ['body_html absent', { ...base, body_html: undefined }, 'body_html_required'],
    ['body_html whitespace only', { ...base, body_html: '   ' }, 'body_html_required'],
    ['body_html over 200000 chars', { ...base, body_html: 'x'.repeat(200001) }, 'body_html_too_long'],
    ['abbreviation over 100 chars', { ...base, abbreviation: 'a'.repeat(101) }, 'abbreviation_too_long'],
    ['abbreviation not a string', { ...base, abbreviation: 42 }, 'abbreviation_too_long'],
    ['pillar_link not a string', { ...base, pillar_link: 42 }, 'pillar_link_invalid_type'],
    ['pillar_link absolute', { ...base, pillar_link: 'https://evil.example/x' }, 'pillar_link_must_be_relative'],
    ['pillar_link protocol-relative', { ...base, pillar_link: '//evil.example/x' }, 'pillar_link_must_be_relative'],
    ['pillar_link over 500 chars', { ...base, pillar_link: '/' + 'p'.repeat(500) }, 'pillar_link_too_long'],
    ['status outside the enum', { ...base, status: 'live' }, 'invalid_status'],
    ['sort_order fractional', { ...base, sort_order: 1.5 }, 'sort_order_invalid'],
    ['sort_order negative', { ...base, sort_order: -1 }, 'sort_order_invalid'],
    ['sort_order over 10000', { ...base, sort_order: 10001 }, 'sort_order_invalid'],
    ['sort_order sent as a string', { ...base, sort_order: '3' }, 'sort_order_invalid'],
  ];

  for (const [label, body, error] of cases) {
    it(`rejects ${label} with ${error}`, async () => {
      const db = glossaryDb();
      const { status, body: res } = await parse(call(list.onRequestPost, { db, body }));
      assert.equal(status, 400);
      assert.equal(res.error, error);
      assert.equal(countRows(db, 'glossary_term'), 0);
    });
  }

  it('rejects a body that is not JSON', async () => {
    const db = glossaryDb();
    const { status, body } = await parse(call(list.onRequestPost, { db, noBody: true }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
    assert.equal(countRows(db, 'glossary_term'), 0);
  });
});

describe('POST /api/admin/glossary/terms -- create with an explicit sort_order', () => {
  it('persists the row, derives the id from the slug, and counts words with HTML stripped', async () => {
    const db = glossaryDb();
    const { status, body } = await parse(call(list.onRequestPost, {
      db,
      body: { slug: 'luteal-phase', name: '  Luteal Phase  ', part: 'II', sort_order: 4, body_html: '<p>Four visible <b>words</b> here.</p>', status: 'published' },
    }));

    assert.equal(status, 201);
    assert.equal(body.created, true);

    const row = readTerm(db, 'term_luteal-phase');
    assert.ok(row, 'the row must actually exist in the database');
    assert.equal(row.slug, 'luteal-phase');
    assert.equal(row.name, 'Luteal Phase', 'name is trimmed on the create path');
    assert.equal(row.part, 'II');
    assert.equal(row.sort_order, 4);
    assert.equal(row.status, 'published');
    assert.equal(row.word_count, 4);
    assert.equal(body.data.id, row.id);
  });

  it('defaults status to draft when the client omits it -- the production default', async () => {
    const db = glossaryDb();
    await parse(call(list.onRequestPost, { db, body: { slug: 'no-status', name: 'N', part: 'I', sort_order: 1, body_html: HTML } }));
    assert.equal(readTerm(db, 'term_no-status').status, 'draft');
  });

  it('stores an empty pillar_link as NULL rather than an empty string', async () => {
    const db = glossaryDb();
    await parse(call(list.onRequestPost, { db, body: { slug: 'blank-link', name: 'N', part: 'I', sort_order: 1, body_html: HTML, pillar_link: '' } }));
    assert.equal(readTerm(db, 'term_blank-link').pillar_link, null);
  });

  it('stores a null pillar_link and a null abbreviation as NULL', async () => {
    const db = glossaryDb();
    await parse(call(list.onRequestPost, { db, body: { slug: 'nulls', name: 'N', part: 'I', sort_order: 1, body_html: HTML, pillar_link: null, abbreviation: null } }));
    const row = readTerm(db, 'term_nulls');
    assert.equal(row.pillar_link, null);
    assert.equal(row.abbreviation, null);
  });

  it('keeps a valid relative pillar_link and abbreviation verbatim', async () => {
    const db = glossaryDb();
    await parse(call(list.onRequestPost, { db, body: { slug: 'endo', name: 'Endometriosis', part: 'I', sort_order: 1, body_html: HTML, pillar_link: '/endometriosis/', abbreviation: 'ENDO' } }));
    const row = readTerm(db, 'term_endo');
    assert.equal(row.pillar_link, '/endometriosis/');
    assert.equal(row.abbreviation, 'ENDO');
  });

  it('409s on a duplicate slug and leaves the existing row untouched', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endo', name: 'Original Name', sort_order: 3 }));
    const { status, body } = await parse(call(list.onRequestPost, {
      db,
      body: { slug: 'endo', name: 'Overwriting Name', part: 'I', sort_order: 1, body_html: HTML },
    }));
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_already_exists');
    const row = readTerm(db, 'term_endo');
    assert.equal(row.name, 'Original Name');
    assert.equal(row.sort_order, 3);
    assert.equal(countRows(db, 'glossary_term'), 1);
  });
});

describe('POST /api/admin/glossary/terms -- create with an auto sort_order', () => {
  it('appends after the highest sort_order IN THE SAME PART, ignoring other parts', async () => {
    const db = glossaryDb((s) => {
      insertTerm(s, { id: 'term_p1', slug: 'p1', part: 'I', sort_order: 7 });
      insertTerm(s, { id: 'term_p2', slug: 'p2', part: 'II', sort_order: 99 });
    });
    const { status } = await parse(call(list.onRequestPost, {
      db,
      body: { slug: 'appended', name: 'Appended', part: 'I', body_html: HTML },
    }));
    assert.equal(status, 201);
    assert.equal(readTerm(db, 'term_appended').sort_order, 8);
  });

  it('starts at 1 in a part that has no terms yet', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_p2', slug: 'p2', part: 'II', sort_order: 99 }));
    await parse(call(list.onRequestPost, { db, body: { slug: 'first-in-part', name: 'F', part: 'V', body_html: HTML } }));
    assert.equal(readTerm(db, 'term_first-in-part').sort_order, 1);
  });

  it('returns the row it just wrote, read back after the batch', async () => {
    const db = glossaryDb();
    const { body } = await parse(call(list.onRequestPost, { db, body: { slug: 'readback', name: 'Read Back', part: 'I', body_html: HTML } }));
    assert.equal(body.data.id, 'term_readback');
    assert.equal(body.data.word_count, 4);
    assert.equal(body.created, true);
  });

  it('carries abbreviation and pillar_link through the batch insert too', async () => {
    const db = glossaryDb();
    await parse(call(list.onRequestPost, {
      db,
      body: { slug: 'pcos', name: 'PCOS', part: 'I', body_html: HTML, abbreviation: 'PCOS', pillar_link: '/pcos/' },
    }));
    const row = readTerm(db, 'term_pcos');
    assert.equal(row.abbreviation, 'PCOS');
    assert.equal(row.pillar_link, '/pcos/');
  });

  it('409s on a duplicate slug without clobbering the existing row', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_dup', slug: 'dup', name: 'Keep Me', part: 'I', sort_order: 2 }));
    const { status, body } = await parse(call(list.onRequestPost, { db, body: { slug: 'dup', name: 'Clobber', part: 'I', body_html: HTML } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_already_exists');
    assert.equal(readTerm(db, 'term_dup').name, 'Keep Me');
  });
});

describe('POST /api/admin/glossary/terms -- D1 failure', () => {
  it('500s without writing when the explicit-sort_order INSERT throws', async () => {
    const events = recordingEvents();
    const real = glossaryDb();
    const db = faultyDb(real, { on: 'INSERT OR IGNORE INTO glossary_term', message: 'D1_ERROR: disk I/O error on shard 7' });
    const { status, body } = await parse(call(list.onRequestPost, {
      db, events,
      body: { slug: 'boom', name: 'Boom', part: 'I', sort_order: 1, body_html: HTML },
    }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('shard 7'), false);
    assert.deepEqual(events.actions, ['term_create_error']);
    assert.equal(countRows(real, 'glossary_term'), 0);
  });

  it('500s when the auto-sort_order batch throws', async () => {
    const events = recordingEvents();
    const real = glossaryDb();
    const db = faultyDb(real, { on: 'INSERT OR IGNORE INTO glossary_term' });
    const { status } = await parse(call(list.onRequestPost, { db, events, body: { slug: 'boom2', name: 'Boom', part: 'I', body_html: HTML } }));
    assert.equal(status, 500);
    assert.deepEqual(events.actions, ['term_create_error']);
    assert.equal(countRows(real, 'glossary_term'), 0);
  });
});

// ============================================================ GET /terms/:id

describe('GET /api/admin/glossary/terms/:id', () => {
  let db;
  beforeEach(() => { db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endo', name: 'Endometriosis', body_html: '<p>Full body.</p>' })); });

  it('401s with no user', async () => {
    assert.equal((await parse(call(byId.onRequestGet, { db, user: null, params: { id: 'term_endo' } }))).status, 401);
  });

  it('403s a member', async () => {
    assert.equal((await parse(call(byId.onRequestGet, { db, user: MEMBER, params: { id: 'term_endo' } }))).status, 403);
  });

  it('503s with no DB binding', async () => {
    assert.equal((await parse(call(byId.onRequestGet, { db: undefined, params: { id: 'term_endo' } }))).status, 503);
  });

  it('400s when the route param is absent', async () => {
    const { status, body } = await parse(call(byId.onRequestGet, { db, params: {} }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid id');
  });

  it('400s when the route param is not a string', async () => {
    assert.equal((await parse(call(byId.onRequestGet, { db, params: { id: 123 } }))).status, 400);
  });

  it('400s when the route param exceeds 150 chars', async () => {
    assert.equal((await parse(call(byId.onRequestGet, { db, params: { id: 'x'.repeat(151) } }))).status, 400);
  });

  it('404s for an id that does not exist', async () => {
    const { status, body } = await parse(call(byId.onRequestGet, { db, params: { id: 'term_missing' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('returns the full row including body_html', async () => {
    const { status, body } = await parse(call(byId.onRequestGet, { db, params: { id: 'term_endo' } }));
    assert.equal(status, 200);
    assert.equal(body.data.name, 'Endometriosis');
    assert.equal(body.data.body_html, '<p>Full body.</p>');
  });

  it('looks up by id case-SENSITIVELY -- id has no NOCASE collation', async () => {
    const { status } = await parse(call(byId.onRequestGet, { db, params: { id: 'TERM_ENDO' } }));
    assert.equal(status, 404);
  });

  it('500s generically when D1 throws, logging term_get_error', async () => {
    const events = recordingEvents();
    const faulty = faultyDb(db, { on: 'SELECT * FROM glossary_term', message: 'D1_ERROR: internal detail leaked' });
    const { status, body } = await parse(call(byId.onRequestGet, { db: faulty, events, params: { id: 'term_endo' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('internal detail'), false);
    assert.deepEqual(events.actions, ['term_get_error']);
  });
});

// ============================================================ PUT /terms/:id

describe('PUT /api/admin/glossary/terms/:id -- authorization and shape', () => {
  let db;
  beforeEach(() => { db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endo', name: 'Original' })); });

  it('401s with no user and does not mutate', async () => {
    const { status } = await parse(call(byId.onRequestPut, { db, user: null, params: { id: 'term_endo' }, body: { name: 'Hacked' } }));
    assert.equal(status, 401);
    assert.equal(readTerm(db, 'term_endo').name, 'Original');
  });

  it('403s a member and does not mutate', async () => {
    const { status, body } = await parse(call(byId.onRequestPut, { db, user: MEMBER, params: { id: 'term_endo' }, body: { name: 'Hacked' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(readTerm(db, 'term_endo').name, 'Original');
  });

  it('503s with no DB binding', async () => {
    assert.equal((await parse(call(byId.onRequestPut, { db: undefined, params: { id: 'term_endo' }, body: { name: 'x' } }))).status, 503);
  });

  it('400s on a missing route param', async () => {
    assert.equal((await parse(call(byId.onRequestPut, { db, params: {}, body: { name: 'x' } }))).status, 400);
  });

  it('400s on an over-long route param', async () => {
    assert.equal((await parse(call(byId.onRequestPut, { db, params: { id: 'x'.repeat(151) }, body: { name: 'x' } }))).status, 400);
  });

  it('400s on a non-JSON body', async () => {
    const { status, body } = await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, noBody: true }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('refuses a slug change outright -- slugs are the public URL', async () => {
    const { status, body } = await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, body: { slug: 'renamed' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'slug_immutable_use_recreate');
    assert.equal(readTerm(db, 'term_endo').slug, 'endo');
  });

  it('names the unknown fields it rejected', async () => {
    const { status, body } = await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, body: { name: 'ok', word_count: 999, created_at: 'x' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'unknown_fields');
    assert.deepEqual(body.detail.unknown.sort(), ['created_at', 'word_count']);
    assert.equal(readTerm(db, 'term_endo').name, 'Original');
  });

  it('400s when the body carries no updatable field at all', async () => {
    const { status, body } = await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, body: {} }));
    assert.equal(status, 400);
    assert.equal(body.error, 'no_fields_provided');
  });
});

describe('PUT /api/admin/glossary/terms/:id -- input validation refuses the write', () => {
  const cases = [
    ['name empty', { name: '' }, 'name_required'],
    ['name not a string', { name: 42 }, 'name_required'],
    ['name over 300 chars', { name: 'n'.repeat(301) }, 'name_too_long'],
    ['part outside I-VIII', { part: 'IX' }, 'invalid_part'],
    ['status outside the enum', { status: 'live' }, 'invalid_status'],
    ['body_html empty', { body_html: '  ' }, 'body_html_required'],
    ['body_html not a string', { body_html: 42 }, 'body_html_required'],
    ['body_html over 200000 chars', { body_html: 'x'.repeat(200001) }, 'body_html_too_long'],
    ['abbreviation over 100 chars', { abbreviation: 'a'.repeat(101) }, 'abbreviation_too_long'],
    ['abbreviation not a string', { abbreviation: 42 }, 'abbreviation_too_long'],
    ['pillar_link not a string', { pillar_link: 42 }, 'pillar_link_invalid_type'],
    ['pillar_link absolute', { pillar_link: 'https://evil.example' }, 'pillar_link_must_be_relative'],
    ['pillar_link protocol-relative', { pillar_link: '//evil.example' }, 'pillar_link_must_be_relative'],
    ['pillar_link over 500 chars', { pillar_link: '/' + 'p'.repeat(500) }, 'pillar_link_too_long'],
    ['sort_order fractional', { sort_order: 2.5 }, 'sort_order_invalid'],
    ['sort_order negative', { sort_order: -3 }, 'sort_order_invalid'],
    ['sort_order over 10000', { sort_order: 10001 }, 'sort_order_invalid'],
  ];

  for (const [label, body, error] of cases) {
    it(`rejects ${label} with ${error}`, async () => {
      const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endo', name: 'Original', part: 'I', sort_order: 5, status: 'published' }));
      const { status, body: res } = await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, body }));
      assert.equal(status, 400);
      assert.equal(res.error, error);
      const row = readTerm(db, 'term_endo');
      assert.equal(row.name, 'Original');
      assert.equal(row.part, 'I');
      assert.equal(row.sort_order, 5);
      assert.equal(row.status, 'published');
    });
  }
});

describe('PUT /api/admin/glossary/terms/:id -- successful updates', () => {
  it('writes only the fields supplied and stamps updated_at', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endo', name: 'Original', part: 'I', sort_order: 5, body_html: '<p>Old body.</p>', word_count: 2, status: 'published' }));
    db._sqlite.prepare("UPDATE glossary_term SET updated_at = '2020-01-01 00:00:00' WHERE id = 'term_endo'").run();

    const { status, body } = await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, body: { name: 'Endometriosis' } }));
    assert.equal(status, 200);

    const row = readTerm(db, 'term_endo');
    assert.equal(row.name, 'Endometriosis');
    assert.equal(row.body_html, '<p>Old body.</p>', 'untouched fields stay untouched');
    assert.equal(row.sort_order, 5);
    assert.notEqual(row.updated_at, '2020-01-01 00:00:00', 'updated_at is refreshed on every write');
    assert.equal(body.data.name, 'Endometriosis');
  });

  it('recomputes word_count whenever body_html changes', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endo', body_html: '<p>Two words</p>', word_count: 2 }));
    await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, body: { body_html: '<p>One <em>two</em> three four five.</p>' } }));
    assert.equal(readTerm(db, 'term_endo').word_count, 5);
  });

  it('leaves word_count alone when body_html is not part of the update', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endo', word_count: 42 }));
    await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, body: { name: 'Renamed' } }));
    assert.equal(readTerm(db, 'term_endo').word_count, 42);
  });

  it('re-appends the term when its part changes and no sort_order was given', async () => {
    const db = glossaryDb((s) => {
      insertTerm(s, { id: 'term_move', slug: 'move', part: 'I', sort_order: 1 });
      insertTerm(s, { id: 'term_iii_a', slug: 'iii-a', part: 'III', sort_order: 11 });
      insertTerm(s, { id: 'term_ii_a', slug: 'ii-a', part: 'II', sort_order: 500 });
    });
    await parse(call(byId.onRequestPut, { db, params: { id: 'term_move' }, body: { part: 'III' } }));
    const row = readTerm(db, 'term_move');
    assert.equal(row.part, 'III');
    assert.equal(row.sort_order, 12, 'MAX+1 within the NEW part, not across all parts');
  });

  it('honours an explicit sort_order instead of re-appending when part also changes', async () => {
    const db = glossaryDb((s) => {
      insertTerm(s, { id: 'term_move', slug: 'move', part: 'I', sort_order: 1 });
      insertTerm(s, { id: 'term_iii_a', slug: 'iii-a', part: 'III', sort_order: 11 });
    });
    await parse(call(byId.onRequestPut, { db, params: { id: 'term_move' }, body: { part: 'III', sort_order: 3 } }));
    const row = readTerm(db, 'term_move');
    assert.equal(row.part, 'III');
    assert.equal(row.sort_order, 3);
  });

  it('accepts a null abbreviation and a null pillar_link as explicit clears', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endo', abbreviation: 'ENDO', pillar_link: '/endometriosis/' }));
    await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, body: { abbreviation: null, pillar_link: null } }));
    const row = readTerm(db, 'term_endo');
    assert.equal(row.abbreviation, null);
    assert.equal(row.pillar_link, null);
  });

  it('404s for an id that does not exist, on the plain UPDATE path', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endo' }));
    const { status, body } = await parse(call(byId.onRequestPut, { db, params: { id: 'term_ghost' }, body: { name: 'X' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });
});

describe('PUT /api/admin/glossary/terms/:id -- unpublishing unlinks abbreviations', () => {
  function seeded() {
    return glossaryDb((s) => {
      insertTerm(s, { id: 'term_endo', slug: 'endo', status: 'published' });
      insertTerm(s, { id: 'term_pcos', slug: 'pcos', status: 'published' });
      // term_slug is declared plain TEXT (BINARY), so the endpoint's explicit
      // COLLATE NOCASE is the only reason this mixed-case link is found.
      insertAbbr(s, { abbreviation: 'ENDO', full_term: 'Endometriosis', term_slug: 'ENDO' });
      insertAbbr(s, { abbreviation: 'PCOS', full_term: 'Polycystic Ovary Syndrome', term_slug: 'pcos' });
    });
  }

  it('clears term_slug on every linked abbreviation when status goes to archived', async () => {
    const db = seeded();
    const { status } = await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, body: { status: 'archived' } }));
    assert.equal(status, 200);
    assert.equal(readTerm(db, 'term_endo').status, 'archived');
    assert.equal(db._sqlite.prepare("SELECT term_slug FROM glossary_abbreviation WHERE abbreviation = 'ENDO'").get().term_slug, null);
    assert.equal(db._sqlite.prepare("SELECT term_slug FROM glossary_abbreviation WHERE abbreviation = 'PCOS'").get().term_slug, 'pcos', 'unrelated abbreviations are left alone');
  });

  it('also unlinks when status goes to draft', async () => {
    const db = seeded();
    await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, body: { status: 'draft' } }));
    assert.equal(db._sqlite.prepare("SELECT term_slug FROM glossary_abbreviation WHERE abbreviation = 'ENDO'").get().term_slug, null);
  });

  it('does NOT unlink when status is set to published', async () => {
    const db = seeded();
    db._sqlite.prepare("UPDATE glossary_term SET status = 'draft' WHERE id = 'term_endo'").run();
    await parse(call(byId.onRequestPut, { db, params: { id: 'term_endo' }, body: { status: 'published' } }));
    assert.equal(db._sqlite.prepare("SELECT term_slug FROM glossary_abbreviation WHERE abbreviation = 'ENDO'").get().term_slug, 'ENDO');
  });

  it('404s on the batch path for an id that does not exist', async () => {
    const db = seeded();
    const { status, body } = await parse(call(byId.onRequestPut, { db, params: { id: 'term_ghost' }, body: { status: 'archived' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(db._sqlite.prepare("SELECT term_slug FROM glossary_abbreviation WHERE abbreviation = 'ENDO'").get().term_slug, 'ENDO');
  });
});

describe('PUT /api/admin/glossary/terms/:id -- D1 failure', () => {
  it('500s when the plain UPDATE throws, logging term_update_error', async () => {
    const events = recordingEvents();
    const real = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endo', name: 'Original' }));
    const db = faultyDb(real, { on: 'UPDATE glossary_term SET', message: 'D1_ERROR: statement too large 118kb' });
    const { status, body } = await parse(call(byId.onRequestPut, { db, events, params: { id: 'term_endo' }, body: { name: 'New' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('118kb'), false);
    assert.deepEqual(events.actions, ['term_update_error']);
    assert.equal(readTerm(real, 'term_endo').name, 'Original');
  });

  it('500s when the archive batch throws, leaving the abbreviation link intact', async () => {
    const events = recordingEvents();
    const real = glossaryDb((s) => {
      insertTerm(s, { id: 'term_endo', slug: 'endo', status: 'published' });
      insertAbbr(s, { abbreviation: 'ENDO', term_slug: 'endo' });
    });
    const db = faultyDb(real, { on: 'UPDATE glossary_abbreviation SET term_slug = NULL' });
    const { status } = await parse(call(byId.onRequestPut, { db, events, params: { id: 'term_endo' }, body: { status: 'archived' } }));
    assert.equal(status, 500);
    assert.deepEqual(events.actions, ['term_update_error']);
    assert.equal(readTerm(real, 'term_endo').status, 'published');
    assert.equal(real._sqlite.prepare("SELECT term_slug FROM glossary_abbreviation WHERE abbreviation = 'ENDO'").get().term_slug, 'endo');
  });
});

// ========================================================= DELETE /terms/:id

describe('DELETE /api/admin/glossary/terms/:id', () => {
  function seeded() {
    return glossaryDb((s) => {
      insertTerm(s, { id: 'term_endo', slug: 'endo' });
      insertAbbr(s, { abbreviation: 'ENDO', full_term: 'Endometriosis', term_slug: 'ENDO' });
      insertAbbr(s, { abbreviation: 'PCOS', full_term: 'Polycystic Ovary Syndrome', term_slug: 'pcos' });
    });
  }

  it('401s with no user and deletes nothing', async () => {
    const db = seeded();
    assert.equal((await parse(call(byId.onRequestDelete, { db, user: null, params: { id: 'term_endo' } }))).status, 401);
    assert.ok(readTerm(db, 'term_endo'));
  });

  it('403s a member and deletes nothing -- the line an attacker cares about', async () => {
    const db = seeded();
    const { status, body } = await parse(call(byId.onRequestDelete, { db, user: MEMBER, params: { id: 'term_endo' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.ok(readTerm(db, 'term_endo'));
  });

  it('403s an editor and deletes nothing', async () => {
    const db = seeded();
    assert.equal((await parse(call(byId.onRequestDelete, { db, user: EDITOR, params: { id: 'term_endo' } }))).status, 403);
    assert.ok(readTerm(db, 'term_endo'));
  });

  it('503s with no DB binding', async () => {
    assert.equal((await parse(call(byId.onRequestDelete, { db: undefined, params: { id: 'term_endo' } }))).status, 503);
  });

  it('400s on a missing route param', async () => {
    assert.equal((await parse(call(byId.onRequestDelete, { db: seeded(), params: {} }))).status, 400);
  });

  it('400s on an over-long route param', async () => {
    assert.equal((await parse(call(byId.onRequestDelete, { db: seeded(), params: { id: 'x'.repeat(151) } }))).status, 400);
  });

  it('404s for an id that does not exist', async () => {
    const { status, body } = await parse(call(byId.onRequestDelete, { db: seeded(), params: { id: 'term_ghost' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('refuses when another term cites the anchor with double quotes', async () => {
    const db = glossaryDb((s) => {
      insertTerm(s, { id: 'term_endo', slug: 'endo' });
      insertTerm(s, { id: 'term_pain', slug: 'pain', body_html: '<p>See <a href="#endo">endo</a>.</p>' });
    });
    const { status, body } = await parse(call(byId.onRequestDelete, { db, params: { id: 'term_endo' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'term_in_use');
    assert.deepEqual(body.detail.citing_slugs, ['pain']);
    assert.ok(readTerm(db, 'term_endo'), 'the cited term survives');
  });

  it('refuses when another term cites the anchor with single quotes', async () => {
    const db = glossaryDb((s) => {
      insertTerm(s, { id: 'term_endo', slug: 'endo' });
      insertTerm(s, { id: 'term_pain', slug: 'pain', body_html: "<p>See <a href='#endo'>endo</a>.</p>" });
    });
    const { status, body } = await parse(call(byId.onRequestDelete, { db, params: { id: 'term_endo' } }));
    assert.equal(status, 409);
    assert.deepEqual(body.detail.citing_slugs, ['pain']);
  });

  it('is not fooled by a longer slug that merely starts with this one', async () => {
    const db = glossaryDb((s) => {
      insertTerm(s, { id: 'term_endo', slug: 'endo' });
      insertTerm(s, { id: 'term_pain', slug: 'pain', body_html: '<p>See <a href="#endo-pain">endo pain</a>.</p>' });
    });
    const { status } = await parse(call(byId.onRequestDelete, { db, params: { id: 'term_endo' } }));
    assert.equal(status, 200);
    assert.equal(readTerm(db, 'term_endo'), null);
  });

  it('ignores a self-citation -- a term linking to its own anchor still deletes', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endo', body_html: '<p>Back to <a href="#endo">top</a>.</p>' }));
    const { status } = await parse(call(byId.onRequestDelete, { db, params: { id: 'term_endo' } }));
    assert.equal(status, 200);
    assert.equal(readTerm(db, 'term_endo'), null);
  });

  it('deletes the term and NULLs the linked abbreviation, matching term_slug case-insensitively', async () => {
    const db = seeded();
    const { status, body } = await parse(call(byId.onRequestDelete, { db, params: { id: 'term_endo' } }));

    assert.equal(status, 200);
    assert.equal(body.deleted, true);
    assert.deepEqual(body.unlinked_abbreviations, ['ENDO']);
    assert.equal(readTerm(db, 'term_endo'), null, 'the term row is gone');
    assert.equal(
      db._sqlite.prepare("SELECT term_slug FROM glossary_abbreviation WHERE abbreviation = 'ENDO'").get().term_slug,
      null,
      'the child link is cleared explicitly, because D1 does not honour ON DELETE CASCADE'
    );
    assert.equal(
      db._sqlite.prepare("SELECT term_slug FROM glossary_abbreviation WHERE abbreviation = 'PCOS'").get().term_slug,
      'pcos',
      'an unrelated abbreviation is untouched'
    );
    assert.equal(countRows(db, 'glossary_abbreviation'), 2, 'abbreviations are unlinked, never deleted');
  });

  it('still deletes, reporting no unlinks, if the driver returns no results key', async () => {
    const real = seeded();
    const db = resultlessDb(real, { on: 'SELECT abbreviation FROM glossary_abbreviation' });
    const { status, body } = await parse(call(byId.onRequestDelete, { db, params: { id: 'term_endo' } }));
    assert.equal(status, 200);
    assert.deepEqual(body.unlinked_abbreviations, []);
    assert.equal(readTerm(real, 'term_endo'), null);
  });

  it('reports an empty unlink list when nothing pointed at the term', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_lonely', slug: 'lonely' }));
    const { status, body } = await parse(call(byId.onRequestDelete, { db, params: { id: 'term_lonely' } }));
    assert.equal(status, 200);
    assert.deepEqual(body.unlinked_abbreviations, []);
  });

  it('500s when the delete batch throws, leaving both the term and its link intact', async () => {
    const events = recordingEvents();
    const real = seeded();
    const db = faultyDb(real, { on: 'DELETE FROM glossary_term', message: 'D1_ERROR: transaction rolled back' });
    const { status, body } = await parse(call(byId.onRequestDelete, { db, events, params: { id: 'term_endo' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('rolled back'), false);
    assert.deepEqual(events.actions, ['term_delete_error']);
    assert.ok(readTerm(real, 'term_endo'));
    assert.equal(real._sqlite.prepare("SELECT term_slug FROM glossary_abbreviation WHERE abbreviation = 'ENDO'").get().term_slug, 'ENDO');
  });

  it('500s when the in-use lookup throws, before anything is deleted', async () => {
    const events = recordingEvents();
    const real = seeded();
    const db = faultyDb(real, { on: 'SELECT slug FROM glossary_term WHERE id !=' });
    const { status } = await parse(call(byId.onRequestDelete, { db, events, params: { id: 'term_endo' } }));
    assert.equal(status, 500);
    assert.deepEqual(events.actions, ['term_delete_error']);
    assert.ok(readTerm(real, 'term_endo'));
  });
});

// ============================================ wired through the real middleware

describe('glossary terms admin -- authorization end to end through admin/_middleware.js', () => {
  const FUTURE = Math.floor(Date.now() / 1000) + 86400;
  let db;

  beforeEach(async () => {
    db = glossaryDb((s) => {
      insertUser(s, { id: 'u_super', email: 'super@example.com', role: 'superadmin' });
      insertUser(s, { id: 'u_member', email: 'member@example.com', role: 'member' });
      insertUser(s, { id: 'u_blocked', email: 'blocked@example.com', role: 'superadmin', blocked: 1 });
      insertTerm(s, { id: 'term_endo', slug: 'endo', name: 'Endometriosis' });
    });
    await insertSession(db._sqlite, { rawId: 'sess-super', userId: 'u_super', expiresAt: FUTURE });
    await insertSession(db._sqlite, { rawId: 'sess-member', userId: 'u_member', expiresAt: FUTURE });
    await insertSession(db._sqlite, { rawId: 'sess-blocked', userId: 'u_blocked', expiresAt: FUTURE });
  });

  async function viaMiddleware(cookie) {
    const context = {
      request: mockRequest('GET', { url: 'https://rrmacademy.org/api/admin/glossary/terms', headers: cookie ? { Cookie: `session=${cookie}` } : {} }),
      env: mockEnv({ DB: db }),
      params: {},
      waitUntil: mockWaitUntil(),
    };
    context.next = () => list.onRequestGet(context);
    return parseResponse(await adminMiddleware.onRequest(context));
  }

  it('a superadmin session reaches the handler', async () => {
    const { status, body } = await viaMiddleware('sess-super');
    assert.equal(status, 200);
    assert.equal(body.results.length, 1);
  });

  it('a member session is refused 403 -- role comes from the user row, not the request', async () => {
    const { status, body } = await viaMiddleware('sess-member');
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
  });

  it('a blocked superadmin never gets a user populated, so the handler answers 401', async () => {
    const { status, body } = await viaMiddleware('sess-blocked');
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('no cookie at all answers 401', async () => {
    const { status } = await viaMiddleware(null);
    assert.equal(status, 401);
  });
});
