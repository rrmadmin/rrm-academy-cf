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
  it('draws the chevron as a polygon, not a font glyph', () => {
    const up = renderInfographic({ template: 'delta', eyebrow: 'x', value: '38%', direction: 'up', polarity: 'favorable', label: 'higher', source: { label: 'c', pmid: '1' } }, { mode: 'standalone', aspect: '1:1' });
    assert.ok(up.includes('<polygon'), 'up delta has a polygon triangle');
    assert.ok(!up.includes('▲') && !up.includes('▼'), 'no chevron glyph chars in output');
    assert.ok(up.includes('38%'), 'value still present');
  });
  it('down direction: polygon present, no glyph chars, value renders', () => {
    const down = renderInfographic({ template: 'delta', eyebrow: 'x', value: '12%', direction: 'down', polarity: 'unfavorable', label: 'lower', source: { label: 'c', pmid: '1' } }, { mode: 'standalone', aspect: '1:1' });
    assert.ok(down.includes('&lt;polygon') || down.includes('<polygon'), 'down delta has a polygon triangle');
    assert.ok(!down.includes('▲') && !down.includes('▼'), 'no chevron glyph chars in output');
    assert.ok(down.includes('12%'), 'value still present');
  });
  it('1.91:1 short card: value row clears the eyebrow (no overlap)', () => {
    // Regression guard for the fixed-h*0.4 defect. On the shortest aspect the
    // value baseline used to extend into the eyebrow row. Parse both y coords
    // and assert the value's TOP (baseline - cap) sits below the eyebrow baseline
    // by at least the eyebrow font size (34px = one full line of clearance).
    const spec = { template: 'delta', eyebrow: 'PREGNANCY RATE', value: '38%',
      direction: 'up', polarity: 'favorable', label: 'higher live-birth rate', source: src };
    const svg = renderInfographic(spec, { mode: 'standalone', aspect: '1.91:1' });
    assertWellFormed(svg);

    // Extract the eyebrow <text> y= attribute. The eyebrow element is the only
    // <text> with letter-spacing="2.5". Find the full opening tag, then pull y= from it.
    const eyebrowTagMatch = svg.match(/<text[^>]*letter-spacing="2.5"[^>]*>/);
    assert.ok(eyebrowTagMatch, 'eyebrow text element found');
    const eyebrowYMatch = eyebrowTagMatch[0].match(/\by="([^"]+)"/);
    assert.ok(eyebrowYMatch, 'eyebrow y attribute found');
    const eyebrowBaseline = Number(eyebrowYMatch[1]);

    // The value <text> carries class="num". Find the tag then extract y=.
    const valueTagMatch = svg.match(/<text[^>]*class="num"[^>]*>/);
    assert.ok(valueTagMatch, 'value num text element found');
    const valueYMatch = valueTagMatch[0].match(/\by="([^"]+)"/);
    assert.ok(valueYMatch, 'value y attribute found');
    const valueBaseline = Number(valueYMatch[1]);

    // The value polygon (triangle) topY is valueBaseline - vFs*0.72.
    // We proxy-check: valueBaseline must be strictly greater than eyebrowBaseline
    // by at least the eyebrow font size (34px), meaning the cap clears the eyebrow line.
    const eyebrowFs = 34;
    assert.ok(
      valueBaseline > eyebrowBaseline + eyebrowFs,
      `value baseline ${valueBaseline} must be at least ${eyebrowBaseline + eyebrowFs + 1} (eyebrow ${eyebrowBaseline} + font ${eyebrowFs}) on 1.91:1`
    );

    // Also verify the polygon y coords are all greater than the eyebrow baseline.
    const polyMatch = svg.match(/<polygon[^>]*points="([^"]+)"/);
    assert.ok(polyMatch, 'polygon present');
    const polyYs = polyMatch[1].split(/\s+/).map((pt) => Number(pt.split(',')[1])).filter((v) => !isNaN(v));
    assert.ok(polyYs.every((y) => y > eyebrowBaseline), `all polygon y coords (${polyYs}) must be below eyebrow baseline ${eyebrowBaseline}`);
  });
});
