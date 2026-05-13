/**
 * Custom Astro integration: Chunked Sitemaps by Content Collection
 *
 * Emits one sitemap per content collection for better GSC coverage reporting
 * and more actionable indexing insight. Each sitemap has real <lastmod>
 * sourced from src/data/page-dates.json (git log for static pages, D1
 * updated_at for dynamic content).
 *
 * Chunks emitted:
 *   sitemap-pillars.xml      -- pillar guides (highest SEO priority)
 *   sitemap-commentary.xml   -- /commentary/* (hub + posts)
 *   sitemap-faqs.xml         -- /faqs/* (hub + detail pages)
 *   sitemap-courses.xml      -- /courses/* (hub + course pages)
 *   sitemap-policies.xml     -- /policies/* (editorial, corrections, fact-checking)
 *   sitemap-library-t3.xml   -- library articles with abstract + journal + citation
 *   sitemap-library-t2.xml   -- library articles with partial enrichment
 *
 * URLs claimed by these chunks are filtered OUT of @astrojs/sitemap
 * (see astro.config.mjs), leaving sitemap-0.xml for residual pages
 * (homepage, about, contact, donate, STUC, legal, linkinbio, library hub).
 *
 * File name kept as library-sitemaps.mjs for git-history continuity.
 * Export name `librarySitemaps` kept for the same reason.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const SITE = 'https://rrmacademy.org';
const BUILD_DATE = new Date().toISOString().split('T')[0];

const PILLAR_PATHS = [
  '/what-is-rrm/',
  '/naprotechnology/',
  '/neofertility/',
  '/femm/',
  '/common-questions-about-rrm/',
  '/glossary/',
  '/guides/',
  '/art-registries-and-codes/',
  '/pcos/',
];

const POLICY_PATHS = [
  '/policies/',
  '/policies/editorial/',
  '/policies/corrections/',
  '/policies/fact-checking/',
];

function readJson(outDir, relName) {
  const candidates = [
    join(outDir, '..', 'src', 'data', relName),
    join(process.cwd(), 'src', 'data', relName),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {
      /* try next */
    }
  }
  return null;
}

// W3C / sitemap.org datetime per spec: YYYY-MM-DD or full ISO 8601 with Z.
// Garbage in -> garbage out via raw.slice was producing strings like "2026"
// that broke the entire sitemap chunk in some XML validators. Drop entry
// instead of emitting an invalid <lastmod>.
const STRICT_LASTMOD_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;

// Normalize mixed date formats to sitemap-friendly ISO string.
// Accepts ISO 8601, SQLite datetime ("2026-03-25 02:34:34"), or YYYY-MM-DD.
function toIsoLastmod(raw) {
  if (!raw) return undefined;
  let candidate;
  try {
    const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + (raw.length <= 10 ? 'T00:00:00Z' : 'Z');
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      candidate = raw.slice(0, 10);
    } else {
      candidate = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
  } catch {
    candidate = raw.slice(0, 10);
  }
  return STRICT_LASTMOD_RE.test(candidate) ? candidate : undefined;
}

function dateForPath(pageDates, path) {
  const dateStr = pageDates?.dates?.[path];
  if (!dateStr) return undefined;
  const candidate = `${dateStr}T00:00:00Z`;
  return STRICT_LASTMOD_RE.test(candidate) ? candidate : undefined;
}

function classifyArticleTier(article) {
  const abstractLen = article.abstract ? article.abstract.trim().length : 0;
  if (abstractLen < 300) return null;
  if (!article.domain || !article.domain.trim()) return null;
  const hasJournal = article.journal && article.journal.trim().length > 0;
  const hasCitation = article.apaCitation && article.apaCitation.trim().length > 0;
  if (hasJournal && hasCitation) return 3;
  return 2;
}

function buildSitemapXml(urls) {
  const entries = urls
    .filter((u) => u.loc)
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}\n  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;
}

function writeChunk(outDir, name, urls, label) {
  if (!urls.length) {
    console.log(`[chunked-sitemaps] ${label}: 0 URLs, skipping ${name}`);
    return false;
  }
  writeFileSync(join(outDir, name), buildSitemapXml(urls));
  console.log(`[chunked-sitemaps] ${label}: ${urls.length} URLs -> ${name}`);
  return true;
}

export default function librarySitemaps() {
  return {
    name: 'chunked-sitemaps',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const outDir = dir.pathname;

        const pageDates = readJson(outDir, 'page-dates.json');
        const articles = readJson(outDir, 'articles.json') ?? [];
        const posts = readJson(outDir, 'posts.json') ?? [];
        const faqs = readJson(outDir, 'faqs.json') ?? [];
        const courses = readJson(outDir, 'courses.json') ?? [];

        // -- Pillars chunk
        // Assert every pillar path resolved to a real dist artifact before emit.
        // PILLAR_PATHS pointing at a slug with no corresponding .astro file
        // (deleted source, build skipped, typo) would otherwise emit a soft-404
        // URL into sitemap-pillars.xml and waste Google crawl budget.
        const missingPillars = PILLAR_PATHS.filter(
          (p) => !existsSync(join(outDir, p, 'index.html'))
        );
        if (missingPillars.length > 0) {
          throw new Error(
            `[library-sitemaps] PILLAR_PATHS entries missing from dist/: ${missingPillars.join(', ')}. ` +
            `Add the missing src/pages/<slug>/index.astro file or remove the path from PILLAR_PATHS.`
          );
        }
        const pillarUrls = PILLAR_PATHS.map((p) => ({
          loc: `${SITE}${p}`,
          lastmod: dateForPath(pageDates, p),
        }));

        // -- Commentary chunk (hub + posts)
        const commentaryUrls = [
          {
            loc: `${SITE}/commentary/`,
            lastmod: dateForPath(pageDates, '/commentary/'),
          },
          ...posts
            .filter((p) => p.slug && p.status !== 'draft')
            .map((p) => ({
              loc: `${SITE}/commentary/${p.slug}/`,
              lastmod: toIsoLastmod(p.lastModified || p.publishDate),
            })),
        ];

        // -- FAQs chunk (hub + slugs)
        const faqUrls = [
          {
            loc: `${SITE}/faqs/`,
            lastmod: dateForPath(pageDates, '/faqs/'),
          },
          ...faqs
            .filter((f) => f.slug && f.status !== 'draft')
            .map((f) => ({
              loc: `${SITE}/faqs/${f.slug}/`,
              lastmod: toIsoLastmod(f.updatedAt || f.createdAt),
            })),
        ];

        // -- Courses chunk (hub + slugs; skip coming-soon)
        const courseUrls = [
          {
            loc: `${SITE}/courses/`,
            lastmod: dateForPath(pageDates, '/courses/'),
          },
          ...courses
            .filter((c) => c.slug && !c.comingSoon)
            .map((c) => ({
              loc: `${SITE}/courses/${c.slug}/`,
              lastmod: dateForPath(pageDates, `/courses/${c.slug}/`),
            })),
        ];

        // -- Policies chunk
        const policyUrls = POLICY_PATHS.map((p) => ({
          loc: `${SITE}${p}`,
          lastmod: dateForPath(pageDates, p),
        }));

        // -- Library tier chunks
        const tier3 = [];
        const tier2 = [];
        for (const a of articles) {
          if (!a.slug) continue;
          const tier = classifyArticleTier(a);
          if (tier === null) continue;
          const url = {
            loc: `${SITE}/library/${a.slug}/`,
            lastmod: toIsoLastmod(a.lastModified),
          };
          if (tier === 3) tier3.push(url);
          else tier2.push(url);
        }

        const emittedSitemaps = [];
        if (writeChunk(outDir, 'sitemap-pillars.xml', pillarUrls, 'Pillars')) {
          emittedSitemaps.push('sitemap-pillars.xml');
        }
        if (writeChunk(outDir, 'sitemap-commentary.xml', commentaryUrls, 'Commentary')) {
          emittedSitemaps.push('sitemap-commentary.xml');
        }
        if (writeChunk(outDir, 'sitemap-faqs.xml', faqUrls, 'FAQs')) {
          emittedSitemaps.push('sitemap-faqs.xml');
        }
        if (writeChunk(outDir, 'sitemap-courses.xml', courseUrls, 'Courses')) {
          emittedSitemaps.push('sitemap-courses.xml');
        }
        if (writeChunk(outDir, 'sitemap-policies.xml', policyUrls, 'Policies')) {
          emittedSitemaps.push('sitemap-policies.xml');
        }
        if (writeChunk(outDir, 'sitemap-library-t3.xml', tier3, 'Library T3')) {
          emittedSitemaps.push('sitemap-library-t3.xml');
        }
        if (writeChunk(outDir, 'sitemap-library-t2.xml', tier2, 'Library T2')) {
          emittedSitemaps.push('sitemap-library-t2.xml');
        }

        // Patch sitemap-index.xml to include all per-collection chunks.
        // Order: pillars -> commentary -> faqs -> courses -> policies ->
        //        library-t3 -> sitemap-0 (residual) -> library-t2.
        // Rationale: crawlers work top-down; pillar + commentary + t3 are
        // the highest-value content for AI retrieval and GSC indexing.
        const indexPath = join(outDir, 'sitemap-index.xml');
        try {
          const entry = (name) =>
            `  <sitemap>\n    <loc>${SITE}/${name}</loc>\n    <lastmod>${BUILD_DATE}</lastmod>\n  </sitemap>`;

          const ordered = [
            'sitemap-pillars.xml',
            'sitemap-commentary.xml',
            'sitemap-faqs.xml',
            'sitemap-courses.xml',
            'sitemap-policies.xml',
            'sitemap-library-t3.xml',
            'sitemap-0.xml',
            'sitemap-library-t2.xml',
          ].filter((name) => name === 'sitemap-0.xml' || emittedSitemaps.includes(name));

          const body = ordered.map(entry).join('\n');

          const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>`;

          writeFileSync(indexPath, indexXml);
          console.log(
            `[chunked-sitemaps] Rewrote sitemap-index.xml with ${ordered.length} child sitemaps`
          );
        } catch (e) {
          console.warn('[chunked-sitemaps] Could not update sitemap-index.xml:', e.message);
        }
      },
    },
  };
}
