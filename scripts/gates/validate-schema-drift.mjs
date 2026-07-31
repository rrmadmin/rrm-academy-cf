#!/usr/bin/env node
/**
 * validate-schema-drift.mjs - Deterministic proof-gate that compares the
 * repo's composed rrm-auth schema mirror against LIVE rrm-auth, in BOTH
 * directions, and reports every table and column that only one side has.
 *
 * WHY THIS EXISTS
 * ---------------
 * schema.sql says of itself: "Generated from the live database on 2026-05-27
 * (faithful mirror)". Nothing in the repo has ever checked that claim. Every
 * other schema-adjacent guard reasons about FILES against FILES:
 *   - test/schema-migration-replay.test.mjs partitions scripts/migrations/ into
 *     replayed / not-replayed, and says outright it "cannot distinguish whether
 *     a migration was actually APPLIED to production".
 *   - validate-sql-columns.mjs PREPAREs every static statement against the
 *     composed mirror, and says outright it is "exactly as current as the files
 *     it composes".
 * Both are honest about the same hole. This gate is that hole's guard.
 *
 * The drift has bitten twice, once in each direction, and the two directions
 * fail in completely different ways.
 *
 * STALE-ABSENT (live has it, the mirror does not)
 *   email_log.ses_message_id has existed live since 2026-06-28, but the
 *   migration that adds it still carried a "STATUS: DRAFT / HELD. Do NOT apply"
 *   header, so test/_d1-sqlite.mjs excluded it on the strength of that header.
 *   An agent read the mirror, concluded every transactional email had gone
 *   unlogged for a month, and started changing production code to route around
 *   an outage that was not happening. course.topics_json arrived the same way:
 *   a hand-run ALTER on live with no committed migration behind it.
 *   Failure mode: a HUMAN OR AGENT MISREADS PRODUCTION. Static checks against
 *   the mirror get LOUDER, not quieter, because a statement naming a live-only
 *   column fails to prepare and validate-sql-columns.mjs already says so by
 *   name at the point of use.
 *
 * STALE-PRESENT (the mirror has it, live does not)
 *   retrieval_docs and retrieval_state sat in schema.sql while living, in fact,
 *   in the rrm-library database (see rrm-library-worker/migrations/). A
 *   statement against either one PREPAREd clean against the composed mirror,
 *   passed validate-sql-columns.mjs, and would have thrown "no such table" on
 *   its first production call.
 *   Failure mode: A GREEN GATE CERTIFIES A GUARANTEED 500. This arrives through
 *   the SQL gate's blind side: the mirror is the gate's definition of truth, so
 *   the gate cannot see that its own definition is wrong.
 *
 * WHICH DIRECTION FAILS, AND WHY IT IS NOT SYMMETRIC
 * -------------------------------------------------
 * STALE-PRESENT FAILS. Three reasons, and the third is the deciding one:
 *   1. There is no benign reading. A table in the rrm-auth mirror that rrm-auth
 *      does not have is either DDL nobody trimmed after a drop, DDL copied in
 *      from another database, or a migration written and committed but never
 *      applied. All three are defects, and all three are fixable by the author
 *      of the PR that introduces them, in that PR, with no coordination.
 *   2. It is the only direction that produces a FALSE PASS anywhere else in the
 *      toolchain. Everything downstream of the mirror inherits the lie.
 *   3. Remediation is local and cheap: delete the DDL, or apply the migration.
 *      A gate should block on exactly the drift its author can clear.
 *
 * STALE-ABSENT WARNS. The counter-argument is real and was weighed: the
 * email_log incident WAS stale-absent and it DID cause harm. But the harm there
 * was a misreading, and the cure for a misreading is information, not a closed
 * door. A warning that names the column ("live rrm-auth HAS email_log
 * .ses_message_id; the mirror does not; do NOT conclude the column is missing
 * in production") is precisely the artefact whose absence caused that incident.
 * Blocking a deploy adds no information that the warning does not.
 * Against that, failing on stale-absent punishes bystanders: anyone can add a
 * column to live rrm-auth by hand, as course.topics_json actually was, and from
 * that moment every unrelated PR in the repo is red until somebody with a
 * Cloudflare token regenerates the mirror. That is how gates get switched off,
 * and a gate that is switched off guards nothing in either direction.
 *
 * The escape hatch for a legitimate mirror-first change is MIRROR_ONLY_ALLOWED,
 * which downgrades a named stale-present entry to a warning and demands a
 * written reason. An allowlist entry that no longer matches anything in the
 * mirror is itself a failure, so the list cannot rot into permanent cover.
 *
 * WARN-SKIP POSTURE (copied deliberately from validate-courses-schema.mjs CS2)
 * ---------------------------------------------------------------------------
 * Any wrangler / auth / network / parse failure WARN-skips the live gates
 * instead of failing them, so an unreachable D1 can never block a deploy and
 * the gate runs everywhere: warn-skipping on a laptop with no token, running
 * for real in CI where CLOUDFLARE_API_TOKEN is set. ONLY DETECTED DRIFT FAILS.
 *
 * VACUITY GUARD. A warn-skip on error is safe; a warn-skip on a SUCCESSFUL but
 * empty read is not. If live returns fewer than MIN_LIVE_TABLES tables the read
 * is treated as unreliable and both live gates warn-skip by name, because an
 * empty live read would otherwise report every mirror table as stale-present
 * (noise) and zero tables as stale-absent (vacuous silence).
 *
 * WHAT THIS GATE DOES NOT COVER (read before trusting a green run)
 * ---------------------------------------------------------------
 *  1. Column TYPES, NOT NULL, DEFAULT, COLLATE, PRIMARY KEY, CHECK sets and
 *     indexes. Presence only, per direction. CHECK-set drift on the course
 *     tables is validate-courses-schema.mjs CS2's job; collation is asserted
 *     per-column by test/collation-identity.test.js.
 *  2. Databases other than rrm-auth. rrm-library, rrm-survey,
 *     rrm-survey-symptoms and rrm-analytics have no committed mirror here.
 *  3. Views, triggers and temp objects.
 *  4. Row-level truth. A table can exist on both sides and hold nothing.
 *
 * Usage:
 *   node scripts/gates/validate-schema-drift.mjs            # SD1 + SD2 + SD3
 *   node scripts/gates/validate-schema-drift.mjs --quick    # SD1 only (no network)
 *   node scripts/gates/validate-schema-drift.mjs --gate SD2 # one gate
 *   node scripts/gates/validate-schema-drift.mjs --json     # machine-readable
 *
 * Exit codes:
 *   0  all run gates pass
 *   1  at least one gate detected drift
 *   2  the gate runner itself errored (mirror will not compose)
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildSchemaDb } from './validate-sql-columns.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, '../..');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export const D1_NAME = 'rrm-auth';

/**
 * Objects the composed mirror is allowed to declare while live rrm-auth does
 * not have them. Keys are `table` or `table.column`. Values are the written
 * reason, which SD1 requires to be substantive (>= 40 chars), matching the
 * discipline test/schema-migration-replay.test.mjs already imposes on
 * MIGRATIONS_NOT_REPLAYED.
 *
 * EMPTY IS THE INTENDED STATE. This exists so that a genuine mirror-first
 * change (DDL committed in the PR that will apply it) can land without the
 * gate blocking, at the price of writing down why. It is not a place to park
 * drift: SD1 fails on any entry that no longer matches something in the mirror,
 * so an entry cannot outlive the DDL it excuses.
 *
 * Deliberately NOT in here: retrieval_docs and retrieval_state. They were the
 * founding stale-present instance and the fix was to delete them from
 * schema.sql, because they are rrm-library tables (verified live in rrm-library
 * on 2026-07-31) that were copied into the rrm-auth mirror by mistake. An
 * allowlist entry would have preserved exactly the lie the gate exists to
 * catch.
 *
 * @type {Record<string, string>} `table` or `table.column` -> reason
 */
export const MIRROR_ONLY_ALLOWED = {};

/**
 * Floor on the live table count below which the read is treated as unreliable
 * rather than as truth. Live rrm-auth held 76 tables on 2026-07-31. Tables are
 * added far more often than dropped, so a read returning fewer than 60 means
 * the query, the credentials or the database is wrong, not that 16 tables were
 * deleted. Compare MIN_TABLES = 75 on the mirror side in validate-sql-columns.
 */
export const MIN_LIVE_TABLES = 60;

/**
 * SQLite/D1 bookkeeping tables that belong to neither side's authorship. They
 * are filtered out of BOTH sides before diffing, so they can never show up as
 * drift in either direction.
 *   sqlite_%   engine internals
 *   _cf_%      Cloudflare internals (the schema.sql regeneration command in
 *              that file's own header excludes these two prefixes as well)
 */
export function isInternalTable(name) {
  return /^sqlite_/i.test(name) || /^_cf_/i.test(name);
}

function pass(msg) { return { ok: true, msg }; }
function fail(msg) { return { ok: false, msg }; }
function warn(msg) { return { ok: null, msg }; }

/**
 * The composed mirror: schema.sql + the test replay list + the action-area
 * migrations + EXTRA_DDL, exactly as validate-sql-columns.mjs assembles it.
 *
 * That composition, not schema.sql alone, is the right comparator: it IS the
 * repo's operative belief about rrm-auth, it is what the SQL gate PREPAREs
 * against, and it is therefore the surface on which a stale-present table
 * produces a false pass. The test harness in test/_d1-sqlite.mjs builds a
 * strict subset of it (schema.sql + replay list); EXTRA_DDL is the declared
 * delta between the two.
 *
 * @returns {{ tables: Map<string, Set<string>>, errors: string[] }}
 */
export function composeMirror(root = PROJECT_ROOT) {
  const { db, errors, tables } = buildSchemaDb(root);
  const out = new Map();
  for (const t of tables) {
    if (isInternalTable(t)) continue;
    const cols = db.prepare('SELECT name FROM pragma_table_info(?)').all(t).map((r) => String(r.name));
    out.set(t, new Set(cols));
  }
  db.close();
  return { tables: out, errors };
}

/**
 * Runs one SQL statement against live D1 via wrangler and returns its rows.
 * Throws on any failure (auth / network / parse); callers WARN-skip.
 * The output scan is the proven fact-pipeline pattern: wrangler prints a banner
 * before the JSON, so find the last line that starts the outer array.
 */
export function d1Query(sql, { root = PROJECT_ROOT } = {}) {
  let raw;
  try {
    raw = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', D1_NAME, '--remote', '--json', `--command=${sql}`],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 16 * 1024 * 1024, cwd: root }
    ).toString();
  } catch (err) {
    const detail = String(err.stderr || err.stdout || err.message || err).slice(0, 300);
    throw new Error(`wrangler d1 execute failed: ${detail}`);
  }
  const lines = raw.split('\n');
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('[')) { start = i; break; }
  }
  if (start === -1) throw new Error(`no JSON array in wrangler output. First 200 chars: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(lines.slice(start).join('\n'));
  return parsed[0]?.results || [];
}

/**
 * Live rrm-auth as `table -> Set(columns)`. One statement: sqlite_master joined
 * to pragma_table_info, which D1 supports as a table-valued function.
 *
 * @returns {Map<string, Set<string>>}
 */
export function liveSchema(opts = {}) {
  const rows = (opts.query || d1Query)(
    "SELECT m.name AS tbl, p.name AS col FROM sqlite_master m " +
    "JOIN pragma_table_info(m.name) p " +
    "WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' " +
    "ORDER BY m.name, p.cid",
    opts
  );
  const out = new Map();
  for (const r of rows) {
    const t = String(r.tbl);
    if (isInternalTable(t)) continue;
    if (!out.has(t)) out.set(t, new Set());
    out.get(t).add(String(r.col));
  }
  return out;
}

/**
 * Both directions of the diff, as sorted arrays of names.
 * Columns are compared only for tables PRESENT ON BOTH SIDES, so a missing
 * table is reported once as a table rather than once per column.
 */
export function diffSchemas(mirror, live) {
  const mirrorOnlyTables = [...mirror.keys()].filter((t) => !live.has(t)).sort();
  const liveOnlyTables = [...live.keys()].filter((t) => !mirror.has(t)).sort();
  const mirrorOnlyColumns = [];
  const liveOnlyColumns = [];
  for (const t of [...mirror.keys()].filter((x) => live.has(x)).sort()) {
    const mc = mirror.get(t);
    const lc = live.get(t);
    for (const c of [...mc].sort()) if (!lc.has(c)) mirrorOnlyColumns.push(`${t}.${c}`);
    for (const c of [...lc].sort()) if (!mc.has(c)) liveOnlyColumns.push(`${t}.${c}`);
  }
  return { mirrorOnlyTables, liveOnlyTables, mirrorOnlyColumns, liveOnlyColumns };
}

/**
 * The allowlist reason for `table` or `table.column`, or null. A table-level
 * entry covers every column of that table, so allowlisting a not-yet-applied
 * table does not also require an entry per column.
 */
export function allowedReason(name, allow = MIRROR_ONLY_ALLOWED) {
  if (Object.prototype.hasOwnProperty.call(allow, name)) return allow[name];
  const dot = name.indexOf('.');
  if (dot > 0) {
    const t = name.slice(0, dot);
    if (Object.prototype.hasOwnProperty.call(allow, t)) return allow[t];
  }
  return null;
}

/** True when `table` or `table.column` is covered by an allowlist entry. */
export function isAllowed(name, allow = MIRROR_ONLY_ALLOWED) {
  return allowedReason(name, allow) !== null;
}

// ------------------------------------------------------------------ SD1 ----

/**
 * SD1 (static, no network): the mirror composes, is plausibly sized, and the
 * allowlist is well-formed and not rotting.
 */
export function gateSD1(mirror, errors, allow = MIRROR_ONLY_ALLOWED) {
  const results = [];

  if (errors.length) {
    for (const e of errors) results.push(fail(`mirror DDL failed to load: ${e}`));
    return results;
  }
  results.push(pass(`composed mirror loaded cleanly: ${mirror.size} tables`));

  if (mirror.size < MIN_LIVE_TABLES) {
    results.push(fail(`composed mirror has only ${mirror.size} tables (floor ${MIN_LIVE_TABLES}) - the composition is broken, not the schema`));
  }

  const entries = Object.entries(allow);
  if (!entries.length) {
    results.push(pass('MIRROR_ONLY_ALLOWED is empty: no stale-present drift is being excused'));
    return results;
  }

  for (const [key, reason] of entries) {
    if (!/^\w+(\.\w+)?$/.test(key)) {
      results.push(fail(`MIRROR_ONLY_ALLOWED key '${key}' is not \`table\` or \`table.column\``));
      continue;
    }
    if (typeof reason !== 'string' || reason.trim().length < 40) {
      results.push(fail(`MIRROR_ONLY_ALLOWED['${key}'] needs a substantive written reason, not a placeholder`));
      continue;
    }
    const dot = key.indexOf('.');
    const table = dot > 0 ? key.slice(0, dot) : key;
    if (!mirror.has(table)) {
      results.push(fail(`MIRROR_ONLY_ALLOWED['${key}'] excuses something the mirror no longer declares - delete the entry`));
      continue;
    }
    if (dot > 0 && !mirror.get(table).has(key.slice(dot + 1))) {
      results.push(fail(`MIRROR_ONLY_ALLOWED['${key}'] excuses a column the mirror no longer declares - delete the entry`));
      continue;
    }
    results.push(warn(`allowlisted stale-present: ${key} (${reason})`));
  }

  return results;
}

// -------------------------------------------------------------- SD2/SD3 ----

/**
 * Reads live once and caches the result (or the failure) so SD2 and SD3 do not
 * pay for two round trips and cannot disagree about what live contains.
 */
function makeLiveReader(opts) {
  let cached;
  return () => {
    if (cached === undefined) {
      try {
        cached = { live: liveSchema(opts) };
      } catch (err) {
        cached = { error: String(err.message) };
      }
    }
    return cached;
  };
}

/** SD2 (live): mirror-only tables/columns. FAIL, unless allowlisted. */
export function gateSD2(mirror, readLive, { quick = false, allow = MIRROR_ONLY_ALLOWED } = {}) {
  const results = [];
  if (quick) return [warn('SD2 skipped (--quick mode, no network queries)')];

  const { live, error } = readLive();
  if (error) return [warn(`SD2 skipped: could not reach live D1 '${D1_NAME}' (${error.slice(0, 160)})`)];
  if (live.size < MIN_LIVE_TABLES) {
    return [warn(`SD2 skipped: live read returned only ${live.size} tables (floor ${MIN_LIVE_TABLES}) - treating the read as unreliable rather than as truth`)];
  }

  const { mirrorOnlyTables, mirrorOnlyColumns } = diffSchemas(mirror, live);
  const offenders = [...mirrorOnlyTables, ...mirrorOnlyColumns];
  const blocking = offenders.filter((n) => !isAllowed(n, allow));
  const excused = offenders.filter((n) => isAllowed(n, allow));

  for (const n of excused) results.push(warn(`stale-present (allowlisted): ${n} - ${allowedReason(n, allow)}`));

  if (blocking.length) {
    results.push(fail(
      `mirror declares ${blocking.length} object(s) live rrm-auth does not have: ${blocking.join(', ')}\n` +
      'This is the dangerous direction. A statement against any of these PREPAREs clean\n' +
      'against the mirror, passes npm run gates:sql, and throws "no such table"/"no such\n' +
      'column" on its first production call. Fix by deleting the DDL from the mirror (it\n' +
      'belongs to another database or was never applied), or by applying the migration to\n' +
      'live and re-running. Use MIRROR_ONLY_ALLOWED only for DDL this PR is about to apply.'
    ));
  } else {
    results.push(pass(`no unexcused stale-present drift: all ${mirror.size} mirror tables exist live`));
  }

  return results;
}

/** SD3 (live): live-only tables/columns. WARN always, never fails. */
export function gateSD3(mirror, readLive, { quick = false } = {}) {
  const results = [];
  if (quick) return [warn('SD3 skipped (--quick mode, no network queries)')];

  const { live, error } = readLive();
  if (error) return [warn(`SD3 skipped: could not reach live D1 '${D1_NAME}' (${error.slice(0, 160)})`)];
  if (live.size < MIN_LIVE_TABLES) {
    return [warn(`SD3 skipped: live read returned only ${live.size} tables (floor ${MIN_LIVE_TABLES}) - treating the read as unreliable rather than as truth`)];
  }

  const { liveOnlyTables, liveOnlyColumns } = diffSchemas(mirror, live);

  for (const t of liveOnlyTables) {
    results.push(warn(
      `stale-absent TABLE: live rrm-auth HAS '${t}' and the mirror does not. ` +
      'Production is fine. Do NOT read the mirror as evidence this table is missing live. ' +
      'Commit the migration, or add it to POST_SNAPSHOT_MIGRATIONS / EXTRA_DDL, or regenerate schema.sql.'
    ));
  }
  for (const c of liveOnlyColumns) {
    results.push(warn(
      `stale-absent COLUMN: live rrm-auth HAS '${c}' and the mirror does not. ` +
      'Production is fine. Do NOT read the mirror as evidence this column is missing live ' +
      '(that misreading is what this warning exists to prevent). ' +
      'Commit the migration, or add it to POST_SNAPSHOT_MIGRATIONS / EXTRA_DDL, or regenerate schema.sql.'
    ));
  }

  if (!liveOnlyTables.length && !liveOnlyColumns.length) {
    results.push(pass(`no stale-absent drift: the mirror covers every live table and column (${live.size} tables read)`));
  } else {
    results.push(warn(
      `${liveOnlyTables.length} table(s) and ${liveOnlyColumns.length} column(s) exist live but not in the mirror. ` +
      'WARN, not FAIL, by design: this direction cannot produce a false pass anywhere ' +
      '(a statement naming a live-only column fails to PREPARE, so gates:sql reports it by name), ' +
      'and failing here would redden every unrelated PR until somebody with a Cloudflare token regenerates the mirror.'
    ));
  }

  return results;
}

// ----------------------------------------------------------------- main ----

export function main(argv = process.argv.slice(2), out = console) {
  const QUICK = argv.includes('--quick');
  const JSON_MODE = argv.includes('--json');
  const gateIdx = argv.indexOf('--gate');
  const ONLY = gateIdx >= 0 ? argv[gateIdx + 1] : null;

  let mirror;
  let errors;
  try {
    ({ tables: mirror, errors } = composeMirror());
  } catch (err) {
    out.error(`FATAL: could not compose the schema mirror: ${err.message}`);
    return 2;
  }

  const readLive = makeLiveReader({ root: PROJECT_ROOT });

  if (!JSON_MODE) {
    out.log(`${BOLD}RRM Academy - schema.sql Drift Gates (mirror vs live ${D1_NAME})${RESET}`);
    if (QUICK) out.log(`${YELLOW}Mode: --quick (SD2 + SD3 skipped)${RESET}`);
    if (ONLY) out.log(`${YELLOW}Mode: --gate ${ONLY} only${RESET}`);
  }

  const gateSpecs = [
    { id: 'SD1', name: 'Static: mirror composes, allowlist is well-formed and not rotting', fn: () => gateSD1(mirror, errors) },
    { id: 'SD2', name: 'Live: mirror declares nothing live lacks (stale-PRESENT, FAILS)', fn: () => gateSD2(mirror, readLive, { quick: QUICK }) },
    { id: 'SD3', name: 'Live: live declares nothing the mirror lacks (stale-ABSENT, WARNS)', fn: () => gateSD3(mirror, readLive, { quick: QUICK }) },
  ];

  let totalFailures = 0;
  const finalResults = [];

  for (const { id, name, fn } of gateSpecs) {
    if (ONLY && ONLY !== id) continue;
    if (!JSON_MODE) out.log(`\n${BOLD}Gate ${id}: ${name}${RESET}`);

    let items;
    try {
      items = fn();
      if (!Array.isArray(items)) items = [items];
    } catch (err) {
      items = [fail(`Gate runner error: ${err.message}`)];
    }

    const gatePassed = items.every((r) => r.ok !== false);
    if (!gatePassed) totalFailures++;

    if (!JSON_MODE) {
      for (const r of items) {
        const icon = r.ok === true ? `${GREEN}+${RESET}` : r.ok === false ? `${RED}x${RESET}` : `${YELLOW}~${RESET}`;
        const lines = r.msg.split('\n');
        out.log(`  ${icon} ${lines[0]}`);
        for (const l of lines.slice(1)) out.log(`    ${l}`);
      }
    }

    finalResults.push({ id, name, pass: gatePassed, items });
  }

  if (JSON_MODE) {
    out.log(JSON.stringify({
      summary: { total: finalResults.length, passed: finalResults.filter((g) => g.pass).length, failed: totalFailures },
      gates: finalResults.map((g) => ({
        id: g.id, name: g.name, pass: g.pass,
        checks: g.items.map((i) => ({ ok: i.ok, msg: i.msg })),
      })),
    }, null, 2));
  } else {
    out.log('');
    if (totalFailures === 0) {
      out.log(`${GREEN}${BOLD}+ All ${finalResults.length} schema-drift gate(s) passed${RESET}`);
    } else {
      out.log(`${RED}${BOLD}x ${totalFailures}/${finalResults.length} schema-drift gate(s) detected drift${RESET}`);
    }
  }

  return totalFailures === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) process.exit(main());
