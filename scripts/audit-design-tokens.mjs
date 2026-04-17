#!/usr/bin/env node
/**
 * Site-wide design token audit.
 *
 * Scans every `var(--X)` reference in src/ and functions/ and verifies each
 * token is either:
 *   1. Defined in the SSOT (docs/design/design-system.json), OR
 *   2. Defined somewhere in the codebase (a page-scoped or component-scoped
 *      CSS custom property), OR
 *   3. In the explicit allowlist below (for short SVG/animation locals
 *      that don't follow the naming convention).
 *
 * Reports:
 *   - PHANTOM: used but never defined. FAIL (this catches bugs like the
 *     --color-primary / --color-surface mistakes that fall back silently
 *     to browser defaults).
 *   - ORPHAN:  defined in SSOT but never used. WARN (useful for cleanup,
 *     does not fail the build).
 *
 * Usage: node scripts/audit-design-tokens.mjs [--strict] [--json]
 *   --strict  Also fail on orphans (default: warn)
 *   --json    Emit JSON report instead of human-readable
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SSOT_PATH = join(ROOT, 'docs/design/design-system.json');
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

// Directories to scan
const SCAN_DIRS = ['src', 'functions'];

// File extensions to scan
const EXTENSIONS = new Set(['.astro', '.css', '.js', '.mjs', '.ts', '.tsx', '.jsx']);

// Explicit allowlist -- short locals used in SVG/animation code that are
// legitimately scoped to a single element. Add to this list only for vars
// that cannot be renamed to follow the design-system naming convention.
const ALLOWLIST = new Set([
  // SVG / animation one-letter locals
  'f', 'fh', 'fw', 'r', 'x', 'y', 'cx', 'cy',
  'size', 'stagger',
  // Third-party / external (Pagefind, etc.)
  'pagefind-ui-primary',
  'pagefind-ui-text',
  'pagefind-ui-background',
  'pagefind-ui-border',
  'pagefind-ui-tag',
  'pagefind-ui-border-width',
  'pagefind-ui-border-radius',
  'pagefind-ui-image-border-radius',
  'pagefind-ui-image-box-ratio',
  'pagefind-ui-font',
  'pagefind-ui-scale',
]);

// ---------- File walk ----------

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXTENSIONS.has(p.slice(p.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

const files = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);

// ---------- Extract SSOT token set ----------

const ssot = JSON.parse(readFileSync(SSOT_PATH, 'utf-8'));
const ssotTokens = new Set();
function collectTokens(obj) {
  if (!obj || typeof obj !== 'object') return;
  if ('cssVariable' in obj && typeof obj.cssVariable === 'string') {
    ssotTokens.add(obj.cssVariable.replace(/^--/, ''));
    return;
  }
  for (const k of Object.keys(obj)) collectTokens(obj[k]);
}
collectTokens(ssot);

// ---------- Scan files ----------

// token name -> array of { file, line }
const references = new Map();
// token name -> array of { file, line }
const definitions = new Map();

const REF_RE = /var\(\s*--([a-zA-Z0-9_-]+)/g;
const DEF_RE = /--([a-zA-Z0-9_-]+)\s*:/g;

for (const file of files) {
  const text = readFileSync(file, 'utf-8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(line)) !== null) {
      const name = m[1];
      if (!references.has(name)) references.set(name, []);
      references.get(name).push({ file: relative(ROOT, file), line: i + 1 });
    }
    DEF_RE.lastIndex = 0;
    while ((m = DEF_RE.exec(line)) !== null) {
      const name = m[1];
      if (!definitions.has(name)) definitions.set(name, []);
      definitions.get(name).push({ file: relative(ROOT, file), line: i + 1 });
    }
  }
}

// ---------- Classify ----------

const phantoms = [];  // referenced, not in SSOT, not locally defined, not allowlisted
const orphans = [];   // in SSOT, never referenced anywhere

for (const [name, refs] of references) {
  const inSsot = ssotTokens.has(name);
  const inLocal = definitions.has(name);
  const inAllowlist = ALLOWLIST.has(name);
  if (!inSsot && !inLocal && !inAllowlist) {
    phantoms.push({ token: name, references: refs });
  }
}

for (const name of ssotTokens) {
  if (!references.has(name)) orphans.push(name);
}

phantoms.sort((a, b) => a.token.localeCompare(b.token));
orphans.sort();

// ---------- Report ----------

if (JSON_OUT) {
  console.log(JSON.stringify({
    scanned_files: files.length,
    ssot_tokens: ssotTokens.size,
    referenced_tokens: references.size,
    phantoms,
    orphans,
    strict: STRICT,
  }, null, 2));
} else {
  console.log(`Scanned ${files.length} files across ${SCAN_DIRS.join(', ')}`);
  console.log(`SSOT tokens: ${ssotTokens.size}`);
  console.log(`Referenced tokens: ${references.size}`);
  console.log();

  if (phantoms.length === 0) {
    console.log('\u2713 No phantom tokens.');
  } else {
    console.log(`\u2717 ${phantoms.length} phantom token(s) (referenced but never defined):`);
    for (const p of phantoms) {
      console.log(`\n  --${p.token}`);
      const shown = p.references.slice(0, 3);
      for (const ref of shown) {
        console.log(`      ${ref.file}:${ref.line}`);
      }
      if (p.references.length > 3) {
        console.log(`      ... and ${p.references.length - 3} more`);
      }
    }
  }

  console.log();
  if (orphans.length === 0) {
    console.log('\u2713 No orphan tokens.');
  } else {
    console.log(`\u26A0 ${orphans.length} orphan token(s) (defined in SSOT but never used):`);
    for (const o of orphans) console.log(`    --${o}`);
  }
}

// ---------- Exit ----------

const failed = phantoms.length > 0 || (STRICT && orphans.length > 0);
if (failed) process.exit(1);
