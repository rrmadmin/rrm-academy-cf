/**
 * Tests for src/lib/fetch-data.mjs — mapWorkerRecord
 * Run with: node --test test/lib-fetch-data.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWorkerRecord } from '../src/lib/fetch-data.mjs';

test('mapWorkerRecord: returns null when slug missing', () => {
  assert.equal(mapWorkerRecord({ title: 'No slug' }), null);
});

test('mapWorkerRecord: returns null when title missing', () => {
  assert.equal(mapWorkerRecord({ slug: 'no-title' }), null);
});

test('mapWorkerRecord: returns null when both missing', () => {
  assert.equal(mapWorkerRecord({}), null);
});

test('mapWorkerRecord: normalizes slug (trim + lowercase)', () => {
  const out = mapWorkerRecord({ slug: '  MY-Slug  ', title: 'Title' });
  assert.equal(out.slug, 'my-slug');
});

test('mapWorkerRecord: strips trailing dot from title', () => {
  const out = mapWorkerRecord({ slug: 's', title: 'A title.' });
  assert.equal(out.title, 'A title');
});

test('mapWorkerRecord: strips trailing dot with whitespace', () => {
  const out = mapWorkerRecord({ slug: 's', title: 'A title.  ' });
  assert.equal(out.title, 'A title');
});

test('mapWorkerRecord: preserves title without trailing dot', () => {
  const out = mapWorkerRecord({ slug: 's', title: 'No dot here' });
  assert.equal(out.title, 'No dot here');
});

test('mapWorkerRecord: year null when undefined', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't' });
  assert.equal(out.year, null);
});

test('mapWorkerRecord: year preserved when 0', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't', year: 0 });
  assert.equal(out.year, 0);
});

test('mapWorkerRecord: year preserved when present', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't', year: 2024 });
  assert.equal(out.year, 2024);
});

test('mapWorkerRecord: keywords array joined with ", "', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't', keywords: ['a', 'b', 'c'] });
  assert.equal(out.keywords, 'a, b, c');
});

test('mapWorkerRecord: keywords string passed through', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't', keywords: 'x, y' });
  assert.equal(out.keywords, 'x, y');
});

test('mapWorkerRecord: keywords missing becomes empty string', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't' });
  assert.equal(out.keywords, '');
});

test('mapWorkerRecord: topics array preserved', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't', topics: ['endo', 'pcos'] });
  assert.deepEqual(out.topics, ['endo', 'pcos']);
});

test('mapWorkerRecord: topics non-array becomes empty array', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't', topics: 'not-array' });
  assert.deepEqual(out.topics, []);
});

test('mapWorkerRecord: topics missing becomes empty array', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't' });
  assert.deepEqual(out.topics, []);
});

test('mapWorkerRecord: searchTerms, identifiers, authorRecords all array-coerced', () => {
  const out = mapWorkerRecord({
    slug: 's',
    title: 't',
    searchTerms: ['a'],
    identifiers: [{ type: 'doi', value: '10.x' }],
    authorRecords: ['auth-1'],
  });
  assert.deepEqual(out.searchTerms, ['a']);
  assert.deepEqual(out.identifiers, [{ type: 'doi', value: '10.x' }]);
  assert.deepEqual(out.authorRecords, ['auth-1']);
});

test('mapWorkerRecord: isOpenAccess + isCopyrighted coerced to boolean', () => {
  const out1 = mapWorkerRecord({ slug: 's', title: 't', isOpenAccess: 1, isCopyrighted: 0 });
  assert.equal(out1.isOpenAccess, true);
  assert.equal(out1.isCopyrighted, false);

  const out2 = mapWorkerRecord({ slug: 's', title: 't' });
  assert.equal(out2.isOpenAccess, false);
  assert.equal(out2.isCopyrighted, false);
});

test('mapWorkerRecord: accessLevel defaults to "restricted"', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't' });
  assert.equal(out.accessLevel, 'restricted');
});

test('mapWorkerRecord: accessLevel preserved when set', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't', accessLevel: 'open' });
  assert.equal(out.accessLevel, 'open');
});

test('mapWorkerRecord: string fields default to empty string', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't' });
  const emptyFields = [
    'authors', 'shortCitation', 'abstract', 'journal', 'journalAbbv',
    'doi', 'pmid', 'sourceUrl', 'datePublished', 'volume', 'issue', 'pages',
    'apaCitation', 'vancouverCitation', 'mlaCitation', 'enrichmentStatus',
    'oaType', 'license', 'oaUrl', 'sentiment', 'rrmRelevance', 'domain',
    'lastModified', 'dateAddedToLibrary',
  ];
  for (const f of emptyFields) {
    assert.equal(out[f], '', `${f} should default to ''`);
  }
});

test('mapWorkerRecord: string fields preserved when set', () => {
  const input = {
    id: 'rec123',
    slug: 'my-article',
    title: 'My Article',
    authors: 'Smith J, Jones K',
    shortCitation: 'Smith 2024',
    abstract: 'Background...',
    journal: 'Fertility & Sterility',
    journalAbbv: 'Fertil Steril',
    doi: '10.1016/j.x',
    pmid: '12345678',
    sourceUrl: 'https://example.com',
    datePublished: '2024-03-15',
    volume: '121',
    issue: '3',
    pages: '500-510',
    apaCitation: 'Smith, J. (2024)...',
    vancouverCitation: 'Smith J. 2024...',
    mlaCitation: 'Smith, John. 2024...',
    enrichmentStatus: 'verified',
    oaType: 'gold',
    license: 'cc-by',
    oaUrl: 'https://open.example.com',
    accessLevel: 'open',
    sentiment: 'supportive',
    rrmRelevance: 'high',
    domain: 'napro',
    lastModified: '2024-04-01T00:00:00Z',
    dateAddedToLibrary: '2024-03-20',
  };
  const out = mapWorkerRecord(input);
  assert.equal(out.id, 'rec123');
  for (const [k, v] of Object.entries(input)) {
    if (k === 'slug' || k === 'title') continue;
    assert.equal(out[k], v, `${k} should be preserved`);
  }
});

test('mapWorkerRecord: returns full shape with all expected keys', () => {
  const out = mapWorkerRecord({ slug: 's', title: 't' });
  const expected = [
    'id', 'slug', 'title', 'authors', 'shortCitation', 'year', 'abstract',
    'journal', 'journalAbbv', 'doi', 'pmid', 'sourceUrl', 'datePublished',
    'volume', 'issue', 'pages', 'keywords', 'apaCitation', 'vancouverCitation',
    'mlaCitation', 'topics', 'searchTerms', 'enrichmentStatus', 'identifiers',
    'isOpenAccess', 'isCopyrighted', 'oaType', 'license', 'oaUrl',
    'accessLevel', 'sentiment', 'rrmRelevance', 'domain', 'lastModified',
    'dateAddedToLibrary', 'authorRecords',
  ];
  assert.deepEqual(Object.keys(out).sort(), expected.sort());
});
