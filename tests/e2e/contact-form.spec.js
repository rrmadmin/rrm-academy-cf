import { test, expect } from '@playwright/test';

test.describe('/contact/ persona-driven form', () => {
  test('submit disabled until category chosen', async ({ page }) => {
    await page.goto('/contact/');
    const submit = page.locator('#contact-submit');
    await expect(submit).toBeDisabled();
  });

  test('clicking a card "Send a message" enables submit and sets indicator', async ({ page }) => {
    await page.goto('/contact/');
    await page.locator('summary', { hasText: 'I have a question about a course' }).click();
    await page.locator('a.contact-card__send', { hasText: 'Still need help' }).first().click();
    await expect(page.locator('#sending-as-label')).toContainText('Course question');
    await expect(page.locator('#contact-submit')).toBeEnabled();
  });

  test('text link sets category to clinician-or-researcher', async ({ page }) => {
    await page.goto('/contact/');
    await page.locator('a', { hasText: 'clinician or researcher' }).click();
    await expect(page.locator('#category-hidden')).toHaveValue('clinician-or-researcher');
    await expect(page.locator('#sending-as-label')).toContainText('Clinician or researcher');
  });

  test('URL hash preselects category', async ({ page }) => {
    await page.goto('/contact/#contact-form?category=bug');
    await expect(page.locator('#category-hidden')).toHaveValue('bug');
    await expect(page.locator('#category-source-hidden')).toHaveValue('hash');
  });

  test('fallback select sets category with source=select', async ({ page }) => {
    await page.goto('/contact/');
    await page.locator('#category-fallback').selectOption('partnership');
    await expect(page.locator('#category-hidden')).toHaveValue('partnership');
    await expect(page.locator('#category-source-hidden')).toHaveValue('select');
  });

  test('[change] link clears category and re-disables submit', async ({ page }) => {
    await page.goto('/contact/');
    await page.locator('a', { hasText: 'speaking or media' }).click();
    await expect(page.locator('#contact-submit')).toBeEnabled();
    await page.locator('#sending-as-change').click();
    await expect(page.locator('#contact-submit')).toBeDisabled();
    await expect(page.locator('#sending-as-label')).toContainText('Choose a topic above');
  });
});
