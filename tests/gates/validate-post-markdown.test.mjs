import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPosts } from '../../scripts/gates/validate-post-markdown.mjs';

test('clean Markdown post passes', () => {
  const posts = [{ slug: 'ok', content: 'PCOS is now **PMOS**. See [the study](/library/x/).\n\n## Why it matters\n\nText.' }];
  assert.equal(checkPosts(posts).length, 0);
});

test('block <p> HTML is caught (the 2026-07-10 burn)', () => {
  const posts = [{ slug: 'bad', content: '<p>PCOS is now PMOS.</p><p>More text.</p>' }];
  const out = checkPosts(posts);
  assert.equal(out.length, 1);
  assert.match(out[0].tag, /<\s*p/i);
});

test('block <div>/<h2>/<ul> HTML is caught', () => {
  assert.equal(checkPosts([{ slug: 'a', content: '<div>x</div>' }]).length, 1);
  assert.equal(checkPosts([{ slug: 'b', content: 'intro <h2>Head</h2>' }]).length, 1);
  assert.equal(checkPosts([{ slug: 'c', content: '<ul><li>x</li></ul>' }]).length, 1);
});

test('inline HTML (<br>, <sub>, <em>, <a>) is tolerated', () => {
  const posts = [{ slug: 'inline', content: 'H<sub>2</sub>O and a line<br>break with <em>emphasis</em> and <a href="/x">link</a>.' }];
  assert.equal(checkPosts(posts).length, 0);
});

test('posts without a string content are skipped', () => {
  assert.equal(checkPosts([{ slug: 'nulll', content: null }, { slug: 'undef' }]).length, 0);
});
