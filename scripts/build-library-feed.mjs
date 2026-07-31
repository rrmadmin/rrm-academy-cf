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
 *
 * SHAPE: the work is buildLibraryFeed(), which takes its input and output
 * paths as options defaulting to the two constants below. Until 2026-07-31
 * both paths were resolved at module scope and the whole script ran on import,
 * so importing it in a test read the real 32 MB articles.json and rewrote the
 * real public/library-feed.jsonl. The defaults keep the CLI byte-identical;
 * the parameters are what make a fixture run possible.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync, realpathSync } from 'node:fs';

import { buildMedicalScholarlyArticle } from '../src/lib/schema-builders.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

export const DEFAULT_ARTICLES_PATH = resolve(PROJECT_ROOT, 'src/data/articles.json');
export const DEFAULT_OUT_PATH = resolve(PROJECT_ROOT, 'public/library-feed.jsonl');

/**
 * A bad input file: unparseable, or parsed into something that is not an array.
 * Distinguished from any other error so the CLI keeps answering these two with
 * a one-line message and exit 1, and everything else with a stack, exactly as
 * it did when they were `console.error` + `process.exit(1)` at module scope.
 */
export class FeedInputError extends Error {}

/**
 * Writes the JSONL feed.
 *
 * @param {object} [options]
 * @param {string} [options.articlesPath] input JSON array of article records
 * @param {string} [options.outPath] JSONL destination, staged and renamed
 * @param {{warn: Function}} [options.logger] warning sink, console by default
 * @returns {null|{records: number, skipped: number, outPath: string, sizeKb: number}}
 *   null when the input file is absent (nothing to build, not an error)
 * @throws {FeedInputError} when the input is unparseable or is not an array
 */
export function buildLibraryFeed({
  articlesPath = DEFAULT_ARTICLES_PATH,
  outPath = DEFAULT_OUT_PATH,
  logger = console,
} = {}) {
  if (!existsSync(articlesPath)) {
    logger.warn(`[build-library-feed] WARN: ${articlesPath} not found — skipping`);
    return null;
  }

  let articles;
  try {
    articles = JSON.parse(readFileSync(articlesPath, 'utf8'));
  } catch (err) {
    throw new FeedInputError(`[build-library-feed] FATAL: failed to parse articles.json: ${err.message}`);
  }

  if (!Array.isArray(articles)) {
    throw new FeedInputError(`[build-library-feed] FATAL: articles.json is not an array`);
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
      logger.warn(`[build-library-feed] WARN: skipped ${article.slug}: ${err.message}`);
    }
  }

  // Write atomically: stage to .tmp then rename.
  const tmpPath = outPath + '.tmp';
  writeFileSync(tmpPath, lines.join('\n') + '\n');
  renameSync(tmpPath, outPath);

  return {
    records: lines.length,
    skipped,
    outPath,
    sizeKb: Math.round(statSync(outPath).size / 1024),
  };
}

/**
 * CLI entry. `--articles <path>` and `--out <path>` override the defaults;
 * with no arguments this is the build-chain invocation.
 *
 * @returns {number} process exit code
 */
export function main(argv = process.argv.slice(2), logger = console) {
  const options = { logger };
  const articlesIdx = argv.indexOf('--articles');
  if (articlesIdx !== -1) options.articlesPath = resolve(argv[articlesIdx + 1]);
  const outIdx = argv.indexOf('--out');
  if (outIdx !== -1) options.outPath = resolve(argv[outIdx + 1]);

  let result;
  try {
    result = buildLibraryFeed(options);
  } catch (err) {
    if (!(err instanceof FeedInputError)) throw err;
    logger.error(err.message);
    return 1;
  }
  if (result === null) return 0;

  logger.log(
    `[build-library-feed] wrote ${result.records} records to ${result.outPath} ` +
      `(${result.sizeKb} KB${result.skipped ? `, skipped ${result.skipped}` : ''})`,
  );
  return 0;
}

/**
 * True when this file is the process entry point rather than an import.
 * realpath on both sides because macOS resolves /tmp to /private/tmp in
 * import.meta.url but not in argv, which would otherwise make a direct run
 * look like an import.
 */
export function isDirectRun(argv1 = process.argv[1], moduleUrl = import.meta.url) {
  if (!argv1) return false;
  try {
    return realpathSync(resolve(argv1)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exit(main());
}
