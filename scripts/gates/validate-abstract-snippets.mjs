#!/usr/bin/env node
// Gate: ArticleCard list-variant abstract snippets must not leak structured-
// abstract section labels (OBJECTIVE:/Background:/Results: …). Born 2026-07-19
// after the label stripper regressed twice in one session (all-caps-only rule
// left Title-Case "Background:" intact; a leading-only rule left mid-snippet
// "OBJECTIVE:" stranded). Guards the shared src/lib/abstract-snippet.mjs stripper
// against data drift or a broken regex.
//
// Contract: for every published article, abstractSnippet(abstract) must contain
// no label in the exact form the stripper claims to remove (a label word or an
// ALL-CAPS run followed by a colon or newline). The ~0.7% bare-space residue
// ("Background Endometriosis", no colon) is deliberately NOT stripped and does
// NOT trip this gate — the detection mirrors the stripper's own separator.
import fs from 'node:fs';
import { abstractSnippet, abstractLabelRegExp } from '../../src/lib/abstract-snippet.mjs';

const DEFAULT_DATA = 'src/data/articles.json';

export function checkArticles(articles) {
  const offenders = [];
  const detect = abstractLabelRegExp();
  for (const a of articles) {
    if (!a || !a.abstract) continue;
    const snippet = abstractSnippet(a.abstract);
    detect.lastIndex = 0;
    const m = detect.exec(snippet);
    if (m) {
      offenders.push({
        slug: a.slug || a.id || '(unknown)',
        label: m[0].trim(),
        context: snippet.slice(Math.max(0, m.index - 10), m.index + 40).replace(/\s+/g, ' '),
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
  const articles = Array.isArray(raw) ? raw : raw.articles || Object.values(raw);
  const offenders = checkArticles(articles);
  if (offenders.length) {
    console.error(`FAIL: ${offenders.length} article snippet(s) still contain a structured-abstract label:`);
    for (const o of offenders.slice(0, 20)) {
      console.error(`  ${o.slug}: "${o.label}" in "…${o.context}…"`);
    }
    if (offenders.length > 20) console.error(`  … and ${offenders.length - 20} more`);
    console.error('Fix the stripper in src/lib/abstract-snippet.mjs (extend ABSTRACT_LABEL_WORDS or the separator).');
    process.exit(1);
  }
  console.log(`OK: no leaked abstract labels in ${articles.length} article snippets`);
  process.exit(0);
}
