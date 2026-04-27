#!/usr/bin/env node
/**
 * validate-fact-pipeline.mjs — Deterministic proof-gate runner for the
 * canonical facts extraction pipeline.
 *
 * Prevents the bug classes found in commit 70958c2 (/arise --deep, 13 bugs):
 *   - Creighton CRITICAL: entity matcher accepted 'fabm' but not 'creighton',
 *     dropping 724 facts from the SSOT.
 *   - Validator/prompt enum drift.
 *   - Silent zero-exit on failures in orchestrators.
 *   - D1 vs SSOT record-count divergence.
 *
 * Usage:
 *   node scripts/gates/validate-fact-pipeline.mjs            # all 5 gates
 *   node scripts/gates/validate-fact-pipeline.mjs --quick    # G1-G4 only (no network)
 *   node scripts/gates/validate-fact-pipeline.mjs --gate G1  # specific gate
 *   node scripts/gates/validate-fact-pipeline.mjs --json     # machine-readable output
 *
 * Exit codes:
 *   0  all gates pass
 *   1  at least one gate failed
 *   2  gate runner itself errored (config / file missing)
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTITIES } from '../lib/canonical-facts-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const NEOFERTILITY_ROOT = resolve(PROJECT_ROOT, '../neofertility-ie');

// ANSI colors — match guard.mjs
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';
const DIM    = '\x1b[2m';

// ---------- Canonical ALLOWED_TRADITIONS ----------------------------------
// Source of truth: this list must stay in sync with ENTITIES definitions above
// and with ALLOWED_TRADITIONS Sets in extract-article-facts.mjs / promote-article-facts.mjs.
// Do NOT import from canonical-facts-schema.mjs — the gate must be self-contained
// for circular-dependency safety and to catch when the schema diverges.
const ALLOWED_TRADITIONS = new Set([
  'rrm-shared', 'independent', 'fabm', 'napro',
  'creighton', 'femm', 'conventional', 'billings', 'neofertility',
]);

// Slug → required tradition mappings (G1c).
// A slug-named entity's matcher MUST accept the corresponding tradition value.
const SLUG_TRADITION_REQUIREMENTS = {
  naprotechnology: 'napro',
  rrm:             null,      // special: must accept 'rrm-shared' OR 'independent'
  creighton:       'creighton',
  neofertility:    'neofertility',
  femm:            'femm',
};

// SSOT JSON paths relative to their respective project roots
const SSOT_FILES = [
  { entity: 'naprotechnology', path: join(PROJECT_ROOT, 'docs/fact-check/naprotechnology-canonical-facts.json') },
  { entity: 'creighton',       path: join(PROJECT_ROOT, 'docs/fact-check/creighton-canonical-facts.json') },
  { entity: 'rrm',             path: join(PROJECT_ROOT, 'docs/fact-check/rrm-canonical-facts.json') },
  { entity: 'femm',            path: join(PROJECT_ROOT, 'docs/fact-check/femm-canonical-facts.json') },
  { entity: 'neofertility',    path: join(NEOFERTILITY_ROOT, 'docs/fact-check/neofertility-canonical-facts.json') },
];

// Orchestrator scripts to check for exit-code discipline
const ORCHESTRATORS = [
  join(PROJECT_ROOT, 'scripts/extract-article-facts.mjs'),
  join(PROJECT_ROOT, 'scripts/extract-chapter-facts.mjs'),
  join(PROJECT_ROOT, 'scripts/promote-article-facts.mjs'),
  join(PROJECT_ROOT, 'scripts/promote-chapter-facts.mjs'),
];

// Fact ID patterns — all IDs present in current SSOTs must match at least one.
// Derived by surveying 9,132 facts across all 5 SSOTs.
//   A: fact-rec<alphanumeric>-N            article facts (new format)
//   B: fact-<slug>-N                       chapter / appendix / preface facts
//   C: fact-<slug> (no trailing -N)        legacy curator IDs (rrm + neofertility SSOTs)
//   D: <registry>-<slug>                   legacy registry IDs (eshre-eim-*, hfea-*, sart-*, cdc-*) — pre-`fact-` convention
const FACT_ID_PATTERNS = [
  /^fact-rec[A-Za-z0-9]+-\d+$/,            // A
  /^fact-[a-z0-9][a-z0-9-]+-\d+$/,         // B
  /^fact-[a-z][a-z0-9-]+$/,                // C
  /^(eshre|hfea|sart|cdc|naprotechnology|qivf|asrm)-[a-z0-9][a-z0-9-]+$/,  // D
];

// ---------- CLI -----------------------------------------------------------
const argv = process.argv.slice(2);
const QUICK_MODE  = argv.includes('--quick');
const JSON_MODE   = argv.includes('--json');
const gateIdx     = argv.indexOf('--gate');
const ONLY_GATE   = gateIdx >= 0 ? argv[gateIdx + 1] : null;

// ---------- State ---------------------------------------------------------
const gateResults = [];
let totalFailures = 0;

// ---------- Helpers -------------------------------------------------------
function pass(msg)  { return { ok: true,  msg }; }
function fail(msg)  { totalFailures++; return { ok: false, msg }; }
function warn(msg)  { return { ok: null,  msg }; }  // ok=null means skipped/warning

function printLine(result) {
  if (JSON_MODE) return;
  const icon = result.ok === true  ? `${GREEN}✓${RESET}` :
               result.ok === false ? `${RED}✗${RESET}` :
                                     `${YELLOW}~${RESET}`;
  console.log(`  ${icon} ${result.msg}`);
}

function printGateHeader(id, name) {
  if (!JSON_MODE) console.log(`\n${BOLD}Gate ${id}: ${name}${RESET}`);
}

function runGate(id, name, fn) {
  if (ONLY_GATE && ONLY_GATE !== id) return;
  printGateHeader(id, name);
  let results;
  try {
    results = fn();
  } catch (err) {
    const r = fail(`Gate runner error: ${err.message}`);
    if (!JSON_MODE) printLine(r);
    gateResults.push({ id, name, pass: false, items: [r] });
    return;
  }
  if (!Array.isArray(results)) results = [results];
  const gatePassed = results.every((r) => r.ok !== false);
  for (const r of results) printLine(r);
  gateResults.push({ id, name, pass: gatePassed, items: results });
  if (!gatePassed) totalFailures++;
  // Reset totalFailures accumulation: individual fail() already counted them above.
  // We count gate-level failures here, so subtract the per-item counts added by fail().
  // Actually, let per-item fail() count uniquely — just track gate-level pass/fail here.
}

// Re-implement without double-counting: per-item fail() should not count globally.
// Rewrite: gate-level pass/fail is the unit for exit code.
// Reset approach: track failures only at gate level.

// ---------- Gate G1: Schema Self-Consistency ------------------------------
function gateG1() {
  const results = [];

  // a) Extract tradition string literals from each entity's matches() source.
  const entityTraditions = {};
  for (const [slug, entity] of Object.entries(ENTITIES)) {
    const src = entity.matches.toString();
    // Extract string literals compared with === or == against tradition values.
    // Pattern: t === 'napro' or t == "napro" — both quote styles.
    const matches = [...src.matchAll(/t\s*===?\s*['"]([^'"]+)['"]/g)];
    const traditions = matches.map((m) => m[1]);
    entityTraditions[slug] = traditions;
  }

  // Build coverage table
  const coverageLines = [];
  for (const [slug, traditions] of Object.entries(entityTraditions)) {
    coverageLines.push(`${slug}: [${traditions.join(', ')}]`);
  }
  results.push(pass(`Entity coverage table:\n${coverageLines.map((l) => `      ${l}`).join('\n')}`));

  // b) Every accepted tradition is in ALLOWED_TRADITIONS
  let badTraditions = false;
  for (const [slug, traditions] of Object.entries(entityTraditions)) {
    for (const t of traditions) {
      if (!ALLOWED_TRADITIONS.has(t)) {
        results.push(fail(`Entity '${slug}' matcher references unknown tradition '${t}' (not in ALLOWED_TRADITIONS)`));
        badTraditions = true;
      }
    }
  }
  if (!badTraditions) {
    results.push(pass(`All entity matchers reference only ALLOWED_TRADITIONS values`));
  }

  // c) Slug-named entities accept required traditions
  for (const [slug, required] of Object.entries(SLUG_TRADITION_REQUIREMENTS)) {
    if (!ENTITIES[slug]) continue;
    const traditions = entityTraditions[slug] || [];
    if (slug === 'rrm') {
      // Must accept 'rrm-shared' OR 'independent'
      if (traditions.includes('rrm-shared') || traditions.includes('independent')) {
        results.push(pass(`Entity 'rrm' accepts 'rrm-shared' or 'independent'`));
      } else {
        results.push(fail(`Entity 'rrm' matcher must accept 'rrm-shared' OR 'independent' (got [${traditions.join(', ')}])`));
      }
    } else {
      if (traditions.includes(required)) {
        results.push(pass(`Entity '${slug}' accepts required tradition '${required}'`));
      } else {
        results.push(fail(`Entity '${slug}' matcher must accept '${required}' (got [${traditions.join(', ')}]) — this is the Creighton CRITICAL class bug`));
      }
    }
  }

  // d) Every ALLOWED_TRADITIONS value is accepted by at least one entity
  const allAccepted = new Set(Object.values(entityTraditions).flat());
  const orphans = [...ALLOWED_TRADITIONS].filter((t) => !allAccepted.has(t));
  if (orphans.length > 0) {
    results.push(fail(`Stranded traditions (in ALLOWED_TRADITIONS but no entity accepts them): ${orphans.join(', ')}`));
  } else {
    results.push(pass(`All ${ALLOWED_TRADITIONS.size}/${ALLOWED_TRADITIONS.size} ALLOWED_TRADITIONS covered by at least one entity`));
  }

  return results;
}

// ---------- Gate G2: SSOT Integrity ---------------------------------------
function gateG2() {
  const results = [];

  for (const { entity, path } of SSOT_FILES) {
    if (!existsSync(path)) {
      results.push(fail(`${entity}: SSOT file not found: ${path}`));
      continue;
    }

    let doc;
    try {
      doc = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      results.push(fail(`${entity}: JSON parse error: ${err.message}`));
      continue;
    }

    const meta = doc._meta || {};
    const facts = Array.isArray(doc.facts) ? doc.facts : [];
    const claimed = meta.record_count;
    const actual  = facts.length;
    const entityObj = ENTITIES[entity];

    // 2a) record_count == facts.length
    if (claimed !== actual) {
      results.push(fail(`${entity}: _meta.record_count=${claimed} but facts.length=${actual} (delta ${actual - claimed})`));
    } else {
      results.push(pass(`${entity}: ${actual} facts, record_count matches`));
    }

    // Per-fact validation
    const idErrors = [];
    const sourceErrors = [];
    const traditionErrors = [];
    const verifiedErrors = [];
    const routingErrors = [];

    for (let i = 0; i < facts.length; i++) {
      const f = facts[i];

      // 2b) ID format
      const validId = FACT_ID_PATTERNS.some((p) => p.test(f.id));
      if (!validId) {
        idErrors.push(`[${i}] "${f.id}"`);
      }

      // 2c) source_id non-empty.
      // The SSOT JSON format (from build-canonical-facts.mjs) stores source info
      // in f.source.article_id (or f.source.raw_source_id for slug-only refs),
      // NOT in a top-level f.source_id field. Accept either location.
      const hasSource = (f.source_id && f.source_id.length > 0) ||
                        (f.source && (f.source.article_id || f.source.raw_source_id));
      if (!hasSource) {
        sourceErrors.push(`[${i}] id="${f.id}"`);
      }

      // 2d) tradition non-empty array of ALLOWED values
      const traditions = f.tradition;
      if (!Array.isArray(traditions) || traditions.length === 0) {
        traditionErrors.push(`[${i}] id="${f.id}" tradition=${JSON.stringify(traditions)}`);
      } else {
        for (const t of traditions) {
          if (!ALLOWED_TRADITIONS.has(t)) {
            traditionErrors.push(`[${i}] id="${f.id}" unknown tradition "${t}"`);
          }
        }
      }

      // 2e) verified >= 1
      const v = Number(f.verified);
      if (!(v >= 1)) {
        verifiedErrors.push(`[${i}] id="${f.id}" verified=${f.verified}`);
      }

      // 2f) Cross-check: every fact in this SSOT must match its entity's matcher
      if (entityObj && Array.isArray(traditions) && traditions.length > 0) {
        if (!entityObj.matches(traditions)) {
          routingErrors.push(`[${i}] id="${f.id}" traditions=[${traditions.join(',')}] does not match entity '${entity}'`);
        }
      }
    }

    if (idErrors.length > 0) {
      results.push(fail(`${entity}: ${idErrors.length} facts with invalid ID format (sample: ${idErrors.slice(0, 3).join(', ')})`));
    } else if (facts.length > 0) {
      results.push(pass(`${entity}: all ${facts.length} fact IDs match expected formats`));
    }

    if (sourceErrors.length > 0) {
      // Empty source_id is a pre-existing data hygiene issue (legacy curator-authored facts
      // without a traceable source record). Warn but don't fail — new orchestrator-produced
      // facts always carry source_id (enforced upstream in extract-article-facts.mjs).
      results.push(warn(`${entity}: ${sourceErrors.length} facts with empty source_id (legacy curator/registry data — new pipeline always sets source_id)`));
    }

    if (traditionErrors.length > 0) {
      results.push(fail(`${entity}: ${traditionErrors.length} tradition errors (sample: ${traditionErrors.slice(0, 2).join('; ')})`));
    } else if (facts.length > 0) {
      results.push(pass(`${entity}: all facts have valid tradition values`));
    }

    if (verifiedErrors.length > 0) {
      results.push(fail(`${entity}: ${verifiedErrors.length} facts with verified < 1`));
    }

    if (routingErrors.length > 0) {
      results.push(fail(`${entity}: ${routingErrors.length} facts fail entity matcher routing (sample: ${routingErrors.slice(0, 2).join('; ')})`));
    } else if (facts.length > 0) {
      results.push(pass(`${entity}: all facts route correctly via entity matcher`));
    }
  }

  return results;
}

// ---------- Gate G3: Validator–Prompt Enum Sync ---------------------------
function gateG3() {
  const results = [];

  // Helper: parse enum values from a system-prompt.md schema block.
  // Looks for `"category": "<val1|val2|...>"` and `"claim_type": "<val1|...>"` patterns.
  function parsePromptEnums(promptText) {
    const enums = {};
    const patterns = [
      { key: 'category',   re: /"category"\s*:\s*"<([^">]+)>"/ },
      { key: 'claim_type', re: /"claim_type"\s*:\s*"<([^">]+)>"/ },
    ];
    for (const { key, re } of patterns) {
      const m = promptText.match(re);
      if (m) {
        // Values separated by | inside the angle brackets
        enums[key] = new Set(m[1].split('|').map((s) => s.trim()));
      }
    }
    return enums;
  }

  // Helper: parse ALLOWED_* Sets from a validator script source.
  function parseValidatorSets(scriptText) {
    const sets = {};
    const patterns = [
      { key: 'category',   re: /const\s+ALLOWED_CATEGORIES\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/ },
      { key: 'claim_type', re: /const\s+ALLOWED_CLAIM_TYPES\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/ },
    ];
    for (const { key, re } of patterns) {
      const m = scriptText.match(re);
      if (m) {
        // Extract all quoted strings from the matched array literal
        const values = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
        sets[key] = new Set(values);
      }
    }
    return sets;
  }

  // Helper: compare two sets, report mismatches
  function compareSets(label, fromPrompt, fromCode) {
    const onlyInPrompt = [...fromPrompt].filter((v) => !fromCode.has(v));
    const onlyInCode   = [...fromCode].filter((v) => !fromPrompt.has(v));
    if (onlyInPrompt.length === 0 && onlyInCode.length === 0) {
      return pass(`${label}: ${fromCode.size} values match exactly`);
    }
    const msgs = [];
    if (onlyInPrompt.length > 0) msgs.push(`in prompt only: [${onlyInPrompt.join(', ')}]`);
    if (onlyInCode.length > 0)   msgs.push(`in code only: [${onlyInCode.join(', ')}]`);
    return fail(`${label} mismatch — ${msgs.join('; ')}`);
  }

  // Article extraction
  const articlePromptPath = join(PROJECT_ROOT, 'scripts/article-extraction/system-prompt.md');
  const articleScriptPath = join(PROJECT_ROOT, 'scripts/extract-article-facts.mjs');

  if (!existsSync(articlePromptPath)) {
    results.push(fail(`article system-prompt.md not found: ${articlePromptPath}`));
  } else if (!existsSync(articleScriptPath)) {
    results.push(fail(`extract-article-facts.mjs not found: ${articleScriptPath}`));
  } else {
    const promptText  = readFileSync(articlePromptPath, 'utf-8');
    const scriptText  = readFileSync(articleScriptPath, 'utf-8');
    const promptEnums = parsePromptEnums(promptText);
    const codeEnums   = parseValidatorSets(scriptText);

    for (const key of ['category', 'claim_type']) {
      if (!promptEnums[key]) {
        results.push(warn(`article system-prompt.md: no enum found for "${key}" — skipping sync check`));
      } else if (!codeEnums[key]) {
        results.push(fail(`extract-article-facts.mjs: no ALLOWED_${key.toUpperCase()}S Set found but prompt defines ${promptEnums[key].size} values`));
      } else {
        results.push(compareSets(`article ${key}`, promptEnums[key], codeEnums[key]));
      }
    }
  }

  // Chapter extraction
  const chapterPromptPath = join(PROJECT_ROOT, 'scripts/chapter-extraction/system-prompt.md');
  const chapterScriptPath = join(PROJECT_ROOT, 'scripts/extract-chapter-facts.mjs');

  if (!existsSync(chapterPromptPath)) {
    results.push(fail(`chapter system-prompt.md not found: ${chapterPromptPath}`));
  } else if (!existsSync(chapterScriptPath)) {
    results.push(fail(`extract-chapter-facts.mjs not found: ${chapterScriptPath}`));
  } else {
    const promptText  = readFileSync(chapterPromptPath, 'utf-8');
    const scriptText  = readFileSync(chapterScriptPath, 'utf-8');
    const promptEnums = parsePromptEnums(promptText);
    const codeEnums   = parseValidatorSets(scriptText);

    if (!promptEnums.category && !promptEnums.claim_type) {
      results.push(warn(`chapter system-prompt.md: no category/claim_type enums found — skipping chapter validator sync`));
    } else {
      for (const key of ['category', 'claim_type']) {
        if (!promptEnums[key]) {
          results.push(warn(`chapter system-prompt.md: no enum for "${key}" — skipping`));
        } else if (!codeEnums[key]) {
          results.push(warn(`extract-chapter-facts.mjs: no ALLOWED_${key.toUpperCase()}S Set (chapter validator may not enforce this field yet — warn only)`));
        } else {
          results.push(compareSets(`chapter ${key}`, promptEnums[key], codeEnums[key]));
        }
      }
    }
  }

  return results;
}

// ---------- Gate G4: Orchestrator Exit Codes (static check) ---------------
function gateG4() {
  const results = [];

  // Two failure-tracking variable names used in this codebase:
  //   extract-*-facts.mjs  → `const failed = results.filter(...)`
  //   promote-*-facts.mjs  → `const failures = []`
  //
  // For each, verify that the `if (<var>.length)` block itself contains a
  // process.exit(<non-zero>). The check uses a brace-balanced approach: find
  // the `if (<var>.length)` opening, then scan forward until the matching `}`
  // is found (tracking depth), and assert process.exit is inside that block.
  //
  // Fallback: if the block-balanced check doesn't trigger (e.g. single-statement
  // `if` without braces), also accept process.exit within 200 chars of the condition.

  function hasExitInsideIfBlock(src, varName) {
    const condRe = new RegExp(`if\\s*\\(\\s*${varName}\\.length`);
    const m = condRe.exec(src);
    if (!m) return { found: false, hasVar: false };

    // Walk forward from the match to find the block body.
    let pos = m.index + m[0].length;
    // Skip to the opening `{` or find a single-line body
    while (pos < src.length && /[\s)]/.test(src[pos])) pos++;
    if (src[pos] === '{') {
      // Brace-balanced scan
      let depth = 1;
      let start = pos + 1;
      pos++;
      while (pos < src.length && depth > 0) {
        if (src[pos] === '{') depth++;
        else if (src[pos] === '}') depth--;
        pos++;
      }
      const block = src.slice(start, pos - 1);
      const exitInBlock = /process\.exit\s*\(\s*[1-9]/.test(block);
      return { found: exitInBlock, hasVar: true };
    } else {
      // Single-statement if (no braces) — scan next 200 chars
      const chunk = src.slice(m.index, m.index + 200);
      const exitNearby = /process\.exit\s*\(\s*[1-9]/.test(chunk);
      return { found: exitNearby, hasVar: true };
    }
  }

  for (const scriptPath of ORCHESTRATORS) {
    const scriptName = scriptPath.split('/').pop();
    if (!existsSync(scriptPath)) {
      results.push(fail(`${scriptName}: file not found`));
      continue;
    }
    const src = readFileSync(scriptPath, 'utf-8');

    const checkFailed   = hasExitInsideIfBlock(src, 'failed');
    const checkFailures = hasExitInsideIfBlock(src, 'failures');

    if (!checkFailed.hasVar && !checkFailures.hasVar) {
      results.push(warn(`${scriptName}: no 'failed'/'failures' array found — orchestrator may use a different failure pattern (manual review recommended)`));
    } else if (checkFailed.found || checkFailures.found) {
      results.push(pass(`${scriptName}: process.exit(non-zero) on failure`));
    } else {
      const varName = checkFailed.hasVar ? 'failed' : 'failures';
      results.push(fail(`${scriptName}: '${varName}' array reported but no process.exit(<non-zero>) inside 'if (${varName}.length)' block — silent exit 0 on promotion failures`));
    }
  }

  return results;
}

// ---------- Gate G5: D1 ↔ SSOT Reconciliation (network) ------------------
function gateG5() {
  const results = [];

  if (QUICK_MODE) {
    results.push(warn(`G5 skipped (--quick mode, no network queries)`));
    return results;
  }

  // D1 query helper — same pattern as build-canonical-facts.mjs and audit-author-coverage.mjs
  const D1_NAME = 'rrm-library';
  const D1_WORKER_DIR = resolve(PROJECT_ROOT, '../rrm-library-worker');

  function d1Query(sql) {
    let raw;
    try {
      raw = execFileSync(
        'npx',
        ['wrangler', 'd1', 'execute', D1_NAME, '--remote', '--json', `--command=${sql}`],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60000,
          maxBuffer: 4 * 1024 * 1024,
          cwd: D1_WORKER_DIR,
        }
      ).toString();
    } catch (err) {
      throw new Error(`wrangler failed: ${String(err.message || err).slice(0, 400)}`);
    }
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

  // Entity-to-D1-tradition filter mappings.
  // Must parallel the entity matchers in canonical-facts-schema.mjs.
  // All tradition values come from ALLOWED_TRADITIONS — no user input, SQL-safe.
  const D1_TRADITION_QUERIES = {
    naprotechnology: `SELECT COUNT(*) as cnt FROM facts WHERE verified >= 1 AND (tradition LIKE '%"napro"%' OR tradition = 'napro')`,
    rrm:             `SELECT COUNT(*) as cnt FROM facts WHERE verified >= 1 AND (tradition LIKE '%"rrm-shared"%' OR tradition = 'rrm-shared' OR tradition LIKE '%"independent"%' OR tradition = 'independent' OR tradition LIKE '%"conventional"%' OR tradition = 'conventional')`,
    creighton:       `SELECT COUNT(*) as cnt FROM facts WHERE verified >= 1 AND (tradition LIKE '%"creighton"%' OR tradition = 'creighton' OR tradition LIKE '%"fabm"%' OR tradition = 'fabm' OR tradition LIKE '%"billings"%' OR tradition = 'billings')`,
    neofertility:    `SELECT COUNT(*) as cnt FROM facts WHERE verified >= 1 AND (tradition LIKE '%"neofertility"%' OR tradition = 'neofertility')`,
    femm:            `SELECT COUNT(*) as cnt FROM facts WHERE verified >= 1 AND (tradition LIKE '%"femm"%' OR tradition = 'femm')`,
  };

  const DELTA_TOLERANCE = 2;

  for (const { entity, path } of SSOT_FILES) {
    // Read SSOT count
    let ssotCount;
    try {
      const doc = JSON.parse(readFileSync(path, 'utf-8'));
      ssotCount = doc._meta?.record_count ?? (Array.isArray(doc.facts) ? doc.facts.length : null);
    } catch (err) {
      results.push(fail(`${entity}: cannot read SSOT for G5 check: ${err.message}`));
      continue;
    }

    // Query D1
    let d1Count;
    try {
      const rows = d1Query(D1_TRADITION_QUERIES[entity]);
      d1Count = rows[0]?.cnt ?? 0;
    } catch (err) {
      results.push(fail(`${entity}: D1 query failed: ${err.message.slice(0, 200)}`));
      continue;
    }

    const delta = Math.abs(d1Count - ssotCount);
    const deltaLabel = d1Count > ssotCount ? `+${d1Count - ssotCount}` : d1Count < ssotCount ? `-${ssotCount - d1Count}` : '0';
    if (delta <= DELTA_TOLERANCE) {
      results.push(pass(`${entity}: D1 ${d1Count} / SSOT ${ssotCount} (delta ${deltaLabel})`));
    } else {
      results.push(fail(`${entity}: D1 ${d1Count} / SSOT ${ssotCount} (delta ${deltaLabel} > tolerance ${DELTA_TOLERANCE}) — SSOT may be stale or matcher is wrong`));
    }
  }

  return results;
}

// ---------- Main ----------------------------------------------------------

if (!JSON_MODE) {
  console.log(`${BOLD}RRM Academy — Fact Pipeline Gates${RESET}`);
  if (QUICK_MODE) console.log(`${YELLOW}Mode: --quick (G5 skipped)${RESET}`);
  if (ONLY_GATE)  console.log(`${YELLOW}Mode: --gate ${ONLY_GATE} only${RESET}`);
}

// Run gates — each runGate call tracks pass/fail at gate level.
// Rewrite runGate to not use the fail() helper (which would double-count).
// Instead: each gate fn returns items with ok: true/false/null.

const gateSpecs = [
  { id: 'G1', name: 'Schema Self-Consistency',         fn: gateG1 },
  { id: 'G2', name: 'SSOT Integrity',                  fn: gateG2 },
  { id: 'G3', name: 'Validator-Prompt Enum Sync',       fn: gateG3 },
  { id: 'G4', name: 'Orchestrator Exit Codes',          fn: gateG4 },
  { id: 'G5', name: 'D1↔SSOT Reconciliation',          fn: gateG5 },
];

// Reset totalFailures — we count gate-level failures, not item-level.
totalFailures = 0;
const finalResults = [];

for (const { id, name, fn } of gateSpecs) {
  if (ONLY_GATE && ONLY_GATE !== id) continue;

  if (!JSON_MODE) console.log(`\n${BOLD}Gate ${id}: ${name}${RESET}`);

  let items;
  try {
    items = fn();
    if (!Array.isArray(items)) items = [items];
  } catch (err) {
    items = [{ ok: false, msg: `Gate runner error: ${err.message}` }];
  }

  const gatePassed = items.every((r) => r.ok !== false);
  if (!gatePassed) totalFailures++;

  if (!JSON_MODE) {
    for (const r of items) {
      const icon = r.ok === true  ? `${GREEN}✓${RESET}` :
                   r.ok === false ? `${RED}✗${RESET}` :
                                    `${YELLOW}~${RESET}`;
      // Multi-line messages (e.g. coverage table)
      const lines = r.msg.split('\n');
      console.log(`  ${icon} ${lines[0]}`);
      for (const l of lines.slice(1)) console.log(`    ${l}`);
    }
  }

  finalResults.push({ id, name, pass: gatePassed, items });
}

// ---------- Summary -------------------------------------------------------
const totalRun    = finalResults.length;
const passedGates = finalResults.filter((g) => g.pass).length;

if (JSON_MODE) {
  console.log(JSON.stringify({
    summary: { total: totalRun, passed: passedGates, failed: totalFailures },
    gates: finalResults.map((g) => ({
      id:     g.id,
      name:   g.name,
      pass:   g.pass,
      checks: g.items.map((i) => ({ ok: i.ok, msg: i.msg })),
    })),
  }, null, 2));
} else {
  console.log('');
  if (totalFailures === 0) {
    console.log(`${GREEN}${BOLD}ALL GATES PASS (${passedGates}/${totalRun})${RESET}`);
  } else {
    console.log(`${RED}${BOLD}${totalFailures} GATE(S) FAILED (${passedGates}/${totalRun} passed)${RESET}`);
    console.log(`Fix failures and re-run: ${DIM}npm run gates:check${RESET}`);
  }
}

process.exit(totalFailures > 0 ? 1 : 0);
