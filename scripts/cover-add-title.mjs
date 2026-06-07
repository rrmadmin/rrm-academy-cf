/**
 * cover-add-title.mjs -- composite an RRM Academy commentary cover title +
 * watermark onto a finished colored-pencil illustration. Crisp real text in
 * Cormorant Garamond (the brand display font), NOT AI-rendered lettering.
 *
 * The title is set LARGE and left-aligned in the lower third, matching the cover
 * system ("Why Does / Endo Happen"). Pass multi-line titles with `|` between
 * lines, e.g. --title "PCOS Is Now|PMOS". All lines share one font size, chosen
 * so the WIDEST line fills the width (minus padding); shorter lines are left-
 * aligned and naturally shorter. We render each line, trim it to a tight box,
 * and scale by a single factor -- letterforms stay natural and the block is as
 * big as it can be. (We avoid SVG textLength/word-wrap because librsvg, which
 * Sharp uses, ignores them.)
 *
 * No text shadow: a drop shadow ghosts the title and a blurred one reads as a
 * glow. Legibility comes from the scrim gradient under the text.
 *
 * Usage (run from the rrm-academy-cf project root):
 *   node scripts/cover-add-title.mjs --in tools/generated-images/foo.raw.png \
 *     --title "PCOS Is Now|PMOS" --out foo-cover \
 *     [--size 1024] [--pad 0.05] [--font /path/to/CormorantGaramond-SemiBold.ttf]
 *
 * Writes <out>.png + <out>.webp + <out>.jpg into tools/generated-images/.
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const IN = arg('in');
const TITLE = arg('title');
const OUT = arg('out');
if (!IN || !TITLE || !OUT) { console.error('need --in --title --out'); process.exit(1); }
const S = parseInt(arg('size', '1024'), 10);
const PAD = Math.round(S * parseFloat(arg('pad', '0.05')));
const FONT = arg('font', `${homedir()}/Library/Fonts/CormorantGaramond-SemiBold.ttf`);
const DIR = 'tools/generated-images';

const fontB64 = readFileSync(FONT).toString('base64');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const avail = S - PAD * 2;
const REF = 300; // reference font size we render at, then scale down

const LINES = TITLE.split('|').map((s) => s.trim()).filter(Boolean);
const lineSvg = (text) => `<svg width="9000" height="900" xmlns="http://www.w3.org/2000/svg">
  <defs><style>
    @font-face { font-family: 'Cormorant Garamond'; font-weight: 600; src: url(data:font/ttf;base64,${fontB64}) format('truetype'); }
    .t { font-family: 'Cormorant Garamond'; font-weight: 600; font-size: ${REF}px; }
  </style></defs>
  <text x="0" y="430" class="t" fill="#ffffff">${esc(text)}</text>
</svg>`;

// Render + trim each line at the reference size.
const trims = [];
for (const ln of LINES) {
  trims.push(await sharp(Buffer.from(lineSvg(ln)), { density: 200 }).trim().toBuffer({ resolveWithObject: true }));
}
const FIT = parseFloat(arg('fit', '1'));   // fraction of available width the widest line fills
const maxW = Math.max(...trims.map((t) => t.info.width));
const scale = (avail * FIT) / maxW;

// Scale every line by the same factor (uniform font size).
const lines = [];
for (const t of trims) {
  lines.push(await sharp(t.data).resize({ width: Math.round(t.info.width * scale) }).png().toBuffer({ resolveWithObject: true }));
}
// Line spacing must come from the ACTUAL rendered glyph height, not a font-size
// estimate -- a line that fills the width gets very tall, and an underestimate
// makes the lines overlap.
const maxH = Math.max(...lines.map((l) => l.info.height));
const advance = Math.round(maxH * parseFloat(arg('leading', '1.06')));
const lastH = lines[lines.length - 1].info.height;
const blockBottom = Math.round(S * 0.92);
const blockTop = blockBottom - ((LINES.length - 1) * advance + lastH);

const overlay = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>
    @font-face { font-family: 'Cormorant Garamond'; font-weight: 600; src: url(data:font/ttf;base64,${fontB64}) format('truetype'); }
    .wm { font-family: 'Cormorant Garamond'; font-weight: 600; font-size: ${Math.round(S * 0.019)}px; letter-spacing: 0.5px; }
  </style>
  <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#1a1622" stop-opacity="0.42"/>
  </linearGradient></defs>
  <rect x="0" y="${Math.max(0, blockTop - Math.round(S * 0.04))}" width="${S}" height="${S}" fill="url(#scrim)"/>
  <text x="${S / 2}" y="${Math.round(S * 0.975)}" text-anchor="middle" class="wm" fill="#ffffff" fill-opacity="0.72">rrmacademy.org</text>
</svg>`;

// Optional thin HARD shadow (a small, crisp dark offset -- no blur) to pop the
// letters off the art. Keep it small; a large offset reads as a doubled title.
const SHADOW = parseInt(arg('shadow', '0'), 10);
const composites = [{ input: Buffer.from(overlay), top: 0, left: 0 }];
for (let i = 0; i < lines.length; i++) {
  const top = blockTop + i * advance;
  if (SHADOW > 0) {
    const dark = await sharp(lines[i].data).tint('#1a1622').png().toBuffer();
    composites.push({ input: dark, top: top + SHADOW, left: PAD + SHADOW });
  }
  composites.push({ input: lines[i].data, top, left: PAD });
}

const composed = sharp(IN).resize(S, S, { fit: 'cover' }).composite(composites);
await composed.clone().png().toFile(`${DIR}/${OUT}.png`);
await composed.clone().webp({ quality: 90 }).toFile(`${DIR}/${OUT}.webp`);
await composed.clone().jpeg({ quality: 88, mozjpeg: true }).toFile(`${DIR}/${OUT}.jpg`);
console.log(`wrote ${DIR}/${OUT}.{png,webp,jpg}  (${LINES.length} line(s), widest ${avail}px)`);
