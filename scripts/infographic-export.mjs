import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

export const PRESETS = {
  square: { aspect: '1:1', w: 1080, h: 1080 },      // IG feed + X in-stream + FB
  portrait: { aspect: '4:5', w: 1080, h: 1350 },    // IG feed
  story: { aspect: '9:16', w: 1080, h: 1920 },      // IG / FB stories
  card: { aspect: '1.91:1', w: 1200, h: 630 },      // X summary card + on-page OG
  og: { aspect: '1.91:1', w: 1200, h: 630 },        // alias of card
};
export const DEFAULT_PRESETS = ['square', 'portrait', 'story', 'card'];

function renderStandaloneSvg(specPath, aspect, platform) {
  const cli = join(REPO, 'scripts/infographic-render.mjs');
  // execFileSync throws on non-zero exit, surfacing the CLI error (exit-code gate).
  return execFileSync('node', [cli, '--file', specPath, '--mode', 'standalone', '--aspect', aspect, '--frame', 'branded', '--platform', platform], { encoding: 'utf8' });
}

async function rasterizePng(svg, w, h, pngPath) {
  try {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><meta charset="utf8"><body style="margin:0">${svg}</body>`, { waitUntil: 'networkidle' });
      await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: w, height: h } });
    } finally { await browser.close(); }
    return 'chromium';
  } catch (e) {
    const { Resvg } = await import('@resvg/resvg-js');
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();
    writeFileSync(pngPath, png);
    return 'resvg';
  }
}

async function encodeWebp(pngPath, webpPath) {
  const sharp = (await import('sharp')).default;
  await sharp(pngPath).webp({ quality: 90 }).toFile(webpPath);
}

export async function exportPresets({ specPath, presets, outDir, platform = 'ig' }) {
  mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const name of presets) {
    const p = PRESETS[name];
    if (!p) throw new Error(`unknown preset: ${name}`);
    const svg = renderStandaloneSvg(specPath, p.aspect, platform);
    const svgPath = join(outDir, `${name}.svg`);
    const pngPath = join(outDir, `${name}.png`);
    const webpPath = join(outDir, `${name}.webp`);
    writeFileSync(svgPath, svg);
    await rasterizePng(svg, p.w, p.h, pngPath);
    await encodeWebp(pngPath, webpPath);
    files.push(svgPath, pngPath, webpPath);
  }
  return { files };
}

// CLI: node scripts/infographic-export.mjs --file spec.json --out ./dir [--presets square,portrait,story,card] [--platform ig|x]
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const specPath = arg('--file', null);
  const outDir = arg('--out', './infographic-out');
  const presets = arg('--presets', DEFAULT_PRESETS.join(',')).split(',');
  const platform = arg('--platform', 'ig');
  exportPresets({ specPath, presets, outDir, platform })
    .then((r) => { process.stdout.write(r.files.join('\n') + '\n'); })
    .catch((e) => { process.stderr.write(`error: ${e.message}\n`); process.exit(1); });
}
