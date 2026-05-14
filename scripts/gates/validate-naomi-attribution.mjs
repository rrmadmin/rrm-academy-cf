#!/usr/bin/env node
import fs from 'node:fs';

const ATTR_REGEX = /\b(Naomi|Whit{1,2}aker|MIGS|NFPMC|0000-0003-3706-3112|1881034908|rrm-spotlight-naomi-whittaker)\b/g;

// Strip every <div class="... classToken ..."> ... </div> block from html,
// tracking nested <div>/</div> depth so the WHOLE wrapper is removed even when
// it contains child <div>s. Used to allowlist the canonical author-byline DOM
// (which has nested author-avatar-stack + author-byline__text has-reviewer
// children) per spec D49.
export function stripDivByClass(html, classToken) {
  const tagRe = /<(\/)?div\b([^>]*)>/g;
  const parts = [];
  let lastIdx = 0;
  let depth = 0;
  let m;

  while ((m = tagRe.exec(html)) !== null) {
    const isClose = m[1] === '/';
    if (depth === 0) {
      if (!isClose) {
        const classMatch = m[2].match(/\bclass\s*=\s*"([^"]*)"/);
        if (classMatch && classMatch[1].split(/\s+/).includes(classToken)) {
          parts.push(html.slice(lastIdx, m.index));
          depth = 1;
        }
      }
    } else {
      depth += isClose ? -1 : 1;
      if (depth === 0) {
        lastIdx = tagRe.lastIndex;
      }
    }
  }
  parts.push(html.slice(lastIdx));
  return parts.join('');
}

export function checkNaomiAttribution(html, opts) {
  // Allowlist (per spec D49):
  // 1. <div class="author-byline">...</div> — canonical glossary-style wrapper
  //    containing nested author-avatar-stack + author-byline__text has-reviewer
  // 2. <div class="byline">...</div> — legacy simple byline wrapper
  // 3. <header> blocks (site/page chrome)
  // 4. JSON-LD <script type="application/ld+json"> blocks (Naomi @id in
  //    author / reviewedBy graph nodes is permitted)
  let stripped = stripDivByClass(html, 'author-byline');
  stripped = stripDivByClass(stripped, 'byline');
  stripped = stripped
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi, '');

  const matches = [...stripped.matchAll(ATTR_REGEX)];
  if (matches.length === 0) return { ok: true };
  const hits = matches.map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i);
  return { ok: false, error: `body prose contains Naomi attribution: ${hits.join(', ')}` };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(\w[\w-]*)(=(.*))?$/);
    if (!m) continue;
    const key = m[1];
    if (m[2] !== undefined) {
      out[key] = m[3];
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[key] = argv[++i];
    } else {
      out[key] = true;
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file || args.f;
  if (!filePath || !args.pillar) {
    console.error('Usage: validate-naomi-attribution.mjs --file=dist/PILLAR/index.html --pillar=PILLAR_SLUG');
    process.exit(2);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  const html = fs.readFileSync(filePath, 'utf8');
  const result = checkNaomiAttribution(html, args);
  if (result.ok) {
    console.log(`OK: ${args.pillar} clean`);
    process.exit(0);
  } else {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }
}
