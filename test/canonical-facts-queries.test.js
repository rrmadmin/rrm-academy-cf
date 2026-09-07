/**
 * scripts/lib/canonical-facts-queries.mjs -- the source gate on the site build's fact read.
 *
 * These run the ACTUAL query strings against a real SQLite engine (node:sqlite), not a
 * substring matcher. The thing under test is a SQL predicate, so a fake that pattern-matched
 * on `sql.includes('published')` could not fail when the predicate is wrong, and would pin
 * nothing. The DDL below declares `slug TEXT UNIQUE NOT NULL`, which is the live
 * rrm-library declaration and is load-bearing for the query-plan assertion at the end.
 *
 * The gate withholds a fact whose SOURCE ARTICLE is archived, retracted, or an excluded
 * serving type, because the generated canonical-facts JSON quotes the fact and carries the
 * source's title, citation and URL beside it. Before 2026-09-07 the read was
 * `FROM facts WHERE verified >= 1` with no predicate on the source at all.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { FACTS_QUERY, ARTICLES_QUERY, EXCLUDED_TYPES_SQL } from '../scripts/lib/canonical-facts-queries.mjs';
import { EXCLUDED_TYPES } from '../src/lib/excluded-types.mjs';

const DDL = `
CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  type TEXT,
  title TEXT,
  authors TEXT,
  year INTEGER,
  journal TEXT,
  pmid TEXT,
  doi TEXT,
  source_url TEXT,
  short_citation TEXT,
  status TEXT,
  is_published INTEGER DEFAULT 0,
  is_retracted INTEGER DEFAULT 0
);
CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  claim TEXT,
  category TEXT,
  domain TEXT,
  tradition TEXT,
  claim_type TEXT,
  body TEXT,
  source_id TEXT,
  verified INTEGER DEFAULT 0,
  verification_notes TEXT,
  created_at TEXT,
  updated_at TEXT
);`;

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec(DDL);
  return d;
}
function article(d, row) {
  const full = {
    id: row.id, slug: row.slug ?? `${row.id}-slug`, type: 'article', title: `T ${row.id}`,
    authors: null, year: 2024, journal: null, pmid: null, doi: null, source_url: null,
    short_citation: null, status: 'published', is_published: 1, is_retracted: 0, ...row,
  };
  const cols = Object.keys(full);
  d.prepare(`INSERT INTO articles (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => full[c]));
}
function fact(d, row) {
  const full = {
    id: row.id, claim: `claim ${row.id}`, category: null, domain: null, tradition: '["napro"]',
    claim_type: null, body: null, source_id: null, verified: 1, verification_notes: null,
    created_at: '2026-01-01', updated_at: '2026-01-01', ...row,
  };
  const cols = Object.keys(full);
  d.prepare(`INSERT INTO facts (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => full[c]));
}
const factIds = (d) => d.prepare(FACTS_QUERY).all().map((r) => r.id);

describe('canonical-facts source gate -- the four withheld cases', () => {
  const cases = [
    ['a published article',                 { status: 'published', type: 'article' },                     true],
    ['a published row with a NULL type',    { status: 'published', type: null },                          true],
    ['an ARCHIVED article',                 { status: 'archived',  type: 'article' },                     false],
    ['a RETRACTED published article',       { status: 'published', type: 'article', is_retracted: 1 },    false],
    ['a published EXCLUDED type',           { status: 'published', type: 'transcript' },                  false],
    ['a classified-but-unpublished row',    { status: 'classified', type: 'article' },                    false],
  ];
  for (const [label, art, expected] of cases) {
    test(`a fact sourced from ${label} is ${expected ? 'emitted' : 'withheld'}`, () => {
      const d = db();
      article(d, { id: 'src', ...art });
      fact(d, { id: 'f1', source_id: 'src' });
      assert.deepEqual(factIds(d), expected ? ['f1'] : []);
      d.close();
    });
  }

  test('is_published = 1 alone no longer carries a retracted source through', () => {
    // The old article read admitted any is_published = 1 row, retracted or not.
    const d = db();
    article(d, { id: 'src', status: 'published', is_published: 1, is_retracted: 1 });
    fact(d, { id: 'f1', source_id: 'src' });
    assert.deepEqual(factIds(d), []);
    assert.deepEqual(d.prepare(ARTICLES_QUERY).all().map((r) => r.id), []);
    d.close();
  });

  test('every excluded type withholds, not just the one a fixture happens to name', () => {
    const d = db();
    let i = 0;
    for (const t of EXCLUDED_TYPES) {
      i += 1;
      article(d, { id: `src${i}`, slug: `s${i}`, status: 'published', type: t });
      fact(d, { id: `f${i}`, source_id: `src${i}` });
    }
    assert.deepEqual(factIds(d), []);
    d.close();
  });
});

describe('canonical-facts source gate -- what it must NOT withhold', () => {
  test('a fact with no source_id at all is still emitted', () => {
    const d = db();
    fact(d, { id: 'f-standalone', source_id: null });
    assert.deepEqual(factIds(d), ['f-standalone']);
    d.close();
  });

  test('a fact whose source_id resolves to no article row is still emitted', () => {
    // promote-facts accepts another fact's id as source_id. There is no withheld article
    // behind that token, so gating it would remove a curated fact for nothing.
    const d = db();
    fact(d, { id: 'f-orphan', source_id: 'not-an-article' });
    assert.deepEqual(factIds(d), ['f-orphan']);
    d.close();
  });

  test('an unverified fact is still excluded (verified >= 1 survived the rewrite)', () => {
    const d = db();
    article(d, { id: 'src', status: 'published' });
    fact(d, { id: 'f-unverified', source_id: 'src', verified: 0 });
    assert.deepEqual(factIds(d), []);
    d.close();
  });

  test('the gate is per fact, not per corpus', () => {
    const d = db();
    article(d, { id: 'pub',  slug: 'pub-slug',  status: 'published', type: 'article' });
    article(d, { id: 'arch', slug: 'arch-slug', status: 'archived',  type: 'transcript' });
    fact(d, { id: 'f-pub',  source_id: 'pub' });
    fact(d, { id: 'f-arch', source_id: 'arch' });
    assert.deepEqual(factIds(d), ['f-pub']);
    d.close();
  });
});

describe('canonical-facts source gate -- the slug arm', () => {
  test('withholds a fact whose source_id is a withheld article SLUG, not its id', () => {
    const d = db();
    article(d, { id: 'src2', slug: 'boyle-transcript-2019', status: 'archived', type: 'transcript' });
    fact(d, { id: 'f-slug', source_id: 'boyle-transcript-2019' });
    assert.deepEqual(factIds(d), []);
    d.close();
  });

  test('matches that slug case-insensitively', () => {
    const d = db();
    article(d, { id: 'src3', slug: 'Boyle-Transcript-2020', status: 'archived', type: 'transcript' });
    fact(d, { id: 'f-slug-case', source_id: 'boyle-transcript-2020' });
    assert.deepEqual(factIds(d), []);
    d.close();
  });

  test('a published article slug does not withhold its own facts', () => {
    const d = db();
    article(d, { id: 'src4', slug: 'published-source-2024', status: 'published', type: 'article' });
    fact(d, { id: 'f-slug-ok', source_id: 'published-source-2024' });
    assert.deepEqual(factIds(d), ['f-slug-ok']);
    d.close();
  });

  test('the slug arm is a materialised set, not a per-fact correlated re-scan', () => {
    // Scale-only failure, so this asserts the PLAN rather than a clock. These queries run
    // through `wrangler d1 execute --remote` against production, where the correlated form
    // of this arm answered with D1 error 7429, "exceeded its CPU time limit" (2026-09-07).
    // `articles.slug` is UNIQUE BINARY, so an explicit COLLATE NOCASE cannot use that index.
    const d = db();
    const plan = d.prepare(`EXPLAIN QUERY PLAN ${FACTS_QUERY}`).all().map((r) => r.detail).join(' | ');
    assert.doesNotMatch(plan, /CORRELATED/i, `query plan re-scans per row: ${plan}`);
    d.close();
  });
});

describe('canonical-facts source gate -- the excluded-type list is imported, not retyped', () => {
  test('EXCLUDED_TYPES_SQL renders every type from src/lib/excluded-types.mjs', () => {
    for (const t of EXCLUDED_TYPES) assert.match(EXCLUDED_TYPES_SQL, new RegExp(`'${t}'`));
    assert.equal(EXCLUDED_TYPES_SQL.split(',').length, EXCLUDED_TYPES.size);
  });

  test('both queries carry the imported list, so adding a type reaches them', () => {
    for (const t of EXCLUDED_TYPES) assert.ok(FACTS_QUERY.includes(`'${t}'`), `FACTS_QUERY missing ${t}`);
  });
});
