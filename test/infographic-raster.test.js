import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rasterize } from '../scripts/lib/infographic-raster.mjs';
import { renderInfographic } from '../src/lib/infographic/templates.mjs';

const spec = { template: 'single', eyebrow: 'Outcome', value: '62%', label: 'live birth', source: { label: 'c', pmid: '1' } };

describe('rasterize', () => {
  it('produces a valid PNG', async () => {
    const png = await rasterize(renderInfographic(spec, { mode: 'standalone', aspect: '1:1', frame: 'branded' }));
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG magic bytes');
  });
  it('actually renders the text (blocker gate): with-fonts output differs from a text-free render', async () => {
    const withText = await rasterize(renderInfographic(spec, { mode: 'standalone', aspect: '1:1', frame: 'branded' }));
    // strip all <text>/<tspan> so any difference is attributable to glyph rendering
    const noText = await rasterize(renderInfographic(spec, { mode: 'standalone', aspect: '1:1', frame: 'branded' }).replace(/<text[\s\S]*?<\/text>/g, ''));
    assert.notEqual(withText.length, noText.length, 'text rendered into the PNG (glyphs present)');
  });
});
