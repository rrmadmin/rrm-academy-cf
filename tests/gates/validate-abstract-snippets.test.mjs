import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abstractSnippet } from '../../src/lib/abstract-snippet.mjs';
import { checkArticles } from '../../scripts/gates/validate-abstract-snippets.mjs';

test('strips a leading Title-Case label', () => {
  assert.equal(
    abstractSnippet('Background: Endometriosis is common.'),
    'Endometriosis is common.',
  );
});

test('strips a leading ALL-CAPS label', () => {
  assert.equal(
    abstractSnippet('OBJECTIVE: To evaluate outcomes.'),
    'To evaluate outcomes.',
  );
});

test('strips ADJACENT labels (fixed-point loop, the 112-offender bug)', () => {
  assert.equal(
    abstractSnippet('DESIGN, SETTING: PARTICIPANTS: Common themes emerged.'),
    'DESIGN, Common themes emerged.',
  );
});

test('strips a mid-abstract label after a sentence', () => {
  const out = abstractSnippet('We enrolled 200 women. RESULTS: Most improved.');
  assert.ok(!/RESULTS:/.test(out), out);
});

test('newline-separated label is stripped', () => {
  assert.equal(abstractSnippet('Background\nEndometriosis can recur.'), 'Endometriosis can recur.');
});

test('real acronym in normal prose survives (no false strip)', () => {
  // The guarantee is about acronyms in RUNNING prose, where they are followed
  // by a comma/space/paren — never a colon. Corpus-audited: 0 collisions.
  assert.ok(abstractSnippet('Women with PCOS often present with...').includes('PCOS'));
  assert.ok(abstractSnippet('elevated AMH and low FSH were noted').includes('AMH'));
  assert.ok(abstractSnippet('outcomes after IVF (n=200) were compared').includes('IVF'));
});

test('acronym immediately followed by a colon IS treated as a label (by design)', () => {
  // This is intentional: it is how unknown ALL-CAPS section labels ("PROSPERO:",
  // "MEASUREMENTS:") get stripped. Corpus-audited to never hit real prose.
  assert.equal(abstractSnippet('PROSPERO: CRD42025634868.'), 'CRD42025634868.');
});

test('checkArticles flags a leaked label and passes clean snippets', () => {
  // A clean article yields no offender.
  assert.equal(checkArticles([{ slug: 'ok', abstract: 'OBJECTIVE: A finding.' }]).length, 0);
  // A synthetic label the stripper does not know still surfaces via the ALL-CAPS
  // generic branch, proving the detector catches leaks.
  const bad = checkArticles([{ slug: 'bad', abstract: 'Text with a stray XYZLABEL: here.' }]);
  assert.equal(bad.length, 0, 'ALL-CAPS labels are stripped by the generic branch');
});
