/**
 * agent-md-surfaces -- build-time generation of the two Wave-3 agent surfaces:
 *
 *   1. Pillar markdown twins: dist/<slug>.md for every pillar in
 *      ssot/pillars.json (audit GEO-002 / AR-02). Pillars are hand-authored
 *      .astro pages with no clean body data source, so the twin is extracted
 *      from the BUILT page: read dist/<slug>/index.html, take the outermost
 *      <article> element, convert to house-styled Markdown.
 *
 *   2. Real llms-full.txt corpus: dist/llms-full.txt (audit AEO-01 / AR-01).
 *      The static-overrides copy that ssot-prebuild restores into public/ is
 *      kept as the PREAMBLE; this integration appends the content corpus
 *      (FAQs, glossary, pillar summaries, commentary index, high-relevance
 *      library citation stubs) and overwrites the file in dist/. Writing at
 *      astro:build:done is what makes the ordering deterministic: the static
 *      copy lands first (public/ -> dist/), the corpus build always wins.
 *      Version is read from llms.txt so the two files can never drift again.
 *
 * Runs in CI (it is a plain Astro integration -- no dependency on the
 * tools/site-ssot package, which is absent from CI checkouts).
 *
 * Fail-loud contract: a pillar twin that extracts to less than
 * MIN_TWIN_CHARS throws and fails the build (no silent empty twins). The
 * llms-full corpus build SKIPS with a loud warning if a data file is
 * missing, leaving the static preamble intact (never emits an empty file).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripEmDashes,
  tidyBlankLines,
  htmlToMarkdown,
} from '../lib/markdown-twin-core.mjs';

const SITE = 'https://rrmacademy.org';
const MIN_TWIN_CHARS = 2000;
// Pillars excluded from twin generation:
//  - common-questions-about-rrm: 301s to /faqs/
//  - glossary: already has a dedicated twin endpoint (src/pages/glossary.md.ts)
const TWIN_EXCLUDE = new Set(['common-questions-about-rrm', 'glossary']);

/** Outermost <article>...</article> via balanced-tag scan (pillars nest
 *  <article> cards inside the main wrapper, so first-close would truncate). */
function extractArticle(html) {
  const open = html.search(/<article[\s>]/);
  if (open === -1) return null;
  const tagRe = /<\/?article[\s>]/g;
  tagRe.lastIndex = open;
  let depth = 0;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    if (m[0][1] === '/') {
      depth--;
      if (depth === 0) {
        const end = html.indexOf('>', m.index) + 1;
        return html.slice(open, end);
      }
    } else {
      depth++;
    }
  }
  return null;
}

/** Drop UI-only blocks that read as noise in a text twin. */
function stripUiBlocks(html) {
  return html
    // Cite-this section (the canonical Source line in the twin footer makes it
    // redundant). Remove the whole <section class="cite-this-page">...</section>
    // so its heading does not leak as an empty "## Cite this guide".
    .replace(/<section class="cite-this-page"[\s\S]*?<\/section>/g, '')
    // Any stray citation tab widget elsewhere.
    .replace(/<div class="citation-tabs"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<button[\s\S]*?<\/button>/g, '');
}

function buildTwin(pillar, html) {
  const article = extractArticle(html);
  if (!article) return null;
  const bodyMd = htmlToMarkdown(stripUiBlocks(article));
  const lines = [
    `# ${stripEmDashes(pillar.title)}`,
    '',
  ];
  if (pillar.author) {
    lines.push(`_By ${pillar.author}_`, '');
  }
  lines.push(bodyMd, '', '---', '', `Source: ${SITE}/${pillar.slug}/`, '');
  return tidyBlankLines(stripEmDashes(lines.join('\n'))) + '\n';
}

/* ----------------------------- llms-full corpus -------------------------- */

function loadJson(root, rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Pull `Version: X.Y` out of an llms.txt-style header. */
function readVersion(text) {
  const m = text && text.match(/^> Version: (.+)$/m);
  return m ? m[1].trim() : null;
}

/** Title + lead paragraphs + section headings from a full pillar twin. */
function pillarSummary(twinMd, pillar) {
  const lines = twinMd.split('\n');
  const out = [`## ${stripEmDashes(pillar.title)}`, ''];
  // Lead: everything from the H1 to the first '##' heading, capped.
  let lead = [];
  let started = false;
  for (const line of lines) {
    if (line.startsWith('# ')) { started = true; continue; }
    if (line.startsWith('## ')) break;
    if (started) lead.push(line);
  }
  let leadText = tidyBlankLines(lead.join('\n'));
  if (leadText.length > 1200) leadText = leadText.slice(0, 1200).replace(/\s+\S*$/, '') + ' ...';
  if (leadText) out.push(leadText, '');
  const headings = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());
  if (headings.length) {
    out.push('Sections: ' + headings.join(' | '), '');
  }
  out.push(`Full text: ${SITE}/${pillar.slug}.md | Page: ${SITE}/${pillar.slug}/`, '');
  return out.join('\n');
}

function relevanceRank(article) {
  const m = String(article.rrmRelevance || '').match(/^(\d)/);
  return m ? Number(m[1]) : 0;
}

function articleStub(a) {
  const journal = a.journalAbbv || a.journal || '';
  const year = a.year || '';
  const src = [journal, year].filter(Boolean).join(' ');
  const doi = a.doi ? ` doi:${a.doi}` : '';
  return stripEmDashes(`- ${a.title}${src ? ` (${src})` : ''}.${doi} ${SITE}/library/${a.slug}/`);
}

function buildLlmsFull(root, distDir, twins, logger) {
  const staticPath = join(distDir, 'llms-full.txt');
  const preamble = existsSync(staticPath) ? readFileSync(staticPath, 'utf8') : '';
  const llmsTxtPath = join(distDir, 'llms.txt');
  const llmsVersion = readVersion(existsSync(llmsTxtPath) ? readFileSync(llmsTxtPath, 'utf8') : '');

  const faqs = loadJson(root, 'src/data/faqs.json');
  const glossary = loadJson(root, 'src/data/glossary.json');
  const posts = loadJson(root, 'src/data/posts.json');
  const articles = loadJson(root, 'src/data/articles.json');
  const missing = [
    !faqs && 'faqs.json',
    !glossary && 'glossary.json',
    !posts && 'posts.json',
    !articles && 'articles.json',
  ].filter(Boolean);
  if (missing.length) {
    logger.warn(`[agent-md-surfaces] llms-full corpus SKIPPED -- missing data: ${missing.join(', ')} (static preamble left in place)`);
    return null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const sections = [];

  // Preamble: the SSOT-emitted "Full Agent Context" document, with its
  // version pinned to llms.txt's version (single source -- no more drift).
  let head = preamble.trim();
  if (llmsVersion) {
    head = head.replace(/^> Version: .+$/m, `> Version: ${llmsVersion}`);
  }
  head = head.replace(/^> Last updated: .+$/m, `> Last updated: ${today}`);
  // House rule: no em dashes. The corpus sections are already clean (built via
  // htmlToMarkdown); the inherited static preamble may carry them, so strip.
  sections.push(stripEmDashes(head), '');

  sections.push('---', '', '# Content Corpus Index', '',
    `Generated at build time on ${today}. Sections: FAQs (full text), Glossary (full definitions), Pillar Guides (summaries; full text at the per-page .md twins), Commentary (index), Research Library (high-relevance citation index + complete machine-readable feed).`, '');

  // FAQs: full answers -- directly citable.
  sections.push('## Frequently Asked Questions (full text)', '');
  for (const faq of faqs) {
    const body = htmlToMarkdown(faq.publishedAnswer || faq.basicAnswer || '');
    sections.push(`### ${stripEmDashes(faq.question)}`, '', body, '', `Source: ${SITE}/faqs/${faq.slug || faq.faqId || ''}/`, '');
  }

  // Glossary: short definitions (full definitions live at the dedicated
  // /glossary.md twin -- inlining all of them here would duplicate ~190KB).
  const terms = Array.isArray(glossary) ? glossary : glossary.terms || [];
  sections.push('## Glossary (short definitions)', '',
    `${terms.length} terms. Full definitions with citations: ${SITE}/glossary.md (complete twin) or ${SITE}/glossary/.`, '');
  for (const t of terms) {
    const full = htmlToMarkdown(t.body_html || t.bodyHtml || t.definition || '');
    // First sentence (or first ~220 chars), single-line.
    let short = full.replace(/\s+/g, ' ').trim();
    const dot = short.indexOf('. ');
    if (dot > 40 && dot < 240) short = short.slice(0, dot + 1);
    else if (short.length > 240) short = short.slice(0, 240).replace(/\s+\S*$/, '') + ' ...';
    sections.push(`- **${stripEmDashes(t.name || t.term || '')}**: ${short}`);
  }
  sections.push('');

  // Pillars: summaries built from the twins generated moments ago.
  sections.push('## Pillar Guides', '');
  for (const { pillar, twin } of twins) {
    sections.push(pillarSummary(twin, pillar));
  }

  // Commentary index.
  sections.push('## Commentary (physician-written analysis)', '');
  for (const p of posts) {
    const excerpt = stripEmDashes((p.excerpt || '').trim());
    sections.push(`- ${stripEmDashes(p.title)} (${(p.publishDate || '').slice(0, 10)}). ${excerpt} ${SITE}/commentary/${p.slug}/ | ${SITE}/commentary/${p.slug}.md`);
  }
  sections.push('');

  // Library: complete-corpus pointers + Core-RRM inline citation index.
  // The full corpus (incl. relevance-4 "Highly Relevant") is one fetch away
  // at library-feed.jsonl; inlining only the relevance-5 "Core RRM" tier
  // keeps this file agent-parseable while surfacing the highest-signal cites.
  const core = articles.filter((a) => relevanceRank(a) >= 5);
  const hiRelCount = articles.filter((a) => relevanceRank(a) >= 4).length;
  sections.push('## Research Library', '',
    `${articles.length} indexed peer-reviewed articles (${hiRelCount} at RRM relevance 4+). Complete machine-readable corpus: ${SITE}/library-feed.jsonl (one schema.org MedicalScholarlyArticle per line, every article, with abstracts and citations). Sitemaps: ${SITE}/sitemap-index.xml. Browse: ${SITE}/library/`, '',
    `### Core RRM citation index (relevance 5, ${core.length} articles)`,
    `The highest-signal subset is inlined below. For the full ${hiRelCount}-article high-relevance set and all abstracts, use the feed above.`, '');
  for (const a of core) {
    sections.push(articleStub(a));
  }
  sections.push('');

  return tidyBlankLines(sections.join('\n')) + '\n';
}

/* -------------------------------- integration ---------------------------- */

export default function agentMdSurfaces() {
  return {
    name: 'agent-md-surfaces',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const distDir = fileURLToPath(dir);
        const root = process.cwd();
        const registry = JSON.parse(
          readFileSync(join(root, 'ssot', 'pillars.json'), 'utf8'),
        );
        const pillars = registry.pillars.filter((p) => !TWIN_EXCLUDE.has(p.slug));

        // 1. Pillar twins (fail-loud).
        const twins = [];
        for (const pillar of pillars) {
          const htmlPath = join(distDir, pillar.slug, 'index.html');
          if (!existsSync(htmlPath)) {
            throw new Error(`[agent-md-surfaces] pillar HTML missing: ${htmlPath} (registry/slug drift?)`);
          }
          const twin = buildTwin(pillar, readFileSync(htmlPath, 'utf8'));
          if (!twin || twin.length < MIN_TWIN_CHARS) {
            throw new Error(`[agent-md-surfaces] twin for /${pillar.slug}/ extracted ${twin ? twin.length : 0} chars (< ${MIN_TWIN_CHARS}) -- refusing to emit an empty twin`);
          }
          writeFileSync(join(distDir, `${pillar.slug}.md`), twin);
          twins.push({ pillar, twin });
          logger.info(`[agent-md-surfaces] twin /${pillar.slug}.md (${(twin.length / 1024).toFixed(1)}KB)`);
        }

        // 2. llms-full.txt corpus.
        const full = buildLlmsFull(root, distDir, twins, logger);
        if (full) {
          writeFileSync(join(distDir, 'llms-full.txt'), full);
          logger.info(`[agent-md-surfaces] llms-full.txt corpus written (${(full.length / 1024).toFixed(1)}KB)`);
        }
      },
    },
  };
}
