/**
 * Falsification harness for validate-abstract-snippets.mjs.
 *
 * The gate guards src/lib/abstract-snippet.mjs, the shared stripper that removes
 * structured-abstract section labels ("OBJECTIVE:", "Background:") before a
 * snippet is rendered on an ArticleCard. It was born after that stripper
 * regressed twice in one session, and until 2026-09-18 it had no test.
 *
 * ================= READ THIS BEFORE TRUSTING A GREEN RUN =================
 *
 * The gate's detector IS the stripper's own regex. It asks "does
 * abstractSnippet(x) still match abstractLabelRegExp()", where abstractSnippet
 * is defined as looping `replace(abstractLabelRegExp(), '$1')` to a FIXED
 * POINT. So the gate asks whether a fixed point is a fixed point, and the
 * answer is structurally yes.
 *
 * That is not a guess. Writing this harness, the first five tests planted a
 * label directly in an article's abstract and asserted the gate went red. All
 * five were wrong and the gate was right: a label the stripper cannot see is a
 * label the detector cannot see either, because they read the same pattern.
 * A brute-force sweep of 2,304 label-pair shapes (every pairing of four labels
 * across twelve separators, including "", nbsp and U+2028) produced ZERO
 * leaking outputs.
 *
 * So:
 *   WHAT IT CATCHES  a stripper that stops short. Reduce the do/while to one
 *                    pass and adjacent labels leave their second label
 *                    stranded -- the exact 112-offender bug the loop was added
 *                    for. That is a real regression and the test below is red
 *                    for it. It is essentially the gate's whole value.
 *   WHAT IT CANNOT   anything where detector and stripper agree. A journal
 *                    inventing "PRECIS:" is invisible to both. A label outside
 *                    the (^|\s) boundary is invisible to both. Data drift of
 *                    any kind is invisible. No fixture can fix this, so none
 *                    here pretends to.
 *
 * Because the gate cannot speak for the stripper, most tests below assert the
 * stripper's OUTPUT directly. That is the part a reader actually cares about:
 * whether the rendered snippet is clean. Recorded as a finding for Brian rather
 * than fixed here, since making the detector independent of the stripper is a
 * gate redesign, not a test.
 *
 * ONE MORE MEASURED FACT, from mutation-proving this file. Replacing the gate's
 * `process.exit(1)` with `process.exit(0)` turns NO test here red. Its
 * failure branch is unreachable from any input, so the harness cannot cover it
 * the way the payment and analytics harnesses cover theirs. The single tooth on
 * the gate's own exit code is the regression test below, and it only bites when
 * the STRIPPER regresses. Everything else here is a test of abstract-snippet.mjs
 * that happens to live next to the gate. That is worth knowing before anyone
 * reads a green run as "the gate is sound".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { abstractSnippet, abstractLabelRegExp } from '../../src/lib/abstract-snippet.mjs';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'validate-abstract-snippets.mjs');

function fixture(articles) {
  const root = mkdtempSync(join(tmpdir(), 'abstract-gate-'));
  const file = join(root, 'articles.json');
  writeFileSync(file, JSON.stringify(articles, null, 2));
  return { root, file };
}

function run(file) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [GATE, '--data', file], { encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const leaks = (s) => abstractLabelRegExp().test(s);
/** What ONE pass of the stripper would produce. The gate's only real tooth. */
const onePass = (s) => String(s).replace(abstractLabelRegExp(), '$1').replace(/\s{2,}/gu, ' ').trim();

// Measured, not guessed: under one pass each of these leaves its SECOND label
// behind, because the first match consumed the whitespace boundary the second
// needed. Note the stripper's own header cites "SETTING, Participants:" as such
// a case and it is NOT one -- the comma stops "SETTING," being a label position
// at all, so it survives one pass and the loop identically.
const ADJACENT = ['OBJECTIVE:METHODS: tight adjacency', 'Results: Conclusions: stacked'];

test('THE REGRESSION, and the only one this gate can detect: a single-pass stripper leaks', () => {
  // Replace the do/while in abstractSnippet with one .replace() and this test
  // goes red twice over: the premise assertion stops holding the way it should,
  // and the gate exits 1 on an input the real stripper handles. Every other
  // test in this file stays green under that mutation, which is exactly why
  // this one is labelled as the gate's whole value.
  for (const abstract of ADJACENT) {
    assert.ok(leaks(onePass(abstract)),
      `fixture ${JSON.stringify(abstract)} does not distinguish one pass from the loop, so it proves nothing`);
    assert.ok(!leaks(abstractSnippet(abstract)),
      'the fixed-point stripper must clear the second label too');
    const { root, file } = fixture([{ slug: 'adjacent', abstract }]);
    try {
      assert.equal(run(file).code, 0, 'with the real stripper this input is clean');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('THE BLIND SPOT, pinned so nobody re-derives it: no planted label can fail this gate', () => {
  // This asserts the LIMITATION, deliberately. If it ever goes red, the gate
  // has gained an independent detector and become far stronger -- at which
  // point delete this test and write the planted-label tests it currently
  // makes impossible. Until then, a green run here means "the stripper is a
  // fixed point", never "the corpus has no visible labels".
  const planted = [
    'Prose. ​OBJECTIVE: zero-width space is not \\s, so neither sees it',
    'Prose.OBJECTIVE: no boundary at all',
    'PRECIS: a label word the vocabulary does not contain',
    'Prose. ​Background: title case, same blind spot',
  ];
  for (const abstract of planted) {
    const { root, file } = fixture([{ slug: 'planted', abstract }]);
    try {
      assert.equal(run(file).code, 0,
        `the gate is not expected to catch ${JSON.stringify(abstract)}; if it now does, this limitation is gone`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('the blind spot is broad, measured not assumed: 2304 label-pair shapes, 0 leaks', () => {
  // The sweep that disproved this harness's own first draft, kept as a test so
  // the claim in the header stays true rather than becoming folklore. Runs in
  // about 40ms.
  const seps = ['', ' ', '  ', '\n', '\t', ' ', ' ', '.', ',', ';', ')', '-'];
  const labels = ['OBJECTIVE', 'Background', 'METHODS', 'Results'];
  let tried = 0, leaked = 0;
  for (const a of seps) for (const b of seps) for (const l1 of labels) for (const l2 of labels) {
    tried += 1;
    if (leaks(abstractSnippet(`pre${a}${l1}:${b}${l2}: tail`))) leaked += 1;
  }
  assert.equal(tried, 2304);
  assert.equal(leaked, 0, 'a leaking shape exists after all: use it to replace the blind-spot test above');
});

// ---- the stripper's own behaviour, which is what a reader actually needs ----

test('an ordinary structured abstract is stripped to exactly its prose', () => {
  // Asserted on the OUTPUT, not the exit code, because a stripper that deleted
  // the whole abstract would also satisfy the gate.
  const src = 'BACKGROUND: Untreated disease progresses. METHODS: A cohort study. '
    + 'RESULTS: Outcomes improved. CONCLUSIONS: Treatment helps.';
  assert.equal(abstractSnippet(src),
    'Untreated disease progresses. A cohort study. Outcomes improved. Treatment helps.');
  const { root, file } = fixture([{ slug: 'structured', abstract: src }]);
  try { assert.equal(run(file).code, 0); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BOTH label families are stripped: ALL-CAPS and Title-Case', () => {
  // The two regressions that created this gate were one per family: an
  // all-caps-only rule left "Background:" intact. Testing one family would
  // miss half the history. Asserted on output, per the note above.
  for (const label of ['OBJECTIVE', 'Background', 'Methods', 'RESULTS', 'Conclusions', 'STUDY DESIGN', 'Summary answer']) {
    assert.equal(abstractSnippet(`${label}: the prose.`), 'the prose.',
      `"${label}:" must be stripped from the head of a snippet`);
    assert.equal(abstractSnippet(`Lead in. ${label}: the prose.`), 'Lead in. the prose.',
      `"${label}:" must be stripped mid-snippet too, not only leading`);
  }
});

test('a generic ALL-CAPS run is stripped even though it is not in the vocabulary', () => {
  // The second half of the pattern. It is what lets an unlisted section label
  // still go, and it is the reason the acronym test below matters.
  assert.equal(abstractSnippet('WHAT WE DID: the prose.'), 'the prose.');
});

test('LIVE DEFECT, pinned not fixed: the stripper EATS PROSE before a colon', () => {
  // HONEST FAILURE, NOT A PASSING ASSERTION.
  //
  // The stripper's header says: "an acronym in running prose ('…risk of PCOS:
  // a review') is NOT a label position and real acronyms (PCOS, AMH, IVF)
  // survive. Corpus-audited over 3,720 abstracts: … 0 false positives."
  //
  // That exact sentence is false, and its own example is the counterexample.
  // The cause is the `i` flag on abstractLabelRegExp(). The generic arm
  // [A-Z][A-Z][A-Z \/&-]{1,28} is written to mean "an ALL-CAPS run", but under
  // `i` those classes match lowercase too, and the third one includes a space
  // -- so the arm actually means "any 3-to-30 character run of letters, spaces,
  // slashes, ampersands and hyphens followed by a colon". That is a clause of
  // ordinary English, and it is deleted along with the colon.
  //
  // MEASURED on the live corpus (src/data/articles.json, 3,720 abstracts) by
  // comparing the shipped stripper against the semantics the header describes
  // (vocabulary arm case-insensitive, generic arm case-SENSITIVE):
  //
  //     860 abstracts changed (23.1%), 29,935 characters deleted,
  //     median 28 characters, max 776.
  //
  // Real examples from that run, as rendered on library cards today:
  //   "Evaluation and treatment of recurrent pregnancy loss: a committee
  //    opinion"           -> "Evaluation and treatment a committee opinion"
  //   "fifteen scenarios including sensitivity analyses: two different…"
  //                       -> "fifteen scenarios two different…"
  //   "preferences shifted substantially: 69% favored…"
  //                       -> "preferences 69% favored…"
  //
  // NOT FIXED HERE, deliberately. abstract-snippet.mjs is shared with the
  // rendering component, a merge to main deploys this repo, and the fix
  // changes visible text on 860 library cards. That is Brian's call, not a
  // harness's. The fix itself is small: split the alternation so the
  // vocabulary keeps `i` and the ALL-CAPS arm does not.
  //
  // This test asserts the CURRENT broken behaviour so it goes RED the moment
  // the fix lands, which is the signal to replace it with the real assertion
  // kept below it.
  const src = 'We assessed the risk of PCOS: a systematic review of AMH and IVF outcomes.';
  assert.equal(abstractSnippet(src), 'a systematic review of AMH and IVF outcomes.',
    'FIX LANDED: the stripper no longer eats the clause -- replace this test with the assertion below');

  // The assertion this should become:
  //   assert.equal(abstractSnippet(src), src, 'a colon in prose is not a section label');

  // The gate stays GREEN throughout, which is the second half of the finding:
  // because detector and stripper share the regex, the gate cannot see that
  // 23% of the corpus is being over-stripped. It is not a gate that failed to
  // fire; it is a gate that structurally cannot.
  const { root, file } = fixture([{ slug: 'acronym', abstract: src }]);
  try {
    assert.equal(run(file).code, 0, 'the gate is blind to over-stripping by construction');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the over-strip is not one unlucky sentence: ANY colon in prose loses the words before it', () => {
  // Pins the SHAPE of the defect rather than one string, so the measurement
  // above can be re-derived without the corpus. Every expected value below is
  // the MEASURED output of the shipped stripper, not a prediction: two of the
  // four were written from reasoning first and both were wrong, which is why
  // the table is annotated with what actually happens.
  //
  // What the pattern really removes is the LAST run of up to 30 letters and
  // spaces ending at the colon, plus the colon -- not the whole clause. So
  // "preferences shifted substantially:" keeps "preferences" and loses
  // " shifted substantially:".
  const cases = [
    ['Patients with AMH: low values were excluded.', 'low values were excluded.'],
    ['We used IVF: the standard protocol.', 'the standard protocol.'],
    ['preferences shifted substantially: 69% favored it.', 'preferences 69% favored it.'],
    ['defined as: 1) twelve months of trying.', '1) twelve months of trying.'],
  ];
  for (const [src, shippedNow] of cases) {
    assert.equal(abstractSnippet(src), shippedNow,
      `FIX LANDED for ${JSON.stringify(src)} -- update this table`);
  }
});

test('there is NO safety from clause length, which is why a corpus audit missed it', () => {
  // This test was first written asserting the opposite -- that a colon more
  // than 30 characters into a clause is untouched, so only short clauses lose
  // text. That was wrong, and the real behaviour is worse: the {1,28} bound
  // applies to the run ENDING at the colon, and every colon has some short run
  // before it. A long sentence loses its last few words instead of its first
  // few, so spot-checking long prose shows text that still reads fine while
  // words have quietly gone.
  //
  // That is the whole reason a 3,720-abstract audit recorded "0 false
  // positives": the damage is mid-sentence and grammatical, never a visible
  // truncation.
  const src = 'We assessed whether the risk of adverse neonatal outcome differed: it did not.';
  assert.equal(abstractSnippet(src), 'We assessed whether the risk of adverse it did not.',
    'FIX LANDED: a long clause keeps its words -- replace this with assert.equal(out, src)');

  // The only shape that escapes, found by sweeping word lengths rather than by
  // reading the bound (the first two guesses here were both wrong): the run is
  // [A-Z][A-Z][A-Z \/&-]{1,28}, so at most 31 characters. A single word of 31
  // or more before the colon is untouched; 30 or fewer is stripped. Measured
  // boundary, exact.
  const safe = `The endpoint was ${'A'.repeat(31)}: it was rare.`;
  assert.equal(abstractSnippet(safe), safe, 'a 31-character run exceeds the bound and survives');
  const eaten = `The endpoint was ${'A'.repeat(30)}: it was rare.`;
  assert.equal(abstractSnippet(eaten), 'The endpoint was it was rare.',
    'a 30-character run still fits the bound and is stripped');
});

test('the newline separator is honoured, so newline-labelled journals are covered', () => {
  assert.equal(abstractSnippet('Background\nEndometriosis can be painful.'),
    'Endometriosis can be painful.');
  assert.equal(abstractSnippet('Methods\r\nA cohort study.'), 'A cohort study.');
});

test('a bare-space residue is deliberately left, and is deliberately not a failure', () => {
  // "Background Endometriosis", no colon. Left on purpose: stripping a bare
  // space risks eating prose, and it affects ~0.7% of abstracts. Pinned
  // because it is a calibration decision someone could mistake for a bug and
  // "fix" into a prose-eater.
  const src = 'Background Endometriosis can be painful.';
  assert.equal(abstractSnippet(src), src);
  const { root, file } = fixture([{ slug: 'bare-space', abstract: src }]);
  try { assert.equal(run(file).code, 0); } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- the gate's plumbing, which CAN be falsified ----

test('articles with no abstract are skipped rather than crashing', () => {
  const { root, file } = fixture([
    { slug: 'no-abstract' }, { slug: 'null-abstract', abstract: null },
    { slug: 'empty-abstract', abstract: '' }, { slug: 'fine', abstract: 'Ordinary prose.' },
  ]);
  try {
    const r = run(file);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /in 4 article snippets/u, 'the count covers every row, including the skipped ones');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing data file exits 2, distinct from a leaked label', () => {
  // 2 means "I could not look", 1 means "I looked and it is wrong". Collapsing
  // them lets a typo in a path read as a clean corpus.
  const r = run(join(tmpdir(), 'definitely-absent-articles.json'));
  assert.equal(r.code, 2);
  assert.match(r.out, /Data file not found/u);
});

test('the {articles:[...]} wrapper is read, and the scanned count proves it', () => {
  // The CLI accepts three shapes. An unwrapping bug would scan zero articles
  // and print OK, so the count is the assertion, not the exit code.
  const root = mkdtempSync(join(tmpdir(), 'abstract-gate-'));
  const file = join(root, 'articles.json');
  try {
    writeFileSync(file, JSON.stringify({
      articles: [{ slug: 'a', abstract: 'One.' }, { slug: 'b', abstract: 'Two.' }, { slug: 'c', abstract: 'Three.' }],
    }));
    const r = run(file);
    assert.equal(r.code, 0);
    assert.match(r.out, /in 3 article snippets/u, 'a wrapped file must scan 3, not 0 or 1');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an EMPTY corpus says so in the count instead of implying it was checked', () => {
  const { root, file } = fixture([]);
  try {
    const r = run(file);
    assert.equal(r.code, 0);
    assert.match(r.out, /in 0 article snippets/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
