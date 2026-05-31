#!/usr/bin/env node
/**
 * validate-courses-schema.mjs — Deterministic proof-gate runner that keeps the
 * committed course schema in lockstep with (a) what the application code accepts
 * and (b) the live D1 `rrm-auth` schema.
 *
 * Born 2026-05-28 from the `access_type='members'` drift: the live `course`
 * table's CHECK constraint and the admin endpoints' VALID_ACCESS_TYPES Set both
 * allowed 'members', but the committed migration (`migrate-courses-to-d1.sql`)
 * silently lagged behind and still only listed ('public','private'). Three
 * /arise --deep tracers read the stale committed file and rated it HIGH; it was
 * a real drift with low real impact, but nothing existed to catch it. This gate
 * does.
 *
 * It does NOT diff DDL text (whitespace / IF NOT EXISTS / formatting noise).
 * It parses CHECK value-sets and column names from both sides and compares them
 * as sets — so it fails on genuine divergence, not on cosmetic reformatting.
 *
 * Gates:
 *   CS1  Static (no network):  migration CHECK value-sets  ==  app VALID_* Sets
 *        + the duplicated VALID_* Sets across the admin endpoints agree.
 *   CS2  Live (network):       migration columns + CHECK value-sets  ==  live D1.
 *        A query/auth/network failure WARN-skips (never fails) — only a detected
 *        drift fails — so this can't become a flaky deploy-blocker and runs
 *        everywhere (warn-skips where D1 is unreachable, runs for real in CI).
 *
 * Usage:
 *   node scripts/gates/validate-courses-schema.mjs            # CS1 + CS2
 *   node scripts/gates/validate-courses-schema.mjs --quick    # CS1 only (no network)
 *   node scripts/gates/validate-courses-schema.mjs --gate CS1 # specific gate
 *   node scripts/gates/validate-courses-schema.mjs --json     # machine-readable
 *
 * Exit codes:
 *   0  all run gates pass
 *   1  at least one gate detected drift
 *   2  gate runner itself errored (config / file missing)
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ANSI colors — match guard.mjs / validate-fact-pipeline.mjs
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

// ---------- CLI -----------------------------------------------------------
const argv = process.argv.slice(2);
const QUICK_MODE = argv.includes('--quick');
const JSON_MODE  = argv.includes('--json');
const gateIdx    = argv.indexOf('--gate');
const ONLY_GATE  = gateIdx >= 0 ? argv[gateIdx + 1] : null;

// ---------- Inputs --------------------------------------------------------
const MIGRATION_FILE = resolve(PROJECT_ROOT, 'scripts/migrate-courses-to-d1.sql');
const D1_NAME = 'rrm-auth';
const COURSE_TABLES = ['course', 'course_section', 'course_step'];

// The shared module is the single app-side source of truth for the VALID_* Sets
// (extracted from the per-endpoint copies on 2026-05-31 — they now import from here).
// (col, table) pairs are the migration CHECK columns we hold them against.
const APP_ENUM_FILES = [
  'functions/api/admin/courses/_shared.js',
];

// Which (table.column) CHECK constraint each app-side Set must equal.
// A Set named here that appears in any APP_ENUM_FILES is collected and the
// union must match the migration CHECK for the mapped column.
const SET_TO_CHECK = {
  VALID_ACCESS_TYPES: { table: 'course',      column: 'access_type' },
  VALID_TYPES:        { table: 'course_step', column: 'type' },
  // VALID_STATUSES maps to BOTH course.status and course_step.status — handled specially.
};

// ---------- Helpers -------------------------------------------------------
function pass(msg) { return { ok: true,  msg }; }
function fail(msg) { return { ok: false, msg }; }
function warn(msg) { return { ok: null,  msg }; }

function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
function setStr(s) { return `{${[...s].sort().join(', ')}}`; }

/**
 * Split a SQL file into CREATE TABLE blocks: { name -> body }.
 * body is the text between the opening `(` and the closing `\n);`.
 */
function parseCreateTableBlocks(sql) {
  const blocks = {};
  const re = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+["`]?(\w+)["`]?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  let m;
  while ((m = re.exec(sql)) !== null) blocks[m[1].toLowerCase()] = m[2];
  return blocks;
}

/**
 * Within a table body, map column -> Set(values) for every `CHECK(col IN (...))`.
 * Column name is read from inside the CHECK itself, so it's table-scoped and
 * immune to where the constraint sits in the column definition.
 */
function parseCheckSets(tableBody) {
  const out = {};
  const re = /CHECK\s*\(\s*["`]?(\w+)["`]?\s+IN\s*\(([^)]*)\)\s*\)/gi;
  let m;
  while ((m = re.exec(tableBody)) !== null) {
    const col = m[1].toLowerCase();
    const values = [...m[2].matchAll(/'([^']*)'/g)].map((v) => v[1]);
    out[col] = new Set(values);
  }
  return out;
}

/**
 * Within a table body, return Set(column names). A column line starts (after
 * optional whitespace / newline) with an identifier followed by a SQLite type.
 * Constraint lines (CHECK/PRIMARY/FOREIGN/UNIQUE/CONSTRAINT) don't match.
 */
function parseColumns(tableBody) {
  const out = new Set();
  const re = /(?:^|\n)\s*["`]?(\w+)["`]?\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/gi;
  let m;
  while ((m = re.exec(tableBody)) !== null) {
    const name = m[1].toLowerCase();
    if (['check', 'primary', 'foreign', 'unique', 'constraint'].includes(name)) continue;
    out.add(name);
  }
  return out;
}

/** Parse a `const NAME = new Set([...])` declaration from JS source. */
function parseValidSet(src, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*new\\s+Set\\(\\s*\\[([^\\]]*)\\]`);
  const m = src.match(re);
  if (!m) return null;
  return new Set([...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((v) => v[1] ?? v[2]));
}

/**
 * Query live D1 via wrangler. Returns rows array. Throws on any failure
 * (auth / network / parse) — callers in CS2 catch and WARN-skip.
 */
function d1Query(sql) {
  let raw;
  try {
    raw = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', D1_NAME, '--remote', '--json', `--command=${sql}`],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 8 * 1024 * 1024, cwd: PROJECT_ROOT }
    ).toString();
  } catch (err) {
    // execFileSync attaches captured stdout/stderr on the error object.
    const detail = String(err.stderr || err.stdout || err.message || err).slice(0, 300);
    throw new Error(`wrangler d1 execute failed: ${detail}`);
  }
  // wrangler prints a banner line to stdout before the JSON; scan from the end
  // for the outer array's opening `[` at column 0 (the proven fact-pipeline pattern).
  const lines = raw.split('\n');
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('[')) { start = i; break; }
  }
  if (start === -1) throw new Error(`no JSON array in wrangler output. First 200 chars: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(lines.slice(start).join('\n'));
  return parsed[0]?.results || [];
}

// ---------- Load committed migration (shared by both gates) ---------------
if (!existsSync(MIGRATION_FILE)) {
  console.error(`FATAL: migration file not found: ${MIGRATION_FILE}`);
  process.exit(2);
}
const MIGRATION_SQL = readFileSync(MIGRATION_FILE, 'utf-8');
const MIGRATION_BLOCKS = parseCreateTableBlocks(MIGRATION_SQL);

// migration CHECK sets and columns, per table
const migChecks = {};   // table -> { col -> Set }
const migColumns = {};  // table -> Set
for (const t of COURSE_TABLES) {
  const body = MIGRATION_BLOCKS[t];
  if (body === undefined) continue;
  migChecks[t] = parseCheckSets(body);
  migColumns[t] = parseColumns(body);
}

// ---------- Gate CS1: Static — migration CHECK == app VALID_* -------------
function gateCS1() {
  const results = [];

  // Sanity: migration must have parsed the 3 tables and the 3 enum columns.
  for (const t of COURSE_TABLES) {
    if (MIGRATION_BLOCKS[t] === undefined) {
      results.push(fail(`migration ${MIGRATION_FILE.split('/').pop()} has no CREATE TABLE for '${t}' (parser found: [${Object.keys(MIGRATION_BLOCKS).join(', ')}])`));
    }
  }
  for (const [col, where] of [['access_type', 'course'], ['status', 'course'], ['type', 'course_step'], ['status', 'course_step']]) {
    if (!migChecks[where] || !migChecks[where][col]) {
      results.push(fail(`migration '${where}.${col}' has no CHECK(... IN (...)) constraint — schema lost its enum guard`));
    }
  }
  if (results.some((r) => r.ok === false)) return results;

  // Collect each VALID_* Set from every app file that declares it.
  const collected = {}; // setName -> [{ file, set }]
  for (const rel of APP_ENUM_FILES) {
    const abs = resolve(PROJECT_ROOT, rel);
    if (!existsSync(abs)) { results.push(fail(`app enum file missing: ${rel}`)); continue; }
    const src = readFileSync(abs, 'utf-8');
    for (const name of ['VALID_ACCESS_TYPES', 'VALID_STATUSES', 'VALID_TYPES']) {
      const s = parseValidSet(src, name);
      if (s) (collected[name] ||= []).push({ file: rel, set: s });
    }
  }

  // a) Every duplicated VALID_* Set must agree across files (cross-file consistency).
  for (const [name, copies] of Object.entries(collected)) {
    if (copies.length < 2) continue;
    const ref = copies[0].set;
    const diverged = copies.filter((c) => !setEq(c.set, ref));
    if (diverged.length) {
      results.push(fail(`${name} diverges across files: ${copies.map((c) => `${c.file}=${setStr(c.set)}`).join('  |  ')}`));
    } else {
      results.push(pass(`${name} identical across ${copies.length} files: ${setStr(ref)}`));
    }
  }

  // b) Single-column Sets must equal their migration CHECK.
  for (const [name, { table, column }] of Object.entries(SET_TO_CHECK)) {
    const copies = collected[name];
    if (!copies || !copies.length) { results.push(fail(`no ${name} Set found in any app enum file`)); continue; }
    const appSet = copies[0].set;
    const migSet = migChecks[table]?.[column];
    if (!migSet) { results.push(fail(`migration '${table}.${column}' CHECK missing (cannot compare to ${name})`)); continue; }
    if (setEq(appSet, migSet)) {
      results.push(pass(`${table}.${column}: migration CHECK == ${name} ${setStr(migSet)}`));
    } else {
      results.push(fail(`${table}.${column}: migration CHECK ${setStr(migSet)} != ${name} ${setStr(appSet)} — schema/app drift (the access_type='members' class)`));
    }
  }

  // c) VALID_STATUSES governs BOTH course.status and course_step.status.
  const statusCopies = collected['VALID_STATUSES'];
  if (!statusCopies || !statusCopies.length) {
    results.push(fail(`no VALID_STATUSES Set found in any app enum file`));
  } else {
    const appStatus = statusCopies[0].set;
    for (const table of ['course', 'course_step']) {
      const migSet = migChecks[table]?.['status'];
      if (!migSet) { results.push(fail(`migration '${table}.status' CHECK missing`)); continue; }
      if (setEq(appStatus, migSet)) {
        results.push(pass(`${table}.status: migration CHECK == VALID_STATUSES ${setStr(migSet)}`));
      } else {
        results.push(fail(`${table}.status: migration CHECK ${setStr(migSet)} != VALID_STATUSES ${setStr(appStatus)} — schema/app drift`));
      }
    }
  }

  return results;
}

// ---------- Gate CS2: Live — migration columns + CHECK == live D1 ---------
function gateCS2() {
  const results = [];
  if (QUICK_MODE) {
    results.push(warn(`CS2 skipped (--quick mode, no network queries)`));
    return results;
  }

  // Pull live DDL for the course tables. Any failure => WARN-skip the whole gate
  // (never fail) so an unreachable D1 can't block a deploy.
  let liveRows;
  try {
    const inList = COURSE_TABLES.map((t) => `'${t}'`).join(',');
    liveRows = d1Query(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN (${inList})`);
  } catch (err) {
    results.push(warn(`CS2 skipped: could not reach live D1 '${D1_NAME}' (${String(err.message).slice(0, 160)})`));
    return results;
  }

  const liveDDL = {};
  for (const row of liveRows) if (row && row.name) liveDDL[String(row.name).toLowerCase()] = String(row.sql || '');

  for (const t of COURSE_TABLES) {
    if (migColumns[t] === undefined) continue; // CS1 already failed on this
    const ddl = liveDDL[t];
    if (!ddl) { results.push(fail(`live D1 has no table '${t}' (committed migration declares it)`)); continue; }

    // Live table body = text inside the outermost parens of the CREATE statement.
    const open = ddl.indexOf('(');
    const close = ddl.lastIndexOf(')');
    const liveBody = open >= 0 && close > open ? ddl.slice(open + 1, close) : ddl;

    // Column presence: every committed column must exist live (FAIL if missing).
    const liveCols = parseColumns(liveBody);
    const missing = [...migColumns[t]].filter((c) => !liveCols.has(c));
    if (missing.length) {
      results.push(fail(`${t}: live D1 missing committed column(s): ${missing.join(', ')}`));
    } else {
      results.push(pass(`${t}: all ${migColumns[t].size} committed columns present live`));
    }
    // Live-only columns are lower-risk drift (later migration not in this base file) — WARN only.
    const extra = [...liveCols].filter((c) => !migColumns[t].has(c));
    if (extra.length) results.push(warn(`${t}: live D1 has column(s) not in committed migration: ${extra.join(', ')} (later migration? update the base file)`));

    // CHECK value-set equality (the literal "did live drift from committed" check).
    const liveChecks = parseCheckSets(liveBody);
    const cols = new Set([...Object.keys(migChecks[t] || {}), ...Object.keys(liveChecks)]);
    for (const col of cols) {
      const mig = migChecks[t]?.[col];
      const live = liveChecks[col];
      if (mig && !live) { results.push(fail(`${t}.${col}: committed has CHECK ${setStr(mig)} but live has none`)); continue; }
      if (!mig && live) { results.push(warn(`${t}.${col}: live has CHECK ${setStr(live)} not in committed migration`)); continue; }
      if (setEq(mig, live)) {
        results.push(pass(`${t}.${col}: live CHECK == committed ${setStr(mig)}`));
      } else {
        results.push(fail(`${t}.${col}: live CHECK ${setStr(live)} != committed ${setStr(mig)} — committed migration is stale (re-running it would NOT reproduce live)`));
      }
    }
  }

  return results;
}

// ---------- Main ----------------------------------------------------------
if (!JSON_MODE) {
  console.log(`${BOLD}RRM Academy — Courses Schema Drift Gates${RESET}`);
  if (QUICK_MODE) console.log(`${YELLOW}Mode: --quick (CS2 skipped)${RESET}`);
  if (ONLY_GATE)  console.log(`${YELLOW}Mode: --gate ${ONLY_GATE} only${RESET}`);
}

const gateSpecs = [
  { id: 'CS1', name: 'Static: migration CHECK == app VALID_* Sets', fn: gateCS1 },
  { id: 'CS2', name: 'Live: migration columns + CHECK == live D1',   fn: gateCS2 },
];

let totalFailures = 0;
const finalResults = [];

for (const { id, name, fn } of gateSpecs) {
  if (ONLY_GATE && ONLY_GATE !== id) continue;

  if (!JSON_MODE) console.log(`\n${BOLD}Gate ${id}: ${name}${RESET}`);

  let items;
  try {
    items = fn();
    if (!Array.isArray(items)) items = [items];
  } catch (err) {
    items = [{ ok: false, msg: `Gate runner error: ${err.message}` }];
  }

  const gatePassed = items.every((r) => r.ok !== false);
  if (!gatePassed) totalFailures++;

  if (!JSON_MODE) {
    for (const r of items) {
      const icon = r.ok === true ? `${GREEN}✓${RESET}` : r.ok === false ? `${RED}✗${RESET}` : `${YELLOW}~${RESET}`;
      const lines = r.msg.split('\n');
      console.log(`  ${icon} ${lines[0]}`);
      for (const l of lines.slice(1)) console.log(`    ${l}`);
    }
  }

  finalResults.push({ id, name, pass: gatePassed, items });
}

const totalRun    = finalResults.length;
const passedGates = finalResults.filter((g) => g.pass).length;

if (JSON_MODE) {
  console.log(JSON.stringify({
    summary: { total: totalRun, passed: passedGates, failed: totalFailures },
    gates: finalResults.map((g) => ({
      id: g.id, name: g.name, pass: g.pass,
      checks: g.items.map((i) => ({ ok: i.ok, msg: i.msg })),
    })),
  }, null, 2));
} else {
  console.log('');
  if (totalFailures === 0) {
    console.log(`${GREEN}${BOLD}✓ All ${totalRun} courses-schema gate(s) passed${RESET}`);
  } else {
    console.log(`${RED}${BOLD}✗ ${totalFailures}/${totalRun} courses-schema gate(s) detected drift${RESET}`);
  }
}

process.exit(totalFailures === 0 ? 0 : 1);
