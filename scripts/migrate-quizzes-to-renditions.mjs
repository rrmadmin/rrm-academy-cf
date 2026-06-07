#!/usr/bin/env node
/**
 * 8.2.4a: migrate src/data/quizzes.json entries into step_rendition rows.
 * Idempotent: ON CONFLICT(step_id,'quiz') DO UPDATE. Writes status='draft'
 * by default; pass --publish to set status='published' (run only AFTER
 * validate-quiz-parity.mjs passes, per spec 8.2.4c).
 *
 * Usage:
 *   node scripts/migrate-quizzes-to-renditions.mjs            # draft rows
 *   node scripts/migrate-quizzes-to-renditions.mjs --publish  # flip to published
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = process.env.WRANGLER_BIN || 'wrangler'; // global binary; auth via CLOUDFLARE_API_TOKEN env (never npx)
const PUBLISH = process.argv.includes('--publish');
const quizzes = JSON.parse(readFileSync(resolve(ROOT, 'src/data/quizzes.json'), 'utf-8'));

function sqlString(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

for (const [stepId, entry] of Object.entries(quizzes)) {
  const contentJson = JSON.stringify(entry);
  if (contentJson.length > 32000) {
    console.error(`FATAL: ${stepId} content_json is ${contentJson.length} bytes (cap 32000)`);
    process.exit(1);
  }
  const status = PUBLISH ? 'published' : 'draft';
  const sql =
    `INSERT INTO step_rendition (step_id, format, content_json, status, source, created_at, updated_at) ` +
    `VALUES (${sqlString(stepId)}, 'quiz', ${sqlString(contentJson)}, '${status}', 'migrated:quizzes.json', datetime('now'), datetime('now')) ` +
    `ON CONFLICT(step_id, format) DO UPDATE SET content_json = excluded.content_json, status = '${status}', ` +
    `source = 'migrated:quizzes.json', updated_at = datetime('now');`;
  execFileSync(WRANGLER, ['d1', 'execute', 'rrm-auth', '--remote', `--command=${sql}`], {
    stdio: 'inherit', cwd: ROOT, timeout: 60000,
  });
  console.log(`${stepId}: upserted quiz rendition (status=${status})`);
}
console.log(`Done: ${Object.keys(quizzes).length} quiz renditions ${PUBLISH ? 'PUBLISHED' : 'in draft'}.`);
