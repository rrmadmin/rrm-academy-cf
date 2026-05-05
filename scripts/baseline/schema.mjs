#!/usr/bin/env node
// Capture all JSON-LD blocks from key pages
import { writeFileSync } from 'fs';
import { createHash } from 'crypto';

const URLS = [
  '/', '/what-is-rrm/', '/naprotechnology/', '/neofertility/', '/femm/',
  '/common-questions-about-rrm/', '/save-the-uterus-club/',
  '/library/', '/commentary/', '/courses/', '/faqs/', '/glossary/',
  '/policies/editorial', '/policies/fact-checking',
  // Sample dynamic pages
  '/library/whittaker-2024-noa-prevalence/',
  '/commentary/the-rrm-research-library-just-got-better/',
  '/glossary/restorative-reproductive-medicine/',
  '/faqs/what-is-rrm/',
];

const BASE = 'https://rrmacademy.org';
const out = [];

for (const path of URLS) {
  const url = BASE + path;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'arise-baseline/1.0' } });
    const html = await res.text();
    const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    const blocks = [];
    for (const m of matches) {
      const raw = m[1].trim();
      try {
        const j = JSON.parse(raw);
        const types = Array.isArray(j) ? j.map(o => o['@type']).filter(Boolean) : [j['@type']].filter(Boolean);
        const sha = createHash('sha256').update(raw).digest('hex').slice(0, 16);
        blocks.push({ types: types.flat(), sha256: sha, size: raw.length, valid: true });
      } catch (e) {
        blocks.push({ valid: false, error: String(e).slice(0, 100), size: raw.length });
      }
    }
    out.push({ url: path, status: res.status, jsonld_blocks: blocks.length, blocks });
    process.stderr.write(`${path}: ${blocks.length} blocks\n`);
  } catch (e) {
    out.push({ url: path, error: String(e) });
  }
}

writeFileSync(process.argv[2] || '/dev/stdout', JSON.stringify(out, null, 2));
