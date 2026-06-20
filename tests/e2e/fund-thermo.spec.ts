import { test, expect, type Page } from '@playwright/test';

async function mockProgress(page: Page, body: unknown, status = 200) {
  await page.route('**/api/fund-progress', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

test.describe('fund-thermo on /providers/', () => {
  test('happy path fills the bar and shows raised + supporters', async ({ page }) => {
    await mockProgress(page, { raised_cents: 250000, goal_cents: 1000000, count: 12, supporters: 12 });
    await page.goto('/providers/');
    const thermo = page.locator('#fund-thermo');
    await expect(page.locator('#fund-raised')).toHaveText('$2,500');
    await expect(page.locator('#fund-fill')).toHaveAttribute('style', /width:\s*25%/);
    await expect(thermo).toHaveAttribute('data-state', 'active');
    await expect(page.locator('#fund-supporters')).toContainText('12 supporters');
  });

  test('over-goal sets data-state="met" and caps the bar at 100%', async ({ page }) => {
    await mockProgress(page, { raised_cents: 1200000, goal_cents: 1000000, count: 80, supporters: 80 });
    await page.goto('/providers/');
    await expect(page.locator('#fund-thermo')).toHaveAttribute('data-state', 'met');
    await expect(page.locator('#fund-fill')).toHaveAttribute('style', /width:\s*100%/);
    await expect(page.locator('#fund-raised')).toHaveText('$12,000');
  });

  test('zero/missing goal does not produce NaN width', async ({ page }) => {
    await mockProgress(page, { raised_cents: 5000, goal_cents: 0, count: 1, supporters: 1 });
    await page.goto('/providers/');
    const width = await page.locator('#fund-fill').evaluate((el) => (el as HTMLElement).style.width);
    expect(width).not.toContain('NaN');
  });

  test('fail-soft: a 503 leaves $0 / 0% and throws nothing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockProgress(page, { error: 'service_unavailable' }, 503);
    await page.goto('/providers/');
    await expect(page.locator('#fund-raised')).toHaveText('$0');
    await expect(page.locator('#fund-fill')).toHaveAttribute('style', /width:\s*0/);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
