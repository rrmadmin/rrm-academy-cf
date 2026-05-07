// tests/e2e/app-shell-visual.spec.ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const articles = JSON.parse(readFileSync('./src/data/articles.json', 'utf8'));
const FIRST_ARTICLE_SLUG: string = articles[0].slug;

test.describe('App shell — visual regression', () => {
  const fixtures = [
    { name: 'library-index',    url: '/library/',                                       vp: { width: 1440, height: 900 } },
    { name: 'library-article',  url: `/library/${FIRST_ARTICLE_SLUG}/`,                 vp: { width: 1440, height: 900 } },
    { name: 'commentary-index', url: '/commentary/',                                    vp: { width: 1440, height: 900 } },
    { name: 'library-mobile',   url: '/library/',                                       vp: { width: 375, height: 812 } },
  ];
  for (const f of fixtures) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${f.name}-${theme}`, async ({ page }) => {
        await page.setViewportSize(f.vp);
        await page.goto(f.url);
        await page.evaluate((t) => {
          localStorage.setItem('rrm_theme', t);
          document.documentElement.setAttribute('data-theme', t);
        }, theme);
        await page.waitForTimeout(200);
        await expect(page).toHaveScreenshot(`${f.name}-${theme}.png`, {
          fullPage: false,
          animations: 'disabled',
        });
      });
    }
  }
});
