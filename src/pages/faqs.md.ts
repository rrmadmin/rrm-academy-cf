/**
 * Full-FAQ-hub Markdown source endpoint.
 * Output URL: /faqs.md
 *
 * One markdown document covering every PUBLISHED FAQ (grouped by category in
 * the same fixed order as the rendered hub: Foundational, Condition-Specific,
 * Common Concerns), with each question's full published answer. Mirrors the
 * published-only invariant in src/pages/faqs.astro (fetchAllFaqs returns only
 * published FAQs from faqs.json). Companion to the per-question twins at
 * /faqs/<slug>.md; this is the single full-corpus hub twin (same pattern as
 * /glossary.md for the glossary).
 *
 * Returns text/markdown so AI agents fetch source instead of parsing the
 * rendered FAQ hub HTML.
 */
import type { APIRoute } from 'astro';
import { fetchAllFaqs, groupByCategory } from '../lib/faq';
import { htmlToMarkdown, MARKDOWN_HEADERS } from '../lib/markdown-twin';

export const prerender = true;

const CANONICAL = 'https://rrmacademy.org/faqs/';

export const GET: APIRoute = async () => {
  const faqs = await fetchAllFaqs();
  const groups = groupByCategory(faqs);

  const lines: string[] = [];

  lines.push('# Frequently Asked Questions about Restorative Reproductive Medicine');
  lines.push('');
  lines.push(
    '_Answers to common questions about Restorative Reproductive Medicine (RRM), NaProTechnology, fertility charting, treatment approaches, success rates, and costs. By RRM Academy. Reviewed by Dr. Naomi Whittaker, MD._'
  );
  lines.push('');

  for (const group of groups) {
    lines.push(`## ${group.category}`);
    lines.push('');

    for (const faq of group.faqs) {
      lines.push(`### ${faq.question}`);
      lines.push('');
      // publishedAnswer is HTML with h3 subheadings. Under an h3 question
      // heading here, demote answer h3s to h4 so heading levels stay nested
      // (the per-question twin at /faqs/<slug>.md promotes them to h2 under
      // its h1 instead).
      const bodyHtml = (faq.publishedAnswer || faq.basicAnswer || '').replace(/<(\/?)h3/g, '<$1h4');
      const bodyMd = htmlToMarkdown(bodyHtml);
      if (bodyMd) {
        lines.push(bodyMd);
        lines.push('');
      }
      lines.push(
        `Canonical page: https://rrmacademy.org/faqs/${faq.slug}/ (markdown twin: https://rrmacademy.org/faqs/${faq.slug}.md)`
      );
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`Source: ${CANONICAL}`);
  lines.push('');

  // House rule: no em dashes. htmlToMarkdown already strips per-body; strip
  // the assembled document too (covers headings and link/label text).
  const markdown = lines
    .join('\n')
    .replace(/\s*—\s*/g, ' - ')
    .replace(/(\S)\s+–\s+(\S)/g, '$1 - $2')
    .replace(/(\d)\s*–\s*(\d)/g, '$1-$2')
    .replace(/\n{3,}/g, '\n\n');

  return new Response(markdown, { headers: MARKDOWN_HEADERS });
};
