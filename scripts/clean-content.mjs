#!/usr/bin/env node
/**
 * Content cleanup script: applies markdown/HTML sanitizers to D1 records
 * and writes corrected versions back. Defaults to dry-run.
 *
 * Usage:
 *   node scripts/clean-content.mjs --type posts --record recXXX
 *   node scripts/clean-content.mjs --type faqs --all
 *   node scripts/clean-content.mjs --type glossary --all --apply --yes
 *   node scripts/clean-content.mjs --type articles --from 0 --limit 100
 *
 * Flags:
 *   --type   posts | articles | faqs | glossary   (required)
 *   --record <id>     single record (text PK in each table)
 *   --all             every record in the type
 *   --from N          offset (with --all)
 *   --limit M         max records (with --all)
 *   --apply           write back to D1 (default: dry-run)
 *   --yes             skip the interactive confirmation prompt
 *   --force           write even if diff > 30% of original length
 *
 * Lights-off: always pass --apply --yes.
 *
 * On --apply: takes a wrangler d1 export backup BEFORE any write, prints
 * the restore command, batches UPDATEs, then triggers ONE workflow_dispatch
 * full rebuild via gh CLI (token from 1Password).
 */

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { sanitizeMarkdown } from '../src/lib/markdown-sanitize.mjs';
import { sanitizeHtml } from '../src/lib/html-sanitize.mjs';

const TYPES = {
  posts: {
    db: 'rrm-auth',
    table: 'posts',
    idCol: 'id',
    field: 'content',
    sanitize: sanitizeMarkdown,
    label: 'markdown',
  },
  articles: {
    db: 'rrm-library',
    table: 'articles',
    idCol: 'id',
    field: 'abstract',
    sanitize: sanitizeMarkdown,
    label: 'markdown (abstract)',
  },
  faqs: {
    db: 'rrm-auth',
    table: 'faq',
    idCol: 'id',
    field: 'published_answer',
    sanitize: sanitizeHtml,
    label: 'html',
  },
  glossary: {
    db: 'rrm-auth',
    table: 'glossary_term',
    idCol: 'id',
    field: 'body_html',
    sanitize: sanitizeHtml,
    label: 'html',
  },
};

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { apply: false, yes: false, force: false, all: false, from: 0, limit: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--force') args.force = true;
    else if (a === '--all') args.all = true;
    else if (a === '--type') args.type = argv[++i];
    else if (a === '--record') args.record = argv[++i];
    else if (a === '--from') args.from = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a.startsWith('--type=')) args.type = a.slice(7);
    else if (a.startsWith('--record=')) args.record = a.slice(9);
    else if (a.startsWith('--from=')) args.from = Number(a.slice(7));
    else if (a.startsWith('--limit=')) args.limit = Number(a.slice(8));
  }
  return args;
}

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// D1 wrappers
// ---------------------------------------------------------------------------
function d1Query(db, sql) {
  const escaped = sql.replace(/'/g, "'\\''");
  const out = execSync(`npx wrangler d1 execute ${db} --remote --json --command '${escaped}'`, {
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024,
  });
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results || [];
}

function d1ExecFile(db, sqlPath) {
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

function d1Backup(db, table) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `/tmp/${db}-${table}-backup-${stamp}.sql`;
  console.log(`\n[backup] exporting ${db}.${table} to ${backupPath} ...`);
  // wrangler d1 export accepts --table and --output
  const r = spawnSync('npx', [
    'wrangler', 'd1', 'export', db,
    '--remote', '-y',
    `--table=${table}`,
    `--output=${backupPath}`,
  ], { stdio: 'inherit' });
  if (r.status !== 0) {
    fail(`backup failed (exit ${r.status}). Aborting before any writes.`);
  }
  console.log(`[backup] done.`);
  console.log(`[backup] restore with:`);
  console.log(`           npx wrangler d1 execute ${db} --remote --file=${backupPath}`);
  console.log('');
  return backupPath;
}

// ---------------------------------------------------------------------------
// Diff display
// ---------------------------------------------------------------------------
function unifiedDiff(label, before, after) {
  const a = before.split(/\n/);
  const b = after.split(/\n/);
  // Tiny shipping-grade diff: print only changed lines with surrounding context.
  // Good enough for human review in batch runs; not a full LCS.
  const out = [`--- ${label} (before)`, `+++ ${label} (after)`];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) out.push(`- ${a[i]}`);
      if (b[i] !== undefined) out.push(`+ ${b[i]}`);
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  if (!args.type || !TYPES[args.type]) {
    fail('--type required. One of: posts, articles, faqs, glossary');
  }
  if (!args.record && !args.all) {
    fail('Pass --record <id> or --all');
  }
  if (args.apply && !args.yes) {
    fail('--apply requires --yes (lights-off contract).');
  }

  const cfg = TYPES[args.type];
  const dryRun = !args.apply;

  console.log(`\n==> clean-content: type=${args.type} (${cfg.db}.${cfg.table}.${cfg.field})`);
  console.log(`    mode=${dryRun ? 'DRY-RUN' : 'APPLY'}  ${args.force ? '[--force]' : ''}`);

  // 1. Backup (apply only)
  let backupPath = null;
  if (args.apply) {
    backupPath = d1Backup(cfg.db, cfg.table);
  }

  // 2. Select records
  let where, limitClause;
  if (args.record) {
    where = `WHERE ${cfg.idCol} = '${args.record.replace(/'/g, "''")}'`;
    limitClause = '';
  } else {
    where = `WHERE ${cfg.field} IS NOT NULL AND length(${cfg.field}) > 0`;
    const lim = args.limit != null ? args.limit : 10000;
    limitClause = ` ORDER BY ${cfg.idCol} LIMIT ${lim} OFFSET ${args.from}`;
  }
  const sql = `SELECT ${cfg.idCol}, ${cfg.field} FROM ${cfg.table} ${where}${limitClause};`;
  const rows = d1Query(cfg.db, sql);
  console.log(`    fetched ${rows.length} record(s)`);

  // 3. Sanitize + collect changes
  const changed = [];
  const skipped = [];
  for (const row of rows) {
    const id = row[cfg.idCol];
    const before = row[cfg.field] || '';
    const after = cfg.sanitize(before);
    if (after === before) continue;
    if (after.trim().length === 0 && before.trim().length > 0) {
      skipped.push({ id, ratio: '1.00', beforeLen: before.length, afterLen: after.length, reason: 'sanitized to empty' });
      continue;
    }
    const ratio = before.length > 0 ? Math.abs(after.length - before.length) / before.length : 1;
    if (ratio > 0.30 && !args.force) {
      skipped.push({ id, ratio: ratio.toFixed(2), beforeLen: before.length, afterLen: after.length });
      continue;
    }
    changed.push({ id, before, after, ratio });
  }

  console.log(`\n[summary] changed=${changed.length}  skipped(>30%)=${skipped.length}\n`);

  // 4. Print diffs
  for (const c of changed) {
    console.log(`\n----- ${cfg.table}:${c.id}  (Δ ${(c.ratio * 100).toFixed(1)}%) -----`);
    console.log(unifiedDiff(`${cfg.field}`, c.before, c.after));
  }
  if (skipped.length > 0) {
    console.log(`\n[skipped]`);
    for (const s of skipped) {
      console.log(`  ${s.id}  ratio=${s.ratio} before=${s.beforeLen} after=${s.afterLen}`);
    }
    console.log(`  re-run with --force to apply skipped records.`);
  }

  if (changed.length === 0) {
    console.log('No changes to apply.');
    return;
  }

  if (dryRun) {
    console.log(`\n[dry-run] ${changed.length} change(s) NOT written. Re-run with --apply --yes to commit.`);
    return;
  }

  // 5. Apply via batched SQL file. Use SQLite hex-literal X'..' encoding to
  //    avoid quoting/encoding pitfalls (smart quotes, U+2028, NULL bytes,
  //    embedded semicolons). Hex literals are byte-exact.
  for (const c of changed) {
    if (typeof c.after !== 'string') {
      console.error(`[apply] non-string sanitizer output for ${c.id}; aborting before any write.`);
      console.error(`        restore command: npx wrangler d1 execute ${cfg.db} --remote --file=${backupPath}`);
      process.exit(1);
    }
  }
  const tmpFile = `/tmp/clean-content-${args.type}-${Date.now()}.sql`;
  const lines = [];
  for (const c of changed) {
    const hexAfter = Buffer.from(c.after, 'utf-8').toString('hex');
    const escapedId = String(c.id).replace(/'/g, "''");
    lines.push(`UPDATE ${cfg.table} SET ${cfg.field} = CAST(X'${hexAfter}' AS TEXT) WHERE ${cfg.idCol} = '${escapedId}';`);
  }
  writeFileSync(tmpFile, lines.join('\n'));
  console.log(`\n[apply] writing ${changed.length} UPDATE(s) via ${tmpFile} ...`);
  try {
    d1ExecFile(cfg.db, tmpFile);
    console.log(`[apply] done.`);
  } catch (err) {
    console.error(`[apply] FAILED mid-batch. Restore command:`);
    console.error(`  npx wrangler d1 execute ${cfg.db} --remote --file=${backupPath}`);
    process.exit(1);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }

  // 6. Trigger ONE full rebuild. D1 already has new content; if dispatch fails,
  //    the live site keeps serving stale build artifacts until the next deploy.
  //    Surface this as a non-zero exit (distinct from D1-fail exit 1) so
  //    monitoring can catch the half-complete state.
  console.log(`\n[rebuild] triggering single workflow_dispatch full rebuild ...`);
  try {
    const ghToken = execSync(`op read 'op://Automation/<redacted>/credential'`, { encoding: 'utf8' }).trim();
    const r = spawnSync('gh', [
      'workflow', 'run', 'deploy.yml',
      '--repo', 'rrmadmin/rrm-academy-cf',
      '--ref', 'main',
    ], {
      env: { ...process.env, GH_TOKEN: ghToken },
      stdio: 'inherit',
    });
    if (r.status === 0) {
      console.log(`[rebuild] dispatched. Watch at https://github.com/rrmadmin/rrm-academy-cf/actions`);
    } else {
      console.error(`[rebuild] gh dispatch returned ${r.status}. D1 has new content but site is serving stale build.`);
      console.error(`[rebuild] trigger manually: gh workflow run deploy.yml --repo rrmadmin/rrm-academy-cf`);
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(`[rebuild] could not auto-trigger: ${err.message}`);
    console.error(`[rebuild] D1 has new content but site is serving stale build.`);
    console.error(`[rebuild] trigger manually: gh workflow run deploy.yml --repo rrmadmin/rrm-academy-cf`);
    process.exitCode = 2;
  }

  console.log(`\n[done] applied ${changed.length}, skipped ${skipped.length}, backup at ${backupPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
