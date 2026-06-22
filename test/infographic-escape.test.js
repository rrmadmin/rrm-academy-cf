import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, color, ASPECTS } from '../src/lib/infographic/templates.mjs';

describe('escapeXml', () => {
  it('escapes all five predefined entities', () => {
    assert.equal(escapeXml(`a & b < c > d " e ' f`), 'a &amp; b &lt; c &gt; d &quot; e &apos; f');
  });
  it('leaves a plain percentage untouched', () => {
    assert.equal(escapeXml('38%'), '38%');
  });
});

describe('color', () => {
  it('returns a var() ref in inline mode', () => {
    assert.equal(color('purple-700', 'inline'), 'var(--purple-700)');
  });
  it('returns a hex in standalone mode', () => {
    assert.match(color('purple-700', 'standalone'), /^#[0-9a-f]{6}$/i);
  });
});

describe('ASPECTS', () => {
  it('defines the three presets with positive dimensions', () => {
    for (const k of ['1:1', '4:5', '1.91:1']) {
      assert.ok(ASPECTS[k].w > 0 && ASPECTS[k].h > 0);
    }
  });
});

import { RESOLVED_LIGHT } from '../src/lib/infographic/templates.mjs';
import { readFileSync } from 'node:fs';

describe('RESOLVED_LIGHT', () => {
  it('every token resolves to a 6-digit hex', () => {
    for (const [k, v] of Object.entries(RESOLVED_LIGHT)) {
      assert.match(v, /^#[0-9a-f]{6}$/i, `${k} is not a hex`);
    }
  });
  it('every ig/purple token name exists in global.css', () => {
    const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
    for (const k of Object.keys(RESOLVED_LIGHT)) {
      assert.ok(css.includes(`--${k}:`), `--${k} missing from global.css`);
    }
  });
});
