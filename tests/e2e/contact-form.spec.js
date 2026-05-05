import { test, expect } from '@playwright/test';

test.describe('/contact/ form', () => {
  test('renders notice block + form', async ({ page }) => {
    await page.goto('/contact/');
    await expect(page.locator('.contact-notice h2')).toContainText('Looking for clinical care?');
    await expect(page.locator('#contact-category')).toBeVisible();
    await expect(page.locator('#contact-message')).toBeVisible();
  });

  test('category dropdown has 8 enum options + placeholder', async ({ page }) => {
    await page.goto('/contact/');
    const options = await page.locator('#contact-category option').allTextContents();
    expect(options.length).toBe(9); // 1 placeholder + 8 categories
  });

  test('URL hash preselects category in dropdown', async ({ page }) => {
    await page.goto('/contact/#contact-form?category=bug');
    await expect(page.locator('#contact-category')).toHaveValue('bug');
  });

  test('notice block links to bridge page and FACTS', async ({ page }) => {
    await page.goto('/contact/');
    await expect(page.locator('.contact-notice a[href="/schedule-with-dr-whittaker/"]')).toBeVisible();
    await expect(page.locator('.contact-notice a[href="https://www.factsaboutfertility.org/find-a-provider/"]')).toBeVisible();
  });
});
