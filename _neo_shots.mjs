import { chromium } from 'playwright';
const targets = [
  { url: 'http://127.0.0.1:4322/', name: 'home' },
  { url: 'http://127.0.0.1:4322/contact/', name: 'contact' },
  { url: 'http://127.0.0.1:4322/treatment-plan/', name: 'treatment' },
];
const viewports = [
  { name: 'desktop', w: 1440, h: 900 },
  { name: 'mobile', w: 393, h: 852 },
];
const browser = await chromium.launch();
for (const t of targets) {
  for (const v of viewports) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }});
    const page = await ctx.newPage();
    await page.goto(t.url, { waitUntil: 'networkidle' });
    const path = `/tmp/neoscreens/${t.name}-${v.name}.png`;
    await page.screenshot({ path, fullPage: true });
    console.log(path);
    await ctx.close();
  }
}
await browser.close();
