#!/usr/bin/env node
/**
 * THE DEPENDENCY FAMILY OF THE RED-TEAM HARNESS. Every other family in
 * `cases.mjs` attacks OUR code with a request. This one asks whether the
 * code we did not write, the production half of `package-lock.json`, is
 * carrying a vulnerability an attacker would not need a request to find.
 *
 * WHY NOT `npm audit`. It has no notion of exploitability, so a dev-only
 * ReDoS and a middleware bypass with a public exploit both print "high",
 * and a gate that fails on either gets muted within a week. This script
 * ranks with the two signals that actually predict exploitation:
 *
 *   CISA KEV   the Known Exploited Vulnerabilities catalogue. Membership
 *              means someone is exploiting it in the wild today. A KEV hit
 *              BLOCKS regardless of anything else.
 *   EPSS       FIRST's exploit-prediction score, the probability of
 *              exploitation in the next 30 days. Above the threshold BLOCKS.
 *
 * and only then with severity: a HIGH or CRITICAL advisory whose fix is
 * already published BLOCKS too, because "we knew, a fix existed, we
 * shipped anyway" is the sentence nobody wants to read in an incident
 * report about a site that holds patient contact details. Everything else
 * is a WARN, printed on every run and never hidden.
 *
 * DATA SOURCES, ALL PUBLIC, NO KEYS:
 *   OSV.dev   /v1/querybatch for the hit list, /v1/vulns/<id> for detail
 *   FIRST     /data/v1/epss?cve=...
 *   CISA      known_exploited_vulnerabilities.json
 *
 * TWO MODES, ONE POLICY.
 *   live       queries the three sources. Runs in the CI fast gate on every
 *              push, because a lockfile only changes on a commit, so the
 *              commit is the right cadence (Brian's rule: targeted gates,
 *              no nightly sweeps). A source that cannot be reached FAILS
 *              the run: a gate that passes on an outage is not a gate.
 *   fixture    replays a captured response set (`--capture` writes one,
 *              `--fixture` reads one). No network. `test/deps.test.js`
 *              proves through fixtures that the policy fires in every
 *              direction it claims to.
 *
 * ACCEPTING A FINDING. `scripts/redteam/deps-accepted.json` lists advisory
 * ids with a reason and an expiry date. An accepted BLOCK reports as KNOWN,
 * exactly as a `known:` marker does in `cases.mjs`. An expired acceptance
 * BLOCKS again, so an acceptance cannot quietly become permanent.
 *
 * Usage:
 *   node scripts/redteam/deps.mjs
 *   node scripts/redteam/deps.mjs --capture docs/redteam/deps-capture.json
 *   node scripts/redteam/deps.mjs --fixture test/fixtures/redteam-deps/blocked.json
 *   node scripts/redteam/deps.mjs --epss-threshold 0.05 --json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

export const SOURCES = {
  osvBatch: 'https://api.osv.dev/v1/querybatch',
  osvVuln: 'https://api.osv.dev/v1/vulns/',
  epss: 'https://api.first.org/data/v1/epss?cve=',
  kev: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
};

export const DEFAULTS = {
  epssThreshold: 0.1,
  lockfile: join(ROOT, 'package-lock.json'),
  accepted: join(HERE, 'deps-accepted.json'),
};

// --------------------------------------------------------------------------
// Lockfile -> production package list.
// --------------------------------------------------------------------------

/**
 * Every non-dev entry in lockfile v2/v3 `packages`, deduplicated on
 * name@version. Nested copies (`node_modules/a/node_modules/b`) count: an
 * attacker reaches the nested copy exactly as easily as the hoisted one.
 */
export function productionPackages(lock) {
  const seen = new Map();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path || entry.dev || !entry.version) continue;
    const name = path.split('node_modules/').pop();
    seen.set(`${name}@${entry.version}`, { name, version: entry.version });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

// --------------------------------------------------------------------------
// Fetching. Every call goes through `fetchJson` so a fixture can stand in
// for the network and so an unreachable source fails loudly.
// --------------------------------------------------------------------------

async function fetchJson(url, init) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new Error(`deps: ${url} unreachable: ${String(err?.message ?? err).slice(0, 120)}`);
  }
  if (!response.ok) throw new Error(`deps: ${url} answered ${response.status}`);
  return response.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Pull everything the policy needs, from the network, into one plain object
 * that `--capture` can write and `--fixture` can replay.
 */
export async function collect(packages) {
  const batch = await fetchJson(SOURCES.osvBatch, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ queries: packages.map((p) => ({ package: { name: p.name, ecosystem: 'npm' }, version: p.version })) }),
  });
  const results = batch.results ?? [];
  if (results.length !== packages.length) {
    throw new Error(`deps: OSV answered ${results.length} results for ${packages.length} queries`);
  }

  const hits = [];
  results.forEach((result, i) => {
    for (const vuln of result.vulns ?? []) hits.push({ ...packages[i], id: vuln.id });
  });

  const ids = [...new Set(hits.map((h) => h.id))];
  const vulns = {};
  await mapLimit(ids, 6, async (id) => {
    vulns[id] = await fetchJson(SOURCES.osvVuln + encodeURIComponent(id));
  });

  const cves = [...new Set(Object.values(vulns).flatMap((v) => cveIdsOf(v)))];
  const epss = {};
  for (let i = 0; i < cves.length; i += 50) {
    const slice = cves.slice(i, i + 50);
    const answer = await fetchJson(SOURCES.epss + slice.join(','));
    for (const row of answer.data ?? []) epss[row.cve] = Number(row.epss);
  }

  const kevFeed = await fetchJson(SOURCES.kev);
  const kev = (kevFeed.vulnerabilities ?? []).map((v) => v.cveID).filter((id) => cves.includes(id));

  return { collectedAt: new Date().toISOString(), packages, hits, vulns, epss, kev };
}

// --------------------------------------------------------------------------
// Reading an OSV record.
// --------------------------------------------------------------------------

export function cveIdsOf(vuln) {
  const ids = new Set();
  if (/^CVE-/.test(vuln.id ?? '')) ids.add(vuln.id);
  for (const alias of vuln.aliases ?? []) if (/^CVE-/.test(alias)) ids.add(alias);
  return [...ids];
}

/** HIGH / CRITICAL / MODERATE / LOW / UNKNOWN, preferring GitHub's review over a raw CVSS vector. */
export function severityOf(vuln) {
  const reviewed = vuln.database_specific?.severity;
  if (reviewed) return String(reviewed).toUpperCase();
  for (const s of vuln.severity ?? []) {
    const base = cvssBase(s.score);
    if (base == null) continue;
    if (base >= 9) return 'CRITICAL';
    if (base >= 7) return 'HIGH';
    if (base >= 4) return 'MODERATE';
    return 'LOW';
  }
  return 'UNKNOWN';
}

/** The numeric base score, when OSV stored one instead of a vector. */
function cvssBase(score) {
  if (typeof score === 'number') return score;
  const n = Number(score);
  return Number.isFinite(n) ? n : null;
}

/**
 * The `fixed` version of the range that CONTAINS this package version, or
 * null when nothing fixes it yet. An advisory usually lists one range per
 * supported major (next 15.5.21 and 16.2.11 for the same bug), and the
 * first one in the file is the wrong answer for a 16.x install.
 */
export function fixedVersionOf(vuln, packageName, version) {
  let fallback = null;
  for (const affected of vuln.affected ?? []) {
    if (affected.package?.name !== packageName) continue;
    for (const range of affected.ranges ?? []) {
      let introduced = '0';
      for (const event of range.events ?? []) {
        if (event.introduced != null) introduced = event.introduced;
        if (!event.fixed) continue;
        fallback ??= event.fixed;
        if (version && compareVersions(version, introduced) >= 0 && compareVersions(version, event.fixed) < 0) return event.fixed;
      }
    }
  }
  return fallback;
}

/** Enough semver to order release versions; a prerelease sorts below its release. */
export function compareVersions(a, b) {
  const pa = String(a).split('-'), pb = String(b).split('-');
  const na = pa[0].split('.').map(Number), nb = pb[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (na[i] || 0) - (nb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (pa[1] && !pb[1]) return -1;
  if (!pa[1] && pb[1]) return 1;
  return 0;
}

// --------------------------------------------------------------------------
// Policy.
// --------------------------------------------------------------------------

/**
 * One verdict per (package, advisory).
 *
 *   BLOCK  KEV, or EPSS at/over the threshold, or HIGH/CRITICAL with a fix
 *          published. Exit non-zero.
 *   KNOWN  a BLOCK carried by an unexpired acceptance. Printed, never hidden.
 *   WARN   everything else OSV knows about. Printed, exit zero.
 */
export function judge(data, { epssThreshold = DEFAULTS.epssThreshold, accepted = [], now = new Date() } = {}) {
  const kev = new Set(data.kev ?? []);
  const acceptedById = new Map();
  for (const entry of accepted) acceptedById.set(entry.id, entry);

  const verdicts = [];
  for (const hit of data.hits) {
    const vuln = data.vulns[hit.id];
    if (!vuln) throw new Error(`deps: fixture has no record for ${hit.id}`);
    const cves = cveIdsOf(vuln);
    const epss = Math.max(0, ...cves.map((c) => data.epss?.[c] ?? 0));
    const inKev = cves.some((c) => kev.has(c));
    const severity = severityOf(vuln);
    const fixed = fixedVersionOf(vuln, hit.name, hit.version);

    const reasons = [];
    if (inKev) reasons.push('in CISA KEV');
    if (epss >= epssThreshold) reasons.push(`EPSS ${epss.toFixed(3)} >= ${epssThreshold}`);
    if ((severity === 'HIGH' || severity === 'CRITICAL') && fixed) reasons.push(`${severity} with fix ${fixed}`);

    let outcome = reasons.length ? 'BLOCK' : 'WARN';
    let acceptance = null;
    if (outcome === 'BLOCK') {
      const entry = acceptedById.get(hit.id) ?? acceptedById.get(`${hit.name}:${hit.id}`);
      if (entry) {
        const until = new Date(entry.until);
        if (Number.isFinite(until.getTime()) && until > now) {
          outcome = 'KNOWN';
          acceptance = entry;
        } else {
          reasons.push(`acceptance expired ${entry.until}`);
        }
      }
    }

    verdicts.push({
      name: hit.name,
      version: hit.version,
      id: hit.id,
      cves,
      severity,
      epss,
      kev: inKev,
      fixed,
      outcome,
      reasons,
      acceptance,
      summary: String(vuln.summary ?? '').slice(0, 120),
    });
  }
  return verdicts.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function rank(v) {
  return { BLOCK: 3, KNOWN: 2, WARN: 1 }[v.outcome] ?? 0;
}

export function tally(verdicts) {
  const t = { BLOCK: 0, KNOWN: 0, WARN: 0 };
  for (const v of verdicts) t[v.outcome] = (t[v.outcome] ?? 0) + 1;
  return t;
}

// --------------------------------------------------------------------------
// Reporting.
// --------------------------------------------------------------------------

export function grid(verdicts, { packages = 0, collectedAt = '' } = {}) {
  const lines = [];
  lines.push(`deps: ${packages} production packages, ${verdicts.length} advisories (${collectedAt || 'fixture'})`);
  if (!verdicts.length) lines.push('  clean');
  for (const v of verdicts) {
    const flags = [v.severity, v.kev ? 'KEV' : null, `epss ${v.epss.toFixed(3)}`, v.fixed ? `fix ${v.fixed}` : 'no fix'].filter(Boolean).join(', ');
    lines.push(`  ${v.outcome.padEnd(5)} ${v.name}@${v.version}  ${v.id}  [${flags}]`);
    if (v.reasons.length) lines.push(`        ${v.reasons.join('; ')}`);
    if (v.acceptance) lines.push(`        accepted until ${v.acceptance.until}: ${v.acceptance.reason}`);
  }
  const t = tally(verdicts);
  lines.push(`deps: ${t.BLOCK} BLOCK, ${t.KNOWN} KNOWN, ${t.WARN} WARN`);
  return lines.join('\n');
}

export function markdown(verdicts, meta) {
  const t = tally(verdicts);
  const rows = verdicts.map((v) =>
    `| ${v.outcome} | \`${v.name}@${v.version}\` | ${v.id} | ${v.cves.join(', ') || '-'} | ${v.severity} | ${v.kev ? 'yes' : 'no'} | ${v.epss.toFixed(3)} | ${v.fixed ?? '-'} | ${v.reasons.join('; ') || '-'} |`
  );
  return [
    `# Red team: dependencies (${meta.collectedAt || 'fixture'})`,
    '',
    `${meta.packages} production packages from \`package-lock.json\`, ${verdicts.length} advisories. ${t.BLOCK} BLOCK, ${t.KNOWN} KNOWN, ${t.WARN} WARN.`,
    '',
    '| Outcome | Package | Advisory | CVE | Severity | KEV | EPSS | Fixed in | Reasons |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

// --------------------------------------------------------------------------
// CLI.
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { epssThreshold: DEFAULTS.epssThreshold, lockfile: DEFAULTS.lockfile, accepted: DEFAULTS.accepted, report: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--fixture') args.fixture = next();
    else if (a === '--capture') args.capture = next();
    else if (a === '--lockfile') args.lockfile = next();
    else if (a === '--accepted') args.accepted = next();
    else if (a === '--epss-threshold') args.epssThreshold = Number(next());
    else if (a === '--json') args.json = true;
    else if (a === '--no-report') args.report = false;
    else throw new Error(`deps: unknown argument ${a}`);
  }
  if (!Number.isFinite(args.epssThreshold) || args.epssThreshold < 0 || args.epssThreshold > 1) {
    throw new Error('deps: --epss-threshold must be between 0 and 1');
  }
  return args;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (fallback !== undefined && err?.code === 'ENOENT') return fallback;
    throw new Error(`deps: ${path} could not be read as JSON: ${String(err?.message ?? err).slice(0, 120)}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const accepted = readJson(args.accepted, []);

  let data;
  if (args.fixture) {
    data = readJson(args.fixture);
  } else {
    const lock = readJson(args.lockfile);
    data = await collect(productionPackages(lock));
    if (args.capture) {
      mkdirSync(dirname(args.capture), { recursive: true });
      writeFileSync(args.capture, JSON.stringify(data, null, 2) + '\n');
    }
  }

  const verdicts = judge(data, { epssThreshold: args.epssThreshold, accepted });
  const meta = { packages: data.packages.length, collectedAt: data.collectedAt };

  if (args.json) console.log(JSON.stringify({ meta, verdicts }, null, 2));
  else console.log(grid(verdicts, meta));

  if (args.report && !args.fixture) {
    const day = new Date().toISOString().slice(0, 10);
    const out = join(ROOT, 'docs', 'redteam', `${day}-deps.md`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, markdown(verdicts, meta));
  }

  return tally(verdicts).BLOCK === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(String(err?.message ?? err));
      process.exit(2);
    }
  );
}
