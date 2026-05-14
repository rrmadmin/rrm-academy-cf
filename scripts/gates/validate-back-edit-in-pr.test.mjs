import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBackEditInPr } from './validate-back-edit-in-pr.mjs';

test('PR adds new pillar AND back-edits sibling: pass', () => {
  const changedFiles = [
    'src/pages/for-providers/index.astro',
    'src/pages/getting-started/index.astro',
  ];
  const shippedSlugs = ['getting-started'];
  const r = checkBackEditInPr(changedFiles, shippedSlugs);
  assert.equal(r.ok, true);
});

test('PR adds new pillar but skips back-edit to shipped sibling: fail', () => {
  const changedFiles = ['src/pages/for-providers/index.astro'];
  const shippedSlugs = ['getting-started'];
  const r = checkBackEditInPr(changedFiles, shippedSlugs);
  assert.equal(r.ok, false);
  assert.match(r.error, /missing back-edit to getting-started/);
});

test('PR with no new pillar: pass (gate is no-op)', () => {
  const changedFiles = ['src/pages/about.astro'];
  const shippedSlugs = ['getting-started'];
  const r = checkBackEditInPr(changedFiles, shippedSlugs);
  assert.equal(r.ok, true);
});

test('Phase 1 PR (no shipped siblings yet, no back-edit needed)', () => {
  const changedFiles = ['src/pages/getting-started/index.astro'];
  const shippedSlugs = [];
  const r = checkBackEditInPr(changedFiles, shippedSlugs);
  assert.equal(r.ok, true);
});
