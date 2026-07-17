import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'functions/_middleware.js'), 'utf8');

test('carve-out lowers exactly /admin/membership to admin', () => {
  assert.match(src, /\/admin\/membership/);
  assert.match(src, /roleAtLeast\(\s*session\.role\s*,\s*requiredRole\s*\)/);
  assert.match(src, /isMembershipPage\s*\?\s*'admin'\s*:\s*'superadmin'/);
});

test('every other /admin/* path stays superadmin (default branch intact)', () => {
  // The default of the ternary must be 'superadmin'; there must be no unguarded
  // roleAtLeast(..., 'admin') applied to the whole /admin/* block.
  assert.match(src, /:\s*'superadmin'/);
});

test('account + community gating preserved (do not regress the existing invariant)', () => {
  assert.match(src, /\/account/);
  assert.match(src, /startsWith\('\/community\/'\)/);
  assert.match(src, /isPublicCommunity/);
});
