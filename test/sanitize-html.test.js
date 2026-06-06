import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml } from '../functions/api/courses/_sanitize.js';

test('passes through allowed tags and attributes', () => {
  const input = '<h2>Title</h2><p>Body with <strong>bold</strong> and <a href="https://rrmacademy.org/glossary/">a link</a>.</p>';
  assert.equal(sanitizeHtml(input), input);
});

test('keeps callout and term-card divs with class attribute', () => {
  const input = '<aside class="key-insight"><p>Insight</p></aside><div class="term-card"><p>Term</p></div>';
  assert.equal(sanitizeHtml(input), input);
});

test('strips class values not in the component allowlist', () => {
  const out = sanitizeHtml('<div class="evil-hook term-card"><p>x</p></div><span class="tracking-pixel">y</span>');
  assert.ok(out.includes('class="term-card"'));
  assert.ok(!out.includes('evil-hook'));
  assert.ok(out.includes('<span>y</span>'));
});

test('escapes script tags entirely', () => {
  const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
  assert.ok(!out.includes('<script'));
  assert.ok(out.includes('<p>hi</p>'));
});

test('strips event handler attributes', () => {
  const out = sanitizeHtml('<img src="https://rrmacademy.org/x.png" onerror="alert(1)">');
  assert.ok(!out.includes('onerror'));
  assert.ok(out.includes('<img'));
});

test('strips javascript: URLs', () => {
  const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
  assert.ok(!out.toLowerCase().includes('javascript:'));
});

test('survives nested-tag smuggling (fixpoint)', () => {
  const out = sanitizeHtml('<scr<script>ipt>alert(1)</scr</script>ipt>');
  assert.ok(!out.includes('<script'));
  assert.ok(!/<scr<script>/i.test(out));
});

test('escapes unknown tags instead of dropping content', () => {
  const out = sanitizeHtml('<marquee>text</marquee>');
  assert.ok(out.includes('text'));
  assert.ok(!out.includes('<marquee>'));
});

test('strips style and iframe', () => {
  const out = sanitizeHtml('<style>p{}</style><iframe src="https://x.com"></iframe>');
  assert.ok(!out.includes('<style'));
  assert.ok(!out.includes('<iframe'));
});
