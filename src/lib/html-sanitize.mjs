// HTML sanitizer for Airtable / manual / D1 HTML content (FAQs, glossary).
// Sibling to markdown-sanitize.ts. Editorial cleanup only, not user input.
// .mjs so it can be imported from both Astro pages and node fetch scripts.

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isDangerousUri(href) {
  if (!href) return false;
  let normalized = href.trim();
  normalized = normalized
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
  try { normalized = decodeURIComponent(normalized); } catch {}
  normalized = normalized.replace(/[\x00-\x20\x7f --​-‏﻿]/g, '');
  return /^(javascript|data|vbscript|file|blob|filesystem):/i.test(normalized);
}

export function sanitizeHtml(html) {
  if (!html) return '';
  let result = html;

  // Strip Word/Outlook paste artifacts.
  result = result
    .replace(/<\/?o:p[^>]*>/gi, '')
    .replace(/<\/?(font|style|meta|link|xml)[^>]*>/gi, '')
    .replace(/\s+class="MsoNormal"/gi, '')
    .replace(/\s+lang="[^"]*"/gi, '')
    .replace(/\s+style="[^"]*mso-[^"]*"/gi, '');

  // Decode common double-encoded entities.
  result = result
    .replace(/&amp;amp;/g, '&amp;')
    .replace(/&amp;nbsp;/g, '&nbsp;')
    .replace(/&amp;quot;/g, '&quot;');

  // Neutralize dangerous href / src.
  result = result.replace(/(<a\b[^>]*?\shref\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, prefix, _q, dq, sq, uq) => {
    const href = dq ?? sq ?? uq ?? '';
    if (isDangerousUri(href)) return prefix + '"#"';
    return prefix + `"${escapeAttr(href)}"`;
  });
  result = result.replace(/(<img\b[^>]*?\ssrc\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, prefix, _q, dq, sq, uq) => {
    const src = dq ?? sq ?? uq ?? '';
    if (isDangerousUri(src)) return prefix + '""';
    return prefix + `"${escapeAttr(src)}"`;
  });

  // Strip <script> blocks entirely (editorial content should never have these).
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  // Strip on* event handler attributes.
  result = result.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');

  // Collapse runs of &nbsp; and trailing &nbsp; in text nodes.
  result = result.replace(/(?:&nbsp;){2,}/g, ' ');
  result = result.replace(/(\s)&nbsp;/g, '$1');
  result = result.replace(/&nbsp;(\s)/g, '$1');

  // Remove empty paragraphs in their common shapes.
  result = result.replace(/<p>\s*<\/p>/gi, '');
  result = result.replace(/<p>\s*&nbsp;\s*<\/p>/gi, '');
  result = result.replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, '');

  // Collapse runs of whitespace inside text (not inside attributes -- naive but good enough).
  result = result.replace(/>\s{2,}</g, '> <');

  // Trim leading/trailing whitespace.
  result = result.trim();

  return result;
}

const DIRTY_PATTERNS = [
  /<\/?o:p/i,
  /<\/?font\b/i,
  /class="MsoNormal"/i,
  /&amp;amp;/,
  /&amp;nbsp;/,
  /<p>\s*(?:&nbsp;|<br\s*\/?>)?\s*<\/p>/i,
  /(?:&nbsp;){2,}/,
  /<script\b/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
];

export function looksDirty(html) {
  if (!html) return false;
  return DIRTY_PATTERNS.some((re) => re.test(html));
}
