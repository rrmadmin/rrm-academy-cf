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
  it('renders N in M with a figure pictograph (one figure per denominator)', () => {
    const svg = renderInfographic({ template: 'ratio', eyebrow: 'Burden', numerator: 1, denominator: 8, label: 'couples affected', source: src }, { mode: 'standalone', aspect: '1:1' });
    wf(svg);
    assert.ok(/1\s*in\s*8/i.test(svg.replace(/<[^>]+>/g, ' ')), 'headline reads 1 in 8');
    const figs = [...svg.matchAll(/<use href="#rf"/g)].length;
    assert.equal(figs, 8, 'one figure per denominator');
  });
});

describe('figures template', () => {
  const spec = { template: 'figures', eyebrow: 'Pregnant within 5 years', caption: '867 women', icon: 'woman',
    rows: [{ name: 'Family doctor first', value: 51.2, hero: true }, { name: 'Specialist first', value: 50.7 }], source: src };
  it('draws 10 figures per row, a partial clip for the fraction, and both values', () => {
    const svg = renderInfographic(spec, { mode: 'standalone', aspect: '1:1' });
    assert.ok((svg.match(/<use href="#fg"/g) || []).length >= 20);
    assert.ok(svg.includes('clipPath id="fc0_5"'));
    assert.ok(svg.includes('51.2%') && svg.includes('50.7%'));
    assert.ok(svg.includes('Family doctor first'));
  });
  it('renders in every aspect', () => {
    for (const aspect of ['1:1', '9:16', '1.91:1']) assert.ok(renderInfographic(spec, { mode: 'inline', aspect }).startsWith('<svg'));
  });
});

describe('figures highlight markup', () => {
  const spec = { template: 'figures', eyebrow: 'Pregnant', caption: 'a **b** c', icon: 'woman',
    rows: [{ name: '**Family doctor first**', value: 51.2, hero: true }, { name: 'Other', value: 50.7 }], source: src };
  it('draws a band behind the marked span and strips the markers from text and alt', () => {
    const svg = renderInfographic(spec, { mode: 'standalone', aspect: '1:1' });
    assert.ok(!svg.includes('**'));
    assert.ok(svg.includes('<tspan>Family doctor first</tspan>'));
    assert.ok((svg.match(/rx="3" fill="#e8ddef"/g) || []).length === 2);
    assert.ok(svg.includes('aria-label="Family doctor first 51.2%'));
  });
});
