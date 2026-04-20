#!/usr/bin/env node
/**
 * Generate src/data/page-dates.json from:
 *   1. Git log per Astro source file (for static pages)
 *   2. D1 content JSONs (for dynamic routes: library, commentary, faqs, glossary)
 *
 * One unified lookup. Consumed by BaseLayout, <LastUpdated>, and astro.config
 * sitemap serializer. Replaces the hand-coded STATIC_PAGE_DATE constant.
 *
 * Design choice A:
 *   - datePublished stays manual (frontmatter constant per page) — truly fixed
 *   - dateModified is derived here — every commit refreshes it automatically
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PAGES_DIR = join(REPO_ROOT, 'src/pages');
const DATA_DIR = join(REPO_ROOT, 'src/data');
const OUT_FILE = join(DATA_DIR, 'page-dates.json');

// Fallback when git log is unavailable (shallow clone, file never committed).
// Today's build date. Safer than a stale hardcoded constant.
const TODAY = new Date().toISOString().slice(0, 10);

function log(...args) {
  console.log('[page-dates]', ...args);
}

// Recursively collect *.astro files under src/pages/
function walkAstroFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkAstroFiles(full, acc);
    } else if (entry.endsWith('.astro')) {
      acc.push(full);
    }
  }
  return acc;
}

// Map src/pages/<rel>.astro -> URL pathname (with trailing slash).
// Skip dynamic-route templates ([slug], [...slug], [stepId], [page]).
function astroFileToUrl(filePath) {
  const rel = relative(PAGES_DIR, filePath).replace(/\\/g, '/');
  // Dynamic routes -- per-item URLs come from D1 feeds, not git date
  if (rel.includes('[')) return null;

  // Drop .astro extension
  let url = '/' + rel.replace(/\.astro$/, '');
  // index files become directory URLs
  if (url.endsWith('/index')) url = url.slice(0, -'index'.length);
  // Ensure trailing slash (Astro's `trailingSlash: 'always'`)
  if (!url.endsWith('/')) url = url + '/';
  return url;
}

// Get the last-commit ISO date for a file. Returns YYYY-MM-DD or TODAY.
function gitLastModified(filePath) {
  try {
    const iso = execSync(`git log -1 --format=%cI -- "${filePath}"`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!iso) return TODAY;
    return iso.slice(0, 10);
  } catch {
    return TODAY;
  }
}

// Read a JSON data file. Returns null if missing.
function readDataJson(name) {
  const p = join(DATA_DIR, name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    log(`warn: could not parse ${name}:`, err.message);
    return null;
  }
}

function normalizeDate(value) {
  if (!value) return null;
  // Accept full ISO or YYYY-MM-DD
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function main() {
  const map = {};
  let fromGit = 0;
  let fromD1 = 0;

  // --- Pass 1: every static Astro source file gets its git date ---
  const files = walkAstroFiles(PAGES_DIR);
  for (const file of files) {
    const url = astroFileToUrl(file);
    if (!url) continue;
    const date = gitLastModified(file);
    map[url] = date;
    fromGit++;
  }

  // --- Pass 2: D1-backed content types override with updated_at ---
  // Library articles: /library/<slug>/
  const articles = readDataJson('articles.json');
  if (Array.isArray(articles)) {
    for (const a of articles) {
      if (!a?.slug) continue;
      const date = normalizeDate(a.lastModified) || normalizeDate(a.dateAddedToLibrary);
      if (date) {
        map[`/library/${a.slug}/`] = date;
        fromD1++;
      }
    }
  }

  // Blog posts: /commentary/<slug>/
  const posts = readDataJson('posts.json');
  if (Array.isArray(posts)) {
    for (const p of posts) {
      if (!p?.slug) continue;
      const date =
        normalizeDate(p.lastModified) ||
        normalizeDate(p.updatedAt) ||
        normalizeDate(p.publishDate);
      if (date) {
        map[`/commentary/${p.slug}/`] = date;
        fromD1++;
      }
    }
  }

  // FAQs: /faqs/<slug>/
  const faqs = readDataJson('faqs.json');
  if (Array.isArray(faqs)) {
    for (const f of faqs) {
      if (!f?.slug) continue;
      const date =
        normalizeDate(f.updated_at) ||
        normalizeDate(f.updatedAt) ||
        normalizeDate(f.created_at);
      if (date) {
        map[`/faqs/${f.slug}/`] = date;
        fromD1++;
      }
    }
  }

  // Glossary: whole page reflects max(updated_at) across terms
  const glossary = readDataJson('glossary.json');
  if (glossary?.terms && Array.isArray(glossary.terms)) {
    const latest = glossary.terms
      .map((t) => normalizeDate(t.updated_at) || normalizeDate(t.updatedAt))
      .filter(Boolean)
      .sort()
      .pop();
    if (latest) {
      map['/glossary/'] = latest;
      fromD1++;
    }
  }

  // Courses: /courses/<slug>/ from Airtable lastModified
  const courses = readDataJson('courses.json');
  if (Array.isArray(courses)) {
    for (const c of courses) {
      if (!c?.slug) continue;
      const date =
        normalizeDate(c.lastModified) ||
        normalizeDate(c.updatedAt);
      if (date) {
        map[`/courses/${c.slug}/`] = date;
        fromD1++;
      }
    }
  }

  // --- Write ---
  const payload = {
    generatedAt: new Date().toISOString(),
    count: Object.keys(map).length,
    dates: map,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  log(
    `wrote ${OUT_FILE} (${payload.count} entries: ${fromGit} from git, ${fromD1} from D1)`
  );
}

main();
