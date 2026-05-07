import { test, expect } from '@playwright/test';

// Pin baseURL to the local dev server. Default playwright.config.js baseURL
// points to production (https://rrmacademy.org) where PUBLIC_SHELL_ROUTES is
// empty until Task 32 activates the shell — every shell-presence assertion
// would fail there. Apply test.use({ baseURL: ... }) inside EVERY describe
// block in this file (incl. the ones added in Tasks 28 + 29).
const LOCAL_BASE_URL = 'http://localhost:4321';

const SHELL_ROUTES = process.env.PUBLIC_SHELL_ROUTES || 'commentary,library';

// Pin browserName: 'chromium' at file scope. Playwright forbids browserName in
// describe-scoped test.use() (it would force a new worker mid-file). The
// project's playwright.config.js declares only chromium today; pinning here
// keeps the suite robust if a future config adds a webkit project (storage-race
// behaviors differ between engines).
// v2 backlog: add a webkit project to playwright.config.js and re-run app-shell
// tests on Safari for storage-race coverage of pagehide writes.
test.use({ browserName: 'chromium' });

test.describe('App shell — desktop (1440x900)', () => {
  test.use({ baseURL: LOCAL_BASE_URL, viewport: { width: 1440, height: 900 } });

  test('library index has sidebar, no middle column on cold land', async ({ page }) => {
    await page.goto('/library/');
    await expect(page.locator('.app-shell-nav')).toBeVisible();
    await expect(page.locator('.app-shell-middle-column')).not.toBeVisible();
  });

  test('clicking article card writes context, article page shows middle column', async ({ page }) => {
    await page.goto('/library/');
    const firstCard = page.locator('[data-article-card]').first();
    const slug = await firstCard.getAttribute('data-slug');
    await firstCard.click();
    await expect(page).toHaveURL(new RegExp(`/library/${slug}/`));
    await expect(page.locator('.app-shell-middle-column')).toBeVisible();
    await expect(page.locator(`.app-shell-middle-column a[href="/library/${slug}/"][aria-current="page"]`)).toBeVisible();
  });

  test('theme toggle persists across reload', async ({ page }) => {
    await page.goto('/library/');
    await page.click('[data-theme-toggle]');
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.reload();
    const themeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(themeAfter).toBe(theme);
  });

  test('bottom-nav click clears sessionStorage', async ({ page }) => {
    await page.goto('/library/');
    await page.locator('[data-article-card]').first().click();
    // Bottom nav not visible on desktop — emulate via sidebar logo click clearing context
    await page.click('.app-shell-nav__brand');
    const ctx = await page.evaluate(() => sessionStorage.getItem('rrm-shell-context'));
    expect(ctx).toBeNull();
  });
});
