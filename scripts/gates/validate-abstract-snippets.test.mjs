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

test('THE REGRESSION: a lowercase clause before a colon survives, words and all', () => {
  // This test, and the two below it, used to assert the OPPOSITE, as an honest
  // record of a live defect. From 2026-07-13 to 2026-09-18 abstractLabelRegExp
  // carried the `i` flag, so its generic arm -- written as
  // [A-Z][A-Z][A-Z \/&-]{1,28} to mean "an ALL-CAPS run" -- matched lowercase
  // too, and its third class contains a space. The arm therefore meant "any run
  // of 3 to 31 letters and spaces before a colon", which is a clause of
  // ordinary English, and it was deleted along with the colon.
  //
  // MEASURED on the live corpus, old stripper against this one: 809 of 3,720
  // abstracts changed, 29,275 characters RESTORED, 0 characters newly removed,
  // and 0 snippets left holding a vocabulary label. Pure restoration.
  const src = 'We assessed whether the risk differed: it did not.';
  assert.equal(abstractSnippet(src), src, 'a lowercase clause is not a section label');
  const { root, file } = fixture([{ slug: 'clause', abstract: src }]);
  try { assert.equal(run(file).code, 0); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RESIDUAL, measured and left alone: an ALL-CAPS acronym before a colon is still eaten', () => {
  // HONEST FAILURE, NOT A PASSING ASSERTION. This is a SECOND defect, older and
  // much smaller than the `i` flag, and the fix above does not touch it.
  //
  // The generic arm matches any all-caps run of 3 or more characters before a
  // colon, so a real acronym used that way goes too. The stripper's header has
  // always claimed the opposite -- "real acronyms (PCOS, AMH, IVF) survive" --
  // and that claim was false in the FIRST version of this code (commit
  // 70ec00a6, 2026-07-13 10:06), seventeen minutes before the `i` flag
  // existed. It is not collateral from the flag; it predates it.
  //
  // WHY IT IS LEFT: measured over the live corpus, the generic arm makes 537
  // matches, 131 of them mid-sentence, and 129 of those are fragments of
  // genuine multi-part labels ("DURATION" from "STUDY DESIGN, SIZE,
  // DURATION:", "AND PARTICIPANTS" from a split "PARTICIPANTS, SETTING,
  // METHODS:"). Exactly TWO are real acronyms, both "AMH". Narrowing the arm
  // to spare them would need a sentence-boundary rule, which risks the 129
  // legitimate fragments, so it is a calibration decision with a worse
  // downside than the residual. Brian's call, not a harness's.
  //
  // This asserts the current behaviour so it goes RED if the arm is ever
  // narrowed, which is the signal to re-measure the 129.
  // Note the exact shape of the loss: only the acronym and its colon go, not
  // the clause. The case-SENSITIVE arm matches just the all-caps token, which
  // is why this residual is small and local where the `i`-flag version was
  // broad. Both expectations below are measured output, not predictions.
  assert.equal(abstractSnippet('We assessed the risk of PCOS: a systematic review.'),
    'We assessed the risk of a systematic review.',
    'FIX LANDED: acronyms now survive -- re-measure the 129 label fragments and invert this');
  assert.equal(abstractSnippet('Patients with AMH: low values were excluded.'),
    'Patients with low values were excluded.');
});

test('ordinary clause shapes keep every word, including the statistical ones', () => {
  // The class of damage that mattered most on a research library: the old
  // stripper deleted the terms that give a number its meaning, leaving the
  // number behind. The last two are taken verbatim from what the live corpus
  // was rendering before the fix, where "odds ratio:" and "lowest tertile:"
  // were removed and the figures left stranded without them.
  const cases = [
    'preferences shifted substantially: 69% favored it.',
    'defined as: 1) twelve months of trying.',
    'duration of subfertility (24 months vs. 12 months; odds ratio: 0.193; 95% confidence interval: 0.043-0.859)',
    'As (highest vs. lowest tertile: aOR = 5.53, 95 % CI: 2.97, 10.30)',
  ];
  for (const src of cases) {
    assert.equal(abstractSnippet(src), src, `${JSON.stringify(src)} must survive untouched`);
  }
});

test('a genuine ALL-CAPS label is still stripped, so the fix did not disarm the arm', () => {
  // The other direction, and the reason the fix is a case change rather than a
  // deletion. The generic arm still exists and still works; it is simply
  // case-SENSITIVE again, as it was in commit 70ec00a6 before the `i` flag
  // arrived seventeen minutes later.
  assert.equal(abstractSnippet('WHAT WE DID: the prose.'), 'the prose.');
  assert.equal(abstractSnippet('Lead in. IMPORTANCE: the prose.'), 'Lead in. the prose.');
  assert.equal(abstractSnippet('SETTING AND DESIGN: a clinic cohort.'), 'a clinic cohort.');
  // And a Title-Case VOCABULARY label still goes, which is what the `i` flag
  // was originally added to achieve. Losing this would be a regression to the
  // pre-8175edbd behaviour.
  assert.equal(abstractSnippet('Background: the prose.'), 'the prose.');
  assert.equal(abstractSnippet('Study Question: the prose.'), 'the prose.');
  assert.equal(abstractSnippet('main outcome measures: the prose.'), 'the prose.');
});

test('a Title-Case phrase OUTSIDE the vocabulary is now kept, and that is the trade', () => {
  // Stated rather than hidden. The old behaviour ate unlisted labels as
  // collateral damage; the fix keeps them. MEASURED on the live corpus: 13
  // snippets now open with a label-shaped phrase where 0 did before, and most
  // are genuine content ("To the Editor", a surname, a sentence). Three look
  // like real section labels (Disclosure, Rationale, Description).
  //
  // The mechanism for those is the vocabulary, not the case-insensitive arm:
  // add the word to ABSTRACT_LABEL_WORDS. Deliberately NOT done in the same
  // change as the fix, so "0 characters newly removed" stays exactly true.
  assert.equal(abstractSnippet('Disclosure: the authors report none.'),
    'Disclosure: the authors report none.',
    'an unlisted label is kept; add it to the vocabulary if it should go');
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
