import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { renderInfographic } from '../src/lib/infographic/templates.mjs';

const parser = new XMLParser({ ignoreAttributes: false });
function assertWellFormed(svg) {
  // throws on malformed XML
  parser.parse(svg);
  assert.ok(svg.startsWith('<svg'));
}

const src = { label: 'Cohort', pmid: '30109231' };

describe('single template', () => {
  const spec = { template: 'single', eyebrow: 'Outcome', value: '62%', label: 'live birth', source: src };
  it('renders well-formed inline SVG with the numeral as text', () => {
    const svg = renderInfographic(spec, { mode: 'inline', aspect: '1:1' });
    assertWellFormed(svg);
    assert.ok(svg.includes('62%'), 'numeral present as text');
    assert.ok(svg.includes('var(--'), 'inline uses css vars');
  });
  it('renders standalone with hex colors', () => {
    const svg = renderInfographic(spec, { mode: 'standalone', aspect: '1.91:1' });
    assertWellFormed(svg);
    assert.ok(/#[0-9a-f]{6}/i.test(svg), 'standalone uses hex');
    assert.ok(!svg.includes('var(--'), 'standalone has no css vars');
  });
  it('escapes XML-dangerous operator text', () => {
    const svg = renderInfographic({ ...spec, value: '<1%', label: 'IVF & ICSI' }, { mode: 'inline', aspect: '1:1' });
    assertWellFormed(svg);
    assert.ok(svg.includes('&lt;1%'), 'value escaped');
    assert.ok(svg.includes('IVF &amp; ICSI'), 'label escaped');
  });
});

describe('delta template', () => {
  it('renders favorable in sage and unfavorable in clay, with a tag', () => {
    const fav = renderInfographic({ template: 'delta', eyebrow: 'x', value: '38%', direction: 'up', polarity: 'favorable', label: 'higher', source: src }, { mode: 'standalone', aspect: '1:1' });
    assertWellFormed(fav);
    assert.ok(fav.includes('#5f6a52'), 'favorable uses ig-favorable hex');
    assert.ok(/Favorable/i.test(fav), 'polarity tag text present');
    const unf = renderInfographic({ template: 'delta', eyebrow: 'x', value: '3.2x', direction: 'up', polarity: 'unfavorable', label: 'risk', source: src }, { mode: 'standalone', aspect: '1:1' });
    assert.ok(unf.includes('#a0697c'), 'unfavorable uses ig-unfavorable hex');
  });
});
