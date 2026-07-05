import { defineConfig, devices } from '@playwright/test';

/**
 * CI-only Playwright config for the e2e smoke suite (.github/workflows/e2e.yml).
 *
 * Design: docs/superpowers/specs/2026-07-05-e2e-in-ci-design.md
 *
 * Differs from the local-dev playwright.config.js in three ways:
 *   1. testMatch pins EXACTLY the read-only, production-safe subset. The
 *      localhost-only specs (app-shell, track-smoke) and the uncommitted-baseline
 *      visual spec (app-shell-visual) are excluded so CI never fails on a spec that
 *      needs a local server or a screenshot baseline.
 *   2. baseURL comes from E2E_BASE_URL (default production). The workflow also sets
 *      AUTH_E2E_BASE / BILLING_E2E_BASE / COURSES_E2E_BASE so the boundary specs
 *      (which read those env vars, defaulting to localhost:8788) resolve to prod too.
 *   3. CI hardening: retries, capped workers (polite to prod + under the boundary
 *      specs' per-IP rate limits), forbidOnly, and failure artifacts.
 *
 * Every spec in the set is READ-ONLY against production: GETs, page renders, and
 * anonymous-rejection (401/400/404) checks. No mutating success path runs.
 */

const isCI = !!process.env.CI;
const baseURL = process.env.E2E_BASE_URL || 'https://rrmacademy.org';

export default defineConfig({
  testDir: './tests/e2e',

  // The curated read-only smoke set. Keep in sync with the spec's decision (b) table.
  // ci-smoke covers homepage+nav, library record render, Pagefind search, and 404.
  // The boundary specs cover anonymous-rejection gating for auth/billing/courses/renditions.
  //
  // Deliberately NOT included (bit-rotted selectors against current prod; they stay in
  // the repo for local use and get a selector refresh as a separate follow-up, per the
  // spec's decision (b)): library-search.spec.js (its box is now role=combobox, and the
  // header search shadows the role lookup), library-pagination.spec.js (.article-card is
  // now data-article-card), contact-form.spec.js (notice link hrefs drifted). The search
  // journey they used to cover is now covered by ci-smoke against current selectors.
  testMatch: [
    'ci-smoke.spec.ts',
    'auth-boundary.spec.ts',
    'billing-boundary.spec.ts',
    'course-player.spec.ts',
    'renditions.spec.ts',
  ],

  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 1,
  // Cap concurrency: polite to production and keeps the boundary probes under the
  // 5-per-15-min-per-IP rate limits their headers document.
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
