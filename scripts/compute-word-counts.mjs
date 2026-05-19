#!/usr/bin/env node
/**
 * compute-word-counts.mjs
 *
 * Generic word_count backfill for any D1-backed content table. Reads a text
 * column, computes word count (HTML-stripped if requested), and writes back to
 * a `word_count INTEGER` column. Idempotent: only writes rows whose value
 * changed.
 *
 * Drives programmatic thin-page detection on rrmacademy.org. The library
 * template at src/pages/library/[...slug].astro reads article.word_count and
 * emits <meta name="robots" content="noindex"> when below threshold. Replaces
 * the legacy `abstract.trim().length < 30` heuristic.
 *
 * Usage:
 *   node scripts/compute-word-counts.mjs \
 *     --db=<rrm-library|rrm-auth> \
 *     --table=<articles|glossary_term> \
 *     --id-col=<id> \
 *     --text-col=<abstract|body_html> \
 *     [--strip-html] \
 *     [--remote] \
 *     [--dry-run] \
 *     [--batch-size=50]
 *
 * Examples:
 *   # Dry run against prod (no writes)
 *   node scripts/compute-word-counts.mjs --db=rrm-library --table=articles \
 *     --id-col=id --text-col=abstract --remote --dry-run
 *
 *   # Backfill articles on prod
 *   node scripts/compute-word-counts.mjs --db=rrm-library --table=articles \
 *     --id-col=id --text-col=abstract --remote
 *
 *   # Backfill glossary on prod (HTML-stripped)
 *   node scripts/compute-word-counts.mjs --db=rrm-auth --table=glossary_term \
 *     --id-col=id --text-col=body_html --strip-html --remote
 *
 * Word count algorithm:
 *   - Optional: strip HTML tags (`<[^>]+>` -> space) + HTML entities
 *     (`&[a-z#0-9]+;` -> space) when --strip-html is set
 *   - Collapse whitespace, trim
 *   - Count = `text.trim().split(/\s+/).filter(Boolean).length`
 *   - Empty / null text -> 0
 *   - Counts numbers, hyphenated words, abbreviations as single tokens
 *
 * Safety:
 *   - --dry-run computes + summarizes only. NEVER writes.
 *   - --remote writes to prod D1. Without it, writes to local D1.
 *   - Compares current vs new; only updates if changed.
 *   - Batches UPDATEs (default 50/batch) to stay under D1 statement size.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Args ---

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length === 0 ? true : rest.join('=')];
  })
);

const DB = args.db;
const TABLE = args.table;
const ID_COL = args['id-col'];
const TEXT_COL = args['text-col'];
const STRIP_HTML = !!args['strip-html'];
const REMOTE = !!args.remote;
const DRY_RUN = !!args['dry-run'];
const BATCH_SIZE = parseInt(args['batch-size'] || '50', 10);

function die(msg, code = 1) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

if (!DB) die('--db=<rrm-library|rrm-auth> required');
if (!TABLE) die('--table=<articles|glossary_term> required');
if (!ID_COL) die('--id-col=<id> required');
if (!TEXT_COL) die('--text-col=<abstract|body_html> required');

// Lightweight identifier validation (D1 wrangler will reject SQL injection,
// but we don't want surprise table names blowing up partway through).
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
for (const [k, v] of Object.entries({ table: TABLE, 'id-col': ID_COL, 'text-col': TEXT_COL })) {
  if (!IDENT_RE.test(v)) die(`--${k} must be a SQL identifier (got: ${v})`);
}

const ALLOWED_DBS = new Set(['rrm-library', 'rrm-auth']);
if (!ALLOWED_DBS.has(DB)) die(`--db must be one of: ${[...ALLOWED_DBS].join(', ')}`);

// --- Word count algorithm ---

export function computeWordCount(text, { stripHtml = false } = {}) {
  if (text == null) return 0;
  let s = String(text);
  if (stripHtml) {
    s = s.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return 0;
  return s.split(/\s+/).filter(Boolean).length;
}

// --- wrangler subprocess ---

function wranglerExec({ command, file, json = true }) {
  const argv = ['d1', 'execute', DB];
  if (REMOTE) argv.push('--remote');
  if (json) argv.push('--json');
  if (file) {
    argv.push('--file', file);
  } else {
    argv.push('--command', command);
  }
  const res = spawnSync('wrangler', argv, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').slice(0, 2000);
    throw new Error(`wrangler d1 execute failed (exit=${res.status}):\n${detail}`);
  }
  if (!json) return res.stdout;
  // wrangler --json prints an array of result envelopes; the first is the
  // statement result. results[].results is the row array.
  try {
    const out = JSON.parse(res.stdout);
    const envelope = Array.isArray(out) ? out[0] : out;
    return envelope?.results || [];
  } catch (err) {
    throw new Error(`failed to parse wrangler JSON: ${err.message}\nstdout: ${res.stdout.slice(0, 500)}`);
  }
}

// --- SQL escaping for batch UPDATE temp file ---

function sqlIntOrNull(n) {
  if (n == null || Number.isNaN(n)) return 'NULL';
  return String(Math.trunc(n));
}

function sqlText(s) {
  if (s == null) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

// --- Stats ---

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// --- Main ---

async function main() {
  console.log(`compute-word-counts: db=${DB} table=${TABLE} id=${ID_COL} text=${TEXT_COL} ` +
    `stripHtml=${STRIP_HTML} remote=${REMOTE} dryRun=${DRY_RUN} batchSize=${BATCH_SIZE}`);

  // Read all rows (id + text + current word_count)
  const selectSql = `SELECT ${ID_COL} AS id, ${TEXT_COL} AS text, word_count AS current_wc FROM ${TABLE}`;
  console.log(`\nReading ${TABLE}...`);
  const rows = wranglerExec({ command: selectSql });
  console.log(`  ${rows.length} rows`);

  // Compute new word_count for each row
  const updates = []; // { id, new_wc }
  let unchanged = 0;
  const allCounts = [];
  for (const r of rows) {
    const newWc = computeWordCount(r.text, { stripHtml: STRIP_HTML });
    allCounts.push(newWc);
    const cur = r.current_wc;
    if (cur === newWc) {
      unchanged += 1;
    } else {
      updates.push({ id: r.id, new_wc: newWc });
    }
  }

  // Stats
  allCounts.sort((a, b) => a - b);
  const summary = {
    table: TABLE,
    total_rows: rows.length,
    updated: 0,
    unchanged,
    pending_updates: updates.length,
    errors: 0,
    p25: percentile(allCounts, 25),
    p50: percentile(allCounts, 50),
    p75: percentile(allCounts, 75),
    p99: percentile(allCounts, 99),
    max: allCounts[allCounts.length - 1] || 0,
    thin_lt_30: allCounts.filter(c => c < 30).length,
    thin_lt_100: allCounts.filter(c => c < 100).length,
  };

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] would update ${updates.length} rows, ${unchanged} unchanged`);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (updates.length === 0) {
    console.log(`\nNothing to update. ${unchanged} rows already match.`);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Batch UPDATEs via temp SQL file (one UPDATE per row inside a transaction).
  // Wrangler's --command has a length limit and --file is the safer path for
  // larger backfills. We chunk by BATCH_SIZE to keep per-file size reasonable
  // and to surface progress.
  console.log(`\nWriting ${updates.length} updates in batches of ${BATCH_SIZE}...`);
  let errors = 0;
  let updated = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const lines = ['BEGIN;'];
    for (const u of batch) {
      lines.push(
        `UPDATE ${TABLE} SET word_count = ${sqlIntOrNull(u.new_wc)} WHERE ${ID_COL} = ${sqlText(u.id)};`
      );
    }
    lines.push('COMMIT;');
    const tmpPath = join(tmpdir(), `word-count-batch-${process.pid}-${i}.sql`);
    writeFileSync(tmpPath, lines.join('\n'));
    try {
      wranglerExec({ file: tmpPath, json: false });
      updated += batch.length;
      process.stdout.write(`\r  updated ${updated}/${updates.length}`);
    } catch (err) {
      errors += batch.length;
      console.error(`\nbatch ${i}..${i + batch.length} FAILED: ${err.message}`);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
  process.stdout.write('\n');

  summary.updated = updated;
  summary.errors = errors;
  console.log(JSON.stringify(summary, null, 2));

  if (errors > 0) process.exit(1);
}

// Run if invoked directly
const isMain = import.meta.url.endsWith(process.argv[1]) || process.argv[1].endsWith('compute-word-counts.mjs');
if (isMain) {
  main().catch(err => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
