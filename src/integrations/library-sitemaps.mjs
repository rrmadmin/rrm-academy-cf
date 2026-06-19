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
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SITE = 'https://rrmacademy.org';
const BUILD_DATE = new Date().toISOString().split('T')[0];

// Derive from ssot/guides.json + the /guides/ catalogue index. Adding /guides/
// here keeps the index page in the pillar sitemap (it's a hub, not a pillar
// per se -- so it's not in guides.json -- but it belongs in the high-priority
// chunk for crawlers).
const __dirname = dirname(fileURLToPath(import.meta.url));
const PILLAR_REGISTRY = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'ssot', 'guides.json'), 'utf-8'),
);
// /common-questions-about-rrm/ is still listed in ssot/guides.json (its
// .astro source survives so the build emits an index.html) but the live route
// 301-redirects to /faqs/ (public/_redirects). Emitting it into
// sitemap-pillars.xml advertises a redirecting URL to crawlers, so drop it
// from the pillar chunk. It is already excluded from sitemap-0 via the
// chunkedPillars list in astro.config.mjs, so this removes it from ALL sitemaps.
const REDIRECTING_PILLAR_SLUGS = new Set(['common-questions-about-rrm']);
const GUIDE_PATHS = [
  ...PILLAR_REGISTRY.guides
    .slice()
    .filter((p) => !REDIRECTING_PILLAR_SLUGS.has(p.slug))
    .sort((a, b) => (a._order ?? 999) - (b._order ?? 999))
    .map((p) => `/${p.slug}/`),
  '/guides/',
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

// Mirror of the noindex predicate in src/pages/library/[...slug].astro (the
// `noindex=` prop). MUST stay byte-for-byte in sync with that line: an article
// rendered with <meta robots noindex> must never be advertised in a sitemap.
// word_count<30 (thin) => noindex; fall back to abstract length for any
// pre-backfill row that lacks a numeric word_count.
function isNoindexArticle(a) {
  return typeof a.word_count === 'number'
    ? a.word_count < 30
    : (!a.abstract || a.abstract.trim().length < 30);
}

// Mirror of topicSlug() in src/pages/library/topics/[slug].astro. MUST stay in
// sync with that page's getStaticPaths slug derivation, or the sitemap will
// advertise topic-hub URLs that 404. Derived from the first segment of each
// article's `topics` entries (split on " > "), deduped case-insensitively.
function topicSlug(topic) {
  return topic
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/\s+&\s+/g, '-and-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Build the set of /library/topics/<slug>/ hub URLs the topic page generates.
// Replicates [slug].astro getStaticPaths: collect the first " > " segment of
// every article topic, dedupe by lowercased label, slugify. Skips empties and
// any slug that collapses to '' (which getStaticPaths would also skip).
function deriveTopicSlugs(articles) {
  const labels = new Map(); // lowercased key -> original label
  for (const a of articles) {
    const topics = Array.isArray(a.topics) ? a.topics : [];
    for (const t of topics) {
      const label = String(t).split(' > ')[0].trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (!labels.has(key)) labels.set(key, label);
    }
  }
  const slugs = new Set();
  for (const label of labels.values()) {
    const slug = topicSlug(label);
    if (slug) slugs.add(slug);
  }
  return [...slugs];
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
        // GUIDE_PATHS pointing at a slug with no corresponding .astro file
        // (deleted source, build skipped, typo) would otherwise emit a soft-404
        // URL into sitemap-pillars.xml and waste Google crawl budget.
        const missingPillars = GUIDE_PATHS.filter(
          (p) => !existsSync(join(outDir, p, 'index.html'))
        );
        if (missingPillars.length > 0) {
          throw new Error(
            `[library-sitemaps] GUIDE_PATHS entries missing from dist/: ${missingPillars.join(', ')}. ` +
            `Add the missing src/pages/<slug>/index.astro file or remove the path from GUIDE_PATHS.`
          );
        }
        const pillarUrls = GUIDE_PATHS.map((p) => ({
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
        // articles.json is already published + non-retracted only: the build
        // fetch (src/lib/fetch-data.mjs) drops any record the worker 404s
        // (status != published, is_retracted=1) and strips faq/post/course/
        // guide types. The only per-article gate here is a valid slug.
        //
        // Tier 1 captures articles that classifyArticleTier rejects (short/no
        // abstract OR no domain) but that ARE live + self-canonical at
        // /library/<slug>/. Excluding them suppressed crawl discovery of ~12%
        // of the library; emit them in sitemap-library-t1.xml instead.
        const tier3 = [];
        const tier2 = [];
        const tier1 = [];
        for (const a of articles) {
          if (!a.slug) continue;
          if (isNoindexArticle(a)) continue; // thin pages carry <meta robots noindex>; keep them out of every chunk
          const url = {
            loc: `${SITE}/library/${a.slug}/`,
            lastmod: toIsoLastmod(a.lastModified),
          };
          const tier = classifyArticleTier(a);
          if (tier === 3) tier3.push(url);
          else if (tier === 2) tier2.push(url);
          else tier1.push(url); // tier === null
        }

        // -- Library topic hubs (/library/topics/<slug>/)
        // CollectionPage hub pages generated by library/topics/[slug].astro.
        // They return 200 but appeared in no sitemap. Derive their slugs from
        // the same article-topics data the page uses so the URLs match exactly.
        // Only advertise topic hubs that actually built to a dist artifact.
        // deriveTopicSlugs() over-produces (every first-segment topic label) but
        // the route (library/topics/[slug].astro) only builds the
        // CATEGORY_ALLOWLIST-approved, sentiment-safe topics. existsSync against
        // dist/ is the single source of truth for "did this page build", keeping
        // the sitemap == route without re-importing the .ts allowlist here.
        const topicHubUrls = deriveTopicSlugs(articles)
          .filter((slug) => existsSync(join(outDir, 'library', 'topics', slug, 'index.html')))
          .map((slug) => ({
            loc: `${SITE}/library/topics/${slug}/`,
            lastmod: dateForPath(pageDates, `/library/topics/${slug}/`),
          }));

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
        if (writeChunk(outDir, 'sitemap-library-topics.xml', topicHubUrls, 'Library Topic Hubs')) {
          emittedSitemaps.push('sitemap-library-topics.xml');
        }
        if (writeChunk(outDir, 'sitemap-library-t3.xml', tier3, 'Library T3')) {
          emittedSitemaps.push('sitemap-library-t3.xml');
        }
        if (writeChunk(outDir, 'sitemap-library-t2.xml', tier2, 'Library T2')) {
          emittedSitemaps.push('sitemap-library-t2.xml');
        }
        if (writeChunk(outDir, 'sitemap-library-t1.xml', tier1, 'Library T1')) {
          emittedSitemaps.push('sitemap-library-t1.xml');
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
            'sitemap-library-topics.xml',
            'sitemap-library-t3.xml',
            'sitemap-0.xml',
            'sitemap-library-t2.xml',
            'sitemap-library-t1.xml',
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
