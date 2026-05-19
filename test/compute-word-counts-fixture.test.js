/**
 * Parity test for computeWordCount() exported from scripts/compute-word-counts.mjs.
 *
 * SHARED FIXTURES with rrm-library-worker/tests/word-count.test.js.
 * If you update one, update both. The two test files MUST use byte-identical
 * input/expected pairs so each repo's CI catches drift independently.
 *
 * The two helpers (worker src/word-count.js + academy scripts/compute-word-counts.mjs)
 * implement the same algorithm:
 *   - null/undefined -> 0
 *   - non-string -> 0 (defense-in-depth; would otherwise coerce surprisingly)
 *   - optional HTML strip: tags -> space, entities -> EMPTY string
 *   - collapse whitespace, trim, split(/\s+/).filter(Boolean).length
 *
 * Drift between these two is silent: backfill writes one shape, worker writes
 * another, thin-page noindex flickers. Test ensures both repos agree.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeWordCount } from '../scripts/compute-word-counts.mjs';

describe('computeWordCount() parity fixtures', () => {
  // --- Nullish / non-string (post-typeof guard, #14) ---
  it('null -> 0', () => {
    assert.equal(computeWordCount(null), 0);
  });
  it('undefined -> 0', () => {
    assert.equal(computeWordCount(undefined), 0);
  });
  it('empty string -> 0', () => {
    assert.equal(computeWordCount(''), 0);
  });
  it('whitespace-only -> 0', () => {
    assert.equal(computeWordCount('   '), 0);
  });
  it('number input -> 0 (typeof guard)', () => {
    assert.equal(computeWordCount(42), 0);
  });
  it('object input -> 0 (typeof guard)', () => {
    assert.equal(computeWordCount({ a: 1 }), 0);
  });
  it('array input -> 0 (typeof guard)', () => {
    assert.equal(computeWordCount(['a', 'b']), 0);
  });
  it('boolean input -> 0 (typeof guard)', () => {
    assert.equal(computeWordCount(true), 0);
  });

  // --- Basic tokenization ---
  it('single word', () => {
    assert.equal(computeWordCount('hello'), 1);
  });
  it('three words', () => {
    assert.equal(computeWordCount('a b c'), 3);
  });
  it('collapses internal whitespace', () => {
    assert.equal(computeWordCount('  a  b  '), 2);
  });
  it('counts across newlines and tabs', () => {
    assert.equal(computeWordCount('a\nb\tc'), 3);
  });

  // --- Hyphens, numbers ---
  it('hyphenated word counts as 1', () => {
    assert.equal(computeWordCount('well-known'), 1);
  });
  it('numbers count as tokens', () => {
    assert.equal(computeWordCount('abstract from 2024'), 3);
  });

  // --- HTML strip ON ---
  it('strips simple tag', () => {
    assert.equal(computeWordCount('<p>hello world</p>', { stripHtml: true }), 2);
  });
  it('malformed HTML degrades gracefully (one-word inflation, no crash)', () => {
    // `<a href='x>y'>text</a>` has an unclosed quote; the regex `<[^>]+>`
    // greedily matches up to the next `>` so the tag boundary is the first `>`.
    // Result: "y'>text" tokenizes alongside the remainder. We accept the
    // graceful degradation -- no parse error.
    const result = computeWordCount("<a href='x>y'>text</a>", { stripHtml: true });
    assert.equal(typeof result, 'number');
    assert.ok(result >= 1);
  });
  it('strips entities to empty (unifies P&amp;C -> P&C -> 1 word, not 2)', () => {
    // Squasher-A's entity-strip fix: `&amp;` -> `''` (not ` `) so the surrounding
    // text fuses how a browser would render it.
    assert.equal(computeWordCount('P&amp;C', { stripHtml: true }), 1);
  });
  it('strips multiple entities consistently', () => {
    // "Phil &amp; Naomi" -> entity becomes empty -> "Phil  Naomi" (double space
    // collapses) -> 2 words.
    assert.equal(computeWordCount('Phil &amp; Naomi', { stripHtml: true }), 2);
  });
  it('strips script tag content as if it were text (no parser, just tag-strip)', () => {
    // Tags strip; the literal `alert(1)` becomes the only token after
    // whitespace normalize.
    assert.equal(computeWordCount('<script>alert(1)</script>', { stripHtml: true }), 1);
  });

  // --- HTML strip OFF (default) ---
  it('without stripHtml, tags count as part of tokens', () => {
    // No HTML mode: '<p>hello' is one whitespace-separated token; 'world</p>'
    // is another. = 2 tokens.
    assert.equal(computeWordCount('<p>hello world</p>'), 2);
  });

  // --- Unicode ---
  it('smart quotes counted with their words', () => {
    assert.equal(computeWordCount('“hello world”'), 2);
  });
  it('emoji counts as its own token', () => {
    // U+1F44B WAVING HAND counts as a standalone graphemes-as-tokens token.
    assert.equal(computeWordCount('hello \u{1F44B} world'), 3);
  });
});
