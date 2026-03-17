// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Mobile responsive regression tests.
 *
 * Background: mobile overflow / "still broken on iPhone" recurred across
 * 33+ sessions. This suite catches horizontal overflow at small viewports
 * so regressions are caught before deploy.
 *
 * These tests only run in the mobile projects (iPhone SE = 375px,
 * iPhone XR = 414px) defined in playwright.config.js. The desktop
 * project will also run them but at desktop width, which is fine as
 * a baseline.
 */

/**
 * Helper: assert no horizontal overflow on the current page.
 * Returns the overflow amount in pixels (0 = no overflow).
 */
async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
  expect(overflow, `${label}: scrollWidth exceeds clientWidth by ${overflow}px`).toBeLessThanOrEqual(0);
}

/**
 * Wait for page to be ready. Uses domcontentloaded instead of
 * networkidle because some pages (commentary) have persistent
 * connections that prevent networkidle from ever resolving.
 */
async function waitForReady(page) {
  await page.waitForLoadState('domcontentloaded');
  // Brief pause for CSS/layout to settle
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------
// Homepage
// ---------------------------------------------------------------
test.describe('Homepage mobile', () => {
  test('no horizontal overflow', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
    await assertNoHorizontalOverflow(page, 'Homepage');
  });

  test('hero content is visible', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('.hero, [class*="hero"]').first();
    await expect(hero).toBeVisible();
  });
});

// ---------------------------------------------------------------
// Library
// ---------------------------------------------------------------
test.describe('Library mobile', () => {
  test('no horizontal overflow on landing', async ({ page }) => {
    await page.goto('/library/');
    await waitForReady(page);
    await assertNoHorizontalOverflow(page, '/library/');
  });

  test('no horizontal overflow on page 1', async ({ page }) => {
    await page.goto('/library/page/1/');
    await waitForReady(page);
    await assertNoHorizontalOverflow(page, '/library/page/1/');
  });

  test('article cards do not overflow viewport', async ({ page }) => {
    await page.goto('/library/page/1/');
    const viewportWidth = page.viewportSize()?.width ?? 375;

    // Check that no card is wider than the viewport
    const cards = page.locator('.article-card, .article-list > *');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 5); i++) {
      const box = await cards.nth(i).boundingBox();
      if (box) {
        expect(
          box.width,
          `Card ${i} width ${box.width}px exceeds viewport ${viewportWidth}px`
        ).toBeLessThanOrEqual(viewportWidth + 1); // 1px tolerance for rounding
      }
    }
  });
});

// ---------------------------------------------------------------
// NaProTechnology pillar page
// ---------------------------------------------------------------
test.describe('NaProTechnology mobile', () => {
  test('no horizontal overflow', async ({ page }) => {
    await page.goto('/naprotechnology/');
    await waitForReady(page);
    await assertNoHorizontalOverflow(page, '/naprotechnology/');
  });
});

// ---------------------------------------------------------------
// Commentary (blog)
// ---------------------------------------------------------------
test.describe('Commentary mobile', () => {
  test('no horizontal overflow', async ({ page }) => {
    await page.goto('/commentary/');
    await waitForReady(page);
    await assertNoHorizontalOverflow(page, '/commentary/');
  });

  test('blog cards render and stay within viewport', async ({ page }) => {
    await page.goto('/commentary/');
    const viewportWidth = page.viewportSize()?.width ?? 375;

    const cards = page.locator('.blog-card, .post-card, [class*="blog-card"], [class*="post-card"], article').first();
    await expect(cards).toBeVisible();

    // Check first few cards fit within viewport
    const allCards = page.locator('.blog-card, .post-card, [class*="blog-card"], [class*="post-card"], article');
    const count = await allCards.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const box = await allCards.nth(i).boundingBox();
      if (box) {
        expect(
          box.width,
          `Blog card ${i} width ${box.width}px exceeds viewport ${viewportWidth}px`
        ).toBeLessThanOrEqual(viewportWidth + 1);
      }
    }
  });
});

// ---------------------------------------------------------------
// Additional high-traffic pages
// ---------------------------------------------------------------
test.describe('Other pages mobile', () => {
  test('/what-is-rrm/ no horizontal overflow', async ({ page }) => {
    await page.goto('/what-is-rrm/');
    await waitForReady(page);
    await assertNoHorizontalOverflow(page, '/what-is-rrm/');
  });

  test('/guides/ no horizontal overflow', async ({ page }) => {
    await page.goto('/guides/');
    await waitForReady(page);
    await assertNoHorizontalOverflow(page, '/guides/');
  });

  test('/faqs/ no horizontal overflow', async ({ page }) => {
    await page.goto('/faqs/');
    await waitForReady(page);
    await assertNoHorizontalOverflow(page, '/faqs/');
  });

  test('/courses/ no horizontal overflow', async ({ page }) => {
    await page.goto('/courses/');
    await waitForReady(page);
    await assertNoHorizontalOverflow(page, '/courses/');
  });
});
