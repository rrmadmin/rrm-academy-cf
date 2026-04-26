#!/usr/bin/env node
/**
 * extract-article-facts.mjs — Orchestrator for programmatic fact extraction
 * from RRM/NaPro journal articles via `claude -p --model opus --effort high`.
 *
 * Pipeline per article:
 *   1. Load body from D1 article_bodies table (via wrangler d1 execute --remote).
 *   2. Build user prompt: article metadata + body.
 *   3. Invoke `claude -p --model opus --effort high --output-format json
 *      --append-system-prompt-file scripts/article-extraction/system-prompt.md`.
 *   4. Parse JSON envelope → inner fact JSON → validate (FPG-1..6).
 *   5. Write /tmp/article-facts/<recXXX>.json (staging).
 *
 * A second script (promote-article-facts.mjs) batches the staging files to
 * the rrm-library-worker /promote-facts endpoint.
 *
 * Usage:
 *   node scripts/extract-article-facts.mjs --author stanford --dry-run
 *   node scripts/extract-article-facts.mjs --author stanford --limit 5
 *   node scripts/extract-article-facts.mjs --author stanford --parallel 3
 *   node scripts/extract-article-facts.mjs --article recABC123DEF456GHI78
 *   node scripts/extract-article-facts.mjs --article recABC123DEF456GHI78 --dry-run
 *   node scripts/extract-article-facts.mjs --author fehring --limit 10 --parallel 2
 */

import { execFileSync, spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SYSTEM_PROMPT_FILE = join(PROJECT_ROOT, 'scripts/article-extraction/system-prompt.md');
const STAGING_DIR = '/tmp/article-facts';
const D1_NAME = 'rrm-library';
const D1_MAX_BUFFER = 64 * 1024 * 1024;

// Tradition lookup table indexed by author lastname.
const AUTHOR_TRADITIONS = {
  stanford:  ['creighton', 'napro', 'rrm-shared'],
  prior:     ['independent', 'rrm-shared'],
  fehring:   ['fabm', 'creighton', 'rrm-shared'],
  vigil:     ['femm', 'fabm', 'rrm-shared'],
  yeung:     ['conventional', 'rrm-shared'],
  whittaker: ['napro', 'neofertility', 'rrm-shared'],
  boyle:     ['napro', 'neofertility', 'rrm-shared'],
  billings:  ['billings', 'fabm', 'rrm-shared'],
  mirkes:    ['napro', 'rrm-shared'],
  redwine:   ['conventional', 'rrm-shared'],
  odeblad:   ['fabm', 'rrm-shared'],
  hilgers:   ['napro', 'creighton', 'rrm-shared'],
  parnell:   ['napro', 'rrm-shared'],
};

const ALLOWED_TRADITIONS = new Set([
  'rrm-shared', 'independent', 'fabm', 'napro', 'creighton', 'femm',
  'conventional', 'billings', 'neofertility',
]);

const ALLOWED_CATEGORIES = new Set([
  'outcome','protocol','surgery','pathology','hormone','epidemiology',
  'diagnostics','charting','cycle-biomarker','methodology'
]);
const ALLOWED_CLAIM_TYPES = new Set([
  'statistic','protocol','cited-study','biomarker','definition'
]);

// Article ID format: rec + 14..17 alphanumeric characters (D1 has both 17-char and 20-char total IDs).
const REC_ID_RE = /^rec[A-Za-z0-9]{14,17}$/;
// Fact ID format per FPG-1 (flexible to match actual D1 article ID lengths).
const FACT_ID_RE = /^fact-rec[A-Za-z0-9]{14,17}-\d+$/;

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
  setTimeout(() => process.exit(130), 200);
});

// ---------- CLI ----------
const argv = process.argv.slice(2);
const flags = {
  dryRun: argv.includes('--dry-run'),
  force: argv.includes('--force'),
};

const authorIdx = argv.indexOf('--author');
flags.author = authorIdx >= 0 ? argv[authorIdx + 1]?.toLowerCase() : null;

const articleIdx = argv.indexOf('--article');
flags.article = articleIdx >= 0 ? argv[articleIdx + 1] : null;

const limitIdx = argv.indexOf('--limit');
flags.limit = limitIdx >= 0 ? Math.max(1, parseInt(argv[limitIdx + 1], 10) || 1) : null;

const parallelIdx = argv.indexOf('--parallel');
flags.parallel = parallelIdx >= 0
  ? Math.max(1, Math.min(3, parseInt(argv[parallelIdx + 1], 10) || 1))
  : 1;

if (!flags.author && !flags.article) {
  console.error('Usage: --author <lastname> | --article <recXXX>  [--limit N] [--parallel N] [--dry-run] [--force]');
  console.error(`Known authors: ${Object.keys(AUTHOR_TRADITIONS).join(', ')}`);
  process.exit(1);
}

// If --article is given, derive author from it (or require --author too).
if (flags.article && !REC_ID_RE.test(flags.article)) {
  console.error(`Invalid article ID: "${flags.article}". Must match rec[A-Za-z0-9]{14,17}.`);
  process.exit(1);
}

if (flags.author && !AUTHOR_TRADITIONS[flags.author]) {
  console.error(`Unknown author: "${flags.author}". Known: ${Object.keys(AUTHOR_TRADITIONS).join(', ')}`);
  process.exit(1);
}

// ---------- D1 query helper ----------
function d1Query(sql) {
  let raw;
  try {
    raw = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', D1_NAME, '--remote', '--json', `--command=${sql}`],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
        maxBuffer: D1_MAX_BUFFER,
      }
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

// ---------- CSV parser ----------
// Handles RFC-4180: quoted fields, escaped quotes (doubled), embedded commas.
function parseCsvRow(line) {
  const result = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++; // skip opening quote
      let field = '';
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += line[i++];
        }
      }
      result.push(field);
      if (line[i] === ',') i++; // skip comma
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) {
        result.push(line.slice(i));
        break;
      }
      result.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return result;
}

// ---------- Load article list from CSV ----------
function listAuthorArticles(author) {
  const csvPath = join(PROJECT_ROOT, 'scripts/out', `${author}-tier-a.csv`);
  if (!existsSync(csvPath)) {
    console.error(`Tier A CSV not found: ${csvPath}`);
    console.error(`Run: node scripts/audit-author-coverage.mjs --author ${author}`);
    process.exit(1);
  }
  const text = readFileSync(csvPath, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.log(`  [warn] CSV has no data rows: ${csvPath}`);
    return [];
  }
  // Header: id,title,year,doi,pmid,rrm_relevance,domain
  const headerLine = lines[0];
  const headers = parseCsvRow(headerLine);
  const idIdx = headers.indexOf('id');
  const titleIdx = headers.indexOf('title');
  const yearIdx = headers.indexOf('year');
  const doiIdx = headers.indexOf('doi');
  const pmidIdx = headers.indexOf('pmid');
  if (idIdx === -1) {
    console.error(`CSV missing "id" column. Headers found: ${headers.join(', ')}`);
    process.exit(1);
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const id = cols[idIdx]?.trim() || '';
    if (!id) continue;
    if (!REC_ID_RE.test(id)) {
      console.error(`  [warn] row ${i}: invalid article ID "${id}" (skipping)`);
      continue;
    }
    rows.push({
      id,
      title: titleIdx >= 0 ? (cols[titleIdx] || '') : '',
      year: yearIdx >= 0 ? (cols[yearIdx] || null) : null,
      doi: doiIdx >= 0 ? (cols[doiIdx] || null) : null,
      pmid: pmidIdx >= 0 ? (cols[pmidIdx] || null) : null,
    });
  }
  return rows;
}

// ---------- Load article body from D1 ----------
function loadArticleBody(articleId) {
  if (!REC_ID_RE.test(articleId)) {
    throw new Error(`invalid_article_id: ${articleId}`);
  }
  const esc = articleId.replace(/'/g, "''");
  const rows = d1Query(
    `SELECT body FROM article_bodies WHERE article_id = '${esc}'`
  );
  if (!rows || rows.length === 0) return null;
  return rows[0]?.body || null;
}

// ---------- Load article metadata from D1 (for --article single-run) ----------
function loadArticleMetadata(articleId) {
  if (!REC_ID_RE.test(articleId)) {
    throw new Error(`invalid_article_id: ${articleId}`);
  }
  const esc = articleId.replace(/'/g, "''");
  const rows = d1Query(
    `SELECT id, title, year, doi, pmid FROM articles WHERE id = '${esc}'`
  );
  return rows[0] || null;
}

// ---------- Build the user prompt ----------
function buildUserPrompt(article, author, traditions) {
  const bodyLen = article.body ? article.body.length : 0;
  return `ARTICLE ID: ${article.id}
ARTICLE TITLE: ${article.title || '(unknown)'}
AUTHOR_LASTNAME: ${author}
AUTHOR_PRIMARY_TRADITIONS: ${JSON.stringify(traditions)}
YEAR: ${article.year || 'unknown'}
DOI: ${article.doi || 'null'}
PMID: ${article.pmid || 'null'}
BODY LENGTH: ${bodyLen.toLocaleString()} chars

ARTICLE BODY:
-----BEGIN ARTICLE-----
${article.body}
-----END ARTICLE-----

Extract facts per the system prompt rules. Output the JSON object and nothing else.`;
}

// ---------- Invoke Claude ----------
const MAX_STDOUT_BYTES = 50 * 1024 * 1024; // 50MB cap

function runClaude(userPrompt, articleId) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      '-p',
      '--model', 'opus',
      '--effort', 'high',
      '--output-format', 'json',
      '--append-system-prompt', SYSTEM_PROMPT,
      userPrompt,
    ];
    const start = Date.now();
    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600_000, // 10 min per article
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
function extractInnerJson(claudeJsonEnvelope, articleId) {
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

  // Validate each fact against FPG-1..6.
  const reasons = [];
  const valid = inner.facts.filter((f, i) => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      reasons.push(`#${i}: not an object (got ${f === null ? 'null' : Array.isArray(f) ? 'array' : typeof f})`);
      return false;
    }
    const label = f.id
      ? f.id
      : (typeof f.claim === 'string' && f.claim.length > 0)
        ? `claim="${f.claim.slice(0, 40)}${f.claim.length > 40 ? '...' : ''}"`
        : '(no id/claim)';

    if (!f.id || !f.claim || !f.verification_notes) {
      reasons.push(`#${i} ${label}: missing id/claim/verification_notes`);
      return false;
    }

    // FPG-1: fact ID must match ^fact-rec[A-Za-z0-9]{14,17}-\d+$
    if (!FACT_ID_RE.test(f.id)) {
      reasons.push(`#${i} ${label}: id does not match fact-rec[A-Za-z0-9]{14,17}-N pattern (got "${f.id}")`);
      return false;
    }

    // The rec-portion INSIDE f.id must match articleId; otherwise an Opus output
    // like {id:"fact-recOTHER1234567-1", source_id:"recCORRECT..."} would silently
    // pass both gates and end up associated with the wrong article.
    const idRecMatch = f.id.match(/^fact-(rec[A-Za-z0-9]{14,17})-\d+$/);
    if (!idRecMatch || idRecMatch[1] !== articleId) {
      reasons.push(`#${i} ${label}: fact.id rec-portion (${idRecMatch?.[1]}) != articleId (${articleId})`);
      return false;
    }

    // source_id must equal the article recXXX.
    if (f.source_id !== articleId) {
      reasons.push(`#${i} ${label}: source_id mismatch (${f.source_id} vs ${articleId})`);
      return false;
    }

    // Claim length cap (system prompt declares ≤300 chars; allow some headroom at 600).
    if (typeof f.claim !== 'string' || f.claim.length > 600) {
      reasons.push(`#${i} ${label}: claim missing or > 600 chars`);
      return false;
    }
    // Enum allowlists for category and claim_type (only enforced when present;
    // both fields are optional in the existing schema, allowing null/undefined).
    if (typeof f.category === 'string' && !ALLOWED_CATEGORIES.has(f.category)) {
      reasons.push(`#${i} ${label}: category "${f.category}" not in allowed set`);
      return false;
    }
    if (typeof f.claim_type === 'string' && !ALLOWED_CLAIM_TYPES.has(f.claim_type)) {
      reasons.push(`#${i} ${label}: claim_type "${f.claim_type}" not in allowed set`);
      return false;
    }

    // verification_notes length cap.
    if (f.verification_notes.length > 600) {
      reasons.push(`#${i} ${label}: verification_notes ${f.verification_notes.length} chars > 600 limit`);
      return false;
    }

    // Tradition: non-empty array of strings, each from the allowed set.
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
    const unknownTraditions = f.tradition.filter((t) => !ALLOWED_TRADITIONS.has(t));
    if (unknownTraditions.length > 0) {
      reasons.push(`#${i} ${label}: unknown tradition values: ${unknownTraditions.join(', ')}`);
      return false;
    }

    // Quote length guard — same regex as chapter version.
    // Accept ASCII " and curly smart quotes “ ” ‘ ’.
    const quoteRe = /Quote:\s*["“‘]([\s\S]*?)(?:["”’](?=\s|$|[.,;]|\s*(?:Section|Page|Chapter):)|(?=\s+(?:Section|Page|Chapter):))/;
    const quoteMatch = f.verification_notes.match(quoteRe);
    if (!quoteMatch) {
      reasons.push(`#${i} ${label}: no parseable Quote: field in verification_notes`);
      return false;
    }
    // Use Array.from to count Unicode code points, not UTF-16 code units;
    // a single emoji (e.g. 🩺) should count as 1 char, not 2.
    const quoteLen = Array.from(quoteMatch[1]).length;
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

// ---------- Process a single article ----------
async function processArticle(article, author, traditions) {
  const { id } = article;
  const stagingPath = join(STAGING_DIR, `${id}.json`);
  if (existsSync(stagingPath) && !flags.force) {
    console.log(`  [skip] ${id} already extracted (use --force to redo)`);
    return { id, skipped: true };
  }

  // Load body from D1.
  let body;
  try {
    body = loadArticleBody(id);
  } catch (err) {
    console.error(`  [err] ${id}: D1 body query failed: ${err.message.slice(0, 200)}`);
    return { id, error: `body_query_failed: ${err.message.slice(0, 200)}` };
  }

  if (!body || !body.trim()) {
    console.log(`  [skip] ${id}: no body in article_bodies (skipping — never post placeholder)`);
    return { id, skipped: true, reason: 'no_body' };
  }

  const fullArticle = { ...article, body };
  const userPrompt = buildUserPrompt(fullArticle, author, traditions);

  if (flags.dryRun) {
    const previewPath = join(STAGING_DIR, `${id}.prompt.txt`);
    writeFileSync(previewPath, userPrompt, 'utf-8');
    console.log(`  [dry] wrote prompt → ${previewPath} (${userPrompt.length} chars)`);
    return { id, dryRun: true };
  }

  console.log(`  → ${id} "${(article.title || '').slice(0, 60)}" (${body.length.toLocaleString()} chars body)`);
  const errPath = join(STAGING_DIR, `${id}.error.txt`);
  const rawPath = join(STAGING_DIR, `${id}.raw.json`);
  try {
    const { stdout, elapsed } = await runClaude(userPrompt, id);
    // Preserve raw Opus stdout for operator inspection on validation rejection.
    try {
      const rawTmp = `${rawPath}.tmp`;
      writeFileSync(rawTmp, stdout, 'utf-8');
      renameSync(rawTmp, rawPath);
    } catch { /* non-fatal */ }
    const result = extractInnerJson(stdout, id);
    const stagingTmp = `${stagingPath}.tmp`;
    writeFileSync(stagingTmp, JSON.stringify(result, null, 2), 'utf-8');
    renameSync(stagingTmp, stagingPath);
    // Clear stale error marker from prior failed attempt on successful retry.
    if (existsSync(errPath)) {
      try { unlinkSync(errPath); } catch { /* non-fatal */ }
    }
    console.log(
      `  ✓ ${id}: ${result._validation.accepted}/${result._validation.submitted} facts accepted (${elapsed}s)`
    );
    if (result._validation.rejected.length > 0) {
      console.log(`    rejected: ${result._validation.rejected.slice(0, 3).join('; ')}${result._validation.rejected.length > 3 ? ' ...' : ''}`);
    }
    return { id, accepted: result._validation.accepted, submitted: result._validation.submitted, elapsed };
  } catch (err) {
    writeFileSync(errPath, String(err), 'utf-8');
    console.error(`  ✗ ${id} FAILED: ${err.message.slice(0, 200)}`);
    return { id, error: err.message };
  }
}

// ---------- Main ----------

// Determine author + traditions.
let author;
let traditions;
if (flags.author) {
  author = flags.author;
  traditions = AUTHOR_TRADITIONS[author];
} else if (flags.article) {
  // Force the operator to specify --author for any single-article retry,
  // preventing silent tradition mistagging via 'unknown' / ['rrm-shared'].
  console.error(`Error: --article requires --author. Specify --author <lastname> from: ${Object.keys(AUTHOR_TRADITIONS).join(', ')}`);
  process.exit(1);
} else {
  author = 'unknown';
  traditions = ['rrm-shared'];
}

// Build target list.
let targets;
if (flags.article) {
  // Single-article mode: load metadata from D1.
  let meta;
  try {
    meta = loadArticleMetadata(flags.article);
  } catch (err) {
    console.error(`Failed to load article metadata for ${flags.article}: ${err.message}`);
    process.exit(1);
  }
  if (!meta) {
    console.error(`Article ${flags.article} not found in D1.`);
    process.exit(1);
  }
  targets = [{ id: meta.id, title: meta.title, year: meta.year, doi: meta.doi, pmid: meta.pmid }];
} else {
  // CSV-driven mode.
  const all = listAuthorArticles(author);
  targets = flags.limit ? all.slice(0, flags.limit) : all;
}

// Cost cap warning.
const estCostLow = (targets.length * 0.30).toFixed(2);
const estCostHigh = (targets.length * 0.50).toFixed(2);
console.log(`\nExtracting facts from ${targets.length} article${targets.length !== 1 ? 's' : ''}...`);
console.log(`Author: ${author} | Traditions: ${JSON.stringify(traditions)}`);
console.log(`Model: opus · Effort: high · Parallel: ${flags.parallel}${flags.dryRun ? ' · DRY-RUN' : ''}`);
console.log(`Estimated cost: $${estCostLow}–$${estCostHigh} at $0.30–$0.50/article (Opus 4.7 high-effort)`);
console.log(`Staging dir: ${STAGING_DIR}\n`);

const results = [];
// Worker pool: keep `parallel` slots busy.
{
  let cursor = 0;
  const active = new Set();
  const launchNext = () => {
    if (sigintReceived || cursor >= targets.length) return null;
    const article = targets[cursor++];
    const p = processArticle(article, author, traditions)
      .then((r) => { results.push(r); })
      .catch((err) => { results.push({ id: article.id, error: err.message || String(err) }); })
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

console.log('\n=== Summary ===');
console.log(`Articles processed: ${targets.length}`);
console.log(`  extracted:    ${ok.length} (${totalFacts} facts total)`);
console.log(`  empty_resp:   ${emptyResponse.length} (opus returned 0 facts)`);
console.log(`  all_rejected: ${allRejected.length} (all facts failed validation)`);
console.log(`  failed:       ${failed.length}`);
console.log(`  skipped:      ${skipped.length}`);
console.log(`Staging dir: ${STAGING_DIR}`);
if (failed.length) {
  console.log('\nFailures:');
  failed.forEach((f) => console.log(`  ${f.id}: ${f.error.slice(0, 140)}`));
  process.exit(1);
}
