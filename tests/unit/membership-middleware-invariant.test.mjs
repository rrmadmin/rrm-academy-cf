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
  // Pin the exact isMembershipPage definition -- must not broaden to e.g.
  // startsWith('/admin') which would flip every other /admin/* page to admin too.
  assert.match(
    src,
    /isMembershipPage\s*=\s*pathnameLower\s*===\s*'\/admin\/membership'\s*\|\|\s*pathnameLower\.startsWith\('\/admin\/membership\/'\)/
  );
});

test('every other /admin/* path stays superadmin (default branch intact)', () => {
  // The ternary's else-branch must be 'superadmin', and there must be exactly
  // one roleAtLeast(session.role, ...) call in the whole file -- the carve-out's
  // requiredRole check -- so no other unguarded admin-level check can slip in
  // beside it for the rest of /admin/*.
  assert.match(src, /isMembershipPage\s*\?\s*'admin'\s*:\s*'superadmin'/);
  const roleAtLeastCalls = src.match(/roleAtLeast\(\s*session\.role\s*,/g) || [];
  assert.equal(roleAtLeastCalls.length, 1);
});

test('account + community gating preserved (do not regress the existing invariant)', () => {
  assert.match(src, /\/account/);
  assert.match(src, /startsWith\('\/community\/'\)/);
  assert.match(src, /isPublicCommunity/);
});
