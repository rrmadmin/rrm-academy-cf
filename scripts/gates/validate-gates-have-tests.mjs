#!/usr/bin/env node
/**
 * Every gate has a test, or is written down as not having one.
 *
 * WHY THIS EXISTS. On 2026-09-18 an audit counted the gates in this directory:
 * 26 of them, and 17 had no test at all. A gate is ordinary code -- it can be
 * weakened by an edit, or be wrong from the day it was written -- and until
 * that day nothing in this repo required proof that any gate still refuses
 * what it was built to refuse. Three harnesses were written by hand that day
 * (payment, analytics, fact-pipeline) and one for scripts/guard.mjs. Writing
 * three does nothing about the twenty-seventh gate, which is what this file is
 * for: a gate cannot be BORN untested any more.
 *
 * WHAT IT PROVES, AND WHAT IT CANNOT. It proves a test FILE exists next to
 * each gate. It cannot prove the test has teeth. Proving that for
 * validate-payment-pipeline.mjs took sixteen hand-run cycles -- weaken one
 * assertion, confirm the harness goes red, restore it -- and no mechanical
 * check can stand in for that. So a green GG1 means "somebody wrote a test",
 * never "this gate is falsifiable". Read a new harness the way you would read
 * any other test: ask what it would take for it to pass while the gate is
 * broken. The whole reason this file exists is that a test nobody has watched
 * fail is indistinguishable from a decoration, and that applies to the tests
 * this gate demands exactly as much as to the gates it demands them for.
 *
 * Usage:
 *   node scripts/gates/validate-gates-have-tests.mjs
 *   node scripts/gates/validate-gates-have-tests.mjs --json
 *
 * Env:
 *   GATES_TEST_GATE_ROOT  scan this tree instead of the repo (harness only;
 *                         same convention as PAYMENT_GATE_ROOT)
 *
 * Exit codes:
 *   0  every gate has a test or a written exemption, and no exemption is stale
 *   1  a gate has neither, or an exemption has gone stale
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// GATES_TEST_GATE_ROOT lets a falsification harness point this gate at a
// fixture tree. Unset in CI and pre-commit, where it scans the real repo.
const PROJECT_ROOT = process.env.GATES_TEST_GATE_ROOT || resolve(__dirname, '../..');
const GATES_DIR = join(PROJECT_ROOT, 'scripts/gates');
const EXEMPTIONS_FILE = join(GATES_DIR, 'gates-without-tests.json');

const GREEN = '\x1b[32m', RED = '\x1b[31m', BOLD = '\x1b[1m', RESET = '\x1b[0m', DIM = '\x1b[2m';

// An exemption must say WHY, at length. Borrowed from this directory's own
// EXCLUDED_MIN_REASON in validate-payment-pipeline.mjs: a one-word reason is a
// way of not writing one, and the list is only useful if each line tells the
// next reader whether the exemption still holds.
const MIN_REASON = 40;

// THIS GATE IS ITSELF A GATE, so it would demand a test of itself and find
// one: scripts/gates/validate-gates-have-tests.test.mjs. It is named here only
// so a reader does not wonder whether the recursion was noticed.
const SELF = 'validate-gates-have-tests.mjs';

/** Gate files: every .mjs in scripts/gates that is not itself a test. */
function gateFiles() {
  return readdirSync(GATES_DIR)
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
    .sort();
}

function loadExemptions() {
  if (!existsSync(EXEMPTIONS_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(EXEMPTIONS_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed.gates ?? parsed) : {};
  } catch (err) {
    // An unreadable exemptions file is a hard failure, not an empty list: the
    // fail-open reading would silently exempt every gate in the repo, which is
    // the exact defect class this file belongs to.
    console.error(`${RED}${BOLD}✗ ${EXEMPTIONS_FILE} is not readable JSON: ${err.message}${RESET}`);
    console.error('  Fix the file. An unreadable exemption list must never be read as "no exemptions".');
    process.exit(1);
  }
}

const gates = gateFiles();
const exemptions = loadExemptions();
const items = [];
let failures = 0;

const add = (ok, msg) => { items.push({ ok, msg }); if (ok === false) failures += 1; };

// --- GG1: every gate has a test, or a written exemption --------------------
for (const gate of gates) {
  const base = gate.replace(/\.mjs$/u, '');
  const hasTest = existsSync(join(GATES_DIR, `${base}.test.mjs`));
  const reason = exemptions[gate];

  if (hasTest) continue;

  if (reason === undefined) {
    add(false, `${gate} has no ${base}.test.mjs and no entry in gates-without-tests.json`);
  } else if (typeof reason !== 'string' || reason.trim().length < MIN_REASON) {
    add(false, `${gate} is exempt with a reason under ${MIN_REASON} characters: ${JSON.stringify(reason)}`);
  } else {
    add(null, `${gate} exempt: ${reason.slice(0, 72)}${reason.length > 72 ? '…' : ''}`);
  }
}

const untested = gates.filter((g) => !existsSync(join(GATES_DIR, `${g.replace(/\.mjs$/u, '')}.test.mjs`)));
// This summary row USED to read "<n> exempt with written reasons" for every
// untested gate unconditionally, and was an `add(true, ...)` -- so on a repo
// with 15 untested gates and an EMPTY exemption list it printed a green row
// claiming 15 written reasons that did not exist. It is the shape this whole
// gate exists to refuse (an assertion that cannot fail, stating something
// false), found in the gate's own output on 2026-09-18. It now counts the two
// populations separately and only passes when they account for each other.
const explained = untested.filter((g) => typeof exemptions[g] === 'string'
  && exemptions[g].trim().length >= MIN_REASON);
const unexplained = untested.length - explained.length;
if (untested.length === 0) {
  add(true, `all ${gates.length} gates have a test; the exemption list is empty`);
} else {
  add(unexplained === 0,
    `${gates.length - untested.length} of ${gates.length} gates have a test; `
    + `${explained.length} exempt with a written reason`
    + (unexplained > 0 ? `; ${unexplained} with NEITHER` : ''));
}

// --- GG2: no stale exemptions ----------------------------------------------
// The list may only shrink. A gate that gains a test must lose its entry, or
// the list stops describing the repo and starts describing its own history --
// which is how a carve-out survives the condition that justified it. This
// directory's PG0 fails the same way on a stale NOT_A_WEBHOOK_HANDLER entry.
for (const gate of Object.keys(exemptions).sort()) {
  if (!gates.includes(gate)) {
    add(false, `gates-without-tests.json names ${gate}, which is not a gate in this directory (renamed or deleted?)`);
  } else if (existsSync(join(GATES_DIR, `${gate.replace(/\.mjs$/u, '')}.test.mjs`))) {
    add(false, `gates-without-tests.json still exempts ${gate}, but it now HAS a test -- remove the entry`);
  }
}
if (Object.keys(exemptions).length > 0) {
  add(true, `${Object.keys(exemptions).length} exemption(s) checked for staleness`);
}

// --- report ----------------------------------------------------------------
const pass = failures === 0;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    pass, failures, gates: gates.length, tested: gates.length - untested.length,
    exempt: Object.keys(exemptions).length, self: SELF, items,
  }, null, 2));
} else {
  console.log(`${BOLD}Gate GG: every gate has a test${RESET}`);
  for (const it of items) {
    const mark = it.ok === false ? `${RED}✗${RESET}` : it.ok === null ? `${DIM}~${RESET}` : `${GREEN}✓${RESET}`;
    console.log(`  ${mark} ${it.msg}`);
  }
  console.log(pass
    ? `${GREEN}${BOLD}✓ gate-test coverage gate passed${RESET}`
    : `${RED}${BOLD}✗ ${failures} failure(s)${RESET}\n  Write scripts/gates/<gate>.test.mjs, or add the gate to scripts/gates/gates-without-tests.json with a reason of at least ${MIN_REASON} characters saying why not yet.`);
}

process.exit(pass ? 0 : 1);
