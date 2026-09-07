#!/usr/bin/env node
// Usage: node scripts/lint-synopsis.mjs <insights.json> [--strict]
// Exit 0 = pass (WARNs allowed unless --strict), 1 = FAIL findings, 2 = bad input.
import fs from 'node:fs';
import { lintSynopsis } from '../src/lib/synopsis-lint.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const strict = args.includes('--strict');
if (!file) { console.error('usage: lint-synopsis.mjs <insights.json> [--strict]'); process.exit(2); }
let insights;
try { insights = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`cannot parse ${file}: ${e.message}`); process.exit(2); }
const { ok, findings } = lintSynopsis(insights);
for (const f of findings) console.log(`${f.level}\t${f.rule}\t${f.where}\t${f.detail}`);
const fails = findings.filter((f) => f.level === 'FAIL').length;
const warns = findings.length - fails;
console.log(`\n${ok && (!strict || warns === 0) ? 'PASS' : 'FAIL'}: ${fails} fail, ${warns} warn`);
process.exit(ok && (!strict || warns === 0) ? 0 : 1);
