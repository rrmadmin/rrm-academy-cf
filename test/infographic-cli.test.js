import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const CLI = new URL('../scripts/infographic-render.mjs', import.meta.url).pathname;
function run(specObj) {
  try {
    const out = execFileSync('node', [CLI, '--mode', 'standalone'], { input: JSON.stringify(specObj), encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}

describe('infographic-render CLI', () => {
  it('exits 0 and prints SVG for a valid spec', () => {
    const r = run({ template: 'single', eyebrow: 'x', value: '62%', label: 'live birth', source: { label: 'c', pmid: '1' } });
    assert.equal(r.code, 0);
    assert.ok(r.out.startsWith('<svg'));
  });
  it('exits non-zero with no SVG on an invalid spec', () => {
    const r = run({ template: 'single', eyebrow: 'x', source: { label: 'c', pmid: '1' } });
    assert.notEqual(r.code, 0);
    assert.ok(!r.out.startsWith('<svg'));
    assert.match(r.err, /value required/);
  });
});
