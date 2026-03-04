import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

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
        ];
        return !exclude.some((path) => page.includes(path));
      },
      serialize: (item) => {
        item.lastmod = new Date().toISOString().split('T')[0];
        return item;
      },
    }),
  ],
});
