#!/usr/bin/env node
/**
 * audit-textbook-fact-coverage.mjs
 *
 * Audit: for every chapter of Hilgers 2004 "The Medical and Surgical Practice
 * of NaProTECHNOLOGY" stored in rrm-cli local SQLite, report how many facts
 * in D1 `rrm-library.facts` link to that chapter via source_id.
 *
 * Output: JSON report (one row per chapter) + summary table.
 *
 * Usage:
 *   node scripts/audit-textbook-fact-coverage.mjs > /tmp/textbook-coverage.json
 *   node scripts/audit-textbook-fact-coverage.mjs --summary
 */

import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

const LOCAL_DB = join(homedir(), '.rrm-cli', 'rrm.db');
const D1_NAME = 'rrm-library';
const summaryOnly = process.argv.includes('--summary');

// ---------- Load all chapters from local rrm-cli via sqlite3 CLI (no deps) ----------
function sqliteQuery(query) {
  const out = execFileSync(
    'sqlite3',
    ['-json', LOCAL_DB, query],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }
  ).toString();
  return out.trim() ? JSON.parse(out) : [];
}

const chapters = sqliteQuery(
  `SELECT slug, title, authors, journal, year, LENGTH(body) as body_len
   FROM content
   WHERE type = 'chapter'
     AND authors LIKE '%Hilgers%'
   ORDER BY slug`
);

// ---------- Pull fact counts from D1 in one query ----------
const slugs = chapters.map((c) => `'${c.slug.replace(/'/g, "''")}'`).join(',');
const sql = `SELECT source_id, COUNT(*) as n FROM facts WHERE source_id IN (${slugs}) GROUP BY source_id`;

const raw = execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', D1_NAME, '--remote', '--json', `--command=${sql}`],
  { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 64 * 1024 * 1024 }
).toString();
const match = raw.match(/(\[[\s\S]*\])\s*$/);
const factRows = match ? JSON.parse(match[1])[0]?.results || [] : [];
const factCountBySource = new Map(factRows.map((r) => [r.source_id, r.n]));

// ---------- Build report ----------
const report = chapters.map((c) => ({
  slug: c.slug,
  title: c.title,
  body_len: c.body_len,
  fact_count: factCountBySource.get(c.slug) || 0,
  coverage_ratio: c.body_len > 0 ? (factCountBySource.get(c.slug) || 0) / (c.body_len / 1000) : 0,
}));

const summary = {
  total_chapters: report.length,
  total_body_chars: report.reduce((s, r) => s + r.body_len, 0),
  total_linked_facts: report.reduce((s, r) => s + r.fact_count, 0),
  chapters_with_zero_facts: report.filter((r) => r.fact_count === 0).length,
  chapters_with_facts: report.filter((r) => r.fact_count > 0).length,
  top_covered: [...report].sort((a, b) => b.fact_count - a.fact_count).slice(0, 10),
  largest_zero_coverage: [...report]
    .filter((r) => r.fact_count === 0)
    .sort((a, b) => b.body_len - a.body_len)
    .slice(0, 15),
};

if (summaryOnly) {
  console.log('═══ Hilgers NaPro Textbook — Fact Coverage Audit ═══\n');
  console.log(`Total chapters (in rrm-cli local): ${summary.total_chapters}`);
  console.log(`Total body text:                   ${summary.total_body_chars.toLocaleString()} chars`);
  console.log(`Facts in D1 linked to chapters:    ${summary.total_linked_facts}`);
  console.log(`Chapters with ZERO linked facts:   ${summary.chapters_with_zero_facts}`);
  console.log(`Chapters with linked facts:        ${summary.chapters_with_facts}\n`);
  console.log('Top 10 covered chapters:');
  for (const c of summary.top_covered) {
    console.log(`  ${String(c.fact_count).padStart(4)} facts  ${String(c.body_len).padStart(6)} chars  ${c.slug}`);
  }
  console.log('\nLargest zero-coverage chapters (highest priority for extraction):');
  for (const c of summary.largest_zero_coverage) {
    console.log(`  ${String(c.body_len).padStart(6)} chars  ${c.slug}`);
  }
} else {
  console.log(JSON.stringify({ summary, report }, null, 2));
}
