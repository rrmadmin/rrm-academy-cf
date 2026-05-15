#!/usr/bin/env node
// scripts/gates/validate-providers-schema.mjs
// Validates JSON-LD blocks per page type for /providers/* surface.
// Lifecycle: post-build, pre-deploy. Reads dist/providers/**/*.html.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const DIST = 'dist/providers';

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (p.endsWith('.html')) yield p;
  }
}

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch (e) {
      blocks.push({ __invalid__: true, error: e.message });
    }
  }
  return blocks;
}

function pageType(path) {
  // Normalise to forward slashes on all platforms.
  const p = path.replace(/\\/g, '/');
  if (p === 'dist/providers/index.html') return 'hub';
  if (p.startsWith('dist/providers/method/')) return 'method';
  if (p.startsWith('dist/providers/state/')) return 'state';
  if (p === 'dist/providers/telehealth/index.html') return 'telehealth-hub';
  if (p.startsWith('dist/providers/telehealth/')) return 'telehealth-state';
  return 'slug';
}

// Returns true if any JSON-LD block (or node within its @graph) has the given @type.
// Handles both @graph-style blocks (all provider pages) and plain @type blocks.
// A node's @type may itself be a string or an array of strings.
function hasType(blocks, t) {
  for (const block of blocks) {
    if (block.__invalid__) continue;
    // @graph style
    if (Array.isArray(block['@graph'])) {
      for (const node of block['@graph']) {
        const nodeType = node['@type'];
        if (nodeType === t) return true;
        if (Array.isArray(nodeType) && nodeType.includes(t)) return true;
      }
    }
    // Plain @type style
    const topType = block['@type'];
    if (topType === t) return true;
    if (Array.isArray(topType) && topType.includes(t)) return true;
  }
  return false;
}

const errors = [];
let pageCount = 0;

for (const p of walk(DIST)) {
  pageCount++;
  const html = readFileSync(p, 'utf8');
  const blocks = extractJsonLd(html);
  if (blocks.length === 0) {
    errors.push(`${p}: no JSON-LD block`);
    continue;
  }
  const invalid = blocks.filter((b) => b.__invalid__);
  if (invalid.length) {
    errors.push(
      `${p}: ${invalid.length} unparseable JSON-LD block(s): ${invalid[0].error}`
    );
    continue;
  }

  const type = pageType(p);

  const hasBreadcrumb = hasType(blocks, 'BreadcrumbList');
  if (!hasBreadcrumb) errors.push(`${p}: missing BreadcrumbList`);

  if (type === 'slug') {
    const hasPersonOrBusiness =
      hasType(blocks, 'Person') ||
      hasType(blocks, 'MedicalBusiness') ||
      hasType(blocks, 'MedicalOrganization') ||
      hasType(blocks, 'EducationalOrganization');
    if (!hasPersonOrBusiness)
      errors.push(
        `${p}: slug page missing Person|MedicalBusiness|MedicalOrganization|EducationalOrganization`
      );
  }

  if (
    type === 'hub' ||
    type === 'method' ||
    type === 'state' ||
    type === 'telehealth-hub' ||
    type === 'telehealth-state'
  ) {
    const hasItemList = hasType(blocks, 'ItemList');
    if (!hasItemList) errors.push(`${p}: collection page missing ItemList`);
  }
}

if (errors.length === 0) {
  console.log(`OK: ${pageCount} provider pages, all schema valid`);
  process.exit(0);
} else {
  console.error(`FAIL: ${errors.length} schema errors across ${pageCount} pages`);
  for (const e of errors.slice(0, 20)) console.error(`  - ${e}`);
  if (errors.length > 20) console.error(`  ... and ${errors.length - 20} more`);
  process.exit(1);
}
