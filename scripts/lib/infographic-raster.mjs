import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { woffToSfnt, normalizeFamily } from './woff-to-sfnt.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const F = (p) => join(REPO, 'node_modules/@fontsource', p);
// Cormorant 400/600 (numerals) + Inter 400/500/600 (labels), from fontsource.
//
// Three facts decided the shape of this file (2026-09-08, after the first share cards shipped
// in DejaVu Sans on CI and looked correct on a Mac):
//   1. fontsource ships WOFF; resvg's parser reads only raw SFNT, so each file is decoded.
//   2. fontsource names the heavier statics as their own family ("Inter SemiBold"), so a
//      font-family="Inter" font-weight="600" request never matched; the name table is rewritten.
//   3. resvg-js 2.6.2 ignores `font.fontBuffers` (and merely passing the key turns system
//      fonts back on, which is what hid 1 and 2 locally). `fontFiles` works, so the decoded
//      faces are written to a cache dir and loaded by path, with system fonts OFF so the
//      output is identical on every machine.
const FONT_FILES = [
  'cormorant-garamond/files/cormorant-garamond-latin-400-normal.woff',
  'cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff',
  'inter/files/inter-latin-400-normal.woff',
  'inter/files/inter-latin-500-normal.woff',
  'inter/files/inter-latin-600-normal.woff',
];
const CACHE = join(REPO, 'node_modules', '.cache', 'rrm-infographic-fonts');

export function fontFiles() {
  mkdirSync(CACHE, { recursive: true });
  return FONT_FILES.map((p) => {
    const src = F(p);
    const out = join(CACHE, p.split('/').pop().replace(/\.woff$/, '.ttf'));
    if (!existsSync(out) || statSync(out).mtimeMs < statSync(src).mtimeMs) {
      writeFileSync(out, normalizeFamily(woffToSfnt(readFileSync(src))));
    }
    return out;
  });
}

export function fontOptions() {
  return { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: 'Inter' };
}

export async function rasterize(svg) {
  const r = new Resvg(svg, { font: fontOptions() });
  return Buffer.from(r.render().asPng());
}
