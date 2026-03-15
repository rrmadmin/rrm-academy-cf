import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import librarySitemaps from './src/integrations/library-sitemaps.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Commentary posts: use Airtable Last Modified (individually edited).
// Static pages: use a fixed "last reviewed" date.
// Library articles: handled by library-sitemaps integration (not in sitemap-0).
const STATIC_PAGE_DATE = '2026-03-10';

function buildDateMap() {
  const map = new Map();

  // Static pages -- update this date when content is meaningfully revised
  const staticPages = [
    '/', '/about/', '/courses/', '/faqs/', '/donate/',
    '/library/', '/commentary/', '/contact/', '/endo-survey/',
    '/save-the-uterus-club/', '/terms-of-use/', '/privacy-policy/',
    '/medical-disclaimer/',
  ];
  for (const p of staticPages) {
    map.set(p, STATIC_PAGE_DATE);
  }

  try {
    const posts = JSON.parse(
      readFileSync(join(__dirname, 'src/data/posts.json'), 'utf-8')
    );
    for (const p of posts) {
      if (!p.slug) continue;
      const date = p.publishDate || p.lastModified;
      if (date) {
        map.set(`/commentary/${p.slug}/`, date.split('T')[0]);
      }
    }
  } catch {}

  return map;
}

const dateMap = buildDateMap();

export default defineConfig({
  output: 'static',
  site: 'https://rrmacademy.org',
  trailingSlash: 'always',
  build: {
    format: 'directory',
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
          '/library/saved',
          '/endo-survey/take',
          '/donate/thank-you',
          '/save-the-uterus-club/thank-you',
          '/404',
          '/topics/',
          '/community/',
          '/linkinbio/jointhecall',
          '/page/',
          '/what-is-rrm',
          '/common-questions-about-rrm',
          '/admin/',
          '/tools/',
        ];
        if (exclude.some((path) => page.includes(path))) return false;
        // Library article pages are handled by library-sitemaps integration (tier split)
        // Keep /library/ index page but exclude individual articles
        const url = new URL(page);
        const path = url.pathname;
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
        // Pages with a specific date use it; everything else gets the static review date
        item.lastmod = date || STATIC_PAGE_DATE;
        return item;
      },
    }),
    librarySitemaps(),
  ],
});
