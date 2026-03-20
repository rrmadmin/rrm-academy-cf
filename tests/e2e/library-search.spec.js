// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Library search smoke tests.
 *
 * Validates that Pagefind loads, searches return results, and the
 * RRF fusion (recency + relevance + semantic) produces reasonable rankings.
 * These tests run against production after every deploy.
 */

test.describe('Library search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/library/');
  });

  test('search box is present and focusable', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: /search/i });
    await expect(search).toBeVisible();
    await search.focus();
    await expect(search).toBeFocused();
  });

  test('typing a query returns results', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: /search/i });
    await search.fill('endometriosis');
    await page.waitForSelector('.sr-count', { timeout: 15000 });

    const countText = await page.locator('.sr-count').textContent();
    const count = parseInt(countText || '0');
    expect(count).toBeGreaterThan(0);

    // At least one result card rendered
    const firstResult = page.locator('.sr-item').first();
    await expect(firstResult).toBeVisible();
  });

  test('search does not show "Search unavailable"', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: /search/i });
    await search.fill('endometriosis');

    // Wait for either results or error
    await page.waitForSelector('.sr-count, .sr-empty', { timeout: 15000 });

    const errorEl = page.locator('.sr-empty');
    if (await errorEl.count()) {
      const text = await errorEl.textContent();
      expect(text).not.toContain('Search unavailable');
    }
  });

  test('own content (ARTICLE type) surfaces for broad queries', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: /search/i });
    await search.fill('rrm');
    await page.waitForSelector('.sr-count', { timeout: 15000 });

    // At least one ARTICLE badge should appear in initial results
    const articleBadges = page.locator('.sr-type--article');
    const count = await articleBadges.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clear button resets search', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: /search/i });
    await search.fill('endometriosis');
    await page.waitForSelector('.sr-count', { timeout: 15000 });

    // Click clear
    const clearBtn = page.locator('button:has-text("✕")');
    await clearBtn.click();

    // Search box empty, results gone
    await expect(search).toHaveValue('');
    await expect(page.locator('.sr-count')).not.toBeVisible();
  });

  test('"Show more" loads additional results', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: /search/i });
    await search.fill('endometriosis');
    await page.waitForSelector('.sr-count', { timeout: 15000 });

    const moreBtn = page.locator('.sr-more');
    if (await moreBtn.count()) {
      const initialItems = await page.locator('.sr-item').count();
      await moreBtn.click();
      await page.waitForTimeout(1000);
      const afterItems = await page.locator('.sr-item').count();
      expect(afterItems).toBeGreaterThan(initialItems);
    }
  });
});
