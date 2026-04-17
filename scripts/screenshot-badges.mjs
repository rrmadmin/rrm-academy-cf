#!/usr/bin/env node
/**
 * Self-review tool. Renders public/partners/preview.html in headless Chromium
 * at a wide viewport and saves a full-page screenshot. The screenshot is
 * written to /tmp/badge-preview.png so the Read tool can ingest it for
 * visual inspection.
 *
 * Used during badge redesign so we can see the result without asking Brian.
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = join(ROOT, 'public/partners/preview.html');
const OUT = '/tmp/badge-preview.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(HTML).href);
await page.waitForLoadState('networkidle').catch(() => {});
// Give fonts a beat to settle
await page.waitForTimeout(500);
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log(`Wrote ${OUT}`);
