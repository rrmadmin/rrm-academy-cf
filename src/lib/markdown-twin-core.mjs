/**
 * Core HTML -> Markdown helpers shared by the TypeScript twin builder
 * (src/lib/markdown-twin.ts, used by the .md.ts endpoints) and the
 * build-time integrations (src/integrations/agent-md-surfaces.mjs), which
 * run as plain .mjs and cannot import .ts modules.
 *
 * House rule: no em dashes in user-visible text. The HTML->MD converter and
 * source bodies can introduce them, so converted output is post-processed.
 */
import { NodeHtmlMarkdown } from 'node-html-markdown';

// Single shared converter instance. Defaults keep ATX headings, fenced code,
// and standard link/emphasis markers -- exactly the clean subset we want for
// agent consumption.
const nhm = new NodeHtmlMarkdown({
  bulletMarker: '-',
  codeBlockStyle: 'fenced',
});

/**
 * Replace em dashes per the RRM house style. Em dashes (and en dashes used
 * as sentence separators) become a spaced hyphen separator that reads
 * cleanly in plain text. En dashes inside numeric ranges (e.g. 10-20) are
 * preserved as hyphens.
 */
export function stripEmDashes(text) {
  return text
    .replace(/\s*—\s*/g, ' - ')
    .replace(/(\S)\s+–\s+(\S)/g, '$1 - $2')
    .replace(/(\d)\s*–\s*(\d)/g, '$1-$2');
}

/** Collapse 3+ blank lines down to a single blank line. */
export function tidyBlankLines(md) {
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

/** Raw converter access for callers that post-process themselves. */
export function translateHtml(html) {
  return nhm.translate(html || '');
}

/** Convert a block of body HTML to clean, house-styled Markdown. */
export function htmlToMarkdown(html) {
  if (!html) return '';
  return tidyBlankLines(stripEmDashes(nhm.translate(html)));
}
