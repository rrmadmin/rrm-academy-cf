#!/usr/bin/env node
/**
 * One-off G3 proof for /admin/membership/: launches chromium at the mobile
 * screenshot-gate viewport (393x852), intercepts GET /api/admin/membership-report
 * with a synthetic fixture (no real member names/emails), asserts no
 * horizontal overflow and that the headline tile + a chart render, then
 * saves mobile (393x852) and desktop (1280x800) screenshots.
 *
 * Serves the page via `astro dev` (Vite dev server) rather than wrangler
 * pages dev / a full build, since the admin page itself does not depend on
 * the CF Pages Functions middleware to render (see tests/e2e/auth-boundary.spec.ts:
 * "functions/_middleware.js does NOT redirect static HTML page routes").
 *
 * Usage: node scripts/verify-membership-mobile.mjs
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = join(ROOT, '.superpowers/sdd');

const FIXTURE = {
  generated_at: '2026-07-17T18:05:58.490Z',
  month: '2026-07',
  headline: {
    total_supporters: 214,
    recurring_monthly_cents: 312500,
    delta_vs_prior_month_cents: 4200,
    delta_basis: 'prior_month_membership_receipts',
    mom: {
      receipts_this_month_cents: 39700,
      receipts_prior_month_cents: 56800,
      receipts_anticipated_cents: 48000,
      supporters_this_month: 39,
      supporters_prior_month: 41,
      month_in_progress: true,
    },
    degraded: false,
  },
  stuc: {
    active_by_tier: { member: 120, hero: 45, superhero: 8 },
    monthly_cents: 312500,
    wix_count: 90,
    stripe_count: 75,
    legacy_count: 6,
    staff_count: 2,
    joined_this_month: [{ email: 'new.member@example.com', name: 'Test Member' }],
    left_this_month: [{ email: 'left.member@example.com', name: null }],
    watchlist: [
      { kind: 'voided_invoice', email: 'watch.one@example.com', name: 'Sample Watch',
        action: 'Their most recent payment was voided but the subscription is still open. Cancel it in Stripe.' },
    ],
    known_paused: [{ name: 'Sample Paused Donor', note: 'Paused / comped (Brian approved).' }],
    stripe_unavailable: false,
  },
  foundation: {
    one_time_this_month_cents: 50000,
    recurring_this_month_cents: 120000,
    ytd_cents: 900000,
    new_recurring: [{ email: 'new.donor@example.com', display_name: 'Sample New Donor', amount_cents: 2500 }],
    lapsed_recurring: [{ email: 'lapsed.donor@example.com', display_name: 'Sample Lapsed Donor', days_since_last: 60 }],
    ppgf_this_month_cents: 15000,
  },
  academy: {
    course_purchases_this_month: 12,
    course_revenue_this_month_cents: 84000,
    ytd_purchases: 140,
    ytd_cents: 980000,
  },
  actions: [
    { who: 'Brian', what: 'Their most recent payment was voided but the subscription is still open. Cancel it in Stripe.' },
    { who: 'Naomi', what: 'Reach out to Sample Lapsed Donor, a lapsed recurring donor.' },
  ],
  trend: Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return {
      month: `2026-${String(m).padStart(2, '0')}`,
      stuc_cents: 250000 + i * 5000,
      foundation_cents: 100000 + i * 3000,
      academy_cents: 60000 + i * 2000,
    };
  }),
};

function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() - start > timeoutMs) reject(new Error('astro dev did not come up in time'));
        else setTimeout(poll, 500);
      });
    })();
  });
}

async function main() {
  // BaseLayout imports src/generated/ssot-schema.json, which is gitignored
  // and normally produced by the full `npm run build` chain. astro dev fails
  // every route with FailedToLoadModuleSSR if it is missing, so regenerate it
  // (CI-fallback path, no secrets needed) before starting the dev server.
  if (!existsSync(join(ROOT, 'src/generated/ssot-schema.json'))) {
    console.log('src/generated/ssot-schema.json missing, running ssot-prebuild...');
    spawnSync('node', ['scripts/ssot-prebuild.mjs'], { cwd: ROOT, env: { ...process.env, SITE_SSOT_ENABLED: '0' }, stdio: 'inherit' });
  }

  console.log('Starting astro dev...');
  const server = spawn('npx', ['astro', 'dev', '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOut = '';
  server.stdout.on('data', (d) => { serverOut += d.toString(); });
  server.stderr.on('data', (d) => { serverOut += d.toString(); });

  const results = { assertions: [] };
  try {
    await waitForServer(BASE);
    console.log('astro dev is up.');

    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const page = await context.newPage();

    await page.route('**/api/admin/membership-report*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) })
    );

    await page.goto(`${BASE}/admin/membership/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
      const el = document.getElementById('h-supporters');
      return el && el.textContent !== '--';
    }, { timeout: 15000 });

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const noOverflow = overflow.scrollWidth <= overflow.clientWidth + 1;
    results.assertions.push({
      name: 'no horizontal overflow at 393px',
      pass: noOverflow,
      detail: `scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
    });

    const headlineVisible = await page.locator('#h-supporters').isVisible();
    const headlineText = await page.locator('#h-supporters').textContent();
    results.assertions.push({
      name: 'headline tile visible with real value',
      pass: headlineVisible && headlineText.trim() !== '--',
      detail: `visible=${headlineVisible} text="${headlineText}"`,
    });

    const chartVisible = await page.locator('#chart-stuc svg').isVisible();
    results.assertions.push({
      name: 'trend chart (chart-stuc svg) visible',
      pass: chartVisible,
      detail: `visible=${chartVisible}`,
    });

    const momThis = (await page.locator('#h-mom-this').textContent()) || '';
    const momPrior = (await page.locator('#h-mom-prior').textContent()) || '';
    const momSup = (await page.locator('#h-mom-supporters').textContent()) || '';
    console.log('\nRendered Change tile (month_in_progress fixture):');
    console.log(`  h-mom-this:       "${momThis}"`);
    console.log(`  h-mom-prior:      "${momPrior}"`);
    console.log(`  h-mom-supporters: "${momSup}"`);

    await page.screenshot({ path: join(OUT_DIR, 'g3-mobile.png') });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT_DIR, 'g3-desktop.png') });

    await browser.close();
  } catch (err) {
    console.error('Script failed:', err.message);
    console.error('astro dev output:\n' + serverOut);
    throw err;
  } finally {
    server.kill();
  }

  const failed = results.assertions.filter((a) => !a.pass);
  console.log('\nAssertion results:');
  for (const a of results.assertions) {
    console.log(`  [${a.pass ? 'PASS' : 'FAIL'}] ${a.name} (${a.detail})`);
  }
  if (failed.length) {
    console.error(`\n${failed.length} assertion(s) FAILED.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll assertions PASSED.');
  }
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exitCode = 1;
});
