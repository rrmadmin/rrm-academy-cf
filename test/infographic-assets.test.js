import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAssets } from '../scripts/build-infographic-assets.mjs';

const article = { id: 'rec0000000000001', infographic: { template: 'bars', eyebrow: 'Live birth', unit: '%', caption: 'RRM vs IVF', bars: [{ name: 'RRM', value: 62, hero: true }, { name: 'IVF', value: 34 }], source: { label: 'c', pmid: '1' } } };

describe('buildAssets', () => {
  it('writes 4 preset PNGs for an article with an infographic, none for one without', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iga-'));
    const { written } = await buildAssets({ articles: [article, { id: 'rec0000000000002' }], outDir: dir });
    for (const p of ['square', 'portrait', 'story', 'card']) {
      const f = join(dir, 'infographic', 'rec0000000000001', `${p}.png`);
      assert.ok(existsSync(f), `${p}.png written`);
      assert.deepEqual([...readFileSync(f).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    }
    assert.ok(!existsSync(join(dir, 'infographic', 'rec0000000000002')), 'no dir for article without infographic');
    assert.equal(written.length, 4);
  });
});
