#!/usr/bin/env node
/**
 * Normalizes glossary term bodies. Emits chunked transactional SQL with
 * compare-and-swap WHERE clauses + a snapshot file. Does NOT call wrangler.
 *
 * Inputs:
 *   --from-d1      read from live D1 (default: true when --data absent)
 *   --data <path>  read from JSON file instead (testing/dry-run)
 *   --apply        write SQL chunks + snapshot file (default: dry-run)
 *   --limit N      stratified sample of N terms by action category
 *   --out-dir      default /tmp
 *
 * Output (dry-run):  unified diffs to stdout + DRY RUN COMPLETE. line
 * Output (--apply):
 *   <outDir>/glossary-link-normalize.<timestamp>.NNN.sql  (chunked, ≤50 stmts)
 *   <outDir>/glossary-link-snapshot.<timestamp>.json       (rollback artifact)
 *
 * SQL form:
 *   BEGIN TRANSACTION;
 *   UPDATE glossary_term
 *   SET body_html = '<new>',
 *       updated_at = datetime('now')
 *   WHERE slug = '<slug>'
 *     AND body_html = '<old>';   ← CAS: stale writes become no-ops
 *   COMMIT;
 *
 * Exit codes:
 *   0  — success (dry-run or SQL emitted)
 *   2  — fatal: manual-review entries present + --apply requested, or field-name drift
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { applyTransforms } from './lib/glossary-link-transforms.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) {
  return process.argv.includes(name);
}

const SECTION_IDS = new Set([
  'overview','core-rrm-principles','fertility-awareness','clinical-approaches',
  'diagnostic-tools','surgical-techniques','conditions','overlapping-disciplines',
  'broader-framework','abbreviations','references',
]);

const CHUNK_SIZE = 50;

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadFromD1() {
  const out = execSync(
    `wrangler d1 execute rrm-auth --remote --json --command "SELECT id, slug, body_html, status FROM glossary_term"`,
    { encoding: 'utf-8' }
  );
  const parsed = JSON.parse(out);
  const rows = parsed[0]?.results || [];
  return rows.map(r => ({ id: r.id, slug: r.slug, bodyHtml: r.body_html || '', status: r.status }));
}

function loadFromJson(path) {
  const d = JSON.parse(readFileSync(path, 'utf-8'));
  return d.terms.map(t => ({ id: t.id, slug: t.slug, bodyHtml: t.bodyHtml || '', status: 'published' }));
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

/** Escape single quotes for SQLite string literals: ' → '' */
function escapeSqlSingleQuote(s) {
  return s.replace(/'/g, "''");
}

function buildUpdateStatement(slug, oldBody, newBody) {
  return (
    `UPDATE glossary_term\n` +
    `SET body_html = '${escapeSqlSingleQuote(newBody)}',\n` +
    `    updated_at = datetime('now')\n` +
    `WHERE slug = '${escapeSqlSingleQuote(slug)}'\n` +
    `  AND body_html = '${escapeSqlSingleQuote(oldBody)}';`
  );
}

function buildChunk(updates) {
  return ['BEGIN TRANSACTION;', ...updates, 'COMMIT;'].join('\n');
}

// ---------------------------------------------------------------------------
// Diff output
// ---------------------------------------------------------------------------

function diffPreview(slug, oldBody, newBody) {
  const delta = newBody.length - oldBody.length;
  const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
  return [
    `--- ${slug} (delta: ${deltaStr} chars)`,
    `OLD: ${oldBody.slice(0, 200)}${oldBody.length > 200 ? '...' : ''}`,
    `NEW: ${newBody.slice(0, 200)}${newBody.length > 200 ? '...' : ''}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Stratified sampling
// ---------------------------------------------------------------------------

/**
 * Group diffs by action category, take 1 from each up to limit.
 * Priority: add-cite-ref-class-to-sup, add-gloss-xref, wrap-cite-ref, mixed.
 */
function stratifiedSample(diffs, limit) {
  const PRIORITY = ['add-cite-ref-class-to-sup', 'add-gloss-xref', 'wrap-cite-ref', 'mixed'];
  const byCategory = {};
  for (const d of diffs) {
    (byCategory[d.action] ||= []).push(d);
  }

  // Emit in priority order first, then remaining categories.
  const ordered = [
    ...PRIORITY.filter(k => byCategory[k]),
    ...Object.keys(byCategory).filter(k => !PRIORITY.includes(k)),
  ];

  const out = [];
  for (const cat of ordered) {
    if (out.length >= limit) break;
    out.push(byCategory[cat][0]);
  }
  return out.slice(0, limit);
}

/**
 * Infer dominant action category for a diff entry (for stratification).
 * Examines what changed between oldBody and newBody.
 */
function inferActionCategory(oldBody, newBody) {
  const addedCiteRef = !oldBody.includes('cite-ref') && newBody.includes('cite-ref');
  const addedGlossXref = !oldBody.includes('gloss-xref') && newBody.includes('gloss-xref');
  if (addedCiteRef && addedGlossXref) return 'mixed';
  if (addedCiteRef) return 'add-cite-ref-class-to-sup';
  if (addedGlossXref) return 'add-gloss-xref';
  return 'mixed';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const hasDataFlag = flag('--data');
const useD1 = !hasDataFlag;
const dataPath = arg('--data', 'src/data/glossary.json');
const outDir = arg('--out-dir', '/tmp');
const apply = flag('--apply');
const limitRaw = arg('--limit');
const limit = limitRaw ? parseInt(limitRaw, 10) : null;

// Load terms
const terms = useD1 ? loadFromD1() : loadFromJson(dataPath);

// Sanity assertion: guard against bodyHtml vs body_html field-name drift.
if (!useD1 && terms.length > 0 && terms[0].bodyHtml === undefined) {
  console.error('FATAL: terms[0].bodyHtml is undefined — field name drift suspected.');
  console.error(`Got keys: ${Object.keys(terms[0]).join(', ')}`);
  process.exit(2);
}

const knownSlugs = new Set(terms.map(t => t.slug.toLowerCase()));

// Compute diffs + collect skipped (manual-review)
const diffs = [];
const skipped = [];

for (const t of terms) {
  if (!t.bodyHtml) continue;
  const newBody = applyTransforms(t.bodyHtml, { knownTermSlugs: knownSlugs, sectionIds: SECTION_IDS });
  if (newBody === null) {
    skipped.push(t.slug);
    continue;
  }
  if (newBody === t.bodyHtml) continue; // No change — already normalized.
  const action = inferActionCategory(t.bodyHtml, newBody);
  diffs.push({ slug: t.slug, oldBody: t.bodyHtml, newBody, action });
}

// Report skipped terms.
if (skipped.length > 0) {
  console.error(`SKIPPED (manual-review anchors — resolve via /glossary-update Workflow A first): ${skipped.length} terms`);
  for (const s of skipped) console.error(`  - ${s}`);
  if (apply) {
    console.error('FATAL: cannot --apply while manual-review entries exist. Resolve all skipped terms first.');
    process.exit(2);
  }
}

// Apply stratified sampling if --limit given.
const sample = limit ? stratifiedSample(diffs, limit) : diffs;

// ---------------------------------------------------------------------------
// Dry-run output
// ---------------------------------------------------------------------------

if (!apply) {
  for (const d of sample) {
    console.log(diffPreview(d.slug, d.oldBody, d.newBody));
    console.log('');
  }
  const totalMsg = limit
    ? `${sample.length} sampled from ${diffs.length} total`
    : `${diffs.length}`;
  console.log(`DRY RUN COMPLETE. ${totalMsg} terms would be modified across ${Math.ceil(sample.length / CHUNK_SIZE)} chunks. Re-run with --apply to write SQL files.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Apply mode: write SQL chunks + snapshot
// ---------------------------------------------------------------------------

// Ensure outDir exists.
mkdirSync(outDir, { recursive: true });

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const snapshotPath = `${outDir}/glossary-link-snapshot.${ts}.json`;

// Write snapshot of pre-apply state (rollback artifact).
writeFileSync(
  snapshotPath,
  JSON.stringify(sample.map(d => ({ slug: d.slug, body_html: d.oldBody })), null, 2)
);

// Write chunked SQL files.
const chunkFiles = [];
for (let i = 0; i < sample.length; i += CHUNK_SIZE) {
  const chunk = sample.slice(i, i + CHUNK_SIZE);
  const fileNum = String(Math.floor(i / CHUNK_SIZE) + 1).padStart(3, '0');
  const filePath = `${outDir}/glossary-link-normalize.${ts}.${fileNum}.sql`;

  const updates = chunk.map(d => buildUpdateStatement(d.slug, d.oldBody, d.newBody));
  writeFileSync(filePath, buildChunk(updates));
  chunkFiles.push(filePath);
}

console.log(`APPLY-SQL EMITTED. Wrote ${chunkFiles.length} SQL chunks:`);
for (const f of chunkFiles) console.log(`  ${f}`);
console.log(`Snapshot: ${snapshotPath}`);
console.log(`NOT YET APPLIED TO D1. Run via /glossary-update skill Workflow H to commit.`);
