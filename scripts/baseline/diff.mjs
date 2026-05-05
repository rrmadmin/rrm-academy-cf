#!/usr/bin/env node
/**
 * Regression-detection gate. Compares the CURRENT baseline (just-captured) against
 * the LOCKED baseline (the tagged Phase 1 snapshot) and exits non-zero on HARD drift.
 *
 * Hard gates (always block a fix):
 *   H1  HTTP status regression: any URL whose locked status was 2xx/3xx now 4xx/5xx,
 *       OR any URL whose locked status was exactly 200 now anything else.
 *   H2  Agent-surface body shrinkage: any body file whose new size is < 50% of the
 *       locked size (catastrophic content loss).
 *   H3  D1 row count drop: any user-data table whose count dropped more than the
 *       configured tolerance (default 5%, hardcoded floors for tiny tables).
 *   H4  Scanner HIGH count growth: arise-scan HIGH count > locked + 5.
 *
 * Soft gates (informational only -- never exit non-zero):
 *   S1  HTTP body sha drift (expected for content updates)
 *   S2  HTTP latency drift
 *   S3  Agent-surface sha drift on llms.txt / openapi (often legitimate)
 *
 * Usage:
 *   node scripts/baseline/diff.mjs --locked DIR --current DIR
 *   node scripts/baseline/diff.mjs --locked DIR --current DIR --gate hard      # exit 1 on H*
 *   node scripts/baseline/diff.mjs --locked DIR --current DIR --report markdown
 *
 * Defaults:
 *   --locked  ~/iCode/.arise-baselines/2026-05-05  (Phase 1 baseline)
 *   --current ~/iCode/.arise-baselines/_current
 *   --gate    advisory  (no exit code change; use 'hard' to enforce)
 *   --report  text      (text|json|markdown)
 */
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';

const args = parseArgs(process.argv.slice(2));
const LOCKED = args.locked || join(homedir(), 'iCode/.arise-baselines/2026-05-05');
const CURRENT = args.current || join(homedir(), 'iCode/.arise-baselines/_current');
const GATE = args.gate || 'advisory';
const REPORT = args.report || 'text';

const D1_DROP_TOLERANCE = 0.05;          // 5% drop allowed on row counts
const D1_FLOOR_TABLES = ['user', 'session', 'enrollment', 'community_post', 'newsletter_subscriber', 'contact', 'course', 'faq', 'glossary_term', 'posts'];
const D1_FLOOR_DROP_ABSOLUTE_MAX = 5;     // even 5% allowed unless drop > 5 rows AND drop > 5%
const SHRINK_THRESHOLD = 0.50;            // body < 50% of locked = catastrophic

const findings = { hard: [], soft: [] };
const skipped = [];

if (!existsSync(LOCKED)) die(`locked baseline missing: ${LOCKED}`);
if (!existsSync(CURRENT)) die(`current baseline missing: ${CURRENT} -- re-run http.mjs/d1-counts.sh/agent-surface.sh first`);

// ============================================================================
// H1: HTTP status regression
// ============================================================================
{
  const lockedFile = join(LOCKED, 'http/http-baseline.json');
  const currentFile = join(CURRENT, 'http/http-baseline.json');
  if (!existsSync(lockedFile) || !existsSync(currentFile)) {
    skipped.push('H1: http-baseline.json missing on one side');
  } else {
    const locked = JSON.parse(readFileSync(lockedFile, 'utf8'));
    const current = JSON.parse(readFileSync(currentFile, 'utf8'));
    const lockedByUrl = new Map(locked.map(e => [e.url, e]));
    for (const cur of current) {
      const lk = lockedByUrl.get(cur.url);
      if (!lk) continue;  // new URL, not a regression
      const lockedOk = lk.status >= 200 && lk.status < 400;
      const curBroken = !cur.status || cur.status >= 400;
      if (lockedOk && curBroken) {
        findings.hard.push({ gate: 'H1', url: cur.url, locked_status: lk.status, current_status: cur.status, msg: `URL was ${lk.status}, now ${cur.status}` });
      } else if (lk.status === 200 && cur.status !== 200) {
        findings.hard.push({ gate: 'H1', url: cur.url, locked_status: 200, current_status: cur.status, msg: `URL was 200, now ${cur.status}` });
      }
      // soft: body sha drift
      if (lk.sha256 && cur.sha256 && lk.sha256 !== cur.sha256) {
        findings.soft.push({ gate: 'S1', url: cur.url, locked_sha: lk.sha256, current_sha: cur.sha256 });
      }
      if (lk.headers && cur.headers && cur.headers['content-type'] && lk.headers['content-type'] && lk.headers['content-type'] !== cur.headers['content-type']) {
        findings.hard.push({ gate: 'H1', url: cur.url, msg: `content-type changed: '${lk.headers['content-type']}' -> '${cur.headers['content-type']}'` });
      }
    }
  }
}

// ============================================================================
// H2: Agent surface body shrinkage
// ============================================================================
{
  const lockedShas = join(LOCKED, 'agent-surface/shas.txt');
  const currentShas = join(CURRENT, 'agent-surface/shas.txt');
  // Locked Phase 1 captured per-file but no shas.txt; reconstruct from filesystem
  const lockedFiles = ['llms_txt.body', 'openapi.body', 'library_rss_xml.body', 'commentary_rss_xml.body', 'robots_txt.body', 'sitemap-index_xml.body'];
  for (const fname of lockedFiles) {
    const lockedPath = join(LOCKED, 'agent-surface', fname);
    const currentPath = join(CURRENT, 'agent-surface', fname);
    if (!existsSync(lockedPath) || !existsSync(currentPath)) {
      skipped.push(`H2: ${fname} missing on one side`);
      continue;
    }
    const lockedSize = statSync(lockedPath).size;
    const currentSize = statSync(currentPath).size;
    if (currentSize < lockedSize * SHRINK_THRESHOLD) {
      findings.hard.push({ gate: 'H2', file: fname, locked_size: lockedSize, current_size: currentSize, msg: `body shrank ${((1 - currentSize / lockedSize) * 100).toFixed(1)}% (catastrophic)` });
    } else if (currentSize !== lockedSize) {
      findings.soft.push({ gate: 'S3', file: fname, locked_size: lockedSize, current_size: currentSize });
    }
  }
}

// ============================================================================
// H3: D1 row count drop
// ============================================================================
for (const db of ['rrm-auth', 'rrm-survey', 'rrm-analytics']) {
  const lockedFile = join(LOCKED, `d1/${db}-counts.txt`);
  const currentFile = join(CURRENT, `d1/${db}-counts.txt`);
  if (!existsSync(lockedFile) || !existsSync(currentFile)) {
    skipped.push(`H3: d1/${db}-counts.txt missing on one side`);
    continue;
  }
  const lockedMap = parseCounts(readFileSync(lockedFile, 'utf8'));
  const currentMap = parseCounts(readFileSync(currentFile, 'utf8'));
  for (const [table, lockedCount] of lockedMap) {
    if (!currentMap.has(table)) {
      findings.hard.push({ gate: 'H3', db, table, msg: `table missing in current baseline (was ${lockedCount} rows)` });
      continue;
    }
    const cur = currentMap.get(table);
    if (cur < lockedCount) {
      const drop = lockedCount - cur;
      const dropPct = drop / lockedCount;
      const isFloorTable = D1_FLOOR_TABLES.includes(table);
      const sevHard = (drop > D1_FLOOR_DROP_ABSOLUTE_MAX && dropPct > D1_DROP_TOLERANCE);
      // Floor tables are stricter: ANY drop > 1% is hard
      const sevHardFloor = isFloorTable && dropPct > 0.01 && drop > 1;
      if (sevHard || sevHardFloor) {
        findings.hard.push({ gate: 'H3', db, table, locked_count: lockedCount, current_count: cur, drop, drop_pct: (dropPct * 100).toFixed(2) + '%', msg: `row count dropped ${drop} rows (${(dropPct * 100).toFixed(1)}%)${isFloorTable ? ' on protected table' : ''}` });
      } else {
        findings.soft.push({ gate: 'S-D1', db, table, locked_count: lockedCount, current_count: cur, drop });
      }
    }
  }
}

// ============================================================================
// H4: arise-scan HIGH count growth
// ============================================================================
{
  const lockedFile = join(LOCKED, 'build/arise-scan.summary.json');
  const currentFile = join(CURRENT, 'build/arise-scan.summary.json');
  if (!existsSync(lockedFile) || !existsSync(currentFile)) {
    skipped.push('H4: arise-scan.summary.json missing on one side');
  } else {
    const lk = JSON.parse(readFileSync(lockedFile, 'utf8'));
    const cur = JSON.parse(readFileSync(currentFile, 'utf8'));
    const lockedHigh = lk.summary?.high ?? 0;
    const currentHigh = cur.summary?.high ?? 0;
    if (currentHigh > lockedHigh + 5) {
      findings.hard.push({ gate: 'H4', locked_high: lockedHigh, current_high: currentHigh, delta: currentHigh - lockedHigh, msg: `arise-scan HIGH count grew by ${currentHigh - lockedHigh}` });
    } else if (currentHigh !== lockedHigh) {
      findings.soft.push({ gate: 'S-SCAN', locked_high: lockedHigh, current_high: currentHigh });
    }
  }
}

// ============================================================================
// Report
// ============================================================================
const exitCode = (GATE === 'hard' && findings.hard.length > 0) ? 1 : 0;

if (REPORT === 'json') {
  console.log(JSON.stringify({ locked: LOCKED, current: CURRENT, gate: GATE, exit_code: exitCode, findings, skipped }, null, 2));
} else if (REPORT === 'markdown') {
  console.log(`# Baseline diff report\n`);
  console.log(`Locked: \`${LOCKED}\``);
  console.log(`Current: \`${CURRENT}\``);
  console.log(`Gate: \`${GATE}\` -- exit code: ${exitCode}\n`);
  console.log(`## Hard gates (${findings.hard.length})\n`);
  for (const f of findings.hard) console.log(`- **${f.gate}** ${f.url || f.file || f.table || ''} -- ${f.msg}`);
  if (findings.hard.length === 0) console.log('_(none)_');
  console.log(`\n## Soft signals (${findings.soft.length})\n`);
  for (const f of findings.soft.slice(0, 30)) console.log(`- ${f.gate} ${f.url || f.file || f.table || ''}`);
  if (findings.soft.length > 30) console.log(`- ... +${findings.soft.length - 30} more`);
  if (skipped.length) console.log(`\n## Skipped checks\n` + skipped.map(s => `- ${s}`).join('\n'));
} else {
  // text
  console.log(`baseline diff: locked=${LOCKED} current=${CURRENT}`);
  console.log(`gate=${GATE}  hard=${findings.hard.length}  soft=${findings.soft.length}  skipped=${skipped.length}  exit=${exitCode}`);
  if (findings.hard.length) {
    console.log('\nHARD findings:');
    for (const f of findings.hard) console.log(`  ${f.gate}  ${f.url || f.file || f.table || ''}  ${f.msg}`);
  }
  if (skipped.length) console.log('\nSKIPPED:\n' + skipped.map(s => '  ' + s).join('\n'));
}

process.exit(exitCode);

// ============================================================================
// helpers
// ============================================================================
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

function die(msg) { console.error('ERROR: ' + msg); process.exit(2); }

function parseCounts(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^(\S+):\s+(\d+)\s*$/);
    if (m) map.set(m[1], parseInt(m[2], 10));
  }
  return map;
}

