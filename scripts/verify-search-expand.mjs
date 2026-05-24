#!/usr/bin/env node
/**
 * Verify the mobile search-expand (button -> search bar) animation invariants.
 *
 * Why: this animation took ~10 iterations to get right, and it's been broken by
 * subtle edits more than once (most recently by adding `view-transition-name` to
 * the drawer, which silently killed the search FLIP). This guard pins the
 * load-bearing invariants so an innocent-looking change can't regress it without
 * failing the build. Each invariant maps to a real bug from
 * ~/iCode/skills/bar-expand/references/gotchas.md.
 *
 * Static (grep-based), <50ms, no browser. Runs in CI between verify-hamburger and
 * build. Runtime coverage lives in tests/e2e (against prod, post-deploy).
 *
 * Bypass an intentional redesign: update this file in the same commit.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODAL = join(__dirname, '..', 'src/components/MobileSearchModal.astro');
const HEADER = join(__dirname, '..', 'src/components/Header.astro');

const modal = readFileSync(MODAL, 'utf-8');
const header = readFileSync(HEADER, 'utf-8');
const failures = [];

// ── 1. No `view-transition-name` on the search/drawer surfaces ──────────────
// The mobile search uses a manual WAAPI FLIP, NOT the View Transitions API.
// A `view-transition-name` on .mss-modal__field, .mss-modal__sheet, or .main-nav
// re-introduces the VT path that (a) couldn't morph the box geometry, (b) left a
// stretched-ghost crossfade, and (c) glitched the theme toggle's clip-path over the
// fixed drawer. Adding one to .main-nav is what last broke the search FLIP.
// (document.startViewTransition for the theme toggle is fine — it names no element.)
if (/view-transition-name/.test(modal)) {
  failures.push(
    'MobileSearchModal.astro contains `view-transition-name`. The mobile search is a '
    + 'WAAPI FLIP, not a View Transition — a transition name here regresses it. Remove it.'
  );
}
if (/view-transition-name/.test(header)) {
  failures.push(
    'Header.astro contains `view-transition-name`. Naming the drawer/nav for a View '
    + 'Transition broke the search FLIP before. Remove it (the theme toggle uses '
    + 'startViewTransition on the root, which names no element).'
  );
}

// ── 2. The FLIP animates real WIDTH (never transform: scale) ────────────────
// Scale distorts the icon/text/border horizontally. The keyframes must drive width.
if (!/width:\s*t\.width/.test(modal) || !/width:\s*f\.width/.test(modal)) {
  failures.push(
    'The search FLIP keyframes must animate width (`width: t.width` -> `width: f.width`). '
    + 'If you switched to transform:scale, the bar contents distort — revert to width.'
  );
}

// ── 3. Held animations are cancelled before measuring ───────────────────────
// fill:'both' makes a finished close keep holding the field at button width, so the
// next open measures the wrong box and animates nowhere ("instant 2nd open"). The
// flip must cancel existing animations before getBoundingClientRect.
if (!/getAnimations\(\)\.forEach/.test(modal) || !/\.cancel\(\)/.test(modal)) {
  failures.push(
    'The search FLIP must cancel in-flight/held animations before measuring '
    + '(`getAnimations().forEach(a => a.cancel())`). Without it the 2nd open is instant.'
  );
}

// ── 4. The field has a FIXED height in the mobile block ─────────────────────
// Measuring/animating height makes the first open taller (web font not loaded yet).
// The field must declare an explicit height so it's identical every open.
if (!/\.mss-modal__field\s*\{[^}]*height:\s*\d/.test(modal)) {
  failures.push(
    'The mobile .mss-modal__field must declare a fixed `height` (font-independent). '
    + 'Without it the first open renders taller than later opens.'
  );
}

// ── 5. Opening over an open drawer defers until the drawer slides out ───────
// Otherwise the modal covers the drawer mid-slide and it looks like it vanished.
if (!/wasDrawerOpen/.test(modal)) {
  failures.push(
    'openModal must detect an open drawer (`wasDrawerOpen`) and defer the search open '
    + 'until the drawer slides out, else the drawer appears to vanish instantly.'
  );
}

// ── Report ──────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error('✗ Mobile search-expand check FAILED:\n');
  for (const f of failures) console.error('  - ' + f);
  console.error('\nFiles: src/components/MobileSearchModal.astro, src/components/Header.astro');
  console.error('Background: ~/iCode/skills/bar-expand/references/gotchas.md');
  process.exit(1);
}

console.log('✓ Mobile search-expand invariants intact (FLIP width, cancel-before-measure, fixed height, drawer-defer, no view-transition-name).');
