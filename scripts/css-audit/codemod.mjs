#!/usr/bin/env node
/**
 * css-audit codemod — applies the MECHANICAL subset of audit findings:
 *
 *   1. raw-px-spacing kind=tokenizable   ->  var(--space-N)        (zero visual change: tokens are static px)
 *   2. radius-drift   kind=tokenizable   ->  var(--radius-*)       (zero visual change)
 *   3. fallback-divergence               ->  drop the dead fallback (zero change: token always defined)
 *   4. raw-color      kind=tokenizable   ->  var(--token)           ADMIN/DEV PAGES ONLY — this is the
 *      admin dark-mode fix: literals become theme-aware. functions/ standalone docs are excluded
 *      (deliberately fixed-light), and public pages were hand-drained in waves 2A/2B.
 *
 * Replacements are line-surgical: each is applied inside the finding's own declaration
 * value on its exact line, so identical numbers elsewhere on minified lines are safe.
 *
 * Usage: node scripts/css-audit/audit.mjs --json /tmp/f.json && node scripts/css-audit/codemod.mjs /tmp/f.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const findingsPath = process.argv[2];
if (!findingsPath) { console.error('usage: codemod.mjs <findings.json> [--dry]'); process.exit(1); }
const DRY = process.argv.includes('--dry');
const { findings } = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));

const isAdminDev = (f) => f.file.startsWith('src/pages/admin/') || f.file.startsWith('src/pages/dev/');
const SPACE_TOKEN_BY_PX = { 4: '--space-1', 8: '--space-2', 12: '--space-3', 16: '--space-4', 20: '--space-5', 24: '--space-6', 32: '--space-8', 40: '--space-10', 48: '--space-12', 64: '--space-16', 96: '--space-24' };
const RADIUS_TOKEN_BY_PX = { 4: '--radius-sm', 8: '--radius-md', 16: '--radius-lg', 9999: '--radius-pill' };

const siteWideTokens = (() => {
  const out = new Set();
  for (const sheet of ['src/styles/global.css', 'src/styles/app-shell.css', 'src/styles/fonts.css']) {
    try {
      for (const m of fs.readFileSync(path.join(ROOT, sheet), 'utf8').matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) out.add(m[1]);
    } catch {}
  }
  return out;
})();
const fileTokenCache = new Map();
function resolvable(name, file) {
  if (siteWideTokens.has(name)) return true;
  if (!fileTokenCache.has(file)) {
    const t = fs.readFileSync(path.join(ROOT, file), 'utf8');
    fileTokenCache.set(file, new Set([...t.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map((m) => m[1])));
  }
  return fileTokenCache.get(file).has(name);
}

const stats = { applied: {}, skipped: {} };
const bump = (m, k) => { m[k] = (m[k] || 0) + 1; };

/** Build the list of {file, line, transform(valueSegment) -> newSegment} */
const jobs = [];
for (const f of findings) {
  if (f.file.startsWith('functions/')) continue;
  if (f.category === 'raw-px-spacing' && f.kind === 'tokenizable') {
    const m = f.message.match(/^([\d.]+)(px|rem) \(= ([\d.]+)px\)/);
    if (!m) { bump(stats.skipped, 'px-no-parse'); continue; }
    const px = Number(m[3]);
    const token = SPACE_TOKEN_BY_PX[px];
    if (!token) { bump(stats.skipped, 'px-no-token'); continue; }
    const negative = /Negative offset/.test(f.suggestion);
    const lit = (negative ? '-' : '') + m[1] + m[2];
    const repl = negative ? `calc(-1 * var(${token}))` : `var(${token})`;
    jobs.push({ ...loc(f), cat: 'raw-px-spacing', lit, repl, wordBoundary: true });
  } else if (f.category === 'radius-drift' && f.kind === 'tokenizable') {
    const m = f.message.match(/([\d.]+)px/);
    if (!m) { bump(stats.skipped, 'radius-no-parse'); continue; }
    const px = Number(m[1]);
    const token = RADIUS_TOKEN_BY_PX[px] || (px >= 99 ? '--radius-pill' : null);
    if (!token) { bump(stats.skipped, 'radius-no-token'); continue; }
    jobs.push({ ...loc(f), cat: 'radius-drift', lit: m[1] + 'px', repl: `var(${token})`, wordBoundary: true });
  } else if (f.category === 'fallback-divergence') {
    const m = f.message.match(/^Fallback "(.+?)" diverges from defined (--[a-zA-Z0-9_-]+):/);
    if (!m) { bump(stats.skipped, 'fb-no-parse'); continue; }
    jobs.push({ ...loc(f), cat: 'fallback-divergence', regex: new RegExp('var\\(\\s*' + esc(m[2]) + '\\s*,\\s*' + esc(m[1]) + '\\s*\\)'), repl: `var(${m[2]})` });
  } else if (f.category === 'raw-color' && f.kind === 'tokenizable' && isAdminDev(f)) {
    const m = f.suggestion.match(/^Use var\((--[a-zA-Z0-9_-]+)\) instead of (.+)$/);
    if (!m) { bump(stats.skipped, 'color-no-parse'); continue; }
    if (!resolvable(m[1], f.file)) { bump(stats.skipped, 'color-token-not-resolvable'); continue; }
    jobs.push({ ...loc(f), cat: 'raw-color-admin', lit: m[2], repl: `var(${m[1]})` });
  }
}

function loc(f) { return { file: f.file, line: f.line, prop: f.prop, value: f.value }; }

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Apply, grouped by file. All replacements are intra-line, so line numbers stay stable. */
const byFile = new Map();
for (const j of jobs) { if (!byFile.has(j.file)) byFile.set(j.file, []); byFile.get(j.file).push(j); }

for (const [file, fileJobs] of byFile) {
  const abs = path.join(ROOT, file);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  for (const j of fileJobs) {
    const i = j.line - 1;
    if (i < 0 || i >= lines.length) { bump(stats.skipped, j.cat + ':line-oob'); continue; }
    let line = lines[i];
    // constrain to the finding's own declaration value when locatable
    let segStart = 0, segEnd = line.length;
    const vIdx = j.value ? line.indexOf(j.value) : -1;
    if (vIdx !== -1) { segStart = vIdx; segEnd = vIdx + j.value.length; }
    const seg = line.slice(segStart, segEnd);
    let newSeg;
    if (j.regex) {
      if (!j.regex.test(seg)) { bump(stats.skipped, j.cat + ':no-match'); continue; }
      newSeg = seg.replace(j.regex, j.repl);
    } else {
      const re = j.wordBoundary
        ? new RegExp('(?<![\\d.\\w-])' + esc(j.lit) + '(?![\\d.\\w])')
        : new RegExp(esc(j.lit));
      if (!re.test(seg)) { bump(stats.skipped, j.cat + ':no-match'); continue; }
      newSeg = seg.replace(re, j.repl);
    }
    lines[i] = line.slice(0, segStart) + newSeg + line.slice(segEnd);
    bump(stats.applied, j.cat);
  }
  if (!DRY) fs.writeFileSync(abs, lines.join('\n'));
}

console.log(DRY ? 'DRY RUN' : 'APPLIED');
console.log('applied:', JSON.stringify(stats.applied, null, 2));
console.log('skipped:', JSON.stringify(stats.skipped, null, 2));
console.log('files touched:', byFile.size);
