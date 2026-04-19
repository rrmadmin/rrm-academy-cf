#!/usr/bin/env node
/**
 * apply-harmonization.mjs — Execute merges from harmonize-facts.mjs report.
 *
 * Reads the JSON report produced by `harmonize-facts.mjs`, applies:
 *   1. DELETE losers from D1 `facts` + `relationships` (duplicate-cluster losers)
 *   2. UPDATE source_id on repointed wave1 facts (recXXX → chapter-slug)
 *   3. Log an audit trail to /tmp/harmonize-audit-<timestamp>.json
 *
 * Usage:
 *   node scripts/apply-harmonization.mjs --report /tmp/harmonize-report.json --dry-run
 *   node scripts/apply-harmonization.mjs --report /tmp/harmonize-report.json  # actually execute
 *   node scripts/apply-harmonization.mjs --report ... --skip-deletes  # only repoint
 *   node scripts/apply-harmonization.mjs --report ... --skip-repoint  # only delete dupes
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const D1_NAME = 'rrm-library';

const argv = process.argv.slice(2);
const reportIdx = argv.indexOf('--report');
if (reportIdx < 0) {
  console.error('Usage: --report <path> [--dry-run] [--skip-deletes] [--skip-repoint]');
  process.exit(1);
}
const reportPath = argv[reportIdx + 1];
const flags = {
  dryRun: argv.includes('--dry-run'),
  skipDeletes: argv.includes('--skip-deletes'),
  skipRepoint: argv.includes('--skip-repoint'),
};

const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
if (!report.duplicates || !report.repoint_recommendations) {
  console.error('Report missing expected keys');
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const auditPath = `/tmp/harmonize-audit-${timestamp}.json`;

function escapeSql(s) {
  return String(s).replace(/'/g, "''");
}

function d1Batch(statements) {
  const sql = statements.join('\n');
  const tmp = `/tmp/harmonize-batch-${Date.now()}.sql`;
  writeFileSync(tmp, sql);
  if (flags.dryRun) {
    console.log(`  [dry-run] would execute ${statements.length} statements from ${tmp}`);
    return { changes: 0 };
  }
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', D1_NAME, '--remote', '--file', tmp, '--json'],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 32 * 1024 * 1024 }
  ).toString();
  const m = raw.match(/(\[[\s\S]*\])\s*$/);
  if (!m) throw new Error('d1 batch parse failed');
  const parsed = JSON.parse(m[1]);
  return { changes: parsed.reduce((s, r) => s + (r.meta?.changes || 0), 0) };
}

const audit = {
  _meta: {
    applied_at: new Date().toISOString(),
    report_source: reportPath,
    dry_run: flags.dryRun,
    skip_deletes: flags.skipDeletes,
    skip_repoint: flags.skipRepoint,
  },
  deleted_facts: [],
  deleted_relationships: 0,
  repointed_facts: [],
  errors: [],
};

// ---------- Phase 1: DELETE loser facts ----------
const loserIds = report.duplicates.map((d) => d.loser.id);
if (!flags.skipDeletes && loserIds.length > 0) {
  console.log(`\n[phase 1] Deleting ${loserIds.length} duplicate loser facts`);
  const idsEscaped = loserIds.map((id) => `'${escapeSql(id)}'`).join(',');
  // Delete relationships pointing TO or FROM the loser ids
  const relDeleteSql = `DELETE FROM relationships WHERE source_id IN (${idsEscaped}) OR target_id IN (${idsEscaped});`;
  // Delete the facts themselves
  const factDeleteSql = `DELETE FROM facts WHERE id IN (${idsEscaped});`;
  try {
    const rel = d1Batch([relDeleteSql]);
    console.log(`  relationships deleted: ${rel.changes}`);
    audit.deleted_relationships = rel.changes;
    const fac = d1Batch([factDeleteSql]);
    console.log(`  facts deleted: ${fac.changes}`);
    audit.deleted_facts = report.duplicates.map((d) => ({
      id: d.loser.id,
      winner_id: d.winner.id,
      slug: d.slug,
      match_score: d.match_score,
    }));
  } catch (err) {
    console.error(`  delete phase failed: ${err.message.slice(0, 300)}`);
    audit.errors.push({ phase: 'delete', error: err.message });
  }
} else {
  console.log(`\n[phase 1] SKIPPED (skip_deletes or no losers)`);
}

// ---------- Phase 2: REPOINT wave1 facts ----------
const repoints = (report.repoint_recommendations || []).filter(
  (r) => !loserIds.includes(r.fact_id) // don't try to repoint a fact we just deleted
);
if (!flags.skipRepoint && repoints.length > 0) {
  console.log(`\n[phase 2] Re-pointing ${repoints.length} wave1 facts to chapter-slug source`);
  // Build one UPDATE per fact; safer than a CASE statement for this volume
  const stmts = repoints.map(
    (r) =>
      `UPDATE facts SET source_id = '${escapeSql(r.to_source)}', updated_at = datetime('now') WHERE id = '${escapeSql(r.fact_id)}' AND source_id = '${escapeSql(r.from_source)}';`
  );
  try {
    // Run in batches of 200 SQL statements
    const BATCH = 200;
    let totalChanges = 0;
    for (let i = 0; i < stmts.length; i += BATCH) {
      const chunk = stmts.slice(i, i + BATCH);
      const res = d1Batch(chunk);
      totalChanges += res.changes;
      console.log(
        `  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(stmts.length / BATCH)}: ${res.changes} changes`
      );
    }
    console.log(`  total repointed: ${totalChanges}`);
    audit.repointed_facts = repoints;

    // Also repoint relationships.target_id where the TARGET was the recXXX that now has a canonical chapter-slug
    // (These are rows where a fact was extracted_from a recXXX-chapter; we want them to reference the slug form for consistency)
    if (!flags.dryRun) {
      console.log(`  [phase 2b] Repointing relationship target_ids for affected recXXX sources`);
      const uniqueFrom = [...new Set(repoints.map((r) => r.from_source))];
      const uniqueTo = new Map();
      for (const r of repoints) uniqueTo.set(r.from_source, r.to_source);
      const relStmts = uniqueFrom.map(
        (recId) =>
          `UPDATE relationships SET target_id = '${escapeSql(uniqueTo.get(recId))}' WHERE target_id = '${escapeSql(recId)}' AND relation = 'extracted_from';`
      );
      let relChanges = 0;
      for (let i = 0; i < relStmts.length; i += BATCH) {
        const chunk = relStmts.slice(i, i + BATCH);
        const res = d1Batch(chunk);
        relChanges += res.changes;
      }
      console.log(`  relationships repointed: ${relChanges}`);
      audit.repointed_relationships = relChanges;
    }
  } catch (err) {
    console.error(`  repoint phase failed: ${err.message.slice(0, 300)}`);
    audit.errors.push({ phase: 'repoint', error: err.message });
  }
} else {
  console.log(`\n[phase 2] SKIPPED (skip_repoint or no repoints)`);
}

// ---------- Write audit ----------
writeFileSync(auditPath, JSON.stringify(audit, null, 2));
console.log(`\nAudit: ${auditPath}`);

if (flags.dryRun) {
  console.log(`\n[DRY RUN] No D1 changes were made. Re-run without --dry-run to apply.`);
} else {
  console.log(
    `\nDone. Run 'node scripts/build-canonical-facts.mjs --all' to refresh SSOT JSONs.`
  );
}
