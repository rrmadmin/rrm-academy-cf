#!/usr/bin/env node
/**
 * 8.2.4c: quiz migration parity gate (spec 8.1).
 * NOT byte-identity: (a) deep-equal of the STORED content_json (parsed,
 * key-order-insensitive, INCLUDING correctIndex) against quizzes.json for
 * all 4 steps; (b) a scoring round-trip per quiz-type entry: an all-correct
 * answer vector must score 100 and an all-zeros vector must score identically
 * from both sources. Exit 0 = parity; 1 = drift; 2 = runner error.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WRANGLER = process.env.WRANGLER_BIN || 'wrangler'; // global binary; auth via CLOUDFLARE_API_TOKEN env (never npx)
const quizzes = JSON.parse(readFileSync(resolve(ROOT, 'src/data/quizzes.json'), 'utf-8'));

function d1Query(sql) {
  const raw = execFileSync(
    WRANGLER,
    ['d1', 'execute', 'rrm-auth', '--remote', '--json', `--command=${sql}`],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 8 * 1024 * 1024, cwd: ROOT }
  ).toString();
  const lines = raw.split('\n');
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('[')) { start = i; break; }
  }
  if (start === -1) throw new Error(`no JSON in wrangler output: ${raw.slice(0, 200)}`);
  return JSON.parse(lines.slice(start).join('\n'))[0]?.results || [];
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (!deepEqual(ka, kb)) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// Mirrors quiz.js multiple-choice scoring exactly.
function scoreQuiz(entry, answers) {
  let correct = 0;
  for (let i = 0; i < entry.questions.length; i++) {
    if (answers[i] === entry.questions[i].correctIndex) correct++;
  }
  return Math.round((correct / entry.questions.length) * 100);
}

let failures = 0;
const stepIds = Object.keys(quizzes);
const inList = stepIds.map((s) => `'${s}'`).join(',');
const rows = d1Query(`SELECT step_id, content_json FROM step_rendition WHERE format='quiz' AND step_id IN (${inList})`);
const byStep = new Map(rows.map((r) => [r.step_id, r.content_json]));

for (const stepId of stepIds) {
  const staticEntry = quizzes[stepId];
  const storedJson = byStep.get(stepId);
  if (!storedJson) {
    console.error(`FAIL ${stepId}: no step_rendition quiz row in D1`);
    failures++;
    continue;
  }
  let stored;
  try {
    stored = JSON.parse(storedJson);
  } catch (err) {
    console.error(`FAIL ${stepId}: stored content_json does not parse: ${err.message}`);
    failures++;
    continue;
  }
  if (!deepEqual(stored, staticEntry)) {
    console.error(`FAIL ${stepId}: stored content deep-equal mismatch vs quizzes.json (correctIndex included)`);
    failures++;
    continue;
  }
  if (staticEntry.type === 'quiz') {
    const allCorrect = staticEntry.questions.map((q) => q.correctIndex);
    const allZeros = staticEntry.questions.map(() => 0);
    const checks = [
      [scoreQuiz(staticEntry, allCorrect), scoreQuiz(stored, allCorrect), 'all-correct'],
      [scoreQuiz(staticEntry, allZeros), scoreQuiz(stored, allZeros), 'all-zeros'],
    ];
    for (const [a, b, label] of checks) {
      if (a !== b) {
        console.error(`FAIL ${stepId}: scoring round-trip diverges (${label}: static=${a} stored=${b})`);
        failures++;
      }
    }
    if (scoreQuiz(staticEntry, allCorrect) !== 100) {
      console.error(`FAIL ${stepId}: all-correct vector does not score 100 : quizzes.json itself is inconsistent`);
      failures++;
    }
  } else {
    if (stored.questions.length !== staticEntry.questions.length) {
      console.error(`FAIL ${stepId}: questionnaire question count mismatch`);
      failures++;
    }
  }
  console.log(`OK ${stepId}: deep-equal + scoring parity`);
}

if (failures > 0) {
  console.error(`\n${failures} parity failure(s). Do NOT publish or switch quiz.js source.`);
  process.exit(1);
}
console.log(`\nAll ${stepIds.length} quiz renditions parity-verified (incl. cert quiz mc-feedback-3).`);
