/**
 * Guards on the middleware's universal trailing-slash redirect, born from the
 * 2026-08-25 /404 loop: the apex unmasking made this block live for real
 * traffic, and slashing /404 (the one flat .html in the Astro build) made an
 * infinite loop with Pages' own /404/ -> /404 normalization. rrm-router's
 * catch-all fetches /404 for every unknown URL, so the loop turned EVERY
 * unmatched path on the site into a 502 for about five hours.
 *
 * Two invariants, both extracted from source rather than pinned as prose:
 *
 * 1. The middleware's trailing-slash block must exclude at least everything
 *    rrm-router's needsTrailingSlash() excludes (/api, /mcp, /health, dotted
 *    paths) PLUS /404, and must be GET-only. The router and the middleware
 *    are two independent implementations of one policy; this test is the
 *    parity check that keeps them from drifting apart again.
 *
 * 2. Falsifiability: the checker itself is exercised against the exact
 *    pre-fix shape of the block (no /404 exclusion, no method guard) and
 *    must FAIL on it. A guard that cannot fail on the bug it was built for
 *    is decoration.
 *
 * The router source is read from the sibling clone when present and skipped
 * otherwise (CI checks out this repo alone); the middleware-side assertions
 * always run.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIDDLEWARE = readFileSync(join(ROOT, 'functions', '_middleware.js'), 'utf8');

/**
 * The trailing-slash block's condition, located by its anchor comment. Returns
 * the source text of the `if (...)` condition that gates the redirect.
 */
function trailingSlashCondition(source) {
  const anchor = source.indexOf('Universal trailing-slash redirect');
  assert.notEqual(anchor, -1, 'the trailing-slash block (or its anchor comment) is gone; if it was removed on purpose, retire this test with it');
  const ifStart = source.indexOf('if (', anchor);
  assert.notEqual(ifStart, -1);
  const condEnd = source.indexOf(') {', ifStart);
  return source.slice(ifStart, condEnd);
}

/** The exclusion checks the condition must carry, each as a literal the condition text must contain. */
const REQUIRED_EXCLUSIONS = [
  "request.method === 'GET'",
  "url.pathname !== '/api'",
  "!url.pathname.startsWith('/api/')",
  "url.pathname !== '/health'",
  "url.pathname !== '/mcp'",
  "url.pathname !== '/404'",
  "!url.pathname.includes('.')",
];

describe('trailing-slash redirect invariants (the /404 loop guard)', () => {
  const cond = trailingSlashCondition(MIDDLEWARE);

  for (const literal of REQUIRED_EXCLUSIONS) {
    it(`condition carries ${literal}`, () => {
      assert.ok(cond.includes(literal), `trailing-slash condition lost "${literal}" -- /404 loops (site-wide 502 via the router catch-all), /mcp 404s, or POST bodies get dropped by a 301`);
    });
  }

  it('the checker FAILS on the pre-fix shape (falsifiability self-test)', () => {
    // The block exactly as it shipped before the 2026-08-25 fixes: no method
    // guard, no /mcp, no /404. Every one of those three must be reported
    // missing, or this guard could not have caught the incident it memorializes.
    const preFix = `// Universal trailing-slash redirect for HTML pages.
  if (
    !url.pathname.endsWith('/') &&
    url.pathname !== '/api' &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/cdn-cgi/') &&
    url.pathname !== '/health' &&
    !url.pathname.includes('.')
  ) {`;
    const preCond = trailingSlashCondition(preFix);
    const missing = REQUIRED_EXCLUSIONS.filter((l) => !preCond.includes(l));
    assert.deepEqual(missing.sort(), [
      "request.method === 'GET'",
      "url.pathname !== '/404'",
      "url.pathname !== '/mcp'",
    ].sort(), 'the self-test fixture no longer reproduces the pre-fix gap; update it alongside any deliberate condition change');
  });

  it('middleware exclusions are a superset of rrm-router needsTrailingSlash (parity, when the sibling clone is present)', () => {
    const routerPath = join(ROOT, '..', 'rrm-router', 'src', 'index.js');
    if (!existsSync(routerPath)) return; // CI checks out this repo alone
    const router = readFileSync(routerPath, 'utf8');
    const fnStart = router.indexOf('function needsTrailingSlash');
    assert.notEqual(fnStart, -1, 'rrm-router lost needsTrailingSlash(); re-derive the parity list');
    const fnBody = router.slice(fnStart, router.indexOf('}', fnStart));
    // Every exact-path exclusion the router makes must exist middleware-side.
    const routerPaths = [...fnBody.matchAll(/path !== '([^']+)'/g)].map((m) => m[1]);
    assert.ok(routerPaths.length >= 3, 'router exclusion extraction went vacuous');
    for (const p of routerPaths) {
      assert.ok(cond.includes(`url.pathname !== '${p}'`), `rrm-router excludes ${p} from slashing but the middleware does not; the router-excluded form reaches the middleware slash-less and gets a redirect the router deliberately avoids`);
    }
  });
});
