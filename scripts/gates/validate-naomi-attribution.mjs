#!/usr/bin/env node
import fs from 'node:fs';

const ATTR_REGEX = /\b(Naomi|Whit{1,2}aker|MIGS|NFPMC|0000-0003-3706-3112|1881034908|rrm-spotlight-naomi-whittaker)\b/g;

export function checkNaomiAttribution(html, opts) {
  // Strip byline area (allowlisted: Naomi byline is permitted in clinical-authority context).
  // Byline is identified by class="byline" wrapper.
  const stripped = html.replace(/<[^>]*class="[^"]*\bbyline\b[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '');
  // Also strip <header> + JSON-LD <script type="application/ld+json"> blocks (Naomi @id in author is permitted).
  const stripped2 = stripped
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi, '');

  const matches = [...stripped2.matchAll(ATTR_REGEX)];
  if (matches.length === 0) return { ok: true };
  const hits = matches.map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i);
  return { ok: false, error: `body prose contains Naomi attribution: ${hits.join(', ')}` };
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
  if (!filePath || !args.pillar) {
    console.error('Usage: validate-naomi-attribution.mjs --file=dist/PILLAR/index.html --pillar=PILLAR_SLUG');
    process.exit(2);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  const html = fs.readFileSync(filePath, 'utf8');
  const result = checkNaomiAttribution(html, args);
  if (result.ok) {
    console.log(`OK: ${args.pillar} clean`);
    process.exit(0);
  } else {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }
}
