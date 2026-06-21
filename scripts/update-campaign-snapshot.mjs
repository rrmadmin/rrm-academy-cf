/**
 * Refreshes src/data/campaign-snapshot.json from the LIVE /api/fund-progress.
 * Run locally or on a cron, then commit + deploy. NOT in the CI build chain:
 * CI has no STRIPE_SECRET_KEY, and the homepage band must never per-visitor-fetch
 * the rate-limited endpoint (spec §3.1/§3.2). The live endpoint is the source of truth.
 *
 * Usage: node scripts/update-campaign-snapshot.mjs [campaign_key=provider-directory]
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, '..', 'src', 'data', 'campaign-snapshot.json');
const ORIGIN = process.env.SNAPSHOT_ORIGIN || 'https://rrmacademy.org';

export function toSnapshot(progress) {
  const raised = Number(progress && progress.raised_cents);
  const supporters = Number(progress && progress.supporters);
  return {
    raised_cents: Number.isFinite(raised) ? Math.max(0, Math.round(raised)) : 0,
    supporters: Number.isFinite(supporters) ? Math.max(0, Math.round(supporters)) : 0,
  };
}

async function main() {
  const key = process.argv[2] || 'provider-directory';
  const res = await fetch(`${ORIGIN}/api/fund-progress`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    console.error(`[update-campaign-snapshot] /api/fund-progress returned ${res.status}; snapshot left unchanged.`);
    process.exit(1);
  }
  const progress = await res.json();
  const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  snap[key] = toSnapshot(progress);
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n', 'utf8');
  console.log(`[update-campaign-snapshot] ${key}: ${JSON.stringify(snap[key])}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
