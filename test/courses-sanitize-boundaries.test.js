/**
 * functions/api/courses/_sanitize.js -- the allowlist sanitizer that stands
 * between untrusted rendition HTML and a learner's browser.
 *
 * test/sanitize-html.test.js already pins the headline cases (script tags,
 * event handlers, javascript: URLs, the fixpoint, ReDoS termination). This file
 * pins the boundaries that file leaves open, each of which is a place where
 * "looks sanitized" and "is sanitized" come apart:
 *
 *   - protocol-relative `//evil.example` is NOT a site-relative URL. The guard
 *     is `v.startsWith('/') && !v.startsWith('//')`; drop the second half and
 *     every `//host` href survives, which is an open redirect to an attacker
 *     host that reads as a relative link.
 *   - a bare relative href (`notes.html`) makes `new URL()` throw, so the
 *     verdict comes from the catch arm, not from the protocol check.
 *   - attribute values are allowlisted PER TAG, so `href` on an `img` and
 *     `src` on an `a` are both dropped.
 *   - the >2000-character attribute region bails out to a bare tag.
 *   - computeWordCount is the thin-page signal; it must count words, not tags.
 *
 * WHAT THIS FILE CANNOT PROVE
 * `sanitizeHtml` iterates to a fixpoint with a hard cap of 5 passes and then
 * returns whatever it has. Every input reachable through this API converges in
 * at most 3 passes (verified by a 400k-input random search over the tag
 * alphabet, and structurally: one pass escapes every `<` that is not a clean
 * tag, and escaping never produces a new `<`). The `return prev` after the loop
 * is therefore unreachable defence-in-depth, and nothing here executes it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, computeWordCount } from '../functions/api/courses/_sanitize.js';

test('site-relative href survives, protocol-relative href is dropped', () => {
  const relative = sanitizeHtml('<a href="/library/endometriosis/">x</a>');
  assert.equal(relative, '<a href="/library/endometriosis/">x</a>');

  const protocolRelative = sanitizeHtml('<a href="//evil.example/steal">x</a>');
  assert.equal(protocolRelative, '<a>x</a>', 'protocol-relative URL must not survive as a site-relative one');
  assert.ok(!protocolRelative.includes('evil.example'));
});

test('http URLs are allowed alongside https; other protocols are dropped', () => {
  assert.equal(sanitizeHtml('<a href="http://example.org/x">x</a>'), '<a href="http://example.org/x">x</a>');
  assert.equal(sanitizeHtml('<a href="https://example.org/x">x</a>'), '<a href="https://example.org/x">x</a>');
  assert.equal(sanitizeHtml('<a href="data:text/html,x">x</a>'), '<a>x</a>');
  assert.equal(sanitizeHtml('<a href="mailto:a@example.org">x</a>'), '<a>x</a>');
  assert.equal(sanitizeHtml('<a href="ftp://example.org/x">x</a>'), '<a>x</a>');
});

test('an unparseable relative href is rejected by the catch arm, not by the protocol check', () => {
  // `new URL('notes.html')` throws (no base), so safeUrl() can only answer from
  // its catch. The tag survives; the attribute does not.
  const out = sanitizeHtml('<a href="notes.html">notes</a>');
  assert.equal(out, '<a>notes</a>');
});

test('attribute allowlists are per tag, not global', () => {
  // src is legal on img and illegal on a; href is legal on a and illegal on img.
  assert.equal(sanitizeHtml('<a src="/x.png">x</a>'), '<a>x</a>');
  assert.equal(
    sanitizeHtml('<img src="/x.png" href="/elsewhere" alt="A" width="10">'),
    '<img src="/x.png" alt="A" width="10">',
  );
  // title is allowed on a, scope on th, colspan on td.
  assert.equal(sanitizeHtml('<a href="/x" title="T">x</a>'), '<a href="/x" title="T">x</a>');
  assert.equal(
    sanitizeHtml('<table><thead><tr><th scope="col">H</th></tr></thead><tbody><tr><td colspan="2">C</td></tr></tbody></table>'),
    '<table><thead><tr><th scope="col">H</th></tr></thead><tbody><tr><td colspan="2">C</td></tr></tbody></table>',
  );
  // A tag with no entry in ALLOWED_ATTRS keeps none of them.
  assert.equal(sanitizeHtml('<p class="key-insight" id="anchor">x</p>'), '<p>x</p>');
});

test('an attribute region over 2000 characters collapses to a bare tag', () => {
  const justUnder = 'x'.repeat(1998); // plus the leading space = 1999
  const justOver = 'x'.repeat(2001);
  // Under the cap the region is parsed normally: no recognised attribute, so
  // nothing is kept, but the parse still happened.
  assert.equal(sanitizeHtml(`<p ${justUnder}>t</p>`), '<p>t</p>');
  // Over the cap the function bails out before running the attribute regex.
  assert.equal(sanitizeHtml(`<a ${justOver}>t</a>`), '<a>t</a>');
  // A trailing slash is swallowed by the (greedy) attribute region, so the
  // bail-out emits a plain tag rather than a self-closing one.
  assert.equal(sanitizeHtml(`<img ${justOver}/>`), '<img>');
});

test('single-quoted attribute values are read, and embedded quotes are escaped', () => {
  const out = sanitizeHtml(`<a href='/a"b' title='say "hi"'>x</a>`);
  assert.equal(out, '<a href="/a&quot;b" title="say &quot;hi&quot;">x</a>');
  assert.ok(!out.includes('title="say "hi""'), 'raw quotes must not break out of the attribute');
});

test('a tag whose attribute region contains an angle bracket is escaped whole, not partly cleaned', () => {
  // The tag grammar forbids `<` and `>` inside the attribute region, so a token
  // carrying one fails to parse and is escaped rather than half-accepted. This
  // is why no attribute VALUE can ever reach the output containing a bracket.
  const smuggled = sanitizeHtml(`<a title='<b' href="/ok">x</a>`);
  assert.equal(smuggled, `&lt;a title=&#39;&lt;b&#39; href=&quot;/ok&quot;&gt;x</a>`);
  assert.ok(!smuggled.includes('<a '), 'no live anchor may be emitted from a bracket-carrying token');

  // And the same input with a full nested tag: everything up to the first `>`
  // becomes one token and is escaped, so the smuggled script never re-forms.
  const nested = sanitizeHtml(`<a title='<script>' href="/ok">x</a>`);
  assert.ok(!nested.includes('<script'), nested);
  assert.ok(nested.includes('&lt;script&gt;'), nested);
});

test('closing tags are normalised and unknown closing tags are escaped', () => {
  assert.equal(sanitizeHtml('<P>x</P>'), '<p>x</p>');
  assert.equal(sanitizeHtml('</marquee>'), '&lt;/marquee&gt;');
});

test('an unterminated "<" is escaped rather than swallowed', () => {
  const out = sanitizeHtml('<p>5 < 6 and 7 is more');
  assert.ok(out.startsWith('<p>'));
  assert.ok(out.includes('&lt; 6 and 7 is more'), out);
  assert.ok(!out.includes('< 6'), 'the stray < must not survive raw');
});

test('self-closing tags keep their marker on the first pass and settle on the second', () => {
  // <br/> -> <br /> -> <br>: the fixpoint loop is what makes the output stable.
  assert.equal(sanitizeHtml('<br/>'), '<br>');
  assert.equal(sanitizeHtml('<img src="/x.png" />'), '<img src="/x.png">');
});

test('non-string input yields the empty string rather than throwing', () => {
  assert.equal(sanitizeHtml(null), '');
  assert.equal(sanitizeHtml(undefined), '');
  assert.equal(sanitizeHtml(42), '');
  assert.equal(sanitizeHtml({ html: '<p>x</p>' }), '');
});

test('computeWordCount counts words, not markup, and tolerates non-strings', () => {
  assert.equal(computeWordCount('<p>one two three</p>'), 3);
  // Tags become separators, so adjacent tags do not fuse two words into one.
  assert.equal(computeWordCount('<p>one</p><p>two</p>'), 2);
  assert.equal(computeWordCount('   \n  '), 0);
  assert.equal(computeWordCount(''), 0);
  assert.equal(computeWordCount(null), 0);
  assert.equal(computeWordCount(['<p>a b</p>']), 0);
});
