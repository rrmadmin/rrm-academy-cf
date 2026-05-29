import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, levenshtein, score, bestMatches } from '../src/lib/url-match.js';

// Fixture index. /connect, /contact, /courses, /community, /commentary are included here
// to exercise scoring; in production they are filtered by PRIVATE_EXCLUDE / inclusion.
const INDEX = [
  { path: '/glossary', title: 'Glossary' },
  { path: '/naprotechnology', title: 'NaProTechnology' },
  { path: '/donate', title: 'Donate' },
  { path: '/library', title: 'Research Library' },
  { path: '/commentary', title: 'Commentary' },
  { path: '/community', title: 'Community' },
  { path: '/connect', title: 'Connect' },
  { path: '/contact', title: 'Contact' },
  { path: '/courses', title: 'Courses' },
  { path: '/about', title: 'About' },
  { path: '/femm', title: 'FEMM' },
];

const top = (p) => {
  const m = bestMatches(p, INDEX);
  return m.length ? m[0].path : null;
};

test('normalize lowercases, decodes, strips slashes/query/hash', () => {
  assert.equal(normalize('/About/'), 'about');
  assert.equal(normalize('/library?utm=x'), 'library');
  assert.equal(normalize('/foo%2Fabout'), 'foo/about');
  // strip ?/# happens on RAW input before decode, so an encoded #/? is kept as a literal
  assert.equal(normalize('/foo%23bar'), 'foo#bar');
  assert.equal(normalize(null), '');
  assert.equal(normalize(123), '');
});

test('normalize does not throw on malformed percent-encoding', () => {
  assert.doesNotThrow(() => normalize('/glossary%zz'));
});

test('levenshtein basic distances', () => {
  assert.equal(levenshtein('glossary', 'glossary'), 0);
  assert.equal(levenshtein('glosary', 'glossary'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('single-char typo suggests the right page', () => {
  assert.equal(top('/glosary'), '/glossary');
  assert.equal(top('/donat'), '/donate');
  assert.equal(top('/librery'), '/library');
});

test('truncation suggests the full page via prefix floor', () => {
  assert.equal(top('/naprotech'), '/naprotechnology');
});

test('deep slug under a real page suggests that page', () => {
  assert.equal(top('/library/some-truncated-slug'), '/library');
});

test('last-segment coincidence must NOT manufacture a match', () => {
  assert.equal(top('/zzzzzzzz/donate'), null);
});

test('last-segment coincidence must NOT outrank the correct section', () => {
  assert.equal(top('/library/glossary'), '/library');
  const paths = bestMatches('/library/glossary', INDEX).map((m) => m.path);
  assert.ok(!paths.includes('/glossary') || paths.indexOf('/library') < paths.indexOf('/glossary'));
});

test('short paths do not trip the prefix floor', () => {
  assert.equal(bestMatches('/c', INDEX).length, 0);
  assert.equal(bestMatches('/co', INDEX).length, 0);
});

test('never suggests the path that 404d', () => {
  assert.equal(bestMatches('/glossary', INDEX).length, 0);
  assert.equal(bestMatches('/Glossary/', INDEX).length, 0);
});

test('root, empty, and garbage yield nothing', () => {
  assert.equal(bestMatches('/', INDEX).length, 0);
  assert.equal(bestMatches('', INDEX).length, 0);
  assert.equal(bestMatches('/x9q7zzv', INDEX).length, 0);
});

test('very long input does not throw and yields nothing', () => {
  const long = '/' + 'q'.repeat(2000);
  let res;
  assert.doesNotThrow(() => {
    res = bestMatches(long, INDEX);
  });
  assert.equal(res.length, 0);
});

test('respects limit and is deterministic', () => {
  const a = bestMatches('/about', INDEX, { threshold: 0, limit: 3 });
  assert.equal(a.length, 3);
  const b = bestMatches('/about', INDEX, { threshold: 0, limit: 3 });
  assert.deepEqual(a, b);
  assert.ok(a[0].score >= a[1].score && a[1].score >= a[2].score);
});
