/**
 * functions/api/glossary/terms.js -- the read surface behind rrmacademy.org/glossary/.
 *
 * Every answer this endpoint gives is decided by SQL, not by JavaScript:
 *   - `WHERE status = 'published'` is the only thing keeping a draft term off
 *     the public page in the list and part views, while the ?id= view
 *     deliberately has NO status filter (preview/rebuild reads drafts);
 *   - `ORDER BY part ASC, sort_order ASC, slug ASC` is what makes the rendered
 *     glossary come out in reading order rather than insertion order;
 *   - the definition-source filter is a four-way AND
 *     (`status='published' AND visibility='public' AND source_key != 'boyle_archive'`)
 *     that keeps the private IIRRM/Boyle corpus out of the public DOM.
 * A substring-matching mock returns whatever the test declared for each of
 * those, so an assertion about ordering or about the Boyle filter would just be
 * restating its own fixture. These run against node:sqlite loaded with the
 * committed rrm-auth schema, so the row a test writes is the row the query has
 * to find, and deleting the filter from the endpoint makes the test go red.
 *
 * WHAT IS STILL FAKED
 *  - "D1 threw" is a throwing stub layered over the real database (failingOn
 *    below). node:sqlite cannot be made to fail on a well-formed SELECT, and
 *    the harness header is explicit that engine-level failure still needs a
 *    stub. What the stub proves is the handler's reaction, not D1's failure mode.
 *  - Analytics Engine is a recorder; nothing is shipped anywhere.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1 } from './_d1-sqlite.mjs';
import { onRequestGet, onRequestOptions } from '../functions/api/glossary/terms.js';

const TOKEN = 'test-library-build-token';
const BASE = 'https://rrmacademy.org/api/glossary/terms';

/** Analytics Engine recorder so a swallowed-error path can be asserted by name. */
function recorder() {
  const points = [];
  return { points, writeDataPoint(p) { points.push(p); } };
}

function insertTerm(sqlite, row) {
  const full = {
    id: row.id,
    slug: row.slug,
    name: row.name ?? row.slug,
    part: row.part ?? 'I',
    sort_order: row.sort_order ?? 0,
    body_html: row.body_html ?? '<p>body</p>',
    abbreviation: row.abbreviation ?? null,
    pillar_link: row.pillar_link ?? null,
    status: row.status ?? 'published',
    created_at: 'created_at' in row ? row.created_at : '2026-01-01 00:00:00',
    updated_at: 'updated_at' in row ? row.updated_at : '2026-02-02 03:04:05',
  };
  const cols = Object.keys(full);
  sqlite.prepare(
    `INSERT INTO glossary_term (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...cols.map((c) => full[c]));
}

function insertSource(sqlite, row) {
  const full = {
    term_id: row.term_id,
    source_key: row.source_key,
    source_label: row.source_label ?? 'Label',
    source_url: row.source_url ?? null,
    code: row.code ?? null,
    definition_text: row.definition_text ?? 'text',
    is_verbatim: row.is_verbatim ?? 1,
    attribution: row.attribution ?? null,
    sort_order: row.sort_order ?? 999,
    status: row.status ?? 'published',
    visibility: row.visibility ?? 'public',
  };
  const cols = Object.keys(full);
  sqlite.prepare(
    `INSERT INTO glossary_definition_source (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...cols.map((c) => full[c]));
}

function insertReference(sqlite, row) {
  sqlite.prepare(
    'INSERT INTO glossary_reference (ref_num, anchor_text, url, publisher, journal) VALUES (?, ?, ?, ?, ?)'
  ).run(row.ref_num, row.anchor_text, row.url, row.publisher ?? null, row.journal ?? null);
}

function insertAbbreviation(sqlite, row) {
  sqlite.prepare(
    'INSERT INTO glossary_abbreviation (abbreviation, full_term, term_slug, sort_order) VALUES (?, ?, ?, ?)'
  ).run(row.abbreviation, row.full_term, row.term_slug ?? null, row.sort_order ?? 0);
}

function db(seed) {
  return sqliteD1({ seed });
}

/**
 * Wraps a real database so ONE statement shape throws. Used for the two
 * distinct D1-failure reactions this endpoint has: the outer catch that turns
 * into a 500, and the inner catch around definition sources that logs and
 * degrades to an empty sources array while still returning 200.
 */
function failingOn(real, needle, message = 'D1_DOWN') {
  return {
    ...real,
    prepare(sql) {
      if (sql.includes(needle)) {
        return {
          bind() { return this; },
          async first() { throw new Error(message); },
          async all() { throw new Error(message); },
          async run() { throw new Error(message); },
        };
      }
      return real.prepare(sql);
    },
  };
}

/**
 * Wraps a real database so every `.all()` answers `{ results: undefined }`.
 *
 * D1 does not always populate `results` -- a statement it decides selected no
 * rows can come back with the key absent -- which is why every read in this
 * endpoint is written `(rows || []).map(...)`. node:sqlite always returns an
 * array, so without this stub that `|| []` is dead code in the test run and a
 * refactor that dropped it would ship a TypeError to the build fetcher.
 */
function undefinedResults(real) {
  return {
    ...real,
    prepare(sql) {
      const stmt = real.prepare(sql);
      return {
        bind(...args) { stmt.bind(...args); return this; },
        first: () => stmt.first(),
        run: () => stmt.run(),
        async all() { return { success: true }; },
      };
    },
  };
}

function get({ url = BASE, token = TOKEN, auth = `Bearer ${TOKEN}`, DB, events } = {}) {
  const env = mockEnv({ LIBRARY_BUILD_TOKEN: token, DB, EVENTS: events ?? recorder() });
  return onRequestGet({
    request: mockRequest('GET', { url, headers: auth === null ? {} : { Authorization: auth } }),
    env,
    waitUntil: mockWaitUntil(),
  });
}

// --------------------------------------------------------------------- auth --

describe('GET /api/glossary/terms -- gate', () => {
  it('OPTIONS preflight is 204 with no body', async () => {
    const res = onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
  });

  it('503s when LIBRARY_BUILD_TOKEN is unset, before touching the database', async () => {
    const d = db();
    const { status, body } = await parseResponse(await get({ token: null, DB: d }));
    assert.equal(status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'Server misconfigured');
    assert.equal(d._calls.length, 0, 'must not query D1 before the config check');
  });

  it('401s on a wrong Bearer token', async () => {
    const d = db((s) => insertTerm(s, { id: 't1', slug: 'ovulation' }));
    const { status, body } = await parseResponse(await get({ auth: 'Bearer nope-nope-nope', DB: d }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
    assert.equal(d._calls.length, 0);
  });

  it('401s when the Authorization header is absent entirely', async () => {
    const d = db();
    const { status, body } = await parseResponse(await get({ auth: null, DB: d }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('401s on a token that is a prefix of the real one (length-checked compare)', async () => {
    const d = db();
    const { status } = await parseResponse(await get({ auth: `Bearer ${TOKEN.slice(0, -1)}`, DB: d }));
    assert.equal(status, 401);
  });

  it('accepts the correct Bearer token', async () => {
    const d = db((s) => insertTerm(s, { id: 't1', slug: 'ovulation' }));
    assert.equal((await parseResponse(await get({ DB: d }))).status, 200);
  });

  it('503s when the DB binding is missing (auth already passed)', async () => {
    const { status, body } = await parseResponse(await get({ DB: undefined }));
    assert.equal(status, 503);
    assert.equal(body.error, 'Server misconfigured');
  });
});

// ---------------------------------------------------------------- ?id= view --

describe('GET /api/glossary/terms?id= -- single term', () => {
  it('maps every column of the stored row onto its API name', async () => {
    const d = db((s) => insertTerm(s, {
      id: 'term_lpd',
      slug: 'luteal-phase-deficiency',
      name: 'Luteal Phase Deficiency',
      part: 'III',
      sort_order: 42,
      body_html: '<p>A short luteal phase.</p>',
      abbreviation: 'LPD',
      pillar_link: '/luteal-phase/',
      status: 'published',
      created_at: '2026-01-05 06:07:08',
      updated_at: '2026-03-04 05:06:07',
    }));
    const { status, body } = await parseResponse(await get({ url: `${BASE}?id=term_lpd`, DB: d }));

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, {
      id: 'term_lpd',
      slug: 'luteal-phase-deficiency',
      name: 'Luteal Phase Deficiency',
      part: 'III',
      sortOrder: 42,
      bodyHtml: '<p>A short luteal phase.</p>',
      abbreviation: 'LPD',
      pillarLink: '/luteal-phase/',
      status: 'published',
      updatedAt: '2026-03-04T05:06:07Z',
      createdAt: '2026-01-05T06:07:08Z',
      definitionSources: [],
    });
  });

  it('serves a DRAFT term by id -- the ?id= view is the preview/rebuild read and has no status filter', async () => {
    const d = db((s) => insertTerm(s, { id: 'term_draft', slug: 'unreleased', status: 'draft' }));
    const { status, body } = await parseResponse(await get({ url: `${BASE}?id=term_draft`, DB: d }));
    assert.equal(status, 200);
    assert.equal(body.data.status, 'draft');
  });

  it('404s for an id that is not in the table', async () => {
    const d = db((s) => insertTerm(s, { id: 'term_real', slug: 'real' }));
    const { status, body } = await parseResponse(await get({ url: `${BASE}?id=term_ghost`, DB: d }));
    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'not_found');
  });

  it('id lookup is case-SENSITIVE (glossary_term.id is a plain TEXT primary key, not NOCASE)', async () => {
    const d = db((s) => insertTerm(s, { id: 'term_lpd', slug: 'lpd' }));
    assert.equal((await parseResponse(await get({ url: `${BASE}?id=TERM_LPD`, DB: d }))).status, 404);
  });

  it('400s on an id longer than the 100-char cap, without querying D1', async () => {
    const d = db();
    const { status, body } = await parseResponse(await get({ url: `${BASE}?id=${'x'.repeat(101)}`, DB: d }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid id');
    assert.equal(d._calls.length, 0);
  });

  it('accepts an id of exactly 100 chars (the cap is > not >=)', async () => {
    const id = 'y'.repeat(100);
    const d = db((s) => insertTerm(s, { id, slug: 'boundary' }));
    const { status, body } = await parseResponse(await get({ url: `${BASE}?id=${id}`, DB: d }));
    assert.equal(status, 200);
    assert.equal(body.data.id, id);
  });

  it('treats an empty ?id= as a request for the empty id, not as the full-list view', async () => {
    const d = db((s) => insertTerm(s, { id: 'term_a', slug: 'a' }));
    const { status, body } = await parseResponse(await get({ url: `${BASE}?id=`, DB: d }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('returns only published + public + non-Boyle sources, in sort_order', async () => {
    const d = db((s) => {
      insertTerm(s, { id: 'term_endo', slug: 'endometriosis' });
      insertSource(s, { term_id: 'term_endo', source_key: 'mesh', source_label: 'PubMed MeSH', source_url: 'https://mesh', code: 'D004715', definition_text: 'MeSH text', is_verbatim: 1, attribution: 'NLM. Public domain.', sort_order: 20 });
      insertSource(s, { term_id: 'term_endo', source_key: 'rrm_library', source_label: 'RRM Academy', definition_text: 'Paraphrase', is_verbatim: 0, sort_order: 10 });
      insertSource(s, { term_id: 'term_endo', source_key: 'boyle_archive', source_label: 'Boyle archive', definition_text: 'PRIVATE', sort_order: 5 });
      insertSource(s, { term_id: 'term_endo', source_key: 'wikipedia', source_label: 'Wikipedia', definition_text: 'DRAFT', status: 'draft', sort_order: 6 });
      insertSource(s, { term_id: 'term_endo', source_key: 'nci', source_label: 'NCI', definition_text: 'INTERNAL', visibility: 'internal_only', sort_order: 7 });
    });
    const { status, body } = await parseResponse(await get({ url: `${BASE}?id=term_endo`, DB: d }));

    assert.equal(status, 200);
    assert.deepEqual(body.data.definitionSources.map((s) => s.sourceKey), ['rrm_library', 'mesh']);
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes('PRIVATE'), 'boyle_archive text must never reach the response');
    assert.ok(!raw.includes('DRAFT'), 'a draft source must never reach the response');
    assert.ok(!raw.includes('INTERNAL'), 'an internal_only source must never reach the response');

    assert.deepEqual(body.data.definitionSources[1], {
      sourceKey: 'mesh',
      sourceLabel: 'PubMed MeSH',
      sourceUrl: 'https://mesh',
      code: 'D004715',
      definitionText: 'MeSH text',
      isVerbatim: true,
      attribution: 'NLM. Public domain.',
    });
    assert.equal(body.data.definitionSources[0].isVerbatim, false, 'is_verbatim=0 must map to false, not to a truthy 0');
  });

  it('scopes sources to the requested term', async () => {
    const d = db((s) => {
      insertTerm(s, { id: 'term_a', slug: 'a' });
      insertTerm(s, { id: 'term_b', slug: 'b' });
      insertSource(s, { term_id: 'term_a', source_key: 'mesh', definition_text: 'A-text' });
      insertSource(s, { term_id: 'term_b', source_key: 'mesh', definition_text: 'B-text' });
    });
    const { body } = await parseResponse(await get({ url: `${BASE}?id=term_a`, DB: d }));
    assert.deepEqual(body.data.definitionSources.map((s) => s.definitionText), ['A-text']);
  });

  it('degrades to an empty sources array (still 200) when the sources query throws, and logs it', async () => {
    const events = recorder();
    const real = db((s) => insertTerm(s, { id: 'term_a', slug: 'a' }));
    const d = failingOn(real, 'glossary_definition_source');
    const { status, body } = await parseResponse(await get({ url: `${BASE}?id=term_a`, DB: d, events }));

    assert.equal(status, 200, 'a sources outage must not take down the term read');
    assert.deepEqual(body.data.definitionSources, []);
    const logged = events.points.find((p) => p.blobs[2] === 'sources_error');
    assert.ok(logged, 'the swallowed sources error must still be logged');
    assert.equal(logged.blobs[1], 'glossary');
    assert.equal(logged.blobs[3], 'error');
  });

  it('500s when the term query itself throws, and does not leak the D1 message', async () => {
    const events = recorder();
    const d = failingOn(db(), 'FROM glossary_term WHERE id', 'sqlite disk image is malformed');
    const { status, body } = await parseResponse(await get({ url: `${BASE}?id=term_a`, DB: d, events }));

    assert.equal(status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'Internal error');
    assert.ok(!JSON.stringify(body).includes('malformed'), 'the D1 message must not reach the client');
    assert.ok(events.points.some((p) => p.blobs[2] === 'get_error'));
  });
});

// -------------------------------------------------------------- ?part= view --

describe('GET /api/glossary/terms?part= -- one part', () => {
  const seedParts = (s) => {
    insertTerm(s, { id: 't_i_1', slug: 'alpha', part: 'I', sort_order: 1 });
    insertTerm(s, { id: 't_ii_zulu', slug: 'zulu', part: 'II', sort_order: 5 });
    insertTerm(s, { id: 't_ii_bravo', slug: 'bravo', part: 'II', sort_order: 5 });
    insertTerm(s, { id: 't_ii_first', slug: 'yankee', part: 'II', sort_order: 1 });
    insertTerm(s, { id: 't_ii_draft', slug: 'hidden', part: 'II', sort_order: 0, status: 'draft' });
    insertTerm(s, { id: 't_ii_arch', slug: 'gone', part: 'II', sort_order: 0, status: 'archived' });
  };

  it('returns only published terms of that part, ordered by sort_order then slug', async () => {
    const d = db(seedParts);
    const { status, body } = await parseResponse(await get({ url: `${BASE}?part=II`, DB: d }));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.results.map((t) => t.slug), ['yankee', 'bravo', 'zulu']);
  });

  it('excludes draft and archived terms from the part view', async () => {
    const d = db(seedParts);
    const { body } = await parseResponse(await get({ url: `${BASE}?part=II`, DB: d }));
    const slugs = body.results.map((t) => t.slug);
    assert.ok(!slugs.includes('hidden'));
    assert.ok(!slugs.includes('gone'));
  });

  it('returns an empty array for a valid part with no published terms', async () => {
    const d = db(seedParts);
    const { status, body } = await parseResponse(await get({ url: `${BASE}?part=VIII`, DB: d }));
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
  });

  it('accepts every part in the schema CHECK constraint', async () => {
    const parts = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
    const d = db((s) => parts.forEach((p, i) => insertTerm(s, { id: `t_${p}`, slug: `s-${p}`, part: p, sort_order: i })));
    for (const p of parts) {
      const { status, body } = await parseResponse(await get({ url: `${BASE}?part=${p}`, DB: d }));
      assert.equal(status, 200, `part ${p} must be accepted`);
      assert.deepEqual(body.results.map((t) => t.slug), [`s-${p}`]);
    }
  });

  it('400s on a part outside the allowlist, without querying D1', async () => {
    const d = db();
    const { status, body } = await parseResponse(await get({ url: `${BASE}?part=IX`, DB: d }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid part');
    assert.equal(d._calls.length, 0);
  });

  it('400s on a lowercase part -- the allowlist is exact-match', async () => {
    assert.equal((await parseResponse(await get({ url: `${BASE}?part=ii`, DB: db() }))).status, 400);
  });

  it('400s on an empty ?part= rather than falling through to the full list', async () => {
    const d = db((s) => insertTerm(s, { id: 't1', slug: 'a' }));
    const { status, body } = await parseResponse(await get({ url: `${BASE}?part=`, DB: d }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid part');
  });

  it('400s on a SQL-injection-shaped part', async () => {
    const d = db((s) => insertTerm(s, { id: 't1', slug: 'a' }));
    const { status } = await parseResponse(await get({ url: `${BASE}?part=${encodeURIComponent("I' OR '1'='1")}`, DB: d }));
    assert.equal(status, 400);
  });

  it('?id= wins over ?part= when both are present', async () => {
    const d = db((s) => {
      insertTerm(s, { id: 'term_x', slug: 'x', part: 'I' });
      insertTerm(s, { id: 'term_y', slug: 'y', part: 'II' });
    });
    const { body } = await parseResponse(await get({ url: `${BASE}?id=term_x&part=II`, DB: d }));
    assert.equal(body.data.id, 'term_x');
    assert.equal(body.results, undefined);
  });

  it('500s when the part query throws', async () => {
    const events = recorder();
    const d = failingOn(db(), "part = ?");
    const { status, body } = await parseResponse(await get({ url: `${BASE}?part=I`, DB: d, events }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(events.points.some((p) => p.blobs[2] === 'part_error'));
  });
});

// ----------------------------------------------------------- full-list view --

describe('GET /api/glossary/terms -- full build payload', () => {
  const seedFull = (s) => {
    insertTerm(s, { id: 't_iii', slug: 'gamma', part: 'III', sort_order: 1 });
    insertTerm(s, { id: 't_i_b', slug: 'beta', part: 'I', sort_order: 2 });
    insertTerm(s, { id: 't_i_a2', slug: 'alpha2', part: 'I', sort_order: 1 });
    insertTerm(s, { id: 't_i_a1', slug: 'alpha1', part: 'I', sort_order: 1 });
    insertTerm(s, { id: 't_draft', slug: 'draft-term', part: 'I', sort_order: 0, status: 'draft' });

    insertReference(s, { ref_num: 7, anchor_text: 'Seven', url: 'https://seven', publisher: 'Pub7', journal: 'J7' });
    insertReference(s, { ref_num: 2, anchor_text: 'Two', url: 'https://two' });

    insertAbbreviation(s, { abbreviation: 'PCOS', full_term: 'Polycystic Ovary Syndrome', term_slug: 'pcos', sort_order: 9 });
    insertAbbreviation(s, { abbreviation: 'FABM', full_term: 'Fertility Awareness-Based Methods', sort_order: 1 });

    insertSource(s, { term_id: 't_i_a1', source_key: 'mesh', definition_text: 'a1-mesh', sort_order: 20 });
    insertSource(s, { term_id: 't_i_a1', source_key: 'nci', definition_text: 'a1-nci', sort_order: 50 });
    insertSource(s, { term_id: 't_iii', source_key: 'mesh', definition_text: 'gamma-mesh', sort_order: 20 });
    insertSource(s, { term_id: 't_iii', source_key: 'boyle_archive', definition_text: 'PRIVATE-GAMMA', sort_order: 95 });
    // visibility='internal_only' is a SECOND, independent privacy filter from the
    // boyle_archive source_key one above. The full-build query carries both; a
    // fixture with only a boyle_archive row cannot tell them apart, so dropping
    // `AND visibility = 'public'` would leak silently.
    insertSource(s, { term_id: 't_i_a1', source_key: 'wikipedia', definition_text: 'INTERNAL-A1', visibility: 'internal_only', sort_order: 99 });
    insertSource(s, { term_id: 't_i_a1', source_key: 'medlineplus', definition_text: 'DRAFT-A1', status: 'draft', sort_order: 60 });
  };

  it('orders terms by part, then sort_order, then slug -- and drops unpublished ones', async () => {
    const d = db(seedFull);
    const { status, body } = await parseResponse(await get({ DB: d }));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.results.terms.map((t) => t.slug), ['alpha1', 'alpha2', 'beta', 'gamma']);
  });

  it('attaches each term its OWN sources, and no others (grouping is by term_id)', async () => {
    const d = db(seedFull);
    const { body } = await parseResponse(await get({ DB: d }));
    const byslug = Object.fromEntries(body.results.terms.map((t) => [t.slug, t]));

    assert.deepEqual(byslug.alpha1.definitionSources.map((s) => s.definitionText), ['a1-mesh', 'a1-nci']);
    assert.deepEqual(byslug.gamma.definitionSources.map((s) => s.definitionText), ['gamma-mesh']);
    assert.deepEqual(byslug.beta.definitionSources, [], 'a term with no sources gets an empty array, not undefined');
    assert.ok(!JSON.stringify(body).includes('PRIVATE-GAMMA'));
  });

  it('applies ALL THREE privacy filters to the full build payload, not just the boyle_archive one', async () => {
    const d = db(seedFull);
    const { status, body } = await parseResponse(await get({ DB: d }));
    const raw = JSON.stringify(body);
    assert.equal(status, 200);

    // Each of these is a separate clause of the full-build sources query. The
    // payload is the public glossary build input, so a leak here ships to the
    // rendered site.
    assert.ok(!raw.includes('INTERNAL-A1'), "visibility='internal_only' must never reach the build payload");
    assert.ok(!raw.includes('DRAFT-A1'), "status='draft' must never reach the build payload");
    assert.ok(!raw.includes('PRIVATE-GAMMA'), "source_key='boyle_archive' must never reach the build payload");

    const byslug = Object.fromEntries(body.results.terms.map((t) => [t.slug, t]));
    assert.deepEqual(
      byslug.alpha1.definitionSources.map((s) => s.definitionText),
      ['a1-mesh', 'a1-nci'],
      'alpha1 has four stored sources; only the two published+public ones are served'
    );
  });

  it('returns references ordered by ref_num and abbreviations ordered by sort_order', async () => {
    const d = db(seedFull);
    const { body } = await parseResponse(await get({ DB: d }));

    assert.deepEqual(body.results.references, [
      { refNum: 2, anchorText: 'Two', url: 'https://two', publisher: null, journal: null },
      { refNum: 7, anchorText: 'Seven', url: 'https://seven', publisher: 'Pub7', journal: 'J7' },
    ]);
    assert.deepEqual(body.results.abbreviations, [
      { abbreviation: 'FABM', fullTerm: 'Fertility Awareness-Based Methods', termSlug: null, sortOrder: 1 },
      { abbreviation: 'PCOS', fullTerm: 'Polycystic Ovary Syndrome', termSlug: 'pcos', sortOrder: 9 },
    ]);
  });

  it('returns three empty arrays on an empty database rather than 404 or null', async () => {
    const { status, body } = await parseResponse(await get({ DB: db() }));
    assert.equal(status, 200);
    assert.deepEqual(body.results, { terms: [], references: [], abbreviations: [] });
  });

  it('degrades to sourceless terms (still 200) when the sources query throws, and logs it', async () => {
    const events = recorder();
    const d = failingOn(db(seedFull), 'glossary_definition_source');
    const { status, body } = await parseResponse(await get({ DB: d, events }));

    assert.equal(status, 200);
    assert.equal(body.results.terms.length, 4, 'terms must still be served');
    assert.ok(body.results.terms.every((t) => Array.isArray(t.definitionSources) && t.definitionSources.length === 0));
    assert.ok(events.points.some((p) => p.blobs[2] === 'sources_error'));
  });

  it('500s when the terms query throws', async () => {
    const events = recorder();
    const d = failingOn(db(seedFull), "status = 'published' ORDER BY part");
    const { status, body } = await parseResponse(await get({ DB: d, events }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(events.points.some((p) => p.blobs[2] === 'list_error'));
  });

  it('500s when the references query throws (the three reads are one Promise.all)', async () => {
    const d = failingOn(db(seedFull), 'FROM glossary_reference');
    assert.equal((await parseResponse(await get({ DB: d }))).status, 500);
  });

  it('500s when the abbreviations query throws', async () => {
    const d = failingOn(db(seedFull), 'FROM glossary_abbreviation');
    assert.equal((await parseResponse(await get({ DB: d }))).status, 500);
  });
});

// ------------------------------------------- D1 answering without `results` --

describe('GET /api/glossary/terms -- a D1 read that omits `results` entirely', () => {
  it('?id= yields an empty sources array instead of throwing on .map of undefined', async () => {
    const real = db((s) => {
      insertTerm(s, { id: 'term_a', slug: 'a' });
      insertSource(s, { term_id: 'term_a', source_key: 'mesh', definition_text: 'x' });
    });
    const { status, body } = await parseResponse(await get({ url: `${BASE}?id=term_a`, DB: undefinedResults(real) }));
    assert.equal(status, 200);
    assert.deepEqual(body.data.definitionSources, []);
  });

  it('?part= yields an empty results array instead of a 500', async () => {
    const real = db((s) => insertTerm(s, { id: 't1', slug: 'a', part: 'I' }));
    const { status, body } = await parseResponse(await get({ url: `${BASE}?part=I`, DB: undefinedResults(real) }));
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
  });

  it('the full build payload degrades to three empty arrays instead of a 500', async () => {
    const real = db((s) => {
      insertTerm(s, { id: 't1', slug: 'a' });
      insertReference(s, { ref_num: 1, anchor_text: 'One', url: 'https://one' });
      insertAbbreviation(s, { abbreviation: 'RRM', full_term: 'Restorative Reproductive Medicine' });
    });
    const { status, body } = await parseResponse(await get({ DB: undefinedResults(real) }));
    assert.equal(status, 200);
    assert.deepEqual(body.results, { terms: [], references: [], abbreviations: [] });
  });
});

// --------------------------------------------------------- timestamp mapper --

describe('GET /api/glossary/terms -- SQLite-to-ISO timestamp normalisation', () => {
  const cases = [
    ['sqlite datetime() format gains a T and a Z', '2026-05-06 07:08:09', '2026-05-06T07:08:09Z'],
    ['sqlite datetime() with fractional seconds still converts', '2026-05-06 07:08:09.123', '2026-05-06T07:08:09.123Z'],
    ['an already-ISO value with T is left alone', '2026-05-06T07:08:09.000Z', '2026-05-06T07:08:09.000Z'],
    ['a Z-suffixed value with no T is left alone', '20260506Z', '20260506Z'],
    // The endsWith('Z') guard is load-bearing ONLY for this shape: a value that
    // is both already-Z-terminated AND matches the sqlite datetime() pattern.
    // Drop the guard and this becomes '2026-05-06T07:08:09ZZ' -- a double-Z that
    // Date.parse rejects. Every other Z case in this table survives the guard's
    // removal unchanged, so this row is the only one that proves it.
    ['an already-Z sqlite datetime is NOT re-stamped into a double-Z', '2026-05-06 07:08:09Z', '2026-05-06 07:08:09Z'],
    ['a value that matches no known shape is passed through untouched', 'sometime last spring', 'sometime last spring'],
    ['an empty string is passed through untouched', '', ''],
    ['NULL stays null rather than becoming a bogus date', null, null],
  ];

  for (const [label, stored, expected] of cases) {
    it(label, async () => {
      const d = db((s) => insertTerm(s, { id: 'term_t', slug: 't', updated_at: stored, created_at: stored }));
      const { body } = await parseResponse(await get({ url: `${BASE}?id=term_t`, DB: d }));
      assert.equal(body.data.updatedAt, expected);
      assert.equal(body.data.createdAt, expected);
    });
  }

  it('a legacy epoch timestamp is passed through verbatim, never reinterpreted as a date', async () => {
    const d = db((s) => {
      insertTerm(s, { id: 'term_n', slug: 'n' });
      s.prepare('UPDATE glossary_term SET updated_at = 1767225600 WHERE id = ?').run('term_n');
    });
    const { body } = await parseResponse(await get({ url: `${BASE}?id=term_n`, DB: d }));
    // The column is TEXT, so SQLite hands back the string form; the mapper must
    // leave it alone rather than guess at a unit and emit a wrong ISO date.
    assert.equal(body.data.updatedAt, '1767225600');
  });
});
