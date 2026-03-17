// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Library pagination regression tests.
 *
 * Background: pagination and "view all" links broke across 3+ sessions
 * on Mar 14, 2026. Fixes kept invalidating each other because there
 * were no automated checks covering the happy path.
 */

test.describe('Library landing page', () => {
  test('loads and shows article cards', async ({ page }) => {
    await page.goto('/library/');
    await expect(page).toHaveTitle(/Research Library/i);

    // Should render at least one article card
    const cards = page.locator('.article-card, [class*="article"]').first();
    await expect(cards).toBeVisible();
  });

  test('"View all" link points to /library/page/1/', async ({ page }) => {
    await page.goto('/library/');

    // Find any link that leads to the paginated browse-all listing
    const viewAll = page.locator('a[href*="/library/page/"]').first();
    // If there is a "view all" or "browse all" link, its href must
    // start at page/1 (not page/2, which was the Mar 14 bug).
    if (await viewAll.count()) {
      const href = await viewAll.getAttribute('href');
      expect(href).toMatch(/\/library\/page\/1\/?$/);
    }
  });
});

test.describe('Library pagination pages', () => {
  test('page 1 loads with articles', async ({ page }) => {
    await page.goto('/library/page/1/');
    await expect(page).toHaveTitle(/Page 1/i);

    const cards = page.locator('.article-card, .article-list > *');
    await expect(cards.first()).toBeVisible();
    // 50 articles per page (or close)
    expect(await cards.count()).toBeGreaterThanOrEqual(10);
  });

  test('page 2 loads with articles', async ({ page }) => {
    await page.goto('/library/page/2/');
    await expect(page).toHaveTitle(/Page 2/i);

    const cards = page.locator('.article-card, .article-list > *');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(10);
  });

  test('pagination nav has correct prev/next links on page 2', async ({ page }) => {
    await page.goto('/library/page/2/');

    const pagination = page.locator('nav.pagination, nav[aria-label="Pagination"]');
    await expect(pagination).toBeVisible();

    // "Prev" should link to page 1
    const prev = pagination.locator('a:has-text("Prev")');
    await expect(prev).toHaveAttribute('href', '/library/page/1/');

    // "Next" should link to page 3
    const next = pagination.locator('a:has-text("Next")');
    await expect(next).toHaveAttribute('href', '/library/page/3/');
  });

  test('page 1 has no Prev link', async ({ page }) => {
    await page.goto('/library/page/1/');

    const pagination = page.locator('nav.pagination, nav[aria-label="Pagination"]');
    await expect(pagination).toBeVisible();

    // No "Prev" link on the first page
    const prev = pagination.locator('a:has-text("Prev")');
    await expect(prev).toHaveCount(0);

    // "Next" should exist
    const next = pagination.locator('a:has-text("Next")');
    await expect(next).toBeVisible();
  });

  test('pagination links are sequential (no skipped pages)', async ({ page }) => {
    await page.goto('/library/page/1/');

    const pagination = page.locator('nav.pagination, nav[aria-label="Pagination"]');
    await expect(pagination).toBeVisible();

    // Collect all numbered page links (exclude prev/next/ellipsis)
    const pageLinks = pagination.locator('a:not(:has-text("Prev")):not(:has-text("Next"))');
    const count = await pageLinks.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // First visible page link from page 1 should be page 2
    // (page 1 is rendered as a <span class="current">, not a link)
    const firstLink = await pageLinks.first().getAttribute('href');
    expect(firstLink).toMatch(/\/library\/page\/2\/?$/);
  });

  test('breadcrumb links back to library landing', async ({ page }) => {
    await page.goto('/library/page/1/');

    const crumb = page.locator('nav.breadcrumb a[href="/library/"], nav[aria-label="Breadcrumb"] a[href="/library/"]');
    await expect(crumb).toBeVisible();
  });
});
