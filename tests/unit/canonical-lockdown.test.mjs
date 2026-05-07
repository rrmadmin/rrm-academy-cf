// tests/unit/canonical-lockdown.test.mjs
// G-SEO-5: Canonical URL has no query params in shell-routed pages.
// G-SLUG-CAP: Slug length stays within the regex cap used by the shell
//             validator (Task 9), writer (Task 10), and SearchBar (Task 16).
// Run: node --test tests/unit/canonical-lockdown.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SHELL_SLUG_CAP = 251; // [a-z0-9] + up to 250 chars = 251 max length

test('articles.json canonicals have no query params', () => {
  const data = JSON.parse(readFileSync('src/data/articles.json', 'utf8'));
  for (const a of data) {
    if (!a.slug) continue;
    assert.ok(!a.slug.includes('?'), `slug contains '?': ${a.slug}`);
    assert.ok(!a.slug.includes('&'), `slug contains '&': ${a.slug}`);
    assert.ok(!a.slug.includes('='), `slug contains '=': ${a.slug}`);
  }
});

test('posts.json canonicals have no query params', () => {
  const data = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
  for (const p of data) {
    if (!p.slug) continue;
    assert.ok(!p.slug.includes('?'), `slug contains '?': ${p.slug}`);
    assert.ok(!p.slug.includes('&'), `slug contains '&': ${p.slug}`);
    assert.ok(!p.slug.includes('='), `slug contains '=': ${p.slug}`);
  }
});

test('articles.json slug lengths fit shell SLUG_RE cap', () => {
  const data = JSON.parse(readFileSync('src/data/articles.json', 'utf8'));
  const lengths = data.map(a => (a.slug || '').length).filter(n => n > 0);
  const max = Math.max(...lengths);
  assert.ok(
    max <= SHELL_SLUG_CAP,
    `articles.json max slug length is ${max}, exceeds shell SLUG_RE cap ${SHELL_SLUG_CAP}. ` +
    `Raise the regex cap in AppShellChrome.astro + SearchBar.astro + this test in lockstep.`
  );
});

test('posts.json slug lengths fit shell SLUG_RE cap', () => {
  const data = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
  const lengths = data.map(p => (p.slug || '').length).filter(n => n > 0);
  if (lengths.length === 0) return;
  const max = Math.max(...lengths);
  assert.ok(
    max <= SHELL_SLUG_CAP,
    `posts.json max slug length is ${max}, exceeds shell SLUG_RE cap ${SHELL_SLUG_CAP}. ` +
    `Raise the regex cap in AppShellChrome.astro + SearchBar.astro + this test in lockstep.`
  );
});
