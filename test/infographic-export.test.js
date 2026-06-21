import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPresets } from '../scripts/infographic-export.mjs';

describe('exportPresets', () => {
  it('emits a valid PNG and WebP for the square preset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ig-'));
    const specPath = join(dir, 'spec.json');
    writeFileSync(specPath, JSON.stringify({ template: 'single', eyebrow: 'x', value: '62%', label: 'live birth', source: { label: 'c', pmid: '30109231' } }));
    const { files } = await exportPresets({ specPath, presets: ['square'], outDir: dir });
    const png = readFileSync(files.find((f) => f.endsWith('.png')));
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG magic bytes');
    const webp = readFileSync(files.find((f) => f.endsWith('.webp')));
    assert.equal(webp.subarray(0, 4).toString('ascii'), 'RIFF', 'WebP RIFF header');
    assert.equal(webp.subarray(8, 12).toString('ascii'), 'WEBP', 'WebP signature');
  });
});
