import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import librarySitemaps from './src/integrations/library-sitemaps.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Sitemap lastmod is now sourced from src/data/page-dates.json, which is
// generated pre-build by scripts/generate-page-dates.mjs:
//   - Static pages -> git log last commit date (no manual bump required)
//   - D1-backed content -> updated_at from articles/posts/faqs/glossary/courses
// Fallback date: today, for first-ever builds before the script runs.
const FALLBACK_DATE = new Date().toISOString().slice(0, 10);

function loadPageDates() {
  try {
    const raw = readFileSync(join(__dirname, 'src/data/page-dates.json'), 'utf-8');
    const payload = JSON.parse(raw);
    return new Map(Object.entries(payload.dates || {}));
  } catch {
    return new Map();
  }
}

// /partners/ lastmod overrides page-dates with max(approved_at) across active Friends
// because a Friend status change doesn't touch the partners.astro source file.
function partnersLastmod() {
  try {
    const partners = JSON.parse(
      readFileSync(join(__dirname, 'src/data/partners.json'), 'utf-8')
    );
    const maxApproved = partners.reduce(
      (acc, p) => (p.approved_at && p.approved_at > acc ? p.approved_at : acc),
      ''
    );
    return maxApproved ? maxApproved.split('T')[0] : null;
  } catch {
    return null;
  }
}

const dateMap = loadPageDates();
const partnersDate = partnersLastmod();
if (partnersDate) dateMap.set('/partners/', partnersDate);

export default defineConfig({
  output: 'static',
  site: 'https://rrmacademy.org',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // Inline ALL stylesheets into the HTML. Tried 'auto' on 2026-05-15 to
    // extract the shared design-system CSS for cross-page caching; PSI lab
    // LCP regressed from 1.5s -> 4.4s on simulated slow 4G because the
    // extracted /_astro/*.css became a render-blocking request. Inline keeps
    // CSS off the critical-path waterfall (it ships as part of the HTML
    // response in one round-trip). Real users on fast networks lose the
    // cross-page caching benefit, but the lab-score win is decisive.
    inlineStylesheets: 'always',
  },
  integrations: [
    sitemap({
      filter: (page) => {
        const exclude = [
          '/login',
          '/signup',
          '/forgot-password',
          '/reset-password',
          '/account',
          '/ask',
          '/library/saved',
          '/endo-survey/take',
          '/donate/thank-you',
          '/save-the-uterus-club/thank-you',
          '/404',
          '/topics/',
          '/community/',
          '/linkinbio/jointhecall',
          '/page/',
          '/admin/',
          '/ivf-success-calculator',
          '/dev/',
        ];
        if (exclude.some((path) => page.includes(path))) return false;
        const url = new URL(page);
        const path = url.pathname;
        // Per-collection sitemaps handled by library-sitemaps integration:
        //   pillars, commentary, faqs, courses, policies, library tiers.
        // Keep collection hub pages out too -- they are included in their
        // respective chunk sitemaps.
        const chunkedPillars = [
          '/what-is-rrm/',
          '/naprotechnology/',
          '/neofertility/',
          '/femm/',
          '/common-questions-about-rrm/',
          '/glossary/',
          '/art-registries-and-codes/',
          '/guides/',
        ];
        if (chunkedPillars.includes(path)) return false;
        if (path.startsWith('/commentary/')) return false;
        if (path.startsWith('/faqs/')) return false;
        if (path.startsWith('/courses/')) return false;
        if (path.startsWith('/policies/')) return false;
        if (path.startsWith('/library/') && path !== '/library/') return false;
        // Course lesson steps are noindex — exclude from sitemap
        // Pattern: /courses/[slug]/[stepId]/ (3+ segments under /courses/)
        const segments = path.split('/').filter(Boolean);
        if (segments[0] === 'courses' && segments.length >= 3) return false;
        return true;
      },
      serialize: (item) => {
        const path = new URL(item.url).pathname;
        const date = dateMap.get(path);
        item.lastmod = date || FALLBACK_DATE;
        return item;
      },
    }),
    librarySitemaps(),
  ],
});
