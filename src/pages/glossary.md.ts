/**
 * Full-glossary Markdown source endpoint.
 * Output URL: /glossary.md
 *
 * One markdown document covering every PUBLISHED glossary term (grouped by
 * Part, ordered by sort_order within each Part), the abbreviations table,
 * and the references list. Mirrors the published-only filter in
 * src/pages/glossary/index.astro (status === 'published'). Per-term spoke
 * .md endpoints are Wave 3; this is the single full-corpus twin.
 *
 * Returns text/markdown so AI agents fetch source instead of parsing the
 * rendered glossary HTML.
 */
import type { APIRoute } from 'astro';
import glossaryData from '../data/glossary.json';
import { htmlToMarkdown, MARKDOWN_HEADERS } from '../lib/markdown-twin';

export const prerender = true;

interface GlossaryTerm {
  id: string;
  slug: string;
  name: string;
  part: string;
  sortOrder: number;
  bodyHtml: string;
  abbreviation: string | null;
  pillarLink: string | null;
  status: string;
}
interface GlossaryReference {
  refNum: number;
  anchorText: string;
  url: string;
  publisher: string | null;
  journal: string | null;
}
interface GlossaryAbbreviation {
  abbreviation: string;
  fullTerm: string;
  termSlug: string | null;
  sortOrder: number;
}

// Part metadata mirrors src/pages/glossary/index.astro PARTS ordering.
const PARTS: { part: string; title: string }[] = [
  { part: 'I', title: 'Part I: Core RRM Principles' },
  { part: 'II', title: 'Part II: Fertility Awareness and Charting Methods' },
  { part: 'III', title: 'Part III: Clinical Approaches' },
  { part: 'IV', title: 'Part IV: Diagnostic Tools and Techniques' },
  { part: 'V', title: 'Part V: Surgical Techniques' },
  { part: 'VI', title: 'Part VI: Key Conditions Addressed by RRM' },
  { part: 'VII', title: 'Part VII: Overlapping Disciplines' },
  { part: 'VIII', title: 'Part VIII: The Broader RRM Framework' },
];

const CANONICAL = 'https://rrmacademy.org/glossary/';

export const GET: APIRoute = async () => {
  // Published terms only (same invariant as the rendered page).
  const terms: GlossaryTerm[] = (glossaryData.terms ?? []).filter(
    (t: GlossaryTerm) => t.status === 'published'
  );
  const references: GlossaryReference[] = (glossaryData.references ?? []) as GlossaryReference[];
  const abbreviations: GlossaryAbbreviation[] = ((glossaryData.abbreviations ?? []) as GlossaryAbbreviation[])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const lines: string[] = [];

  lines.push('# RRM Glossary: A Detailed Reference to Restorative Reproductive Medicine');
  lines.push('');
  lines.push(
    '_An evidence-based glossary of Restorative Reproductive Medicine (RRM) terminology covering core principles, fertility awareness methods, NaProTechnology, diagnostic tools, surgical techniques, key conditions, and abbreviations. By RRM Academy. Reviewed by Dr. Naomi Whittaker, MD._'
  );
  lines.push('');

  // Group terms by Part, ordered by sortOrder within each Part.
  for (const { part, title } of PARTS) {
    const partTerms = terms
      .filter((t) => t.part === part)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (partTerms.length === 0) continue;

    lines.push(`## ${title}`);
    lines.push('');

    for (const term of partTerms) {
      // Append the abbreviation only when the name doesn't already carry it
      // (64 of the term names already include their abbreviation in parens).
      const heading =
        term.abbreviation && !term.name.includes(term.abbreviation)
          ? `${term.name} (${term.abbreviation})`
          : term.name;
      lines.push(`### ${heading}`);
      lines.push('');
      const bodyMd = htmlToMarkdown(term.bodyHtml || '');
      if (bodyMd) {
        lines.push(bodyMd);
        lines.push('');
      }
    }
  }

  // Abbreviations table.
  if (abbreviations.length) {
    lines.push('## Abbreviations');
    lines.push('');
    lines.push('| Abbreviation | Full term |');
    lines.push('| --- | --- |');
    for (const a of abbreviations) {
      const abbr = (a.abbreviation || '').replace(/\|/g, '\\|');
      const full = (a.fullTerm || '').replace(/\|/g, '\\|');
      lines.push(`| ${abbr} | ${full} |`);
    }
    lines.push('');
  }

  // References list.
  if (references.length) {
    lines.push('## References');
    lines.push('');
    const sorted = references.slice().sort((a, b) => (a.refNum ?? 0) - (b.refNum ?? 0));
    for (const r of sorted) {
      const cite = [r.anchorText, r.journal, r.publisher].filter(Boolean).join('. ');
      const text = r.url ? `[${cite}](${r.url})` : cite;
      lines.push(`${r.refNum}. ${text}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`Source: ${CANONICAL}`);
  lines.push('');

  // House rule: no em dashes. htmlToMarkdown already strips per-body; strip
  // the assembled document too (covers headings, abbr/ref text).
  const markdown = lines
    .join('\n')
    .replace(/\s*—\s*/g, ' - ')
    .replace(/(\S)\s+–\s+(\S)/g, '$1 - $2')
    .replace(/(\d)\s*–\s*(\d)/g, '$1-$2')
    .replace(/\n{3,}/g, '\n\n');

  return new Response(markdown, { headers: MARKDOWN_HEADERS });
};
