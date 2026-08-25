#!/usr/bin/env node
/**
 * validate-sql-columns.mjs - Deterministic proof-gate that every static SQL
 * string in the repo names only columns and tables that actually exist.
 *
 * THE INCIDENT
 * ------------
 * functions/api/admin/courses/[id].js probed its delete reference guard with
 *
 *     SELECT id FROM step_progress WHERE course_id = ? LIMIT 1
 *
 * but `step_progress` has no `id` column - its primary key is the composite
 * (user_id, course_id, step_id). SQLite resolves column names at PREPARE time,
 * so that statement threw on EVERY call, matching rows or not. It sat inside a
 * Promise.all, so the rejection propagated and every admin course delete
 * returned 500. Confirmed against the live database: the statement returns
 * "no such column: id" while `SELECT user_id` succeeds. No course could be
 * deleted through the admin API, and the six-table reference guard, the
 * certificate-quiz refusal, the section/step/rendition cleanup and the R2 purge
 * sitting below that probe had never executed once.
 *
 * That is why this class deserves a gate. It is not subtle - it is a guaranteed
 * hard throw at prepare time, so every instance is a live 500 waiting for its
 * first caller - and unlike most defect classes it is mechanically detectable.
 *
 * THE METHOD (engine truth, not regex guessing)
 * ---------------------------------------------
 * Build the rrm-auth schema in an in-memory node:sqlite database, then PREPARE
 * every static SQL string found in the scanned sources against it. SQLite
 * itself decides whether a column or table exists, so the gate inherits the
 * engine's answer instead of reimplementing name resolution.
 *
 * The schema is composed from, in order:
 *   1. schema.sql                     - generated mirror of live rrm-auth, 2026-05-27
 *   2. POST_SNAPSHOT_MIGRATIONS       - the replay list in test/_d1-sqlite.mjs
 *   3. ROOT_MIGRATIONS                - root migrations/025 + /027 + /032, per test/_community-sqlite.mjs
 *   4. EXTRA_DDL                      - see the table below
 * Steps 1-3 are IMPORTED from the test harness rather than re-listed, so the
 * gate and the suite can never disagree about what rrm-auth contains. When a
 * migration is added, test/schema-migration-replay.test.mjs already forces a
 * decision about it; this gate then inherits that decision for free.
 *
 * WHAT IT DOES NOT COVER (read before trusting a green run)
 * --------------------------------------------------------
 *  1. SQL that is not a static string: assembled across variables, or a
 *     template literal whose interpolation lands somewhere `?` cannot stand
 *     (a table name, a column list, an ORDER BY). Those are SKIPPED WITH A
 *     NAMED REASON and counted. `--verbose` lists every one. Strings above
 *     MAX_SQL_LEN are never shape-tested at all; they are skipped as
 *     `oversized` so the drop is a counted line rather than an invisible one.
 *  2. Databases other than rrm-auth. schema.sql mirrors rrm-auth only, so
 *     statements attributed to rrm-library / rrm-survey / rrm-survey-symptoms /
 *     rrm-analytics are skipped by name, not silently.
 *  3. Runtime values. A prepared statement proves the identifiers resolve; it
 *     proves nothing about bindings, types, or whether the row exists.
 *  4. Drift in schema.sql itself - NOW GUARDED, by a sibling rather than here.
 *     This gate is exactly as current as the files it composes, and it cannot
 *     see that its own definition of truth is wrong. `retrieval_docs` and
 *     `retrieval_state` were in schema.sql but NOT in live rrm-auth, so a
 *     statement against them PREPAREd clean here and would have thrown in
 *     production; the dm_* tables were the mirror image, live but absent from
 *     every committed file, until sql-columns-live-tables.sql captured them.
 *     scripts/gates/validate-schema-drift.mjs closes that blind side by
 *     comparing this composed schema against live rrm-auth in both directions
 *     (stale-present FAILS, stale-absent WARNS, unreachable D1 warn-skips).
 *     The retrieval_* tables were removed from schema.sql on 2026-07-31; they
 *     are rrm-library tables. Run `npm run gates:schema-drift` after any change
 *     to schema.sql, EXTRA_DDL or the replay list.
 *
 * SKIPPING QUIETLY IS THE FAILURE MODE. A gate that swallows what it cannot
 * parse passes vacuously. So every skip carries a reason, the reason counts are
 * always printed, and SQ3 fails if the number of statements actually PREPARED
 * drops below a committed floor - a broken extractor cannot report success.
 *
 * Gates:
 *   SQ1  The composed schema loaded: sentinel tables present, table-count floor.
 *   SQ2  Every attributed, preparable statement PREPAREs against rrm-auth.
 *        The four identifier-resolution errors SQLite raises at prepare time -
 *        "no such column", "no such table", "table X has no column named Y"
 *        (the INSERT/REPLACE column-list wording) and "ambiguous column name" -
 *        are FAILURES. Anything else is a counted skip. See FINDING_PATTERNS.
 *   SQ3  Coverage meta-assertion: prepared-statement count >= floor, and the
 *        skip breakdown is reported.
 *
 * Usage:
 *   node scripts/gates/validate-sql-columns.mjs             # full repo
 *   node scripts/gates/validate-sql-columns.mjs --quick     # functions/ only
 *   node scripts/gates/validate-sql-columns.mjs --gate SQ2  # one gate
 *   node scripts/gates/validate-sql-columns.mjs --json      # machine-readable
 *   node scripts/gates/validate-sql-columns.mjs --verbose   # list every skip
 *
 * Exit codes:
 *   0  all run gates pass
 *   1  at least one gate failed
 *   2  the gate runner itself errored (missing file, unloadable schema)
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acorn from 'acorn';
import { COMMUNITY_SCHEMA_SQL } from '../../test/_community-sqlite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, '../..');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// --------------------------------------------------------------- schema ----

/**
 * DDL the harness composition does not reach, each with the reason it is here.
 * `optional: true` means a missing file is tolerated (the gate reports it as a
 * warning) rather than aborting; nothing in this list is optional today.
 */
export const EXTRA_DDL = [
  {
    path: 'migrations/031-supporter-recognition.sql',
    why: 'supporter_recognition lives in the ROOT migrations/ directory, which the test replay list does not read, and postdates the 2026-05-27 snapshot. Verified present in live rrm-auth 2026-07-31.',
  },
  {
    path: 'migrations/033-admin-audit.sql',
    why: 'admin_audit is written by the RRM Backoffice (rrmadmin/rrm-backoffice) and lives in the ROOT migrations/ directory, which the test replay list does not read, and postdates the 2026-05-27 snapshot; added 2026-08-20 with the migration in the same commit so gates:schema-drift stays level with live once 033 is applied remotely. Until the remote apply, SD2 (STALE-PRESENT) is the expected and intended signal.',
  },
  {
    path: 'migrations/034-membership-state.sql',
    why: 'The three membership_state columns on wix_subscription are written by rrm-wix-stuc-sync (lapse-reason converge) and live in the ROOT migrations/ directory, which the test replay list does not read, and postdate the 2026-05-27 snapshot; added 2026-08-21 with the migration in the same commit so gates:schema-drift stays level with live once 034 is applied remotely. Until the remote apply, SD2 (STALE-PRESENT) is the expected and intended signal. Order matters: this file ALTERs wix_subscription, which schema.sql creates, so it must stay after schema.sql in the composition (EXTRA_DDL is applied last).',
  },
  {
    path: 'migrations/035-overdue-email.sql',
    why: 'The two overdue_email_* columns on wix_subscription are written by rrm-wix-stuc-sync (STUC overdue-renewal auto-email) and live in the ROOT migrations/ directory, which the test replay list does not read, and postdate the 2026-05-27 snapshot; added 2026-08-22 with the migration in the same commit so gates:schema-drift stays level with live once 035 is applied remotely. Until the remote apply, SD2 (STALE-PRESENT) is the expected and intended signal. Order matters: this file ALTERs wix_subscription, which schema.sql creates, so it must stay after schema.sql in the composition (EXTRA_DDL is applied last).',
  },
  {
    path: 'scripts/migrations/ai-search-docs.sql',
    why: 'ai_search_docs is excluded from POST_SNAPSHOT_MIGRATIONS because it predates the 2026-05-27 snapshot, and schema.sql does not inline it because a comment there wrongly recorded it as DROPPED (corrected 2026-07-31). It is NOT dropped: live rrm-auth still has it (verified 2026-07-31, columns identical to this file, differing only in the key collation noted in its own header) and scripts/ai-search-corpus-upload.mjs still writes to it. This entry is what keeps the composed mirror level with live, so gates:schema-drift reports no stale-absent drift for it.',
  },
  {
    path: 'scripts/gates/sql-columns-live-tables.sql',
    why: 'Live-only tables with no committed DDL anywhere: the five dm_* queue tables, legacy_thinkific_order, wix_notify_ledger. See that file for provenance.',
  },
];

/**
 * Tables that must exist after the schema loads. Not decoration: applySchema
 * falls back to statement-at-a-time execution if a whole-file exec fails, and a
 * naive fallback can silently drop a table whose DDL contains an embedded
 * semicolon inside a comment (glossary_definition_source does exactly that).
 * Without this list a partially loaded schema would turn every statement into a
 * "no such table" failure, or worse, into a skip.
 */
export const SENTINEL_TABLES = [
  'user', 'session', 'course', 'course_section', 'course_step', 'step_progress',
  'faq', 'posts', 'glossary_term', 'glossary_definition_source', 'enrollment',
  'email_log', 'email_event', 'donor_gift', 'wix_subscription', 'action_area',
  'supporter_recognition', 'ai_search_docs', 'dm_draft', 'dm_thread',
  'legacy_thinkific_order', 'wix_notify_ledger',
];

/** Floor on the composed table count. Tables only get added; this can only rise. */
export const MIN_TABLES = 75;

/**
 * Floor on statements actually PREPARED (not skipped) in a full-repo run.
 *
 * Measured 2026-07-31: 777 prepared out of 861 SQL strings seen, across 153
 * contributing files. (An earlier revision of this comment said 668; that
 * number was wrong, and since the comment is the whole justification for the
 * floor, it made the floor look far tighter than it was.)
 *
 * HEADROOM. This is an anti-vacuity assertion: its only job is to notice that
 * the extractor or the attribution quietly stopped covering things. A floor of
 * 600 against a real 777 tolerated a 177-statement, 23% silent collapse before
 * saying a word, which is most of a broken extractor. 750 leaves 27 statements
 * of slack. That is sized off the measured distribution, not a round number:
 * the single most SQL-dense file in the repo contributes 24 prepared statements
 * (scripts/fix-crm-typo-emails.mjs), so deleting the heaviest file in one PR
 * still clears the floor, while every extractor/attribution regression this
 * gate is meant to catch drops statements by the dozen or the hundred and trips
 * immediately.
 *
 * Ratchet: raise it after any run that legitimately increases coverage. Never
 * lower it to make a red run green - a drop is the finding. The one lowering
 * so far IS a finding with a name: old-admin-offline (2026-08-25) deleted
 * ~18 admin handlers and their ~95 prepared statements on purpose (the old
 * rrmacademy.org/admin decommission; the surviving reports live in
 * rrm-backoffice, whose own suite prepares them). Real count after the
 * deletion: 655. The floor re-bases just under it with the same ~4% headroom
 * the 750 floor gave 777.
 */
export const MIN_PREPARED = 630;

/**
 * Splits SQL into statements, respecting `--` line comments, `/* *\/` block
 * comments, and single/double-quoted identifiers and strings (SQLite escapes a
 * quote by doubling it). Used both to load DDL and to detect a source string
 * that holds more than one statement.
 */
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      const end = close === -1 ? sql.length : close + 2;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; }
          break;
        }
        j++;
      }
      buf += sql.slice(i, Math.min(j + 1, sql.length));
      i = j + 1;
      continue;
    }
    if (c === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => stripComments(s).trim().length > 0);
}

/** Removes SQL comments so a comment-only fragment is not mistaken for a statement. */
export function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Loads DDL, tolerating only the two errors a re-applied migration raises.
 * Any other DDL error is surfaced to the caller.
 */
function applySchema(db, ddl, errors) {
  try {
    db.exec(ddl);
    return;
  } catch {
    // Fall through: isolate the offending statement instead of losing the file.
  }
  for (const stmt of splitStatements(ddl)) {
    try {
      db.exec(stmt + ';');
    } catch (err) {
      if (/duplicate column name|already exists/i.test(err.message)) continue;
      errors.push(`${err.message} :: ${stmt.slice(0, 120).replace(/\s+/g, ' ')}`);
    }
  }
}

/**
 * Builds the in-memory rrm-auth database.
 * Foreign keys stay OFF to match D1 (see test/_d1-sqlite.mjs newDb()); nothing
 * here depends on referential integrity, but a mismatch would be a lie.
 */
export function buildSchemaDb(root = PROJECT_ROOT) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const errors = [];
  const loaded = [];
  applySchema(db, COMMUNITY_SCHEMA_SQL, errors);
  loaded.push('schema.sql + POST_SNAPSHOT_MIGRATIONS + ROOT_MIGRATIONS');
  for (const extra of EXTRA_DDL) {
    const abs = resolve(root, extra.path);
    if (!existsSync(abs)) {
      errors.push(`extra DDL file missing: ${extra.path}`);
      continue;
    }
    applySchema(db, readFileSync(abs, 'utf8'), errors);
    loaded.push(extra.path);
  }
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => String(r.name));
  return { db, errors, loaded, tables };
}

// ----------------------------------------------------- source extraction ----

/** Statement heads we treat as SQL. Requires a companion keyword so prose cannot match. */
const SQL_SHAPES = [
  /^\s*SELECT\b[\s\S]*\bFROM\b/i,
  /^\s*SELECT\s+(?:DISTINCT\s+)?(?:\d|'|"|COUNT\s*\()/i,
  /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\b/i,
  /^\s*REPLACE\s+INTO\b/i,
  /^\s*UPDATE\b[\s\S]*\bSET\b/i,
  /^\s*DELETE\s+FROM\b/i,
  /^\s*WITH\b[\s\S]*\bAS\s*\(/i,
];

/**
 * Ceiling on the string length this gate will shape-test. Nothing in the repo
 * needs 20k characters of SQL; what actually lives up there is embedded binary.
 * Exactly one oversized string exists in the tree as of 2026-07-31: the
 * 91,727-char base64 JPEG in functions/og/_cuterus-image.js.
 *
 * The limit stays, but the drop is now RECORDED as an `oversized` skip.
 * Silently discarding input is the exact failure mode this gate is built to
 * refuse: an uncounted skip is indistinguishable from a check that passed.
 *
 * The count is 0 today, and that is not a contradiction. _cuterus-image.js
 * contains no SELECT/INSERT/UPDATE/DELETE/REPLACE/WITH token anywhere, so
 * scan()'s file-level prefilter never opens it and the string never reaches
 * extraction. The prefilter is a sound absence proof - every SQL statement this
 * gate recognises must contain one of those keywords - so it is not the same
 * kind of silent drop. The skip record covers the reachable case: an oversized
 * string sharing a file with real SQL, where today the gate would have dropped
 * it with nothing written down.
 */
export const MAX_SQL_LEN = 20000;

export function looksLikeSql(text) {
  if (text.length > MAX_SQL_LEN) return false;
  const bare = stripComments(text);
  return SQL_SHAPES.some((re) => re.test(bare));
}

/** Walks an ESTree AST, calling cb(node, parent). */
function walk(node, cb, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  cb(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') walk(child, cb, node);
    } else if (value && typeof value.type === 'string') {
      walk(value, cb, node);
    }
  }
}

/**
 * The marker standing in for a runtime-valued fragment: a template
 * interpolation, or a non-literal operand of a `+` concatenation. Deliberately
 * ugly so it cannot collide with real SQL text. Rendered back as a visible
 * interpolation in reports.
 */
export const INTERP = '__SQLGATE_INTERP__';

/** Renders the internal marker back to something a human reads as an interpolation. */
export function displaySql(text) {
  return text.split(INTERP).join('${..}').replace(/\s+/g, ' ').trim();
}

/** Reads a Literal or TemplateLiteral as SQL text, marking interpolations. */
function nodeToSql(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return { text: node.value, interpolations: 0 };
  }
  if (node.type === 'TemplateLiteral') {
    let text = '';
    for (let i = 0; i < node.quasis.length; i++) {
      text += node.quasis[i].value.cooked ?? '';
      if (i < node.expressions.length) text += INTERP;
    }
    return { text, interpolations: node.expressions.length };
  }
  return null;
}

/**
 * Folds a `'a' + 'b' + expr` chain into one string, with every non-literal
 * operand replaced by the interpolation marker.
 *
 * Not a nicety: the admin course/section delete handlers - the exact family the
 * step_progress bug lived in - build their reference-guard SQL by concatenating
 * one clause per line. Without folding, the extractor sees only
 * `'DELETE FROM step_rendition WHERE step_id IN ('`, which cannot prepare
 * ("incomplete input") and would be SKIPPED. The gate would have been blind to
 * the very code that motivated it.
 */
export function foldConcat(node) {
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = foldConcat(node.left);
    const right = foldConcat(node.right);
    return { text: left.text + right.text, interpolations: left.interpolations + right.interpolations };
  }
  const direct = nodeToSql(node);
  if (direct) return direct;
  return { text: INTERP, interpolations: 1 };
}

/**
 * Extracts every SQL-shaped string literal from one JavaScript source.
 * Returns { statements, parseError }.
 */
export function extractSql(src, relPath) {
  let ast;
  let parseError = null;
  for (const sourceType of ['module', 'script']) {
    try {
      ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType, locations: true, allowReturnOutsideFunction: true });
      parseError = null;
      break;
    } catch (err) {
      parseError = err.message;
    }
  }
  if (!ast) return { statements: [], parseError };

  const parents = new Map();
  walk(ast, (n, p) => parents.set(n, p));

  // name -> initialiser source text, for resolving `const db = env.DB`
  const assignments = new Map();
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init) {
      if (!assignments.has(n.id.name)) assignments.set(n.id.name, src.slice(n.init.start, n.init.end));
    }
  });

  const statements = [];
  // Nodes already swallowed by a folded concatenation. walk() is pre-order, so
  // the outermost `+` is seen first and claims its operands before they are
  // visited on their own - otherwise `'DELETE FROM x WHERE id IN (' + ...` would
  // be reported a second time as its own truncated statement.
  const consumed = new Set();

  function receiverFor(node) {
    const parent = parents.get(node);
    if (
      parent &&
      parent.type === 'CallExpression' &&
      parent.callee.type === 'MemberExpression' &&
      parent.callee.property &&
      ['prepare', 'exec', 'run'].includes(parent.callee.property.name) &&
      parent.arguments.includes(node)
    ) {
      return src.slice(parent.callee.object.start, parent.callee.object.end);
    }
    return null;
  }

  /**
   * Reads an explicit database name off a `d1(<name>, <sql>)` helper call.
   *
   * scripts/femtech-ab-send.mjs is why this exists. It calls
   * `d1('rrm-auth', ...)` several times and `d1('femtech-mvp', ...)` once, for
   * a table (`waitlist`) that lives in a database this repo has no mirror of.
   * File-level attribution saw only the string "rrm-auth" and reported the
   * femtech query as a missing table: a false positive on correct code. The
   * per-call name is the truth and outranks everything else.
   */
  function explicitDbFor(node) {
    const parent = parents.get(node);
    if (!parent || parent.type !== 'CallExpression') return null;
    const idx = parent.arguments.indexOf(node);
    if (idx < 1) return null;
    const first = parent.arguments[0];
    if (!first || first.type !== 'Literal' || typeof first.value !== 'string') return null;
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(first.value)) return null;
    const calleeName =
      parent.callee.type === 'Identifier' ? parent.callee.name
        : parent.callee.type === 'MemberExpression' && parent.callee.property ? parent.callee.property.name
          : '';
    if (!/d1/i.test(calleeName)) return null;
    return first.value;
  }

  walk(ast, (n) => {
    if (consumed.has(n)) return;
    const isConcat = n.type === 'BinaryExpression' && n.operator === '+';
    const sql = isConcat ? foldConcat(n) : nodeToSql(n);
    if (!sql) return;
    // Over the shape-test ceiling: emit a statement carrying `oversized` so
    // scan() turns it into a counted skip. The text is truncated so --verbose
    // and --json stay readable; nothing downstream parses it.
    if (sql.text.length > MAX_SQL_LEN) {
      if (isConcat) walk(n, (child) => consumed.add(child));
      statements.push({
        file: relPath,
        line: n.loc.start.line,
        text: `${sql.text.slice(0, 120)}...`,
        interpolations: sql.interpolations,
        receiver: null,
        explicitDb: null,
        oversized: sql.text.length,
      });
      return;
    }
    if (!looksLikeSql(sql.text)) return;
    if (isConcat) walk(n, (child) => consumed.add(child));
    statements.push({
      file: relPath,
      line: n.loc.start.line,
      text: sql.text,
      interpolations: sql.interpolations,
      receiver: receiverFor(n),
      explicitDb: explicitDbFor(n),
    });
  });
  return { statements, assignments, parseError };
}

// ------------------------------------------------ database attribution -----

/** Reads binding -> database_name from wrangler.toml (the SSOT for CF bindings). */
export function readD1Bindings(root = PROJECT_ROOT) {
  const bindings = new Map();
  const abs = resolve(root, 'wrangler.toml');
  if (!existsSync(abs)) return bindings;
  const toml = readFileSync(abs, 'utf8');
  const blockRe = /\[\[d1_databases\]\]([\s\S]*?)(?=\n\[|\s*$)/g;
  let m;
  while ((m = blockRe.exec(toml)) !== null) {
    const binding = /binding\s*=\s*"([^"]+)"/.exec(m[1]);
    const name = /database_name\s*=\s*"([^"]+)"/.exec(m[1]);
    if (binding && name) bindings.set(binding[1], name[1]);
  }
  return bindings;
}

const D1_NAME_RE = /rrm-(?:survey-symptoms|survey|auth|library|analytics)/g;
export const AUTH_DB = 'rrm-auth';

/** Every D1 database name mentioned anywhere in a source file. */
export function fileDatabaseNames(src) {
  return new Set(src.match(D1_NAME_RE) ?? []);
}

/**
 * Resolves a `.prepare()` receiver expression to a D1 database name.
 * `env.DB` -> rrm-auth; `context.env.SURVEY_DB` -> rrm-survey; a bare `db`
 * follows its `const db = ...` initialiser, bounded to 3 hops.
 * Returns null when it cannot tell.
 */
export function resolveReceiver(receiver, assignments, bindings, depth = 0) {
  if (!receiver || depth > 3) return null;
  const segments = receiver.split('.').map((s) => s.trim()).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (bindings.has(segments[i])) return bindings.get(segments[i]);
  }
  if (segments.length === 1 && assignments && assignments.has(segments[0])) {
    return resolveReceiver(assignments.get(segments[0]), assignments, bindings, depth + 1);
  }
  return null;
}

/**
 * Decides which database a statement targets, or why it cannot be decided.
 * Order: the explicit prepare-receiver, then the file's D1 name mentions, then
 * the functions/ default (CF Pages Functions bind DB = rrm-auth per wrangler.toml).
 */
export function attributeDatabase(stmt, ctx) {
  if (stmt.explicitDb) return { db: stmt.explicitDb, how: 'explicit-d1-helper-argument' };

  const viaReceiver = resolveReceiver(stmt.receiver, ctx.assignments, ctx.bindings);
  if (viaReceiver) return { db: viaReceiver, how: 'binding' };

  const names = [...ctx.fileNames];
  if (names.length === 1) return { db: names[0], how: 'file-mentions-one-database' };
  if (names.length > 1) return { db: null, reason: `ambiguous-database (file mentions ${names.sort().join(', ')})` };

  if (ctx.relPath.startsWith('functions/')) {
    if (ctx.hasNonAuthBinding) {
      return { db: null, reason: 'ambiguous-database (file uses a non-DB binding and this statement has no resolvable receiver)' };
    }
    return { db: AUTH_DB, how: 'functions-default-DB-binding' };
  }
  return { db: null, reason: 'no-database-identified (script names no D1 database and has no resolvable binding)' };
}

// --------------------------------------------------------- preparation -----

/**
 * Rewrites a template interpolation marker as a bind placeholder.
 * `?` is legal wherever a VALUE goes - the right-hand side of a comparison, an
 * IN list, LIMIT, an inserted value - which is where most interpolations sit.
 * Where the interpolation was an identifier (a table, a column list, an ORDER
 * BY term) SQLite raises a syntax error and the statement is skipped.
 *
 * Substitution can never INVENT a missing identifier: `?` is not a name. So a
 * "no such column"/"no such table" surfaced after substitution is always about
 * literal text that was really in the source. It can only cause a MISS (an
 * identifier hidden inside the interpolation goes unchecked), never a false
 * positive - which is the trade this gate wants.
 */
export function substituteInterpolations(text) {
  return text.split(INTERP).join('?');
}

/**
 * SQLite's identifier-resolution failures, in the exact wordings it emits.
 * Each one is a HARD THROW AT PREPARE TIME: the statement can never run, so
 * every instance is a guaranteed 500 on its first caller. That, not the
 * wording, is what makes them findings rather than skips.
 *
 * Getting this list complete matters more than it looks. SQLite does not use
 * one phrase. An INSERT or REPLACE with an explicit column list reports
 * "table enrollment has no column named bogus" - it names neither "no such
 * column" nor "no such table" - so the original single-pattern MISSING_RE
 * downgraded it to an unpreparable skip. The gate caught the defect on SELECT,
 * UPDATE and DELETE and missed it on INSERT: a hole precisely where writes
 * happen, and precisely the shape of the step_progress bug that motivated the
 * gate. Verified against node:sqlite 2026-07-31:
 *
 *   SELECT bogus FROM enrollment                     -> no such column: bogus
 *   UPDATE enrollment SET bogus = ?                  -> no such column: bogus
 *   DELETE FROM enrollment WHERE bogus = ?           -> no such column: bogus
 *   ... ON CONFLICT DO UPDATE SET bogus = ?          -> no such column: bogus
 *   INSERT INTO enrollment (bogus) VALUES (?)        -> table enrollment has no column named bogus
 *   REPLACE INTO enrollment (bogus) VALUES (?)       -> table enrollment has no column named bogus
 *   SELECT 1 FROM nope                               -> no such table: nope
 *   SELECT user_id FROM enrollment JOIN step_progress ON ...
 *                                                    -> ambiguous column name: user_id
 *
 * `table` is filled in only where SQLite hands it to us (the INSERT wording);
 * the others do not name a table and it stays null rather than being guessed.
 *
 * DELIBERATELY NOT PROMOTED: "N values for M columns" (INSERT arity). It is a
 * real prepare-time throw, but `?` substitution collapses a spread placeholder
 * list into a single `?`, so it fires on correct code - two live instances in
 * scripts/migrate-courses-to-d1.mjs. Promoting it would trade a true-negative
 * hole for false positives on working code. It stays a counted skip.
 */
export const FINDING_PATTERNS = [
  {
    // "no such column: x" / "no such table: main.x"
    re: /no such (column|table)\s*:\s*(\S+)/i,
    read: (m) => ({ kind: m[1].toLowerCase(), identifier: m[2], table: null }),
  },
  {
    // INSERT/REPLACE with an explicit column list.
    re: /table\s+(\S+)\s+has no column named\s+(\S+)/i,
    read: (m) => ({ kind: 'column', identifier: m[2], table: m[1] }),
  },
  {
    // A JOIN naming a column that resolves in more than one of its tables.
    re: /ambiguous column name\s*:\s*(\S+)/i,
    read: (m) => ({ kind: 'ambiguous-column', identifier: m[1], table: null }),
  },
];

/** Trims the punctuation SQLite sometimes trails on an identifier. */
function cleanIdent(s) {
  return String(s).replace(/[.,;:'"`)]+$/, '');
}

/**
 * One line of human-readable finding text, shared by the console report, the
 * JSON output and the tests so they can never describe a finding differently.
 * Names the table whenever SQLite told us which one.
 */
export function describeFinding(f) {
  if (f.kind === 'ambiguous-column') {
    return `ambiguous column name: ${f.identifier}${f.table ? ` (table ${f.table})` : ''} - resolves in more than one table of this statement`;
  }
  if (f.kind === 'column' && f.table) {
    return `no such column: ${f.identifier} (table ${f.table} has no column named ${f.identifier})`;
  }
  return `no such ${f.kind}: ${f.identifier}`;
}

/**
 * PREPAREs one statement. Returns
 *   { status: 'checked' }                              - it prepared
 *   { status: 'finding', kind, identifier, table, message }
 *   { status: 'skipped', reason }
 */
export function checkStatement(db, stmt) {
  const raw = stmt.text;
  const parts = splitStatements(raw);
  if (parts.length > 1) return { status: 'skipped', reason: 'multi-statement string' };
  const sql = substituteInterpolations(parts[0] ?? raw);
  try {
    db.prepare(sql);
    return { status: 'checked' };
  } catch (err) {
    const message = String(err.message || err);
    for (const pattern of FINDING_PATTERNS) {
      const m = pattern.re.exec(message);
      if (!m) continue;
      const { kind, identifier, table } = pattern.read(m);
      return { status: 'finding', kind, identifier: cleanIdent(identifier), table: table ? cleanIdent(table) : null, message };
    }
    if (stmt.interpolations > 0) {
      return { status: 'skipped', reason: `interpolated (unpreparable after placeholder substitution: ${message})` };
    }
    return { status: 'skipped', reason: `unpreparable (${message})` };
  }
}

// ------------------------------------------------------------ file scan ----

export const SCAN_ROOTS = [
  { dir: 'functions', quick: true },
  { dir: 'scripts', quick: false },
  { dir: 'src/lib', quick: false },
];

const SOURCE_EXT = /\.(m?js)$/;
const SKIP_FILE = /\.(test|spec)\.m?js$/;

export function listSources(root = PROJECT_ROOT, { quick = false } = {}) {
  const out = [];
  for (const spec of SCAN_ROOTS) {
    if (quick && !spec.quick) continue;
    const base = resolve(root, spec.dir);
    if (!existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(abs);
        else if (SOURCE_EXT.test(entry.name) && !SKIP_FILE.test(entry.name)) out.push(abs);
      }
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------- gates ----

function pass(msg) { return { ok: true, msg }; }
function fail(msg) { return { ok: false, msg }; }
function warn(msg) { return { ok: null, msg }; }

/**
 * Runs the scan. Pure: returns data, prints nothing.
 * @param {object} [opts]
 * @param {string} [opts.root]  repo root (tests point this at a fixture tree)
 * @param {boolean} [opts.quick] functions/ only
 * @param {string[]} [opts.files] absolute paths to scan INSTEAD of the roots
 */
export function scan({ root = PROJECT_ROOT, quick = false, files = null } = {}) {
  const { db, errors, tables } = buildSchemaDb(root);
  const bindings = readD1Bindings(root);
  const sources = files ?? listSources(root, { quick });

  const findings = [];
  const skips = [];
  const parseFailures = [];
  let checked = 0;
  let statementsSeen = 0;

  for (const abs of sources) {
    const relPath = relative(root, abs);
    const src = readFileSync(abs, 'utf8');
    if (!/\b(SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i.test(src)) continue;
    const { statements, assignments, parseError } = extractSql(src, relPath);
    if (parseError) {
      parseFailures.push({ file: relPath, message: parseError });
      continue;
    }
    if (!statements.length) continue;
    const fileNames = fileDatabaseNames(src);
    const hasNonAuthBinding = [...bindings.keys()].some(
      (b) => bindings.get(b) !== AUTH_DB && new RegExp(`\\b${b}\\b`).test(src)
    );
    const ctx = { assignments, bindings, fileNames, relPath, hasNonAuthBinding };

    for (const stmt of statements) {
      statementsSeen++;
      if (stmt.oversized) {
        skips.push({ ...stmt, reason: `oversized (${stmt.oversized}-char string, above the ${MAX_SQL_LEN}-char limit; never shape-tested for SQL)` });
        continue;
      }
      const target = attributeDatabase(stmt, ctx);
      if (!target.db) {
        skips.push({ ...stmt, reason: target.reason });
        continue;
      }
      if (target.db !== AUTH_DB) {
        skips.push({ ...stmt, reason: `other-database (${target.db}; schema.sql mirrors ${AUTH_DB} only)` });
        continue;
      }
      const result = checkStatement(db, stmt);
      if (result.status === 'checked') { checked++; continue; }
      if (result.status === 'skipped') { skips.push({ ...stmt, reason: result.reason }); continue; }
      findings.push({
        file: stmt.file,
        line: stmt.line,
        kind: result.kind,
        identifier: result.identifier,
        table: result.table,
        message: result.message,
        sql: displaySql(stmt.text).slice(0, 200),
      });
    }
  }
  db.close();

  return { findings, skips, parseFailures, checked, statementsSeen, tables, schemaErrors: errors, fileCount: sources.length };
}

/** Groups skip reasons into the buckets the report prints. */
export function skipBuckets(skips) {
  const buckets = new Map();
  for (const s of skips) {
    const key = s.reason.replace(/\s*\(.*$/s, '');
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => b[1] - a[1]);
}

export function runGates(result, { quick = false } = {}) {
  const gates = [];

  // ---- SQ1: the schema actually loaded ------------------------------------
  const sq1 = [];
  for (const err of result.schemaErrors) sq1.push(fail(`schema load error: ${err}`));
  const present = new Set(result.tables);
  const missing = SENTINEL_TABLES.filter((t) => !present.has(t));
  if (missing.length) {
    sq1.push(fail(`composed schema is missing sentinel table(s): ${missing.join(', ')} - the DDL loader dropped statements, every check below is unreliable`));
  } else {
    sq1.push(pass(`all ${SENTINEL_TABLES.length} sentinel tables present`));
  }
  if (result.tables.length < MIN_TABLES) {
    sq1.push(fail(`composed schema has ${result.tables.length} tables, floor is ${MIN_TABLES}`));
  } else {
    sq1.push(pass(`composed schema has ${result.tables.length} tables (floor ${MIN_TABLES})`));
  }
  gates.push({ id: 'SQ1', name: 'Composed rrm-auth schema loaded intact', items: sq1 });

  // ---- SQ2: every attributed statement prepares ---------------------------
  const sq2 = [];
  for (const f of result.parseFailures) {
    sq2.push(fail(`could not parse ${f.file}: ${f.message} - its SQL was NOT checked`));
  }
  if (result.findings.length === 0) {
    sq2.push(pass(`${result.checked} statement(s) prepared against ${AUTH_DB}; 0 named a nonexistent column or table`));
  } else {
    for (const f of result.findings) {
      sq2.push(fail(`${f.file}:${f.line} ${describeFinding(f)}\n${f.sql}`));
    }
  }
  gates.push({ id: 'SQ2', name: `Every static ${AUTH_DB} statement PREPAREs`, items: sq2 });

  // ---- SQ3: coverage meta-assertion ---------------------------------------
  const sq3 = [];
  const buckets = skipBuckets(result.skips);
  const pct = result.statementsSeen ? ((result.checked / result.statementsSeen) * 100).toFixed(1) : '0.0';
  sq3.push(warn(`${result.checked}/${result.statementsSeen} SQL strings prepared (${pct}%) across ${result.fileCount} source file(s)`));
  for (const [reason, count] of buckets) sq3.push(warn(`skipped ${count}: ${reason}`));
  if (quick) {
    sq3.push(warn(`--quick: functions/ only, so the ${MIN_PREPARED}-statement floor is not enforced`));
  } else if (result.checked < MIN_PREPARED) {
    sq3.push(fail(`only ${result.checked} statement(s) prepared, floor is ${MIN_PREPARED} - the extractor or the attribution broke and this gate is passing vacuously`));
  } else {
    sq3.push(pass(`prepared-statement floor met: ${result.checked} >= ${MIN_PREPARED}`));
  }
  gates.push({ id: 'SQ3', name: 'Coverage meta-assertion (no vacuous pass)', items: sq3 });

  return gates;
}

// ----------------------------------------------------------------- CLI -----

export function main(argv = process.argv.slice(2), out = console) {
  const quick = argv.includes('--quick');
  const json = argv.includes('--json');
  const verbose = argv.includes('--verbose');
  const gateIdx = argv.indexOf('--gate');
  const only = gateIdx >= 0 ? argv[gateIdx + 1] : null;

  let result;
  try {
    result = scan({ quick });
  } catch (err) {
    out.error(`FATAL: ${err.message}`);
    return 2;
  }

  const gates = runGates(result, { quick }).filter((g) => !only || g.id === only);
  const failed = gates.filter((g) => g.items.some((i) => i.ok === false));

  if (json) {
    out.log(JSON.stringify({
      summary: {
        total: gates.length,
        passed: gates.length - failed.length,
        failed: failed.length,
        checked: result.checked,
        statementsSeen: result.statementsSeen,
        skipped: result.skips.length,
      },
      findings: result.findings,
      skipBuckets: skipBuckets(result.skips).map(([reason, count]) => ({ reason, count })),
      gates: gates.map((g) => ({ id: g.id, name: g.name, pass: !g.items.some((i) => i.ok === false), checks: g.items })),
    }, null, 2));
    return failed.length === 0 ? 0 : 1;
  }

  out.log(`${BOLD}RRM Academy - SQL column/table existence gates${RESET}`);
  if (quick) out.log(`${YELLOW}Mode: --quick (functions/ only)${RESET}`);
  if (only) out.log(`${YELLOW}Mode: --gate ${only} only${RESET}`);
  for (const g of gates) {
    out.log(`\n${BOLD}Gate ${g.id}: ${g.name}${RESET}`);
    for (const item of g.items) {
      const icon = item.ok === true ? `${GREEN}PASS${RESET}` : item.ok === false ? `${RED}FAIL${RESET}` : `${YELLOW}INFO${RESET}`;
      const lines = item.msg.split('\n');
      out.log(`  ${icon} ${lines[0]}`);
      for (const l of lines.slice(1)) out.log(`       ${l}`);
    }
  }
  if (verbose && result.skips.length) {
    out.log(`\n${BOLD}Skipped statements (${result.skips.length})${RESET}`);
    for (const s of result.skips) {
      out.log(`  ${s.file}:${s.line} ${s.reason}`);
      out.log(`       ${s.text.replace(/\s+/g, ' ').trim().slice(0, 160)}`);
    }
  }
  out.log('');
  if (failed.length === 0) {
    out.log(`${GREEN}${BOLD}OK: all ${gates.length} SQL column gate(s) passed${RESET}`);
  } else {
    out.log(`${RED}${BOLD}FAIL: ${failed.length}/${gates.length} SQL column gate(s) failed${RESET}`);
  }
  return failed.length === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) process.exit(main());
