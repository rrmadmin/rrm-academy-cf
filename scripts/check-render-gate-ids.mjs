#!/usr/bin/env node
// Guards the two structural element ids in src/pages/404.astro that
// rrm-library-worker's live render-verification gate depends on to detect
// pages that have not been built yet (see rrm-library-worker
// src/render-verify.js NOT_BUILT_MARKERS + isNotBuiltShell()). That gate
// fetches a candidate URL and treats a response containing either id as "not
// built yet" (verdict INCONCLUSIVE) instead of scoring it as a real page.
//
// If either id is renamed or removed here without a matching update on the
// worker side, the worker stops recognizing not-yet-built pages as such and
// silently treats build lag as a real page, converting it into a false FAIL
// stamp + alert email. This check fails the BUILD instead, so the rename
// gets caught here before it ships.
//
// Run via `npm run build` (chained after the other pre-build guards) and
// covered by test/check-render-gate-ids.test.mjs via `npm test`.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
export const TARGET_FILE = 'src/pages/404.astro';

export const REQUIRED_IDS = ['nf-known-pages', 'nf-search-input'];

export function findMissingRenderGateIds(html) {
  return REQUIRED_IDS.filter((id) => {
    const re = new RegExp(`id=["']${id}["']`);
    return !re.test(html || '');
  });
}

export function checkRenderGateIds(html) {
  const missing = findMissingRenderGateIds(html);
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    error:
      `${TARGET_FILE} is missing required id(s): ${missing.join(', ')}. ` +
      'These ids are load-bearing for rrm-library-worker\'s live render-verification ' +
      'gate (src/render-verify.js NOT_BUILT_MARKERS / isNotBuiltShell()), which uses ' +
      'them to detect not-yet-built pages. Removing or renaming an id here without ' +
      'updating that gate silently turns build lag into false FAIL stamps + alert ' +
      'emails. Restore the id(s), or update both sides together.',
  };
}

function main() {
  const filePath = resolve(REPO_ROOT, TARGET_FILE);
  if (!existsSync(filePath)) {
    console.error(`FAIL: ${TARGET_FILE} not found`);
    process.exit(1);
  }
  const html = readFileSync(filePath, 'utf8');
  const result = checkRenderGateIds(html);
  if (!result.ok) {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }
  console.log(`PASS: ${TARGET_FILE} carries both render-gate ids (${REQUIRED_IDS.join(', ')})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
