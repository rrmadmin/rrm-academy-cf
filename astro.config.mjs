import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import librarySitemaps from './src/integrations/library-sitemaps.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Library articles: site launched 2026-03-01, all pages published that date.
// Commentary posts: use Airtable Last Modified (individually edited).
// Static pages: omit lastmod entirely.
const LIBRARY_LAUNCH_DATE = '2026-03-01';

function buildDateMap() {
  const map = new Map();

  try {
    const articles = JSON.parse(
      readFileSync(join(__dirname, 'src/data/articles.json'), 'utf-8')
    );
    for (const a of articles) {
      if (a.slug) {
        map.set(`/library/${a.slug}/`, LIBRARY_LAUNCH_DATE);
      }
    }
  } catch {}

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
        ];
        if (exclude.some((path) => page.includes(path))) return false;
        // Library article pages are handled by library-sitemaps integration (tier split)
        // Keep /library/ index page but exclude individual articles
        const url = new URL(page);
        const path = url.pathname;
        if (path.startsWith('/library/') && path !== '/library/') return false;
        return true;
      },
      serialize: (item) => {
        const path = new URL(item.url).pathname;
        const date = dateMap.get(path);
        if (date) {
          item.lastmod = date;
        } else {
          delete item.lastmod;
        }
        return item;
      },
    }),
    librarySitemaps(),
  ],
});
