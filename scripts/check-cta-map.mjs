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
// docs/cta-map.json/.md are a FAMILY DIGEST -- one row per distinct
// (pageFamily, ctaId), never one row per page, and carrying no counts of
// any kind. Library/blog/course pages are generated at deploy time from D1
// content, so a per-page map (or a page-count column) reshuffles on every
// content publish (measured: 12 MB, one row per page of ~4,650 pages; a
// chrome id's page-count column read the whole site's page total and moved
// on every routine publish too) and would fail `--check` on a deploy that
// touched zero templates. `--check` is therefore a COVERAGE FLOOR, not a
// byte comparison: every (pageFamily, ctaId) key in the committed digest
// must still exist in a fresh build, or the check fails naming the missing
// keys (a template dropped a CTA); a fresh key absent from the committed
// digest only WARNs and exits 0 (content state revealed a template CTA --
// e.g. a closed-cohort modal that only renders for some courses -- commit
// the row at leisure). `label`/`elementType` changes on an existing key are
// not compared -- label text is copy and changes legitimately. The digest
// is small and changes only when a TEMPLATE's CTAs change -- exactly when
// a developer should recommit it. The full per-page map (every occurrence,
// every page) is still produced, as a build artifact at
// `.cta-map/full.json` (repo root, gitignored, regenerated every dist-mode
// run, useful for local debugging, never committed, never part of the
// `--check` comparison, and NEVER written under `dist/` -- that directory
// is deployed to the live site verbatim). The dist-mode PASS line still
// prints the total page and element counts.
//
// Run via `npm run build` (source mode, pre-astro-build), as a step in
// deploy.yml (dist mode --check, post-astro-build), and as a step in
// merge.yml (source mode only -- merge.yml never builds).
//
// Spec: docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md §4.3/§4.4

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateCtaId } from './lib/cta-vocabulary.mjs';
import {
  checkLiteralCtaValidity,
  checkComponentDuplicates,
  findDistModeViolations,
  findRequiredIdCoverage,
  extractCtaOccurrences,
  isChromeCta,
  stripScriptBodies,
  cmpCodepoint,
  compareDigestKeys,
} from './lib/cta-map-rules.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const REQUIRED_IDS_PATH = resolve(REPO_ROOT, 'src/data/cta-required-ids.json');
const DIGEST_JSON_PATH = resolve(REPO_ROOT, 'docs/cta-map.json');
const DIGEST_MD_PATH = resolve(REPO_ROOT, 'docs/cta-map.md');
const FULL_ARTIFACT_JSON_PATH = resolve(REPO_ROOT, '.cta-map/full.json');

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

// Best-effort dist path -> likely source file, for the full artifact's
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
  const outerScanHtmlPages = [];

  for (const filePath of files) {
    const html = readFileSync(filePath, 'utf8');
    const pagePath = '/' + relative(distDir, filePath).replace(/index\.html$/, '').replace(/\.html$/, '');

    failures.push(...findDistModeViolations(pagePath, html, requiredIdSet).map((v) => `${v.pagePath}: ${v.reason}`));

    // Same script-body strip as findDistModeViolations -- these scans must
    // never mistake a JS string literal that LOOKS like a tag for real markup.
    const outerScanHtml = stripScriptBodies(html);
    outerScanHtmlPages.push(outerScanHtml);
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
  }

  failures.push(...findRequiredIdCoverage(outerScanHtmlPages, requiredIdSet));

  // An empty scan is itself a failure (Interfaces contract), but it must
  // never SWALLOW real per-element rule-2/2b failures already collected
  // above -- on an untagged tree, rows is empty precisely because nothing
  // carries data-cta yet, while failures already names every element that
  // should. Push it onto the same failures array instead of a standalone
  // early exit, so runDistMode's normal reporting path prints everything.
  if (rows.length === 0) {
    failures.push('zero data-cta elements found across the entire built site -- the scan itself is broken (or, on an untagged tree, see the violations above)');
  }

  rows.sort((a, b) => cmpCodepoint(a.page, b.page) || cmpCodepoint(a.ctaId, b.ctaId));

  return { failures, rows, pageCount: files.length };
}

/**
 * One row per distinct (pageFamily, ctaId) -- pageFamily is the ctaId's own
 * page token, i.e. the route family, not the individual rendered page path.
 * `label` and `elementType` come from the FIRST occurrence encountered in
 * `rows`, which are already sorted by (page, ctaId) at this point (see the
 * `rows.sort(...)` call in `buildDistOutput`, above), so the "first"
 * occurrence for a given key is deterministic across runs.
 *
 * Deliberately carries NO page-count field: a chrome id (header/footer/
 * nav-mobile) renders on every page, so its count would be the site's total
 * page count -- which moves on every routine library/blog/course publish
 * and would turn `--check` red on a deploy that touched zero templates. The
 * digest's whole reason for existing is to change only when a TEMPLATE's
 * CTAs change; a count derived from content volume defeats that. Per-page
 * counts, when useful for local debugging, are still derivable from the
 * full per-page artifact (`.cta-map/full.json`).
 */
function buildFamilyDigest(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const pageFamily = r.ctaId.split('.')[0];
    const key = `${pageFamily} ${r.ctaId}`;
    if (!byKey.has(key)) {
      byKey.set(key, { pageFamily, ctaId: r.ctaId, elementType: r.elementType, label: r.label });
    }
  }
  const digestRows = [...byKey.values()];
  digestRows.sort((a, b) => cmpCodepoint(a.pageFamily, b.pageFamily) || cmpCodepoint(a.ctaId, b.ctaId));
  return digestRows;
}

function renderDigestMd(digestRows) {
  let md = '# CTA Map (family digest)\n\n';
  md += 'Generated by `scripts/check-cta-map.mjs --mode=dist`. Never hand-edited.\n\n';
  md += 'One row per distinct (page family, CTA id) -- not one row per rendered page. ';
  md += 'The full per-page map is a build artifact at `.cta-map/full.json` (repo root, gitignored, not committed).\n\n';
  const byFamily = new Map();
  for (const r of digestRows) {
    if (!byFamily.has(r.pageFamily)) byFamily.set(r.pageFamily, []);
    byFamily.get(r.pageFamily).push(r);
  }
  const families = [...byFamily.keys()].sort(cmpCodepoint);
  for (const family of families) {
    md += `## ${family}\n\n| CTA id | Element | Label |\n|---|---|---|\n`;
    for (const r of byFamily.get(family)) {
      md += `| \`${r.ctaId}\` | ${r.elementType} | ${r.label || '(no text)'} |\n`;
    }
    md += '\n';
  }
  return md;
}

function runDistMode({ check }) {
  const { failures, rows, pageCount } = buildDistOutput();
  if (failures.length > 0) {
    console.error(`FAIL (dist mode): ${failures.length} violation(s):`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }

  // The full per-page artifact is always written on a clean run -- it is
  // NOT part of the --check comparison and lives OUTSIDE dist/ (repo root
  // `.cta-map/`, gitignored, regenerated every run, purely for local
  // debugging of a specific page). dist/ is uploaded to the live site
  // verbatim, so nothing meant to stay internal is written under it.
  mkdirSync(dirname(FULL_ARTIFACT_JSON_PATH), { recursive: true });
  writeFileSync(FULL_ARTIFACT_JSON_PATH, JSON.stringify(rows, null, 2) + '\n');

  const digestRows = buildFamilyDigest(rows);
  const digestJson = JSON.stringify(digestRows, null, 2) + '\n';
  const digestMd = renderDigestMd(digestRows);

  if (check) {
    // A COVERAGE FLOOR, not byte equality: content state (which pages
    // happen to be published/rendered right now) legitimately adds or
    // removes non-chrome rows without any template changing, so a byte
    // diff would redden this gate on every routine library/blog/course
    // publish. Only a MISSING committed key -- a template dropped a CTA --
    // fails the gate; an EXTRA fresh key only warns.
    const existingJson = existsSync(DIGEST_JSON_PATH) ? readFileSync(DIGEST_JSON_PATH, 'utf8') : null;
    const committedRows = existingJson ? JSON.parse(existingJson) : [];
    const { missing, extra } = compareDigestKeys(committedRows, digestRows);

    if (missing.length > 0) {
      const tmp = mkdtempSync(join(tmpdir(), 'cta-map-check-'));
      const tmpJsonPath = join(tmp, 'cta-map.json');
      const tmpMdPath = join(tmp, 'cta-map.md');
      writeFileSync(tmpJsonPath, digestJson);
      writeFileSync(tmpMdPath, digestMd);
      console.error(`FAIL: ${missing.length} CTA(s) in the committed docs/cta-map.json are missing from a fresh build:`);
      for (const key of missing) console.error(`  ${key}`);
      console.error('');
      console.error(`  A template dropped a CTA. Fresh output kept at ${tmp} for inspection (not deleted).`);
      console.error('  If this is a deliberate change, run `npm run build && node scripts/check-cta-map.mjs --mode=dist` locally and commit the result.');
      process.exit(1);
    }

    if (extra.length > 0) {
      console.warn(`WARN: ${extra.length} CTA(s) in a fresh build are not yet in the committed docs/cta-map.json (content state revealed a template CTA -- e.g. a closed-cohort modal that only renders for some courses):`);
      for (const key of extra) console.warn(`  ${key}`);
      console.warn('  Recommit at leisure: `npm run build && node scripts/check-cta-map.mjs --mode=dist`.');
    }

    console.log(`PASS (dist mode --check): ${pageCount} pages, ${rows.length} data-cta elements, ${digestRows.length}-row family digest covers every committed CTA${extra.length ? ` (${extra.length} new key(s), see WARN above)` : ''}`);
    return;
  }

  writeFileSync(DIGEST_JSON_PATH, digestJson);
  writeFileSync(DIGEST_MD_PATH, digestMd);
  console.log(`PASS (dist mode): ${pageCount} pages, ${rows.length} data-cta elements, ${digestRows.length}-row family digest written to docs/cta-map.json + .md (full per-page map at .cta-map/full.json)`);
}

function main() {
  const mode = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=source').split('=')[1];
  const check = process.argv.includes('--check');
  if (mode === 'source') runSourceMode();
  else if (mode === 'dist') runDistMode({ check });
  else { console.error(`unknown --mode "${mode}", expected source|dist`); process.exit(1); }
}

main();
