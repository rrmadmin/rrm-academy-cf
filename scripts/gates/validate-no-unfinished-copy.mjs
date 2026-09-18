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
// Add a false positive to scripts/gates/unfinished-copy-allowlist.txt if a
// match is legitimate: one substring of the real copy per line, and it must
// CONTAIN the match it excuses. Suppression is positional and silences only
// the matches inside that substring.
//
// Until 2026-09-18 it was file-level -- any listed substring appearing anywhere
// in a file skipped that file's six rules entirely, so one legitimate phrase
// exempted the whole page. The list was empty at the time, so nothing was
// actually being suppressed when it was fixed.
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

/** Every rule match in `src`, with its index into the STRIPPED body.
 *
 *  Returns ALL occurrences, not the first per rule: two lorem-ipsum blocks in
 *  one file are two things to fix, and the index is what lets the driver
 *  suppress one of them without suppressing the other. */
export function checkSource(src, rules = RULES) {
  const body = stripComments(src);
  const hits = [];
  for (const rule of rules) {
    // Rules are authored as non-global literals, so clone with /g rather than
    // mutating the shared RegExp: a /g literal in RULES would carry lastIndex
    // between files and silently skip matches.
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`);
    for (const m of body.matchAll(re)) {
      hits.push({
        label: rule.label,
        match: m[0].replace(/\s+/gu, ' ').slice(0, 60),
        index: m.index,
        end: m.index + m[0].length,
      });
    }
  }
  return hits;
}

/** Character spans in `body` covered by an allowlist entry, all occurrences. */
export function allowedSpans(body, allow) {
  const spans = [];
  for (const entry of allow) {
    let from = 0;
    for (;;) {
      const at = body.indexOf(entry, from);
      if (at === -1) break;
      spans.push([at, at + entry.length]);
      from = at + 1;
    }
  }
  return spans;
}

/** True when a hit lies entirely inside an allowlisted span.
 *
 *  This is the whole of the 2026-09-18 fix. The driver used to do
 *      if (allow.some((a) => src.includes(a))) continue;
 *  which skipped the ENTIRE FILE on any match, so one legitimate phrase
 *  exempted that file from all six rules and an allowlisted page could ship
 *  "actively edited", "Owner TBC" and lorem ipsum with a green run. The gate's
 *  own header described the list as "one substring per line" for "a false
 *  positive", which reads as per-match suppression. It was not.
 *
 *  Suppression is now positional: an entry silences the matches that occur
 *  INSIDE it and nothing else. That also makes an entry self-documenting, since
 *  it has to quote enough of the real copy to cover the match it excuses. */
export function isAllowed(hit, spans) {
  return spans.some(([start, end]) => hit.index >= start && hit.end <= end);
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
  let suppressed = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // Spans are located in the STRIPPED body, because that is the string the
    // rules matched against and the only one the hit indices refer to. An
    // allowlist entry that exists solely inside a comment or the Astro
    // frontmatter therefore no longer suppresses anything, which is correct:
    // those are not shipped copy and the rules never looked at them.
    const spans = allowedSpans(stripComments(src), allow);
    for (const hit of checkSource(src)) {
      if (isAllowed(hit, spans)) { suppressed += 1; continue; }
      offenders.push({ file: f, ...hit });
    }
  }
  if (offenders.length) {
    console.error(`FAIL: ${offenders.length} unfinished-state marker(s) in shipped markup:`);
    for (const o of offenders) {
      console.error(`  ${o.file}: ${o.label} -> "${o.match}"`);
    }
    console.error(`If a match is legitimate, add to ${ALLOWLIST_PATH} a substring of the real copy`);
    console.error('that CONTAINS the match above. Suppression is positional: an entry silences only');
    console.error('the matches inside it, never the rest of the file.');
    process.exit(1);
  }
  // The suppressed count is printed on purpose. A silent allowlist is how a
  // carve-out outlives its reason, and "0 markers" reads very differently from
  // "0 markers, 4 suppressed".
  const note = suppressed > 0 ? `, ${suppressed} suppressed by the allowlist` : '';
  console.log(`OK: no unfinished-state markers in ${files.length} page/component file(s)${note}`);
  process.exit(0);
}
