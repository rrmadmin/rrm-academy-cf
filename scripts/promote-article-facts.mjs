#!/usr/bin/env node
/**
 * promote-article-facts.mjs — Promote staging fact files to D1 via
 * rrm-library-worker /promote-facts endpoint.
 *
 * Reads:
 *   /tmp/article-facts/<recXXX>.json   (from extract-article-facts.mjs)
 *
 * Calls:
 *   POST {worker}/promote-facts  (admin Bearer auth)
 *
 * Usage:
 *   node scripts/promote-article-facts.mjs --all
 *   node scripts/promote-article-facts.mjs --article recABC123DEF456GHI78
 *   node scripts/promote-article-facts.mjs --dry-run --all
 *   node scripts/promote-article-facts.mjs --batch 20 --all
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { execFileSync } from 'child_process';

const STAGING_DIR = '/tmp/article-facts';
const FAIL_PATH = '/tmp/article-facts/_failures.json';
const WORKER = 'https://rrm-library-worker.administrator-cloudflare.workers.dev';

const ALLOWED_TRADITIONS = new Set([
  'rrm-shared','independent','fabm','napro','creighton',
  'femm','conventional','billings','neofertility'
]);

const argv = process.argv.slice(2);
const flags = {
  all: argv.includes('--all'),
  dryRun: argv.includes('--dry-run'),
};
const articleIdx = argv.indexOf('--article');
flags.article = articleIdx >= 0 ? argv[articleIdx + 1] : null;
const batchIdx = argv.indexOf('--batch');
flags.batch = batchIdx >= 0
  ? Math.max(1, Math.min(100, parseInt(argv[batchIdx + 1], 10) || 20))
  : 20;

if (!flags.all && !flags.article) {
  console.error('Usage: --all | --article <recXXX>  [--batch N] [--dry-run]');
  process.exit(1);
}

function loadToken() {
  try {
    const tok = execFileSync('op', ['read', 'op://Automation/RRM Library Worker Admin Token/credential'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (!tok) throw new Error('empty token from 1Password');
    return tok;
  } catch {
    const fallback = '/tmp/admin_token.txt';
    if (existsSync(fallback)) {
      const st = statSync(fallback);
      if ((st.mode & 0o077) !== 0) {
        throw new Error(`admin_token_permissions_unsafe — chmod 600 ${fallback}`);
      }
      const tok = readFileSync(fallback, 'utf-8').trim();
      if (!tok) throw new Error(`empty token in ${fallback}`);
      return tok;
    }
    throw new Error('Could not load admin token from 1Password or /tmp/admin_token.txt');
  }
}

async function postFacts(facts, token) {
  try {
    const res = await fetch(`${WORKER}/promote-facts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ facts }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => ({ error: 'non-json response', status: res.status }));
    const retryAfterRaw = res.headers.get('Retry-After');
    const retryAfterSec = retryAfterRaw !== null ? parseInt(retryAfterRaw, 10) : NaN;
    const retryAfter = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec : null;
    return { status: res.status, body, retryAfter };
  } catch (err) {
    return { status: 0, body: { error: 'network_error', message: String(err.message || err) }, retryAfter: null };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postFactsWithRetry(facts, token, maxRetries = 3) {
  let attempt = 0;
  let last;
  while (attempt < maxRetries) {
    const result = await postFacts(facts, token);
    last = result;
    const s = result.status;
    if (s === 401) return { ...result, fatal: true };
    if (s === 200 && result.body && result.body.ok) return result;
    if (s === 0 || s === 429 || (s >= 500 && s < 600)) {
      if (attempt < maxRetries) {
        const backoff = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        const ra = s === 429 && result.retryAfter ? result.retryAfter * 1000 : 0;
        await sleep(ra > backoff ? ra : backoff);
        attempt += 1;
        continue;
      }
    }
    return result;
  }
  return last;
}

// ---------- Collect staging files ----------
let files;
if (flags.article) {
  const p = join(STAGING_DIR, `${flags.article}.json`);
  if (!existsSync(p)) {
    console.error(`Staging file not found: ${p}`);
    process.exit(1);
  }
  files = [p];
} else {
  // Accept ONLY canonical staging files (rec*.json) — rejects .raw.json,
  // .prompt.txt, .tmp, .error.txt, _failures.json automatically.
  files = readdirSync(STAGING_DIR)
    .filter((f) => /^rec[A-Za-z0-9]{14,17}\.json$/.test(f) && f !== '_failures.json')
    .map((f) => join(STAGING_DIR, f));
}

// Normalize the `tradition` value to a JSON-array-string (e.g. '["napro"]')
// or null for invalid/empty input. Handles array, JSON-array-string, bare
// string, comma-separated string, null, undefined. Facts with null tradition
// still send (worker stores null); they are later excluded from canonical JSONs.
function normalizeTradition(t) {
  if (t === null || t === undefined) return null;
  let arr = null;
  if (Array.isArray(t)) {
    arr = t;
  } else if (typeof t === 'string') {
    const s = t.trim();
    if (!s) return null;
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        arr = Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    } else if (s.startsWith('{')) {
      // A JSON-object string is not a valid tradition input — bail out
      // before the comma-split fallback turns it into junk tokens.
      return null;
    }
    if (arr === null) {
      arr = s.includes(',') ? s.split(',') : [s];
    }
  } else {
    return null;
  }
  const clean = arr
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
  if (clean.length === 0) return null;
  // Drop unknown tradition values; if nothing remains, return null so
  // canonical JSONs exclude the fact rather than store invalid tags.
  const valid = clean.filter((v) => ALLOWED_TRADITIONS.has(v));
  if (valid.length === 0) return null;
  return JSON.stringify(valid);
}

const failures = [];

function flushFailures() {
  try {
    writeFileSync(FAIL_PATH, JSON.stringify(failures, null, 2));
  } catch (err) {
    console.error(`  [warn] could not flush _failures.json: ${err.message}`);
  }
}

process.on('SIGINT', () => {
  flushFailures();
  process.exit(130);
});

console.log(`Loading ${files.length} staging file${files.length === 1 ? '' : 's'}...`);
const allFacts = [];
const byArticle = [];
let parseErrorCount = 0;
for (const f of files) {
  try {
    const doc = JSON.parse(readFileSync(f, 'utf-8'));
    if (!doc.facts || !Array.isArray(doc.facts)) continue;
    // Drop `_validation` metadata; keep only /promote-facts schema fields.
    // Per-fact guard: skip malformed entries so one bad fact does not nuke others.
    let dropped = 0;
    const clean = [];
    for (const x of doc.facts) {
      if (
        !x ||
        typeof x !== 'object' ||
        typeof x.id !== 'string' ||
        typeof x.claim !== 'string' ||
        typeof x.verification_notes !== 'string'
      ) {
        dropped += 1;
        continue;
      }
      clean.push({
        id: x.id,
        source_id: x.source_id,
        claim: x.claim,
        category: x.category,
        domain: x.domain,
        tradition: normalizeTradition(x.tradition),
        claim_type: x.claim_type,
        verified: typeof x.verified === 'number' ? x.verified : 1,
        verification_notes: x.verification_notes,
        body: x.body || undefined,
      });
    }
    if (dropped > 0) {
      console.error(`  [warn] ${f}: dropped ${dropped} malformed fact${dropped === 1 ? '' : 's'}`);
    }
    allFacts.push(...clean);
    // Staging JSON has no `article_id` field; derive from filename so
    // byArticle reporting shows the actual recXXX, not undefined.
    const articleId = basename(f, '.json');
    byArticle.push({ id: articleId, count: clean.length });
  } catch (err) {
    console.error(`  skip ${f}: ${err.message}`);
    failures.push({ type: 'parse_error', file: f, status: 'parse_error', error: String(err.message || err).slice(0, 300) });
    parseErrorCount += 1;
    flushFailures();
  }
}

console.log(`Total facts to promote: ${allFacts.length}`);
byArticle.forEach((a) => console.log(`  ${a.id}: ${a.count} facts`));

if (flags.dryRun) {
  const preview = JSON.stringify({ facts: allFacts.slice(0, 3) }, null, 2);
  console.log(`\nFirst 3 facts (dry-run preview):\n${preview}`);
  console.log(`\n[dry-run] would POST ${allFacts.length} facts in ${Math.ceil(allFacts.length / flags.batch)} batch(es) of ${flags.batch}`);
  process.exit(0);
}

// ---------- POST in batches ----------
const token = loadToken();
let total_upserted = 0;
let total_relationships = 0;

let aborted = false;
for (let i = 0; i < allFacts.length; i += flags.batch) {
  const batch = allFacts.slice(i, i + flags.batch);
  const batchNum = Math.floor(i / flags.batch) + 1;
  const totalBatches = Math.ceil(allFacts.length / flags.batch);
  process.stdout.write(`POST batch ${batchNum}/${totalBatches} (${batch.length} facts)... `);
  const result = await postFactsWithRetry(batch, token);
  const { status, body, fatal } = result;
  if (status !== 200 || !body.ok) {
    console.log(`FAIL (HTTP ${status}): ${JSON.stringify(body).slice(0, 300)}`);
    failures.push({ type: 'http_error', batch: batchNum, status, body, fact_ids: batch.map((f) => f.id) });
    flushFailures();
    if (fatal || status === 401) {
      console.error(`\nAborting: token rejected (401). Remaining batches: ${totalBatches - batchNum}`);
      aborted = true;
      break;
    }
    continue;
  }
  console.log(`ok ${body.upserted}/${body.relationships_created} (D1 total_verified=${body.total_verified})`);
  total_upserted += body.upserted || 0;
  total_relationships += body.relationships_created || 0;
}

console.log('\n=== Promotion Summary ===');
console.log(`Upserted:   ${total_upserted}`);
console.log(`Relationships: ${total_relationships}`);
console.log(`Parse errors: ${parseErrorCount}`);
console.log(`Failures:   ${failures.length}${aborted ? ' (ABORTED on 401)' : ''}`);
if (aborted) process.exit(2);
if (failures.length) {
  flushFailures();
  console.log(`Failure log: ${FAIL_PATH}`);
  process.exit(1);
}
if (parseErrorCount) process.exit(1);
