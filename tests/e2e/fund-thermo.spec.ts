import { test, expect, type Page } from '@playwright/test';

async function mockProgress(page: Page, body: unknown, status = 200) {
  await page.route('**/api/fund-progress', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

// /providers/ shows raised-so-far only (public goal removed 2026-07-11; the
// thermometer tests that lived here come back with the goal on revert).
test.describe('fund raised-only on /providers/', () => {
  test('positive raised reveals the row, no goal or bar anywhere', async ({ page }) => {
    await mockProgress(page, { raised_cents: 250000, goal_cents: 0, count: 12, supporters: 12 });
    await page.goto('/providers/');
    await expect(page.locator('#fund-raised')).toHaveText('$2,500');
    await expect(page.locator('#fund-thermo .fund-thermo__head')).toBeVisible();
    await expect(page.locator('#fund-supporters')).toContainText('12 supporters');
    await expect(page.locator('#fund-fill')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('$10,000');
  });

  test('zero raised keeps the row hidden (no "$0 raised" anti-proof)', async ({ page }) => {
    await mockProgress(page, { raised_cents: 0, goal_cents: 0, count: 0, supporters: 0 });
    await page.goto('/providers/');
    await expect(page.locator('#fund-thermo .fund-thermo__head')).toBeHidden();
    await expect(page.locator('#fund-supporters')).toBeHidden();
  });

  test('fail-soft: a 503 keeps the row hidden and throws nothing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockProgress(page, { error: 'service_unavailable' }, 503);
    await page.goto('/providers/');
    await expect(page.locator('#fund-thermo .fund-thermo__head')).toBeHidden();
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});

test.describe('CampaignCallout preview', () => {
  test('band renders snapshot total with no live fetch', async ({ page }) => {
    let fetched = false;
    await page.route('**/api/fund-progress', (route) => {
      fetched = true;
      route.fulfill({ status: 200, body: '{}' });
    });
    // Navigate to ?only=band so the card variant (which live-fetches) is not rendered.
    await page.goto('/dev/campaign-callout-preview/?only=band');
    await expect(
      page.locator('#cc-thermo-provider-directory .fund-thermo__raised').first(),
    ).toHaveText('$2,500');
    expect(fetched, 'band must NOT call /api/fund-progress').toBe(false);
  });

  test('goal-met band carries data-state="met"', async ({ page }) => {
    await page.goto('/dev/campaign-callout-preview/');
    await expect(page.locator('#cc-thermo-preview-met')).toHaveAttribute('data-state', 'met');
  });

  test('zero-goal band renders no thermometer (goal-only)', async ({ page }) => {
    await page.goto('/dev/campaign-callout-preview/');
    await expect(page.locator('#cc-thermo-preview-zerogoal')).toHaveCount(0);
  });
});
