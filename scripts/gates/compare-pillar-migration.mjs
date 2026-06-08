// scripts/gates/compare-pillar-migration.mjs
// Usage: node scripts/gates/compare-pillar-migration.mjs <pre.html> <post.html> [--slug <slug>] [--guides-pre <file>] [--guides-post <file>]
// Exit 0 = additive-only; exit 1 = a removal/change detected.
import { readFileSync } from 'fs';

// Astro stamps a per-component-FILE scope hash (data-astro-cid-<hash>) on every
// element of a scoped template. When byline markup moves from a page file to the
// PillarLayout file, that hash VALUE changes legitimately. Strip it everywhere
// before any structural HTML compare so it is never mistaken for a real change.
const stripAstroCid = (s) => s.replace(/\s+data-astro-cid-[a-z0-9]+(="[^"]*")?/gi, '');

export function extractLdJson(html) {
  const nodes = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let obj;
    try { obj = JSON.parse(m[1].trim()); } catch { continue; }
    const graph = obj['@graph'] && Array.isArray(obj['@graph']) ? obj['@graph'] : [obj];
    for (const node of graph) nodes.push(node);
  }
  return nodes;
}
const nodeKey = (n) => {
  const t = Array.isArray(n['@type']) ? n['@type'].join('+') : (n['@type'] || '?');
  return n['@id'] || `${t}::${n.headline || n.name || ''}`;
};
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}
const canon = (v) => JSON.stringify(sortDeep(v));

export function extractHead(html) {
  const head = stripAstroCid((html.match(/<head[\s\S]*?<\/head>/i) || [''])[0]);
  const metas = [...head.matchAll(/<meta\s[^>]*>/gi)].map((m) => m[0].replace(/\s+/g, ' ').trim());
  const links = [...head.matchAll(/<link\s[^>]*>/gi)].map((m) => m[0].replace(/\s+/g, ' ').trim());
  const title = (head.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
  return { title, metas: metas.sort(), links: links.sort() };
}
export function extractBodyAttrs(html) {
  const tag = stripAstroCid((html.match(/<body\b[^>]*>/i) || [''])[0]);
  return [...tag.matchAll(/[a-z-]+(?:="[^"]*")?/gi)].map((m) => m[0]).filter((a) => a !== 'body').sort();
}
export function extractByline(html) {
  const m = html.match(/<div class="author-byline"[^>]*>[\s\S]*?<\/div>\s*<\/div>/i);
  return m ? stripAstroCid(m[0]).replace(/\s+/g, ' ').trim() : '';
}

export function compare(preHtml, postHtml) {
  const issues = [];
  const pre = extractLdJson(preHtml);
  const post = extractLdJson(postHtml);
  const postByKey = new Map(post.map((n) => [nodeKey(n), n]));
  for (const n of pre) {
    const k = nodeKey(n);
    if (k.startsWith('BreadcrumbList')) continue; // the one sanctioned page->layout move
    if (!postByKey.has(k)) { issues.push(`JSON-LD node removed: ${k}`); continue; }
    if (canon(postByKey.get(k)) !== canon(n)) issues.push(`JSON-LD node changed: ${k}`);
  }
  const bcCount = post.filter((n) => nodeKey(n).startsWith('BreadcrumbList')).length;
  if (bcCount !== 1) issues.push(`expected exactly 1 BreadcrumbList post-migration, found ${bcCount}`);
  const h0 = extractHead(preHtml), h1 = extractHead(postHtml);
  if (h0.title !== h1.title) issues.push(`<title> changed: "${h0.title}" -> "${h1.title}"`);
  if (JSON.stringify(h0.metas) !== JSON.stringify(h1.metas)) issues.push('<head> <meta> set changed');
  if (JSON.stringify(h0.links) !== JSON.stringify(h1.links)) issues.push('<head> <link> set changed');
  if (JSON.stringify(extractBodyAttrs(preHtml)) !== JSON.stringify(extractBodyAttrs(postHtml)))
    issues.push('<body> attribute set changed (trackScroll/etc)');
  if (extractByline(preHtml) !== extractByline(postHtml)) issues.push('byline DOM changed');
  return issues;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [pre, post] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const gi = process.argv.indexOf('--guides-pre'), gj = process.argv.indexOf('--guides-post'), si = process.argv.indexOf('--slug');
  const issues = compare(readFileSync(pre, 'utf-8'), readFileSync(post, 'utf-8'));
  if (gi > -1 && gj > -1 && si > -1) {
    const slug = process.argv[si + 1];
    const g0 = JSON.parse(readFileSync(process.argv[gi + 1], 'utf-8')).find((g) => g.slug === slug);
    const g1 = JSON.parse(readFileSync(process.argv[gj + 1], 'utf-8')).find((g) => g.slug === slug);
    if (!g0 || !g1) issues.push(`guides.json entry for ${slug} missing in pre or post`);
    else {
      if (g0.title !== g1.title) issues.push(`guides.json title changed: "${g0.title}" -> "${g1.title}"`);
      if (g0.description !== g1.description) issues.push(`guides.json description changed`);
    }
  }
  if (issues.length) { console.error(`NOT ADDITIVE (${issues.length}):`); for (const i of issues) console.error('  - ' + i); process.exit(1); }
  console.log('ADDITIVE: pre == post for all schema nodes, head, body, byline' + (gi > -1 ? ', guides.json' : ''));
  process.exit(0);
}
