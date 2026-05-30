/**
 * Markdown twin builder for the per-page Markdown source endpoints
 * (The Website Specification, agent-readiness "Per-page Markdown source
 * endpoints"). Produces a clean text/markdown twin of a content page so AI
 * agents fetch source instead of parsing rendered HTML.
 *
 * A twin document is: an H1 title, an optional byline/meta line, the
 * body (HTML converted to Markdown, or Markdown passed through), and a
 * footer `Source: <canonical https URL>` line. No nav, no related-cards,
 * no CTAs -- body content only (callers pass body-only HTML/Markdown).
 *
 * House rule: no em dashes in user-visible text. The HTML->MD converter
 * and source bodies can introduce them, so the final document is
 * post-processed to replace em dashes (and en dashes used as separators).
 */
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { parseMarkdown } from './markdown-sanitize.mjs';

// Single shared converter instance. Defaults keep ATX headings, fenced
// code, and standard link/emphasis markers -- exactly the clean subset we
// want for agent consumption. No custom translators needed since callers
// pass body-only HTML.
const nhm = new NodeHtmlMarkdown({
  // Use ATX (#) headings and keep output compact.
  bulletMarker: '-',
  codeBlockStyle: 'fenced',
});

/**
 * Replace em dashes per the RRM house style. Em dashes (and en dashes used
 * as sentence separators) become a spaced comma-free separator that reads
 * cleanly in plain text. En dashes inside numeric ranges (e.g. 10-20) are
 * preserved as hyphens.
 */
function stripEmDashes(text: string): string {
  return text
    // Em dash with optional surrounding spaces -> spaced hyphen separator.
    .replace(/\s*—\s*/g, ' - ')
    // En dash used as a separator between words (space-padded) -> hyphen.
    .replace(/(\S)\s+–\s+(\S)/g, '$1 - $2')
    // En dash inside a numeric range -> plain hyphen.
    .replace(/(\d)\s*–\s*(\d)/g, '$1-$2');
}

/** Collapse 3+ blank lines down to a single blank line. */
function tidyBlankLines(md: string): string {
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

export interface TwinOptions {
  /** Page H1 title. */
  title: string;
  /** Canonical absolute https URL of the source page. */
  canonicalUrl: string;
  /**
   * Body content. When `bodyFormat` is 'html' it is converted to Markdown;
   * when 'markdown' it is sanitized and rendered through the shared
   * markdown pipeline then converted back to clean Markdown so both paths
   * share the same normalization.
   */
  body: string;
  /** 'html' (FAQ publishedAnswer, glossary body_html) or 'markdown' (posts.content). */
  bodyFormat: 'html' | 'markdown';
  /** Optional byline (e.g. author name). */
  author?: string | null;
  /** Optional ISO date string for a "Published"/"Updated" meta line. */
  date?: string | null;
  /** Optional label for the date (defaults to "Published"). */
  dateLabel?: string;
}

/**
 * Convert a block of body HTML to clean Markdown.
 * Exported for the glossary builder which assembles many sections.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return tidyBlankLines(stripEmDashes(nhm.translate(html)));
}

/**
 * Build a complete markdown twin document.
 */
export async function buildMarkdownTwin(opts: TwinOptions): Promise<string> {
  const { title, canonicalUrl, body, bodyFormat, author, date, dateLabel = 'Published' } = opts;

  let bodyMd = '';
  if (body) {
    if (bodyFormat === 'html') {
      bodyMd = nhm.translate(body);
    } else {
      // posts.content is Markdown. Run it through the shared sanitize +
      // render pipeline (fixes malformed bold/links/headings) then convert
      // the resulting HTML back to clean, normalized Markdown so the twin
      // matches what the HTML page renders.
      const html = await parseMarkdown(body);
      bodyMd = nhm.translate(html);
    }
  }

  const lines: string[] = [];
  lines.push(`# ${stripEmDashes(title.trim())}`);
  lines.push('');

  const meta: string[] = [];
  if (author && author.trim()) meta.push(`By ${stripEmDashes(author.trim())}`);
  if (date && date.trim()) {
    // Normalize to YYYY-MM-DD when the value carries a time component.
    const d = date.trim().split('T')[0].split(' ')[0];
    meta.push(`${dateLabel}: ${d}`);
  }
  if (meta.length) {
    lines.push(`_${meta.join(' · ')}_`);
    lines.push('');
  }

  if (bodyMd) {
    lines.push(tidyBlankLines(stripEmDashes(bodyMd)));
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`Source: ${canonicalUrl}`);
  lines.push('');

  return stripEmDashes(lines.join('\n')).replace(/\n{3,}/g, '\n\n');
}

/** Standard headers for a markdown twin Response. */
export const MARKDOWN_HEADERS = {
  'Content-Type': 'text/markdown; charset=utf-8',
};
