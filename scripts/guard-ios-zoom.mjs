#!/usr/bin/env node

// Guard against iOS Safari auto-zoom on form focus.
// iOS Safari zooms any focused <input>, <textarea>, or <select> whose
// computed font-size is below 16px. Scans .astro <style> blocks and .css
// files, flags sub-16px font-size on text-entry form controls.
// Exit 1 if any violation found. Run via `npm run guard:ios-zoom`.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { exit } from 'node:process';
import postcss from 'postcss';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SRC = join(ROOT, 'src');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// input types that don't render a text field, so sub-16px is fine
const NON_TEXT_TYPES = new Set([
  'checkbox', 'radio', 'file', 'range', 'color',
  'button', 'submit', 'reset', 'image', 'hidden',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(astro|css)$/.test(entry)) out.push(full);
  }
  return out;
}

function extractStyleBlocks(src, filePath) {
  if (filePath.endsWith('.css')) return [{ css: src, offsetLine: 1 }];
  // Extract <style>...</style> from .astro files, preserving 1-based line offsets
  const blocks = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const before = src.slice(0, m.index + m[0].indexOf(m[1]));
    const offsetLine = before.split('\n').length;
    blocks.push({ css: m[1], offsetLine });
  }
  return blocks;
}

// Parse a CSS font-size value to px. Returns null if unknown/unsupported unit.
function fontSizeToPx(value) {
  const v = value.trim().toLowerCase();
  // var() or calc() → skip (can't resolve without runtime)
  if (/^var\(|^calc\(/.test(v)) return null;
  const m = v.match(/^(-?\d*\.?\d+)(px|rem|em|pt|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] || 'px';
  if (unit === 'px') return n;
  if (unit === 'rem') return n * 16;        // assume root 16px
  if (unit === 'em') return n * 16;         // approximate; parent context unknown
  if (unit === 'pt') return n * (96 / 72);
  if (unit === '%') return (n / 100) * 16;
  return null;
}

// Does the selector target a text-entry form control?
// Returns true for bare `textarea`, `select`, or `input` not filtered to a non-text type.
function targetsTextInput(selector) {
  const parts = selector.split(',').map((p) => p.trim());
  for (const part of parts) {
    // Tokenize on descendant/child combinators to inspect each compound selector
    const compounds = part.split(/\s+|>|\+|~/).filter(Boolean);
    for (const c of compounds) {
      // Match tag name at start (textarea, input, select)
      const tagMatch = c.match(/^(textarea|input|select)\b/);
      if (!tagMatch) continue;
      const tag = tagMatch[1];
      if (tag === 'textarea' || tag === 'select') return true;
      // input: check [type="..."] — if specified and non-text, skip
      const typeMatch = c.match(/\[type=["']?([a-z-]+)["']?\]/);
      if (!typeMatch) return true;                       // bare `input` → text-capable
      if (!NON_TEXT_TYPES.has(typeMatch[1])) return true;
    }
  }
  return false;
}

const violations = [];

for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  const blocks = extractStyleBlocks(src, file);
  for (const block of blocks) {
    let root;
    try {
      root = postcss.parse(block.css);
    } catch {
      continue; // skip unparseable blocks
    }
    root.walkRules((rule) => {
      if (!targetsTextInput(rule.selector)) return;
      rule.walkDecls('font-size', (decl) => {
        const px = fontSizeToPx(decl.value);
        if (px === null) return;
        if (px >= 16) return;
        const ruleLine = block.offsetLine + (decl.source?.start?.line ?? 1) - 1;
        violations.push({
          file: relative(ROOT, file),
          line: ruleLine,
          selector: rule.selector.replace(/\s+/g, ' ').trim(),
          value: decl.value,
          px,
        });
      });
    });
  }
}

if (violations.length === 0) {
  console.log(`${GREEN}✓${RESET} No sub-16px font-size on text-entry form controls.`);
  exit(0);
}

console.log(`${RED}${BOLD}iOS auto-zoom guard: ${violations.length} violation(s)${RESET}`);
console.log(`${YELLOW}iOS Safari zooms any focused input/textarea/select with font-size < 16px.${RESET}\n`);
for (const v of violations) {
  console.log(`  ${v.file}:${v.line}`);
  console.log(`    selector: ${v.selector}`);
  console.log(`    font-size: ${v.value} (${v.px}px) ${RED}<16px${RESET}`);
  console.log('');
}
console.log(`${BOLD}Fix:${RESET} bump each to 1rem (16px) or larger. Desktop will not notice a 1px change.`);
exit(1);
