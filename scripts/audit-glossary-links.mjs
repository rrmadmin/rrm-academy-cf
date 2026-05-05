#!/usr/bin/env node
/**
 * Audits glossary term bodies for inline-link drift.
 *
 * Read-only. Always exits 0. Emits JSON report to stdout (or --out).
 *
 * Inputs:
 *   --data <path>     default src/data/glossary.json
 *   --from-d1         read from live D1 instead (ALL statuses)
 *   --out <path>      write JSON report here instead of stdout
 *
 * Action counts and per-anchor entries follow the closed-enum from
 * scripts/lib/glossary-link-classifier.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parse } from 'node-html-parser';
import { classifyAnchor } from './lib/glossary-link-classifier.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) {
  return process.argv.includes(name);
}

const SECTION_IDS = new Set([
  'overview','core-rrm-principles','fertility-awareness','clinical-approaches',
  'diagnostic-tools','surgical-techniques','conditions','overlapping-disciplines',
  'broader-framework','abbreviations','references',
]);

function loadFromJson(path) {
  const d = JSON.parse(readFileSync(path, 'utf-8'));
  return d.terms.map(t => ({ id: t.id, slug: t.slug, bodyHtml: t.bodyHtml || '', status: 'published' }));
}

function loadFromD1() {
  const out = execSync(
    `wrangler d1 execute rrm-auth --remote --json --command "SELECT id, slug, body_html, status FROM glossary_term"`,
    { encoding: 'utf-8' }
  );
  const parsed = JSON.parse(out);
  const rows = parsed[0]?.results || [];
  return rows.map(r => ({ id: r.id, slug: r.slug, bodyHtml: r.body_html || '', status: r.status }));
}

const dataPath = arg('--data', 'src/data/glossary.json');
const outPath = arg('--out', null);
const useD1 = flag('--from-d1');

const terms = useD1 ? loadFromD1() : loadFromJson(dataPath);
const knownSlugs = new Set(terms.map(t => t.slug.toLowerCase()));

const actionCounts = {};
const perAnchor = [];

for (const term of terms) {
  if (!term.bodyHtml) continue;
  const root = parse(term.bodyHtml);
  const anchors = root.querySelectorAll('a');
  let anchorIdx = 0;
  for (const a of anchors) {
    const action = classifyAnchor({
      href: a.getAttribute('href'),
      classList: (a.getAttribute('class') || '').split(/\s+/).filter(Boolean),
      parentTagName: a.parentNode?.tagName?.toLowerCase() || null,
      parentClassList: (a.parentNode?.getAttribute?.('class') || '').split(/\s+/).filter(Boolean),
      knownTermSlugs: knownSlugs,
      sectionIds: SECTION_IDS,
    });
    actionCounts[action] = (actionCounts[action] || 0) + 1;
    if (action !== 'noop' && action !== 'mailto-or-tel' && action !== 'external' && action !== 'pillar-or-onsite') {
      perAnchor.push({
        termSlug: term.slug,
        anchorIndex: anchorIdx,
        href: a.getAttribute('href'),
        snippet: a.outerHTML.slice(0, 200),
        action,
      });
    }
    anchorIdx++;
  }
}

const report = {
  source: useD1 ? 'd1' : dataPath,
  termCount: terms.length,
  actionCounts,
  perAnchor,
};

const json = JSON.stringify(report, null, 2);
if (outPath) {
  writeFileSync(outPath, json);
  console.log(`Audit report written to ${outPath}`);
  console.log(`Action counts: ${JSON.stringify(actionCounts)}`);
} else {
  console.log(json);
}
