// tests/gates/compare-pillar-migration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { compare } from '../../scripts/gates/compare-pillar-migration.mjs';

const wrap = (head, body) => `<html><head><title>T</title>${head}</head><body data-x>${body}</body></html>`;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const BYLINE = '<div class="author-byline"><div class="author-avatar-stack"></div><div class="author-byline__text"><span>By X</span></div></div>';

test('identical pages are additive', () => {
  const pre = wrap('', ld({ '@type': 'Article', headline: 'H' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  assert.deepStrictEqual(compare(pre, pre), []);
});

test('@graph decomposed into separate blocks is additive (node-level)', () => {
  const pre = wrap('', ld({ '@graph': [{ '@type': 'Article', headline: 'H' }, { '@type': 'FAQPage' }, { '@type': 'BreadcrumbList' }] }) + BYLINE);
  const post = wrap('', ld({ '@type': 'Article', headline: 'H' }) + ld({ '@type': 'FAQPage' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  assert.deepStrictEqual(compare(pre, post), []);
});

test('a dropped Article property is flagged', () => {
  const pre = wrap('', ld({ '@type': 'Article', headline: 'H', image: 'x.png' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  const post = wrap('', ld({ '@type': 'Article', headline: 'H' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  assert.ok(compare(pre, post).some((i) => i.includes('changed')));
});

test('a re-typed citation node (CreativeWork -> ScholarlyArticle) is flagged as removed', () => {
  const pre = wrap('', ld({ '@type': 'Article', headline: 'H', citation: [{ '@type': 'CreativeWork', name: 'V' }] }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  const post = wrap('', ld({ '@type': 'Article', headline: 'H', citation: [{ '@type': 'ScholarlyArticle', name: 'V' }] }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  assert.ok(compare(pre, post).some((i) => i.includes('changed')));
});

test('duplicate BreadcrumbList is flagged', () => {
  const pre = wrap('', ld({ '@type': 'Article', headline: 'H' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  const post = wrap('', ld({ '@type': 'Article', headline: 'H' }) + ld({ '@type': 'BreadcrumbList' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  assert.ok(compare(pre, post).some((i) => i.includes('exactly 1 BreadcrumbList')));
});

test('a changed <meta> is flagged', () => {
  const pre = wrap('<meta name="description" content="A">', ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  const post = wrap('<meta name="description" content="B">', ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  assert.ok(compare(pre, post).some((i) => i.includes('meta')));
});

test('a changed byline is flagged', () => {
  const pre = wrap('', ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  const post = wrap('', ld({ '@type': 'BreadcrumbList' }) + BYLINE.replace('By X', 'By Y'));
  assert.ok(compare(pre, post).some((i) => i.includes('byline')));
});

test('byline compare ignores data-astro-cid scope hashes (page->layout move)', () => {
  const BYLINE_PRE = '<div class="author-byline" data-astro-cid-pagehash><div class="author-avatar-stack" data-astro-cid-pagehash><img src="/a.webp" data-astro-cid-pagehash></div><div class="author-byline__text" data-astro-cid-pagehash><span>By X</span></div></div>';
  const BYLINE_POST = BYLINE_PRE.replace(/data-astro-cid-pagehash/g, 'data-astro-cid-layouthash');
  const pre = wrap('', ld({ '@type': 'BreadcrumbList' }) + BYLINE_PRE);
  const post = wrap('', ld({ '@type': 'BreadcrumbList' }) + BYLINE_POST);
  assert.deepStrictEqual(compare(pre, post), []); // the hash difference must NOT be flagged
});
