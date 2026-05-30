#!/usr/bin/env node
/**
 * validate-share-button.mjs — Deterministic proof-gate runner for the
 * library article share button (src/components/ArticleHero.astro +
 * src/pages/library/[...slug].astro).
 *
 * Born 2026-05-30 after a bug where the share button was wired to clipboard-
 * only (missing navigator.share), had no .catch() on the writeText promise
 * (silent failure on permission denial), and the "Copied!" label was
 * permanently hidden by CSS with no .copied state override.
 *
 * Usage:
 *   node scripts/gates/validate-share-button.mjs          # all gates
 *   node scripts/gates/validate-share-button.mjs --gate SB1
 *   node scripts/gates/validate-share-button.mjs --json
 *
 * Exit codes:
 *   0  all gates pass
 *   1  at least one gate failed
 *   2  gate runner itself errored
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

const GREEN  = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m',  RESET = '\x1b[0m', DIM = '\x1b[2m';

const SLUG_PAGE    = 'src/pages/library/[...slug].astro';
const HERO_COMP    = 'src/components/ArticleHero.astro';

const argv      = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const gateIdx   = argv.indexOf('--gate');
const ONLY_GATE = gateIdx >= 0 ? argv[gateIdx + 1] : null;

const gateResults  = [];
let totalFailures  = 0;

const pass = (msg) => ({ ok: true,  msg });
const fail = (msg) => ({ ok: false, msg });
const warn = (msg) => ({ ok: null,  msg });

const read = (rel) => {
  const full = join(PROJECT_ROOT, rel);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8');
};

// ---------------------------------------------------------------------------
// Extract just the share IIFE block from [..slug].astro so our patterns don't
// accidentally match unrelated code elsewhere in the file.
// ---------------------------------------------------------------------------
function extractShareIIFE(src) {
  // Find the start comment / IIFE that handles the share button
  const start = src.indexOf('// Share button');
  if (start === -1) return null;
  // Grab the next ~80 lines worth of text (the IIFE is < 60 lines)
  return src.slice(start, start + 3000);
}

// ---------------------------------------------------------------------------
// Gate runner
// ---------------------------------------------------------------------------
function runGate(id, label, fn) {
  if (ONLY_GATE && ONLY_GATE !== id) return;
  let result;
  try {
    result = fn();
  } catch (err) {
    result = fail(`Gate runner threw: ${err.message}`);
  }
  if (result.ok === false) totalFailures++;
  gateResults.push({ id, label, ...result });
}

// ---------------------------------------------------------------------------
// SB1 — navigator.share is the primary branch in the share IIFE
//
// Prevents: regressing to clipboard-only wiring where the share API is never
// invoked, breaking mobile share sheet on iOS/Android.
// ---------------------------------------------------------------------------
runGate('SB1', 'navigator.share is primary branch in share IIFE', () => {
  const src = read(SLUG_PAGE);
  if (!src) return fail(`${SLUG_PAGE} not found`);
  const iife = extractShareIIFE(src);
  if (!iife) return fail('Share IIFE block not found (missing "// Share button" comment)');

  if (!iife.includes('navigator.share')) {
    return fail('navigator.share check absent — share button is clipboard-only');
  }
  // The navigator.share check must come BEFORE any writeText call in the IIFE
  const sharePos  = iife.indexOf('navigator.share');
  const writePos  = iife.indexOf('writeText');
  if (writePos !== -1 && writePos < sharePos) {
    return fail('writeText appears before navigator.share check — clipboard is primary, not share API');
  }
  return pass('navigator.share is the primary branch');
});

// ---------------------------------------------------------------------------
// SB2 — .catch() is chained onto the writeText promise
//
// Prevents: silent failure when clipboard permission is denied. Without .catch,
// the fallback execCommand block never runs and the user sees nothing happen.
// ---------------------------------------------------------------------------
runGate('SB2', '.catch() chained on navigator.clipboard.writeText()', () => {
  const src = read(SLUG_PAGE);
  if (!src) return fail(`${SLUG_PAGE} not found`);
  const iife = extractShareIIFE(src);
  if (!iife) return fail('Share IIFE block not found');

  if (!iife.includes('writeText')) {
    // No clipboard path at all is fine (native-share-only); skip
    return pass('No writeText call — clipboard path not present (OK if native-share-only)');
  }

  // Look for .then(...).catch( or .catch( somewhere after writeText within the IIFE
  const writeIdx = iife.indexOf('writeText');
  const afterWrite = iife.slice(writeIdx);
  if (!afterWrite.includes('.catch(')) {
    return fail('writeText() has no .catch() — clipboard permission denial silently swallowed');
  }
  // Verify .catch comes reasonably close after .then (within same logical block, ~300 chars)
  const thenIdx  = afterWrite.indexOf('.then(');
  const catchIdx = afterWrite.indexOf('.catch(');
  if (thenIdx !== -1 && catchIdx !== -1 && catchIdx > thenIdx + 300) {
    return warn('.catch() found but is far from .then() — verify it is chained on the writeText promise');
  }
  return pass('.catch() is chained on writeText promise');
});

// ---------------------------------------------------------------------------
// SB3 — #share-btn aria-label is "Share", not "Copy link"
//
// Prevents: confusing screen-reader users by calling a share button "Copy link".
// ---------------------------------------------------------------------------
runGate('SB3', '#share-btn aria-label is "Share"', () => {
  const src = read(HERO_COMP);
  if (!src) return fail(`${HERO_COMP} not found`);

  // Find the share button declaration
  const btnMatch = src.match(/id="share-btn"[^>]*aria-label="([^"]+)"/);
  const altMatch = src.match(/aria-label="([^"]+)"[^>]*id="share-btn"/);
  const m = btnMatch || altMatch;
  if (!m) return fail('#share-btn button not found in ArticleHero.astro');

  const label = m[1];
  if (label.toLowerCase() === 'copy link') {
    return fail(`aria-label is "${label}" — should be "Share"`);
  }
  if (label.toLowerCase() !== 'share') {
    return warn(`aria-label is "${label}" — expected "Share"`);
  }
  return pass(`aria-label="${label}"`);
});

// ---------------------------------------------------------------------------
// SB4 — .action-label is visible in .copied state (not permanently hidden)
//
// Prevents: "Copied!" feedback text being permanently display:none with no
// override in the .copied state, making the clipboard fallback UX invisible.
// ---------------------------------------------------------------------------
runGate('SB4', '.action-label is visible when .icon-action.copied', () => {
  const src = read(HERO_COMP);
  if (!src) return fail(`${HERO_COMP} not found`);

  // Must have a rule that enables .action-label under .copied context
  // Acceptable patterns: ".icon-action.copied .action-label" with display: inline/block/flex
  const copiedLabelRule = /\.icon-action\.copied\s+\.action-label\s*\{[^}]*display\s*:\s*(inline|block|flex|inline-flex|inline-block)[^}]*\}/s;
  if (!copiedLabelRule.test(src)) {
    // Also check shorthand: ".copied .action-label { display: ... }"
    const shorthand = /\.copied\s+\.action-label\s*\{[^}]*display\s*:\s*(inline|block|flex|inline-flex|inline-block)[^}]*\}/s;
    if (!shorthand.test(src)) {
      return fail('.action-label has no display override in .copied state — "Copied!" text permanently hidden');
    }
  }
  return pass('.action-label is shown in .icon-action.copied state');
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (JSON_MODE) {
  console.log(JSON.stringify({ gates: gateResults, failures: totalFailures }, null, 2));
} else {
  console.log(`\n${BOLD}Share Button Gates${RESET}`);
  for (const r of gateResults) {
    const icon  = r.ok === true ? `${GREEN}✓${RESET}` : r.ok === null ? `${YELLOW}⚠${RESET}` : `${RED}✗${RESET}`;
    const color = r.ok === true ? GREEN : r.ok === null ? YELLOW : RED;
    console.log(`  ${icon} ${color}${r.id}${RESET} ${DIM}${r.label}${RESET}`);
    if (r.ok !== true) console.log(`       ${r.msg}`);
  }
  if (gateResults.length === 0) {
    console.log(`  ${DIM}(no gates matched)${RESET}`);
  }
  const total = gateResults.length;
  const passed = gateResults.filter(r => r.ok === true).length;
  console.log(`\n  ${passed}/${total} passed${totalFailures > 0 ? ` — ${RED}${BOLD}${totalFailures} failed${RESET}` : ''}\n`);
}

process.exit(totalFailures > 0 ? 1 : 0);
