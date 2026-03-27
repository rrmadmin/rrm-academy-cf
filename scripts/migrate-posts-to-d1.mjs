/**
 * One-time migration: posts.json -> D1 posts table.
 * Run: node scripts/migrate-posts-to-d1.mjs
 *
 * Reads current posts.json (fetched from Airtable) and inserts all records
 * into the D1 posts table with status='published'.
 *
 * Uses wrangler d1 execute under the hood. Requires wrangler CLI.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTS_PATH = join(__dirname, '..', 'src', 'data', 'posts.json');
const DB_NAME = 'rrm-auth';

const posts = JSON.parse(readFileSync(POSTS_PATH, 'utf-8'));
console.log(`Loaded ${posts.length} posts from posts.json`);

// Build SQL statements
const statements = posts.map(p => {
  // Escape single quotes in all text content for SQL
  const esc = (s) => (s || '').replace(/'/g, "''");

  return `INSERT OR REPLACE INTO posts (id, slug, title, content, excerpt, author, content_pillar, cover_image_url, publish_date, status, word_count, seo_keywords, updated_at)
VALUES ('${esc(p.id)}', '${esc(p.slug)}', '${esc(p.title)}', '${esc(p.content)}', '${esc(p.excerpt)}', '${esc(p.author)}', '${esc(p.contentPillar)}', '${esc(p.coverImageUrl)}', '${esc(p.publishDate)}', 'published', ${p.wordCount || 0}, '${esc(p.seoKeywords)}', '${esc(p.lastModified || new Date().toISOString())}');`;
});

const sql = statements.join('\n');
const tmpFile = join(__dirname, '.tmp-migrate-posts.sql');
writeFileSync(tmpFile, sql);

console.log(`Generated ${statements.length} INSERT statements`);
console.log('Executing against remote D1...');

try {
  const result = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB_NAME,
    '--remote',
    `--file=${tmpFile}`,
  ], { stdio: 'pipe', timeout: 60000 });
  console.log(result.toString());
} finally {
  try { unlinkSync(tmpFile); } catch {}
}

console.log('Migration complete. Verify with:');
console.log(`  npx wrangler d1 execute ${DB_NAME} --remote --command "SELECT COUNT(*) as cnt FROM posts WHERE status='published'"`);
