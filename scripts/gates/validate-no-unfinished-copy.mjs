#!/usr/bin/env node
// Gate: no ACCIDENTAL unfinished-state markers in shipped page/component markup.
// Born 2026-07-19 after a session found three condition guides ("actively edited
// … may change over the next few days"), stale "Soon" nav pills for live tools,
// and an "Owner TBC" placeholder — all leaked to production. Enforces the
// no-status-confessions rule (memory feedback-no-operational-promises-in-copy).
//
// SCOPE — this bans ACCIDENTAL leftovers, NOT deliberate product states:
//   • "Coming Soon" is a DESIGNED state (unreleased courses, partner tiers,
//     pending audio, unwritten guides) and is explicitly NOT banned.
//   • The FABM guides' authored "A quick note … still being reviewed" notice is
//     intentional publish-early copy and is NOT matched (different phrasing).
// Banned markers are the ones that read as dev/editorial debris:
//   actively edited · Owner TBC · lorem ipsum · visible TODO/FIXME · placeholder
//   text · a stale "Soon" status pill.
// Add a false positive to scripts/gates/unfinished-copy-allowlist.txt (one
// substring per line) if a match is legitimate.
import fs from 'node:fs';
import path from 'node:path';

const SCAN_DIRS = ['src/pages', 'src/components'];
const ALLOWLIST_PATH = 'scripts/gates/unfinished-copy-allowlist.txt';

// Each rule: a regex + a human label. Patterns target VISIBLE text or known
// leftover phrasings, not code comments (those are stripped first).
const RULES = [
  { label: 'editorial "actively edited" confession', re: /actively edited/i },
  { label: '"Owner TBC" placeholder', re: /\bOwner TBC\b/i },
  { label: 'lorem ipsum filler', re: /lorem ipsum/i },
  { label: 'visible TODO/FIXME marker', re: />[^<]*\b(TODO|FIXME)\b[^<]*</ },
  { label: '"placeholder text" copy', re: /placeholder text/i },
  // A stale status pill: "Soon" (not "Coming Soon") inside a pill/badge span.
  { label: 'stale "Soon" status pill', re: /class="[^"]*(pill|badge)[^"]*"[^>]*>\s*Soon\s*</i },
];

// Strip HTML/JS comments and the Astro frontmatter fence so TODO-in-a-comment
// and doc prose never trip the gate — only shipped markup/strings are scanned.
function stripComments(src) {
  return src
    .replace(/^---[\s\S]*?\n---/, '') // Astro frontmatter (imports, consts, JSDoc)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function collect(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(full));
    else if (e.name.endsWith('.astro')) out.push(full);
  }
  return out;
}

export function checkSource(src, rules = RULES) {
  const body = stripComments(src);
  const hits = [];
  for (const rule of rules) {
    const m = body.match(rule.re);
    if (m) hits.push({ label: rule.label, match: m[0].replace(/\s+/g, ' ').slice(0, 60) });
  }
  return hits;
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return [];
  return fs
    .readFileSync(ALLOWLIST_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const allow = loadAllowlist();
  const files = SCAN_DIRS.flatMap(collect);
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (allow.some((a) => src.includes(a))) continue; // file-level allowlist by substring
    for (const hit of checkSource(src)) {
      offenders.push({ file: f, ...hit });
    }
  }
  if (offenders.length) {
    console.error(`FAIL: ${offenders.length} unfinished-state marker(s) in shipped markup:`);
    for (const o of offenders) {
      console.error(`  ${o.file}: ${o.label} -> "${o.match}"`);
    }
    console.error(`If a match is legitimate, add a unique substring of it to ${ALLOWLIST_PATH}.`);
    process.exit(1);
  }
  console.log(`OK: no unfinished-state markers in ${files.length} page/component file(s)`);
  process.exit(0);
}
