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

const RECENT_IN_SNAPSHOT = 8;

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0;
}

export function toSnapshot(progress, supporters) {
  const s = supporters && typeof supporters === 'object' ? supporters : {};
  const recent = Array.isArray(s.recent)
    ? s.recent
        .filter((r) => r && typeof r.displayName === 'string' && r.displayName.trim())
        .slice(0, RECENT_IN_SNAPSHOT)
        .map((r) => ({ displayName: r.displayName, seq: n(r.seq) }))
    : [];
  const cap = Math.max(1, n(s.founding_cap) || 100);
  return {
    raised_cents: n(progress && progress.raised_cents),
    supporters: n(progress && progress.supporters),
    recent,
    total_gifts: n(s.total_gifts),
    founding_left: Number.isFinite(Number(s.founding_left)) ? n(s.founding_left) : cap,
    founding_closed: s.founding_closed === true,
  };
}

async function getJson(path) {
  const res = await fetch(`${ORIGIN}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

async function main() {
  const key = process.argv[2] || 'provider-directory';
  let progress;
  try {
    progress = await getJson('/api/fund-progress');
  } catch (err) {
    console.error(`[update-campaign-snapshot] ${err.message}; snapshot left unchanged.`);
    process.exit(1);
  }
  // Supporters is best-effort: a failure here must not block the raised total.
  let supporters = null;
  try {
    supporters = await getJson('/api/fund-supporters');
  } catch (err) {
    console.error(`[update-campaign-snapshot] fund-supporters unavailable (${err.message}); founding/recent left empty.`);
  }
  const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  snap[key] = toSnapshot(progress, supporters);
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n', 'utf8');
  console.log(`[update-campaign-snapshot] ${key}: ${JSON.stringify(snap[key])}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
