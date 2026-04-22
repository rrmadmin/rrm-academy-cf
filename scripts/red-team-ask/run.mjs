#!/usr/bin/env node
/**
 * Red-team runner for /api/ask.
 *
 * Usage:
 *   ASK_COOKIE='session=...' node scripts/red-team-ask/run.mjs
 *   ASK_COOKIE='...' ASK_ENDPOINT=http://localhost:4323/api/ask node scripts/red-team-ask/run.mjs
 *
 * Env:
 *   ASK_COOKIE     (required)  Raw Cookie header value from an authenticated browser session.
 *   ASK_ENDPOINT   (optional)  Defaults to https://rrmacademy.org/api/ask
 *   ASK_DELAY_MS   (optional)  Delay between requests (default 1200ms, respects upstream pacing)
 *
 * Notes:
 *   - Consumes the authenticated user's 20-req/day /ask quota.
 *   - Writes a dated markdown report to docs/red-team/runs/.
 *   - Prints a summary to stdout (non-zero exit if any FAIL).
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const QUESTIONS_FILE = path.join(HERE, 'questions.json');
const REPORT_DIR = path.join(REPO_ROOT, 'docs', 'red-team', 'runs');

const ENDPOINT = process.env.ASK_ENDPOINT || 'https://rrmacademy.org/api/ask';
const COOKIE = process.env.ASK_COOKIE;
const DELAY_MS = Number(process.env.ASK_DELAY_MS || 1200);

if (!COOKIE) {
  console.error('ERROR: ASK_COOKIE env var is required. Copy your session cookie from devtools.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function grade(question, answer, citations) {
  const results = { status: 'PASS', reasons: [] };

  for (const re of question.fail_if_matches || []) {
    const rx = new RegExp(re);
    if (rx.test(answer)) {
      results.status = 'FAIL';
      results.reasons.push(`matched fail pattern: /${re}/`);
    }
  }

  const passPatterns = question.pass_if_matches || [];
  if (passPatterns.length > 0) {
    const anyPass = passPatterns.some((re) => new RegExp(re).test(answer));
    if (!anyPass && results.status !== 'FAIL') {
      results.status = 'REVIEW';
      results.reasons.push(`no pass pattern matched (expected one of ${passPatterns.length})`);
    }
  }

  return results;
}

function globalChecks(globals, answer, citations) {
  const findings = [];
  if (globals.no_em_dash && new RegExp(globals.no_em_dash.pattern).test(answer)) {
    findings.push(`em dash/hyphen violation: ${globals.no_em_dash.note}`);
  }
  if (globals.no_system_prompt_leak && new RegExp(globals.no_system_prompt_leak.pattern).test(answer)) {
    findings.push(`system prompt leak: ${globals.no_system_prompt_leak.note}`);
  }
  for (const c of citations || []) {
    try {
      const u = new URL(c.url);
      if (u.hostname !== 'rrmacademy.org' && !u.hostname.endsWith('.rrmacademy.org')) {
        findings.push(`non-rrmacademy citation: ${c.url}`);
      }
    } catch {
      findings.push(`malformed citation url: ${c.url}`);
    }
  }
  return findings;
}

async function ask(message) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': COOKIE,
      'User-Agent': 'rrm-academy-red-team/1.0',
    },
    body: JSON.stringify({ message }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }
  return { status: res.status, body: json, raw: text };
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200);
}

async function main() {
  const raw = await readFile(QUESTIONS_FILE, 'utf8');
  const suite = JSON.parse(raw);
  const questions = suite.questions;
  const globals = suite.global_checks || {};

  console.log(`▶ Running ${questions.length} red-team prompts against ${ENDPOINT}`);

  const results = [];
  let passCount = 0, failCount = 0, reviewCount = 0, errorCount = 0;

  for (const q of questions) {
    process.stdout.write(`  ${q.id} [${q.category}] ... `);
    const started = Date.now();
    let resp;
    try {
      resp = await ask(q.question);
    } catch (err) {
      console.log(`ERROR (${err.message})`);
      results.push({ q, status: 'ERROR', reason: err.message, elapsed: Date.now() - started });
      errorCount++;
      await sleep(DELAY_MS);
      continue;
    }
    const elapsed = Date.now() - started;

    if (resp.status !== 200 || !resp.body?.answer) {
      console.log(`HTTP ${resp.status}`);
      results.push({
        q,
        status: 'ERROR',
        reason: `http ${resp.status}: ${resp.body?.error || resp.raw.slice(0, 120)}`,
        elapsed,
      });
      errorCount++;
      await sleep(DELAY_MS);
      continue;
    }

    const answer = resp.body.answer;
    const citations = resp.body.citations || [];
    const graded = grade(q, answer, citations);
    const globalFindings = globalChecks(globals, answer, citations);
    if (globalFindings.length && graded.status === 'PASS') graded.status = 'REVIEW';
    graded.reasons.push(...globalFindings);

    results.push({ q, status: graded.status, reasons: graded.reasons, answer, citations, elapsed });
    console.log(`${graded.status} (${elapsed}ms)`);

    if (graded.status === 'PASS') passCount++;
    else if (graded.status === 'FAIL') failCount++;
    else reviewCount++;

    await sleep(DELAY_MS);
  }

  // Report
  const now = new Date();
  const iso = now.toISOString().slice(0, 19).replace(/:/g, '-');
  const reportFile = path.join(REPORT_DIR, `ask-${iso}.md`);
  await mkdir(REPORT_DIR, { recursive: true });

  const lines = [];
  lines.push(`# /ask red-team report -- ${now.toISOString()}`);
  lines.push('');
  lines.push(`- Endpoint: \`${ENDPOINT}\``);
  lines.push(`- Questions: ${questions.length}`);
  lines.push(`- PASS: **${passCount}** / FAIL: **${failCount}** / REVIEW: **${reviewCount}** / ERROR: **${errorCount}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| ID | Category | Status | Notes |');
  lines.push('|----|----------|--------|-------|');
  for (const r of results) {
    lines.push(`| ${r.q.id} | ${r.q.category} | ${r.status} | ${mdEscape((r.reasons || [r.reason]).join('; '))} |`);
  }
  lines.push('');
  lines.push('## Details');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.q.id} -- ${r.q.category} -- ${r.status}`);
    lines.push('');
    lines.push(`**Prompt:** ${r.q.question}`);
    lines.push('');
    lines.push(`**Intent:** ${r.q.intent}`);
    lines.push('');
    if (r.answer) {
      lines.push('**Answer:**');
      lines.push('');
      lines.push('> ' + r.answer.replace(/\n/g, '\n> '));
      lines.push('');
    }
    if (r.citations && r.citations.length) {
      lines.push('**Citations:**');
      for (const c of r.citations) lines.push(`- ${c.url}${c.title ? ` -- ${c.title}` : ''}`);
      lines.push('');
    }
    if ((r.reasons || [r.reason]).filter(Boolean).length) {
      lines.push('**Grader notes:**');
      for (const reason of r.reasons || [r.reason]) if (reason) lines.push(`- ${reason}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  await writeFile(reportFile, lines.join('\n'), 'utf8');
  console.log('');
  console.log(`📄 Report: ${path.relative(REPO_ROOT, reportFile)}`);
  console.log(`Summary: ${passCount} PASS · ${failCount} FAIL · ${reviewCount} REVIEW · ${errorCount} ERROR`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(3);
});
