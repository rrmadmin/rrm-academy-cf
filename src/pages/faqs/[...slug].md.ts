/**
 * Per-page Markdown source endpoint for FAQ detail pages.
 * Output URLs: /faqs/<slug>.md
 *
 * Mirrors the published-FAQ logic in src/pages/faqs/[...slug].astro
 * (fetchAllFaqs returns only published FAQs from faqs.json). Returns a
 * clean text/markdown twin of the published answer so AI agents fetch
 * source instead of parsing rendered HTML.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { fetchAllFaqs, type FAQ } from '../../lib/faq';
import { buildMarkdownTwin, MARKDOWN_HEADERS } from '../../lib/markdown-twin';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const faqs = await fetchAllFaqs();
  return faqs.map((faq) => ({
    params: { slug: faq.slug },
    props: { faq },
  }));
};

interface Props {
  faq: FAQ;
}

export const GET: APIRoute = async ({ props }) => {
  const { faq } = props as Props;

  // publishedAnswer is HTML (Airtable/D1-sourced, h3 subheadings). The .astro
  // page promotes h3->h2 for heading hierarchy under the question h1; do the
  // same here so the twin's heading levels match the rendered page.
  const bodyHtml = (faq.publishedAnswer || faq.basicAnswer || '').replace(/<(\/?)h3/g, '<$1h2');

  const markdown = await buildMarkdownTwin({
    title: faq.question,
    canonicalUrl: `https://rrmacademy.org/faqs/${faq.slug}/`,
    body: bodyHtml,
    bodyFormat: 'html',
    date: faq.updatedAt,
    dateLabel: 'Updated',
  });

  return new Response(markdown, { headers: MARKDOWN_HEADERS });
};
