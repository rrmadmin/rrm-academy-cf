#!/usr/bin/env node
/**
 * Post-deploy render quality check. Hits ~20 live URLs after deploy and
 * runs sanitizer rules against extracted prose. Non-blocking.
 *
 * Targets <90s wall time. No LLM calls -- deterministic only.
 *
 * Sample:
 *   /, 4 pillar pages, 5 most recent commentary posts, 5 most recent library
 *   articles, 3 FAQs (rotated by GITHUB_SHA), /glossary/, 2 courses.
 *
 * Output: qa-post-summary.json (consumed by Observatory webhook).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sanitizeMarkdown } from '../src/lib/markdown-sanitize.mjs';
import { sanitizeHtml, looksDirty } from '../src/lib/html-sanitize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');
const OUT_PATH = join(__dirname, '..', 'qa-post-summary.json');

const SITE = process.env.SITE_URL || 'https://rrmacademy.org';
const SHA = (process.env.GITHUB_SHA || 'local').slice(0, 8);
const FETCH_TIMEOUT_MS = 8000;

const PILLARS = ['/naprotechnology/', '/what-is-rrm/', '/common-questions-about-rrm', '/femm/'];
const STATIC = ['/', '/glossary/', ...PILLARS];

function readJson(file) {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function pickRecent(arr, dateKey, n) {
  if (!Array.isArray(arr)) return [];
  return [...arr]
    .filter((r) => r && r[dateKey])
    .sort((a, b) => String(b[dateKey]).localeCompare(String(a[dateKey])))
    .slice(0, n);
}

function pickRotated(arr, n, seed) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  const start = Math.abs(h) % arr.length;
  const out = [];
  for (let i = 0; i < n && i < arr.length; i++) {
    out.push(arr[(start + i) % arr.length]);
  }
  return out;
}

function buildSampleUrls() {
  const posts = readJson('posts.json') || [];
  const articles = readJson('articles.json') || [];
  const faqs = readJson('faqs.json') || [];
  const courses = readJson('courses.json') || [];

  const urls = [];
  for (const path of STATIC) urls.push({ url: SITE + path, kind: 'static' });

  for (const p of pickRecent(posts, 'publishDate', 5)) {
    if (p.slug) urls.push({ url: `${SITE}/commentary/${p.slug}/`, kind: 'commentary', id: p.id });
  }
  for (const a of pickRecent(articles, 'year', 5)) {
    if (a.slug) urls.push({ url: `${SITE}/library/${a.slug}/`, kind: 'library', id: a.id });
  }
  for (const f of pickRotated(faqs, 3, SHA)) {
    if (f.slug) urls.push({ url: `${SITE}/faqs/${f.slug}/`, kind: 'faq', id: f.id });
  }
  for (const c of (courses.slice(0, 2))) {
    if (c.slug) urls.push({ url: `${SITE}/courses/${c.slug}/`, kind: 'course', id: c.id });
  }
  return urls;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: '', error: err.message };
  } finally {
    clearTimeout(tm);
  }
}

// Extract prose from data-pagefind-body content. Strip script/style. Keep
// inner text + minimal markup so sanitizer rules can spot orphan markers.
function extractProse(html) {
  if (!html) return '';
  // Grab everything inside data-pagefind-body if present, else fall back to <main>.
  const bodyMatch = html.match(/<[^>]+data-pagefind-body[^>]*>([\s\S]*?)<\/[^>]+>\s*(?=<[^>]+data-pagefind-body|<\/body>|$)/i);
  let region = bodyMatch ? bodyMatch[1] : '';
  if (!region) {
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    region = mainMatch ? mainMatch[1] : html;
  }
  // Strip script/style/svg.
  region = region
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
  return region;
}

const ORPHAN_BOLD = /(?:^|[^*])\*\*[^*\n]{0,80}$/m;
// Require URL-shaped target so `[Hilgers 2004](study description)` doesn't false-positive.
const RAW_MD_LINK = /\[[^\]]{1,80}\]\((?:https?:\/\/|\/)[^)\s]{1,200}\)/;
const MISSING_SPACE_LINK = /\w<a\b/i;
const DOUBLE_AMP = /&amp;amp;/;
const ENCODED_NBSP_IN_ATTR = /&amp;nbsp;/;
const EMPTY_PARA = /<p>\s*(?:&nbsp;|<br\s*\/?>)?\s*<\/p>/i;

function checkProse(prose) {
  const defects = [];
  // Orphan ** count must be even per line; this is a rough heuristic over the whole region.
  const starGroups = (prose.match(/(?<!\*)\*\*(?!\*)/g) || []).length;
  if (starGroups % 2 === 1) {
    defects.push({ type: 'orphan-bold', severity: 'medium' });
  }
  if (ORPHAN_BOLD.test(prose) && !/<strong>/.test(prose)) {
    // weak signal -- only escalate if we also did not see <strong> rendered
    // (suggests Marked did not consume the marker). Skip if also passed the parity check above.
  }
  if (RAW_MD_LINK.test(prose)) {
    defects.push({ type: 'raw-markdown-link', severity: 'high', sample: prose.match(RAW_MD_LINK)[0].slice(0, 80) });
  }
  if (MISSING_SPACE_LINK.test(prose)) {
    defects.push({ type: 'missing-space-before-link', severity: 'low' });
  }
  if (DOUBLE_AMP.test(prose)) {
    defects.push({ type: 'double-encoded-amp', severity: 'medium' });
  }
  if (ENCODED_NBSP_IN_ATTR.test(prose)) {
    defects.push({ type: 'encoded-nbsp', severity: 'low' });
  }
  if (EMPTY_PARA.test(prose)) {
    defects.push({ type: 'empty-paragraph', severity: 'low' });
  }
  if (looksDirty(prose)) {
    defects.push({ type: 'dirty-html', severity: 'low' });
  }
  return defects;
}

async function main() {
  const t0 = Date.now();
  const urls = buildSampleUrls();
  console.log(`[qa-post] checking ${urls.length} urls against ${SITE}`);

  const results = [];
  // Sequential fetch keeps total deterministic and avoids hammering CF.
  for (const u of urls) {
    const t1 = Date.now();
    const r = await fetchWithTimeout(u.url, FETCH_TIMEOUT_MS);
    const ms = Date.now() - t1;
    if (!r.ok) {
      results.push({ ...u, status: r.status, ms, error: r.error || 'http error' });
      continue;
    }
    const prose = extractProse(r.body);
    const defects = checkProse(prose);
    results.push({ ...u, status: 200, ms, defectCount: defects.length, defects });
  }

  const totalMs = Date.now() - t0;
  const totalDefects = results.reduce((s, r) => s + (r.defectCount || 0), 0);
  const errorCount = results.filter((r) => r.error).length;

  const summary = {
    ranAt: new Date().toISOString(),
    site: SITE,
    sha: SHA,
    totalMs,
    urlCount: urls.length,
    errorCount,
    totalDefects,
    results,
  };

  writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`[qa-post] ${urls.length} urls, ${totalDefects} defects, ${errorCount} fetch errors, ${totalMs}ms`);
}

main().catch((err) => {
  console.warn(`[qa-post] error: ${err.message}`);
  writeFileSync(OUT_PATH, JSON.stringify({ ranAt: new Date().toISOString(), error: err.message }, null, 2));
  process.exit(0);
});
