import { test, expect, type Page } from '@playwright/test';

// Phase 0 surface: logged-out behavior of the new rendition endpoints and
// the unchanged quiz endpoint (rollback posture: nothing learner-visible
// changed). Authenticated-path E2E lands with Phase 1.
//
// The player-render block at the bottom covers the article-primary panel
// (text-first courses): the primary panel hydrates from the same endpoint
// through the same fetch/render helpers the secondary Read tab uses.

test('rendition endpoint 401s logged out', async ({ request }) => {
  const res = await request.get('/api/courses/rendition?stepId=mc-intro-3&format=reading');
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.ok).toBe(false);
});

test('rendition endpoint 401s before leaking format validation', async ({ request }) => {
  const res = await request.get('/api/courses/rendition?stepId=mc-intro-3&format=bogus');
  expect(res.status()).toBe(401);
});

test('admin renditions endpoint 401s logged out', async ({ request }) => {
  const res = await request.get('/api/admin/courses/masterclass-endo-surgery/steps/mc-intro-3/renditions');
  expect(res.status()).toBe(401);
});

test('quiz endpoint still 401s logged out (dual-read no regression)', async ({ request }) => {
  const res = await request.get('/api/courses/quiz?courseId=masterclass-endo-surgery&stepId=mc-intro-3');
  expect(res.status()).toBe(401);
});

// --- Article-primary panel hydration (text-first courses) ---
//
// Progress is stubbed 'ok' in every test below. The player's progress path
// redirects a caller with no enrollment row to the sales page, a gate this
// surface does not change; left live it would navigate away mid-assertion.
// No enrollment, progress or quiz write happens on any of these paths.
//
// ARTICLE_E2E_* default to a live article step with NO published reading
// rendition (the inert case: every article step today). TEXT_COURSE_E2E_*
// must name a published text-first lesson; those tests skip until one exists.

const ARTICLE_SLUG = process.env.ARTICLE_E2E_SLUG || 'rrm-vs-ivf';
const ARTICLE_STEP = process.env.ARTICLE_E2E_STEP || 'ivf-refs-1';
const TEXT_SLUG = process.env.TEXT_COURSE_E2E_SLUG;
const TEXT_STEP = process.env.TEXT_COURSE_E2E_STEP;

async function stubProgress(page: Page) {
  await page.route('**/api/courses/progress*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        steps: {},
        enrollment: { enrolledAt: '2026-01-01T00:00:00Z', completedAt: null, certificateIssuedAt: null },
      }),
    })
  );
}

async function stubRendition(page: Page, body: unknown, status = 200) {
  await page.route('**/api/courses/rendition*', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

test.describe('article step with no published reading rendition', () => {
  test('keeps its static placeholder and never calls the rendition endpoint', async ({ page }) => {
    await stubProgress(page);
    let calls = 0;
    await page.route('**/api/courses/rendition*', (route) => {
      calls++;
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'rendition_not_available' }),
      });
    });

    await page.goto(`/courses/${ARTICLE_SLUG}/${ARTICLE_STEP}/`);
    await expect(page).toHaveURL(new RegExp(`/courses/${ARTICLE_SLUG}/${ARTICLE_STEP}/?$`));
    await expect(page.locator('.article-placeholder')).toBeVisible();
    expect(calls, 'a step with no published reading must not call the rendition endpoint').toBe(0);
  });
});

test.describe('text-first lesson with a published reading rendition', () => {
  test.skip(
    !TEXT_SLUG || !TEXT_STEP,
    'Set TEXT_COURSE_E2E_SLUG + TEXT_COURSE_E2E_STEP to a published article step carrying a published reading rendition.'
  );

  test('the reading renders into the primary panel with a read-time header', async ({ page }) => {
    await stubProgress(page);
    await stubRendition(page, {
      ok: true,
      format: 'reading',
      html: '<h3>Rendition heading</h3><p>Rendition body copy.</p>',
      wordCount: 420,
    });

    await page.goto(`/courses/${TEXT_SLUG}/${TEXT_STEP}/`);
    const panel = page.locator('[data-rendition-panel="reading"][data-rendition-primary]');
    await expect(panel.locator('[data-rendition-html]')).toContainText('Rendition body copy.');
    await expect(panel.locator('[data-rendition-readtime]')).toHaveText('420 words · 2 min read');
    await expect(page.locator('.article-placeholder')).toHaveCount(0);
  });

  test('a 401 renders the free-account panel with signup and login links', async ({ page }) => {
    await stubProgress(page);
    await stubRendition(page, { ok: false, error: 'Not authenticated' }, 401);

    await page.goto(`/courses/${TEXT_SLUG}/${TEXT_STEP}/`);
    const dest = encodeURIComponent(`/courses/${TEXT_SLUG}/${TEXT_STEP}/`);
    const signup = page.locator('.article-signup');
    await expect(signup).toContainText('Create a free account to read this lesson');
    await expect(signup.locator('a[href^="/signup/"]')).toHaveAttribute('href', `/signup/?redirect=${dest}`);
    await expect(signup.locator('a[href^="/login/"]')).toHaveAttribute('href', `/login/?redirect=${dest}`);
    await expect(page.locator('[data-rendition-html]')).toBeHidden();
    // :global() regression guard — the JS-built panel must be actually styled:
    await expect(signup).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });
});
