import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { renderInfographic } from '../src/lib/infographic/templates.mjs';
import { houseStyleErrors } from '../src/lib/infographic/house-style.mjs';
import { validateSpec } from '../src/lib/infographic/validate.mjs';

const parser = new XMLParser({ ignoreAttributes: false });
const wf = (svg) => { parser.parse(svg); assert.ok(svg.startsWith('<svg')); };
const src = { label: 'Cohort', pmid: '30109231' };
const WOMAN = 'M28.5 8.5C28.5';   // start of HW_WOMAN
const MAN = 'M28 8C28 10.2091';   // start of HM_HEAD

describe('houseStyleErrors (the proof gate)', () => {
  it('passes a real branded export', () => {
    const svg = renderInfographic({ template: 'single', eyebrow: 'x', value: '62%', label: 'live birth', source: src }, { mode: 'standalone', aspect: '1:1', frame: 'branded' });
    assert.deepEqual(houseStyleErrors(svg, { branded: true }), []);
  });
  it('passes a real inline render (no wordmark required when not branded)', () => {
    const svg = renderInfographic({ template: 'single', eyebrow: 'x', value: '62%', label: 'live birth', source: src }, { mode: 'inline', aspect: '1:1' });
    assert.deepEqual(houseStyleErrors(svg, { branded: false }), []);
  });
  it('flags a hand-rolled SVG that sets font-family as an attribute', () => {
    const hand = '<svg xmlns="http://www.w3.org/2000/svg"><text font-family="Cormorant Garamond">88%</text></svg>';
    const errs = houseStyleErrors(hand);
    assert.ok(errs.some((e) => /font-family= attribute/.test(e)), 'flags raw font-family attribute');
    assert.ok(errs.some((e) => /missing the house font/.test(e)), 'flags missing style block');
  });
  it('flags a branded export missing the canonical wordmark', () => {
    // standalone WITHOUT frame:'branded' has the style block + no font-family attr, but no wordmark.
    const svg = renderInfographic({ template: 'single', eyebrow: 'x', value: '62%', label: 'live birth', source: src }, { mode: 'standalone', aspect: '1:1' });
    assert.deepEqual(houseStyleErrors(svg, { branded: false }), [], 'fine when not asserting branded');
    assert.ok(houseStyleErrors(svg, { branded: true }).some((e) => /wordmark/.test(e)), 'flags missing wordmark when branded asserted');
  });
  it('flags an em dash', () => {
    const hand = '<svg xmlns="http://www.w3.org/2000/svg"><style>.num{font-family:x}</style><text>a — b</text></svg>';
    assert.ok(houseStyleErrors(hand).some((e) => /dash/.test(e)));
  });
});

describe('correction template', () => {
  const spec = { template: 'correction', eyebrow: 'Unexplained infertility', was: '50%', value: '8%', label: 'remain unexplained after a thorough workup', source: src };
  it('validates', () => assert.ok(validateSpec(spec).valid, validateSpec(spec).errors.join('; ')));
  it('requires was, value, and label', () => {
    assert.ok(!validateSpec({ ...spec, was: '' }).valid, 'was required');
    assert.ok(!validateSpec({ ...spec, value: '' }).valid, 'value required');
    assert.ok(!validateSpec({ ...spec, label: '' }).valid, 'label required');
  });
  it('renders well-formed at every aspect with both values present and a strikethrough', () => {
    for (const aspect of ['1:1', '4:5', '9:16', '1.91:1']) {
      const svg = renderInfographic(spec, { mode: 'standalone', aspect, frame: 'branded' });
      wf(svg);
      assert.ok(svg.includes('50%'), `was value present (${aspect})`);
      assert.ok(svg.includes('8%'), `corrected value present (${aspect})`);
      // provenance rule + strikethrough line => at least two <line> elements
      assert.ok((svg.match(/<line/g) || []).length >= 2, `strikethrough present (${aspect})`);
      assert.deepEqual(houseStyleErrors(svg, { branded: true }), [], `house-style clean (${aspect})`);
    }
  });
});

describe('single icon + adaptive visual', () => {
  it('default icon is woman; icon:"man" swaps the glyph', () => {
    const woman = renderInfographic({ template: 'single', eyebrow: 'x', value: '88%', label: 'l', source: src }, { mode: 'standalone', aspect: '1:1' });
    assert.ok(woman.includes(WOMAN) && !woman.includes(MAN), 'default woman');
    const man = renderInfographic({ template: 'single', eyebrow: 'x', value: '88%', label: 'l', icon: 'man', source: src }, { mode: 'standalone', aspect: '1:1' });
    assert.ok(man.includes(MAN) && !man.includes(WOMAN), 'icon:man uses the man glyph');
  });
  it('high rate uses the pictograph; low rate uses a progress bar', () => {
    const high = renderInfographic({ template: 'single', eyebrow: 'x', value: '88%', label: 'l', source: src }, { mode: 'standalone', aspect: '1:1' });
    assert.ok(high.includes('href="#hw"'), 'high % renders the figure pictograph');
    const low = renderInfographic({ template: 'single', eyebrow: 'x', value: '32%', label: 'l', source: src }, { mode: 'standalone', aspect: '1:1' });
    assert.ok(!low.includes('href="#hw"'), 'low % does NOT render a sparse pictograph');
  });
  it('rejects an unknown icon', () => {
    assert.ok(!validateSpec({ template: 'single', eyebrow: 'x', value: '88%', label: 'l', icon: 'robot', source: src }).valid);
  });
  it('headline drives the hero figure while value drives the pictograph fill', () => {
    const svg = renderInfographic({ template: 'single', eyebrow: 'x', value: '88%', headline: '9 in 10', label: '88% of women conceived within a year', source: src }, { mode: 'standalone', aspect: '1:1' });
    assert.ok(svg.includes('>9 in 10<'), 'hero shows the humanized headline');
    assert.ok(svg.includes('href="#hw"'), 'still a pictograph (value=88% drives the fill)');
    // the exact figure lives in the descriptor, not as a duplicate hero numeral
    const heroAsValue = svg.includes('class="num" font-size') && /class="num"[^>]*>88%</.test(svg);
    assert.ok(!heroAsValue, 'the raw 88% is not the hero numeral');
  });
  it('renders the subhead hook on tall aspects and omits it on the short card', () => {
    const spec = { template: 'single', eyebrow: 'x', value: '88%', headline: '9 in 10', subhead: 'women...', label: 'conceived within a year', source: src };
    const square = renderInfographic(spec, { mode: 'standalone', aspect: '1:1' });
    assert.ok(square.includes('>women...<'), 'square shows the subhead hook');
    const card = renderInfographic(spec, { mode: 'standalone', aspect: '1.91:1' });
    assert.ok(!card.includes('>women...<'), 'short 1.91:1 card omits the subhead (would overflow)');
  });
});

describe('ratio template uses figures, not dots', () => {
  it('renders icon glyphs (use href) rather than circles', () => {
    const svg = renderInfographic({ template: 'ratio', eyebrow: 'x', numerator: 1, denominator: 3, label: 'l', icon: 'man', source: src }, { mode: 'standalone', aspect: '1:1' });
    assert.ok(svg.includes('href="#rf"'), 'ratio draws figure glyphs');
    assert.ok(!svg.includes('<circle'), 'ratio no longer draws dot circles');
    assert.ok(svg.includes(MAN), 'ratio honours the icon');
  });
});
