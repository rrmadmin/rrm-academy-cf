import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { renderInfographic, ASPECTS } from '../src/lib/infographic/templates.mjs';
import { SAMPLES } from '../src/lib/infographic/samples.mjs';

const parser = new XMLParser({ ignoreAttributes: false });
const wf = (svg) => { parser.parse(svg); assert.ok(svg.startsWith('<svg')); };
const DASH = /[–—]/;
const ASPECT_KEYS = Object.keys(ASPECTS); // 1:1, 4:5, 9:16, 1.91:1

describe('branded frame export', () => {
  it('renders every template at every aspect: well-formed, no dashes, no negative coords, with wordmark + footer', () => {
    for (const spec of SAMPLES) {
      for (const aspect of ASPECT_KEYS) {
        const svg = renderInfographic(spec, { mode: 'standalone', aspect, frame: 'branded' });
        wf(svg);
        assert.ok(!DASH.test(svg), `${spec.template}/${aspect} has a dash`);
        // wordmark present (inlined paths) + accent bar + footer url (single brand attribution)
        assert.ok(/<path/.test(svg), `${spec.template}/${aspect} missing wordmark paths`);
        assert.ok(svg.includes('rrmacademy.org'), `${spec.template}/${aspect} missing url footer`);
        // no element placed at a negative coordinate (off the top/left of canvas).
        // require a whitespace-delimited attribute so the wordmark's viewBox="-21 ..." (the
        // "x" in viewBox) is not a false positive.
        assert.ok(!/\s(?:x|y|cx|cy)="-\d/.test(svg), `${spec.template}/${aspect} has a negative coord`);
      }
    }
  });

  it('uses standalone resolved hex (no css vars) in branded output', () => {
    const svg = renderInfographic(SAMPLES[0], { mode: 'standalone', aspect: '1:1', frame: 'branded' });
    assert.ok(/#[0-9a-f]{6}/i.test(svg) && !svg.includes('var(--'));
  });

  it('on-page inline render carries the footer (theme-aware) but no wordmark', () => {
    const svg = renderInfographic(SAMPLES[2], { mode: 'inline', aspect: '1.91:1' });
    assert.ok(svg.includes('rrmacademy.org'), 'inline carries the footer branding');
    assert.ok(!/<path/.test(svg), 'inline has no wordmark paths');
    assert.ok(svg.includes('var(--'), 'inline footer uses css vars (theme-aware)');
  });

  it('inline + branded throws (the wordmark needs standalone hex)', () => {
    assert.throws(() => renderInfographic(SAMPLES[0], { mode: 'inline', aspect: '1:1', frame: 'branded' }));
  });

  it('supports the new 9:16 story aspect', () => {
    assert.ok(ASPECTS['9:16'].w === 1080 && ASPECTS['9:16'].h === 1920);
  });
});
