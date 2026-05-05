#!/usr/bin/env node
/**
 * Build /library-feed.jsonl — a structured-data feed of every published
 * library article as schema.org/MedicalScholarlyArticle, one record per line.
 *
 * Closes orank.ai "NLWeb Schema Feeds" agent-readiness check (1 pt). The feed
 * is the bulk-pull alternative to crawling every /library/<slug>/ HTML page
 * and parsing JSON-LD individually.
 *
 * Source: src/data/articles.json (the build artifact already used by Astro).
 * Output: public/library-feed.jsonl.
 *
 * Wired into npm `build` between fetch-all and astro build. Idempotent:
 * overwrites the output file each run.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';

import { buildMedicalScholarlyArticle } from '../src/lib/schema-builders.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const articlesPath = resolve(PROJECT_ROOT, 'src/data/articles.json');
const outPath = resolve(PROJECT_ROOT, 'public/library-feed.jsonl');

if (!existsSync(articlesPath)) {
  console.warn(`[build-library-feed] WARN: ${articlesPath} not found — skipping`);
  process.exit(0);
}

let articles;
try {
  articles = JSON.parse(readFileSync(articlesPath, 'utf8'));
} catch (err) {
  console.error(`[build-library-feed] FATAL: failed to parse articles.json: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(articles)) {
  console.error(`[build-library-feed] FATAL: articles.json is not an array`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });

const lines = [];
let skipped = 0;
for (const article of articles) {
  if (!article || !article.slug || !article.title) {
    skipped++;
    continue;
  }
  try {
    const node = buildMedicalScholarlyArticle(article);
    lines.push(JSON.stringify(node));
  } catch (err) {
    skipped++;
    console.warn(`[build-library-feed] WARN: skipped ${article.slug}: ${err.message}`);
  }
}

// Write atomically: stage to .tmp then rename.
const tmpPath = outPath + '.tmp';
writeFileSync(tmpPath, lines.join('\n') + '\n');
const { renameSync } = await import('node:fs');
renameSync(tmpPath, outPath);

const sizeKb = Math.round(statSync(outPath).size / 1024);
console.log(
  `[build-library-feed] wrote ${lines.length} records to ${outPath} ` +
    `(${sizeKb} KB${skipped ? `, skipped ${skipped}` : ''})`,
);
