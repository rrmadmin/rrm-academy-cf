import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { renderInfographic } from '../src/lib/infographic/templates.mjs';

const parser = new XMLParser({ ignoreAttributes: false });
const wf = (svg) => { parser.parse(svg); assert.ok(svg.startsWith('<svg')); };
const src = { label: 'Cohort', doi: '10.1000/abc' };

describe('bars template', () => {
  const spec = { template: 'bars', eyebrow: 'Live birth', unit: '%', caption: 'matched cohort',
    bars: [{ name: 'RRM', value: 62, hero: true }, { name: 'IVF', value: 34 }], source: src };
  it('renders well-formed with both values and the hero color', () => {
    const svg = renderInfographic(spec, { mode: 'standalone', aspect: '1:1' });
    wf(svg);
    assert.ok(svg.includes('62%') && svg.includes('34%'), 'both values present');
    assert.ok(svg.includes('#725e7e'), 'hero uses purple-700');
  });
  it('normalizes non-% units to the max value without overflow', () => {
    const cycles = { template: 'bars', eyebrow: 'Pregnancies', unit: 'cycles', caption: 'cumulative',
      bars: [{ name: 'RRM', value: 1240, hero: true }, { name: 'IVF', value: 680 }], source: src };
    const svg = renderInfographic(cycles, { mode: 'standalone', aspect: '1:1' });
    wf(svg);
    // tallest bar height must not exceed the plot height (no y < 0)
    const ys = [...svg.matchAll(/<rect[^>]*y="(-?\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
    assert.ok(ys.every((y) => y >= 0), 'no bar overflows the top');
  });
});

describe('ratio template', () => {
  it('renders N in M with a dot grid', () => {
    const svg = renderInfographic({ template: 'ratio', eyebrow: 'Burden', numerator: 1, denominator: 8, label: 'couples affected', source: src }, { mode: 'standalone', aspect: '1:1' });
    wf(svg);
    assert.ok(/1\s*in\s*8/i.test(svg.replace(/<[^>]+>/g, ' ')), 'headline reads 1 in 8');
    const dots = [...svg.matchAll(/<circle /g)].length;
    assert.equal(dots, 8, 'one dot per denominator');
  });
});
