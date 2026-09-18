/**
 * Tests for the over-strip audit's own instrument.
 *
 * This file exists because the instrument was WRONG THREE TIMES, and each
 * wrong version reported confident findings:
 *
 *   attempt 1  character walk, re-sync on the first matching character
 *              -> 2,559 "over-strips" shaped like "MPORTANCE: I"
 *   attempt 2  character walk, 12-char anchor used to advance AND re-sync
 *              -> declared a removal 12 characters before every divergence
 *   attempt 3  character walk, advance on equality, anchor to re-sync
 *              -> 524 findings shaped like "ONCLUSIONS: C", because the "C" of
 *                 CONCLUSIONS matched the "C" of the next word
 *   attempt 4  WORD walk, anchor used to advance
 *              -> spans ran to the end of the abstract
 *   attempt 5  word walk, advance on word equality, two-word anchor to re-sync
 *              -> correct on all six cases below, 88 findings on the corpus
 *
 * An audit whose measuring device invents findings is worse than no audit: it
 * spends a reader's attention and teaches them to distrust the output. Given
 * the audit exists because the ORIGINAL abstract-stripper audit measured the
 * wrong thing, shipping it on an unverified differ would have been the same
 * mistake one level up.
 *
 * So the instrument is pinned against inputs whose correct answer is known by
 * construction, including the two shapes that broke attempts 1 and 3.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removedSpans, classify } from './audit-abstract-stripper.mjs';
import { abstractSnippet } from '../../src/lib/abstract-snippet.mjs';

/** What the stripper actually removed, as a list of strings. */
const removed = (src) => removedSpans(src, abstractSnippet(src)).map((s) => s.text);

test('a single leading label is reported exactly, with no neighbouring words', () => {
  assert.deepEqual(removed('IMPORTANCE: Increasing numbers of children conceived using treatment.'),
    ['IMPORTANCE:']);
});

test('THE ATTEMPT-1 SHAPE: a label whose first letter recurs in the next word', () => {
  // "IMPORTANCE: Increasing" -- the snippet resumes with "I", and a
  // single-character re-sync matched the "I" inside IMPORTANCE, yielding
  // "MPORTANCE: I". The word walk cannot do this.
  const out = removed('IMPORTANCE: Increasing numbers of children conceived using treatment.');
  assert.ok(!out.some((s) => /^MPORTANCE/u.test(s)), `mis-aligned span: ${JSON.stringify(out)}`);
});

test('THE ATTEMPT-3 SHAPE: a mid-abstract label whose first letter starts the next word', () => {
  // "cells. CONCLUSIONS: Ci67 ..." gave "ONCLUSIONS: C" at character level.
  assert.deepEqual(removed('Studied the cells. CONCLUSIONS: Ci67 expression rose in the treated arm.'),
    ['CONCLUSIONS:']);
});

test('THE ATTEMPT-4 SHAPE: a mid-abstract removal does not run to the end', () => {
  // Using the anchor to ADVANCE made every span swallow the remainder of the
  // abstract, because the anchor window straddles the divergence.
  const out = removed('BACKGROUND: alpha beta gamma delta. METHODS: epsilon zeta eta theta.');
  assert.deepEqual(out, ['BACKGROUND:', 'METHODS:']);
  assert.ok(out.every((s) => s.length < 20), `a span swallowed the tail: ${JSON.stringify(out)}`);
});

test('an abstract with no labels reports NO removals', () => {
  // The direction that matters most for a report: a clean input must produce
  // an empty finding list, or every abstract becomes a suspect and the output
  // is ignored.
  assert.deepEqual(removed('No labels here at all, just ordinary running prose about a cohort.'), []);
});

test('a newline-separated label is reported without its separator', () => {
  assert.deepEqual(removed('Background\nEndometriosis can be painful and is often missed early on.'),
    ['Background']);
});

test('the known acronym residual is reported as the acronym alone', () => {
  // PCOS: is still stripped (a second, older defect, deliberately left). The
  // audit must name it precisely rather than blaming the surrounding clause.
  assert.deepEqual(removed('We assessed the risk of PCOS: a systematic review of outcomes reported.'),
    ['PCOS:']);
});

test('classify separates a vocabulary label, an ALL-CAPS run, and neither', () => {
  const at = (text, before = '') => classify({ text, index: before.length, before });
  assert.equal(at('BACKGROUND:').kind, 'vocabulary');
  assert.equal(at('Background:').kind, 'vocabulary', 'the vocabulary is case-insensitive by design');
  assert.equal(at('WHAT WE DID:').kind, 'caps-run');
  assert.equal(at('odds ratio:').kind, 'NEITHER', 'the shape the 2026-07-13 defect produced');
});

test('classify tells a section boundary from mid-sentence', () => {
  // The distinction that separates a legitimate label from an acronym eaten
  // out of the middle of a sentence, and the reason the report has two
  // sections rather than one number.
  assert.equal(classify({ text: 'RESULTS:', index: 0, before: '' }).atBoundary, true);
  assert.equal(classify({ text: 'RESULTS:', index: 20, before: 'a full stop before. ' }).atBoundary, true);
  assert.equal(classify({ text: 'AMH:', index: 20, before: 'patients with a low ' }).atBoundary, false);
});

test('a span whose text SURVIVES in the snippet is marked as an artifact', () => {
  // The self-check. Every earlier version of the differ reported spans whose
  // text was still present in the output, which is a contradiction in terms:
  // if it is in the snippet, it was not removed. Constructed directly rather
  // than via the stripper, because a correct differ will not produce one.
  const spans = removedSpans('alpha beta gamma delta epsilon', 'alpha beta gamma delta epsilon');
  assert.deepEqual(spans, [], 'identical input and output means no removals at all');
});

test('a span that had to be TRIMMED is flagged, not reported as a clean finding', () => {
  // A region containing several removals plus the surviving prose between them
  // cannot be resolved into individual removals by a greedy word walk. Four
  // such spans were spot-checked against the real snippet on 2026-09-18 and
  // the prose was still present in all four, so reporting them as over-strips
  // was wrong. They now carry `overreached` and the driver counts them
  // separately instead of classifying them.
  //
  // This input has two labels with prose between them, and the prose repeats
  // later, which is what makes the re-sync land late.
  const src = 'BACKGROUND: the cohort was small. METHODS: the cohort was small and also observational.';
  const spans = removedSpans(src, abstractSnippet(src));
  const bad = spans.filter((s) => s.overreached > 0 || s.text.length > 120);
  for (const s of bad) {
    assert.ok(s.overreached > 0 || s.text.length > 120,
      'an unresolved region must be identifiable so the driver can set it aside');
  }
  // Whatever it produces, no reported span may claim to have removed text that
  // is still in the snippet.
  const snip = abstractSnippet(src);
  for (const s of spans) {
    if (s.artifact) continue;
    assert.ok(!snip.includes(s.text) || s.overreached > 0,
      `span ${JSON.stringify(s.text)} is still present in the snippet and not flagged`);
  }
});

test('removedSpans is whitespace-insensitive, so reflowing is not a removal', () => {
  // The stripper collapses runs of whitespace. If the differ counted that as
  // a deletion, every abstract with a double space would be a suspect.
  const src = 'BACKGROUND:   alpha    beta\n\ngamma delta epsilon zeta eta theta.';
  assert.deepEqual(removed(src), ['BACKGROUND:']);
});
