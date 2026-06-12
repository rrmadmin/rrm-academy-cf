// scripts/migrations/2026-06-08-capture-pillar-fields.mjs
// One-shot: scrape pageTitle, pageH1, pageDescription, breadcrumbName, authorId,
// reviewer (optional) from each pillar's current .astro source and add them +
// usesGuideLayout:false to ssot/guides.json. Idempotent: re-running overwrites
// the same fields with the same scraped values. Run ONCE in Phase 0, then archive.
//
// Usage: node scripts/migrations/2026-06-08-capture-pillar-fields.mjs [--check]
//   --check : print what would be captured, do NOT write.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SSOT = join(ROOT, 'ssot', 'guides.json');
const PAGES = join(ROOT, 'src', 'pages');

function splitFrontmatter(src) {
  if (!src.startsWith('---')) return { frontmatter: '', body: src };
  const closing = src.slice(3).match(/\n---(?:\r?\n|$)/);
  if (!closing) return { frontmatter: '', body: src };
  const end = 3 + closing.index;
  return { frontmatter: src.slice(3, end), body: src.slice(end + closing[0].length) };
}
const ENT = { '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&apos;':"'",
  '&nbsp;':' ','&rsaquo;':'>','&lsaquo;':'<','&ndash;':'-','&mdash;':'-','&hellip;':'...',
  '&rsquo;':"'",'&lsquo;':"'",'&rdquo;':'"','&ldquo;':'"' };
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (m) => ENT[m] || ' ');
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

function baseLayoutTag(body) {
  const start = body.indexOf('<BaseLayout');
  if (start === -1) return '';
  let i = start, depth = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '{') depth++; else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return body.slice(start, i + 1);
    i++;
  }
  return '';
}
function attr(tag, name) {
  const dq = tag.match(new RegExp(`\\b${name}="([^"]+)"`));
  if (dq) return decode(dq[1]).trim();
  const sq = tag.match(new RegExp(`\\b${name}='([^']+)'`));
  if (sq) return decode(sq[1]).trim();
  return '';
}
function extractH1(body) {
  const m = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripTags(m[1]) : '';
}
function extractBreadcrumbName(body) {
  // Extract only the breadcrumb nav block to avoid picking up other spans
  const navMatch = body.match(/<nav[^>]*class="breadcrumb"[^>]*>([\s\S]*?)<\/nav>/i);
  if (!navMatch) return '';
  const navContent = navMatch[1];
  // Find all bare <span> elements (no aria-hidden="true") that contain text
  const crumbs = [...navContent.matchAll(/<span(?:\s[^>]*)?>([^<]+)<\/span>/gi)]
    .filter((m) => !m[0].includes('aria-hidden'))
    .map((m) => stripTags(m[1]))
    .filter((t) => t && t !== '›' && t !== '>' && t !== '&rsaquo;');
  return crumbs.length ? crumbs[crumbs.length - 1] : '';
}
function extractAuthor(frontmatter) {
  const authorId = /author:\s*\{[^}]*['"]@id['"]:\s*['"][^'"]*#organization['"]/.test(frontmatter)
    ? '#organization'
    : (/author:\s*\{[^}]*#naomi-whittaker/.test(frontmatter) ? '#naomi-whittaker' : null);
  let reviewer = null;
  const rev = frontmatter.match(/reviewedBy:\s*\{[^}]*['"]@id['"]:\s*['"][^'"]*#([a-z-]+)['"]/);
  if (rev) reviewer = { name: 'Dr. Naomi Whittaker, MD', id: `#${rev[1]}` };
  return { authorId, reviewer };
}
const BYLINE_REVIEWER_OVERRIDE = {
  femm: { name: 'Erin Kay, DO' },
};

const registry = JSON.parse(readFileSync(SSOT, 'utf-8'));
const check = process.argv.includes('--check');
const report = [];
for (const p of registry.guides) {
  const path = join(PAGES, p.file);
  if (!existsSync(path)) { console.error(`MISSING ${p.file}`); process.exit(1); }
  const { frontmatter, body } = splitFrontmatter(readFileSync(path, 'utf-8'));
  const tag = baseLayoutTag(body);
  const pageTitle = attr(tag, 'title');
  const pageDescription = attr(tag, 'description');
  const pageH1 = extractH1(body);
  const breadcrumbName = extractBreadcrumbName(body);
  const { authorId, reviewer: schemaReviewer } = extractAuthor(frontmatter);
  const reviewer = BYLINE_REVIEWER_OVERRIDE[p.slug] || schemaReviewer || undefined;
  if (!pageTitle || !pageDescription || !pageH1 || !breadcrumbName || !authorId) {
    console.error(`CAPTURE GAP ${p.slug}: ` +
      JSON.stringify({ pageTitle, pageDescription, pageH1, breadcrumbName, authorId }));
    process.exit(1);
  }
  p.pageTitle = pageTitle;
  p.pageDescription = pageDescription;
  p.pageH1 = pageH1;
  p.breadcrumbName = breadcrumbName;
  p.authorId = authorId;
  if (reviewer) p.reviewer = reviewer; else delete p.reviewer;
  p.usesGuideLayout = false;
  report.push({ slug: p.slug, pageTitle, pageH1, breadcrumbName, authorId, reviewer: reviewer || null });
}
if (check) {
  console.table(report);
} else {
  writeFileSync(SSOT, JSON.stringify(registry, null, 2) + '\n');
  console.log(`Captured 7 fields for ${registry.guides.length} pillars into ssot/guides.json`);
  console.table(report);
}
