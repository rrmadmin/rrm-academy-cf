#!/usr/bin/env node
/**
 * extract-chapter-facts.mjs — Orchestrator for programmatic fact extraction
 * from the Hilgers NaPro textbook via `claude -p --model opus --effort high`.
 *
 * Pipeline per chapter:
 *   1. Load body from ~/.rrm-cli/rrm.db (rrm-cli local SQLite, chapters table).
 *   2. Build user prompt: chapter metadata + body.
 *   3. Invoke `claude -p --model opus --effort high --output-format json
 *      --append-system-prompt-file scripts/chapter-extraction/system-prompt.md`.
 *   4. Parse JSON envelope → inner fact JSON → validate.
 *   5. Write /tmp/chapter-facts/<slug>.json (staging).
 *
 * A second script (promote-chapter-facts.mjs) batches the staging files to
 * the rrm-library-worker /promote-facts endpoint.
 *
 * Usage:
 *   node scripts/extract-chapter-facts.mjs --pilot                 # 3 preset chapters
 *   node scripts/extract-chapter-facts.mjs --chapter chapter-63-...
 *   node scripts/extract-chapter-facts.mjs --all                   # all 92 chapters
 *   node scripts/extract-chapter-facts.mjs --all --parallel 3      # 3 concurrent
 *   node scripts/extract-chapter-facts.mjs --dry-run --chapter X   # show prompt only
 */

import { execFileSync, spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const LOCAL_DB = join(homedir(), '.rrm-cli', 'rrm.db');
const SYSTEM_PROMPT_FILE = join(PROJECT_ROOT, 'scripts/chapter-extraction/system-prompt.md');
const STAGING_DIR = '/tmp/chapter-facts';

if (!existsSync(STAGING_DIR)) mkdirSync(STAGING_DIR, { recursive: true });

// Read system prompt once at startup. Fails fast if missing.
if (!existsSync(SYSTEM_PROMPT_FILE)) {
  console.error(`System prompt file not found: ${SYSTEM_PROMPT_FILE}`);
  process.exit(1);
}
const SYSTEM_PROMPT = readFileSync(SYSTEM_PROMPT_FILE, 'utf-8');

// Track active child processes so SIGINT can kill them cleanly.
const activeChildren = new Set();
let sigintReceived = false;
process.on('SIGINT', () => {
  sigintReceived = true;
  console.error(`\nSIGINT received. Killing ${activeChildren.size} active claude process(es)...`);
  for (const child of activeChildren) {
    try { child.kill('SIGKILL'); } catch { /* already dead */ }
  }
  // Give handlers a moment to flush, then exit.
  setTimeout(() => process.exit(130), 200);
});

const PILOT_SLUGS = [
  'chapter-15-scientific-foundations-of-the-crms',
  'chapter-40-naprotechnology-in-infertility',
  'chapter-63-diagnostic-laparoscopy-near-contact-approach',
];

// ---------- CLI ----------
const argv = process.argv.slice(2);
const flags = {
  pilot: argv.includes('--pilot'),
  all: argv.includes('--all'),
  dryRun: argv.includes('--dry-run'),
  force: argv.includes('--force'),
};
const chapterIdx = argv.indexOf('--chapter');
flags.chapter = chapterIdx >= 0 ? argv[chapterIdx + 1] : null;
const parallelIdx = argv.indexOf('--parallel');
flags.parallel = parallelIdx >= 0
  ? Math.max(1, Math.min(20, parseInt(argv[parallelIdx + 1], 10) || 1))
  : 1;

if (!flags.pilot && !flags.all && !flags.chapter) {
  console.error('Usage: --pilot | --chapter <slug> | --all  [--parallel N] [--dry-run] [--force]');
  process.exit(1);
}

// ---------- Load chapters from rrm-cli local SQLite ----------
function sqliteQuery(query) {
  const out = execFileSync(
    'sqlite3',
    ['-json', LOCAL_DB, query],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 }
  ).toString();
  return out.trim() ? JSON.parse(out) : [];
}

function loadChapter(slug) {
  const esc = slug.replace(/'/g, "''");
  const rows = sqliteQuery(
    `SELECT slug, title, authors, journal, year, body, LENGTH(body) as body_len
     FROM content WHERE type = 'chapter' AND slug = '${esc}'`
  );
  return rows[0] || null;
}

function listHilgersChapters() {
  return sqliteQuery(
    `SELECT slug, title, LENGTH(body) as body_len FROM content
     WHERE type = 'chapter' AND authors LIKE '%Hilgers%'
     ORDER BY slug`
  );
}

// ---------- Build the user prompt ----------
function buildUserPrompt(chapter) {
  const bodyLen = chapter.body_len ?? 0;
  return `CHAPTER SLUG: ${chapter.slug}
CHAPTER TITLE: ${chapter.title}
AUTHOR: ${chapter.authors || 'Hilgers TW'}
SOURCE: ${chapter.journal || 'The Medical and Surgical Practice of NaProTECHNOLOGY'} (${chapter.year || 2004})
BODY LENGTH: ${bodyLen.toLocaleString()} chars

CHAPTER BODY:
-----BEGIN CHAPTER-----
${chapter.body}
-----END CHAPTER-----

Extract facts per the system prompt rules. Output the JSON object and nothing else.`;
}

// ---------- Invoke Claude ----------
const MAX_STDOUT_BYTES = 50 * 1024 * 1024; // 50MB cap

function runClaude(userPrompt, slug) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      '-p',
      '--model', 'opus',
      '--effort', 'high',
      '--output-format', 'json',
      '--append-system-prompt', SYSTEM_PROMPT,
      // Note: NOT using --bare because it disables the OAuth session keychain
      // lookup and demands API key. Using the Claude Code OAuth session instead.
      userPrompt,
    ];
    const start = Date.now();
    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600_000, // 10 min per chapter
      killSignal: 'SIGKILL',
    });
    activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stdoutOverflow = false;
    child.stdout.on('data', (d) => {
      if (stdoutOverflow) return;
      stdoutBytes += d.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        stdoutOverflow = true;
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
        return;
      }
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code, signal) => {
      activeChildren.delete(child);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (stdoutOverflow) {
        return reject(new Error(`claude stdout exceeded ${MAX_STDOUT_BYTES} bytes (${elapsed}s); killed. stderr: ${stderr.slice(0, 500)}`));
      }
      if (signal === 'SIGKILL') {
        return reject(new Error(`claude killed after timeout (${elapsed}s); stderr: ${stderr.slice(0, 500)}`));
      }
      if (code !== 0) {
        return reject(new Error(`claude exited ${code} in ${elapsed}s; stderr: ${stderr.slice(0, 500)}`));
      }
      resolvePromise({ stdout, stderr, elapsed });
    });
    child.on('error', (err) => {
      activeChildren.delete(child);
      reject(err);
    });
  });
}

// ---------- Parse + validate ----------
function extractInnerJson(claudeJsonEnvelope, slug) {
  // Claude -p --output-format json wraps the response in an envelope.
  let envelope;
  try {
    envelope = JSON.parse(claudeJsonEnvelope);
  } catch (err) {
    throw new Error(`envelope parse failed: ${err.message}; first 300 chars: ${claudeJsonEnvelope.slice(0, 300)}`);
  }
  if (envelope.is_error === true) {
    const msg = (envelope.result || envelope.error || '').toString();
    throw new Error(`claude refused/errored: ${msg.slice(0, 300)}`);
  }
  const text = envelope.result || envelope.content || envelope.response || '';
  if (!text) throw new Error(`no result field in envelope: ${Object.keys(envelope).join(',')}`);

  // Inner JSON may have stray markdown fences despite the prompt. Strip them.
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let inner;
  try {
    inner = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`inner JSON parse failed: ${err.message}; first 300 chars: ${cleaned.slice(0, 300)}`);
  }

  if (!inner.facts || !Array.isArray(inner.facts)) {
    throw new Error(`no facts array; keys: ${Object.keys(inner).join(',')}`);
  }

  // Validate + sanity check each fact.
  const reasons = [];
  const valid = inner.facts.filter((f, i) => {
    // Object guard: null/non-object/array elements crash `.id` access.
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      reasons.push(`#${i}: not an object (got ${f === null ? 'null' : Array.isArray(f) ? 'array' : typeof f})`);
      return false;
    }
    // Short label for diagnostic messages: prefer id, fall back to claim prefix.
    const label = f.id
      ? f.id
      : (typeof f.claim === 'string' && f.claim.length > 0)
        ? `claim="${f.claim.slice(0, 40)}${f.claim.length > 40 ? '…' : ''}"`
        : '(no id/claim)';
    if (!f.id || !f.claim || !f.verification_notes) {
      reasons.push(`#${i} ${label}: missing id/claim/verification_notes`);
      return false;
    }
    if (f.source_id !== slug) {
      reasons.push(`#${i} ${label}: source_id mismatch (${f.source_id} vs ${slug})`);
      return false;
    }
    if (f.verification_notes.length > 600) {
      reasons.push(`#${i} ${label}: verification_notes ${f.verification_notes.length} chars > 600 limit`);
      return false;
    }
    // Tradition validation: must be a non-empty array of non-empty strings.
    // Missing/malformed tradition causes canonical JSON exclusion post-promote.
    if (!Array.isArray(f.tradition)) {
      reasons.push(`#${i} ${label}: tradition missing or not an array`);
      return false;
    }
    if (f.tradition.length === 0) {
      reasons.push(`#${i} ${label}: tradition array is empty`);
      return false;
    }
    if (!f.tradition.every((t) => typeof t === 'string' && t.length > 0)) {
      reasons.push(`#${i} ${label}: tradition contains non-string or empty element`);
      return false;
    }
    // Extract quote length from verification_notes for copyright check.
    // Accept ASCII " and curly smart quotes \u201c \u201d \u2018 \u2019.
    // Anchor end of quote on the closing delimiter OR the next ` Section:` / ` Page:` marker
    // so internal quote marks in medical prose do not terminate the match early.
    const quoteRe = /Quote:\s*["\u201c\u2018]([\s\S]*?)(?:["\u201d\u2019](?=\s|$|[.,;]|\s*(?:Section|Page|Chapter):)|(?=\s+(?:Section|Page|Chapter):))/;
    const quoteMatch = f.verification_notes.match(quoteRe);
    if (!quoteMatch) {
      reasons.push(`#${i} ${label}: no parseable Quote: field in verification_notes`);
      return false;
    }
    const quoteLen = quoteMatch[1].length;
    if (quoteLen > 150) {
      reasons.push(`#${i} ${label}: quote ${quoteLen} chars > 150 limit`);
      return false;
    }
    if (quoteLen < 10) {
      reasons.push(`#${i} ${label}: quote ${quoteLen} chars < 10 (likely malformed)`);
      return false;
    }
    return true;
  });

  inner._validation = {
    submitted: inner.facts.length,
    accepted: valid.length,
    rejected: reasons,
  };
  inner.facts = valid;
  return inner;
}

// ---------- Process a single chapter ----------
async function processChapter(slug) {
  const stagingPath = join(STAGING_DIR, `${slug}.json`);
  if (existsSync(stagingPath) && !flags.force) {
    console.log(`  [skip] ${slug} already extracted (use --force to redo)`);
    return { slug, skipped: true };
  }

  const chapter = loadChapter(slug);
  if (!chapter) {
    console.error(`  [err] chapter not found in local DB: ${slug}`);
    return { slug, error: 'chapter_not_found' };
  }

  const userPrompt = buildUserPrompt(chapter);

  if (flags.dryRun) {
    const previewPath = join(STAGING_DIR, `${slug}.prompt.txt`);
    writeFileSync(previewPath, userPrompt, 'utf-8');
    console.log(`  [dry] wrote prompt → ${previewPath} (${userPrompt.length} chars)`);
    return { slug, dryRun: true };
  }

  console.log(`  → ${slug} (${(chapter.body_len ?? 0).toLocaleString()} chars body)`);
  const errPath = join(STAGING_DIR, `${slug}.error.txt`);
  const rawPath = join(STAGING_DIR, `${slug}.raw.json`);
  try {
    const { stdout, elapsed } = await runClaude(userPrompt, slug);
    // Preserve raw Opus stdout for operator inspection on validation rejection.
    try {
      const rawTmp = `${rawPath}.tmp`;
      writeFileSync(rawTmp, stdout, 'utf-8');
      renameSync(rawTmp, rawPath);
    } catch { /* non-fatal */ }
    const result = extractInnerJson(stdout, slug);
    const stagingTmp = `${stagingPath}.tmp`;
    writeFileSync(stagingTmp, JSON.stringify(result, null, 2), 'utf-8');
    renameSync(stagingTmp, stagingPath);
    // Clear stale error marker from prior failed attempt on successful retry.
    if (existsSync(errPath)) {
      try { unlinkSync(errPath); } catch { /* non-fatal */ }
    }
    console.log(
      `  ✓ ${slug}: ${result._validation.accepted}/${result._validation.submitted} facts accepted (${elapsed}s)`
    );
    if (result._validation.rejected.length > 0) {
      console.log(`    rejected: ${result._validation.rejected.slice(0, 3).join('; ')}${result._validation.rejected.length > 3 ? ' …' : ''}`);
    }
    return { slug, accepted: result._validation.accepted, submitted: result._validation.submitted, elapsed };
  } catch (err) {
    writeFileSync(errPath, String(err), 'utf-8');
    console.error(`  ✗ ${slug} FAILED: ${err.message.slice(0, 200)}`);
    return { slug, error: err.message };
  }
}

// ---------- Main ----------
let targets;
if (flags.pilot) {
  targets = PILOT_SLUGS;
} else if (flags.chapter) {
  targets = [flags.chapter];
} else {
  targets = listHilgersChapters().map((c) => c.slug);
}

console.log(`\nExtracting facts from ${targets.length} chapter${targets.length > 1 ? 's' : ''}...`);
console.log(`Model: opus · Effort: high · Parallel: ${flags.parallel}${flags.dryRun ? ' · DRY-RUN' : ''}\n`);

const results = [];
// Worker pool: keep `parallel` slots busy; start next target as soon as any slot frees.
// Avoids head-of-line blocking where one slow chapter idles the other slots.
{
  let cursor = 0;
  const active = new Set();
  const launchNext = () => {
    if (sigintReceived || cursor >= targets.length) return null;
    const slug = targets[cursor++];
    const p = processChapter(slug)
      .then((r) => { results.push(r); })
      .catch((err) => { results.push({ slug, error: err.message || String(err) }); })
      .finally(() => { active.delete(p); });
    active.add(p);
    return p;
  };
  // Fill the pool initially.
  for (let i = 0; i < flags.parallel && cursor < targets.length; i++) launchNext();
  // Each time a slot frees, start the next target.
  while (active.size > 0) {
    await Promise.race(active);
    while (active.size < flags.parallel && cursor < targets.length && !sigintReceived) {
      launchNext();
    }
  }
}

// Summary.
const ok = results.filter((r) => r.accepted > 0);
const emptyResponse = results.filter((r) => r.accepted === 0 && r.submitted === 0 && !r.error && !r.skipped && !r.dryRun);
const allRejected = results.filter((r) => r.accepted === 0 && r.submitted > 0 && !r.error && !r.skipped && !r.dryRun);
const failed = results.filter((r) => r.error);
const skipped = results.filter((r) => r.skipped);
const totalFacts = ok.reduce((s, r) => s + r.accepted, 0);

console.log(`\n═══ Summary ═══`);
console.log(`Chapters processed: ${targets.length}`);
console.log(`  ✓ extracted:    ${ok.length} (${totalFacts} facts total)`);
console.log(`  ∅ empty_resp:   ${emptyResponse.length} (opus returned 0 facts)`);
console.log(`  ✗ all_rejected: ${allRejected.length} (all facts failed validation)`);
console.log(`  ✗ failed:       ${failed.length}`);
console.log(`  ↷ skipped:      ${skipped.length}`);
console.log(`Staging dir: ${STAGING_DIR}`);
if (failed.length) {
  console.log(`\nFailures:`);
  failed.forEach((f) => console.log(`  ${f.slug}: ${f.error.slice(0, 140)}`));
}
