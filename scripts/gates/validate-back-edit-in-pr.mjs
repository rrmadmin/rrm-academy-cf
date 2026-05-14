#!/usr/bin/env node
import { execSync } from 'node:child_process';

const PILLAR_SLUGS = ['getting-started', 'for-providers'];

export function checkBackEditInPr(changedFiles, shippedSlugs) {
  // Find which new pillars are added by this PR (in PILLAR_SLUGS but not yet shipped)
  const newPillars = changedFiles
    .filter(f => f.startsWith('src/pages/') && f.endsWith('/index.astro'))
    .map(f => f.replace('src/pages/', '').replace('/index.astro', ''))
    .filter(slug => PILLAR_SLUGS.includes(slug))
    .filter(slug => !shippedSlugs.includes(slug));

  if (newPillars.length === 0) return { ok: true }; // no-op when no new pillar added

  // For each new pillar, every already-shipped sibling MUST be in changedFiles
  for (const newSlug of newPillars) {
    for (const shippedSlug of shippedSlugs) {
      const expected = `src/pages/${shippedSlug}/index.astro`;
      if (!changedFiles.includes(expected)) {
        return {
          ok: false,
          error: `PR adds ${newSlug} but missing back-edit to ${shippedSlug} (expected file in diff: ${expected})`,
        };
      }
    }
  }

  return { ok: true };
}

function gitChangedFilesAgainstMain() {
  const out = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean);
}

function shippedSlugsFromMain() {
  // "Shipped" = present in main branch's ssot/pillars.json AND in PILLAR_SLUGS allowlist
  const out = execSync('git show origin/main:ssot/pillars.json', { encoding: 'utf8' });
  const ssot = JSON.parse(out);
  return ssot.pillars
    .map(p => p.slug)
    .filter(slug => PILLAR_SLUGS.includes(slug));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let changedFiles, shippedSlugs;
  try {
    changedFiles = gitChangedFilesAgainstMain();
    shippedSlugs = shippedSlugsFromMain();
  } catch (err) {
    console.error('FAIL (git error):', err.message);
    process.exit(2);
  }
  const result = checkBackEditInPr(changedFiles, shippedSlugs);
  if (result.ok) {
    console.log(`OK: back-edit lockdown satisfied (new pillars: ${changedFiles.filter(f => /^src\/pages\/[^\/]+\/index\.astro$/.test(f) && PILLAR_SLUGS.includes(f.split('/')[2])).join(', ') || 'none'})`);
    process.exit(0);
  } else {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }
}
