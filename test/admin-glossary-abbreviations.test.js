/**
 * functions/api/admin/glossary/abbreviations/index.js  (list + create)
 * functions/api/admin/glossary/abbreviations/[abbr].js (read + update + delete)
 *
 * The third pair in the glossary-admin CRUD surface, and the sibling of the
 * terms and refs pairs already covered by admin-glossary-terms.test.js and
 * admin-glossary-refs.test.js. Same harness, same discipline: every mutation is
 * asserted by reading the row back out of a real SQLite engine loaded with the
 * committed rrm-auth schema (test/_d1-sqlite.mjs), never off a canned mock.
 *
 * What only the engine can decide here:
 *   - `abbreviation TEXT PRIMARY KEY COLLATE NOCASE`. That declared collation is
 *     what turns a differently-cased duplicate into a 409 through INSERT OR
 *     IGNORE returning no row, and what lets GET/PUT/DELETE address a row by a
 *     case that was never stored. A substring mock would answer either way.
 *   - `COALESCE(MAX(sort_order), 0) + 1` auto-numbering, including its value on
 *     an empty table, where an aggregate over no rows either yields 1 or yields
 *     nothing at all.
 *   - The `term_slug` foreign reference is checked in application code against
 *     `glossary_term.slug` under an explicit COLLATE NOCASE. Foreign keys are
 *     OFF here exactly as they are in D1, so that check is endpoint discipline
 *     rather than something the engine enforces.
 *
 * Read-backs use readAbbrExact(), which queries COLLATE BINARY on purpose: it
 * proves a NOCASE write landed on the row whose stored casing the test names,
 * rather than on some other row that merely compares equal.
 *
 * The final describe block records four places where this pair DIVERGES from
 * its siblings. Those tests assert the behaviour that ships today. They are
 * documentation of a defect, not an endorsement of it.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { insertUser, insertSession, schemaCollation } from './_d1-sqlite.mjs';
import {
  SUPERADMIN, ADMIN, MEMBER, EDITOR,
  glossaryDb, insertTerm, insertAbbr,
  readAbbrExact, countRows,
  faultyDb, messagelessThrowDb, nullResultsDb, firstlessDb, recordingEvents,
} from './_glossary-fixtures.mjs';

const list = await import('../functions/api/admin/glossary/abbreviations/index.js');
const byAbbr = await import('../functions/api/admin/glossary/abbreviations/[abbr].js');
const adminMiddleware = await import('../functions/api/admin/_middleware.js');

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

describe('glossary abbreviations -- CORS preflight', () => {
  it('index answers 204 with the locked-down origin', () => {
    const res = list.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });

  it('[abbr] answers 204 with the locked-down origin', () => {
    const res = byAbbr.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

// ============================================== which collation is holding

describe('glossary abbreviations -- the collation the case-insensitive tests actually hold', () => {
  // Every "matches case-insensitively" assertion in this file passes because of
  // the COLUMN collation, not because of the `COLLATE NOCASE` these handlers
  // append. Deleting that suffix from the three [abbr].js queries changes no
  // result, which was verified by mutation and is why it is stated here rather
  // than asserted through a request. Pinning the declared collations turns a
  // future schema regeneration that drops NOCASE into a named failure instead
  // of a silent behaviour change across three endpoints.
  it('glossary_abbreviation.abbreviation is declared NOCASE, so a bare = is already case-insensitive', () => {
    assert.equal(schemaCollation('glossary_abbreviation', 'abbreviation'), 'NOCASE');
  });

  it('glossary_term.slug is declared NOCASE, which is what makes the term_slug existence check case-insensitive', () => {
    assert.equal(schemaCollation('glossary_term', 'slug'), 'NOCASE');
  });

  it('glossary_abbreviation.term_slug is BINARY, so the query-level COLLATE in terms/[id].js is load-bearing', () => {
    assert.equal(schemaCollation('glossary_abbreviation', 'term_slug'), 'BINARY');
  });
});

// ======================================================= GET /abbreviations

describe('GET /api/admin/glossary/abbreviations -- authorization', () => {
  let db;
  beforeEach(() => { db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'RRM' })); });

  it('401s with no user', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db, user: null }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('403s a member', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db, user: MEMBER }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
  });

  it('403s any other non-admin role', async () => {
    assert.equal((await parse(call(list.onRequestGet, { db, user: EDITOR }))).status, 403);
  });

  it('admits role=admin, not only superadmin', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db, user: ADMIN }));
    assert.equal(status, 200);
    assert.equal(body.results.length, 1);
  });

  it('503s when the DB binding is missing', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db: undefined }));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });
});

describe('GET /api/admin/glossary/abbreviations -- listing', () => {
  it('orders by sort_order ascending, not by insertion order', async () => {
    const db = glossaryDb((s) => {
      insertAbbr(s, { abbreviation: 'TWELVE', sort_order: 12 });
      insertAbbr(s, { abbreviation: 'THREE', sort_order: 3 });
      insertAbbr(s, { abbreviation: 'SEVEN', sort_order: 7 });
    });
    const { body } = await parse(call(list.onRequestGet, { db }));
    assert.deepEqual(body.results.map((r) => r.abbreviation), ['THREE', 'SEVEN', 'TWELVE']);
  });

  it('projects exactly the four admin-list columns and omits the timestamps', async () => {
    const db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'RRM', term_slug: 'endo' }));
    const { body } = await parse(call(list.onRequestGet, { db }));
    assert.deepEqual(
      Object.keys(body.results[0]).sort(),
      ['abbreviation', 'full_term', 'sort_order', 'term_slug']
    );
  });

  it('returns the stored values verbatim, including a null term_slug', async () => {
    const db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'FABM', full_term: 'Fertility Awareness Based Methods', sort_order: 4 }));
    const { body } = await parse(call(list.onRequestGet, { db }));
    assert.deepEqual(body.results[0], {
      abbreviation: 'FABM',
      full_term: 'Fertility Awareness Based Methods',
      term_slug: null,
      sort_order: 4,
    });
  });

  it('returns an empty array for an empty table', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db: glossaryDb() }));
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
  });

  it('falls back to [] if the driver hands back no results key', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db: nullResultsDb() }));
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
  });

  it('500s generically when D1 throws, logging abbrs_list_error and leaking nothing', async () => {
    const events = recordingEvents();
    const db = faultyDb(glossaryDb(), { on: 'ORDER BY sort_order ASC', message: 'D1_ERROR: shard credential expired' });
    const { status, body } = await parse(call(list.onRequestGet, { db, events }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('credential'), false);
    assert.deepEqual(events.actions, ['abbrs_list_error']);
  });
});

// ====================================================== POST /abbreviations

describe('POST /api/admin/glossary/abbreviations -- authorization', () => {
  const valid = { abbreviation: 'RRM', full_term: 'Restorative Reproductive Medicine' };

  it('401s with no user and writes nothing', async () => {
    const db = glossaryDb();
    const { status, body } = await parse(call(list.onRequestPost, { db, user: null, body: valid }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
    assert.equal(countRows(db, 'glossary_abbreviation'), 0);
  });

  it('403s a member and writes nothing', async () => {
    const db = glossaryDb();
    const { status, body } = await parse(call(list.onRequestPost, { db, user: MEMBER, body: valid }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(countRows(db, 'glossary_abbreviation'), 0);
  });

  it('403s an editor and writes nothing', async () => {
    const db = glossaryDb();
    assert.equal((await parse(call(list.onRequestPost, { db, user: EDITOR, body: valid }))).status, 403);
    assert.equal(countRows(db, 'glossary_abbreviation'), 0);
  });

  it('admits role=admin', async () => {
    const db = glossaryDb();
    assert.equal((await parse(call(list.onRequestPost, { db, user: ADMIN, body: valid }))).status, 201);
    assert.equal(countRows(db, 'glossary_abbreviation'), 1);
  });

  it('503s with no DB binding', async () => {
    assert.equal((await parse(call(list.onRequestPost, { db: undefined, body: valid }))).status, 503);
  });
});

describe('POST /api/admin/glossary/abbreviations -- input validation refuses the write', () => {
  const base = { abbreviation: 'RRM', full_term: 'Restorative Reproductive Medicine' };
  const cases = [
    ['abbreviation absent', { ...base, abbreviation: undefined }, 'abbreviation_required'],
    ['abbreviation empty', { ...base, abbreviation: '' }, 'abbreviation_required'],
    ['abbreviation whitespace only', { ...base, abbreviation: '   ' }, 'abbreviation_required'],
    ['abbreviation not a string', { ...base, abbreviation: 42 }, 'abbreviation_required'],
    ['abbreviation explicitly null', { ...base, abbreviation: null }, 'abbreviation_required'],
    ['abbreviation over 100 chars', { ...base, abbreviation: 'A'.repeat(101) }, 'abbreviation_too_long'],
    ['full_term absent', { ...base, full_term: undefined }, 'full_term_required'],
    ['full_term empty', { ...base, full_term: '' }, 'full_term_required'],
    ['full_term whitespace only', { ...base, full_term: '   ' }, 'full_term_required'],
    ['full_term not a string', { ...base, full_term: 42 }, 'full_term_required'],
    ['full_term explicitly null', { ...base, full_term: null }, 'full_term_required'],
    ['full_term over 500 chars', { ...base, full_term: 'f'.repeat(501) }, 'full_term_too_long'],
    ['term_slug over 100 chars', { ...base, term_slug: 's'.repeat(101) }, 'term_slug_too_long'],
    ['sort_order sent as a string', { ...base, sort_order: '5' }, 'sort_order_invalid'],
    ['sort_order fractional', { ...base, sort_order: 5.5 }, 'sort_order_invalid'],
    ['sort_order negative', { ...base, sort_order: -1 }, 'sort_order_invalid'],
    ['sort_order over 10000', { ...base, sort_order: 10001 }, 'sort_order_invalid'],
    ['sort_order explicitly null', { ...base, sort_order: null }, 'sort_order_invalid'],
  ];

  for (const [label, body, error] of cases) {
    it(`rejects ${label} with ${error}`, async () => {
      const db = glossaryDb();
      const { status, body: res } = await parse(call(list.onRequestPost, { db, body }));
      assert.equal(status, 400);
      assert.equal(res.error, error);
      assert.equal(countRows(db, 'glossary_abbreviation'), 0);
    });
  }

  it('rejects a body that is not JSON', async () => {
    const db = glossaryDb();
    const { status, body } = await parse(call(list.onRequestPost, { db, noBody: true }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
    assert.equal(countRows(db, 'glossary_abbreviation'), 0);
  });

  it('measures abbreviation length before trimming, so 100 chars of padding still fits', async () => {
    const db = glossaryDb();
    const padded = ' ' + 'A'.repeat(98) + ' ';
    assert.equal(padded.length, 100);
    const { status } = await parse(call(list.onRequestPost, { db, body: { abbreviation: padded, full_term: 'Long' } }));
    assert.equal(status, 201);
    assert.equal(readAbbrExact(db, 'A'.repeat(98)).full_term, 'Long');
  });
});

describe('POST /api/admin/glossary/abbreviations -- create', () => {
  it('auto-numbers sort_order to 1 on an empty table', async () => {
    const db = glossaryDb();
    const { status, body } = await parse(call(list.onRequestPost, { db, body: { abbreviation: 'RRM', full_term: 'Restorative Reproductive Medicine' } }));
    assert.equal(status, 201);
    assert.equal(body.created, true);
    assert.equal(body.data.sort_order, 1);
    assert.equal(readAbbrExact(db, 'RRM').sort_order, 1);
  });

  it('auto-numbers to MAX+1, skipping past a gap rather than filling it', async () => {
    const db = glossaryDb((s) => {
      insertAbbr(s, { abbreviation: 'ONE', sort_order: 1 });
      insertAbbr(s, { abbreviation: 'FIFTY', sort_order: 58 });
    });
    const { body } = await parse(call(list.onRequestPost, { db, body: { abbreviation: 'NEXT', full_term: 'Next Thing' } }));
    assert.equal(body.data.sort_order, 59);
    assert.equal(readAbbrExact(db, 'NEXT').sort_order, 59);
  });

  it('falls back to sort_order 1 when the auto-number aggregate yields no row', async () => {
    // COALESCE(MAX(...),0)+1 always produces a row on a real engine, so the
    // `nextRow?.next ?? 1` guard is only reachable through a driver that hands
    // back nothing. Seeded at 50 so MAX+1 (51) and the fallback (1) differ.
    const real = glossaryDb((s) => insertAbbr(s, { abbreviation: 'SEED', sort_order: 50 }));
    const db = firstlessDb(real, { on: 'COALESCE(MAX(sort_order)' });
    const { status, body } = await parse(call(list.onRequestPost, { db, body: { abbreviation: 'FB', full_term: 'Fallback' } }));
    assert.equal(status, 201);
    assert.equal(body.data.sort_order, 1);
    assert.equal(readAbbrExact(real, 'FB').sort_order, 1);
  });

  it('honours an explicit sort_order instead of auto-numbering', async () => {
    const db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'SEED', sort_order: 90 }));
    const { body } = await parse(call(list.onRequestPost, { db, body: { abbreviation: 'PINNED', full_term: 'Pinned', sort_order: 3 } }));
    assert.equal(body.data.sort_order, 3);
    assert.equal(readAbbrExact(db, 'PINNED').sort_order, 3);
  });

  it('accepts the sort_order boundaries 0 and 10000', async () => {
    const db = glossaryDb();
    assert.equal((await parse(call(list.onRequestPost, { db, body: { abbreviation: 'LOW', full_term: 'Low', sort_order: 0 } }))).status, 201);
    assert.equal((await parse(call(list.onRequestPost, { db, body: { abbreviation: 'HIGH', full_term: 'High', sort_order: 10000 } }))).status, 201);
    assert.equal(readAbbrExact(db, 'LOW').sort_order, 0);
    assert.equal(readAbbrExact(db, 'HIGH').sort_order, 10000);
  });

  it('trims abbreviation and full_term before storing them', async () => {
    const db = glossaryDb();
    await parse(call(list.onRequestPost, { db, body: { abbreviation: '  NFP  ', full_term: '  Natural Family Planning  ' } }));
    assert.equal(readAbbrExact(db, 'NFP').full_term, 'Natural Family Planning');
    assert.equal(readAbbrExact(db, '  NFP  '), null, 'the untrimmed form is not what landed');
  });

  it('preserves the casing of the abbreviation it stores', async () => {
    const db = glossaryDb();
    await parse(call(list.onRequestPost, { db, body: { abbreviation: 'NaPro', full_term: 'Natural Procreative Technology' } }));
    assert.ok(readAbbrExact(db, 'NaPro'), 'stored with the submitted casing');
    assert.equal(readAbbrExact(db, 'NAPRO'), null, 'not upper-cased on the way in');
  });

  it('stores term_slug as NULL when the field is absent, without touching glossary_term', async () => {
    const events = recordingEvents();
    const db = faultyDb(glossaryDb(), { on: 'FROM glossary_term', message: 'D1_ERROR: should never run' });
    const { status } = await parse(call(list.onRequestPost, { db, events, body: { abbreviation: 'RRM', full_term: 'Restorative Reproductive Medicine' } }));
    assert.equal(status, 201, 'the term lookup is skipped entirely when term_slug is absent');
    assert.equal(readAbbrExact(db, 'RRM').term_slug, null);
  });

  it('normalizes term_slug by trimming and lower-casing, and links a NOCASE-matched term', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endometriosis', name: 'Endometriosis' }));
    const { status, body } = await parse(call(list.onRequestPost, {
      db,
      body: { abbreviation: 'ENDO', full_term: 'Endometriosis', term_slug: '  ENDOMETRIOSIS  ' },
    }));
    assert.equal(status, 201);
    assert.equal(body.data.term_slug, 'endometriosis');
    assert.equal(readAbbrExact(db, 'ENDO').term_slug, 'endometriosis');
  });

  it('treats an empty-string term_slug as NULL rather than as a lookup', async () => {
    const db = glossaryDb();
    const { status } = await parse(call(list.onRequestPost, { db, body: { abbreviation: 'RRM', full_term: 'Full', term_slug: '' } }));
    assert.equal(status, 201);
    assert.equal(readAbbrExact(db, 'RRM').term_slug, null);
  });

  it('treats a whitespace-only term_slug as NULL', async () => {
    const db = glossaryDb();
    const { status } = await parse(call(list.onRequestPost, { db, body: { abbreviation: 'RRM', full_term: 'Full', term_slug: '   ' } }));
    assert.equal(status, 201);
    assert.equal(readAbbrExact(db, 'RRM').term_slug, null);
  });

  it('treats an explicitly null term_slug as NULL', async () => {
    const db = glossaryDb();
    const { status } = await parse(call(list.onRequestPost, { db, body: { abbreviation: 'RRM', full_term: 'Full', term_slug: null } }));
    assert.equal(status, 201);
    assert.equal(readAbbrExact(db, 'RRM').term_slug, null);
  });

  it('400s term_slug_not_found for a slug no term carries, and writes nothing', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endometriosis' }));
    const { status, body } = await parse(call(list.onRequestPost, {
      db,
      body: { abbreviation: 'PCOS', full_term: 'Polycystic Ovary Syndrome', term_slug: 'pcos' },
    }));
    assert.equal(status, 400);
    assert.equal(body.error, 'term_slug_not_found');
    assert.equal(countRows(db, 'glossary_abbreviation'), 0);
  });

  it('500s when the term_slug lookup throws, logging abbr_term_slug_check_error and writing nothing', async () => {
    const events = recordingEvents();
    const real = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endometriosis' }));
    const db = faultyDb(real, { on: 'FROM glossary_term', message: 'D1_ERROR: replica lag token abc123' });
    const { status, body } = await parse(call(list.onRequestPost, {
      db, events,
      body: { abbreviation: 'ENDO', full_term: 'Endometriosis', term_slug: 'endometriosis' },
    }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('abc123'), false);
    assert.deepEqual(events.actions, ['abbr_term_slug_check_error']);
    assert.equal(countRows(real, 'glossary_abbreviation'), 0);
  });

  it('409s on an exact duplicate and leaves the existing row untouched', async () => {
    const db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'RRM', full_term: 'Original', sort_order: 1 }));
    const { status, body } = await parse(call(list.onRequestPost, { db, body: { abbreviation: 'RRM', full_term: 'Overwrite' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'abbreviation_already_exists');
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
    assert.equal(countRows(db, 'glossary_abbreviation'), 1);
  });

  it('409s on a duplicate that differs only in case -- the PK collation is NOCASE', async () => {
    const db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'RRM', full_term: 'Original' }));
    const { status, body } = await parse(call(list.onRequestPost, { db, body: { abbreviation: 'rrm', full_term: 'Lower Case Duplicate' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'abbreviation_already_exists');
    assert.equal(countRows(db, 'glossary_abbreviation'), 1, 'no second row was created');
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
    assert.equal(readAbbrExact(db, 'rrm'), null);
  });

  it('maps a UNIQUE-constraint throw to 409 rather than a 500, and does not log it', async () => {
    // INSERT OR IGNORE swallows the conflict on SQLite, so the raised-constraint
    // shape only reaches this catch through D1. Injected for that reason.
    const events = recordingEvents();
    const db = faultyDb(glossaryDb(), {
      on: 'INSERT OR IGNORE INTO glossary_abbreviation',
      message: 'D1_ERROR: UNIQUE constraint failed: glossary_abbreviation.abbreviation',
    });
    const { status, body } = await parse(call(list.onRequestPost, { db, events, body: { abbreviation: 'RRM', full_term: 'Racing' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'abbreviation_already_exists');
    assert.deepEqual(events.actions, [], 'a lost race is not an internal error and is not logged as one');
  });

  it('500s on any other D1 throw, logging abbr_create_error and leaking nothing', async () => {
    const events = recordingEvents();
    const real = glossaryDb();
    const db = faultyDb(real, { on: 'INSERT OR IGNORE INTO glossary_abbreviation', message: 'D1_ERROR: disk quota exceeded on shard 4' });
    const { status, body } = await parse(call(list.onRequestPost, { db, events, body: { abbreviation: 'RRM', full_term: 'Boom' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('shard 4'), false);
    assert.deepEqual(events.actions, ['abbr_create_error']);
    assert.equal(countRows(real, 'glossary_abbreviation'), 0);
  });

  it('500s when the thrown error carries no message at all', async () => {
    const events = recordingEvents();
    const { status, body } = await parse(call(list.onRequestPost, { db: messagelessThrowDb(), events, body: { abbreviation: 'RRM', full_term: 'Boom' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.deepEqual(events.actions, ['abbr_create_error']);
  });

  it('echoes the stored row back, including the columns the client never sent', async () => {
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endometriosis' }));
    const { status, body } = await parse(call(list.onRequestPost, {
      db,
      body: { abbreviation: 'ENDO', full_term: 'Endometriosis', term_slug: 'endometriosis', sort_order: 6 },
    }));
    assert.equal(status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.created, true);
    assert.equal(body.data.abbreviation, 'ENDO');
    assert.equal(body.data.full_term, 'Endometriosis');
    assert.equal(body.data.term_slug, 'endometriosis');
    assert.equal(body.data.sort_order, 6);
    assert.ok(body.data.created_at, 'RETURNING * carries the server-defaulted timestamp');
  });
});

// ================================================ GET /abbreviations/:abbr

describe('GET /api/admin/glossary/abbreviations/:abbr', () => {
  let db;
  beforeEach(() => {
    db = glossaryDb((s) => {
      insertAbbr(s, { abbreviation: 'RRM', full_term: 'Restorative Reproductive Medicine', term_slug: 'rrm-overview', sort_order: 2 });
      insertAbbr(s, { abbreviation: 'FABM', full_term: 'Fertility Awareness Based Methods', sort_order: 3 });
    });
  });

  it('401s with no user', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestGet, { db, user: null, params: { abbr: 'RRM' } }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('403s a member', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestGet, { db, user: MEMBER, params: { abbr: 'RRM' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
  });

  it('403s an editor', async () => {
    assert.equal((await parse(call(byAbbr.onRequestGet, { db, user: EDITOR, params: { abbr: 'RRM' } }))).status, 403);
  });

  it('admits role=admin', async () => {
    assert.equal((await parse(call(byAbbr.onRequestGet, { db, user: ADMIN, params: { abbr: 'RRM' } }))).status, 200);
  });

  it('503s with no DB binding', async () => {
    assert.equal((await parse(call(byAbbr.onRequestGet, { db: undefined, params: { abbr: 'RRM' } }))).status, 503);
  });

  it('400s when the route param is absent', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestGet, { db, params: {} }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid abbr');
  });

  it('400s on an empty route param', async () => {
    assert.equal((await parse(call(byAbbr.onRequestGet, { db, params: { abbr: '' } }))).status, 400);
  });

  it('400s when the route param is not a string', async () => {
    assert.equal((await parse(call(byAbbr.onRequestGet, { db, params: { abbr: 42 } }))).status, 400);
  });

  it('400s on a route param over 100 chars', async () => {
    assert.equal((await parse(call(byAbbr.onRequestGet, { db, params: { abbr: 'A'.repeat(101) } }))).status, 400);
  });

  it('404s for an abbreviation that does not exist', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestGet, { db, params: { abbr: 'NOPE' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('returns the full row, including the timestamps the list projection drops', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestGet, { db, params: { abbr: 'RRM' } }));
    assert.equal(status, 200);
    assert.equal(body.data.abbreviation, 'RRM');
    assert.equal(body.data.full_term, 'Restorative Reproductive Medicine');
    assert.equal(body.data.term_slug, 'rrm-overview');
    assert.equal(body.data.sort_order, 2);
    assert.ok(body.data.created_at);
    assert.ok(body.data.updated_at);
  });

  it('matches case-insensitively, returning the row in its stored casing', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestGet, { db, params: { abbr: 'rrm' } }));
    assert.equal(status, 200);
    assert.equal(body.data.abbreviation, 'RRM', 'the stored casing comes back, not the requested casing');
  });

  it('percent-decodes the route param before looking it up', async () => {
    const spaced = glossaryDb((s) => insertAbbr(s, { abbreviation: 'P of P', full_term: 'Peak of Peak' }));
    const { status, body } = await parse(call(byAbbr.onRequestGet, { db: spaced, params: { abbr: 'P%20of%20P' } }));
    assert.equal(status, 200);
    assert.equal(body.data.abbreviation, 'P of P');
  });

  it('does not treat the raw undecoded form as a match', async () => {
    const spaced = glossaryDb((s) => insertAbbr(s, { abbreviation: 'P of P' }));
    assert.equal((await parse(call(byAbbr.onRequestGet, { db: spaced, params: { abbr: 'P+of+P' } }))).status, 404);
  });

  it('500s generically when D1 throws, logging abbr_get_error', async () => {
    const events = recordingEvents();
    const faulty = faultyDb(db, { on: 'SELECT * FROM glossary_abbreviation', message: 'D1_ERROR: token rejected xyz' });
    const { status, body } = await parse(call(byAbbr.onRequestGet, { db: faulty, events, params: { abbr: 'RRM' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('xyz'), false);
    assert.deepEqual(events.actions, ['abbr_get_error']);
  });
});

// ================================================ PUT /abbreviations/:abbr

describe('PUT /api/admin/glossary/abbreviations/:abbr -- authorization and shape', () => {
  let db;
  beforeEach(() => { db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'RRM', full_term: 'Original', sort_order: 1 })); });

  it('401s with no user and does not mutate', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db, user: null, params: { abbr: 'RRM' }, body: { full_term: 'Hacked' } }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
  });

  it('403s a member and does not mutate', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db, user: MEMBER, params: { abbr: 'RRM' }, body: { full_term: 'Hacked' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
  });

  it('403s an editor and does not mutate', async () => {
    assert.equal((await parse(call(byAbbr.onRequestPut, { db, user: EDITOR, params: { abbr: 'RRM' }, body: { full_term: 'Hacked' } }))).status, 403);
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
  });

  it('admits role=admin', async () => {
    assert.equal((await parse(call(byAbbr.onRequestPut, { db, user: ADMIN, params: { abbr: 'RRM' }, body: { full_term: 'By Admin' } }))).status, 200);
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'By Admin');
  });

  it('503s with no DB binding', async () => {
    assert.equal((await parse(call(byAbbr.onRequestPut, { db: undefined, params: { abbr: 'RRM' }, body: { full_term: 'x' } }))).status, 503);
  });

  it('400s on a missing route param', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db, params: {}, body: { full_term: 'x' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid abbr');
  });

  it('400s on a non-string route param', async () => {
    assert.equal((await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 42 }, body: { full_term: 'x' } }))).status, 400);
  });

  it('400s on a route param over 100 chars', async () => {
    assert.equal((await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'A'.repeat(101) }, body: { full_term: 'x' } }))).status, 400);
  });

  it('400s on a body that is not JSON, before any write', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, noBody: true }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
  });

  it('400s unknown_fields, naming every unknown key, and does not mutate', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestPut, {
      db, params: { abbr: 'RRM' },
      body: { full_term: 'New', created_at: '1999-01-01', nonsense: 1 },
    }));
    assert.equal(status, 400);
    assert.equal(body.error, 'unknown_fields');
    assert.deepEqual(body.detail.unknown.sort(), ['created_at', 'nonsense']);
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
  });

  it('refuses to rename the primary key: abbreviation is not an updatable field', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body: { abbreviation: 'RRMX' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'unknown_fields');
    assert.deepEqual(body.detail.unknown, ['abbreviation']);
    assert.equal(readAbbrExact(db, 'RRMX'), null);
    assert.ok(readAbbrExact(db, 'RRM'));
  });

  it('400s no_fields_provided on an empty body', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body: {} }));
    assert.equal(status, 400);
    assert.equal(body.error, 'no_fields_provided');
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
  });
});

describe('PUT /api/admin/glossary/abbreviations/:abbr -- field validation refuses the write', () => {
  const cases = [
    ['full_term empty', { full_term: '' }, 'full_term_required'],
    ['full_term whitespace only', { full_term: '   ' }, 'full_term_required'],
    ['full_term not a string', { full_term: 42 }, 'full_term_required'],
    ['full_term explicitly null', { full_term: null }, 'full_term_required'],
    ['full_term over 500 chars', { full_term: 'f'.repeat(501) }, 'full_term_too_long'],
    ['term_slug over 100 chars', { term_slug: 's'.repeat(101) }, 'term_slug_too_long'],
    ['sort_order sent as a string', { sort_order: '5' }, 'sort_order_invalid'],
    ['sort_order fractional', { sort_order: 5.5 }, 'sort_order_invalid'],
    ['sort_order negative', { sort_order: -1 }, 'sort_order_invalid'],
    ['sort_order over 10000', { sort_order: 10001 }, 'sort_order_invalid'],
    ['sort_order explicitly null', { sort_order: null }, 'sort_order_invalid'],
  ];

  for (const [label, body, error] of cases) {
    it(`rejects ${label} with ${error} and leaves the row alone`, async () => {
      const db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'RRM', full_term: 'Original', term_slug: 'rrm-overview', sort_order: 1 }));
      const { status, body: res } = await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body }));
      assert.equal(status, 400);
      assert.equal(res.error, error);
      const row = readAbbrExact(db, 'RRM');
      assert.equal(row.full_term, 'Original');
      assert.equal(row.term_slug, 'rrm-overview');
      assert.equal(row.sort_order, 1);
    });
  }
});

describe('PUT /api/admin/glossary/abbreviations/:abbr -- update', () => {
  let db;
  beforeEach(() => {
    db = glossaryDb((s) => {
      insertTerm(s, { id: 'term_endo', slug: 'endometriosis', name: 'Endometriosis' });
      insertTerm(s, { id: 'term_pcos', slug: 'pcos', name: 'PCOS' });
      insertAbbr(s, { abbreviation: 'RRM', full_term: 'Original', term_slug: 'endometriosis', sort_order: 1 });
      insertAbbr(s, { abbreviation: 'FABM', full_term: 'Untouched', sort_order: 2 });
    });
  });

  it('updates full_term alone and leaves every other column intact', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body: { full_term: 'Restorative Reproductive Medicine' } }));
    assert.equal(status, 200);
    assert.equal(body.data.full_term, 'Restorative Reproductive Medicine');
    const row = readAbbrExact(db, 'RRM');
    assert.equal(row.full_term, 'Restorative Reproductive Medicine');
    assert.equal(row.term_slug, 'endometriosis', 'term_slug was not in the body, so it is untouched');
    assert.equal(row.sort_order, 1);
  });

  it('updates sort_order alone', async () => {
    await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body: { sort_order: 9 } }));
    assert.equal(readAbbrExact(db, 'RRM').sort_order, 9);
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
  });

  it('updates several fields in one statement', async () => {
    const { status } = await parse(call(byAbbr.onRequestPut, {
      db, params: { abbr: 'RRM' },
      body: { full_term: 'Both Changed', sort_order: 7 },
    }));
    assert.equal(status, 200);
    const row = readAbbrExact(db, 'RRM');
    assert.equal(row.full_term, 'Both Changed');
    assert.equal(row.sort_order, 7);
  });

  it('relinks term_slug to another term, normalizing case and whitespace', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body: { term_slug: '  PCOS  ' } }));
    assert.equal(status, 200);
    assert.equal(body.data.term_slug, 'pcos');
    assert.equal(readAbbrExact(db, 'RRM').term_slug, 'pcos');
  });

  it('unlinks the term when term_slug is explicitly null, skipping the existence check', async () => {
    const events = recordingEvents();
    const faulty = faultyDb(db, { on: 'FROM glossary_term', message: 'D1_ERROR: should never run' });
    const { status } = await parse(call(byAbbr.onRequestPut, { db: faulty, events, params: { abbr: 'RRM' }, body: { term_slug: null } }));
    assert.equal(status, 200, 'no term lookup happens when unlinking');
    assert.equal(readAbbrExact(db, 'RRM').term_slug, null);
  });

  it('unlinks the term when term_slug is an empty string', async () => {
    await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body: { term_slug: '' } }));
    assert.equal(readAbbrExact(db, 'RRM').term_slug, null);
  });

  it('unlinks the term when term_slug is whitespace only', async () => {
    await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body: { term_slug: '   ' } }));
    assert.equal(readAbbrExact(db, 'RRM').term_slug, null);
  });

  it('400s term_slug_not_found for an unknown slug and leaves the existing link in place', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body: { term_slug: 'no-such-term' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'term_slug_not_found');
    assert.equal(readAbbrExact(db, 'RRM').term_slug, 'endometriosis');
  });

  it('500s when the term_slug lookup throws, logging abbr_term_slug_check_error and not mutating', async () => {
    const events = recordingEvents();
    const faulty = faultyDb(db, { on: 'FROM glossary_term', message: 'D1_ERROR: replica lag token abc123' });
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db: faulty, events, params: { abbr: 'RRM' }, body: { term_slug: 'pcos', full_term: 'Should Not Land' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('abc123'), false);
    assert.deepEqual(events.actions, ['abbr_term_slug_check_error']);
    const row = readAbbrExact(db, 'RRM');
    assert.equal(row.full_term, 'Original');
    assert.equal(row.term_slug, 'endometriosis');
  });

  it('addresses the row case-insensitively without creating a second row', async () => {
    const { status } = await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'rRm' }, body: { full_term: 'Reached By Other Casing' } }));
    assert.equal(status, 200);
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Reached By Other Casing');
    assert.equal(readAbbrExact(db, 'rRm'), null);
    assert.equal(countRows(db, 'glossary_abbreviation'), 2);
  });

  it('percent-decodes the route param before matching', async () => {
    const spaced = glossaryDb((s) => insertAbbr(s, { abbreviation: 'P of P', full_term: 'Old' }));
    const { status } = await parse(call(byAbbr.onRequestPut, { db: spaced, params: { abbr: 'P%20of%20P' }, body: { full_term: 'New' } }));
    assert.equal(status, 200);
    assert.equal(readAbbrExact(spaced, 'P of P').full_term, 'New');
  });

  it('touches only the addressed row', async () => {
    await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body: { full_term: 'Changed', sort_order: 40 } }));
    const other = readAbbrExact(db, 'FABM');
    assert.equal(other.full_term, 'Untouched');
    assert.equal(other.sort_order, 2);
  });

  it('404s when no row matches, and creates nothing', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'GHOST' }, body: { full_term: 'New' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(countRows(db, 'glossary_abbreviation'), 2);
  });

  it('500s when the UPDATE throws, logging abbr_update_error and leaking nothing', async () => {
    const events = recordingEvents();
    const faulty = faultyDb(db, { on: 'UPDATE glossary_abbreviation', message: 'D1_ERROR: write quota shard 9' });
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db: faulty, events, params: { abbr: 'RRM' }, body: { full_term: 'Boom' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('shard 9'), false);
    assert.deepEqual(events.actions, ['abbr_update_error']);
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
  });

  it('reports 500 when only the read-back throws, even though the write already landed', async () => {
    // Recorded as the real failure mode: the UPDATE is not inside a transaction
    // with the SELECT that follows it, so a caller who sees this 500 must still
    // treat the change as applied.
    const events = recordingEvents();
    const faulty = faultyDb(db, { on: 'SELECT * FROM glossary_abbreviation', message: 'D1_ERROR: read replica gone' });
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db: faulty, events, params: { abbr: 'RRM' }, body: { full_term: 'Landed Anyway' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.deepEqual(events.actions, ['abbr_update_error']);
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Landed Anyway', 'the write was NOT rolled back');
  });
});

// ============================================= DELETE /abbreviations/:abbr

describe('DELETE /api/admin/glossary/abbreviations/:abbr', () => {
  let db;
  beforeEach(() => {
    db = glossaryDb((s) => {
      insertAbbr(s, { abbreviation: 'RRM', full_term: 'Restorative Reproductive Medicine', sort_order: 1 });
      insertAbbr(s, { abbreviation: 'FABM', full_term: 'Fertility Awareness Based Methods', sort_order: 2 });
    });
  });

  it('401s with no user and deletes nothing', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestDelete, { db, user: null, params: { abbr: 'RRM' } }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
    assert.equal(countRows(db, 'glossary_abbreviation'), 2);
  });

  it('403s a member and deletes nothing', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestDelete, { db, user: MEMBER, params: { abbr: 'RRM' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(countRows(db, 'glossary_abbreviation'), 2);
  });

  it('403s an editor and deletes nothing', async () => {
    assert.equal((await parse(call(byAbbr.onRequestDelete, { db, user: EDITOR, params: { abbr: 'RRM' } }))).status, 403);
    assert.equal(countRows(db, 'glossary_abbreviation'), 2);
  });

  it('admits role=admin', async () => {
    assert.equal((await parse(call(byAbbr.onRequestDelete, { db, user: ADMIN, params: { abbr: 'RRM' } }))).status, 200);
    assert.equal(readAbbrExact(db, 'RRM'), null);
  });

  it('503s with no DB binding', async () => {
    assert.equal((await parse(call(byAbbr.onRequestDelete, { db: undefined, params: { abbr: 'RRM' } }))).status, 503);
  });

  it('400s on a missing route param and deletes nothing', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestDelete, { db, params: {} }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid abbr');
    assert.equal(countRows(db, 'glossary_abbreviation'), 2);
  });

  it('400s on a non-string route param', async () => {
    assert.equal((await parse(call(byAbbr.onRequestDelete, { db, params: { abbr: 42 } }))).status, 400);
    assert.equal(countRows(db, 'glossary_abbreviation'), 2);
  });

  it('400s on a route param over 100 chars', async () => {
    assert.equal((await parse(call(byAbbr.onRequestDelete, { db, params: { abbr: 'A'.repeat(101) } }))).status, 400);
    assert.equal(countRows(db, 'glossary_abbreviation'), 2);
  });

  it('404s for an abbreviation that does not exist, deleting nothing', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestDelete, { db, params: { abbr: 'GHOST' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(countRows(db, 'glossary_abbreviation'), 2);
  });

  it('deletes the addressed row and leaves its sibling alone', async () => {
    const { status, body } = await parse(call(byAbbr.onRequestDelete, { db, params: { abbr: 'RRM' } }));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(readAbbrExact(db, 'RRM'), null);
    assert.ok(readAbbrExact(db, 'FABM'));
    assert.equal(countRows(db, 'glossary_abbreviation'), 1);
  });

  it('matches case-insensitively when deleting', async () => {
    const { status } = await parse(call(byAbbr.onRequestDelete, { db, params: { abbr: 'rrm' } }));
    assert.equal(status, 200);
    assert.equal(readAbbrExact(db, 'RRM'), null);
    assert.equal(countRows(db, 'glossary_abbreviation'), 1);
  });

  it('percent-decodes the route param before deleting', async () => {
    const spaced = glossaryDb((s) => insertAbbr(s, { abbreviation: 'P of P' }));
    const { status } = await parse(call(byAbbr.onRequestDelete, { db: spaced, params: { abbr: 'P%20of%20P' } }));
    assert.equal(status, 200);
    assert.equal(countRows(spaced, 'glossary_abbreviation'), 0);
  });

  it('leaves a linked glossary_term untouched -- the link points the other way', async () => {
    const linked = glossaryDb((s) => {
      insertTerm(s, { id: 'term_endo', slug: 'endometriosis', name: 'Endometriosis' });
      insertAbbr(s, { abbreviation: 'ENDO', term_slug: 'endometriosis' });
    });
    await parse(call(byAbbr.onRequestDelete, { db: linked, params: { abbr: 'ENDO' } }));
    assert.equal(countRows(linked, 'glossary_abbreviation'), 0);
    assert.equal(countRows(linked, 'glossary_term'), 1, 'deleting an abbreviation never cascades into terms');
  });

  it('500s generically when D1 throws, logging abbr_delete_error and leaving the row intact', async () => {
    const events = recordingEvents();
    const faulty = faultyDb(db, { on: 'DELETE FROM glossary_abbreviation', message: 'D1_ERROR: token rejected pqr' });
    const { status, body } = await parse(call(byAbbr.onRequestDelete, { db: faulty, events, params: { abbr: 'RRM' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('pqr'), false);
    assert.deepEqual(events.actions, ['abbr_delete_error']);
    assert.equal(countRows(db, 'glossary_abbreviation'), 2);
  });
});

// ============================================ divergence from the siblings

describe('glossary abbreviations -- divergence from the terms and refs siblings', () => {
  it('POST accepts a non-string term_slug and silently stores NULL instead of rejecting it', async () => {
    // abbreviations/index.js line 69 reads
    //   term_slug !== undefined && term_slug !== null && typeof term_slug === 'string' && length > 100
    // where refs/index.js and terms/index.js both read
    //   x !== undefined && x !== null && (typeof x !== 'string' || length > N)
    // The inverted type test means a non-string never reaches a 400; it falls
    // through to the normalizer, which turns it into NULL. The caller is told
    // 201 Created while the field it sent was dropped.
    const db = glossaryDb((s) => insertTerm(s, { id: 'term_endo', slug: 'endometriosis' }));
    const { status, body } = await parse(call(list.onRequestPost, {
      db,
      body: { abbreviation: 'ENDO', full_term: 'Endometriosis', term_slug: 42 },
    }));
    assert.equal(status, 201, 'ships today as a success, not a 400');
    assert.equal(body.data.term_slug, null, 'the submitted value was silently dropped');
    assert.equal(readAbbrExact(db, 'ENDO').term_slug, null);
  });

  it('PUT accepts a non-string term_slug and silently UNLINKS an existing term', async () => {
    // Same inverted type test at abbreviations/[abbr].js line 88. On update the
    // consequence is destructive rather than merely lossy: a malformed field
    // clears a link that was previously correct, and answers 200.
    const db = glossaryDb((s) => {
      insertTerm(s, { id: 'term_endo', slug: 'endometriosis' });
      insertAbbr(s, { abbreviation: 'ENDO', full_term: 'Endometriosis', term_slug: 'endometriosis' });
    });
    const { status, body } = await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'ENDO' }, body: { term_slug: { slug: 'endometriosis' } } }));
    assert.equal(status, 200, 'ships today as a success, not a 400');
    assert.equal(body.data.term_slug, null);
    assert.equal(readAbbrExact(db, 'ENDO').term_slug, null, 'a correct link was cleared by a malformed field');
  });

  it('GET throws an unhandled URIError on a malformed percent escape, bypassing the 500 envelope', async () => {
    // decodeURIComponent sits OUTSIDE the try in all three handlers of
    // abbreviations/[abbr].js (lines 26, 59, 165). The siblings have no decode
    // step at all: terms/[id].js compares the raw string and refs/[refnum].js
    // parseInts it. A malformed escape therefore rejects the handler promise
    // instead of returning this endpoint's generic 500, and nothing is logged.
    const events = recordingEvents();
    const db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'RRM' }));
    await assert.rejects(
      call(byAbbr.onRequestGet, { db, events, params: { abbr: '%E0%A4%A' } }),
      (err) => err instanceof URIError
    );
    assert.deepEqual(events.actions, [], 'no telemetry is emitted for this failure');
  });

  it('PUT throws an unhandled URIError on a malformed percent escape', async () => {
    const events = recordingEvents();
    const db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'RRM', full_term: 'Original' }));
    await assert.rejects(
      call(byAbbr.onRequestPut, { db, events, params: { abbr: '%zz' }, body: { full_term: 'New' } }),
      (err) => err instanceof URIError
    );
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
    assert.deepEqual(events.actions, []);
  });

  it('DELETE throws an unhandled URIError on a malformed percent escape', async () => {
    const events = recordingEvents();
    const db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'RRM' }));
    await assert.rejects(
      call(byAbbr.onRequestDelete, { db, events, params: { abbr: '%zz' } }),
      (err) => err instanceof URIError
    );
    assert.equal(countRows(db, 'glossary_abbreviation'), 1);
    assert.deepEqual(events.actions, []);
  });

  it('PUT does not stamp updated_at, so the column freezes at creation time', async () => {
    // terms/[id].js line 149 appends "updated_at = datetime('now')" to every
    // UPDATE. Neither abbreviations/[abbr].js nor refs/[refnum].js does, so the
    // schema default is the only value the column ever holds.
    const db = glossaryDb((s) => {
      insertAbbr(s, { abbreviation: 'RRM', full_term: 'Original' });
      s.prepare("UPDATE glossary_abbreviation SET updated_at = '2020-01-01 00:00:00' WHERE abbreviation = 'RRM'").run();
    });
    const { status } = await parse(call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body: { full_term: 'Changed' } }));
    assert.equal(status, 200);
    const row = readAbbrExact(db, 'RRM');
    assert.equal(row.full_term, 'Changed', 'the row really did change');
    assert.equal(row.updated_at, '2020-01-01 00:00:00', 'but updated_at did not move');
  });

  it('PUT crashes on a JSON body of null, a shape all three PUT handlers share', async () => {
    // Object.keys(null) throws, and it sits outside the try that catches the
    // parse failure. Pinned here rather than filed as an abbreviations defect
    // because refs/[refnum].js and terms/[id].js reach the same line the same
    // way; it is a class, not a divergence.
    const db = glossaryDb((s) => insertAbbr(s, { abbreviation: 'RRM', full_term: 'Original' }));
    await assert.rejects(
      call(byAbbr.onRequestPut, { db, params: { abbr: 'RRM' }, body: null }),
      (err) => err instanceof TypeError
    );
    assert.equal(readAbbrExact(db, 'RRM').full_term, 'Original');
  });
});

// ==================================== authorization end to end (middleware)

describe('glossary abbreviations admin -- authorization end to end through admin/_middleware.js', () => {
  const FUTURE = Math.floor(Date.now() / 1000) + 86400;
  let db;

  beforeEach(async () => {
    db = glossaryDb((s) => {
      insertUser(s, { id: 'u_super', email: 'super@example.com', role: 'superadmin' });
      insertUser(s, { id: 'u_member', email: 'member@example.com', role: 'member' });
      insertUser(s, { id: 'u_blocked', email: 'blocked@example.com', role: 'superadmin', blocked: 1 });
      insertAbbr(s, { abbreviation: 'RRM', full_term: 'Restorative Reproductive Medicine' });
    });
    await insertSession(db._sqlite, { rawId: 'sess-super', userId: 'u_super', expiresAt: FUTURE });
    await insertSession(db._sqlite, { rawId: 'sess-member', userId: 'u_member', expiresAt: FUTURE });
    await insertSession(db._sqlite, { rawId: 'sess-blocked', userId: 'u_blocked', expiresAt: FUTURE });
  });

  async function viaMiddleware(cookie, handler = list.onRequestGet, params = {}) {
    const context = {
      request: mockRequest('GET', {
        url: 'https://rrmacademy.org/api/admin/glossary/abbreviations',
        headers: cookie ? { Cookie: `session=${cookie}` } : {},
      }),
      env: mockEnv({ DB: db }),
      params,
      waitUntil: mockWaitUntil(),
    };
    context.next = () => handler(context);
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

  it('an unknown session cookie answers 401', async () => {
    const { status } = await viaMiddleware('sess-forged');
    assert.equal(status, 401);
  });

  it('no cookie at all answers 401', async () => {
    const { status } = await viaMiddleware(null);
    assert.equal(status, 401);
  });

  it('the same gate protects the DELETE handler, and a member deletes nothing', async () => {
    const { status } = await viaMiddleware('sess-member', byAbbr.onRequestDelete, { abbr: 'RRM' });
    assert.equal(status, 403);
    assert.equal(countRows(db, 'glossary_abbreviation'), 1);
  });
});
