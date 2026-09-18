/**
 * Falsification harness for the fact-pipeline proof gates (G1-G5).
 *
 * The gate encodes the 13 bugs found by /arise --deep on the canonical-facts
 * pipeline — chiefly the Creighton CRITICAL, where the entity matcher accepted
 * 'fabm' but not 'creighton' and 724 published facts fell out of the SSOT — and
 * until 2026-09-18 nothing proved it still refused any of them: an edit that
 * weakened an assertion produced a green CI run. Each test here plants the exact
 * regression the corresponding assertion exists to catch and asserts the gate
 * goes RED and NAMES it. A gate nobody has watched fail is a decoration.
 *
 * Fixtures are DERIVED from the real surface, not hand-authored:
 *   - G2/G5: the four in-repo SSOTs are read for real and re-serialised with
 *     their first 8 source-bearing facts and a corrected record_count. A
 *     straight cpSync is 14 MB per fixture across ~20 fixtures; the slice keeps
 *     every field shape, ID convention and tradition array authentic (so the
 *     clean case is green by construction and cannot drift out of sync with
 *     FACT_ID_PATTERNS / ALLOWED_TRADITIONS) at 1/1000th the I/O. The
 *     orchestrators and both system-prompt.md files ARE cpSync copies — they are
 *     small and G3/G4 parse their exact syntax.
 *   - The fifth SSOT, neofertility, is SYNTHESIZED into the fixture's own temp
 *     sibling directory. The gate resolves it through ../neofertility-ie, and
 *     that clone exists here but not on a GitHub runner: copying from it turned
 *     all 12 fixture-backed G2 tests red in CI on PR #184 while they were green
 *     locally. Nothing in this file reads a clone other than this repo.
 *   - G1: G1 reads ENTITIES through a static import resolved from the gate's own
 *     directory, which no root override can redirect. So the G1 fixture is a
 *     byte-identical cpSync copy of the gate beside a copy of
 *     scripts/lib/canonical-facts-schema.mjs, and the schema copy is what gets
 *     mutated. schemaFixture() asserts the copy still equals the real gate, so a
 *     drifted copy cannot quietly pass for it.
 *
 * Only ONE test reads the real surface end to end, and it asserts G1/G3/G4 —
 * the gates that need no out-of-repo checkout. G2's dependency on the sibling
 * clone is named and proven by two further tests rather than skipped: one
 * asserts G2 is green where the sibling exists and that a missing sibling is its
 * only tolerated failure, and one builds a runner-shaped sibling-less checkout
 * so that contract is executed on every machine.
 *
 * No network, no D1, no wrangler. G5's live half is unreachable offline; the two
 * G5 tests here pin its --quick skip contract and its SSOT-read failure path,
 * and assert no D1 query was attempted. Static analysis over temp directories.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATE_DIR = dirname(fileURLToPath(import.meta.url));
const GATE = join(GATE_DIR, 'validate-fact-pipeline.mjs');
const REPO = join(GATE_DIR, '..', '..');

const SCHEMA_REL = 'scripts/lib/canonical-facts-schema.mjs';
const ARTICLE_PROMPT = 'scripts/article-extraction/system-prompt.md';
const CHAPTER_PROMPT = 'scripts/chapter-extraction/system-prompt.md';
const ARTICLE_SCRIPT = 'scripts/extract-article-facts.mjs';
const CHAPTER_SCRIPT = 'scripts/extract-chapter-facts.mjs';
const PROMOTE_ARTICLE = 'scripts/promote-article-facts.mjs';
const PROMOTE_CHAPTER = 'scripts/promote-chapter-facts.mjs';

const SCRIPT_COPIES = [
  ARTICLE_SCRIPT, CHAPTER_SCRIPT, PROMOTE_ARTICLE, PROMOTE_CHAPTER,
  ARTICLE_PROMPT, CHAPTER_PROMPT,
];

// The four in-repo entities plus the one whose SSOT lives in a sibling repo.
// neofertility is here deliberately: the gate resolves it through
// ../neofertility-ie, and a fixture that omitted it would never exercise that
// out-of-repo hop.
const IN_REPO_ENTITIES = ['naprotechnology', 'creighton', 'rrm', 'femm'];
const ALL_ENTITIES = [...IN_REPO_ENTITIES, 'neofertility'];
const SLICE = 8;

/** Does the out-of-repo neofertility checkout exist beside this one? */
const SIBLING_SSOT = join(REPO, '..', 'neofertility-ie', 'docs/fact-check/neofertility-canonical-facts.json');
const SIBLING_PRESENT = existsSync(SIBLING_SSOT);

const ssotCache = new Map();

/** Real in-repo SSOT reduced to SLICE source-bearing facts, record_count fixed. */
function slicedSsot(entity) {
  if (ssotCache.has(entity)) return ssotCache.get(entity);
  assert.ok(IN_REPO_ENTITIES.includes(entity), `${entity} has no in-repo SSOT to slice`);
  const doc = JSON.parse(readFileSync(join(REPO, 'docs/fact-check', `${entity}-canonical-facts.json`), 'utf-8'));
  // Source-bearing only, so the clean fixture carries zero empty-source_id warns
  // and the G2 warn test can assert an exact count of 1.
  const facts = doc.facts
    .filter((f) => (f.source_id && f.source_id.length > 0) ||
                   (f.source && (f.source.article_id || f.source.raw_source_id)))
    .slice(0, SLICE);
  assert.equal(facts.length, SLICE, `${entity}: real SSOT yielded fewer than ${SLICE} usable facts`);
  const out = { _meta: { ...doc._meta, record_count: facts.length }, _manual: doc._manual, facts };
  ssotCache.set(entity, out);
  return out;
}

/**
 * The neofertility fixture SSOT is SYNTHESIZED, never copied from the sibling
 * clone. That clone exists on the Blue iMac and does NOT exist on a GitHub
 * runner, and reading it here turned every G2 fixture test red in CI on PR #184
 * while the same tests were green locally. Content is a real in-repo slice with
 * its tradition retagged to 'neofertility' so the entity matcher routes it, so
 * the fields, ID formats and source blocks stay authentic and the fixture runs
 * anywhere. The gate's real ../neofertility-ie resolution is still exercised —
 * it lands inside the fixture's own temp parent, not on the machine's clone.
 */
function synthesizedNeofertilitySsot() {
  if (ssotCache.has('neofertility')) return ssotCache.get('neofertility');
  const donor = slicedSsot('femm');
  const out = {
    _meta: {
      ...donor._meta,
      entity: 'neofertility',
      entity_name: 'NeoFertility',
      source: 'synthesized fixture (falsification harness) — not the live SSOT',
      record_count: donor.facts.length,
    },
    _manual: donor._manual,
    facts: donor.facts.map((f) => ({ ...f, tradition: ['neofertility'] })),
  };
  ssotCache.set('neofertility', out);
  return out;
}

const fixtureSsot = (entity) =>
  (entity === 'neofertility' ? synthesizedNeofertilitySsot() : slicedSsot(entity));

function ssotPath(root, entity) {
  return entity === 'neofertility'
    ? join(root, '..', 'neofertility-ie', 'docs/fact-check/neofertility-canonical-facts.json')
    : join(root, 'docs/fact-check', `${entity}-canonical-facts.json`);
}

/**
 * A reduced copy of the real fact surface: SSOTs, orchestrators, prompts.
 * PROJECT_ROOT sits at <tmp>/project so the gate's own `../neofertility-ie`
 * resolution lands at <tmp>/neofertility-ie, inside the fixture. Nothing here
 * reads or writes any clone on the machine.
 */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'fact-gate-'));
  const root = join(base, 'project');
  for (const entity of ALL_ENTITIES) {
    const p = ssotPath(root, entity);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(fixtureSsot(entity), null, 1));
  }
  assert.ok(existsSync(join(base, 'neofertility-ie/docs/fact-check/neofertility-canonical-facts.json')),
    'the fixture must synthesize its own sibling checkout, not borrow the machine\'s');
  for (const rel of SCRIPT_COPIES) {
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(REPO, rel), dest);
  }
  return root;
}

/**
 * A full copy of the real IN-REPO surface with no sibling checkout beside it —
 * the exact shape of a GitHub runner. Runs a byte-identical copy of the gate so
 * PROJECT_ROOT is the copy's own root and `../neofertility-ie` does not exist.
 */
function siblinglessCheckout() {
  const base = mkdtempSync(join(tmpdir(), 'fact-gate-nosibling-'));
  const root = join(base, 'repo');
  mkdirSync(join(root, 'scripts/gates'), { recursive: true });
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  cpSync(GATE, join(root, 'scripts/gates/validate-fact-pipeline.mjs'));
  cpSync(join(REPO, SCHEMA_REL), join(root, SCHEMA_REL));
  for (const entity of IN_REPO_ENTITIES) {
    const p = ssotPath(root, entity);
    mkdirSync(dirname(p), { recursive: true });
    cpSync(join(REPO, 'docs/fact-check', `${entity}-canonical-facts.json`), p);
  }
  for (const rel of SCRIPT_COPIES) {
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(REPO, rel), dest);
  }
  assert.ok(!existsSync(join(base, 'neofertility-ie')), 'the sibling-less fixture must have no sibling');
  return root;
}

/** Gate + schema copy, for the G1 tests the root override cannot reach. */
function schemaFixture() {
  const base = mkdtempSync(join(tmpdir(), 'fact-gate-schema-'));
  const root = join(base, 'project');
  mkdirSync(join(root, 'scripts/gates'), { recursive: true });
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  cpSync(GATE, join(root, 'scripts/gates/validate-fact-pipeline.mjs'));
  cpSync(join(REPO, SCHEMA_REL), join(root, SCHEMA_REL));
  assert.equal(
    readFileSync(join(root, 'scripts/gates/validate-fact-pipeline.mjs'), 'utf-8'),
    readFileSync(GATE, 'utf-8'),
    'the G1 fixture must run a byte-identical copy of the real gate',
  );
  return root;
}

const clean = (root) => rmSync(dirname(root), { recursive: true, force: true });
const readF = (root, rel) => readFileSync(join(root, rel), 'utf-8');
const writeF = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/** Replace `find` with `repl` in a fixture file, asserting the anchor existed. */
function patch(root, rel, find, repl) {
  const src = readF(root, rel);
  assert.ok(src.includes(find), `fixture anchor ${JSON.stringify(find)} missing from ${rel}`);
  writeF(root, rel, src.split(find).join(repl));
}

/** Same, by regex, for multi-line blocks. */
function patchRe(root, rel, re, repl) {
  const src = readF(root, rel);
  assert.match(src, re, `fixture anchor ${re} missing from ${rel}`);
  writeF(root, rel, src.replace(re, repl));
}

/** Mutate one entity's SSOT in place. */
function mutateSsot(root, entity, fn) {
  const p = ssotPath(root, entity);
  const doc = JSON.parse(readFileSync(p, 'utf-8'));
  fn(doc);
  writeFileSync(p, JSON.stringify(doc, null, 1));
}

function run(root, args = []) {
  try {
    const out = execFileSync(process.execPath, [GATE, '--json', ...args],
      { env: { ...process.env, FACT_PIPELINE_GATE_ROOT: root }, encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

/** Run the COPIED gate inside a schema fixture, with no root override. */
function runCopy(root, args = []) {
  const env = { ...process.env };
  delete env.FACT_PIPELINE_GATE_ROOT;
  const gate = join(root, 'scripts/gates/validate-fact-pipeline.mjs');
  try {
    return { code: 0, out: execFileSync(process.execPath, [gate, '--json', ...args], { env, encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function expectRed(root, gate, pattern, runner = run) {
  const { code, out } = runner(root, ['--gate', gate, '--quick']);
  assert.equal(code, 1, `${gate} must REFUSE this fixture; it exited 0:\n${out}`);
  // Both halves of the verdict, because the gate computes them separately: the
  // exit code from item-level fail() counting, and gates[].pass from the items.
  // Watching only the exit code let a mutation that pinned gates[].pass to true
  // survive the first teeth run (K29).
  assert.equal(JSON.parse(out).gates[0].pass, false,
    `${gate} exited 1 but still reports pass:true — the JSON verdict and the exit code disagree:\n${out}`);
  assert.match(out, pattern);
  return out;
}

function expectGreen(root, gate, runner = run) {
  const { code, out } = runner(root, ['--gate', gate, '--quick']);
  assert.equal(code, 0, `${gate} must accept this fixture; got:\n${out}`);
  return out;
}

/** Assert some FAILED check's message matches `re` (parsed, so quotes are raw). */
function failedCheck(out, re) {
  const c = checksOf(out).find((x) => x.ok === false && re.test(x.msg));
  assert.ok(c, `expected a failed check matching ${re}; got:\n${out}`);
  return c;
}

/** The checks array of the single gate in a --gate run's JSON output. */
function checksOf(out) {
  const report = JSON.parse(out);
  assert.equal(report.gates.length, 1, `expected one gate in the report; got:\n${out}`);
  return report.gates[0].checks;
}

/** Run the real gate over the real repo, with no root override. */
function runReal(args = []) {
  const env = { ...process.env };
  delete env.FACT_PIPELINE_GATE_ROOT;
  try {
    return { code: 0, out: execFileSync(process.execPath, [GATE, '--json', ...args], { env, encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const failuresOf = (gate) => gate.checks.filter((c) => c.ok === false).map((c) => c.msg);

// ---------- baseline -------------------------------------------------------

test('the real surface passes every gate that needs no out-of-repo checkout', () => {
  // G1, G3 and G4 read only this repo, so this assertion holds on a laptop and
  // on a GitHub runner alike. G2 is asserted by the two tests below, split by
  // whether the sibling checkout is present, because G2 alone reaches outside.
  const { out } = runReal(['--quick']);
  const report = JSON.parse(out);
  assert.deepEqual(report.gates.map((g) => g.id), ['G1', 'G2', 'G3', 'G4', 'G5']);
  for (const id of ['G1', 'G3', 'G4']) {
    const g = report.gates.find((x) => x.id === id);
    assert.deepEqual(failuresOf(g), [], `${id} must be green on the real surface`);
  }
});

test('G2 on the real surface: green with the sibling checkout, and nothing else red without it', () => {
  // The dependency, named rather than skipped. On the Blue iMac the sibling
  // clone is there and G2 must be fully green. On a runner it is absent, and the
  // ONLY tolerated failure is that one missing file — any second failure is a
  // real regression, not the environment. PR #184 went red here because the
  // fixtures borrowed the machine's clone; that is fixed, but the real-surface
  // run still legitimately depends on it, so the contract is stated explicitly.
  const { code, out } = runReal(['--gate', 'G2', '--quick']);
  const failures = failuresOf(JSON.parse(out).gates[0]);
  if (SIBLING_PRESENT) {
    assert.equal(code, 0, `sibling checkout present at ${SIBLING_SSOT}, so G2 must be green; got:\n${out}`);
    assert.deepEqual(failures, []);
  } else {
    assert.equal(code, 1, 'without the sibling checkout G2 cannot pass, and must not pretend to');
    assert.equal(failures.length, 1,
      `the missing sibling SSOT must be G2's only failure; got:\n${failures.join('\n')}`);
    assert.match(failures[0], /^neofertility: SSOT file not found: .*neofertility-ie/);
  }
});

test('G2 in a sibling-less checkout fails on exactly the missing neofertility SSOT', () => {
  // Proves the above branch on EVERY machine, including this one, by building a
  // runner-shaped checkout: the real four in-repo SSOTs, no sibling beside them.
  // Without this, the sibling-present machine would never execute the contract
  // it claims for CI.
  const root = siblinglessCheckout();
  const { code, out } = runCopy(root, ['--quick']);
  assert.equal(code, 1, `a sibling-less checkout must not pass; got:\n${out}`);
  const report = JSON.parse(out);
  for (const id of ['G1', 'G3', 'G4']) {
    assert.deepEqual(failuresOf(report.gates.find((x) => x.id === id)), [],
      `${id} must not be collateral damage of the missing sibling`);
  }
  const g2 = failuresOf(report.gates.find((x) => x.id === 'G2'));
  assert.equal(g2.length, 1, `G2 must fail on the sibling alone; got:\n${g2.join('\n')}`);
  assert.match(g2[0], /^neofertility: SSOT file not found: .*neofertility-ie/);
  clean(root);
});

test('FACT_PIPELINE_GATE_ROOT actually redirects the scan', () => {
  const root = join(mkdtempSync(join(tmpdir(), 'fact-gate-empty-')), 'project');
  mkdirSync(root, { recursive: true });
  expectRed(root, 'G2', /naprotechnology: SSOT file not found/);
  clean(root);
});

test('a reduced copy of the real surface passes G2, G3 and G4', () => {
  const root = fixture();
  const { code, out } = run(root, ['--quick']);
  assert.equal(code, 0, `the derived fixture must be green; got:\n${out}`);
  const report = JSON.parse(out);
  assert.ok(report.gates.filter((g) => ['G2', 'G3', 'G4'].includes(g.id)).every((g) => g.pass));
  clean(root);
});

// ---------- G1: schema self-consistency ------------------------------------
// Run against a byte-identical gate copy beside a mutable schema copy, because
// G1's `import { ENTITIES } from '../lib/canonical-facts-schema.mjs'` is static.

test('G1: the pristine schema passes and prints the coverage table', () => {
  const root = schemaFixture();
  const out = expectGreen(root, 'G1', runCopy);
  const msgs = checksOf(out).map((c) => c.msg).join('\n');
  assert.match(msgs, /creighton: \[creighton, fabm, billings\]/);
  assert.match(msgs, /All 9\/9 ALLOWED_TRADITIONS covered/);
  clean(root);
});

test("G1 THE REGRESSION: creighton matcher accepting 'fabm' but not 'creighton' fails", () => {
  const root = schemaFixture();
  // The exact CRITICAL: 724 facts fell out of the Creighton SSOT because the
  // matcher covered the umbrella tag and not the method's own name.
  patch(root, SCHEMA_REL, "t === 'creighton' || t === 'fabm'", "t === 'fabm'");
  const out = expectRed(root, 'G1',
    /Entity 'creighton' matcher must accept 'creighton' \(got \[fabm, billings\]\) — this is the Creighton CRITICAL class bug/, runCopy);
  assert.doesNotMatch(out, /Entity 'creighton' accepts required tradition/);
  clean(root);
});

test('G1: a case-typo tradition literal fails on both the unknown-value and the required-value check', () => {
  const root = schemaFixture();
  // Subtler than a deletion and the likelier real edit: the matcher still LOOKS
  // like it covers creighton. G1b must reject the literal as unknown and G1c
  // must still report the required tradition as unmatched.
  patch(root, SCHEMA_REL, "t === 'creighton' ||", "t === 'Creighton' ||");
  const out = expectRed(root, 'G1', /references unknown tradition 'Creighton'/, runCopy);
  assert.match(out, /Entity 'creighton' matcher must accept 'creighton'/);
  clean(root);
});

test('G1: a matcher referencing a tradition outside ALLOWED_TRADITIONS fails', () => {
  const root = schemaFixture();
  patch(root, SCHEMA_REL, "matches: (traditions) => traditions.some((t) => t === 'femm')",
    "matches: (traditions) => traditions.some((t) => t === 'femm' || t === 'sympto-thermal')");
  expectRed(root, 'G1', /Entity 'femm' matcher references unknown tradition 'sympto-thermal'/, runCopy);
  clean(root);
});

test("G1: the rrm matcher losing both 'rrm-shared' and 'independent' fails", () => {
  const root = schemaFixture();
  patch(root, SCHEMA_REL, "t === 'rrm-shared' || t === 'independent' || t === 'conventional'",
    "t === 'conventional'");
  expectRed(root, 'G1',
    /Entity 'rrm' matcher must accept 'rrm-shared' OR 'independent' \(got \[conventional\]\)/, runCopy);
  clean(root);
});

test('G1: a tradition no entity claims any more is reported as stranded', () => {
  const root = schemaFixture();
  patch(root, SCHEMA_REL, "|| t === 'billings'", '');
  expectRed(root, 'G1', /Stranded traditions \(in ALLOWED_TRADITIONS but no entity accepts them\): billings/, runCopy);
  clean(root);
});

// ---------- G2: SSOT integrity ---------------------------------------------

test('G2 THE REGRESSION: record_count diverging from facts.length fails', () => {
  const root = fixture();
  // The D1-vs-SSOT divergence class, in its cheapest observable form: the header
  // still claims the old total after facts were dropped.
  mutateSsot(root, 'creighton', (d) => { d._meta.record_count = d.facts.length + 5; });
  expectRed(root, 'G2', /creighton: _meta\.record_count=13 but facts\.length=8 \(delta -5\)/);
  clean(root);
});

test('G2: a near-miss fact ID fails, not just an obviously foreign one', () => {
  const root = fixture();
  // A typo'd index suffix: correct prefix, correct article rec-id, non-numeric
  // sequence. Every published-claim anchor is built from this ID.
  let bad;
  mutateSsot(root, 'femm', (d) => { bad = d.facts[0].id = `${d.facts[0].id.replace(/-\d+$/, '')}-x`; });
  const out = expectRed(root, 'G2', /femm: 1 facts with invalid ID format/);
  assert.match(out, new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  clean(root);
});

test('G2: an unknown tradition value on a fact fails', () => {
  const root = fixture();
  mutateSsot(root, 'femm', (d) => { d.facts[0].tradition = ['sympto-thermal']; });
  const out = expectRed(root, 'G2', /femm: \d+ tradition errors/);
  failedCheck(out, /femm: 1 tradition errors \(sample: \[0\] id="[^"]+" unknown tradition "sympto-thermal"\)/);
  clean(root);
});

test('G2: an empty tradition array fails (the array/length branch, not the value branch)', () => {
  const root = fixture();
  mutateSsot(root, 'femm', (d) => { d.facts[0].tradition = []; });
  const out = expectRed(root, 'G2', /femm: 1 tradition errors/);
  failedCheck(out, /femm: 1 tradition errors \(sample: \[0\] id="[^"]+" tradition=\[\]\)/);
  clean(root);
});

test('G2: a fact with verified < 1 fails', () => {
  const root = fixture();
  mutateSsot(root, 'naprotechnology', (d) => { d.facts[2].verified = 0; });
  expectRed(root, 'G2', /naprotechnology: 1 facts with verified < 1/);
  clean(root);
});

test('G2: a fact whose traditions do not route to its own entity fails', () => {
  const root = fixture();
  // 'napro' is a legal tradition, so only the entity-matcher cross-check can
  // catch this: a napro fact sitting in the FEMM SSOT. This is the routing half
  // of the Creighton CRITICAL, seen from the data side.
  mutateSsot(root, 'femm', (d) => { d.facts[0].tradition = ['napro']; });
  const out = expectRed(root, 'G2', /femm: 1 facts fail entity matcher routing .*traditions=\[napro\] does not match entity 'femm'/);
  assert.match(out, /femm: all facts have valid tradition values/,
    'the tradition-value check must still pass: this fixture isolates routing');
  clean(root);
});

test('G2: a missing SSOT file fails instead of being skipped', () => {
  const root = fixture();
  rmSync(ssotPath(root, 'femm'));
  expectRed(root, 'G2', /femm: SSOT file not found/);
  clean(root);
});

test('G2: an unparseable SSOT fails rather than reporting success over nothing', () => {
  const root = fixture();
  // The shape build-canonical-facts.mjs guards against on the write side: a
  // truncated SSOT whose _manual curator overrides are no longer readable.
  writeFileSync(ssotPath(root, 'rrm'), '{ "_meta": { "record_count": 4068 }, "facts": [');
  expectRed(root, 'G2', /rrm: JSON parse error/);
  clean(root);
});

test('G2 reaches the out-of-repo neofertility SSOT, not only the four in this repo', () => {
  const root = fixture();
  writeFileSync(ssotPath(root, 'neofertility'), 'not json');
  expectRed(root, 'G2', /neofertility: JSON parse error/);
  clean(root);
});

test('G2: an empty source_id is a WARN, not a failure, and stays that way', () => {
  const root = fixture();
  // Warn-only by design (legacy curator/registry facts predate source_id).
  // Asserted through --json for the warn state instead of being promoted to a
  // hard failure; if it is ever promoted, the exit-code assertion below flags it.
  mutateSsot(root, 'femm', (d) => { delete d.facts[0].source; delete d.facts[0].source_id; });
  const out = expectGreen(root, 'G2');
  const w = checksOf(out).find((c) => c.msg.includes('empty source_id'));
  assert.ok(w, `expected an empty-source_id warn; got:\n${out}`);
  assert.equal(w.ok, null, 'the empty-source_id signal must be a warn, not a pass or a fail');
  assert.match(w.msg, /femm: 1 facts with empty source_id/);
  clean(root);
});

test('G2: a legacy registry-style fact ID is still accepted', () => {
  const root = fixture();
  // Pattern D exists for the pre-`fact-` curator IDs. Narrowing it would orphan
  // them, so the clean case is pinned too.
  mutateSsot(root, 'rrm', (d) => { d.facts[1].id = 'eshre-eim-2019-cycles'; });
  expectGreen(root, 'G2');
  clean(root);
});

// ---------- G3: validator/prompt enum sync ---------------------------------

test('G3 THE REGRESSION: a category dropped from the validator but left in the prompt fails', () => {
  const root = fixture();
  // Prompt/validator drift: opus keeps emitting 'surgery' and every such fact is
  // rejected downstream.
  patch(root, ARTICLE_SCRIPT, "'outcome','protocol','surgery','pathology'", "'outcome','protocol','pathology'");
  expectRed(root, 'G3', /article category mismatch — in prompt only: \[surgery\]/);
  clean(root);
});

test('G3: a value the validator accepts but the prompt never emits fails too (both directions)', () => {
  const root = fixture();
  patch(root, ARTICLE_SCRIPT, "'statistic','protocol','cited-study','biomarker','definition'",
    "'statistic','protocol','cited-study','biomarker','definition','sympto-thermal'");
  expectRed(root, 'G3', /article claim_type mismatch — in code only: \[sympto-thermal\]/);
  clean(root);
});

test('G3: deleting the validator Set outright fails while the prompt still defines values', () => {
  const root = fixture();
  patchRe(root, ARTICLE_SCRIPT, /const ALLOWED_CATEGORIES = new Set\(\[[\s\S]*?\]\);/, '');
  // The gate's own message pluralises the key, so it reads ALLOWED_CATEGORYS.
  expectRed(root, 'G3', /extract-article-facts\.mjs: no ALLOWED_CATEGORYS Set found but prompt defines 10 values/);
  clean(root);
});

test('G3: a missing article prompt fails', () => {
  const root = fixture();
  rmSync(join(root, ARTICLE_PROMPT));
  expectRed(root, 'G3', /article system-prompt\.md not found/);
  clean(root);
});

test('G3: a missing chapter prompt fails', () => {
  const root = fixture();
  rmSync(join(root, CHAPTER_PROMPT));
  expectRed(root, 'G3', /chapter system-prompt\.md not found/);
  clean(root);
});

test('G3: a prompt that stops declaring an enum degrades to a WARN, by design', () => {
  const root = fixture();
  patch(root, ARTICLE_PROMPT,
    '"category": "<outcome|protocol|surgery|pathology|hormone|epidemiology|diagnostics|charting|cycle-biomarker|methodology>"',
    '"category": "outcome"');
  const out = expectGreen(root, 'G3');
  const w = checksOf(out).find((c) => c.msg.includes('no enum found for "category"'));
  assert.ok(w, `expected the skip warn; got:\n${out}`);
  assert.equal(w.ok, null);
  clean(root);
});

test('G3: the chapter validator having no enum Sets is a WARN, not a failure', () => {
  const root = fixture();
  // This is the live state of the real repo: extract-chapter-facts.mjs declares
  // no ALLOWED_* Sets, and the gate warns rather than failing. Pinned here so a
  // future run cannot quietly turn the warn into a pass.
  const out = expectGreen(root, 'G3');
  const warns = checksOf(out).filter((c) => c.ok === null && c.msg.includes('extract-chapter-facts.mjs'));
  assert.equal(warns.length, 2, `expected two chapter validator warns; got:\n${out}`);
  assert.match(warns[0].msg, /no ALLOWED_CATEGORYS Set \(chapter validator may not enforce this field yet — warn only\)/);
  clean(root);
});

test('G3: a chapter prompt with no enums at all warns and skips, without failing', () => {
  const root = fixture();
  patchRe(root, CHAPTER_PROMPT, /"category"\s*:\s*"<[^"]+>"/, '"category": "outcome"');
  patchRe(root, CHAPTER_PROMPT, /"claim_type"\s*:\s*"<[^"]+>"/, '"claim_type": "statistic"');
  const out = expectGreen(root, 'G3');
  assert.ok(checksOf(out).some((c) => c.ok === null &&
    /chapter system-prompt\.md: no category\/claim_type enums found/.test(c.msg)),
    `expected the chapter skip warn; got:\n${out}`);
  clean(root);
});

// ---------- G4: orchestrator exit codes ------------------------------------

test('G4 THE REGRESSION: exit(0) inside the failure block fails (the silent-success class)', () => {
  const root = fixture();
  // The bug the gate was written for: the block still runs, still logs, still
  // flushes the failure log, and still tells CI everything promoted.
  patchRe(root, PROMOTE_ARTICLE, /if \(failures\.length\) \{[\s\S]*?\n\}/,
    'if (failures.length) {\n  flushFailures();\n  process.exit(0);\n}');
  expectRed(root, 'G4',
    /promote-article-facts\.mjs: 'failures' array reported but no process\.exit\(<non-zero>\) inside 'if \(failures\.length\)' block/);
  clean(root);
});

test('G4: removing the exit from the failure block fails', () => {
  const root = fixture();
  patchRe(root, ARTICLE_SCRIPT, /if \(failed\.length\) \{[\s\S]*?\n\}/,
    "if (failed.length) {\n  console.log('\\nFailures:');\n}");
  expectRed(root, 'G4',
    /extract-article-facts\.mjs: 'failed' array reported but no process\.exit\(<non-zero>\) inside 'if \(failed\.length\)' block/);
  clean(root);
});

test('G4: an exit that sits AFTER the failure block, unconditionally, fails', () => {
  const root = fixture();
  // Proves the brace-balanced scan is doing real work: the file still contains
  // process.exit(1), just not where it is conditional on failures.
  patchRe(root, PROMOTE_CHAPTER, /if \(failures\.length\) \{[\s\S]*?\n\}/,
    'if (failures.length) {\n  flushFailures();\n}\nprocess.exit(1);');
  expectRed(root, 'G4',
    /promote-chapter-facts\.mjs: 'failures' array reported but no process\.exit\(<non-zero>\) inside/);
  clean(root);
});

test('G4: a missing orchestrator fails instead of dropping out of coverage', () => {
  const root = fixture();
  rmSync(join(root, PROMOTE_CHAPTER));
  expectRed(root, 'G4', /promote-chapter-facts\.mjs: file not found/);
  clean(root);
});

test('G4: a braceless single-statement failure exit is accepted', () => {
  const root = fixture();
  patchRe(root, PROMOTE_ARTICLE, /if \(failures\.length\) \{[\s\S]*?\n\}/,
    'if (failures.length) process.exit(1);');
  const out = expectGreen(root, 'G4');
  assert.ok(checksOf(out).some((c) => c.ok === true && c.msg.includes('promote-article-facts.mjs')),
    `the no-braces fallback must pass, not warn; got:\n${out}`);
  clean(root);
});

test('G4: an orchestrator with neither failure array is a WARN for manual review', () => {
  const root = fixture();
  // Warn-only by design: a different failure-tracking name is a coverage hole,
  // not a proven defect. Pinned through --json rather than promoted to a fail.
  patchRe(root, PROMOTE_CHAPTER, /\bfailures\b/g, 'problems');
  const out = expectGreen(root, 'G4');
  const w = checksOf(out).find((c) => c.msg.includes('promote-chapter-facts.mjs'));
  assert.equal(w.ok, null, `expected a warn for the renamed array; got:\n${out}`);
  assert.match(w.msg, /no 'failed'\/'failures' array found/);
  clean(root);
});

// ---------- G5: D1 <-> SSOT reconciliation ---------------------------------
// G5's live half needs remote D1 through wrangler, so it is out of scope for an
// offline harness. These two pin the parts that are reachable: the --quick skip
// contract, and the SSOT-read failure path (which fires before any query).

test('G5: --quick skips with a warn and never exits non-zero for the skip', () => {
  const root = fixture();
  const { code, out } = run(root, ['--gate', 'G5', '--quick']);
  assert.equal(code, 0, `the G5 skip must not fail the run; got:\n${out}`);
  const c = checksOf(out);
  assert.equal(c.length, 1);
  assert.equal(c[0].ok, null);
  assert.match(c[0].msg, /G5 skipped \(--quick mode, no network queries\)/);
  clean(root);
});

test('G5: unreadable SSOTs fail before any D1 query is attempted', () => {
  const root = fixture();
  for (const entity of ALL_ENTITIES) writeFileSync(ssotPath(root, entity), 'not json');
  const { code, out } = run(root, ['--gate', 'G5']);
  assert.equal(code, 1, `G5 must refuse unreadable SSOTs; got:\n${out}`);
  const c = checksOf(out);
  assert.equal(c.length, ALL_ENTITIES.length);
  assert.ok(c.every((x) => x.ok === false && /cannot read SSOT for G5 check/.test(x.msg)),
    `every entity must fail its SSOT read; got:\n${out}`);
  assert.doesNotMatch(out, /D1 query failed|wrangler/,
    'no wrangler invocation may be reached when every SSOT read fails');
  clean(root);
});
