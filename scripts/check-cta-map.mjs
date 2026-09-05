#!/usr/bin/env node
// scripts/check-cta-map.mjs
// Lint gate + generated inventory for the closed-vocabulary data-cta
// attribute.
//
//   --mode=source : two cheap checks on .astro under src/ (literal-value
//                    validity, in-file duplicate literals). Never fails on
//                    a missing data-cta. Fast, no build required.
//   --mode=dist    : the ENFORCING gate, over dist/**/*.html. Rules 2, 2b,
//                    3, the cta-required-ids.json coverage check, the
//                    zero-CTA scan, and docs/cta-map.json/.md generation.
//   --check        : (dist mode only) generate to memory and fail with a
//                    clear message if it differs from the committed
//                    docs/cta-map.json/.md, instead of overwriting them.
//                    Used in CI; the local dev command (no --check) writes
//                    the files.
//
// Run via `npm run build` (source mode, pre-astro-build), as a step in
// deploy.yml (dist mode --check, post-astro-build), and as a step in
// merge.yml (source mode only -- merge.yml never builds).
//
// Spec: docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md §4.3

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateCtaId } from './lib/cta-vocabulary.mjs';
import {
  checkLiteralCtaValidity,
  checkComponentDuplicates,
  findDistModeViolations,
  extractCtaOccurrences,
  isChromeCta,
  stripScriptBodies,
} from './lib/cta-map-rules.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const REQUIRED_IDS_PATH = resolve(REPO_ROOT, 'src/data/cta-required-ids.json');
const MAP_JSON_PATH = resolve(REPO_ROOT, 'docs/cta-map.json');
const MAP_MD_PATH = resolve(REPO_ROOT, 'docs/cta-map.md');

function walk(dir, extFilter) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, extFilter));
    else if (extFilter(entry)) out.push(full);
  }
  return out;
}

function loadRequiredIdSet() {
  const raw = JSON.parse(readFileSync(REQUIRED_IDS_PATH, 'utf8'));
  return new Set(raw.ids || []);
}

// ---------------------------------------------------------------- source ---

function runSourceMode() {
  const failures = [];
  const files = walk(resolve(REPO_ROOT, 'src'), (f) => f.endsWith('.astro'));
  if (files.length === 0) {
    console.error('FAIL: zero .astro files found under src/ -- the scan itself is broken');
    process.exit(1);
  }
  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf8');
    const rel = relative(REPO_ROOT, filePath);
    failures.push(...checkLiteralCtaValidity(rel, source));
    failures.push(...checkComponentDuplicates(rel, source));
  }
  if (failures.length > 0) {
    console.error(`FAIL (source mode): ${failures.length} data-cta violation(s):`);
    for (const f of failures) console.error(`  ${f.filePath} id="${f.id}": ${f.reason}`);
    process.exit(1);
  }
  console.log(`PASS (source mode): ${files.length} .astro files scanned, zero literal-value or in-file-duplicate violations`);
}

// ------------------------------------------------------------------ dist ---

// Best-effort dist path -> likely source file, for docs/cta-map.json's
// "sourceGuess" column. This is a heuristic, not a real source map -- the
// build produces no such map today. Unmapped pages (every dynamic [slug]
// route) fall back to 'unknown'; the field is named sourceGuess, not
// source, so no reader mistakes it for authoritative.
function guessSourceFile(pagePath) {
  if (pagePath === '/' || pagePath === '/index.html') return 'src/pages/index.astro';
  const trimmed = pagePath.replace(/^\//, '').replace(/\/?(index\.html)?$/, '');
  if (!trimmed) return 'src/pages/index.astro';
  const candidates = [
    `src/pages/${trimmed}/index.astro`,
    `src/pages/${trimmed}.astro`,
  ];
  for (const c of candidates) {
    if (existsSync(resolve(REPO_ROOT, c))) return c;
  }
  return 'unknown';
}

function normalizeLabel(label) {
  return label.replace(/\s+/g, ' ').trim();
}

function buildDistOutput() {
  const distDir = resolve(REPO_ROOT, 'dist');
  if (!existsSync(distDir)) {
    console.error('FAIL: dist/ does not exist -- dist mode must run AFTER `astro build`');
    process.exit(1);
  }
  const files = walk(distDir, (f) => f.endsWith('.html'));
  const requiredIdSet = loadRequiredIdSet();
  const failures = [];
  const rows = [];
  const seenRequiredIds = new Set();

  for (const filePath of files) {
    const html = readFileSync(filePath, 'utf8');
    const pagePath = '/' + relative(distDir, filePath).replace(/index\.html$/, '').replace(/\.html$/, '');

    failures.push(...findDistModeViolations(pagePath, html, requiredIdSet).map((v) => `${v.pagePath}: ${v.reason}`));

    // Same script-body strip as findDistModeViolations -- these scans must
    // never mistake a JS string literal that LOOKS like a tag for real markup.
    const outerScanHtml = stripScriptBodies(html);
    const occurrences = extractCtaOccurrences(outerScanHtml);
    const seenOnPage = new Map();
    for (const { tag, ctaId, label } of occurrences) {
      const validity = validateCtaId(ctaId);
      if (!validity.ok) {
        failures.push(`${pagePath}: ${validity.reason}`);
        continue;
      }
      if (!isChromeCta(ctaId)) {
        seenOnPage.set(ctaId, (seenOnPage.get(ctaId) || 0) + 1);
        if (seenOnPage.get(ctaId) === 2) failures.push(`${pagePath}: duplicate data-cta "${ctaId}" on one rendered page`);
      }
      rows.push({ page: pagePath, ctaId, label: normalizeLabel(label), elementType: tag, sourceGuess: guessSourceFile(pagePath) });
    }

    // Required-ids coverage: any listed id present as an id attribute AND
    // carrying a valid data-cta on ITS OWN tag counts as covered.
    const idTagRe = /<[a-z][\w-]*\b([^>]*)>/gi;
    let idm;
    while ((idm = idTagRe.exec(outerScanHtml)) !== null) {
      const attrsRaw = idm[1];
      const idMatch = attrsRaw.match(/\sid\s*=\s*["']([^"']+)["']/);
      if (!idMatch || !requiredIdSet.has(idMatch[1])) continue;
      const dataCtaMatch = attrsRaw.match(/\sdata-cta\s*=\s*["']([^"']+)["']/);
      if (dataCtaMatch && validateCtaId(dataCtaMatch[1]).ok) seenRequiredIds.add(idMatch[1]);
    }
  }

  // cta-required-ids.json coverage: every listed id must exist live with a
  // valid data-cta. A listed-but-absent (or untagged) id is a stale
  // allowlist entry, reported with no special-cased suffix on any other
  // violation message.
  for (const requiredId of requiredIdSet) {
    if (!seenRequiredIds.has(requiredId)) {
      failures.push(`cta-required-ids.json: "${requiredId}" is listed but was not found in dist/ carrying a valid data-cta (stale allowlist entry, or the element lost its tag)`);
    }
  }

  // An empty scan is itself a failure (Interfaces contract), but it must
  // never SWALLOW real per-element rule-2/2b failures already collected
  // above -- on an untagged tree, rows is empty precisely because nothing
  // carries data-cta yet, while failures already names every element that
  // should. Push it onto the same failures array instead of a standalone
  // early exit, so runDistMode's normal reporting path prints everything.
  if (rows.length === 0) {
    failures.push('zero data-cta elements found across the entire built site -- the scan itself is broken (or, on an untagged tree, see the violations above)');
  }

  rows.sort((a, b) => a.page.localeCompare(b.page) || a.ctaId.localeCompare(b.ctaId));

  const byPage = new Map();
  for (const r of rows) {
    if (!byPage.has(r.page)) byPage.set(r.page, []);
    byPage.get(r.page).push(r);
  }
  let md = '# CTA Map\n\nGenerated by `scripts/check-cta-map.mjs --mode=dist`. Never hand-edited.\n\n';
  for (const page of [...byPage.keys()].sort()) {
    md += `## ${page}\n\n| CTA id | Element | Label | Source (guessed) |\n|---|---|---|---|\n`;
    for (const r of byPage.get(page)) md += `| \`${r.ctaId}\` | ${r.elementType} | ${r.label || '(no text)'} | \`${r.sourceGuess}\` |\n`;
    md += '\n';
  }

  return { failures, json: JSON.stringify(rows, null, 2) + '\n', md, pageCount: files.length, rowCount: rows.length };
}

function runDistMode({ check }) {
  const { failures, json, md, pageCount, rowCount } = buildDistOutput();
  if (failures.length > 0) {
    console.error(`FAIL (dist mode): ${failures.length} violation(s):`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }

  if (check) {
    const existingJson = existsSync(MAP_JSON_PATH) ? readFileSync(MAP_JSON_PATH, 'utf8') : null;
    const existingMd = existsSync(MAP_MD_PATH) ? readFileSync(MAP_MD_PATH, 'utf8') : null;
    if (existingJson !== json || existingMd !== md) {
      const tmp = mkdtempSync(join(tmpdir(), 'cta-map-check-'));
      writeFileSync(join(tmp, 'cta-map.json'), json);
      writeFileSync(join(tmp, 'cta-map.md'), md);
      console.error('FAIL: docs/cta-map.json/.md are stale against a fresh build.');
      console.error(`  Fresh output written to ${tmp} for inspection.`);
      console.error('  Fix: run `npm run build && node scripts/check-cta-map.mjs --mode=dist` locally and commit the result.');
      rmSync(tmp, { recursive: true, force: true });
      process.exit(1);
    }
    console.log(`PASS (dist mode --check): ${pageCount} pages, ${rowCount} data-cta elements, docs/cta-map.json/.md match a fresh build`);
    return;
  }

  writeFileSync(MAP_JSON_PATH, json);
  writeFileSync(MAP_MD_PATH, md);
  console.log(`PASS (dist mode): ${pageCount} pages, ${rowCount} data-cta elements, docs/cta-map.json + .md written`);
}

function main() {
  const mode = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=source').split('=')[1];
  const check = process.argv.includes('--check');
  if (mode === 'source') runSourceMode();
  else if (mode === 'dist') runDistMode({ check });
  else { console.error(`unknown --mode "${mode}", expected source|dist`); process.exit(1); }
}

main();
