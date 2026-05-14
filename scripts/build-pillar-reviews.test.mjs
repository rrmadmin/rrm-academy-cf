import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLastReviewed } from './build-pillar-reviews.mjs';

test('extractLastReviewed returns ISO date from frontmatter', () => {
  const astro = `---
const lastReviewed = '2026-05-14';
const title = 'Test';
---
<h1>x</h1>`;
  assert.equal(extractLastReviewed(astro), '2026-05-14');
});

test('extractLastReviewed returns null when not present', () => {
  const astro = `---
const title = 'Test';
---
<h1>x</h1>`;
  assert.equal(extractLastReviewed(astro), null);
});

test('extractLastReviewed handles double-quoted value', () => {
  const astro = `---
const lastReviewed = "2026-05-14";
---`;
  assert.equal(extractLastReviewed(astro), '2026-05-14');
});

test('extractLastReviewed rejects malformed date', () => {
  const astro = `---
const lastReviewed = 'not-a-date';
---`;
  assert.equal(extractLastReviewed(astro), null);
});
