#!/usr/bin/env node
import fs from 'node:fs';

const BANNED_LEADS = /^(Yes|Absolutely|Sure|Definitely|Of course|Certainly|Yeah|Indeed|Affirmative|Correct|Most certainly)\b/i;

export function checkFaqAnswers(html) {
  const answerMatches = [...html.matchAll(/<div class="(?:prose|faq-answer)"[^>]*>([\s\S]*?)<\/div>/g)];
  for (const m of answerMatches) {
    let inner = m[1];
    inner = inner.replace(/^\s+/, '');
    while (/^<h[234][^>]*>/i.test(inner)) {
      inner = inner.replace(/^<h[234][^>]*>[\s\S]*?<\/h[234]>\s*/i, '');
    }
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

function collectHtmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...collectHtmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

// The "no affirmative lead" rule is scoped to fertility/clinical FAQ content
// (spec: "no Yes lead on a fertility FAQ") -- not administrative/logistics
// Yes-or-no answers (course pricing, bundling, donation tax/cancellation
// policy), which are correct as unhedged facts. Scanning all of `dist/`
// sweeps those in too. Scope to the D1 FAQ page + every registered guide
// page instead, derived from ssot/guides.json so new guides are covered
// automatically and nothing needs to be hardcoded here.
function resolveFertilityFaqDirs(dir, guidesRegistryPath) {
  const dirs = [`${dir}/faqs`];
  if (guidesRegistryPath && fs.existsSync(guidesRegistryPath)) {
    const registry = JSON.parse(fs.readFileSync(guidesRegistryPath, 'utf8'));
    for (const guide of registry.guides || []) {
      dirs.push(`${dir}/${guide.slug}`);
    }
  }
  return dirs.filter((d) => fs.existsSync(d));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file || args.f;
  const dir = args.dir;
  const guidesRegistry = args['guides-registry'];
  if (!filePath && !dir) {
    console.error('Usage: faq-no-affirmative-lead.mjs --file=dist/PILLAR/index.html');
    console.error('   or: faq-no-affirmative-lead.mjs --dir=dist --guides-registry=ssot/guides.json');
    process.exit(2);
  }
  let files;
  if (filePath) {
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(2);
    }
    files = [filePath];
  } else {
    if (!fs.existsSync(dir)) {
      console.error(`Directory not found: ${dir}`);
      process.exit(2);
    }
    const scanDirs = guidesRegistry ? resolveFertilityFaqDirs(dir, guidesRegistry) : [dir];
    files = scanDirs.flatMap((d) => collectHtmlFiles(d));
  }
  let fail = false;
  for (const f of files) {
    const html = fs.readFileSync(f, 'utf8');
    const result = checkFaqAnswers(html);
    if (!result.ok) {
      console.error(`FAIL: ${f}: ${result.error}`);
      fail = true;
    }
  }
  if (fail) {
    process.exit(1);
  } else {
    console.log(`OK: no banned affirmative leads in FAQ accordion (${files.length} file(s) scanned)`);
    process.exit(0);
  }
}
