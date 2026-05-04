#!/usr/bin/env node
/**
 * Reports bridge pages with fewer than min_inbound_links inbound links from src/.
 * Non-blocking: exit 0 even if warnings fire. The warnings show up loudly in CI logs.
 *
 * Usage:
 *   node scripts/check-bridge-links.mjs
 *
 * Options for tests:
 *   --registry <path>  default: docs/personas/bridge-pages.json
 *   --src-dir  <path>  default: src/
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const registryPath = resolve(arg('--registry', 'docs/personas/bridge-pages.json'));
const srcDir = resolve(arg('--src-dir', 'src'));

const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function countInboundLinks(targetUrl) {
  let count = 0;
  const escaped = targetUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`href=["']${escaped}["']`, 'g');
  for (const file of walk(srcDir)) {
    if (!/\.(astro|tsx?|jsx?|html|md|mdx)$/.test(file)) continue;
    const content = readFileSync(file, 'utf-8');
    const matches = content.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

let warned = 0;
for (const page of registry.pages || []) {
  const min = page.min_inbound_links ?? 1;
  const found = countInboundLinks(page.url);
  if (found < min) {
    console.warn(`WARNING: bridge page ${page.url} has ${found} inbound link(s) (minimum: ${min})`);
    warned++;
  } else {
    console.log(`ok: ${page.url} has ${found} inbound link(s)`);
  }
}

if (warned > 0) {
  console.warn(`check-bridge-links: ${warned} bridge page(s) below minimum (warnings only, non-blocking)`);
}
process.exit(0);
