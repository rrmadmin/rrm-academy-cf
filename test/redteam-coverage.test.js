/**
 * THE SELF-CHECK ON THE HARNESS ITSELF: does it know about every door?
 *
 * `test/redteam.test.js` proves that the cases which exist all pass. That is
 * a claim about the code. This file makes the OTHER claim, the one a green
 * suite otherwise hides: that the case table covers the site. Pages routes on
 * the file tree, so the tree is the authority on what exists -- and a handler
 * committed with no case and no exemption is a door this harness has never
 * knocked on, which looks exactly like a door it knocked on and found shut.
 *
 * WHY THIS TEST EXISTS AT ALL. Before it, `functions/` held 121 routes and
 * the harness aimed cases at 44. The 77 it missed were not the boring ones:
 * they included every machine lane (the newsletter sender, the deploy
 * recorder, the bounce handler), the paid course platform's entitlement
 * doors, six member-gated community writes, and every public endpoint that
 * takes a query and spends an upstream call. Nothing was failing. Nothing
 * could fail, because nothing was being asked.
 *
 * THE EXEMPTION LIST IS THE PRESSURE VALVE AND IT HAS A RULE, written in
 * scripts/redteam/coverage.mjs: a route may be exempt only when no input an
 * attacker controls reaches a database, a bill, a mailbox or another
 * person's data. An exemption is a decision somebody wrote down and can be
 * argued with. A gap is nobody's decision at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handlerRoutes, pathMatchesRoute, OUT_OF_SCOPE } from '../scripts/redteam/coverage.mjs';
import { CASES } from '../scripts/redteam/cases.mjs';
import { ROUTES } from '../scripts/redteam/targets.mjs';
import { matchRoute } from '../scripts/redteam/fakes/dispatch.mjs';

const routes = handlerRoutes();
const covered = (route) => CASES.some((kase) => pathMatchesRoute(kase.path, route));

test('the file tree really is being enumerated, not an empty directory', () => {
  /* A scan that finds nothing passes every assertion below it. This is the
     floor that makes the rest of the file mean something. */
  assert.ok(routes.length > 100, `only ${routes.length} routes found under functions/; the scan is broken, not the tree`);
  assert.ok(routes.includes('/api/auth/login'), 'the scan did not find a route this harness demonstrably attacks');
});

test('every route Pages serves has a case aimed at it, or a written exemption', () => {
  const gaps = routes.filter((route) => !covered(route) && !OUT_OF_SCOPE[route]);
  assert.deepEqual(
    gaps,
    [],
    `${gaps.length} handler(s) under functions/ have no red-team case and no exemption. Add a case in scripts/redteam/cases.mjs (usually by adding the route to targets.mjs ROUTES, which puts it inside the generated sweeps), or add it to OUT_OF_SCOPE in scripts/redteam/coverage.mjs with the reason it is one:\n  ${gaps.join('\n  ')}`
  );
});

test('no exemption outlives the route it exempts', () => {
  for (const route of Object.keys(OUT_OF_SCOPE)) {
    assert.ok(
      routes.includes(route),
      `${route} is exempt in coverage.mjs but no longer exists under functions/. Delete the exemption; a stale one quietly widens the next time a file is added at that path.`
    );
  }
});

test('an exemption is a sentence, not a shrug', () => {
  for (const [route, reason] of Object.entries(OUT_OF_SCOPE)) {
    assert.ok(reason.length >= 60, `the exemption for ${route} is too short to be a reason: ${JSON.stringify(reason)}`);
    for (const shrug of ['n/a', 'todo', 'later', 'not important', 'low risk']) {
      assert.ok(
        !reason.toLowerCase().includes(shrug),
        `the exemption for ${route} says ${JSON.stringify(shrug)}, which is a deferral rather than a reason`
      );
    }
  }
});

test('a route is not exempt AND attacked at the same time', () => {
  for (const route of Object.keys(OUT_OF_SCOPE)) {
    assert.ok(
      !covered(route),
      `${route} carries an exemption and also has cases aimed at it. Delete the exemption: it is now claiming something untrue about the harness.`
    );
  }
});

test('every route the target table names is reachable by the dispatcher', () => {
  for (const route of ROUTES) {
    assert.ok(
      matchRoute(route.path),
      `${route.path} is in targets.mjs ROUTES but has no entry in the dispatch route table (scripts/redteam/fakes/dispatch.mjs)`
    );
  }
});
