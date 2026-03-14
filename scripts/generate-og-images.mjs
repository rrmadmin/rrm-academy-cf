// scripts/generate-og-images.mjs
// Pre-build script: generates OG images for all registered pages
// Usage: node scripts/generate-og-images.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ogTemplate } from './og-template.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'images', 'og');

// --- Page Registry ---
// Phase 1: just /about for testing
// Phase 2: expand to all static pages + FAQ data
const STATIC_PAGES = [
  { slug: 'about', title: 'About RRM Academy', description: 'Expert-led education in restorative reproductive medicine. Clinician-taught courses and research resources, all free or low-cost.' },
];

// --- Font Loading ---
function loadFont(pkg, filename) {
  const fontPath = join(ROOT, 'node_modules', '@fontsource', pkg, 'files', filename);
  return readFileSync(fontPath);
}

// --- Main ---
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const cormorant600 = loadFont('cormorant-garamond', 'cormorant-garamond-latin-600-normal.woff');
  const inter400 = loadFont('inter', 'inter-latin-400-normal.woff');

  const fonts = [
    { name: 'Cormorant Garamond', data: cormorant600, weight: 600, style: 'normal' },
    { name: 'Inter', data: inter400, weight: 400, style: 'normal' },
  ];

  // Collect all pages to generate
  const pages = [...STATIC_PAGES];

  // TODO Phase 2: read faqs.json and add FAQ pages

  console.log(`Generating ${pages.length} OG image(s)...`);
  let generated = 0;

  for (const page of pages) {
    const filename = `og-${page.slug}.png`;
    const outPath = join(OUT_DIR, filename);

    const svg = await satori(ogTemplate(page.title, page.description), {
      width: 1200,
      height: 630,
      fonts,
    });

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    writeFileSync(outPath, pngBuffer);
    generated++;
  }

  console.log(`✓ Generated ${generated} OG image(s) in public/images/og/`);
}

main().catch(err => {
  console.error('OG image generation failed:', err);
  process.exit(1);
});
