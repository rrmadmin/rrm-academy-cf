#!/usr/bin/env node
/**
 * SCAFFOLD (NOT WIRED) -- weekly GSC coverage snapshot.
 *
 * Bucket H+ of the 2026-05-20 GSC coverage improvements plan asked
 * for a weekly snapshot of GSC coverage health. This file is the
 * scaffold for that workflow. It is intentionally not wired into any
 * scheduler/cron/GHA today because the public Google Search Console API
 * does NOT expose aggregate coverage counts (indexed / discovered /
 * crawled-not-indexed / excluded). The Search Console UI's coverage
 * report is rendered from an internal data warehouse that has no
 * public-API equivalent.
 *
 * What the public API *does* expose:
 *   - Search Analytics (queries, pages, clicks, impressions) via
 *     `https://searchconsole.googleapis.com/webmasters/v3/sites/<siteUrl>/searchAnalytics/query`
 *   - URL Inspection for a single URL via
 *     `https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`
 *   - Sitemaps status (last submitted, errors, indexed-URL count by
 *     sitemap) via the `sitemaps` resource
 *
 * Brian's separate daemon work is expected to fill in aggregate
 * counts by either scraping the GSC UI (with the existing Comet /
 * Playwright tooling) or by maintaining a rolling local snapshot via
 * URL Inspection on a sample. When that daemon ships, this scaffold's
 * `getGSCSummary()` becomes its consumer.
 *
 * Usage (when wired):
 *   node tools/gsc-coverage-snapshot.mjs --site=rrmacademy.org \
 *     --out=docs/baselines/gsc-coverage-$(date +%Y-%m-%d).json
 *
 * For now, running the script writes a stub JSON with `status:
 * "scaffold_only"` and the timestamp so consumers can detect the
 * unwired state. Exit code is 0 (no failure -- the scaffold is the
 * deliverable).
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(
  __dirname,
  '..',
  'docs',
  'baselines',
  `gsc-coverage-${new Date().toISOString().slice(0, 10)}.json`,
);

function parseArgs(argv) {
  const args = { site: 'rrmacademy.org', out: DEFAULT_OUT, sitemaps: [] };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--site=')) args.site = a.slice('--site='.length);
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node tools/gsc-coverage-snapshot.mjs [--site=<host>] [--out=<path>]

  --site   GSC property host (default: rrmacademy.org)
  --out    Output JSON path (default: docs/baselines/gsc-coverage-YYYY-MM-DD.json)

Status: SCAFFOLD (not wired). getGSCSummary() is intentionally stubbed
        pending Brian's GSC daemon work. See file header for context.
`);
      process.exit(0);
    }
  }
  return args;
}

/**
 * STUB. Returns the synthetic shape future consumers should expect.
 * Real implementation requires either:
 *  - a UI-scraping daemon that captures the rendered coverage report, OR
 *  - a sampling-based estimate via per-URL `urlInspection/index:inspect`
 *    iterated over a representative URL set
 *
 * Until either ships, this returns `null` so callers can branch on
 * "not yet available".
 */
async function getGSCSummary(_site) {
  return null;
}

/**
 * STUB-ADJACENT. Sitemaps endpoint IS exposed by the public API and
 * would slot in here as the first real source. Kept commented out
 * because it would silently produce a half-shaped snapshot that
 * future consumers might trust as complete.
 *
 * Full impl would:
 *   1. OAuth/ADC token for searchconsole.googleapis.com
 *   2. GET sites/<encoded-site>/sitemaps -> { sitemap[] }
 *   3. For each sitemap: lastSubmitted, errors, contents[].submitted,
 *      contents[].indexed
 *
 * Not implementing today because B's audit already confirmed sitemap
 * health and the daemon will own the longitudinal tracking.
 */
async function getSitemapsSummary(_site) {
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = new Date().toISOString();

  const summary = await getGSCSummary(args.site);
  const sitemaps = await getSitemapsSummary(args.site);

  const snapshot = {
    status: 'scaffold_only',
    note:
      'GSC API does not expose aggregate coverage counts; this scaffold is awaiting the GSC daemon that will provide getGSCSummary(). See file header.',
    site: args.site,
    capturedAt: startedAt,
    summary, // null until daemon wired
    sitemaps, // null until daemon wired
  };

  if (!existsSync(dirname(args.out))) mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`[gsc-coverage-snapshot] scaffold wrote ${args.out}`);
}

main().catch((err) => {
  console.error(`[gsc-coverage-snapshot] fatal: ${err.message}`);
  process.exit(1);
});
