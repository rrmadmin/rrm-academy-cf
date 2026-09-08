import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { woffToSfnt, normalizeFamily } from '../scripts/lib/woff-to-sfnt.mjs';
import { fontOptions } from '../scripts/lib/infographic-raster.mjs';

const woff = readFileSync(new URL('../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff', import.meta.url));
const svg = (fam, w) => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="#fff"/><text x="10" y="50" font-family="${fam}" font-size="40" font-weight="${w}">Charting 51%</text></svg>`;
const ink = (fam, w, opts) => { const px = new Resvg(svg(fam, w), opts).render().pixels; let d = 0; for (let i = 0; i < px.length; i += 4) if (px[i] < 128) d++; return d; };

describe('woffToSfnt + normalizeFamily', () => {
  it('turns a fontsource WOFF into a raw SFNT with the same tables', () => {
    assert.equal(woff.toString('latin1', 0, 4), 'wOFF');
    const sfnt = woffToSfnt(woff);
    assert.equal(sfnt.readUInt32BE(0), 0x00010000);
    assert.equal(sfnt.readUInt16BE(4), woff.readUInt16BE(12));
    const tags = []; for (let i = 0; i < sfnt.readUInt16BE(4); i++) tags.push(sfnt.toString('latin1', 12 + i * 16, 16 + i * 16));
    for (const t of ['cmap', 'glyf', 'head', 'hhea', 'hmtx', 'name']) assert.ok(tags.includes(t), `missing ${t}`);
  });
  it('passes a non-WOFF buffer through unchanged', () => {
    const b = Buffer.from('OTTOxxxx'); assert.equal(woffToSfnt(b), b);
  });
  it('rewrites "Inter SemiBold" to family Inter, style SemiBold', () => {
    const n = normalizeFamily(woffToSfnt(woff));
    const s = n.toString('latin1');
    assert.ok(!/I\0n\0t\0e\0r\0 \0S\0e\0m\0i\0B\0o\0l\0d\0$/.test(s));
    assert.ok(n.length >= woff.length);
  });
});

describe('infographic rasterizer fonts (system fonts OFF)', () => {
  const opts = { font: fontOptions() };
  it('loads Inter and Cormorant Garamond by family, at distinct weights', () => {
    const none = ink('ZZNoSuchFace', 400, { font: { loadSystemFonts: false } });
    assert.equal(none, 0, 'with no fonts at all nothing renders (proves the flag is honoured)');
    const i400 = ink('Inter', 400, opts), i600 = ink('Inter', 600, opts);
    const c400 = ink('Cormorant Garamond', 400, opts), c600 = ink('Cormorant Garamond', 600, opts);
    assert.ok(i400 > 0 && i600 > 0 && c400 > 0 && c600 > 0);
    assert.notEqual(i400, i600, 'Inter 600 must not collapse to 400');
    assert.notEqual(c400, c600, 'Cormorant 600 must not collapse to 400');
    assert.notEqual(i400, c400, 'Inter and Cormorant must be different faces');
  });
  it('a raw WOFF buffer is not usable by resvg (the reason the decoder exists)', () => {
    // fontBuffers is ignored by resvg-js 2.6.2; this pins that a WOFF via fontFiles fails too.
    const bad = ink('Inter', 400, { font: { fontFiles: [new URL('../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff', import.meta.url).pathname], loadSystemFonts: false } });
    assert.equal(bad, 0);
  });
});
