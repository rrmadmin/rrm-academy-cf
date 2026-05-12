/**
 * Embed all site content into Cloudflare Vectorize via Workers AI.
 *
 * Runs as a Cloudflare Worker (via wrangler dev) to use AI + VECTORIZE bindings
 * directly with wrangler's OAuth auth -- no separate API token needed.
 *
 * Usage:
 *   npm run embed          # starts worker, triggers embed, shuts down
 *
 * Or manually:
 *   npx wrangler dev scripts/embed-library.mjs --compatibility-date 2025-01-01
 *   curl http://localhost:8787/embed
 */

import articles from '../src/data/articles.json';

// Optional imports -- these files may not exist locally
let posts = [], faqs = [], courses = [], glossary = { terms: [] }, guides = [];
try { posts = (await import('../src/data/posts.json', { with: { type: 'json' } })).default; } catch {}
try { faqs = (await import('../src/data/faqs.json', { with: { type: 'json' } })).default; } catch {}
try { courses = (await import('../src/data/courses.json', { with: { type: 'json' } })).default; } catch {}
try { glossary = (await import('../src/data/glossary.json', { with: { type: 'json' } })).default; } catch {}
try { guides = (await import('../src/data/guides.json', { with: { type: 'json' } })).default; } catch {}

const BATCH_SIZE = 100;
const MAX_TEXT_LEN = 2000;
const MODEL = '@cf/baai/bge-base-en-v1.5';
const MAX_ID_LEN = 64;

const enc = new TextEncoder();
function vectorId(slug) {
  if (enc.encode(slug).length <= MAX_ID_LEN) return slug;
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hash = (h >>> 0).toString(16).padStart(8, '0');
  const maxPrefix = MAX_ID_LEN - 9;
  let prefix = slug;
  while (enc.encode(prefix).length > maxPrefix) {
    prefix = prefix.slice(0, -1);
  }
  return prefix + '-' + hash;
}

function buildEntries() {
  const entries = [];

  for (const a of articles) {
    if (!a.slug || !a.title) continue;
    const parts = [a.title];
    if (a.domain) parts.push(`Domain: ${a.domain}`);
    if (a.topics && a.topics.length) parts.push(`Topics: ${a.topics.join('; ')}`);
    if (a.searchTerms && a.searchTerms.length) parts.push(a.searchTerms.join(', '));
    if (a.abstract) parts.push(a.abstract);
    entries.push({
      id: a.id, slug: a.slug, text: parts.join('. '),
      type: 'Research', url: `/library/${a.slug}/`,
      title: a.title, year: a.year || null, authors: a.shortCitation || '',
    });
  }
  for (const p of posts) {
    if (!p.slug || !p.title) continue;
    const parts = [p.title];
    if (p.seoKeywords) parts.push(p.seoKeywords);
    if (p.excerpt) parts.push(p.excerpt);
    if (p.content) parts.push(p.content.replace(/[#*_\[\]()]/g, ' ').replace(/\s+/g, ' '));
    entries.push({
      slug: `post-${p.slug}`, text: parts.join('. '),
      type: 'Article', url: `/commentary/${p.slug}/`,
      title: p.title, year: p.publishDate ? new Date(p.publishDate).getFullYear() : null, authors: p.author || '',
    });
  }
  for (const f of faqs) {
    if (!f.slug || !f.question) continue;
    const parts = [f.question];
    if (f.category) parts.push(`Category: ${f.category}`);
    if (f.publishedAnswer) parts.push(f.publishedAnswer.replace(/[#*_\[\]()]/g, ' ').replace(/\s+/g, ' '));
    else if (f.basicAnswer) parts.push(f.basicAnswer);
    entries.push({
      slug: `faq-${f.slug}`, text: parts.join('. '),
      type: 'FAQ', url: `/faqs/${f.slug}/`,
      title: f.question, year: null, authors: '',
    });
  }
  for (const c of courses) {
    if (!c.slug || !c.title) continue;
    const parts = [c.title];
    if (c.description) parts.push(c.description);
    if (c.sections) {
      const sectionTitles = c.sections.map(s => s.title || '').filter(Boolean);
      if (sectionTitles.length) parts.push('Sections: ' + sectionTitles.join(', '));
    }
    if (c.seo && c.seo.keywords) parts.push(c.seo.keywords);
    entries.push({
      slug: `course-${c.slug}`, text: parts.join('. '),
      type: 'Course', url: `/courses/${c.slug}/`,
      title: c.title, year: null, authors: '',
    });
  }

  for (const t of glossary.terms || []) {
    if (!t.slug || !t.name) continue;
    const stripped = (t.bodyHtml || '').replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = [t.name];
    if (stripped) parts.push(stripped);
    entries.push({
      slug: `glossary-${t.slug}`, text: parts.join('. '),
      type: 'Glossary', url: `/glossary/${t.slug}/`,
      title: t.name, year: null, authors: '',
    });
  }

  for (const g of guides) {
    if (!g.slug || !g.title) continue;
    const parts = [g.title];
    if (g.description) parts.push(g.description);
    if (g.sectionHeadings && g.sectionHeadings.length) parts.push('Sections: ' + g.sectionHeadings.join(', '));
    if (g.keywordText) parts.push(g.keywordText);
    if (g.bodyText) parts.push(g.bodyText);
    entries.push({
      slug: `guide-${g.slug}`, text: parts.join('. '),
      type: 'Guide', url: g.url,
      title: g.title, year: null, authors: '',
    });
  }

  return entries;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/embed') {
      return new Response('GET /embed to start embedding', { status: 200 });
    }

    const logs = [];
    function log(msg) { logs.push(msg); }

    try {
      const entries = buildEntries();
      const startFrom = parseInt(url.searchParams.get('start') || '0');
      log(`Found ${entries.length} entries (${articles.length} articles, ${posts.length} posts, ${faqs.length} FAQs, ${courses.length} courses, ${(glossary.terms || []).length} glossary terms, ${guides.length} guides). Starting from ${startFrom}.`);
      let embedded = startFrom;

      for (let i = startFrom; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const texts = batch.map(e => e.text.slice(0, MAX_TEXT_LEN));
        const result = await env.AI.run(MODEL, { text: texts });
        const embeddings = result?.data;
        if (!embeddings || !embeddings.length) {
          log(`Warning: AI returned no embeddings for batch at index ${i}, skipping`);
          continue;
        }

        const vectors = batch.map((e, idx) => {
          const metadata = { slug: e.slug, title: e.title, authors: e.authors, type: e.type, url: e.url };
          if (e.year !== null) metadata.year = e.year;
          return { id: e.id || vectorId(e.slug), values: embeddings[idx], metadata };
        });

        await env.VECTORIZE.upsert(vectors);
        embedded += batch.length;
        log(`Embedded ${embedded}/${entries.length}...`);
      }

      log('Done. All content embedded.');
      return new Response(logs.join('\n'), {
        headers: { 'Content-Type': 'text/plain' },
      });
    } catch (err) {
      log(`Error: ${err.message}`);
      return new Response(logs.join('\n') + '\n\nFATAL: ' + err.stack, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
};
