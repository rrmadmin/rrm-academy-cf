#!/usr/bin/env node
/**
 * One-time script to optimize existing course cover images.
 *
 * Downloads covers from R2 public URL, compresses via Tinify,
 * converts to WebP + JPG at 800px wide, uploads to course-covers/ in R2.
 *
 * Usage:
 *   TINIFY_API_KEY=xxx node scripts/optimize-course-covers.mjs
 *
 * After running, trigger a full rebuild (fetch-all + build) so courses.json
 * picks up the optimized images via fetch-courses-data.mjs.
 */

import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

const R2_BUCKET = 'rrm-assets';

const COVERS = [
  { id: 'masterclass-endo-surgery', url: 'https://pub-4af88159ce884265baba8fb4f3470625.r2.dev/courses/masterclass-endo-surgery/cover.jpeg' },
  { id: 'long-term-endo', url: 'https://pub-4af88159ce884265baba8fb4f3470625.r2.dev/courses/long-term-endo/cover.jpg' },
  { id: 'postpartum', url: 'https://pub-4af88159ce884265baba8fb4f3470625.r2.dev/courses/postpartum/cover.png' },
  { id: 'rrm-vs-ivf', url: 'https://pub-4af88159ce884265baba8fb4f3470625.r2.dev/courses/rrm-vs-ivf/cover.png' },
];

function uploadBufferToR2(buffer, r2Key, contentType) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'r2-'));
  const tmpFile = join(tmpDir, 'upload');
  writeFileSync(tmpFile, buffer);

  try {
    execFileSync('npx', [
      'wrangler', 'r2', 'object', 'put',
      `${R2_BUCKET}/${r2Key}`,
      `--file=${tmpFile}`,
      `--content-type=${contentType}`,
      '--remote',
    ], { stdio: 'pipe', timeout: 60000 });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }

  console.log(`  R2: ${r2Key} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

async function optimizeCover(id, url) {
  const tinifyKey = process.env.TINIFY_API_KEY;
  const auth = Buffer.from(`api:${tinifyKey}`).toString('base64');
  const tinifyAuth = { Authorization: `Basic ${auth}` };

  console.log(`\n${id}: downloading...`);
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`Download failed: ${imgRes.status}`);
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  console.log(`  Original: ${(imgBuffer.length / 1024).toFixed(0)} KB`);

  // Compress
  console.log(`  Compressing...`);
  const shrinkRes = await fetch('https://api.tinify.com/shrink', {
    method: 'POST',
    headers: tinifyAuth,
    body: imgBuffer,
  });
  if (!shrinkRes.ok) throw new Error(`Tinify: ${shrinkRes.status} ${await shrinkRes.text()}`);
  const outputUrl = shrinkRes.headers.get('Location');
  const meta = await shrinkRes.json();
  console.log(`  Compressed: ${((1 - meta.output.ratio) * 100).toFixed(0)}% smaller`);

  // WebP (preserve original dimensions)
  console.log(`  Converting to WebP...`);
  const webpRes = await fetch(outputUrl, {
    method: 'POST',
    headers: { ...tinifyAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ convert: { type: 'image/webp' } }),
  });
  if (!webpRes.ok) throw new Error(`WebP failed: ${webpRes.status}`);
  const webpBuffer = Buffer.from(await webpRes.arrayBuffer());

  // JPG (preserve original dimensions)
  console.log(`  Converting to JPG...`);
  const jpgRes = await fetch(outputUrl, {
    method: 'POST',
    headers: { ...tinifyAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ convert: { type: 'image/jpeg' } }),
  });
  if (!jpgRes.ok) throw new Error(`JPG failed: ${jpgRes.status}`);
  const jpgBuffer = Buffer.from(await jpgRes.arrayBuffer());

  // Upload to R2
  uploadBufferToR2(webpBuffer, `course-covers/${id}.webp`, 'image/webp');
  uploadBufferToR2(jpgBuffer, `course-covers/${id}.jpg`, 'image/jpeg');

  const savings = ((1 - webpBuffer.length / imgBuffer.length) * 100).toFixed(0);
  console.log(`  Done: WebP ${(webpBuffer.length / 1024).toFixed(0)} KB, JPG ${(jpgBuffer.length / 1024).toFixed(0)} KB (${savings}% total savings)`);
}

async function main() {
  if (!process.env.TINIFY_API_KEY) {
    console.error('TINIFY_API_KEY required. Get one at https://tinypng.com/developers');
    process.exit(1);
  }

  console.log('Optimizing course cover images...');

  for (const cover of COVERS) {
    await optimizeCover(cover.id, cover.url);
  }

  console.log('\nAll done. Run a full rebuild to pick up optimized images:');
  console.log('  AIRTABLE_PAT=xxx npm run fetch-all && npm run build');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
