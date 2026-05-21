#!/usr/bin/env node
/**
 * Post-deploy BLOCKING smoke test for course landing pages.
 *
 * Bucket C of the 2026-05-20 GSC coverage improvements plan added a
 * robots.txt rule (`Disallow: /courses/*\/*\/`) to keep crawlers off
 * lesson step URLs. The rule is structured so single-segment landing
 * URLs like /courses/aip-diet-inflammation/ are *exempt* -- but a
 * future regex change in the courses [slug].astro template, a future
 * tweak to the robots pattern, or a stray <meta name="robots"
 * content="noindex"> baked into a partial could silently start
 * deindexing the landings.
 *
 * This smoke asserts, for every published course landing:
 *   (a) HTTP 200
 *   (b) absence of a noindex robots meta in the rendered HTML
 *
 * Source of truth: src/data/courses.json (built artifact of the
 * D1 -> /api/courses pipeline). Skips entries flagged comingSoon
 * because those pages intentionally noindex (mirrors the build-side
 * sitemap filter in src/integrations/library-sitemaps.mjs).
 *
 * Exits 0 on full pass. Exits 1 on any landing missing 200 OR
 * carrying noindex. Wired into deploy.yml as a BLOCKING step so
 * the deploy is treated as failed if a course landing regresses.
 *
 * Run locally:
 *   SITE_URL=https://rrmacademy.org node scripts/smoke-course-landings.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COURSES_PATH = join(__dirname, '..', 'src', 'data', 'courses.json');

const SITE = process.env.SITE_URL || 'https://rrmacademy.org';
const FETCH_TIMEOUT_MS = 8000;

const NOINDEX_RE = /<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex[^"']*["'][^>]*>/i;

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const body = await res.text();
    return { ok: true, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: '', error: err.message };
  } finally {
    clearTimeout(tm);
  }
}

function loadCourseSlugs() {
  let courses;
  try {
    courses = JSON.parse(readFileSync(COURSES_PATH, 'utf-8'));
  } catch (err) {
    console.error(`[smoke-course-landings] cannot read ${COURSES_PATH}: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(courses)) {
    console.error('[smoke-course-landings] courses.json is not an array');
    process.exit(1);
  }
  const slugs = courses
    .filter((c) => c && c.slug && !c.comingSoon)
    .map((c) => c.slug);
  if (slugs.length === 0) {
    console.error('[smoke-course-landings] no course slugs derived from courses.json');
    process.exit(1);
  }
  return slugs;
}

async function checkSlug(slug) {
  const url = `${SITE}/courses/${slug}/`;
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!res.ok) {
    return { slug, url, ok: false, reason: `fetch error: ${res.error || 'unknown'}` };
  }
  if (res.status !== 200) {
    return { slug, url, ok: false, reason: `expected 200 got ${res.status}` };
  }
  if (NOINDEX_RE.test(res.body)) {
    const sample = res.body.match(NOINDEX_RE)[0].slice(0, 120);
    return { slug, url, ok: false, reason: `noindex meta present: ${sample}` };
  }
  return { slug, url, ok: true };
}

async function main() {
  const slugs = loadCourseSlugs();
  console.log(`[smoke-course-landings] checking ${slugs.length} landings against ${SITE}`);
  const failures = [];
  const passes = [];
  for (const slug of slugs) {
    const r = await checkSlug(slug);
    if (r.ok) {
      passes.push(r);
      console.log(`  PASS ${r.url}`);
    } else {
      failures.push(r);
      console.log(`  FAIL ${r.url}  ${r.reason}`);
    }
  }
  console.log(
    `[smoke-course-landings] ${passes.length}/${slugs.length} passed, ${failures.length} failed`
  );
  if (failures.length > 0) {
    console.error('[smoke-course-landings] BLOCKING: at least one course landing regressed');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[smoke-course-landings] fatal: ${err.message}`);
  process.exit(1);
});
