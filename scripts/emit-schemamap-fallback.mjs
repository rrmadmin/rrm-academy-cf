#!/usr/bin/env node
/**
 * CI fallback for schemamap.xml.
 *
 * The full ~/iCode/tools/site-ssot/bin/ssot-schemamap.mjs walks dist/ and
 * inventories every JSON-LD block per page. That tool only exists on Brian's
 * machine, so CI has been skipping schemamap.xml entirely and it 404s in
 * production. This script emits a compact, self-contained substitute: a feed
 * map (not a per-page map) using the same <schemamap> root element and
 * namespace so the two variants are shape-compatible for agents.
 *
 * Writes public/schemamap.xml, and dist/schemamap.xml when dist/ exists
 * (this runs postbuild).
 */

import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SITE_URL = 'https://rrmacademy.org';

const FEEDS = [
  { href: `${SITE_URL}/library-feed.jsonl`, type: 'application/x-ndjson', title: 'Library Feed (NLWeb JSONL, research library)' },
  { href: `${SITE_URL}/library/rss.xml`, type: 'application/atom+xml', title: 'Library Atom Feed' },
  { href: `${SITE_URL}/commentary/rss.xml`, type: 'application/atom+xml', title: 'Commentary Atom Feed' },
  { href: `${SITE_URL}/sitemap-index.xml`, type: 'application/xml', title: 'Sitemap Index' },
  { href: `${SITE_URL}/llms.txt`, type: 'text/plain', title: 'llms.txt' },
];

function xmlEscape(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function emitSchemamapFallback() {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<schemamap xmlns="https://rrmacademy.org/schema/schemamap/1">');
  lines.push(`  <generated_at>${new Date().toISOString()}</generated_at>`);
  lines.push(`  <site_url>${xmlEscape(SITE_URL)}</site_url>`);
  lines.push('  <note>CI fallback -- feed inventory only, not a per-page JSON-LD map. Full tool runs locally.</note>');
  for (const f of FEEDS) {
    lines.push(`  <feed href="${xmlEscape(f.href)}" type="${xmlEscape(f.type)}" title="${xmlEscape(f.title)}"/>`);
  }
  lines.push('</schemamap>');
  return lines.join('\n') + '\n';
}

function main() {
  const xml = emitSchemamapFallback();
  const publicOut = resolve(PROJECT_ROOT, 'public/schemamap.xml');
  writeFileSync(publicOut, xml);
  console.log(`[emit-schemamap-fallback] wrote ${publicOut} (${Buffer.byteLength(xml, 'utf8')} bytes)`);

  const distDir = resolve(PROJECT_ROOT, 'dist');
  if (existsSync(distDir)) {
    const distOut = resolve(distDir, 'schemamap.xml');
    writeFileSync(distOut, xml);
    console.log(`[emit-schemamap-fallback] wrote ${distOut} (${Buffer.byteLength(xml, 'utf8')} bytes)`);
  }
}

main();
