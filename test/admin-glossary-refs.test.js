/**
 * functions/api/admin/glossary/refs/index.js     (list + create)
 * functions/api/admin/glossary/refs/[refnum].js  (read + update + delete)
 *
 * The citation store behind the glossary's numbered references. Deleting a
 * reference that a published term still cites would leave a dangling `#ref-N`
 * anchor on a patient-facing page, so the DELETE handler runs a two-stage check:
 * a broad `LIKE '%#ref-N%'` in SQL, then a `\b`-anchored regex in JavaScript to
 * drop the false positives that LIKE cannot exclude (`#ref-50` when deleting
 * ref 5). Only a real engine can execute the SQL half, so these run on
 * test/_d1-sqlite.mjs with the committed rrm-auth schema.
 *
 * Also load-bearing and only decidable by the engine:
 *   - `ref_num INTEGER UNIQUE NOT NULL`, which is what turns a duplicate create
 *     into a 409 via INSERT OR IGNORE returning no row;
 *   - `COALESCE(MAX(ref_num),0)+1` auto-numbering, including its behaviour on an
 *     empty table, which is where an aggregate-over-no-rows either yields 1 or
 *     yields nothing at all.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import {
  SUPERADMIN, ADMIN, MEMBER, EDITOR,
  glossaryDb, insertTerm, insertRef,
  readRef, countRows,
  faultyDb, messagelessThrowDb, nullResultsDb, recordingEvents,
} from './_glossary-fixtures.mjs';

const list = await import('../functions/api/admin/glossary/refs/index.js');
const byNum = await import('../functions/api/admin/glossary/refs/[refnum].js');

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

describe('glossary refs -- CORS preflight', () => {
  it('index answers 204 with the locked-down origin', () => {
    const res = list.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });

  it('[refnum] answers 204 with the locked-down origin', () => {
    const res = byNum.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

// ================================================================= GET /refs

describe('GET /api/admin/glossary/refs -- authorization', () => {
  let db;
  beforeEach(() => { db = glossaryDb((s) => insertRef(s, { ref_num: 1 })); });

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

  it('admits role=admin', async () => {
    assert.equal((await parse(call(list.onRequestGet, { db, user: ADMIN }))).status, 200);
  });

  it('503s when the DB binding is missing', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db: undefined }));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });
});

describe('GET /api/admin/glossary/refs -- listing', () => {
  it('orders by ref_num ascending, not by insertion order', async () => {
    const db = glossaryDb((s) => {
      insertRef(s, { ref_num: 12, anchor_text: 'Twelve' });
      insertRef(s, { ref_num: 3, anchor_text: 'Three' });
      insertRef(s, { ref_num: 7, anchor_text: 'Seven' });
    });
    const { body } = await parse(call(list.onRequestGet, { db }));
    assert.deepEqual(body.results.map((r) => r.ref_num), [3, 7, 12]);
  });

  it('projects the five admin-list columns and omits the surrogate id', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 1, journal: 'J', publisher: 'P' }));
    const { body } = await parse(call(list.onRequestGet, { db }));
    assert.deepEqual(
      Object.keys(body.results[0]).sort(),
      ['anchor_text', 'journal', 'publisher', 'ref_num', 'url']
    );
  });

  it('returns an empty array for an empty table', async () => {
    const { body } = await parse(call(list.onRequestGet, { db: glossaryDb() }));
    assert.deepEqual(body.results, []);
  });

  it('falls back to [] if the driver hands back no results key', async () => {
    const { status, body } = await parse(call(list.onRequestGet, { db: nullResultsDb() }));
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
  });

  it('500s generically when D1 throws, logging refs_list_error', async () => {
    const events = recordingEvents();
    const db = faultyDb(glossaryDb(), { on: 'FROM glossary_reference', message: 'D1_ERROR: shard credential expired' });
    const { status, body } = await parse(call(list.onRequestGet, { db, events }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('credential'), false);
    assert.deepEqual(events.actions, ['refs_list_error']);
  });
});

// ================================================================ POST /refs

describe('POST /api/admin/glossary/refs -- authorization', () => {
  const valid = { anchor_text: 'Smith 2020', url: 'https://example.org/a' };

  it('401s with no user and writes nothing', async () => {
    const db = glossaryDb();
    assert.equal((await parse(call(list.onRequestPost, { db, user: null, body: valid }))).status, 401);
    assert.equal(countRows(db, 'glossary_reference'), 0);
  });

  it('403s a member and writes nothing', async () => {
    const db = glossaryDb();
    const { status, body } = await parse(call(list.onRequestPost, { db, user: MEMBER, body: valid }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(countRows(db, 'glossary_reference'), 0);
  });

  it('403s an editor and writes nothing', async () => {
    const db = glossaryDb();
    assert.equal((await parse(call(list.onRequestPost, { db, user: EDITOR, body: valid }))).status, 403);
    assert.equal(countRows(db, 'glossary_reference'), 0);
  });

  it('503s with no DB binding', async () => {
    assert.equal((await parse(call(list.onRequestPost, { db: undefined, body: valid }))).status, 503);
  });
});

describe('POST /api/admin/glossary/refs -- input validation refuses the write', () => {
  const base = { anchor_text: 'Smith 2020', url: 'https://example.org/a' };
  const cases = [
    ['ref_num sent as a string', { ...base, ref_num: '5' }, 'invalid_ref_num'],
    ['ref_num fractional', { ...base, ref_num: 5.5 }, 'invalid_ref_num'],
    ['ref_num zero', { ...base, ref_num: 0 }, 'invalid_ref_num'],
    ['ref_num negative', { ...base, ref_num: -1 }, 'invalid_ref_num'],
    ['ref_num over 10000', { ...base, ref_num: 10001 }, 'invalid_ref_num'],
    ['ref_num explicitly null', { ...base, ref_num: null }, 'invalid_ref_num'],
    ['anchor_text absent', { ...base, anchor_text: undefined }, 'anchor_text_required'],
    ['anchor_text whitespace only', { ...base, anchor_text: '   ' }, 'anchor_text_required'],
    ['anchor_text not a string', { ...base, anchor_text: 42 }, 'anchor_text_required'],
    ['anchor_text over 1000 chars', { ...base, anchor_text: 'a'.repeat(1001) }, 'anchor_text_too_long'],
    ['url absent', { ...base, url: undefined }, 'url_required'],
    ['url whitespace only', { ...base, url: '   ' }, 'url_required'],
    ['url not a string', { ...base, url: 42 }, 'url_required'],
    ['url over 1000 chars', { ...base, url: 'https://example.org/' + 'a'.repeat(1000) }, 'url_too_long'],
    ['url with a non-web scheme', { ...base, url: 'ftp://example.org/a' }, 'url_invalid_scheme'],
    ['url that is a javascript: payload', { ...base, url: 'javascript:alert(1)' }, 'url_invalid_scheme'],
    ['url that does not parse', { ...base, url: 'not a url at all' }, 'url_malformed'],
    ['journal over 500 chars', { ...base, journal: 'j'.repeat(501) }, 'journal_too_long'],
    ['journal not a string', { ...base, journal: 42 }, 'journal_too_long'],
    ['publisher over 500 chars', { ...base, publisher: 'p'.repeat(501) }, 'publisher_too_long'],
    ['publisher not a string', { ...base, publisher: 42 }, 'publisher_too_long'],
  ];

  for (const [label, body, error] of cases) {
    it(`rejects ${label} with ${error}`, async () => {
      const db = glossaryDb();
      const { status, body: res } = await parse(call(list.onRequestPost, { db, body }));
      assert.equal(status, 400);
      assert.equal(res.error, error);
      assert.equal(countRows(db, 'glossary_reference'), 0);
    });
  }

  it('rejects a body that is not JSON', async () => {
    const db = glossaryDb();
    const { status, body } = await parse(call(list.onRequestPost, { db, noBody: true }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
    assert.equal(countRows(db, 'glossary_reference'), 0);
  });
});

describe('POST /api/admin/glossary/refs -- create', () => {
  it('auto-numbers to 1 on an empty table', async () => {
    const db = glossaryDb();
    const { status, body } = await parse(call(list.onRequestPost, { db, body: { anchor_text: 'First', url: 'https://example.org/1' } }));
    assert.equal(status, 201);
    assert.equal(body.created, true);
    assert.equal(body.data.ref_num, 1);
    assert.equal(readRef(db, 1).anchor_text, 'First');
  });

  it('auto-numbers to MAX+1, skipping past a gap rather than filling it', async () => {
    const db = glossaryDb((s) => {
      insertRef(s, { ref_num: 1 });
      insertRef(s, { ref_num: 58 });
    });
    const { body } = await parse(call(list.onRequestPost, { db, body: { anchor_text: 'Next', url: 'https://example.org/n' } }));
    assert.equal(body.data.ref_num, 59);
    assert.ok(readRef(db, 59));
    assert.equal(readRef(db, 2), null, 'the gap at 2 is left alone');
  });

  it('trims anchor_text and url, and stores absent journal/publisher as NULL', async () => {
    const db = glossaryDb();
    await parse(call(list.onRequestPost, { db, body: { anchor_text: '  Padded Anchor  ', url: '  https://example.org/p  ' } }));
    const row = readRef(db, 1);
    assert.equal(row.anchor_text, 'Padded Anchor');
    assert.equal(row.url, 'https://example.org/p');
    assert.equal(row.journal, null);
    assert.equal(row.publisher, null);
  });

  it('persists journal and publisher when supplied', async () => {
    const db = glossaryDb();
    await parse(call(list.onRequestPost, { db, body: { anchor_text: 'A', url: 'http://example.org/a', journal: 'Fertility and Sterility', publisher: 'Elsevier' } }));
    const row = readRef(db, 1);
    assert.equal(row.journal, 'Fertility and Sterility');
    assert.equal(row.publisher, 'Elsevier');
  });

  it('accepts an explicit ref_num and writes it verbatim', async () => {
    const db = glossaryDb();
    const { status, body } = await parse(call(list.onRequestPost, { db, body: { ref_num: 77, anchor_text: 'Seventy Seven', url: 'https://example.org/77' } }));
    assert.equal(status, 201);
    assert.equal(body.data.ref_num, 77);
    assert.equal(readRef(db, 77).anchor_text, 'Seventy Seven');
  });

  it('409s on a duplicate explicit ref_num and leaves the existing row untouched', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5, anchor_text: 'Original', url: 'https://example.org/orig' }));
    const { status, body } = await parse(call(list.onRequestPost, { db, body: { ref_num: 5, anchor_text: 'Overwrite', url: 'https://example.org/new' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'ref_num_already_exists');
    assert.equal(readRef(db, 5).anchor_text, 'Original');
    assert.equal(countRows(db, 'glossary_reference'), 1);
  });

  it('maps a UNIQUE-constraint throw to 409 rather than a 500', async () => {
    // The auto-numbering INSERT has no OR IGNORE, so a concurrent writer taking
    // MAX+1 first surfaces as a raised UNIQUE constraint instead of a zero-row
    // RETURNING. D1 raises that error; SQLite here will not, so it is injected.
    const events = recordingEvents();
    const db = faultyDb(glossaryDb(), {
      on: 'INSERT INTO glossary_reference',
      message: 'D1_ERROR: UNIQUE constraint failed: glossary_reference.ref_num',
    });
    const { status, body } = await parse(call(list.onRequestPost, { db, events, body: { anchor_text: 'Racing', url: 'https://example.org/r' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'ref_num_already_exists');
    assert.deepEqual(events.actions, [], 'a lost race is not an internal error and is not logged as one');
  });

  it('500s on any other D1 throw, logging ref_create_error and leaking nothing', async () => {
    const events = recordingEvents();
    const real = glossaryDb();
    const db = faultyDb(real, { on: 'INSERT INTO glossary_reference', message: 'D1_ERROR: disk quota exceeded on shard 4' });
    const { status, body } = await parse(call(list.onRequestPost, { db, events, body: { anchor_text: 'Boom', url: 'https://example.org/b' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('shard 4'), false);
    assert.deepEqual(events.actions, ['ref_create_error']);
    assert.equal(countRows(real, 'glossary_reference'), 0);
  });

  it('500s when the thrown error carries no message at all', async () => {
    const events = recordingEvents();
    const { status, body } = await parse(call(list.onRequestPost, { db: messagelessThrowDb(), events, body: { anchor_text: 'Boom', url: 'https://example.org/b' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.deepEqual(events.actions, ['ref_create_error']);
  });
});

// ========================================================= GET /refs/:refnum

describe('GET /api/admin/glossary/refs/:refnum', () => {
  let db;
  beforeEach(() => { db = glossaryDb((s) => insertRef(s, { ref_num: 5, anchor_text: 'Five', url: 'https://example.org/5', journal: 'J' })); });

  it('401s with no user', async () => {
    assert.equal((await parse(call(byNum.onRequestGet, { db, user: null, params: { refnum: '5' } }))).status, 401);
  });

  it('403s a member', async () => {
    assert.equal((await parse(call(byNum.onRequestGet, { db, user: MEMBER, params: { refnum: '5' } }))).status, 403);
  });

  it('503s with no DB binding', async () => {
    assert.equal((await parse(call(byNum.onRequestGet, { db: undefined, params: { refnum: '5' } }))).status, 503);
  });

  it('400s when the route param is absent', async () => {
    const { status, body } = await parse(call(byNum.onRequestGet, { db, params: {} }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid refnum');
  });

  it('400s when the route param is not numeric at all', async () => {
    assert.equal((await parse(call(byNum.onRequestGet, { db, params: { refnum: 'abc' } }))).status, 400);
  });

  it('400s on zero and on a negative refnum', async () => {
    assert.equal((await parse(call(byNum.onRequestGet, { db, params: { refnum: '0' } }))).status, 400);
    assert.equal((await parse(call(byNum.onRequestGet, { db, params: { refnum: '-3' } }))).status, 400);
  });

  it('404s for a refnum that does not exist', async () => {
    const { status, body } = await parse(call(byNum.onRequestGet, { db, params: { refnum: '999' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('returns the full row', async () => {
    const { status, body } = await parse(call(byNum.onRequestGet, { db, params: { refnum: '5' } }));
    assert.equal(status, 200);
    assert.equal(body.data.ref_num, 5);
    assert.equal(body.data.anchor_text, 'Five');
    assert.equal(body.data.journal, 'J');
  });

  it('resolves a refnum with trailing garbage to the leading integer', async () => {
    // parseInt('5abc', 10) === 5, so /refs/5abc addresses reference 5. Recorded
    // as the endpoint's actual contract, not endorsed: the sibling terms/[id].js
    // compares its route param as an exact string and has no such aliasing.
    const { status, body } = await parse(call(byNum.onRequestGet, { db, params: { refnum: '5abc' } }));
    assert.equal(status, 200);
    assert.equal(body.data.ref_num, 5);
  });

  it('500s generically when D1 throws, logging ref_get_error', async () => {
    const events = recordingEvents();
    const faulty = faultyDb(db, { on: 'SELECT * FROM glossary_reference', message: 'D1_ERROR: token rejected xyz' });
    const { status, body } = await parse(call(byNum.onRequestGet, { db: faulty, events, params: { refnum: '5' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('xyz'), false);
    assert.deepEqual(events.actions, ['ref_get_error']);
  });
});

// ========================================================= PUT /refs/:refnum

describe('PUT /api/admin/glossary/refs/:refnum -- authorization and shape', () => {
  let db;
  beforeEach(() => { db = glossaryDb((s) => insertRef(s, { ref_num: 5, anchor_text: 'Original', url: 'https://example.org/5' })); });

  it('401s with no user and does not mutate', async () => {
    assert.equal((await parse(call(byNum.onRequestPut, { db, user: null, params: { refnum: '5' }, body: { anchor_text: 'Hacked' } }))).status, 401);
    assert.equal(readRef(db, 5).anchor_text, 'Original');
  });

  it('403s a member and does not mutate', async () => {
    const { status, body } = await parse(call(byNum.onRequestPut, { db, user: MEMBER, params: { refnum: '5' }, body: { anchor_text: 'Hacked' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(readRef(db, 5).anchor_text, 'Original');
  });

  it('503s with no DB binding', async () => {
    assert.equal((await parse(call(byNum.onRequestPut, { db: undefined, params: { refnum: '5' }, body: { anchor_text: 'x' } }))).status, 503);
  });

  it('400s on a missing route param', async () => {
    assert.equal((await parse(call(byNum.onRequestPut, { db, params: {}, body: { anchor_text: 'x' } }))).status, 400);
  });

  it('400s on a non-numeric route param', async () => {
    assert.equal((await parse(call(byNum.onRequestPut, { db, params: { refnum: 'abc' }, body: { anchor_text: 'x' } }))).status, 400);
  });

  it('400s on a zero route param', async () => {
    assert.equal((await parse(call(byNum.onRequestPut, { db, params: { refnum: '0' }, body: { anchor_text: 'x' } }))).status, 400);
  });

  it('400s on a non-JSON body', async () => {
    const { status, body } = await parse(call(byNum.onRequestPut, { db, params: { refnum: '5' }, noBody: true }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('names the unknown fields it rejected, including an attempt to renumber', async () => {
    const { status, body } = await parse(call(byNum.onRequestPut, { db, params: { refnum: '5' }, body: { ref_num: 9, id: 3 } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'unknown_fields');
    assert.deepEqual(body.detail.unknown.sort(), ['id', 'ref_num']);
    assert.equal(readRef(db, 5).ref_num, 5);
  });

  it('400s when the body carries no updatable field at all', async () => {
    const { status, body } = await parse(call(byNum.onRequestPut, { db, params: { refnum: '5' }, body: {} }));
    assert.equal(status, 400);
    assert.equal(body.error, 'no_fields_provided');
  });
});

describe('PUT /api/admin/glossary/refs/:refnum -- input validation refuses the write', () => {
  const cases = [
    ['anchor_text empty', { anchor_text: '' }, 'anchor_text_required'],
    ['anchor_text not a string', { anchor_text: 42 }, 'anchor_text_required'],
    ['anchor_text over 1000 chars', { anchor_text: 'a'.repeat(1001) }, 'anchor_text_too_long'],
    ['url not a string', { url: 42 }, 'url_invalid_type'],
    ['url over 1000 chars', { url: 'https://example.org/' + 'a'.repeat(1000) }, 'url_too_long'],
    ['url with a non-web scheme', { url: 'ftp://example.org/a' }, 'url_invalid_scheme'],
    ['url that does not parse', { url: 'not a url at all' }, 'url_malformed'],
    ['url empty string', { url: '' }, 'url_required'],
    ['url explicitly null', { url: null }, 'url_required'],
    ['journal over 500 chars', { journal: 'j'.repeat(501) }, 'journal_too_long'],
    ['journal not a string', { journal: 42 }, 'journal_too_long'],
    ['publisher over 500 chars', { publisher: 'p'.repeat(501) }, 'publisher_too_long'],
    ['publisher not a string', { publisher: 42 }, 'publisher_too_long'],
  ];

  for (const [label, body, error] of cases) {
    it(`rejects ${label} with ${error}`, async () => {
      const db = glossaryDb((s) => insertRef(s, { ref_num: 5, anchor_text: 'Original', url: 'https://example.org/5' }));
      const { status, body: res } = await parse(call(byNum.onRequestPut, { db, params: { refnum: '5' }, body }));
      assert.equal(status, 400);
      assert.equal(res.error, error);
      const row = readRef(db, 5);
      assert.equal(row.anchor_text, 'Original');
      assert.equal(row.url, 'https://example.org/5');
    });
  }

  it('rejects a whitespace-only url as malformed rather than required', async () => {
    // Divergence from the create path worth stating out loud: POST checks
    // `!url.trim()` and answers url_required, PUT only special-cases the empty
    // string, so '   ' reaches new URL() and comes back url_malformed.
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5 }));
    const { status, body } = await parse(call(byNum.onRequestPut, { db, params: { refnum: '5' }, body: { url: '   ' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'url_malformed');
  });
});

describe('PUT /api/admin/glossary/refs/:refnum -- successful updates', () => {
  it('writes only the supplied fields and leaves the rest alone', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5, anchor_text: 'Original', url: 'https://example.org/5', journal: 'Old Journal', publisher: 'Old Publisher' }));
    const { status, body } = await parse(call(byNum.onRequestPut, { db, params: { refnum: '5' }, body: { anchor_text: 'Smith 2024', journal: 'Human Reproduction' } }));

    assert.equal(status, 200);
    const row = readRef(db, 5);
    assert.equal(row.anchor_text, 'Smith 2024');
    assert.equal(row.journal, 'Human Reproduction');
    assert.equal(row.url, 'https://example.org/5', 'untouched');
    assert.equal(row.publisher, 'Old Publisher', 'untouched');
    assert.equal(body.data.anchor_text, 'Smith 2024');
  });

  it('accepts a valid replacement url over http as well as https', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5, url: 'https://example.org/5' }));
    await parse(call(byNum.onRequestPut, { db, params: { refnum: '5' }, body: { url: 'http://example.org/moved' } }));
    assert.equal(readRef(db, 5).url, 'http://example.org/moved');
  });

  it('accepts an explicit null journal and publisher as clears', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5, journal: 'J', publisher: 'P' }));
    await parse(call(byNum.onRequestPut, { db, params: { refnum: '5' }, body: { journal: null, publisher: null } }));
    const row = readRef(db, 5);
    assert.equal(row.journal, null);
    assert.equal(row.publisher, null);
  });

  it('404s for a refnum that does not exist', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5 }));
    const { status, body } = await parse(call(byNum.onRequestPut, { db, params: { refnum: '999' }, body: { anchor_text: 'Ghost' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(countRows(db, 'glossary_reference'), 1);
  });

  it('500s when D1 throws, logging ref_update_error and leaving the row untouched', async () => {
    const events = recordingEvents();
    const real = glossaryDb((s) => insertRef(s, { ref_num: 5, anchor_text: 'Original' }));
    const db = faultyDb(real, { on: 'UPDATE glossary_reference SET', message: 'D1_ERROR: replica lag detail' });
    const { status, body } = await parse(call(byNum.onRequestPut, { db, events, params: { refnum: '5' }, body: { anchor_text: 'New' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('replica lag'), false);
    assert.deepEqual(events.actions, ['ref_update_error']);
    assert.equal(readRef(real, 5).anchor_text, 'Original');
  });
});

// ====================================================== DELETE /refs/:refnum

describe('DELETE /api/admin/glossary/refs/:refnum', () => {
  it('401s with no user and deletes nothing', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5 }));
    assert.equal((await parse(call(byNum.onRequestDelete, { db, user: null, params: { refnum: '5' } }))).status, 401);
    assert.ok(readRef(db, 5));
  });

  it('403s a member and deletes nothing -- the line an attacker cares about', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5 }));
    const { status, body } = await parse(call(byNum.onRequestDelete, { db, user: MEMBER, params: { refnum: '5' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.ok(readRef(db, 5));
  });

  it('403s an editor and deletes nothing', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5 }));
    assert.equal((await parse(call(byNum.onRequestDelete, { db, user: EDITOR, params: { refnum: '5' } }))).status, 403);
    assert.ok(readRef(db, 5));
  });

  it('503s with no DB binding', async () => {
    assert.equal((await parse(call(byNum.onRequestDelete, { db: undefined, params: { refnum: '5' } }))).status, 503);
  });

  it('400s on a missing route param', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5 }));
    assert.equal((await parse(call(byNum.onRequestDelete, { db, params: {} }))).status, 400);
    assert.ok(readRef(db, 5));
  });

  it('400s on a non-numeric route param', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5 }));
    assert.equal((await parse(call(byNum.onRequestDelete, { db, params: { refnum: 'abc' } }))).status, 400);
  });

  it('400s on a zero route param', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5 }));
    assert.equal((await parse(call(byNum.onRequestDelete, { db, params: { refnum: '0' } }))).status, 400);
  });

  it('404s for a refnum that does not exist', async () => {
    const db = glossaryDb((s) => insertRef(s, { ref_num: 5 }));
    const { status, body } = await parse(call(byNum.onRequestDelete, { db, params: { refnum: '999' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('deletes an uncited reference and leaves its neighbours alone', async () => {
    const db = glossaryDb((s) => {
      insertRef(s, { ref_num: 5 });
      insertRef(s, { ref_num: 6 });
    });
    const { status, body } = await parse(call(byNum.onRequestDelete, { db, params: { refnum: '5' } }));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(readRef(db, 5), null);
    assert.ok(readRef(db, 6));
  });

  it('refuses to delete a reference a term still cites, naming the citing terms', async () => {
    const db = glossaryDb((s) => {
      insertRef(s, { ref_num: 5 });
      insertTerm(s, { id: 'term_endo', slug: 'endo', body_html: '<p>Evidence<a href="#ref-5">5</a>.</p>' });
      insertTerm(s, { id: 'term_pcos', slug: 'pcos', body_html: '<p>Also<a href="#ref-5">5</a>.</p>' });
    });
    const { status, body } = await parse(call(byNum.onRequestDelete, { db, params: { refnum: '5' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'ref_in_use');
    assert.deepEqual(body.detail.citing_slugs.sort(), ['endo', 'pcos']);
    assert.ok(readRef(db, 5), 'the cited reference survives');
  });

  it('is not fooled by #ref-50 when deleting ref 5 -- the LIKE matches, the word boundary does not', async () => {
    const db = glossaryDb((s) => {
      insertRef(s, { ref_num: 5 });
      insertRef(s, { ref_num: 50 });
      insertTerm(s, { id: 'term_endo', slug: 'endo', body_html: '<p>Evidence<a href="#ref-50">50</a>.</p>' });
    });
    const { status } = await parse(call(byNum.onRequestDelete, { db, params: { refnum: '5' } }));
    assert.equal(status, 200);
    assert.equal(readRef(db, 5), null, 'ref 5 is not held hostage by a citation of ref 50');
    assert.ok(readRef(db, 50));
  });

  it('still refuses ref 50 itself, so the boundary check has not simply disabled the guard', async () => {
    const db = glossaryDb((s) => {
      insertRef(s, { ref_num: 50 });
      insertTerm(s, { id: 'term_endo', slug: 'endo', body_html: '<p>Evidence<a href="#ref-50">50</a>.</p>' });
    });
    const { status, body } = await parse(call(byNum.onRequestDelete, { db, params: { refnum: '50' } }));
    assert.equal(status, 409);
    assert.deepEqual(body.detail.citing_slugs, ['endo']);
    assert.ok(readRef(db, 50));
  });

  it('500s when the citation lookup throws, before anything is deleted', async () => {
    const events = recordingEvents();
    const real = glossaryDb((s) => insertRef(s, { ref_num: 5 }));
    const db = faultyDb(real, { on: 'SELECT slug, body_html FROM glossary_term', message: 'D1_ERROR: index corrupt detail' });
    const { status, body } = await parse(call(byNum.onRequestDelete, { db, events, params: { refnum: '5' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.equal(JSON.stringify(body).includes('index corrupt'), false);
    assert.deepEqual(events.actions, ['ref_delete_error']);
    assert.ok(readRef(real, 5), 'nothing is deleted when the guard could not run');
  });

  it('500s when the DELETE itself throws', async () => {
    const events = recordingEvents();
    const real = glossaryDb((s) => insertRef(s, { ref_num: 5 }));
    const db = faultyDb(real, { on: 'DELETE FROM glossary_reference' });
    const { status } = await parse(call(byNum.onRequestDelete, { db, events, params: { refnum: '5' } }));
    assert.equal(status, 500);
    assert.deepEqual(events.actions, ['ref_delete_error']);
    assert.ok(readRef(real, 5));
  });
});
