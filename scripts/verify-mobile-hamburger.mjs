#!/usr/bin/env node
/**
 * Verify the mobile hamburger menu exists AND is right-aligned.
 *
 * Why: the mobile hamburger was broken before (misaligned / missing).
 * Restoring it was a deliberate fix. This script blocks deploys if the
 * right-alignment rule is ever removed again.
 *
 * Checks:
 *   1. Header.astro declares the hamburger element (#nav-toggle checkbox
 *      + a label/button that contains a `.hamburger` span).
 *   2. The mobile toggle has a right-alignment rule inside a mobile
 *      media query. Accepts any of:
 *         - .mobile-toggle { ... margin-left: auto ... }
 *         - parent flex with justify-content: flex-end
 *         - .mobile-toggle positioned via order/margin-left: auto
 *
 * Runs in CI between design-tokens:audit and build. Fast (<50ms), no
 * browser needed. Full runtime verification lives in the Playwright
 * e2e suite (tests/e2e/mobile-responsive.spec.js).
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEADER_PATH = join(__dirname, '..', 'src/components/Header.astro');

const source = readFileSync(HEADER_PATH, 'utf-8');

const failures = [];

// ---------- Check 1: hamburger element present ----------

if (!/id="nav-toggle"/.test(source)) {
  failures.push('Header.astro is missing the #nav-toggle checkbox (hamburger trigger).');
}
if (!/class="hamburger"/.test(source)) {
  failures.push('Header.astro is missing the .hamburger span (visible hamburger bars).');
}
if (!/class="mobile-toggle"/.test(source) && !/class="[^"]*mobile-toggle/.test(source)) {
  failures.push('Header.astro is missing the .mobile-toggle label (hamburger wrapper).');
}

// ---------- Check 2: right-alignment rule inside mobile breakpoint ----------

// Find every mobile media query body: @media (max-width: NNN) { ... }
const mediaBodies = [];
const mediaRe = /@media\s*\(\s*max-width:\s*(\d+)px\s*\)\s*\{/g;
let mm;
while ((mm = mediaRe.exec(source)) !== null) {
  const breakpoint = parseInt(mm[1], 10);
  // Capture body via balanced brace walk
  let depth = 1;
  const start = mm.index + mm[0].length;
  let end = start;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  mediaBodies.push({ breakpoint, body: source.slice(start, end) });
}

// Look for a right-alignment rule targeting .mobile-toggle, in any mobile
// breakpoint (max-width <= 900px to cover common mobile breakpoints).
let rightAligned = false;
for (const { breakpoint, body } of mediaBodies) {
  if (breakpoint > 900) continue;
  // Find .mobile-toggle { ... } rule body
  const toggleRuleRe = /\.mobile-toggle\s*\{([^}]*)\}/g;
  let tm;
  while ((tm = toggleRuleRe.exec(body)) !== null) {
    const ruleBody = tm[1];
    if (/margin-left:\s*auto/.test(ruleBody)) { rightAligned = true; break; }
    if (/margin-inline-start:\s*auto/.test(ruleBody)) { rightAligned = true; break; }
    if (/\border:\s*-?\d+/.test(ruleBody) && /justify-self:\s*(end|flex-end|right)/.test(ruleBody)) { rightAligned = true; break; }
  }
  if (rightAligned) break;

  // Also accept: parent of .mobile-toggle uses justify-content: flex-end
  // Pattern: any selector containing .mobile-toggle as a descendant + justify-content end.
  // This is rare; we accept it for flexibility.
  if (/justify-content:\s*flex-end/.test(body) && /\.mobile-toggle/.test(body)) {
    rightAligned = true;
    break;
  }
}

if (!rightAligned) {
  failures.push(
    'No right-alignment rule found for .mobile-toggle inside a mobile breakpoint (@media max-width <= 900px). '
    + 'Accepts: margin-left: auto, margin-inline-start: auto, or parent justify-content: flex-end. '
    + 'Restoring the right-aligned hamburger was a deliberate fix -- do not remove it.'
  );
}

// ---------- Report ----------

if (failures.length > 0) {
  console.error('✗ Mobile hamburger check FAILED:\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nFile: src/components/Header.astro');
  process.exit(1);
}

console.log('✓ Mobile hamburger present and right-aligned.');
