#!/usr/bin/env node
import fs from 'node:fs';

const BANNED_LEADS = /^(Yes|Absolutely|Sure|Definitely|Of course|Certainly|Yeah|Indeed|Affirmative|Correct|Most certainly)\b/i;

export function checkFaqAnswers(html) {
  const ddMatches = [...html.matchAll(/<dd[^>]*>([\s\S]*?)<\/dd>/g)];
  for (const m of ddMatches) {
    let inner = m[1];
    // Strip leading whitespace + opening tags + entity refs
    inner = inner
      .replace(/^\s+/, '')
      .replace(/^(<[^>/!][^>]*>\s*)+/, '') // strip opening tags like <p>, <strong>
      .replace(/^\s+/, '')
      .replace(/^&nbsp;\s*/i, '');
    const first30 = inner.slice(0, 30);
    const ban = first30.match(BANNED_LEADS);
    if (ban) {
      return { ok: false, error: `FAQ answer leads with banned affirmative "${ban[1]}": "${first30.replace(/\s+/g, ' ').slice(0, 60)}..."` };
    }
  }
  return { ok: true };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(\w[\w-]*)(=(.*))?$/);
    if (!m) continue;
    const key = m[1];
    if (m[2] !== undefined) {
      // --key=value (value may be empty string)
      out[key] = m[3];
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      // --key value
      out[key] = argv[++i];
    } else {
      // --key (bare flag, no value)
      out[key] = true;
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file || args.f;
  if (!filePath) {
    console.error('Usage: faq-no-affirmative-lead.mjs --file=dist/PILLAR/index.html');
    process.exit(2);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  const html = fs.readFileSync(filePath, 'utf8');
  const result = checkFaqAnswers(html);
  if (result.ok) {
    console.log(`OK: no banned affirmative leads in FAQ accordion`);
    process.exit(0);
  } else {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }
}
