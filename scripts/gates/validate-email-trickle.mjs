#!/usr/bin/env node
/**
 * Email trickle gate — STUC member-roster broadcasts must be PACED, never blasted.
 *
 * Born 2026-06-29 (FemTech STUC event): notifyNewPost was firing all ~46 SES sends
 * at once via `Promise.allSettled(members.results.map(...))`. A concurrent burst risks
 * SES send-rate-cap failures and poor deliverability. The fix routes member-roster
 * broadcasts through sendBroadcastTrickle() (batched + delayed between batches). This
 * gate makes the trickle non-regressable: a future edit that reverts to a bare
 * Promise.all/allSettled over the roster, deletes the delay, or neuters the batch size
 * fails the build.
 *
 * Checks (functions/api/community/_email.js):
 *   ET1  notifyNewPost contains NO Promise.all/allSettled (it must delegate the send)
 *   ET2  notifyNewPost calls sendBroadcastTrickle(
 *   ET3  sendBroadcastTrickle exists and is a real trickle: for-loop + .slice( + setTimeout(
 *   ET4  BROADCAST_BATCH_SIZE is a small int (1..25) and BROADCAST_BATCH_DELAY_MS > 0
 *
 * Usage:
 *   node scripts/gates/validate-email-trickle.mjs [--json]
 * Exit: 0 pass, 1 fail, 2 unreadable.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Path is overridable (EMAIL_TRICKLE_FILE) only so the gate itself can be tested
// against blast/neutered fixtures; production runs always use the real file.
const FILE = process.env.EMAIL_TRICKLE_FILE
  ? resolve(process.env.EMAIL_TRICKLE_FILE)
  : resolve(__dirname, '../../functions/api/community/_email.js');

// Extract a function body by brace-matching. Skips the parameter list first so a
// destructured signature like `fn(env, { from, subject })` doesn't fool the matcher
// into capturing the param-object braces instead of the body.
function extractFn(src, sigRegex) {
  const m = src.match(sigRegex);
  if (!m) return null;
  // Walk past the parameter list by matching its parens.
  const paren = src.indexOf('(', m.index);
  if (paren < 0) return null;
  let pd = 0, q = paren;
  for (; q < src.length; q++) {
    if (src[q] === '(') pd++;
    else if (src[q] === ')') { pd--; if (pd === 0) break; }
  }
  // Body opens at the first { after the closing ) of the params.
  const open = src.indexOf('{', q);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(open, j + 1); }
  }
  return null;
}

const checks = [];
const check = (id, desc, pass, detail = '') => checks.push({ id, desc, pass: !!pass, detail });

let src;
try { src = readFileSync(FILE, 'utf8'); }
catch (e) { console.error(`email-trickle gate: cannot read ${FILE}: ${e.message}`); process.exit(2); }

const notifyBody = extractFn(src, /async\s+function\s+notifyNewPost\s*\(/);
const trickleBody = extractFn(src, /async\s+function\s+sendBroadcastTrickle\s*\(/);
const PROMISE_ALL = /Promise\.all(Settled)?\s*\(/;

// ET1 — no raw concurrent broadcast inside notifyNewPost
if (notifyBody == null) check('ET1', 'notifyNewPost present', false, 'could not locate notifyNewPost');
else check('ET1', 'notifyNewPost has no raw Promise.all/allSettled (must use trickle helper)',
  !PROMISE_ALL.test(notifyBody),
  PROMISE_ALL.test(notifyBody) ? 'found Promise.all/allSettled in notifyNewPost — route the roster send through sendBroadcastTrickle' : '');

// ET2 — delegates to the trickle helper
check('ET2', 'notifyNewPost delegates to sendBroadcastTrickle(',
  notifyBody != null && /sendBroadcastTrickle\s*\(/.test(notifyBody),
  (notifyBody && !/sendBroadcastTrickle\s*\(/.test(notifyBody)) ? 'notifyNewPost never calls sendBroadcastTrickle' : '');

// ET3 — helper is a genuine trickle (batch loop + slice + inter-batch delay)
if (trickleBody == null) check('ET3', 'sendBroadcastTrickle present and is a real trickle', false, 'sendBroadcastTrickle not found');
else {
  const hasFor = /for\s*\(/.test(trickleBody);
  const hasSlice = /\.slice\s*\(/.test(trickleBody);
  const hasDelay = /setTimeout\s*\(/.test(trickleBody);
  check('ET3', 'sendBroadcastTrickle batches (for + slice) and delays (setTimeout)',
    hasFor && hasSlice && hasDelay, `for:${hasFor} slice:${hasSlice} setTimeout:${hasDelay}`);
}

// ET4 — pacing constants are sane (not a disguised blast)
const sizeM = src.match(/BROADCAST_BATCH_SIZE\s*=\s*(\d+)/);
const delayM = src.match(/BROADCAST_BATCH_DELAY_MS\s*=\s*(\d+)/);
const size = sizeM ? parseInt(sizeM[1], 10) : null;
const delay = delayM ? parseInt(delayM[1], 10) : null;
check('ET4', 'BROADCAST_BATCH_SIZE in 1..25 and BROADCAST_BATCH_DELAY_MS > 0',
  size != null && size >= 1 && size <= 25 && delay != null && delay > 0,
  `BROADCAST_BATCH_SIZE=${size} BROADCAST_BATCH_DELAY_MS=${delay}`);

const failed = checks.filter(c => !c.pass);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
} else {
  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id}  ${c.desc}${c.detail ? `  — ${c.detail}` : ''}`);
  console.log(failed.length === 0 ? '\nemail-trickle gate: PASS' : `\nemail-trickle gate: FAIL (${failed.length})`);
}
process.exit(failed.length === 0 ? 0 : 1);
