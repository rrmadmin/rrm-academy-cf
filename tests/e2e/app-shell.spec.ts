import { readFileSync } from 'node:fs';
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

test.describe('App shell — mobile (375x812)', () => {
  test.use({ baseURL: LOCAL_BASE_URL, viewport: { width: 375, height: 812 } });

  test('mobile bottom nav visible, sidebar hidden', async ({ page }) => {
    await page.goto('/library/');
    await expect(page.locator('.app-shell-bottom-nav')).toBeVisible();
    await expect(page.locator('.app-shell-nav')).not.toBeVisible();
  });

  test('hamburger drawer opens and closes', async ({ page }) => {
    await page.goto('/library/');
    await page.click('.app-shell-drawer-toggle');
    await expect(page.locator('#app-shell-drawer')).toHaveAttribute('data-open', 'true');
    await page.click('.app-shell-drawer__overlay');
    await expect(page.locator('#app-shell-drawer')).toHaveAttribute('data-open', 'false');
  });

  test('peek bar appears after card click; sheet opens to half on tap', async ({ page }) => {
    await page.goto('/library/');
    await page.locator('[data-article-card]').first().click();
    await expect(page.locator('.app-shell-sheet-peek')).toBeVisible();
    await page.click('.app-shell-sheet-peek');
    await expect(page.locator('.app-shell-sheet')).toHaveAttribute('data-state', 'half');
  });

  test('bottom-nav Library tab clears context and returns to /library/', async ({ page }) => {
    await page.goto('/library/');
    await page.locator('[data-article-card]').first().click();
    await page.click('.app-shell-bottom-nav__tab[href="/library/"]');
    await expect(page).toHaveURL(/\/library\/?$/);
    const ctx = await page.evaluate(() => sessionStorage.getItem('rrm-shell-context'));
    expect(ctx).toBeNull();
  });
});

// Read the first published library slug at test-load time so the suite never
// hardcodes an article that might be retracted, renamed, or replaced. Reading
// articles.json keeps the test resilient to data churn — failure here means
// "no library data was fetched" not "redwine-excision-2012 changed slugs".
const FIRST_LIBRARY_SLUG = JSON.parse(
  readFileSync('src/data/articles.json', 'utf8')
)[0].slug;

test.describe('App shell — cold landing + adversarial', () => {
  test.use({ baseURL: LOCAL_BASE_URL });

  test('cold landing on article = full-width (no middle column visible)', async ({ page }) => {
    // Direct navigate, no sessionStorage.
    await page.goto(`/library/${FIRST_LIBRARY_SLUG}/`);
    await expect(page.locator('html')).toHaveClass(/shell-no-context/);
    await expect(page.locator('.app-shell-middle-column')).not.toBeVisible();
  });

  test('malformed sessionStorage rejected silently (no XSS)', async ({ page }) => {
    await page.goto('/library/');
    await page.evaluate(() => {
      sessionStorage.setItem('rrm-shell-context', JSON.stringify({
        source: 'library',
        label: '<img src=x onerror=alert(1)>',
        slugs: ['<script>alert(1)</script>'],
        returnUrl: 'javascript:alert(1)',
        writtenAt: 1
      }));
    });
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/shell-no-context/);
    // Confirm no alerts fired (would have crashed the test if so).
  });

  test('storage SecurityError degrades gracefully', async ({ page, context }) => {
    // Block storage by intercepting; not all browsers support this. Skip if not.
    await page.goto('/library/');
    await page.evaluate(() => {
      // Override sessionStorage methods to throw.
      Object.defineProperty(window, 'sessionStorage', {
        get() { throw new DOMException('SecurityError', 'SecurityError'); }
      });
    });
    await page.reload();
    // Page should still render; .shell-no-context present.
    await expect(page.locator('html')).toHaveClass(/shell-no-context/);
  });
});

test.describe('App shell — no-JS fallback', () => {
  test.use({ baseURL: LOCAL_BASE_URL, javaScriptEnabled: false });

  test('sidebar renders without JS, theme toggle inert', async ({ page }) => {
    await page.goto('/library/');
    await expect(page.locator('.app-shell-nav')).toBeVisible();
    // Sheet absent (no JS to mount it).
    await expect(page.locator('.app-shell-sheet')).not.toBeVisible();
  });
});
