import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function recId() {
  const bytes = randomBytes(14);
  let s = 'rec';
  for (const b of bytes) s += ALPHA[b % ALPHA.length];
  return s;
}

const content = await readFile('drafts/pakiz-post-content.md', 'utf8');
const id = recId();

const row = {
  id,
  slug: 'rrm-physician-spotlight-kristina-pakiz-md',
  title: 'RRM Physician Spotlight: Kristina Pakiz, MD',
  content,
  excerpt: 'For women battling chronic pelvic pain, endometriosis, and infertility, Dr. Kristina Pakiz, FACOG, CFCMC, offers hope through advanced minimally invasive surgery and the restorative principles of NaProTechnology.',
  author: 'RRM Academy',
  content_pillar: 'Personal/Practice',
  cover_image_url: '/images/commentary/rrm-physician-spotlight-kristina-pakiz-md.webp',
  publish_date: '2026-04-24',
  status: 'published',
  word_count: 1606,
  seo_keywords: 'kristina pakiz, rrm physician, napro, omaha, vivify fertility, endometriosis, minimally invasive gynecologic surgery, restorative reproductive medicine, MIGS, laser excision',
};

const sqlFile = '/tmp/pakiz-insert.sql';
const esc = v => String(v).replace(/'/g, "''");
const sql = `INSERT INTO posts (id, slug, title, content, excerpt, author, content_pillar, cover_image_url, publish_date, status, word_count, seo_keywords, created_at, updated_at) VALUES ('${esc(row.id)}', '${esc(row.slug)}', '${esc(row.title)}', '${esc(row.content)}', '${esc(row.excerpt)}', '${esc(row.author)}', '${esc(row.content_pillar)}', '${esc(row.cover_image_url)}', '${esc(row.publish_date)}', '${esc(row.status)}', ${row.word_count}, '${esc(row.seo_keywords)}', datetime('now'), datetime('now'));`;

await writeFile(sqlFile, sql);

const accountId = 'ecf2c5bc8b5ebd634bcb587b3890910a';
const token = execFileSync('op', ['read', 'op://Automation/Cloudflare API Token - Claude Code Full Access/credential'], { encoding: 'utf8' }).trim();

const result = execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'rrm-auth', '--remote', '--file', sqlFile],
  { env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token }, encoding: 'utf8' }
);

console.log(result.split('\n').slice(-15).join('\n'));
console.log(`inserted: ${id}`);
