#!/usr/bin/env node
/**
 * One-shot: convert single-color token definitions in global.css from hex/rgb()
 * to oklch() (Björn Ottosson's OKLab reference math). Every conversion is
 * round-trip verified: the emitted oklch() must resolve back to the exact
 * original 8-bit sRGB channels or the token is left untouched and reported.
 *
 * Skips: values that are not exactly one color literal (gradients, shadows,
 * font stacks), and values already in oklch().
 *
 * Usage: node scripts/css-audit/convert-oklch.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DRY = process.argv.includes('--dry');
const FILE = path.join(ROOT, 'src/styles/global.css');

// --- sRGB <-> OKLCH ---
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function rgbToOklch(r8, g8, b8) {
  const r = lin(r8 / 255), g = lin(g8 / 255), b = lin(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b2 = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(a * a + b2 * b2);
  let H = (Math.atan2(b2, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, C < 1e-6 ? 0 : H];
}

function oklchToRgb(L, C, H) {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr), b2 = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b2) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b2) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b2) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, b].map((c) => Math.round(Math.min(1, Math.max(0, gam(c))) * 255));
}

function parseLiteral(v) {
  let m = v.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: null };
  }
  m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : null };
  return null;
}

/** Find the most compact oklch string that round-trips to the exact 8-bit channels. */
function toExactOklch(r, g, b, alpha) {
  const [L, C, H] = rgbToOklch(r, g, b);
  for (const [lp, cp, hp] of [[2, 4, 1], [3, 5, 2], [4, 6, 3]]) {
    const Ls = (L * 100).toFixed(lp).replace(/\.?0+$/, '');
    const Cs = C.toFixed(cp).replace(/\.?0+$/, '') || '0';
    const Hs = H.toFixed(hp).replace(/\.?0+$/, '') || '0';
    const [r2, g2, b2] = oklchToRgb(Number(Ls) / 100, Number(Cs), Number(Hs));
    if (r2 === r && g2 === g && b2 === b) {
      return `oklch(${Ls}% ${Cs} ${Hs}${alpha !== null ? ` / ${alpha}` : ''})`;
    }
  }
  return null;
}

let css = fs.readFileSync(FILE, 'utf8');
let converted = 0, skippedComposite = 0, alreadyOklch = 0, failed = [];

css = css.replace(/^(\s*)(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/gm, (full, ind, name, value) => {
  const v = value.trim();
  if (/^oklch\(/.test(v)) { alreadyOklch++; return full; }
  const lit = parseLiteral(v);
  if (!lit) { skippedComposite++; return full; }
  const ok = toExactOklch(lit.r, lit.g, lit.b, lit.a);
  if (!ok) { failed.push(`${name}: ${v}`); return full; }
  converted++;
  return `${ind}${name}: ${ok}; /* ${v} */`;
});

if (!DRY) fs.writeFileSync(FILE, css);
console.log(DRY ? 'DRY RUN' : 'WRITTEN');
console.log({ converted, alreadyOklch, skippedNonSingleColor: skippedComposite, failedRoundTrip: failed.length });
if (failed.length) console.log('failed:', failed.join('\n'));
