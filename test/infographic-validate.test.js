import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../src/lib/infographic/validate.mjs';

const goodSource = { label: 'Boyle 2018', pmid: '30109231' };
const okBars = {
  template: 'bars', eyebrow: 'Live birth', unit: '%', caption: 'matched cohort',
  bars: [{ name: 'RRM', value: 62, hero: true }, { name: 'IVF', value: 34 }],
  source: goodSource,
};

describe('validateSpec', () => {
  it('accepts a well-formed bars spec', () => {
    assert.equal(validateSpec(okBars).valid, true);
  });
  it('rejects unknown template', () => {
    assert.equal(validateSpec({ ...okBars, template: 'pie' }).valid, false);
  });
  it('rejects missing source', () => {
    const s = { ...okBars }; delete s.source;
    assert.equal(validateSpec(s).valid, false);
  });
  it('rejects empty-string identifier as absent', () => {
    assert.equal(validateSpec({ ...okBars, source: { label: 'x', pmid: '' } }).valid, false);
  });
  it('rejects malformed doi', () => {
    assert.equal(validateSpec({ ...okBars, source: { label: 'x', doi: 'banana' } }).valid, false);
  });
  it('rejects two hero bars', () => {
    assert.equal(validateSpec({ ...okBars, bars: [{ name: 'a', value: 1, hero: true }, { name: 'b', value: 2, hero: true }] }).valid, false);
  });
  it('rejects zero hero bars', () => {
    assert.equal(validateSpec({ ...okBars, bars: [{ name: 'a', value: 1 }, { name: 'b', value: 2 }] }).valid, false);
  });
  it('rejects bar value >100 when unit is %', () => {
    assert.equal(validateSpec({ ...okBars, bars: [{ name: 'a', value: 140, hero: true }, { name: 'b', value: 2 }] }).valid, false);
  });
  it('rejects ratio denominator 0', () => {
    assert.equal(validateSpec({ template: 'ratio', eyebrow: 'x', numerator: 1, denominator: 0, label: 'x', source: goodSource }).valid, false);
  });
  it('rejects numerator > denominator', () => {
    assert.equal(validateSpec({ template: 'ratio', eyebrow: 'x', numerator: 9, denominator: 8, label: 'x', source: goodSource }).valid, false);
  });
  it('rejects delta missing direction', () => {
    assert.equal(validateSpec({ template: 'delta', eyebrow: 'x', value: '38%', polarity: 'favorable', label: 'x', source: goodSource }).valid, false);
  });
  it('rejects single missing value', () => {
    assert.equal(validateSpec({ template: 'single', eyebrow: 'x', label: 'x', source: goodSource }).valid, false);
  });
  it('rejects eyebrow over 28 chars', () => {
    assert.equal(validateSpec({ ...okBars, eyebrow: 'x'.repeat(29) }).valid, false);
  });
  it('rejects an em dash in any string field', () => {
    assert.equal(validateSpec({ ...okBars, caption: 'a — b' }).valid, false);
  });
  it('rejects ratio denominator > 20', () => {
    assert.equal(validateSpec({ template: 'ratio', eyebrow: 'x', numerator: 1, denominator: 21, label: 'x', source: goodSource }).valid, false);
  });
  it('rejects ratio non-integer numerator', () => {
    assert.equal(validateSpec({ template: 'ratio', eyebrow: 'x', numerator: 1.5, denominator: 8, label: 'x', source: goodSource }).valid, false);
  });
  it('rejects bars with 4 entries', () => {
    assert.equal(validateSpec({ ...okBars, bars: [{ name: 'a', value: 1, hero: true }, { name: 'b', value: 2 }, { name: 'c', value: 3 }, { name: 'd', value: 4 }] }).valid, false);
  });
  it('rejects delta missing polarity', () => {
    assert.equal(validateSpec({ template: 'delta', eyebrow: 'x', value: '38%', direction: 'up', label: 'x', source: goodSource }).valid, false);
  });
  it('rejects en dash in a string field', () => {
    assert.equal(validateSpec({ ...okBars, caption: 'a – b' }).valid, false);
  });
});
