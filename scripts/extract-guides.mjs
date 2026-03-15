#!/usr/bin/env node

/**
 * extract-guides.mjs
 *
 * Extracts prose content from Astro pillar pages and markdown guide files
 * into src/data/guides.json for consumption by rrm-cli and other tools.
 *
 * Usage:
 *   node scripts/extract-guides.mjs
 *   node scripts/extract-guides.mjs --data-dir=src/data
 *
 * Astro pages: strips frontmatter, components, style blocks, script blocks,
 * and HTML tags. Preserves section structure via <section id=""> or <h2 id="">.
 *
 * Markdown files: parses by heading structure.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Configuration: which Astro files are pillar guides
// ---------------------------------------------------------------------------
const ASTRO_GUIDES = [
  {
    file: 'src/pages/what-is-rrm/index.astro',
    slug: 'what-is-rrm',
    url: '/what-is-rrm/',
  },
  {
    file: 'src/pages/naprotechnology/index.astro',
    slug: 'naprotechnology',
    url: '/naprotechnology/',
  },
  {
    file: 'src/pages/common-questions-about-rrm.astro',
    slug: 'common-questions-about-rrm',
    url: '/common-questions-about-rrm/',
  },
  {
    file: 'src/pages/femm/index.astro',
    slug: 'femm',
    url: '/femm/',
  },
  {
    file: 'src/pages/neofertility/index.astro',
    slug: 'neofertility',
    url: '/neofertility/',
  },
  {
    file: 'src/pages/glossary/index.astro',
    slug: 'glossary',
    url: '/glossary/',
  },
];

const MARKDOWN_GUIDES_DIR = 'src/content/guides';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a URL-safe slug from text */
function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Strip HTML tags, preserving text content */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&aacute;/g, '\u00e1')
    .replace(/&eacute;/g, '\u00e9')
    .replace(/&iacute;/g, '\u00ed')
    .replace(/&oacute;/g, '\u00f3')
    .replace(/&uacute;/g, '\u00fa')
    .replace(/&ntilde;/g, '\u00f1')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201c')
    .replace(/&ldquo;/g, '\u201d')
    .replace(/&rsaquo;/g, '\u203a')
    .replace(/&lsaquo;/g, '\u2039')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract title from JSON-LD headline or BaseLayout title prop */
function extractTitle(raw) {
  const headlineMatch = raw.match(/headline:\s*['"]([^'"]+)['"]/);
  if (headlineMatch) return headlineMatch[1];

  const titleMatch = raw.match(/title="([^"]+)"/);
  if (titleMatch) return titleMatch[1].replace(/\s*\|.*$/, '');

  return null;
}

// ---------------------------------------------------------------------------
// Astro extraction
// ---------------------------------------------------------------------------

function extractFromAstro(config) {
  const filePath = join(PROJECT_ROOT, config.file);
  if (!existsSync(filePath)) {
    console.warn(`  SKIP: ${config.file} not found`);
    return null;
  }

  const raw = readFileSync(filePath, 'utf-8');

  // Split frontmatter (between ---) from HTML body
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;

  const title = extractTitle(raw) || config.slug;

  // Remove <style> blocks
  let html = body.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove <script> blocks (including JSON-LD)
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Remove self-closing Astro component tags
  html = html.replace(/<(BaseLayout|BackToTop|PdfDownload|Citation|SearchBar|Header|Footer|AuthorByline|TopicTag|LibraryFundingCallout)\b[^>]*\/>/gi, '');
  // Remove opening/closing wrapper component tags (keep content between them)
  html = html.replace(/<(BaseLayout|BackToTop|PdfDownload|Citation|SearchBar|Header|Footer|AuthorByline|TopicTag|LibraryFundingCallout)\b[^>]*>/gi, '');
  html = html.replace(/<\/(BaseLayout|BackToTop|PdfDownload|Citation|SearchBar|Header|Footer|AuthorByline|TopicTag|LibraryFundingCallout)>/gi, '');
  // Remove HTML comments
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  const sections = extractSections(html, config.slug);

  const fullBody = sections.map(s => s.content).join('\n\n');

  return {
    id: `guide-${config.slug}`,
    type: 'guide',
    slug: config.slug,
    title,
    url: config.url,
    sections,
    body: fullBody,
    date_extracted: new Date().toISOString(),
  };
}

/**
 * Extract sections from HTML using two strategies:
 * 1. <section id="..."> wrappers (naprotechnology pattern)
 * 2. <h2 id="..."> markers (what-is-rrm pattern)
 * 3. <h2> without id (common-questions pattern -- generate slugs)
 */
function extractSections(html, guideSlug) {
  // Strategy 1: Try <section id="..."> first
  const sectionRegex = /<section[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gi;
  const sectionMatches = [...html.matchAll(sectionRegex)];

  if (sectionMatches.length >= 1) {
    const sectionRanges = sectionMatches.map(m => [m.index, m.index + m[0].length]);

    // Collect all h2s outside sections
    const outsideH2s = [];
    const h2OutsideRegex = /<h2([^>]*)\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/gi;
    for (const h2m of html.matchAll(h2OutsideRegex)) {
      const pos = h2m.index;
      const inside = sectionRanges.some(([s, e]) => pos >= s && pos < e);
      if (!inside) outsideH2s.push(h2m);
    }

    // If outside h2s outnumber section tags, this page uses h2-based structure
    // with incidental section wrappers (e.g. references). Fall through to Strategy 2.
    if (outsideH2s.length > sectionMatches.length * 2) {
      // Let Strategy 2 handle it
    } else {
    const extraSections = [];
    for (let j = 0; j < outsideH2s.length; j++) {
      const h2m = outsideH2s[j];
      const pos = h2m.index;
      const h2End = pos + h2m[0].length;
      let endPos = html.length;
      // End at next section start
      for (const [s] of sectionRanges) {
        if (s > pos && s < endPos) endPos = s;
      }
      // End at next outside h2
      if (j + 1 < outsideH2s.length) {
        const nextH2Pos = outsideH2s[j + 1].index;
        if (nextH2Pos < endPos) endPos = nextH2Pos;
      }
      const bodyHtml = html.slice(h2End, endPos);
      extraSections.push({
        id: h2m[2],
        heading: stripHtml(h2m[3]),
        bodyHtml,
        sourceIndex: pos,
      });
    }

    const results = sectionMatches.map((match) => {
      const sectionId = match[1];
      const sectionHtml = match[2];

      const headingMatch = sectionHtml.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
      const heading = headingMatch ? stripHtml(headingMatch[1]) : sectionId;

      const contentHtml = headingMatch
        ? sectionHtml.slice(sectionHtml.indexOf(headingMatch[0]) + headingMatch[0].length)
        : sectionHtml;
      const content = stripHtml(contentHtml);

      return {
        id: sectionId,
        heading,
        content,
        sourceIndex: match.index,
      };
    });

    for (const extra of extraSections) {
      results.push({
        id: extra.id,
        heading: extra.heading,
        content: stripHtml(extra.bodyHtml),
        sourceIndex: extra.sourceIndex,
      });
    }

    results.sort((a, b) => a.sourceIndex - b.sourceIndex);

    let order = 0;
    return results
      .filter(s => s.content.length > 20)
      .map(s => {
        order++;
        return { id: s.id, heading: s.heading, content: s.content, order };
      });
    } // end else (Strategy 1 with outside h2s)
  }

  // Strategy 2: Split by <h2> tags (with or without id)
  // Match all h2s, then extract id separately from the tag attributes
  const h2Regex = /<h2([^>]*)>([\s\S]*?)<\/h2>/gi;
  const h2Matches = [...html.matchAll(h2Regex)];

  if (h2Matches.length === 0) {
    // No sections found -- return the whole body as one section
    const content = stripHtml(html);
    if (content.length < 20) return [];
    return [{
      id: guideSlug,
      heading: guideSlug,
      content,
      order: 1,
    }];
  }

  const sections = [];
  for (let i = 0; i < h2Matches.length; i++) {
    const match = h2Matches[i];
    const attrs = match[1];
    const headingText = stripHtml(match[2]);
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    const sectionId = idMatch ? idMatch[1] : `${guideSlug}--${slugify(headingText)}`;

    const startIdx = match.index + match[0].length;
    const endIdx = i + 1 < h2Matches.length ? h2Matches[i + 1].index : html.length;
    const sectionHtml = html.slice(startIdx, endIdx);
    const content = stripHtml(sectionHtml);

    if (content.length < 20) continue;

    sections.push({
      id: sectionId,
      heading: headingText,
      content,
      order: sections.length + 1,
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Markdown extraction
// ---------------------------------------------------------------------------

function extractFromMarkdown(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error(`  ERROR reading ${filePath}: ${err.message}`);
    return null;
  }
  const name = basename(filePath, '.md');
  const slug = slugify(name);

  // Strip YAML frontmatter if present
  const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

  // Extract title from first # heading
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : name;

  // Split by ## headings
  const lines = content.split('\n');
  const sections = [];
  let currentHeading = null;
  let currentId = null;
  let currentLines = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (currentHeading) {
        const text = currentLines.join('\n').trim();
        if (text.length > 20) {
          sections.push({
            id: currentId,
            heading: currentHeading,
            content: text,
            order: sections.length + 1,
          });
        }
      } else {
        const introText = currentLines.join('\n').trim();
        if (introText.length > 20) {
          sections.push({
            id: `${slug}--intro`,
            heading: title,
            content: introText,
            order: sections.length + 1,
          });
        }
      }
      currentHeading = h2Match[1].trim();
      currentId = `${slug}--${slugify(currentHeading)}`;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentHeading) {
    const text = currentLines.join('\n').trim();
    if (text.length > 20) {
      sections.push({
        id: currentId,
        heading: currentHeading,
        content: text,
        order: sections.length + 1,
      });
    }
  }

  const fullBody = sections.map(s => s.content).join('\n\n');

  return {
    id: `guide-${slug}`,
    type: 'guide',
    slug,
    title,
    url: '',
    sections,
    body: fullBody,
    date_extracted: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const dataDirArg = args.find(a => a.startsWith('--data-dir='));
  const dataDir = dataDirArg
    ? join(PROJECT_ROOT, dataDirArg.slice(dataDirArg.indexOf('=') + 1))
    : join(PROJECT_ROOT, 'src', 'data');

  const guides = [];
  let sectionCount = 0;

  // Extract from Astro pillar pages
  console.log('Extracting Astro pillar guides...');
  for (const config of ASTRO_GUIDES) {
    const guide = extractFromAstro(config);
    if (guide) {
      guides.push(guide);
      sectionCount += guide.sections.length;
      console.log(`  ${config.slug}: ${guide.sections.length} sections, ${guide.body.length} chars`);
    }
  }

  // Extract from markdown guides directory
  const mdDir = join(PROJECT_ROOT, MARKDOWN_GUIDES_DIR);
  if (existsSync(mdDir)) {
    console.log('Extracting markdown guides...');
    const mdFiles = readdirSync(mdDir).filter(f => f.endsWith('.md'));
    for (const file of mdFiles) {
      const guide = extractFromMarkdown(join(mdDir, file));
      if (guide && guide.sections.length > 0) {
        guides.push(guide);
        sectionCount += guide.sections.length;
        console.log(`  ${guide.slug}: ${guide.sections.length} sections, ${guide.body.length} chars`);
      }
    }
  } else {
    console.log(`Markdown guides directory not found (${MARKDOWN_GUIDES_DIR}), skipping.`);
  }

  // Write output
  const outputPath = join(dataDir, 'guides.json');
  try {
    writeFileSync(outputPath, JSON.stringify(guides, null, 2));
  } catch (err) {
    console.error(`FATAL: failed to write ${outputPath}: ${err.message}`);
    process.exit(1);
  }

  console.log(`\nExtracted ${guides.length} guides, ${sectionCount} sections.`);
  console.log(`Written to ${outputPath}`);
}

main();
