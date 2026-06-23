import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderInfographic } from '../src/lib/infographic/templates.mjs';
import { validateSpec } from '../src/lib/infographic/validate.mjs';
import { houseStyleErrors } from '../src/lib/infographic/house-style.mjs';
import { rasterize } from './lib/infographic-raster.mjs';

const PRESETS = [
  { name: 'square', aspect: '1:1' },
  { name: 'portrait', aspect: '4:5' },
  { name: 'story', aspect: '9:16' },
  { name: 'card', aspect: '1.91:1' },
];

export async function buildAssets({ articles, outDir }) {
  const written = [];
  // House-style violations on a VALID spec mean the renderer produced off-brand output:
  // a hard build failure, not a per-article skip (which is reserved for invalid specs / IO).
  const hardErrors = [];
  for (const a of articles) {
    const spec = a && a.infographic;
    if (!spec || typeof spec !== 'object') continue;
    if (!validateSpec(spec).valid) continue; // a stored-invalid spec is skipped, not a build failure
    try {
      const dir = join(outDir, 'infographic', a.id);
      mkdirSync(dir, { recursive: true });
      for (const p of PRESETS) {
        const svg = renderInfographic(spec, { mode: 'standalone', aspect: p.aspect, frame: 'branded' });
        const hs = houseStyleErrors(svg, { branded: true });
        if (hs.length) { hardErrors.push(`${a.id}/${p.name}: ${hs.join('; ')}`); continue; }
        const png = await rasterize(svg);
        const out = join(dir, `${p.name}.png`);
        writeFileSync(out, png);
        written.push(out);
      }
    } catch (e) {
      console.warn(`infographic assets: SKIPPED ${a.id} (${e.message})`);
      continue;
    }
  }
  if (hardErrors.length) throw new Error('infographic house-style violations:\n' + hardErrors.join('\n'));
  return { written };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
  const data = JSON.parse(readFileSync(join(REPO, 'src/data/articles.json'), 'utf8'));
  const articles = Array.isArray(data) ? data : (data.articles || data.records || []);
  buildAssets({ articles, outDir: join(REPO, 'dist') })
    .then((r) => console.log(`infographic assets: wrote ${r.written.length} PNGs`))
    .catch((e) => { console.error('infographic assets FAILED:', e.message); process.exit(1); });
}
