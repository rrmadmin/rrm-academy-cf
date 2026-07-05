import { test, expect } from '@playwright/test';

/**
 * ci-smoke.spec.ts - the three journeys not covered by an existing prod-safe spec:
 *   1. Homepage renders with primary nav.
 *   2. A library record page renders (navigated from the landing, so no local data
 *      file is needed - CI does not build the site).
 *   3. 404 behavior: a bad path returns status 404 and the recovery UI.
 *
 * Design: docs/superpowers/specs/2026-07-05-e2e-in-ci-design.md
 *
 * PROD-SAFETY CONTRACT (hard): every assertion below is a GET or a page render.
 * Zero mutating paths. baseURL comes from playwright.ci.config.ts (production by
 * default). Assertions target deploy-invariant structure, never freshly-changed
 * content values, so edge-cache lag after a deploy cannot flake this run.
 */

test.describe('Homepage', () => {
  test('renders with header, primary nav, and a library link', async ({ page }) => {
    const resp = await page.goto('/');
    expect(resp?.status(), 'homepage should serve 200').toBe(200);

    // Site chrome present.
    await expect(page.locator('header.site-header')).toBeVisible();
    const nav = page.locator('nav.main-nav');
    await expect(nav).toBeVisible();

    // The primary nav links into the core product surface (the Research Library).
    await expect(nav.locator('a[href="/library/"]').first()).toBeVisible();

    // Hero H1 is present (stable id, not asserting on the exact copy).
    await expect(page.locator('#hp-hero-h1')).toBeVisible();
  });
});

test.describe('Library record page', () => {
  test('landing lists records and a record page renders its content', async ({ page }) => {
    const landing = await page.goto('/library/');
    expect(landing?.status(), '/library/ should serve 200').toBe(200);

    // Find the first link into an individual library record. Record slugs live at
    // /library/<slug>/; exclude the paginated browse routes (/library/page/N/) and
    // the landing itself.
    const href = await page
      .locator('a[href^="/library/"]:not([href^="/library/page/"]):not([href="/library/"])')
      .first()
      .getAttribute('href');

    expect(href, 'landing should expose at least one record link').toBeTruthy();

    const record = await page.goto(href!);
    expect(record?.status(), `record page ${href} should serve 200`).toBe(200);

    // The record page renders a heading and a body content region.
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(
      page.locator('article, .article-content, main').first()
    ).toBeVisible();
  });
});

test.describe('Library search (Pagefind)', () => {
  test('typing a query returns ranked results', async ({ page }) => {
    await page.goto('/library/');

    // The Pagefind live-search box (SearchBar.astro). Target its stable id: the
    // input is role="combobox" (NOT searchbox), and the page also carries a header
    // search form, so role-based lookup is ambiguous. #search-input is unambiguous.
    const search = page.locator('#search-input');
    await expect(search).toBeVisible();
    await search.click();
    await search.fill('endometriosis');

    // Pagefind lazy-loads its wasm + index on the first keystroke; allow headroom.
    // The current results UI renders grouped result links as `.sr-item` inside
    // `#search-results` (with per-category counts in `.sr-chip-count`). Wait for the
    // first result link, then assert at least one rendered.
    await page.waitForSelector('#search-results .sr-item', { timeout: 20_000 });

    const items = await page.locator('#search-results .sr-item').count();
    expect(items, 'search should return at least one result').toBeGreaterThan(0);

    await expect(page.locator('#search-results .sr-item').first()).toBeVisible();
  });
});

test.describe('404 page', () => {
  const BAD_PATH = '/this-path-does-not-exist-e2e-smoke-check/';

  test('bad path returns status 404 with the recovery UI', async ({ page }) => {
    const resp = await page.goto(BAD_PATH);

    // CF Pages serves dist/404.html at the original URL with a 404 status.
    // (trailingSlash: 'always' means the trailing slash avoids a 301 first.)
    expect(resp?.status(), 'unmatched path should return 404').toBe(404);

    // The 404 recovery surface: the "404" code marker, the search box, and the
    // suggested-destinations nav that links back into the library.
    await expect(page.locator('.not-found__code')).toHaveText('404');
    await expect(page.locator('#nf-search-input')).toBeVisible();
    await expect(
      page.locator('nav.not-found__links a[href="/library/"]')
    ).toBeVisible();
  });
});
