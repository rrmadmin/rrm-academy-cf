/**
 * Standalone script to fetch blog data from Airtable and cache as JSON.
 * Run: AIRTABLE_PAT=xxx node src/lib/fetch-blog-data.mjs
 *
 * Image pipeline: If a post has an Image attachment in Airtable, the script
 * downloads it, compresses via Tinify API, converts to WebP + JPG, and
 * uploads both to R2 for permanent CDN URLs.
 *
 * Env vars:
 *   AIRTABLE_PAT      (required) Airtable personal access token
 *   TINIFY_API_KEY     (optional) Tinify compression — skips if not set
 *   CLOUDFLARE_API_TOKEN   (optional) needed for R2 uploads via wrangler
 *   CLOUDFLARE_ACCOUNT_ID  (optional) needed for R2 uploads via wrangler
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, mkdtempSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { API_URL, FIELDS } from './blog-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'posts.json');
const DRY_RUN = process.argv.includes('--dry-run');

const R2_BUCKET = 'rrm-assets';
const R2_PUBLIC_URL = 'https://pub-4af88159ce884265baba8fb4f3470625.r2.dev';

// --- R2 Upload (same pattern as fetch-courses-data.mjs) ---

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

  const sizeKB = (buffer.length / 1024).toFixed(1);
  console.log(`    R2: ${r2Key} (${sizeKB} KB)`);
}

// --- Tinify Image Processing ---

async function processImage(attachment, slug) {
  // Download from Airtable's temporary URL
  console.log(`  Downloading ${attachment.filename}...`);
  const imgRes = await fetch(attachment.url);
  if (!imgRes.ok) {
    console.error(`  Download failed (${imgRes.status})`);
    return null;
  }
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  console.log(`  Downloaded: ${(imgBuffer.length / 1024).toFixed(0)} KB`);

  const tinifyKey = process.env.TINIFY_API_KEY;
  if (!tinifyKey) {
    console.warn('  TINIFY_API_KEY not set — skipping image processing');
    return null;
  }

  // Compress via Tinify
  const auth = Buffer.from(`api:${tinifyKey}`).toString('base64');
  const tinifyAuth = { Authorization: `Basic ${auth}` };

  console.log(`  Compressing via Tinify...`);
  const shrinkRes = await fetch('https://api.tinify.com/shrink', {
    method: 'POST',
    headers: tinifyAuth,
    body: imgBuffer,
  });

  if (!shrinkRes.ok) {
    const errText = await shrinkRes.text();
    console.error(`  Tinify compression failed (${shrinkRes.status}): ${errText}`);
    return null;
  }

  const outputUrl = shrinkRes.headers.get('Location');
  const meta = await shrinkRes.json();
  const ratio = ((1 - meta.output.ratio) * 100).toFixed(0);
  console.log(`  Compressed: ${meta.output.size} bytes (${ratio}% smaller)`);

  // Convert to WebP
  console.log(`  Converting to WebP...`);
  const webpRes = await fetch(outputUrl, {
    method: 'POST',
    headers: { ...tinifyAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ convert: { type: 'image/webp' } }),
  });
  if (!webpRes.ok) {
    console.error(`  WebP conversion failed (${webpRes.status})`);
    return null;
  }
  const webpBuffer = Buffer.from(await webpRes.arrayBuffer());

  // Convert to JPG
  console.log(`  Converting to JPG...`);
  const jpgRes = await fetch(outputUrl, {
    method: 'POST',
    headers: { ...tinifyAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ convert: { type: 'image/jpeg' } }),
  });
  if (!jpgRes.ok) {
    console.error(`  JPG conversion failed (${jpgRes.status})`);
    return null;
  }
  const jpgBuffer = Buffer.from(await jpgRes.arrayBuffer());

  // Upload both to R2
  const webpKey = `commentary/${slug}.webp`;
  const jpgKey = `commentary/${slug}.jpg`;

  uploadBufferToR2(webpBuffer, webpKey, 'image/webp');
  uploadBufferToR2(jpgBuffer, jpgKey, 'image/jpeg');

  console.log(`  Done: WebP ${(webpBuffer.length / 1024).toFixed(0)} KB, JPG ${(jpgBuffer.length / 1024).toFixed(0)} KB`);
  return `${R2_PUBLIC_URL}/${webpKey}`;
}

// --- Main ---

async function fetchAll() {
  if (DRY_RUN) {
    const fixturePath = join(__dirname, '..', '..', '.pipeline', 'snapshots', 'latest', 'posts.json');
    const fallbackPath = join(__dirname, '..', 'data', 'posts.json');
    const source = existsSync(fixturePath) ? fixturePath : fallbackPath;
    const data = JSON.parse(readFileSync(source, 'utf-8'));
    console.log(`DRY-RUN: Loaded ${data.length} records from ${source}`);
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
    console.log(`DRY-RUN: Wrote ${data.length} records to ${OUTPUT_PATH}`);
    return;
  }

  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    console.error('Error: AIRTABLE_PAT environment variable required');
    process.exit(1);
  }

  const posts = [];
  let offset;
  let page = 0;

  const formula = encodeURIComponent("{Status}='Published'");
  const fieldsParams = FIELDS.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');

  do {
    page++;
    const url = `${API_URL}?${fieldsParams}&filterByFormula=${formula}&pageSize=100${
      offset ? `&offset=${offset}` : ''
    }`;

    let res;
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${pat}` },
        });
        lastError = undefined;
        if (res.status !== 429) break;
      } catch (e) {
        lastError = e;
      }
      const delay = Math.pow(2, attempt) * 1000;
      console.warn(`Retry ${attempt + 1}/5 in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }

    if (lastError) throw lastError;
    if (!res || !res.ok) {
      const err = res ? await res.text() : 'No response';
      throw new Error(`Airtable ${res?.status}: ${err}`);
    }

    const data = await res.json();
    offset = data.offset;

    for (const record of data.records) {
      const f = record.fields;

      if (f['Status'] !== 'Published') continue;
      const slug = f['Slug'];
      const title = f['Title'];
      if (!slug || !title) continue;

      // Capture first Image attachment (if any) for processing
      const imageField = f['Image'];
      const imageAttachment = Array.isArray(imageField) && imageField.length > 0
        ? imageField[0] : null;

      posts.push({
        id: record.id,
        slug: slug.trim(),
        title: title.trim(),
        excerpt: f['Excerpt'] || '',
        content: f['Content'] || '',
        author: f['Author'] || '',
        contentPillar: f['Content Pillar'] || '',
        coverImageUrl: f['Processed Cover URL'] || '',
        publishDate: f['Actual Publish Date'] || '',
        wordCount: f['Word Count'] ? Number(f['Word Count']) : 0,
        seoKeywords: f['SEO Keywords'] || '',
        audioUrl: f['Audio URL'] || '',
        _imageAttachment: imageAttachment,
      });
    }

    console.log(`Page ${page}: ${data.records.length} records (${posts.length} published with slug)`);
  } while (offset);

  // Process cover images: Airtable attachment -> Tinify -> R2
  const withImages = posts.filter(p => p._imageAttachment);
  if (withImages.length > 0) {
    console.log(`\nProcessing ${withImages.length} cover image(s)...`);
    for (const post of withImages) {
      console.log(`\n${post.slug}:`);
      try {
        const r2Url = await processImage(post._imageAttachment, post.slug);
        if (r2Url) {
          post.coverImageUrl = r2Url;
        }
      } catch (err) {
        console.error(`  Image processing failed: ${err.message}`);
        // Keep existing coverImageUrl (Processed Cover URL fallback)
      }
    }
  }

  // Clean up internal fields
  for (const post of posts) {
    delete post._imageAttachment;
  }

  // Sort newest first
  posts.sort((a, b) => {
    if (!a.publishDate && !b.publishDate) return 0;
    if (!a.publishDate) return 1;
    if (!b.publishDate) return -1;
    return b.publishDate.localeCompare(a.publishDate);
  });

  const seen = new Set();
  const deduplicated = posts.filter(p => {
    if (seen.has(p.slug)) {
      console.warn(`Warning: duplicate slug "${p.slug}" — keeping first occurrence`);
      return false;
    }
    seen.add(p.slug);
    return true;
  });

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(deduplicated, null, 2));
  console.log(`\nWrote ${deduplicated.length} posts to ${OUTPUT_PATH}`);
}

fetchAll().catch(err => {
  console.error(err);
  process.exit(1);
});
