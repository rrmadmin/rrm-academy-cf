/**
 * THE /api/* CACHE CONTRACT, SWEPT OVER EVERY ROUTE (RRMA-RT-3).
 *
 * `public/_headers` declared `/api/* Cache-Control: no-store` and never once
 * applied it to a Function response. `_headers` governs what Pages serves
 * ITSELF: a HEAD on /api/community/status (no module exports HEAD, so Pages
 * answers its own 404) came back with the header, while a GET on the same path
 * reached the Function and came back 200 with no cache directive at all. Every
 * authenticated endpoint on the site was in that hole -- /api/billing/status,
 * /api/community/members, /api/auth/session -- and a control that has never
 * applied reads, to anyone auditing it, exactly like a control that has.
 *
 * WHY A SWEEP AND NOT A CASE. The red-team table holds one case for this and
 * is deliberately capped at a targeted 150; the failure mode here is not "the
 * header is missing at /api/community/status", it is "the header is missing at
 * the ONE route nobody thought to check". So this drives the real middleware,
 * through the real dispatcher, over every route targets.mjs names, with the
 * body each write route needs -- the same in-process stack the red-team
 * harness uses, not a re-implementation of it.
 *
 * THE COUNTERWEIGHT IS PART OF THE CONTRACT, not a caveat to it. no-store is
 * the DEFAULT for an API response, not an override of a decision someone made:
 * /api/assets/* serves R2 objects `public, max-age=31536000, immutable`,
 * /api/articles is the public build feed at an hour, /api/survey/count at a
 * minute. A middleware that flattened those to no-store would be a bandwidth
 * and LCP regression sold as hardening, so the routes that declared a policy
 * are asserted to KEEP it, by name.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import './_json-module-hook.mjs';

import { ROUTES } from '../scripts/redteam/targets.mjs';
import { redteamEnv } from '../scripts/redteam/fakes/env.mjs';
import { dispatch } from '../scripts/redteam/fakes/dispatch.mjs';
import { installUpstream } from '../scripts/redteam/fakes/upstream.mjs';
import { bodyFor } from '../scripts/redteam/fakes/bodies.mjs';

const APEX = 'https://rrmacademy.org';

/**
 * Routes that declare their own Cache-Control, and what they declare. Written
 * out rather than derived, so adding a route to this list is a decision
 * somebody made on purpose in a diff.
 *
 * /api/survey/count is the one exercised end to end because it is the one that
 * answers 200 from constants alone. /api/articles and /api/assets/* declare
 * theirs on their 200 path too, but only reach it through an upstream worker
 * and an R2 object respectively; hermetically they answer an error, and an
 * error response SHOULD be no-store, so asserting a max-age on them here would
 * pin the wrong thing.
 */
const DELIBERATELY_CACHEABLE = new Map([
  ['/api/survey/count', /max-age=60/],
]);

async function send(route) {
  const { env } = await redteamEnv();
  const upstream = installUpstream();
  try {
    const init = { method: route.method, headers: { 'CF-Connecting-IP': '203.0.113.9', 'content-type': 'application/json' } };
    if (route.method !== 'GET' && route.method !== 'HEAD') {
      init.body = JSON.stringify(bodyFor(route.path, route.method) ?? {});
    }
    const response = await dispatch(new Request(`${APEX}${route.path}`, init), env);
    return {
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      vary: response.headers.get('vary'),
    };
  } finally {
    upstream.restore();
  }
}

describe('every /api route answers with a cache directive, and it is no-store unless the route said otherwise', () => {
  const seen = new Map();

  /* `/api/*` ONLY, which is the contract this file is named for and the exact
     guard withApiCacheHeaders() opens with. targets.mjs ROUTES grew past the
     API in 2026-09 to name three server-rendered PAGES as well (/events/<slug>,
     /ask/s/<token>, the STUC migrate page); those answer HTML through the page
     cache and asserting no-store on them would be pinning the opposite of what
     the middleware deliberately does. */
  const apiRoutes = ROUTES.filter((route) => route.path === '/api' || route.path.startsWith('/api/'));

  before(async () => {
    for (const route of apiRoutes) {
      seen.set(`${route.method} ${route.path}`, await send(route));
    }
  });

  it('sweeps every route the target table names, so this is not one endpoint standing in for 56', () => {
    assert.ok(apiRoutes.length >= 50, `${apiRoutes.length} routes swept; the target table is meant to be the whole API surface`);
    assert.equal(seen.size, new Set(apiRoutes.map((r) => `${r.method} ${r.path}`)).size);
  });

  it('never leaves a response with no Cache-Control at all -- the RRMA-RT-3 shape', () => {
    const bare = [...seen].filter(([, observed]) => !observed.cacheControl).map(([name]) => name);
    assert.deepEqual(bare, [], `these answered with no cache directive:\n  ${bare.join('\n  ')}`);
  });

  it('answers no-store everywhere a route did not declare its own policy', () => {
    const wrong = [...seen]
      .filter(([name, observed]) => {
        const path = name.slice(name.indexOf(' ') + 1);
        return !DELIBERATELY_CACHEABLE.has(path) && !/no-store/.test(observed.cacheControl || '');
      })
      .map(([name, observed]) => `${name} -> ${observed.cacheControl}`);
    assert.deepEqual(wrong, [], `these are cacheable and did not ask to be:\n  ${wrong.join('\n  ')}`);
  });

  it('carries Vary: Cookie on the no-store arm, so a cache keyed before the cookie cannot reuse an entry', () => {
    const missing = [...seen]
      .filter(([name, observed]) => {
        const path = name.slice(name.indexOf(' ') + 1);
        if (DELIBERATELY_CACHEABLE.has(path)) return false;
        if (!/no-store/.test(observed.cacheControl || '')) return false;
        return !/(^|,)\s*cookie\s*(,|$)/i.test(observed.vary || '');
      })
      .map(([name, observed]) => `${name} -> vary: ${observed.vary}`);
    assert.deepEqual(missing, [], `these depend on the session and do not say so:\n  ${missing.join('\n  ')}`);
  });

  it('leaves a route that declared its own caching alone -- no-store is the default, not an override', async () => {
    for (const [path, matcher] of DELIBERATELY_CACHEABLE) {
      const observed = await send({ path, method: 'GET' });
      assert.match(
        observed.cacheControl || '',
        matcher,
        `${path} lost its own Cache-Control; flattening it to no-store is a bandwidth regression, not hardening`
      );
      assert.ok(
        !/no-store/.test(observed.cacheControl || ''),
        `${path} was flattened to no-store despite declaring a policy`
      );
      assert.ok(
        !/cookie/i.test(observed.vary || ''),
        `${path} gained Vary: Cookie, which destroys exactly the shared caching it asked for`
      );
    }
  });

  it('leaves a non-API Function response untouched, so the page cache is not collateral', async () => {
    const { env } = await redteamEnv();
    const upstream = installUpstream();
    try {
      const response = await dispatch(new Request(`${APEX}/health`, { method: 'GET' }), env);
      assert.ok(
        !/cookie/i.test(response.headers.get('vary') || ''),
        'the /api/* contract must not reach past /api/*'
      );
    } finally {
      upstream.restore();
    }
  });
});
