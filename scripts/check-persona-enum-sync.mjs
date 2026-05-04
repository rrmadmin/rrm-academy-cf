#!/usr/bin/env node
/**
 * Asserts persona doc frontmatter and src/lib/contact-categories.js
 * stay in sync. Run as a CI gate before deploys.
 *
 * Usage:
 *   node scripts/check-persona-enum-sync.mjs
 *
 * For tests, pass overridable paths:
 *   node scripts/check-persona-enum-sync.mjs \
 *     --persona-doc /tmp/personas.md \
 *     --categories-file /tmp/contact-categories.js
 *
 * Legacy alias --categories-ts is also accepted for backwards compatibility.
 *
 * Exit codes: 0 success, 1 sync failure, 2 file/parse error.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const personaDocPath = resolve(arg('--persona-doc', 'docs/personas/rrm-academy-personas.md'));
const categoriesPath = resolve(
  arg('--categories-file', null) ||
  arg('--categories-ts', null) ||
  'src/lib/contact-categories.js'
);

function fail(msg) {
  console.error('check-persona-enum-sync: ' + msg);
  process.exit(1);
}
function bail(msg) {
  console.error('check-persona-enum-sync: ' + msg);
  process.exit(2);
}

if (!existsSync(personaDocPath)) bail(`persona doc not found at ${personaDocPath}`);
if (!existsSync(categoriesPath)) bail(`categories file not found at ${categoriesPath}`);

const personaSrc = readFileSync(personaDocPath, 'utf-8');
const jsSrc = readFileSync(categoriesPath, 'utf-8');

// Extract YAML frontmatter (between leading `---` and next `---`)
const fmMatch = personaSrc.match(/^---\n([\s\S]*?)\n---/);
if (!fmMatch) bail('persona doc has no YAML frontmatter');
const fm = fmMatch[1];

// Extract contact_form_category values (skip null)
const personaCats = new Set();
const personaRegex = /^\s*contact_form_category:\s*([a-z0-9-]+)\s*$/gm;
let m;
while ((m = personaRegex.exec(fm)) !== null) {
  if (m[1] !== 'null') personaCats.add(m[1]);
}
if (personaCats.size === 0) bail('no contact_form_category values found in persona frontmatter');

// Extract CONTACT_CATEGORIES from JS/TS source
const jsArrayMatch = jsSrc.match(/CONTACT_CATEGORIES\s*=\s*\[([^\]]+)\]/);
if (!jsArrayMatch) bail('CONTACT_CATEGORIES array not found in source file');
const jsCats = new Set();
const jsRegex = /'([a-z0-9-]+)'/g;
while ((m = jsRegex.exec(jsArrayMatch[1])) !== null) jsCats.add(m[1]);
if (jsCats.size === 0) bail('CONTACT_CATEGORIES is empty');

// Compare
const personaOnly = [...personaCats].filter(c => !jsCats.has(c));
const jsOnly = [...jsCats].filter(c => !personaCats.has(c) && c !== 'other');

const issues = [];
if (personaOnly.length) issues.push(`Persona doc has categories not in file: ${personaOnly.join(', ')}`);
if (jsOnly.length) issues.push(`File has unused categories (no persona uses them, and not 'other'): ${jsOnly.join(', ')}`);

if (issues.length) {
  for (const i of issues) console.error('  ' + i);
  fail('persona doc and contact-categories file are out of sync');
}

console.log(`check-persona-enum-sync: ok (${jsCats.size} categories, ${personaCats.size} persona-mapped)`);
process.exit(0);
