#!/usr/bin/env node
/**
 * CI guard: fails build if glossary.json contains link drift.
 *
 * Stage A (warn-only): wired with continue-on-error: true in deploy.yml.
 * Stage B (hard gate): flipped after 3 clean deploys.
 *
 * Inputs:
 *   --data <path>   default src/data/glossary.json
 *
 * Exit codes:
 *   0 — clean
 *   1 — drift detected
 *   2 — file/parse error
 */
import { readFileSync } from 'node:fs';
import { parse } from 'node-html-parser';
import { classifyAnchor } from './lib/glossary-link-classifier.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const SECTION_IDS = new Set([
  'overview','core-rrm-principles','fertility-awareness','clinical-approaches',
  'diagnostic-tools','surgical-techniques','conditions','overlapping-disciplines',
  'broader-framework','abbreviations','references',
]);

const dataPath = arg('--data', 'src/data/glossary.json');

let data;
try {
  data = JSON.parse(readFileSync(dataPath, 'utf-8'));
} catch (err) {
  console.error(`check-glossary-link-classes: cannot read ${dataPath}: ${err.message}`);
  process.exit(2);
}

const terms = data.terms || [];
const knownSlugs = new Set(terms.map(t => (t.slug || '').toLowerCase()));

const drift = [];

for (const t of terms) {
  if (!t.bodyHtml) continue;
  const root = parse(t.bodyHtml);
  for (const a of root.querySelectorAll('a')) {
    const action = classifyAnchor({
      href: a.getAttribute('href'),
      classList: (a.getAttribute('class') || '').split(/\s+/).filter(Boolean),
      parentTagName: a.parentNode?.tagName?.toLowerCase() || null,
      parentClassList: (a.parentNode?.getAttribute?.('class') || '').split(/\s+/).filter(Boolean),
      knownTermSlugs: knownSlugs,
      sectionIds: SECTION_IDS,
    });
    const isDrift = action === 'add-gloss-xref'
                 || action === 'add-cite-ref-class-to-sup'
                 || action === 'wrap-cite-ref'
                 || action.startsWith('manual-review:');
    if (isDrift) {
      drift.push({ slug: t.slug, href: a.getAttribute('href'), action });
    }
  }
}

if (drift.length === 0) {
  console.log(`check-glossary-link-classes: ok (${terms.length} terms, 0 drift)`);
  process.exit(0);
}

console.error(`check-glossary-link-classes: ${drift.length} drift entries:`);
const byAction = {};
for (const d of drift) (byAction[d.action] ||= []).push(d);
for (const [action, items] of Object.entries(byAction)) {
  console.error(`  ${action}: ${items.length}`);
  for (const d of items.slice(0, 3)) console.error(`    ${d.slug} → ${d.href}`);
}
process.exit(1);
