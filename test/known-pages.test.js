import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveRoute,
  routeSlug,
  titleFor,
  isSuggestable,
  buildKnownPages,
  PRIVATE_EXCLUDE,
} from '../src/lib/known-pages.js';

test('deriveRoute handles top-level files and dir indexes', () => {
  assert.equal(deriveRoute('/src/pages/about.astro'), '/about');
  assert.equal(deriveRoute('/src/pages/glossary/index.astro'), '/glossary');
  assert.equal(deriveRoute('/src/pages/index.astro'), '/');
  assert.equal(deriveRoute('src/pages/donate.astro'), '/donate');
});

test('routeSlug returns the first segment', () => {
  assert.equal(routeSlug('/glossary'), 'glossary');
  assert.equal(routeSlug('/save-the-uterus-club'), 'save-the-uterus-club');
});

test('titleFor uses overrides then titlecase fallback', () => {
  assert.equal(titleFor('/naprotechnology'), 'NaProTechnology');
  assert.equal(titleFor('/femm'), 'FEMM');
  assert.equal(titleFor('/neofertility'), 'NeoFertility');
  assert.equal(titleFor('/faqs'), 'FAQs');
  assert.equal(titleFor('/endometriosis'), 'Endometriosis');
  assert.equal(titleFor('/save-the-uterus-club'), 'Save the Uterus Club');
});

test('isSuggestable excludes dynamic, partials, root, 404, and private slugs', () => {
  assert.equal(isSuggestable('/src/pages/glossary/index.astro'), true);
  assert.equal(isSuggestable('/src/pages/library/[...slug].astro'), false);
  assert.equal(isSuggestable('/src/pages/_partial.astro'), false);
  assert.equal(isSuggestable('/src/pages/index.astro'), false);
  assert.equal(isSuggestable('/src/pages/404.astro'), false);
  assert.equal(isSuggestable('/src/pages/account/index.astro'), false);
  assert.equal(isSuggestable('/src/pages/admin/seo.astro'), false);
});

test('buildKnownPages produces sorted, deduped, titled entries and drops excluded', () => {
  const keys = [
    '/src/pages/about.astro',
    '/src/pages/glossary/index.astro',
    '/src/pages/naprotechnology/index.astro',
    '/src/pages/account/index.astro', // excluded
    '/src/pages/index.astro', // root, excluded
    '/src/pages/library/[...slug].astro', // dynamic, excluded
  ];
  const pages = buildKnownPages(keys);
  assert.deepEqual(pages, [
    { path: '/about', title: 'About' },
    { path: '/glossary', title: 'Glossary' },
    { path: '/naprotechnology', title: 'NaProTechnology' },
  ]);
});

test('PRIVATE_EXCLUDE contains the known auth/utility slugs', () => {
  for (const slug of ['account', 'ask', 'admin', 'login', 'signup', 'providers']) {
    assert.ok(PRIVATE_EXCLUDE.has(slug), `expected ${slug} excluded`);
  }
});
