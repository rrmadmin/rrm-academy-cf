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
import { writeFileSync, unlinkSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// --- Detect main-vs-import ---
// When imported (e.g. by the parity test), skip arg parsing/validation so
// `computeWordCount` can be used as a pure function.
const IS_MAIN = process.argv[1]
  ? (import.meta.url.endsWith(process.argv[1]) || process.argv[1].endsWith('compute-word-counts.mjs'))
  : false;

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
// Math.max(1, ...) guards against --batch-size=0 (infinite loop in the chunker)
// and --batch-size=-N (no progress). Number.isFinite catches NaN from
// non-numeric strings (e.g. --batch-size=abc). Result: always >=1.
const _bsRaw = parseInt(args['batch-size'], 10);
const BATCH_SIZE = Math.max(1, Number.isFinite(_bsRaw) ? _bsRaw : 50);

function die(msg, code = 1) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

if (IS_MAIN) {
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
}

// --- Word count algorithm ---

export function computeWordCount(text, { stripHtml = false } = {}) {
  if (text == null) return 0;
  // Defense-in-depth: non-string inputs (numbers, objects, arrays, booleans)
  // would coerce silently via String() and produce surprising counts. Reject.
  if (typeof text !== 'string') return 0;
  let s = text;
  if (stripHtml) {
    // Tags collapse to a space (word boundary). Entities collapse to EMPTY
    // string so `P&amp;C` reads as `P&C` -> 1 word, not `P C` -> 2 words,
    // matching how a browser renders the same HTML to the user.
    //
    // Malformed HTML caveat: `<[^>]+>` cannot match unclosed tags like
    // `<p>hello world` (no closing `>`). Such input counts the literal
    // `<p>hello` as one token; the regex degrades gracefully and the result
    // is one-word inflation rather than a parse error. Accept this — it's
    // rare in our corpora and the alternative (a full HTML parser) is not
    // worth the dependency.
    s = s.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, '');
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
  // 120s timeout + SIGKILL: fail-fast on auth hang or network stall. Without a
  // timeout, an interactive wrangler login prompt or hung remote could pause
  // the backfill indefinitely.
  const res = spawnSync('wrangler', argv, {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120_000,
    killSignal: 'SIGKILL',
  });
  if (res.signal) {
    throw new Error(`wrangler d1 execute timed out after 120s (signal: ${res.signal}). ` +
      'Check auth (`wrangler whoami`) or remote D1 health.');
  }
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').slice(0, 2000);
    throw new Error(`wrangler d1 execute failed (exit=${res.status}):\n${detail}`);
  }
  if (!json) return res.stdout;
  // wrangler --json prints an array of result envelopes; the first is the
  // statement result. results[].results is the row array. Wrangler can emit
  // warning lines before the JSON body (e.g. "Using vars defined in .env"),
  // so strip everything before the first `[` or `{` to avoid JSON.parse blowups.
  try {
    const s = res.stdout;
    const arrStart = s.indexOf('[');
    const objStart = s.indexOf('{');
    const jsonStart = (arrStart === -1 || (objStart !== -1 && objStart < arrStart))
      ? objStart
      : arrStart;
    if (jsonStart < 0) {
      throw new Error(`wrangler output contains no JSON: ${s.slice(0, 500)}`);
    }
    const out = JSON.parse(s.slice(jsonStart));
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
  const updates = []; // { id, new_wc, prev_wc }
  let unchanged = 0;
  const allCounts = [];
  for (const r of rows) {
    const newWc = computeWordCount(r.text, { stripHtml: STRIP_HTML });
    allCounts.push(newWc);
    const cur = r.current_wc;
    if (cur === newWc) {
      unchanged += 1;
    } else {
      updates.push({ id: r.id, new_wc: newWc, prev_wc: cur });
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
  //
  // Race guard: each UPDATE is gated on `word_count IS NULL OR word_count = ?`
  // bound to the value we SELECTed. If a writer (worker, admin endpoint)
  // wrote a fresh count between our SELECT and our UPDATE, the row no-ops
  // and the next backfill picks it up. Stale backfill never overwrites a
  // fresh worker write.
  //
  // Retry: each batch retries up to 2x with 1s/3s backoff before counting as
  // a failure. After 3 consecutive batch failures, abort the whole run.
  //
  // Sidecar: failing batches' [ids] are appended to a JSON-lines file under
  // ~/iCode/.audit/ so Brian can re-run just those rows.
  console.log(`\nWriting ${updates.length} updates in batches of ${BATCH_SIZE}...`);
  let errors = 0;
  let updated = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  const auditDir = join(homedir(), 'iCode', '.audit');
  const sidecarPath = join(
    auditDir,
    `word-count-errors-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  let sidecarInitialized = false;
  function appendSidecar(record) {
    if (!sidecarInitialized) {
      try { mkdirSync(auditDir, { recursive: true }); } catch { /* ignore */ }
      sidecarInitialized = true;
    }
    try {
      appendFileSync(sidecarPath, JSON.stringify(record) + '\n');
    } catch (err) {
      console.error(`(sidecar append failed: ${err.message})`);
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const lines = ['BEGIN;'];
    for (const u of batch) {
      // Race-guarded UPDATE: only writes if word_count is still NULL or
      // matches what we SELECTed. NULL handling is explicit (IS NULL, not
      // = NULL) per SQL discipline rule 7.
      const newWc = sqlIntOrNull(u.new_wc);
      const idLit = sqlText(u.id);
      const guard = (u.prev_wc == null)
        ? `word_count IS NULL`
        : `word_count = ${sqlIntOrNull(u.prev_wc)}`;
      lines.push(
        `UPDATE ${TABLE} SET word_count = ${newWc} WHERE ${ID_COL} = ${idLit} AND (${guard});`
      );
    }
    lines.push('COMMIT;');
    const tmpPath = join(tmpdir(), `word-count-batch-${process.pid}-${i}.sql`);
    writeFileSync(tmpPath, lines.join('\n'));

    const backoffMs = [0, 1000, 3000];
    let lastErr = null;
    let succeeded = false;
    for (let attempt = 0; attempt < backoffMs.length; attempt += 1) {
      if (backoffMs[attempt] > 0) {
        await sleep(backoffMs[attempt]);
      }
      try {
        wranglerExec({ file: tmpPath, json: false });
        succeeded = true;
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    try { unlinkSync(tmpPath); } catch { /* ignore */ }

    if (succeeded) {
      updated += batch.length;
      consecutiveFailures = 0;
      process.stdout.write(`\r  updated ${updated}/${updates.length}`);
    } else {
      errors += batch.length;
      consecutiveFailures += 1;
      const ids = batch.map(b => b.id);
      console.error(
        `\nbatch ${i}..${i + batch.length} FAILED after 3 attempts: ${lastErr?.message || 'unknown'}`
      );
      appendSidecar({
        timestamp: new Date().toISOString(),
        db: DB,
        table: TABLE,
        batch_start: i,
        batch_end: i + batch.length,
        ids,
        error: lastErr?.message?.slice(0, 1000) || 'unknown',
      });
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        process.stdout.write('\n');
        console.error(
          `\nABORT: ${consecutiveFailures} consecutive batch failures. ` +
          `Stopping run. Failed IDs written to ${sidecarPath}`
        );
        summary.updated = updated;
        summary.errors = errors;
        summary.aborted_after_consecutive_failures = consecutiveFailures;
        summary.sidecar = sidecarPath;
        console.log(JSON.stringify(summary, null, 2));
        process.exit(1);
      }
    }
  }
  process.stdout.write('\n');

  summary.updated = updated;
  summary.errors = errors;
  if (errors > 0) summary.sidecar = sidecarPath;
  console.log(JSON.stringify(summary, null, 2));

  if (errors > 0) process.exit(1);
}

// Run if invoked directly (IS_MAIN computed near the top of the file).
if (IS_MAIN) {
  main().catch(err => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
