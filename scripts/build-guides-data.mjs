/**
 * Build src/data/guides.json from the 7 pillar Astro pages.
 *
 * Extracts title (h1), description (BaseLayout `description=`), section headings
 * (h2/h3), and visible body prose from each pillar's index.astro. Output feeds
 * the Vectorize semantic search embedder (scripts/embed-library*.mjs) so
 * intent-matched queries surface pillar guides alongside research, commentary,
 * FAQ, course, and glossary results.
 *
 * Runs as part of `npm run build` before astro build. Output is gitignored.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGES = join(ROOT, 'src', 'pages');
const OUT = join(ROOT, 'src', 'data', 'guides.json');

const GUIDES = [
  { slug: 'art-registries-and-codes', file: 'art-registries-and-codes/index.astro' },
  { slug: 'common-questions-about-rrm', file: 'common-questions-about-rrm.astro' },
  { slug: 'femm',                     file: 'femm/index.astro' },
  { slug: 'naprotechnology',          file: 'naprotechnology/index.astro' },
  { slug: 'neofertility',             file: 'neofertility/index.astro' },
  { slug: 'pcos',                     file: 'pcos/index.astro' },
  { slug: 'what-is-rrm',              file: 'what-is-rrm/index.astro' },
  { slug: 'glossary',                 file: 'glossary/index.astro' },
];

const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&rsaquo;': '>', '&lsaquo;': '<',
  '&ndash;': '-', '&mdash;': '-', '&hellip;': '...', '&rsquo;': "'", '&lsquo;': "'",
  '&rdquo;': '"', '&ldquo;': '"',
};

function decodeEntities(s) {
  return s.replace(/&[a-z#0-9]+;/gi, m => HTML_ENTITIES[m] || ' ');
}

function splitFrontmatter(src) {
  // Astro files start with `---\n...\n---`. Body follows.
  if (!src.startsWith('---')) return { frontmatter: '', body: src };
  const end = src.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: '', body: src };
  return {
    frontmatter: src.slice(3, end),
    body: src.slice(end + 4),
  };
}

function extractH1(body) {
  const m = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return '';
  return stripInline(m[1]);
}

function extractBaseLayoutTag(body) {
  // Walk attributes brace-aware. The lazy regex /<BaseLayout[\s\S]*?>/ would
  // truncate at any `>` inside a JSX expression (e.g. condition={x > 0}).
  const start = body.indexOf('<BaseLayout');
  if (start === -1) return '';
  let i = start, depth = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return body.slice(start, i + 1);
    i++;
  }
  return '';
}

function extractBaseLayoutDescription(body) {
  // Match description="..." or description='...' on BaseLayout.
  // JSX-expression descriptions (description={...}) are not supported -- pillars must use string literals.
  const tag = extractBaseLayoutTag(body);
  if (!tag) return '';
  const dq = tag.match(/\bdescription="([^"]+)"/);
  if (dq) return decodeEntities(dq[1]).trim();
  const sq = tag.match(/\bdescription='([^']+)'/);
  if (sq) return decodeEntities(sq[1]).trim();
  return '';
}

function extractSectionHeadings(body) {
  const out = [];
  const re = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const text = stripInline(m[2]);
    if (text && text.length < 200) out.push(text);
  }
  return out;
}

function stripInline(s) {
  s = stripBalancedBraces(s);
  return decodeEntities(
    s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  ).trim();
}

function stripBalancedBraces(s) {
  // Walk the string and drop top-level {...} blocks, supporting nested braces
  // and quoted strings. This handles multi-line JSX like {SHELL_ENABLED && (...)}.
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < s.length && depth > 0) {
        const c = s[j];
        if (c === '"' || c === "'" || c === '`') {
          const quote = c;
          j++;
          while (j < s.length && s[j] !== quote) {
            if (s[j] === '\\') j++;
            j++;
          }
          j++;
        } else if (c === '{') {
          depth++;
          j++;
        } else if (c === '}') {
          depth--;
          j++;
        } else {
          j++;
        }
      }
      out += ' ';
      i = j;
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}

function extractBodyText(body) {
  let s = body;
  // Drop script blocks (JSON-LD).
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  // Drop style blocks (component scoped styles live in frontmatter but be safe).
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  // Drop HTML comments.
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Strip JSX expressions, brace-balanced.
  s = stripBalancedBraces(s);
  // Strip HTML/Astro tags.
  s = s.replace(/<\/?[A-Za-z][^>]*>/g, ' ');
  s = decodeEntities(s);
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function extractKeywordText(frontmatter) {
  // Grab name: '...' and text: '...' string literals from JSON-LD schemas in
  // the frontmatter (FAQPage Q/A, citation titles, MedicalCondition names,
  // articleSection labels, etc). All are useful keyword signal for semantic
  // matching; the broader extraction is intentional, not FAQ-only.
  const out = [];
  const re = /\b(?:name|text):\s*(["'])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(frontmatter)) !== null) {
    const raw = m[2].replace(/\\(['"\\])/g, '$1');
    if (raw.length > 8 && raw.length < 2000) out.push(raw);
  }
  return out.join(' ');
}

function build() {
  const entries = [];
  for (const g of GUIDES) {
    const path = join(PAGES, g.file);
    if (!existsSync(path)) {
      console.error(`Missing pillar source: ${path}`);
      process.exit(1);
    }
    const src = readFileSync(path, 'utf-8');
    const { frontmatter, body } = splitFrontmatter(src);

    const title = extractH1(body);
    const description = extractBaseLayoutDescription(body);
    const sectionHeadings = extractSectionHeadings(body);
    const bodyText = extractBodyText(body);
    const keywordText = extractKeywordText(frontmatter);

    if (!title) {
      console.error(`Failed to extract <h1> from ${g.file}`);
      process.exit(1);
    }
    if (!description) {
      console.error(`Failed to extract BaseLayout description from ${g.file}`);
      process.exit(1);
    }

    entries.push({
      slug: g.slug,
      title,
      description,
      url: `/${g.slug}/`,
      sectionHeadings,
      bodyText,
      keywordText,
    });
  }

  writeFileSync(OUT, JSON.stringify(entries, null, 2) + '\n');
  console.log(`Wrote ${entries.length} guide entries to src/data/guides.json`);
  for (const e of entries) {
    const len = (e.title + ' ' + e.description + ' ' + e.sectionHeadings.join(' ') + ' ' + e.bodyText + ' ' + e.keywordText).length;
    console.log(`  ${e.slug.padEnd(28)} h2/h3=${String(e.sectionHeadings.length).padStart(2)} text=${len}c`);
  }
}

build();
