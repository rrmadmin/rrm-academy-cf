#!/usr/bin/env node
/**
 * ask-eval: fire a bank of sample questions at the RRM Academy AI and save the transcript.
 *
 * Two modes:
 *
 *   PRODUCTION  goes through https://rrmacademy.org/api/ask with a session cookie (log in, copy the
 *               `session` cookie from DevTools). Rate limited server side: 3/day free, 20/day member.
 *               RRM_SESSION=<cookie> node scripts/ask-eval/run.mjs --limit 12
 *
 *   EVAL        goes through the throwaway worker zz-ask-eval-delete-me (same upstream, same prompt,
 *               no user, no cap). Every answer is archived to rrm-analytics ask_answer with source 'eval'.
 *               EVAL_TOKEN=$(op read 'op://Automation/RRM Ask Eval Worker Token/credential') \
 *               node scripts/ask-eval/run.mjs --eval --limit 357 --tag run-2026-09-01
 *
 * Flags:
 *   --bank <path>      question bank JSON (default: scripts/ask-eval/question-bank.json)
 *   --segment <name>   only run questions from a segment (substring match, repeatable)
 *   --persona <name>   only run questions for a persona (substring match, repeatable)
 *   --limit <n>        max questions to send (default 12)
 *   --start <n>        skip the first n matching questions (for resuming a run)
 *   --delay <ms>       pause between requests (default 1500)
 *   --base <url>       origin (default https://rrmacademy.org)
 *   --out <dir>        output dir (default scripts/ask-eval/runs)
 *   --eval             use the eval worker instead of production (needs EVAL_TOKEN)
 *   --eval-url <url>   override the eval worker origin
 *   --tag <str>        eval_tag written to ask_answer for this run (default: run-<timestamp>)
 *   --dry-run          print the selection and exit without sending anything
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { segment: [], persona: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'dry-run') { out.dryRun = true; continue; }
    if (key === 'eval') { out.eval = true; continue; }
    const val = argv[++i];
    if (key === 'segment' || key === 'persona') out[key].push(val.toLowerCase());
    else out[key] = val;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const EVAL_URL = (args['eval-url'] || 'https://zz-ask-eval-delete-me.administrator-cloudflare.workers.dev').replace(/\/$/, '');
const BASE = (args.base || 'https://rrmacademy.org').replace(/\/$/, '');
const EVAL = !!args.eval;
const LIMIT = Number(args.limit || 12);
const START = Number(args.start || 0);
const DELAY = Number(args.delay ?? 1500);
const BANK = args.bank || path.join(HERE, 'question-bank.json');
const OUTDIR = args.out || path.join(HERE, 'runs');

if (!fs.existsSync(BANK)) {
  console.error(`No question bank at ${BANK}. Pass --bank <path>.`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(BANK, 'utf8'));
const segments = Array.isArray(raw) ? raw : (raw.segments || []);

let all = [];
for (const seg of segments) {
  for (const q of (seg.questions || [])) {
    all.push({ segment: seg.segment, ...q });
  }
}

const matches = (hay, needles) => needles.length === 0 || needles.some(n => (hay || '').toLowerCase().includes(n));
let selected = all
  .filter(q => matches(q.segment, args.segment))
  .filter(q => matches(q.persona, args.persona))
  .slice(START, START + LIMIT);

if (selected.length === 0) {
  console.error('No questions matched. Available segments:');
  for (const s of segments) console.error(`  ${s.segment} (${(s.questions || []).length})`);
  process.exit(1);
}

console.log(`Bank: ${BANK}`);
console.log(`Total questions: ${all.length}   selected: ${selected.length}   (start ${START}, limit ${LIMIT})`);
for (const [i, q] of selected.entries()) {
  console.log(`  ${String(START + i + 1).padStart(3)}. [${q.segment}] ${q.q.slice(0, 100).replace(/\n/g, ' ')}`);
}

if (args.dryRun) process.exit(0);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const TAG = args.tag || `run-${stamp}`;
const SESSION = process.env.RRM_SESSION || args.cookie;
const EVAL_TOKEN = process.env.EVAL_TOKEN;
if (EVAL && !EVAL_TOKEN) {
  console.error('\n--eval needs EVAL_TOKEN. op read "op://Automation/RRM Ask Eval Worker Token/credential"');
  process.exit(1);
}
if (!EVAL && !SESSION) {
  console.error('\nNo session. Set RRM_SESSION to the `session` cookie value from a logged-in rrmacademy.org tab.');
  console.error('Free accounts get 3 questions/day, members and staff get 20/day.');
  process.exit(1);
}

async function askEval(message, tag) {
  const started = Date.now();
  const res = await fetch(`${EVAL_URL}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${EVAL_TOKEN}`, 'User-Agent': 'rrm-ask-eval/1.0' },
    body: JSON.stringify({ message, tag }),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* noop */ }
  return { status: res.status, ms: Date.now() - started, remaining: null, limit: null, data, raw: data ? null : text.slice(0, 500) };
}

async function ask(message) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Cookie': `session=${SESSION}`,
      'Origin': BASE,
      'Referer': `${BASE}/ask/`,
      'User-Agent': 'rrm-ask-eval/1.0',
    },
    body: JSON.stringify({ message }),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* SSE or error page */ }
  if (!data && text.includes('data: ')) {
    const line = text.split('\n').find(l => l.startsWith('data: ') && !l.includes('[DONE]'));
    if (line) { try { data = JSON.parse(line.slice(6)); } catch { /* noop */ } }
  }
  return {
    status: res.status,
    ms: Date.now() - started,
    remaining: res.headers.get('RateLimit-Remaining'),
    limit: res.headers.get('RateLimit-Limit'),
    data,
    raw: data ? null : text.slice(0, 500),
  };
}

fs.mkdirSync(OUTDIR, { recursive: true });
const jsonPath = path.join(OUTDIR, `${stamp}.json`);
const mdPath = path.join(OUTDIR, `${stamp}.md`);

const results = [];
const md = [`# RRM Academy AI sample run`, ``, `Run: ${stamp}`, `Mode: ${EVAL ? 'eval worker' : 'production'}`, `Tag: ${EVAL ? TAG : '(none)'}`, `Bank: ${BANK}`, ``];
console.log(EVAL ? `Mode: EVAL worker ${EVAL_URL}  tag=${TAG}` : `Mode: PRODUCTION ${BASE}`);

console.log('');
for (const [i, q] of selected.entries()) {
  const n = START + i + 1;
  process.stdout.write(`[${n}/${START + selected.length}] ${q.q.slice(0, 70).replace(/\n/g, ' ')} ... `);
  let r;
  try {
    r = EVAL ? await askEval(q.q, `${TAG}|${q.segment}|${n}`) : await ask(q.q);
  } catch (err) {
    r = { status: 0, ms: 0, data: null, raw: String(err && err.message ? err.message : err) };
  }

  const answer = r.data?.answer || '';
  const citations = r.data?.citations || [];
  const usage = r.data?.usage || null;
  const neurons = usage?.neurons != null ? usage.neurons.toFixed(1) : null;
  const tail = EVAL
    ? `${usage ? usage.total_tokens + 'tok' : ''}${neurons ? ' ' + neurons + 'n' : ''}${r.data?.fallback ? ' FALLBACK' : ''}${r.data?.archive_error ? ' ARCHIVE-ERR' : ''} id=${r.data?.ask_answer_id ?? '-'}`
    : `(${r.remaining ?? '?'}/${r.limit ?? '?'} left)`;
  console.log(`${r.status} ${r.ms}ms  ${answer.length}ch  ${citations.length} cites  ${tail}`);

  results.push({ n, ...q, status: r.status, ms: r.ms, answer, citations, usage, fallback: !!r.data?.fallback,
    ask_answer_id: r.data?.ask_answer_id ?? null, archive_error: r.data?.archive_error ?? null, error: r.raw || null });

  md.push(`## ${n}. ${q.q.replace(/\n/g, ' ')}`, ``);
  md.push(`- Segment: ${q.segment}  |  Persona: ${q.persona}  |  Intent: ${q.intent}`);
  md.push(`- Watch for: ${q.expect}`);
  md.push(`- HTTP ${r.status} in ${r.ms}ms, ${citations.length} citations${usage ? `, ${usage.total_tokens} tokens${neurons ? `, ${neurons} neurons` : ''}` : ''}${r.data?.fallback ? ', FALLBACK' : ''}${r.data?.ask_answer_id ? `, ask_answer #${r.data.ask_answer_id}` : ''}`, ``);
  md.push(answer ? answer : `(no answer) ${r.raw || ''}`, ``);
  if (citations.length) {
    md.push(`Citations:`);
    for (const c of citations) md.push(`- ${c.title || ''} ${c.url}`);
    md.push(``);
  }

  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  fs.writeFileSync(mdPath, md.join('\n'));

  if (EVAL && r.status >= 500) {
    console.log(`  upstream ${r.status}: ${r.raw || JSON.stringify(r.data).slice(0, 200)}`);
  }
  if (r.status === 429) {
    console.log('\nRate limited. Stopping. Resume tomorrow with --start ' + n);
    break;
  }
  if (r.status === 401) {
    console.log('\nSession rejected (401). Grab a fresh `session` cookie and rerun.');
    break;
  }
  if (r.remaining !== null && Number(r.remaining) <= 0) {
    console.log('\nQuota exhausted for today. Resume tomorrow with --start ' + n);
    break;
  }
  if (i < selected.length - 1 && DELAY) await new Promise(res => setTimeout(res, DELAY));
}

console.log(`\nTranscript: ${mdPath}`);
console.log(`JSON:       ${jsonPath}`);
