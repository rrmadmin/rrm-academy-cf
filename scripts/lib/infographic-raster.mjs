import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const F = (p) => join(REPO, 'node_modules/@fontsource', p);
// Cormorant 400/600 (numerals) + Inter 400/500/600 (labels). woff buffers.
const FONT_FILES = [
  'cormorant-garamond/files/cormorant-garamond-latin-400-normal.woff',
  'cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff',
  'inter/files/inter-latin-400-normal.woff',
  'inter/files/inter-latin-500-normal.woff',
  'inter/files/inter-latin-600-normal.woff',
];
const fontBuffers = FONT_FILES.map((p) => new Uint8Array(readFileSync(F(p))));

export async function rasterize(svg) {
  const r = new Resvg(svg, {
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Inter' },
    // fitTo default = original; the SVG already carries width/height from svgShell.
  });
  return Buffer.from(r.render().asPng());
}
