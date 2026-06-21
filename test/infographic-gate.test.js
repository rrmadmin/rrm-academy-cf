import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const GATE = new URL('../scripts/gates/validate-infographic-svg.mjs', import.meta.url).pathname;

describe('infographic SVG gate', () => {
  it('passes on the canonical samples', () => {
    const out = execFileSync('node', [GATE], { encoding: 'utf8' });
    assert.match(out, /OK: \d+ renders well-formed/);
  });
});
