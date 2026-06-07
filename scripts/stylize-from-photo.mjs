/**
 * stylize-from-photo.mjs -- redraw a REAL portrait photo as an RRM Academy
 * colored-pencil commentary cover illustration.
 *
 * The whole point: starting from a real human's photo (real bone structure,
 * real expression) and restyling it avoids the "AI-averaged face" uncanny look
 * that text-to-image portraits fall into.
 *
 * Two modes:
 *   --style none  (DEFAULT, recommended for the loose "level 6" look): single-
 *                 image edit of the PHOTO ONLY. The colored-pencil look comes
 *                 entirely from the prompt. Generating straight from the photo
 *                 keeps it a loose hand-drawing instead of inheriting the
 *                 polished precision of a reference drawing.
 *   --style <ref> : attach a colored-pencil exemplar as a 2nd image ("redraw
 *                 person 1 in style 2"). Stronger broad strokes, but tends
 *                 toward a more precise / finished render.
 *
 * Usage (run from the rrm-academy-cf project root):
 *   node scripts/stylize-from-photo.mjs --photo /tmp/px-123.jpg --out my-cover \
 *     [--style none|path-to-exemplar.webp] [--mood "calm, gently hopeful, validated"]
 *
 * Writes tools/generated-images/<out>.raw.png (no text -- title is added later
 * by cover-add-title.mjs). Each call is a billed gpt-image-2 request (~$0.18).
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PHOTO = arg('photo');
const OUT = arg('out');
if (!PHOTO || !OUT) { console.error('need --photo <path> --out <name>'); process.exit(1); }
const STYLE = arg('style', 'none');
const MOOD = arg('mood', 'calm, warm, and quietly hopeful -- relaxed unfurrowed brow, soft open eyes, a gentle serene mouth; she looks reassured and quietly confident, never angry, defiant, smug, smirking, stern, or cold');
const DIR = 'tools/generated-images';
mkdirSync(DIR, { recursive: true });

const key = execSync("op read 'op://Automation/OpenClaw OpenAI API/credential'", { encoding: 'utf8' }).trim();
if (!key.startsWith('sk-')) { console.error('OpenAI key not retrieved from 1Password'); process.exit(1); }

// The colored-pencil "level 6" look, described fully so it does not depend on a
// reference drawing being attached.
const STYLE_DESC =
  'a LOOSE colored-pencil SKETCH made with a SOFT, BLUNT pencil used on its side, so EVERY stroke is THICK, WIDE, and ' +
  'CHUNKY -- generous broad marks, never fine, sharp, thin, or wispy lines. It must read as a real, expressive, loose ' +
  '"level 6" hand drawing, NOT a polished, precise, smooth, refined, or photorealistic "level 8" rendering. Lay down ' +
  'bold, broad, sweeping strokes quickly and confidently; render the HAIR as a few BROAD bundled strokes, not many fine ' +
  'individual strands; long wide gestural strokes through the hair and long diagonal sweeping strokes across the ' +
  'background that trail off the edges; coarse paper grain and clearly WIDE individual strokes everywhere, including ' +
  'across the face and skin; let the warm cream paper show through between strokes (broken, open, sketchy coverage, ' +
  'never a solid smooth fill). Use FEWER, BIGGER, BOLDER strokes. Avoid any fine, thin, sharp, narrow, wispy, or ' +
  'tightly-detailed pencil work. Vivid cobalt-blue, violet-purple, and warm-orange pencil on warm cream paper';

const TAIL =
  ' Keep her REAL face, her actual features and bone structure recognizable, but built from broad loose strokes rather than smooth blending. ' +
  `Her expression and mood should read as ${MOOD}. ` +
  'Tightly framed portrait with her face prominent, square, full-bleed to the edges. ' +
  'No text, no letters, no words, no numbers, and no watermark anywhere in the image. ' +
  'Avoid: photographic realism, smooth airbrushed blending, fine tight precise detail; babies/newborns/pregnancy; medical-exam, hospital, surgical, or drug/pill imagery.';

const form = new FormData();
form.append('model', 'gpt-image-2');
form.append('n', '1');
form.append('size', '1024x1024');
form.append('quality', 'high');
form.append('output_format', 'png');
form.append('moderation', 'low');

if (STYLE === 'none') {
  form.append('prompt', `Redraw the attached photograph of a real woman as ${STYLE_DESC}.${TAIL}`);
  form.append('image', new Blob([readFileSync(PHOTO)], { type: 'image/jpeg' }), 'woman.jpg');
} else {
  form.append('prompt',
    'Two images are attached. The FIRST is a photograph of a real woman. The SECOND is an ART-STYLE REFERENCE. ' +
    `Redraw the woman from the FIRST image as ${STYLE_DESC}, in the hand of the SECOND image.${TAIL}`);
  form.append('image[]', new Blob([readFileSync(PHOTO)], { type: 'image/jpeg' }), 'woman.jpg');
  form.append('image[]', new Blob([readFileSync(STYLE)], { type: 'image/webp' }), 'style.webp');
}

const res = await fetch('https://api.openai.com/v1/images/edits', {
  method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
});
const data = await res.json();
if (!res.ok) {
  console.error('OpenAI', res.status, JSON.stringify(data.error || data));
  if (String(JSON.stringify(data)).includes('billing_hard_limit_reached')) {
    console.error('>> Account billing hard limit reached. Tell Brian to refill; do NOT retry in a loop.');
  }
  process.exit(1);
}
writeFileSync(`${DIR}/${OUT}.raw.png`, Buffer.from(data.data[0].b64_json, 'base64'));
console.log(`wrote ${DIR}/${OUT}.raw.png  (style=${STYLE})`);
