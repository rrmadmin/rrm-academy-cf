#!/usr/bin/env node
/**
 * audit-author-coverage.mjs — Generate per-author work queues for the top
 * RRM/NaPro author corpus closeout campaign.
 *
 * For each author, queries D1 and emits two CSVs:
 *   <out>/<author>-tier-a.csv — published, rel>=3, has fulltext, zero facts
 *   <out>/<author>-tier-b.csv — published, rel>=3, no fulltext
 *
 * Also prints distinct authors strings to stderr for spot-checking.
 *
 * Usage:
 *   node scripts/audit-author-coverage.mjs --author stanford --out /tmp/audit-test
 *   node scripts/audit-author-coverage.mjs --all
 *   node scripts/audit-author-coverage.mjs --all --out scripts/out/
 */

import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const D1_NAME = 'rrm-library';
const D1_MAX_BUFFER = 64 * 1024 * 1024;

const PRIORITY_AUTHORS = [
  'stanford',
  'prior',
  'fehring',
  'vigil',
  'yeung',
  'billings',
  'boyle',
  'whittaker',
  'mirkes',
  'redwine',
];

// ---------- CLI ----------
const argv = process.argv.slice(2);

const authorIdx = argv.indexOf('--author');
const rawAuthor = authorIdx >= 0 ? argv[authorIdx + 1] : null;
const useAll = argv.includes('--all');
const outIdx = argv.indexOf('--out');
const outDir = outIdx >= 0 ? argv[outIdx + 1] : join(PROJECT_ROOT, 'scripts/out');

if (!useAll && !rawAuthor) {
  console.error('Usage: --author <lastname> | --all  [--out <dir>]');
  process.exit(1);
}

// Validate last name: alphanumeric + hyphen only, max 30 chars.
// Must start with a letter and end with a letter or digit (or be a single letter)
// — rejects pure-hyphen names, leading/trailing hyphens, and bare digits.
function validateLastname(name) {
  if (typeof name !== 'string') return null;
  const cleaned = name.toLowerCase().trim();
  if (!/^[a-z][a-z0-9-]{0,28}[a-z0-9]$|^[a-z]$/.test(cleaned)) return null;
  return cleaned;
}

let targets;
if (useAll) {
  targets = PRIORITY_AUTHORS;
} else {
  const validated = validateLastname(rawAuthor);
  if (!validated) {
    console.error(`Invalid --author value: "${rawAuthor}". Must be alphanumeric + hyphen, max 30 chars.`);
    process.exit(1);
  }
  targets = [validated];
}

// ---------- D1 query helper ----------
function d1Query(sql) {
  let raw;
  try {
    raw = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', D1_NAME, '--remote', '--json', `--command=${sql}`],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: D1_MAX_BUFFER }
    ).toString();
  } catch (err) {
    throw new Error(`wrangler failed: ${String(err.message || err).slice(0, 400)}`);
  }
  // Find the last line that starts with '[' (the JSON array wrangler emits at end).
  // Greedy match-from-anywhere would break if wrangler ever logs a line containing '['
  // before the JSON payload (banners, warnings).
  const lines = raw.split('\n');
  let jsonStart = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('[')) { jsonStart = i; break; }
  }
  if (jsonStart === -1) {
    throw new Error(`d1_query_parse_error: no JSON array in wrangler output. First 300 chars: ${raw.slice(0, 300)}`);
  }
  const jsonStr = lines.slice(jsonStart).join('\n');
  const parsed = JSON.parse(jsonStr);
  return parsed[0]?.results || [];
}

// ---------- CSV helpers ----------
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function rowsToCsv(rows, columns) {
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c])).join(','));
  return [header, ...lines].join('\n') + '\n';
}

const CSV_COLUMNS = ['id', 'title', 'year', 'doi', 'pmid', 'rrm_relevance', 'domain'];

// ---------- Write CSV atomically ----------
function writeCsv(path, rows) {
  const content = rowsToCsv(rows, CSV_COLUMNS);
  const tmp = path + '.tmp';
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, path);
}

// ---------- Process one author ----------
function processAuthor(lastname) {
  // lastname is already validated: lowercase alphanumeric + hyphen, max 30 chars.
  // Safe to embed in LIKE pattern (no SQL metachar risk beyond % which we control).
  const likePattern = `%${lastname}%`;

  // Distinct authors strings for spot-check -- print to stderr.
  let distinctAuthors;
  try {
    distinctAuthors = d1Query(
      `SELECT DISTINCT authors FROM articles WHERE LOWER(authors) LIKE '${likePattern}' AND status = 'published' ORDER BY authors`
    );
  } catch (err) {
    console.error(`[${lastname}] WARN: distinct authors query failed: ${err.message}`);
    distinctAuthors = [];
  }

  if (distinctAuthors.length === 0) {
    console.error(`[${lastname}] WARNING: no published articles matched LOWER(authors) LIKE '${likePattern}'`);
  } else {
    console.error(`\n[${lastname}] Distinct authors strings (spot-check):`);
    for (const row of distinctAuthors) {
      console.error(`  ${row.authors}`);
    }
  }

  // Tier A: published, rel>=3, has fulltext, zero facts.
  let tierA;
  try {
    tierA = d1Query(
      `SELECT a.id, a.title, a.year, a.doi, a.pmid, a.rrm_relevance, a.domain ` +
      `FROM articles a ` +
      `JOIN article_bodies ab ON ab.article_id = a.id ` +
      `LEFT JOIN (SELECT DISTINCT source_id FROM facts) f ON f.source_id = a.id ` +
      `WHERE LOWER(a.authors) LIKE '${likePattern}' ` +
      `AND a.status = 'published' ` +
      `AND a.rrm_relevance >= 3 ` +
      `AND f.source_id IS NULL ` +
      `ORDER BY COALESCE(a.year, 0) DESC, a.id`
    );
  } catch (err) {
    console.error(`[${lastname}] Tier A query FAILED: ${err.message}`);
    return null;
  }

  // Tier B: published, rel>=3, no fulltext.
  let tierB;
  try {
    tierB = d1Query(
      `SELECT a.id, a.title, a.year, a.doi, a.pmid, a.rrm_relevance, a.domain ` +
      `FROM articles a ` +
      `LEFT JOIN article_bodies ab ON ab.article_id = a.id ` +
      `WHERE LOWER(a.authors) LIKE '${likePattern}' ` +
      `AND a.status = 'published' ` +
      `AND a.rrm_relevance >= 3 ` +
      `AND ab.article_id IS NULL ` +
      `ORDER BY COALESCE(a.year, 0) DESC, a.id`
    );
  } catch (err) {
    console.error(`[${lastname}] Tier B query FAILED: ${err.message}`);
    return null;
  }

  return { tierA, tierB };
}

// ---------- Main ----------

// Ensure output directory exists.
if (!existsSync(outDir)) {
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create output directory "${outDir}": ${err.message}`);
    process.exit(1);
  }
}

const summaryRows = [];
let anyFailure = false;

for (const lastname of targets) {
  console.log(`\nProcessing: ${lastname}`);
  const result = processAuthor(lastname);

  if (!result) {
    console.error(`[${lastname}] FAILED — skipping CSV write.`);
    anyFailure = true;
    continue;
  }

  const { tierA, tierB } = result;

  const tierAPath = join(outDir, `${lastname}-tier-a.csv`);
  const tierBPath = join(outDir, `${lastname}-tier-b.csv`);

  try {
    writeCsv(tierAPath, tierA);
  } catch (err) {
    console.error(`[${lastname}] Failed to write Tier A CSV: ${err.message}`);
    anyFailure = true;
    continue;
  }

  try {
    writeCsv(tierBPath, tierB);
  } catch (err) {
    console.error(`[${lastname}] Failed to write Tier B CSV: ${err.message}`);
    anyFailure = true;
    continue;
  }

  if (tierA.length === 0) {
    console.log(`  [${lastname}] WARNING: 0 Tier A articles (no facts-ready fulltext)`);
  }
  if (tierB.length === 0) {
    console.log(`  [${lastname}] WARNING: 0 Tier B articles (no fulltext-needed)`);
  }

  summaryRows.push({ lastname, tierA: tierA.length, tierB: tierB.length, total: tierA.length + tierB.length });
  console.log(`  Tier A: ${tierA.length}  Tier B: ${tierB.length}  -> ${tierAPath}`);
  console.log(`                                        -> ${tierBPath}`);
}

// ---------- Summary table ----------
if (summaryRows.length > 0) {
  console.log('\n\n═══ Author Coverage Summary ═══');
  console.log(`${'Author'.padEnd(14)} ${'Tier A'.padStart(7)} ${'Tier B'.padStart(7)} ${'Total'.padStart(7)}`);
  console.log('─'.repeat(37));
  for (const r of summaryRows) {
    console.log(
      `${r.lastname.padEnd(14)} ${String(r.tierA).padStart(7)} ${String(r.tierB).padStart(7)} ${String(r.total).padStart(7)}`
    );
  }
  console.log('─'.repeat(37));
  const totalA = summaryRows.reduce((s, r) => s + r.tierA, 0);
  const totalB = summaryRows.reduce((s, r) => s + r.tierB, 0);
  console.log(`${'TOTAL'.padEnd(14)} ${String(totalA).padStart(7)} ${String(totalB).padStart(7)} ${String(totalA + totalB).padStart(7)}`);
  console.log(`\nOutput dir: ${outDir}`);
}

if (anyFailure) process.exit(1);
