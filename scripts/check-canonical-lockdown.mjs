#!/usr/bin/env node
// scripts/check-canonical-lockdown.mjs
// Enforces ALLOWED_PARAMS allowlist on /library/* and /commentary/* query params.
// Spec: §Routing and SEO / Canonical lockdown.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED_PARAMS = new Set([
  'topic', 'page', 'q', 'sort',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'gclid', 'fbclid', 'mc_cid', 'mc_eid'
]);
const SCAN_DIRS = ['src/pages/library', 'src/pages/commentary', 'src/components'];
const FORBIDDEN_PATTERNS = [
  /\?(view|shell|app|app_layout|application|layout|chrome|theme|density|mode)=/g
];

let failures = [];

function scanFile(path) {
  const raw = readFileSync(path, 'utf8');
  const content = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');

  for (const pattern of FORBIDDEN_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const m of matches) {
      const lineStart = content.lastIndexOf('\n', m.index);
      const lineEnd = content.indexOf('\n', m.index);
      const line = content.slice(lineStart + 1, lineEnd === -1 ? content.length : lineEnd);
      failures.push({ path, line: line.trim(), match: m[0] });
    }
  }
  const paramReads = content.matchAll(/(?:searchParams|params)\.get\(\s*['"]([\w-]+)['"]\s*\)/g);
  for (const m of paramReads) {
    const param = m[1];
    if (!ALLOWED_PARAMS.has(param.toLowerCase()) && (path.includes('/library/') || path.includes('/commentary/'))) {
      failures.push({ path, line: m[0], match: `non-allowlisted param: ${param}` });
    }
  }
}

function walk(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath);
    else if (/\.(astro|js|jsx|ts|tsx|mjs)$/.test(entry)) scanFile(fullPath);
  }
}

let scanned = 0;
const skipped = [];
for (const dir of SCAN_DIRS) {
  try {
    walk(dir);
    scanned++;
  } catch (e) {
    skipped.push(`${dir}: ${e.code || e.message}`);
  }
}
if (skipped.length > 0) {
  console.warn(`⚠️ Canonical lockdown skipped ${skipped.length} dir(s): ${skipped.join('; ')}`);
}
if (scanned === 0) {
  console.error('❌ Canonical lockdown found no dirs to scan; check SCAN_DIRS config.');
  process.exit(1);
}

if (failures.length > 0) {
  console.error('❌ Canonical lockdown failed. Forbidden query params found:');
  failures.forEach(f => console.error(`  ${f.path}: ${f.match}\n    ${f.line}`));
  console.error(`\nALLOWED_PARAMS: ${[...ALLOWED_PARAMS].join(', ')}`);
  console.error('Add new params explicitly to ALLOWED_PARAMS and get reviewer sign-off.');
  process.exit(1);
}

console.log(`✅ Canonical lockdown: ${scanned}/${SCAN_DIRS.length} dirs scanned, no forbidden params.`);
process.exit(0);
