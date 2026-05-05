#!/usr/bin/env node
// Capture screenshots for ~30 key pages × 2 viewports
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { createHash } from 'crypto';

const PAGES = [
  '/', '/about', '/what-is-rrm/', '/naprotechnology/', '/neofertility/', '/femm/',
  '/common-questions-about-rrm/', '/save-the-uterus-club/', '/donate/',
  '/ask/', '/ivf-success-calculator/', '/endo-survey/',
  '/library/', '/commentary/', '/courses/', '/faqs/', '/glossary/', '/guides/',
  '/community/', '/partners/',
  '/login', '/signup',
  '/policies/editorial', '/policies/fact-checking',
  '/library/page/2/', '/commentary/page/2/',
  '/glossary/restorative-reproductive-medicine/',
  '/commentary/the-rrm-research-library-just-got-better/',
];

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
mkdirSync(OUT + '/mobile', { recursive: true });
mkdirSync(OUT + '/desktop', { recursive: true });

const browser = await chromium.launch();
const summary = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, userAgent: 'arise-baseline/1.0' });
  const page = await ctx.newPage();
  for (const path of PAGES) {
    const slug = path.replace(/\//g, '_').replace(/^_/, '').replace(/_$/, '') || 'home';
    const file = `${OUT}/${vp.name}/${slug}.png`;
    try {
      const t0 = Date.now();
      const r = await page.goto('https://rrmacademy.org' + path, { waitUntil: 'networkidle', timeout: 30000 });
      const ms = Date.now() - t0;
      await page.screenshot({ path: file, fullPage: false });
      const buf = await page.screenshot({ fullPage: false });
      const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
      summary.push({ viewport: vp.name, path, status: r?.status() ?? 0, file, sha256: sha, latency_ms: ms });
      process.stderr.write(`${vp.name} ${r?.status() ?? '?'} ${ms}ms ${path}\n`);
    } catch (e) {
      summary.push({ viewport: vp.name, path, error: String(e).slice(0, 200) });
      process.stderr.write(`ERR ${vp.name} ${path}: ${e.message}\n`);
    }
  }
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(summary, null, 2));
