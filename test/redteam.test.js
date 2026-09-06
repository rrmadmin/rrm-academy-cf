/**
 * THE RED-TEAM HARNESS, RUN AS A TEST, on every pull request and on every
 * claude/** auto-merge.
 *
 * `scripts/redteam/run.mjs --mode hermetic` sends all 150 attack cases at the
 * real Pages Functions in process -- through the real `functions/_middleware.js`
 * and, for /api/admin/*, the real admin middleware -- and compares each answer
 * with what `scripts/redteam/cases.mjs` says it must be. This file is the
 * wiring that makes a FAIL there a red CI run here, in about two seconds, with
 * no network, no credentials and no live data.
 *
 * WHY A TEST AND NOT ONLY A SCRIPT. A script an operator remembers to run is a
 * script that stops being run. The 4,300 unit tests beside this one pin each
 * control where it lives; this pins the controls as an ATTACKER meets them,
 * composed, in the order a request really passes through them. That is the
 * class of defect a per-module test cannot see: a gate that is correct and
 * unreachable, a refusal that is correct and leaks in its body, a validator
 * that is correct and runs after the money has been spent.
 *
 * A KNOWN CASE THAT STARTS PASSING FAILS THIS FILE, deliberately. `known`
 * marks a failure that has been adjudicated and is waiting on a fix elsewhere;
 * once the fix lands, the marker is a lie that would hide the NEXT regression
 * of the same case behind a green KNOWN. Deleting the marker is one line and
 * the assertion below says so by name.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { run, grid, tally } from '../scripts/redteam/run.mjs';
import { CASES, FAMILIES, countByFamily } from '../scripts/redteam/cases.mjs';
import { HOSTS, IDENTITIES, ROUTES } from '../scripts/redteam/targets.mjs';
import { knownPaths, matchRoute } from '../scripts/redteam/fakes/dispatch.mjs';

const results = await run({ mode: 'hermetic', report: false });

test('every attack case answers what the table says it must', () => {
  const failures = results.filter((result) => result.outcome === 'FAIL');
  assert.equal(
    failures.length,
    0,
    `${failures.length} red-team case(s) failed. A FAIL is a finding: read it, fix the code, or adjudicate it with a known id and a written note. Never soften the expectation.\n${grid(results)}`
  );
});

/**
 * A case that is hermetically SKIPPED is exempt: RRMA-RT-3 is a
 * platform-layer finding (an `_headers` rule that never reaches a Function
 * response), which only the live run can observe, so its hermetic outcome is
 * SKIP by construction and asserting KNOWN here would fail on a truth about
 * the harness rather than about the site.
 */
test('a case marked known is still failing, so the marker is not stale', () => {
  for (const result of results.filter((one) => one.known && one.outcome !== 'SKIP')) {
    assert.equal(
      result.outcome,
      'KNOWN',
      `${result.id} carries known:'${result.known}' but now ${result.outcome}S. If the finding is fixed, delete the known marker and its knownNote from scripts/redteam/cases.mjs so a future regression of this case fails the run.`
    );
  }
});

test('nothing is skipped hermetically except for a written platform reason', () => {
  for (const result of results.filter((one) => one.outcome === 'SKIP')) {
    assert.ok(
      result.hermetic?.skip,
      `${result.id} skipped hermetically without declaring why (${result.reasons?.[0]}). Hermetic mode mints every identity it needs, so an undeclared SKIP is a harness fault rather than a missing credential.`
    );
  }
});

test('every family declared is a family exercised', () => {
  const counts = countByFamily();
  for (const family of Object.keys(FAMILIES)) {
    assert.ok(counts[family] > 0, `family ${family} is named but has no cases`);
  }
  for (const family of Object.keys(counts)) {
    assert.ok(FAMILIES[family], `family ${family} has cases but no description in FAMILIES`);
  }
});

test('the case table is structurally sound', () => {
  const seen = new Set();
  for (const kase of CASES) {
    assert.ok(!seen.has(kase.id), `duplicate case id ${kase.id}`);
    seen.add(kase.id);
    assert.ok(IDENTITIES[kase.as], `${kase.id} is sent as an identity the target does not name: ${kase.as}`);
    assert.ok(HOSTS[kase.host], `${kase.id} is sent to a host the target does not name: ${kase.host}`);
    assert.ok(
      kase.expect || kase.scenario || (kase.hermetic?.skip && kase.live?.expect),
      `${kase.id} declares neither an expectation nor a scenario, and is not a live-only case with a written hermetic skip`
    );
    assert.ok(kase.description, `${kase.id} has no description, so a report of it would say nothing`);
    assert.ok(kase.family, `${kase.id} belongs to no family`);
    if (kase.known) assert.ok(kase.knownNote, `${kase.id} is marked known with no adjudication note`);
    if (!kase.scenario && !kase.hermetic?.skip) {
      assert.ok(kase.live, `${kase.id} says nothing about live mode; declare live.expect or live.skip with a reason`);
    }
  }
});

/**
 * The sweep families enumerate `targets.mjs` ROUTES, and the dispatcher routes
 * by a table that mirrors the file tree. A route named in one and missing from
 * the other is the failure that makes a sweep silently stop sweeping, so it is
 * held here by name rather than discovered as a green run over nothing.
 */
test('every route the target names is a route the dispatcher can reach', () => {
  for (const route of ROUTES) {
    assert.ok(
      matchRoute(route.path),
      `${route.path} is in targets.mjs ROUTES but has no entry in the dispatch route table (scripts/redteam/fakes/dispatch.mjs)`
    );
  }
  /* Compared on PATHS, not on rows: ROUTES carries one row per method, and a
     single dispatch entry serves every method a module exports. */
  const targetPaths = new Set(ROUTES.map((route) => route.path));
  assert.ok(
    knownPaths().length >= targetPaths.size,
    `the dispatch table knows ${knownPaths().length} paths, fewer than the ${targetPaths.size} distinct paths targets.mjs attacks`
  );
});

test('the suite is worth its runtime: the counts are what the brief asked for', () => {
  const counts = tally(results);
  assert.ok(results.length >= 100 && results.length <= 150, `${results.length} cases; the brief asked for a targeted 100 to 150`);
  assert.equal(counts.PASS + counts.KNOWN + counts.SKIP, results.length, 'every case ended in PASS, KNOWN or SKIP');
  for (const family of Object.keys(FAMILIES)) {
    assert.ok(countByFamily()[family] >= 10, `family ${family} has only ${countByFamily()[family]} cases, which is thin for a family this brief names`);
  }
});
