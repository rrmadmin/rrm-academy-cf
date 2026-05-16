#!/usr/bin/env node
/**
 * gen-image.mjs -- RRM Academy illustration generator
 *
 * Generates realistic medical-illustration artwork (glossary terms, pillar and
 * page sections) via OpenAI gpt-image-2. The RRM Academy house style and its
 * two registers live in scripts/lib/gen-image-style.mjs:
 *   --register anatomical  a realistic medical-atlas plate on a white
 *                          background with brand-purple label chips.
 *                          (no people; --figures is ignored)
 *   --register scene       a realistic, soft-edged painterly watercolour scene
 *                          of a person, couple, or object. (default)
 *
 * --- GENERATE a new image ---
 *   node scripts/gen-image.mjs \
 *     --topic "PCOS" \
 *     --scene "a woman seated calmly at a warm-wood table ..." \
 *     --out pcos-table
 *
 *   Register:             --register anatomical|scene   (default: scene)
 *   Couple scene:         --figures couple
 *   Object-only:          --figures still-life
 *   Topic-specific avoid: --avoid "clocks, hourglasses, ..."
 *   Skip style refs:      --no-style-ref    (text-to-image only)
 *   Print prompt only:    --dry-run         (no API call, no cost)
 *
 * --- REFINE an existing image ---
 *   node scripts/gen-image.mjs \
 *     --refine tools/generated-images/pcos-table.raw.png \
 *     --instruction "redraw the hands cleanly" \
 *     --out pcos-table-v2
 *
 *   Optional region mask (transparent area = redraw target): --mask mask.png
 *
 * --- BATCH (JSON array; each entry is a generate OR a refine) ---
 *   node scripts/gen-image.mjs --batch path/to/manifest.json
 *
 *   generate entry: { "topic", "scene", "out", "register"?, "figures"?, "mood"?, "avoid"?, "size"? }
 *   refine entry:   { "refine", "instruction", "out", "mask"?, "size"? }
 *
 * Two-phase workflow:
 *   1. generate/refine/batch -> writes <out>.raw.png ONLY. Review it.
 *   2. once approved -> --finalize <out> post-processes that exact raw into
 *      <out>.png + <out>.webp. Finalize never calls the API.
 *
 *   Finalize background:
 *     (default)        transparent cut-out
 *     --flat ffffff    flatten onto a white card
 *     --flat f7f5f3    flatten onto the RRM Academy paper background
 *
 * API key: op read 'op://Automation/OpenClaw OpenAI API/credential'
 *
 * After review, copy the approved .webp into public/images/glossary/ (or the
 * relevant pillar directory) and reference it from the page.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, parseArgs } from './lib/gen-image-style.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = join(ROOT, 'tools', 'generated-images');

// Locked style-reference exemplars, one set per register. Attached to the
// edits endpoint so gpt-image-2 matches the RRM Academy house-style craft
// rather than just its text description. Files live in scripts/style-refs/.
const STYLE_REFS = {
  anatomical: ['anatomical-01.webp'],
  scene: ['scene-01.webp'],
};

// Absolute paths of the exemplars for a register (empty if the register has none).
function styleRefPaths(register) {
  return (STYLE_REFS[register] || []).map((f) => join(__dirname, 'style-refs', f));
}

const STYLE_REF_PREAMBLE =
  'The attached images are a STYLE REFERENCE ONLY. Do not copy, trace, edit, ' +
  'crop, or combine what they depict -- ignore their subjects entirely. Match ' +
  'only their craft: the medium, colour, finish, and edge quality of the RRM ' +
  'Academy illustration house style. Then draw a COMPLETELY NEW illustration, ' +
  'in that exact craft, of the following brief.\n\n';

const REFINE_PREAMBLE =
  'This is a realistic RRM Academy illustration. Preserve its exact style, ' +
  'medium, colour, finish, and edge quality, and keep the overall composition ' +
  'and subject recognizably the same. Apply only this change: ';

const MODEL = process.env.GEN_IMAGE_MODEL || 'gpt-image-2';

// --- OpenAI -----------------------------------------------------------------

let CACHED_KEY = null;
function getKey() {
  if (CACHED_KEY) return CACHED_KEY;
  CACHED_KEY = execSync("op read 'op://Automation/OpenClaw OpenAI API/credential'", {
    encoding: 'utf8',
  }).trim();
  if (!CACHED_KEY.startsWith('sk-')) throw new Error('OpenAI key not retrieved from 1Password');
  return CACHED_KEY;
}

async function generate(entry) {
  const register = entry.register || 'scene';
  const refs = entry.noStyleRef ? [] : styleRefPaths(register);
  const useRefs = refs.length > 0 && refs.every((p) => existsSync(p));
  const prompt = (useRefs ? STYLE_REF_PREAMBLE : '') + buildPrompt(entry);

  if (!useRefs) {
    // text-to-image path (--no-style-ref, or the register has no exemplars)
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        n: 1,
        size: entry.size || '1024x1024',
        quality: 'high',
        output_format: 'png',
        moderation: 'low',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(data.error || data)}`);
    return Buffer.from(data.data[0].b64_json, 'base64');
  }

  // style-reference path: edits endpoint with the register's exemplars attached.
  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', prompt);
  form.append('n', '1');
  form.append('size', entry.size || '1024x1024');
  form.append('quality', 'high');
  form.append('output_format', 'png');
  form.append('moderation', 'low');
  for (const ref of refs) {
    form.append('image[]', new Blob([readFileSync(ref)], { type: 'image/webp' }), basename(ref));
  }
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getKey()}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(data.error || data)}`);
  return Buffer.from(data.data[0].b64_json, 'base64');
}

async function refine(entry) {
  const inPath = resolve(entry.refine);
  if (!existsSync(inPath)) throw new Error(`refine source not found: ${inPath}`);
  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', REFINE_PREAMBLE + entry.instruction);
  form.append('n', '1');
  form.append('size', entry.size || 'auto');
  form.append('quality', 'high');
  form.append('image', new Blob([readFileSync(inPath)], { type: 'image/png' }), 'input.png');
  if (entry.mask) {
    const maskPath = resolve(entry.mask);
    if (!existsSync(maskPath)) throw new Error(`mask not found: ${maskPath}`);
    form.append('mask', new Blob([readFileSync(maskPath)], { type: 'image/png' }), 'mask.png');
  }
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getKey()}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(data.error || data)}`);
  return Buffer.from(data.data[0].b64_json, 'base64');
}

// --- output -----------------------------------------------------------------

function saveRaw(out, pngBuf) {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const rawPath = join(OUT_DIR, `${out}.raw.png`);
  writeFileSync(rawPath, pngBuf);
  return rawPath;
}

// Post-process an APPROVED raw into site-ready assets. No API call -- works on
// the existing <out>.raw.png so the approved image is kept exactly.
function finalize(out, flat, thresh) {
  const rawPath = join(OUT_DIR, `${out}.raw.png`);
  if (!existsSync(rawPath)) throw new Error(`no raw image to finalize: ${rawPath}`);
  const pngPath = join(OUT_DIR, `${out}.png`);
  const webpPath = join(OUT_DIR, `${out}.webp`);
  const mtArgs = [join(__dirname, 'make-transparent.py'), rawPath, pngPath];
  if (flat) mtArgs.push('--flat', String(flat).replace(/^#/, ''));
  if (thresh) mtArgs.push('--thresh', String(thresh));
  execFileSync('python3', mtArgs);
  execFileSync('cwebp', ['-quiet', '-q', '90', '-alpha_q', '100', pngPath, '-o', webpPath]);
  return { pngPath, webpPath };
}

// --- run --------------------------------------------------------------------

async function runOne(entry, idx, total, opts) {
  const mode = entry.refine ? 'refine' : 'generate';
  const label = `[${idx}/${total}] ${entry.out}`;
  const e = {
    ...entry,
    noStyleRef: opts.noStyleRef || entry.noStyleRef,
    allowInfant: opts.allowInfant || entry.allowInfant,
  };

  if (opts.dryRun) {
    const text = mode === 'refine' ? REFINE_PREAMBLE + e.instruction : buildPrompt(e);
    console.log(`${label}: dry-run (${mode}) -- prompt below\n`);
    console.log(text);
    console.log('');
    return;
  }

  console.log(`${label}: ${mode}...`);
  const png = mode === 'refine' ? await refine(e) : await generate(e);
  const rawPath = saveRaw(entry.out, png);
  console.log(`${label}: done -> ${rawPath}  (review, then --finalize ${entry.out})`);
}

function usage() {
  console.error('Generate: gen-image.mjs --topic X --scene Y --out name [--register anatomical|scene] [--figures one|couple|still-life] [--avoid "..."] [--size 1024x1024] [--no-style-ref] [--dry-run]');
  console.error('Refine:   gen-image.mjs --refine path.png --instruction "..." --out name [--mask mask.png] [--size auto]');
  console.error('Batch:    gen-image.mjs --batch path/to/manifest.json');
  console.error('Finalize: gen-image.mjs --finalize name1,name2 [--flat ffffff|f7f5f3] [--thresh N]');
  process.exit(1);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));

  // finalize mode: post-process approved raw image(s). No API call.
  if (a.finalize) {
    const names = a.finalize.split(',').map((s) => s.trim()).filter(Boolean);
    for (const n of names) {
      try {
        const { webpPath } = finalize(n, a.flat, a.thresh);
        console.log(`finalized ${n} -> ${webpPath}${a.flat ? ` (flat #${String(a.flat).replace(/^#/, '')})` : ' (transparent)'}`);
      } catch (err) {
        console.error(`finalize ${n}: FAILED -- ${err.message}`);
      }
    }
    return;
  }

  let entries;
  if (a.batch) {
    entries = JSON.parse(readFileSync(resolve(a.batch), 'utf8'));
    if (!Array.isArray(entries)) throw new Error('batch file must be a JSON array');
  } else if (a.refine) {
    if (!a.instruction || !a.out) usage();
    entries = [a];
  } else if (a.topic || a.scene) {
    if (!a.topic || !a.scene || !a.out) usage();
    entries = [a];
  } else {
    usage();
  }

  const opts = {
    noStyleRef: !!a['no-style-ref'],
    allowInfant: !!a['allow-infant'],
    dryRun: !!a['dry-run'],
  };
  console.log(`Model: ${MODEL}  |  ${entries.length} image(s)  |  ${opts.dryRun ? 'DRY RUN' : 'raw only'}\n`);
  for (let i = 0; i < entries.length; i++) {
    try {
      await runOne(entries[i], i + 1, entries.length, opts);
    } catch (err) {
      console.error(`[${i + 1}/${entries.length}] ${entries[i].out}: FAILED -- ${err.message}`);
    }
  }
}

main();
