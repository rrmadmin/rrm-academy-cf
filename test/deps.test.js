/**
 * THE DEPENDENCY GATE, PROVEN ABLE TO FAIL. `scripts/redteam/deps.mjs` runs
 * live in the CI fast gate; this file runs its POLICY over fixtures with no
 * network, and checks every direction the gate claims to fire in:
 *
 *   - the real capture from 2026-09-06 BLOCKS the one advisory this repo
 *     cannot clear by bumping (sharp 0.34.5, pulled in as astro's own
 *     optionalDependency) and WARNS the eight it has judged not worth a
 *     release. The capture was taken AFTER the seven other blocking
 *     advisories were fixed by bumping js-yaml, nanoid, postcss and svgo in
 *     the same commit, so the one that remains is the honest state of the
 *     lockfile rather than a fixture chosen to be red.
 *   - a CISA KEV entry BLOCKS even at LOW severity with no fix
 *   - EPSS at the threshold BLOCKS, just under it does not
 *   - an unexpired acceptance turns a BLOCK into KNOWN; an expired one
 *     BLOCKS again with the expiry in its reasons
 *   - a clean run is clean
 *   - the fixed version reported is the one for the INSTALLED major
 *   - dev-only lockfile entries never reach the query
 *
 * A check that cannot fail is a decoration (skills: checks-that-can-fail).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compareVersions, fixedVersionOf, judge, productionPackages, severityOf, tally } from '../scripts/redteam/deps.mjs';

const captured = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'redteam-deps', 'captured-2026-09-06.json'), 'utf8'));

function vuln(id, { cve = null, severity = 'LOW', fixed = null, name = 'pkg' } = {}) {
  return {
    id,
    aliases: cve ? [cve] : [],
    summary: `synthetic ${id}`,
    database_specific: { severity },
    affected: [{ package: { name, ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, ...(fixed ? [{ fixed }] : [])] }] }],
  };
}

function data({ hits, vulns, epss = {}, kev = [] }) {
  return { collectedAt: 'fixture', packages: [], hits, vulns, epss, kev };
}

test('the 2026-09-06 capture blocks the advisory a bump cannot clear', () => {
  /* judge() with no `accepted` argument on purpose: this asserts the POLICY,
     not the acceptance file. The live run reports the same advisory as KNOWN
     because deps-accepted.json carries it until 2026-10-06 with a written
     reason, and that expiry is what stops the acceptance becoming permanent. */
  const verdicts = judge(captured);
  assert.deepEqual(tally(verdicts), { BLOCK: 1, KNOWN: 0, WARN: 8 });
  const blocked = new Set(verdicts.filter((v) => v.outcome === 'BLOCK').map((v) => `${v.name}@${v.version}`));
  assert.deepEqual([...blocked].sort(), ['sharp@0.34.5']);
});

test('the acceptance file turns that same capture green, and only that one', () => {
  const accepted = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'scripts', 'redteam', 'deps-accepted.json'), 'utf8'));
  const verdicts = judge(captured, { now: new Date('2026-09-06T00:00:00Z'), accepted });
  assert.deepEqual(tally(verdicts), { BLOCK: 0, KNOWN: 1, WARN: 8 });

  /* The same capture judged after every acceptance has expired. If this
     stopped blocking, the acceptance would have quietly become permanent,
     which is the one thing an acceptance may never be. */
  const later = judge(captured, { now: new Date('2027-01-01T00:00:00Z'), accepted });
  assert.deepEqual(tally(later), { BLOCK: 1, KNOWN: 0, WARN: 8 });
});

test('a KEV entry blocks regardless of severity or fix', () => {
  const verdicts = judge(
    data({
      hits: [{ name: 'pkg', version: '1.0.0', id: 'GHSA-kev' }],
      vulns: { 'GHSA-kev': vuln('GHSA-kev', { cve: 'CVE-2020-0001', severity: 'LOW' }) },
      kev: ['CVE-2020-0001'],
    })
  );
  assert.equal(verdicts[0].outcome, 'BLOCK');
  assert.match(verdicts[0].reasons.join(), /KEV/);
});

test('EPSS at the threshold blocks, just under it warns', () => {
  const make = (epss) =>
    data({
      hits: [{ name: 'pkg', version: '1.0.0', id: 'GHSA-epss' }],
      vulns: { 'GHSA-epss': vuln('GHSA-epss', { cve: 'CVE-2020-0002', severity: 'MODERATE' }) },
      epss: { 'CVE-2020-0002': epss },
    });
  assert.equal(judge(make(0.1))[0].outcome, 'BLOCK');
  assert.equal(judge(make(0.099))[0].outcome, 'WARN');
  assert.equal(judge(make(0.099), { epssThreshold: 0.05 })[0].outcome, 'BLOCK');
});

test('HIGH with a fix blocks; HIGH with no fix yet warns', () => {
  const make = (fixed) =>
    data({
      hits: [{ name: 'pkg', version: '1.0.0', id: 'GHSA-high' }],
      vulns: { 'GHSA-high': vuln('GHSA-high', { severity: 'HIGH', fixed }) },
    });
  assert.equal(judge(make('1.0.1'))[0].outcome, 'BLOCK');
  assert.equal(judge(make(null))[0].outcome, 'WARN');
});

test('an acceptance downgrades a BLOCK to KNOWN until it expires, then blocks again', () => {
  const d = data({
    hits: [{ name: 'pkg', version: '1.0.0', id: 'GHSA-acc' }],
    vulns: { 'GHSA-acc': vuln('GHSA-acc', { severity: 'CRITICAL', fixed: '2.0.0' }) },
  });
  const now = new Date('2026-09-06T00:00:00Z');
  const live = judge(d, { now, accepted: [{ id: 'GHSA-acc', reason: 'major bump scheduled', until: '2026-10-01' }] });
  assert.equal(live[0].outcome, 'KNOWN');
  assert.equal(live[0].acceptance.reason, 'major bump scheduled');

  const expired = judge(d, { now, accepted: [{ id: 'GHSA-acc', reason: 'major bump scheduled', until: '2026-09-01' }] });
  assert.equal(expired[0].outcome, 'BLOCK');
  assert.match(expired[0].reasons.join(), /acceptance expired 2026-09-01/);

  const garbage = judge(d, { now, accepted: [{ id: 'GHSA-acc', reason: 'x', until: 'never' }] });
  assert.equal(garbage[0].outcome, 'BLOCK', 'an unparseable expiry must not read as forever');
});

test('a clean run is clean', () => {
  assert.deepEqual(tally(judge(data({ hits: [], vulns: {} }))), { BLOCK: 0, KNOWN: 0, WARN: 0 });
});

test('the fixed version is the one for the installed major, not the first range in the file', () => {
  const v = {
    affected: [
      {
        package: { name: 'next' },
        ranges: [
          { type: 'SEMVER', events: [{ introduced: '15.0.0' }, { fixed: '15.5.21' }] },
          { type: 'SEMVER', events: [{ introduced: '16.0.0' }, { fixed: '16.2.11' }] },
        ],
      },
    ],
  };
  assert.equal(fixedVersionOf(v, 'next', '16.2.6'), '16.2.11');
  assert.equal(fixedVersionOf(v, 'next', '15.1.0'), '15.5.21');
  assert.equal(fixedVersionOf(v, 'next', '14.0.0'), '15.5.21', 'outside every range falls back to the first fix');
  assert.equal(fixedVersionOf(v, 'other', '16.2.6'), null);
  assert.equal(compareVersions('16.2.6', '16.2.11'), -1);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
});

test('severity prefers the GitHub review and falls back to a numeric CVSS', () => {
  assert.equal(severityOf({ database_specific: { severity: 'high' } }), 'HIGH');
  assert.equal(severityOf({ severity: [{ type: 'CVSS_V3', score: 9.8 }] }), 'CRITICAL');
  assert.equal(severityOf({ severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N' }] }), 'UNKNOWN', 'a vector without a number is not guessed');
});

test('dev-only lockfile entries never reach the query; nested copies do', () => {
  const lock = {
    packages: {
      '': { name: 'root' },
      'node_modules/a': { version: '1.0.0' },
      'node_modules/b': { version: '2.0.0', dev: true },
      'node_modules/a/node_modules/c': { version: '3.0.0' },
      'node_modules/c': { version: '3.1.0' },
    },
  };
  assert.deepEqual(productionPackages(lock), [
    { name: 'a', version: '1.0.0' },
    { name: 'c', version: '3.0.0' },
    { name: 'c', version: '3.1.0' },
  ]);
});

test('the real lockfile has no accepted entries that are silently permanent', () => {
  const accepted = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'scripts', 'redteam', 'deps-accepted.json'), 'utf8'));
  for (const entry of accepted) {
    assert.ok(entry.id && entry.reason && entry.until, `deps-accepted.json entry needs id, reason, until: ${JSON.stringify(entry)}`);
    assert.ok(Number.isFinite(new Date(entry.until).getTime()), `deps-accepted.json ${entry.id}: until must be a date`);
  }
});
