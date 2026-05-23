#!/usr/bin/env node
/**
 * Sync the canonical library article count from src/data/articles.json
 * across all static-override and ssot files that hardcode it.
 *
 * Runs before ssot-prebuild.mjs in the build pipeline so static-overrides
 * are fresh before they get copied to public/.
 *
 * Writes src/data/library-stats.json as a build-time fingerprint for
 * runtime imports if needed.
 *
 * Usage:
 *   node scripts/sync-library-count.mjs          (update all files)
 *   node scripts/sync-library-count.mjs --check  (assert no drift, exit 1 if stale)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHECK_MODE = process.argv.includes('--check');

// 1. Compute canonical count from articles.json
const articlesPath = resolve(ROOT, 'src/data/articles.json');
if (!existsSync(articlesPath)) {
  console.error('[sync-library-count] FATAL: src/data/articles.json not found');
  process.exit(1);
}
const articles = JSON.parse(readFileSync(articlesPath, 'utf8'));
if (!Array.isArray(articles)) {
  console.error('[sync-library-count] FATAL: articles.json is not an array');
  process.exit(1);
}
const count = articles.length;
if (count < 3000 || count >= 10000) {
  console.error(`[sync-library-count] FATAL: article count ${count} is outside expected range [3000, 10000). Possible data loss or corrupt file.`);
  process.exit(1);
}

// Round down to nearest 10 for the display string (e.g. 4034 -> "4,030+")
const displayFloor = Math.floor(count / 10) * 10;
const displayCount = displayFloor.toLocaleString('en-US') + '+';

console.log(`[sync-library-count] Canonical count: ${count} articles → display: "${displayCount}"`);

// 2. Files to update (static-overrides + ssot — NOT public/ directly,
//    since ssot-prebuild.mjs copies static-overrides → public/).
//    For public/ files that are NOT sourced from static-overrides, update them directly.
const STATIC_OVERRIDE_FILES = [
  'static-overrides/llms.txt',
  'static-overrides/llms-full.txt',
  'static-overrides/library-llms.txt',
  // Tracked for drift protection even though they don't currently contain
  // a library-count phrasing — ssot-prebuild.mjs copies them to public/
  // so future edits that add a count phrasing will be caught automatically.
  'static-overrides/courses-llms.txt',
  'static-overrides/faqs-llms.txt',
];

// public/ files that are NOT regenerated from static-overrides (or that
// are copies of static-overrides kept in sync here so pre-commit hooks pass).
// Note: public/llms.txt and public/llms-full.txt are also copied from
// static-overrides/ by ssot-prebuild.mjs at build time. We update both
// the source and the copy so the agent-discovery pre-commit guard passes.
const PUBLIC_FILES = [
  'public/llms.txt',
  'public/llms-full.txt',
  'public/agents.md',
  'public/index.md',
  'public/openapi.json',
  'public/.well-known/agent-card.json',
  'public/.well-known/mcp.json',
  'public/.well-known/mcp/server-card.json',
  'public/.well-known/ai-plugin.json',
  'public/.well-known/agent-skills/index.json',
  'public/.well-known/agent-skills/rrm-research-lookup/SKILL.md',
  'public/pricing.md',
];

// SSOT files
const SSOT_FILES = [
  'ssot/agent-surfaces.json',
  'ssot/site.json',
];

const ALL_TARGET_FILES = [...STATIC_OVERRIDE_FILES, ...PUBLIC_FILES, ...SSOT_FILES];

// Pattern: match "N,NNN+" or "N,NNN" (with mandatory thousands-separator)
// followed by at least one modifier word then a terminal noun.
// Requires a comma-formatted number (e.g. 4,030) plus at least one of the
// listed qualifier words before the terminal noun.
// Handles patterns like:
//   "3,370+ peer-reviewed articles"
//   "3,370+ physician-curated peer-reviewed articles"
//   "3,370+ peer-reviewed academic references"
//   "3,370+ research articles"
//   "3,370+ indexed articles"
// Replacement: canonical displayCount + the original contextual suffix.
const COUNT_PATTERN = /\b\d{1,2},\d{3}\+?((?:\s+(?:physician-curated|scholarly|peer-reviewed|academic|research|indexed))+\s+(?:works|articles|references))\b/gi;

let totalReplacements = 0;
let filesDrifted = [];

// Phase 1 (compute): build list of all needed changes without writing yet.
const updates = [];
for (const rel of ALL_TARGET_FILES) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) {
    console.warn(`[sync-library-count] WARN: target file not found, skipping: ${rel}`);
    continue;
  }
  const original = readFileSync(abs, 'utf8');
  let replacements = 0;
  const updated = original.replace(COUNT_PATTERN, (match, suffix) => {
    replacements++;
    return `${displayCount}${suffix}`;
  });

  if (updated !== original) {
    filesDrifted.push(rel);
    updates.push({ rel, abs, updated, replacements });
    if (CHECK_MODE) {
      console.error(`[sync-library-count] DRIFT: ${rel} contains stale count (expected "${displayCount}")`);
    }
    totalReplacements += replacements;
  }
}

// In CHECK_MODE: also verify library-stats.json freshness.
if (CHECK_MODE) {
  const statsPath = resolve(ROOT, 'src/data/library-stats.json');
  if (existsSync(statsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(statsPath, 'utf8'));
      if (parsed.count !== count) {
        filesDrifted.push('src/data/library-stats.json');
        console.error(`[sync-library-count] DRIFT: src/data/library-stats.json has count=${parsed.count}, expected ${count}. Run: node scripts/sync-library-count.mjs`);
      }
    } catch {
      filesDrifted.push('src/data/library-stats.json');
      console.error(`[sync-library-count] DRIFT: src/data/library-stats.json is unreadable or malformed. Run: node scripts/sync-library-count.mjs`);
    }
  } else {
    filesDrifted.push('src/data/library-stats.json');
    console.error(`[sync-library-count] DRIFT: src/data/library-stats.json not found. Run: node scripts/sync-library-count.mjs`);
  }
}

if (CHECK_MODE) {
  if (filesDrifted.length > 0) {
    console.error(`[sync-library-count] FAIL: ${filesDrifted.length} file(s) have stale counts. Run: node scripts/sync-library-count.mjs`);
    process.exit(1);
  }
  console.log(`[sync-library-count] CHECK PASS: all files show "${displayCount}"`);
  process.exit(0);
}

// Phase 2 (apply): write changes, failing loudly on any write error.
let filesChanged = 0;
for (const { rel, abs, updated, replacements } of updates) {
  try {
    writeFileSync(abs, updated, 'utf8');
    console.log(`[sync-library-count] Updated ${rel} (${replacements} replacement(s))`);
    filesChanged++;
  } catch (err) {
    console.error(`[sync-library-count] FATAL: write failed for ${rel}: ${err.message}`);
    process.exit(1);
  }
}

// 3. Write library-stats.json fingerprint (deterministic — no timestamp).
const statsPath = resolve(ROOT, 'src/data/library-stats.json');
const stats = {
  count,
  displayCount,
  displayFloor,
};
try {
  writeFileSync(statsPath, JSON.stringify(stats, null, 2) + '\n', 'utf8');
  console.log(`[sync-library-count] Wrote src/data/library-stats.json`);
} catch (err) {
  console.error(`[sync-library-count] FATAL: write failed for src/data/library-stats.json: ${err.message}`);
  process.exit(1);
}

// 4. Report
if (filesChanged === 0) {
  console.log(`[sync-library-count] No files needed updating — all already show "${displayCount}"`);
} else {
  console.log(`[sync-library-count] Done: ${filesChanged} file(s) updated, ${totalReplacements} total replacement(s)`);
}
