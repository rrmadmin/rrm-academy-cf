#!/usr/bin/env node
// Gate: commentary post bodies (posts.content) must be MARKDOWN, never HTML.
// Born 2026-07-19 after the 2026-07-10 burn: a post inserted into D1 as
// <p>-wrapped HTML rendered as a wall of visible literal tags on the live page,
// because the template runs parseMarkdown() over the body. This gate fails if
// any post body contains block-level HTML, which is the unambiguous signal that
// the whole body was pasted as HTML rather than authored as Markdown.
//
// Inline tags (<br>, <sub>, <sup>, <em>, <strong>, <a>, <code>, <mark>) are
// tolerated — Markdown allows raw inline HTML and these render fine. Block tags
// (<p>, <div>, <h1..6>, <ul>/<ol>/<li>, <table>/<tr>/<td>, <blockquote>,
// <section>, <article>, <figure>) mean the body is HTML, not Markdown.
import fs from 'node:fs';

const DEFAULT_DATA = 'src/data/posts.json';

const BLOCK_HTML =
  /<\s*(p|div|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|section|article|figure|figcaption|header|footer|main|aside|pre)\b[^>]*>/i;

export function checkPosts(posts) {
  const offenders = [];
  for (const p of posts) {
    if (!p || typeof p.content !== 'string') continue;
    const m = p.content.match(BLOCK_HTML);
    if (m) {
      const idx = m.index || 0;
      offenders.push({
        slug: p.slug || p.id || '(unknown)',
        tag: m[0],
        context: p.content.slice(Math.max(0, idx - 20), idx + 40).replace(/\s+/g, ' '),
      });
    }
  }
  return offenders;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(\w[\w-]*)(=(.*))?$/);
    if (!m) continue;
    if (m[2] !== undefined) out[m[1]] = m[3];
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[m[1]] = argv[++i];
    else out[m[1]] = true;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const dataPath = args.data || args.file || DEFAULT_DATA;
  if (!fs.existsSync(dataPath)) {
    console.error(`Data file not found: ${dataPath}`);
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const posts = Array.isArray(raw) ? raw : raw.posts || Object.values(raw);
  const offenders = checkPosts(posts);
  if (offenders.length) {
    console.error(`FAIL: ${offenders.length} commentary post(s) contain block-level HTML (must be Markdown):`);
    for (const o of offenders) {
      console.error(`  ${o.slug}: ${o.tag} in "…${o.context}…"`);
    }
    console.error('Re-store the post body as Markdown (** for bold, ## for headings, [text](url) for links).');
    process.exit(1);
  }
  console.log(`OK: all ${posts.length} commentary post bodies are Markdown (no block HTML)`);
  process.exit(0);
}
