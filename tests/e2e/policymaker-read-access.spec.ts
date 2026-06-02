import { test, expect } from '@playwright/test';

const SLUG = process.env.PM_VERIFY_SLUG;
const STEP = process.env.PM_VERIFY_STEP;

test.describe('guest-readable course lessons', () => {
  test.skip(!SLUG || !STEP, 'Set PM_VERIFY_SLUG + PM_VERIFY_STEP to a published guest-readable course/step to run.');

  test('logged-out visitor reads the lesson (no redirect) and sees a styled banner', async ({ page }) => {
    await page.goto(`/courses/${SLUG}/${STEP}/`);
    await expect(page).toHaveURL(new RegExp(`/courses/${SLUG}/${STEP}/?$`));
    await expect(page.locator('.article-content')).toBeVisible();
    const banner = page.locator('#guest-preview-banner');
    await expect(banner).toBeVisible();
    // :global() regression guard — banner must be actually styled, not transparent:
    await expect(banner).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });
});
