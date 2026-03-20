/**
 * Custom Astro integration: Library Tier Sitemaps
 *
 * Generates separate sitemaps for library articles by enrichment tier:
 *   - sitemap-library-t3.xml  (abstract + journal + citation = richest content)
 *   - sitemap-library-t2.xml  (partial enrichment, no abstract)
 *
 * Appends these to sitemap-index.xml so Google crawls tier 3 first.
 * Library pages are excluded from @astrojs/sitemap via the filter in astro.config.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SITE = 'https://rrmacademy.org';

function classifyTier(article) {
  const hasAbstract = article.abstract && article.abstract.trim().length > 50;
  const hasJournal = article.journal && article.journal.trim().length > 0;
  const hasCitation = article.apaCitation && article.apaCitation.trim().length > 0;
  if (hasAbstract && hasJournal && hasCitation) return 3;
  return 2;
}

function buildSitemapXml(urls) {
  const entries = urls.map(u => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;
}

export default function librarySitemaps() {
  return {
    name: 'library-sitemaps',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const outDir = dir.pathname;

        // Read articles data
        let articles;
        try {
          articles = JSON.parse(
            readFileSync(join(outDir, '..', 'src', 'data', 'articles.json'), 'utf-8')
          );
        } catch {
          // Fallback: try from project root
          try {
            articles = JSON.parse(
              readFileSync(join(process.cwd(), 'src', 'data', 'articles.json'), 'utf-8')
            );
          } catch (e) {
            console.warn('[library-sitemaps] Could not read articles.json:', e.message);
            return;
          }
        }

        // Split by tier
        const tier3 = [];
        const tier2 = [];
        for (const a of articles) {
          if (!a.slug) continue;
          // dateAddedToLibrary = Airtable createdTime (when record entered yellowbase).
          // Currently uniform (2026-03-12 bulk sync) but will diverge as new
          // articles are added. Falls back to lastModified, then omits.
          const rawDate = a.dateAddedToLibrary || a.lastModified;
          const lastmod = rawDate ? rawDate.split('T')[0] : undefined;
          const url = {
            loc: `${SITE}/library/${a.slug}/`,
            lastmod,
          };
          if (classifyTier(a) === 3) {
            tier3.push(url);
          } else {
            tier2.push(url);
          }
        }

        // Write tier sitemaps
        const t3Path = join(outDir, 'sitemap-library-t3.xml');
        const t2Path = join(outDir, 'sitemap-library-t2.xml');
        writeFileSync(t3Path, buildSitemapXml(tier3));
        writeFileSync(t2Path, buildSitemapXml(tier2));

        console.log(`[library-sitemaps] Tier 3: ${tier3.length} articles -> sitemap-library-t3.xml`);
        console.log(`[library-sitemaps] Tier 2: ${tier2.length} articles -> sitemap-library-t2.xml`);

        // Update sitemap-index.xml to include library sitemaps
        const indexPath = join(outDir, 'sitemap-index.xml');
        try {
          let indexXml = readFileSync(indexPath, 'utf-8');

          // Insert library tier sitemaps BEFORE sitemap-0 so Google crawls
          // richest library content first, then pages/commentary, then tier 2.
          // Include lastmod on each <sitemap> entry using today's build date.
          const buildDate = new Date().toISOString().split('T')[0];
          const t3Entry = `  <sitemap>\n    <loc>${SITE}/sitemap-library-t3.xml</loc>\n    <lastmod>${buildDate}</lastmod>\n  </sitemap>`;
          const t2Entry = `  <sitemap>\n    <loc>${SITE}/sitemap-library-t2.xml</loc>\n    <lastmod>${buildDate}</lastmod>\n  </sitemap>`;
          indexXml = indexXml.replace(
            /<sitemap><loc>[^<]*sitemap-0\.xml<\/loc><\/sitemap>/,
            `${t3Entry}\n  <sitemap>\n    <loc>${SITE}/sitemap-0.xml</loc>\n    <lastmod>${buildDate}</lastmod>\n  </sitemap>\n${t2Entry}`
          );

          writeFileSync(indexPath, indexXml);
          console.log('[library-sitemaps] Updated sitemap-index.xml with library tier sitemaps');
        } catch (e) {
          console.warn('[library-sitemaps] Could not update sitemap-index.xml:', e.message);
        }
      },
    },
  };
}
