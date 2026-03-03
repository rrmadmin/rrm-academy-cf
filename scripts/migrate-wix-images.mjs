#!/usr/bin/env node
/**
 * Migrate Wix CDN images to Cloudflare R2 and update D1 post bodies.
 *
 * Usage:
 *   node scripts/migrate-wix-images.mjs
 *
 * Requires: npx wrangler configured with R2 bucket binding.
 * Does NOT auto-run D1 updates -- prints SQL to stdout for review.
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { basename } from 'path';

const TMP = '/tmp/wix-migration/images';
const BUCKET = 'rrm-assets';

// ── Post image mapping ──
// Each entry: [wixUrl (base, no /v1/fill/...), r2Key, postId, placeholderRegex, altText]
const POST_IMAGES = [
  {
    url: 'https://static.wixstatic.com/media/3a54ee_394661c6ce9f4fd7b038b9f53efcacd0~mv2.png',
    r2Key: 'community/wix-3a54ee_394661c6ce9f4fd7b038b9f53efcacd0~mv2.png',
    postId: '58369e915d0f41b8a9884b759493e7fa',
    placeholder: '[Image of event flyer for Fertility Based Methods of Family Planning: New Horizons in Gynecologic Wellness – Live lecture exclusive for members, Monday November 10, 6pm EST]',
    alt: 'FABM lecture flyer',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_4e380c19d387407eba05d837fe34244b~mv2.jpg',
    r2Key: 'community/wix-127d5c_4e380c19d387407eba05d837fe34244b~mv2.jpg',
    postId: 'a390b27144e143ffb2a5a1fbbcd68370',
    placeholder: '[Photo from what appears to be a government/congressional building event]',
    alt: 'Congressional building event photo',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_7a18d2ce107b4bc6bda1d8a42a7df6fb~mv2.png',
    r2Key: 'community/wix-127d5c_7a18d2ce107b4bc6bda1d8a42a7df6fb~mv2.png',
    postId: 'c2152628f220409f88c96481a2758963',
    placeholder: '[Selfie photo, appears to be outside a government building in DC]',
    alt: 'Dr. Whittaker selfie outside DC government building',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_c573fdf8993d4a14b9d028a0e2cc4701~mv2.png',
    r2Key: 'community/wix-127d5c_c573fdf8993d4a14b9d028a0e2cc4701~mv2.png',
    postId: '911f982303d4451b824224f26e9e9b6a',
    placeholder: '[Image with text "future fertility restorative"]',
    alt: 'RRM future fertility restorative website preview',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_fabbd1c3f22e4b36aeed12dc79507de3~mv2.jpg',
    r2Key: 'community/wix-127d5c_fabbd1c3f22e4b36aeed12dc79507de3~mv2.jpg',
    postId: '0a0251596be4451f8eb40befe92c197a',
    placeholder: '[Screenshot of recording]',
    alt: 'Lecture 1 recording screenshot',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_bdd156f14dc94ff493afe7fcb0185abc~mv2.png',
    r2Key: 'community/wix-127d5c_bdd156f14dc94ff493afe7fcb0185abc~mv2.png',
    postId: 'ebd0da55dec643fda4a3dc13dd47d571',
    placeholder: '[Image: "Restorative Reproductive Medicine \\u2013 A Comprehensive, Whole Person Approach to Addressing Infertility and Reproductive Health"]',
    alt: 'RRM lecture announcement',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_dd02637b457543028251cc19c57461d2~mv2.png',
    r2Key: 'community/wix-127d5c_dd02637b457543028251cc19c57461d2~mv2.png',
    postId: '1cf65ae0b1c14b0aa094a79fd714b01b',
    placeholder: '[Screenshot of RRM Academy Uterus Allies Save the Uterus Club monthly meeting schedule slide with Lorraine Truman on screen]',
    alt: 'Video Call 3 slide screenshot',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_6ad79be8d1ff45f086eee2574c2e73f4~mv2.png',
    r2Key: 'community/wix-127d5c_6ad79be8d1ff45f086eee2574c2e73f4~mv2.png',
    postId: '2256a3fc18164975a44d008b8bbafebf',
    placeholder: '[Logo design \\u2013 "Save the Uterus Club" v1 sketch]',
    alt: 'Save the Uterus Club logo v1 sketch',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_7acac5606c0e49a8ae514170462cd01f~mv2.png',
    r2Key: 'community/wix-127d5c_7acac5606c0e49a8ae514170462cd01f~mv2.png',
    postId: 'db1f4c0e7015481dadca721bd9d9c288',
    placeholder: '[Video screenshots \\u2013 Instagram live with @napro_fertility_surgeon]',
    alt: 'Dr. Clay Instagram live screenshot',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_893418395c594ee395e1dcff629094d7~mv2.png',
    r2Key: 'community/wix-127d5c_893418395c594ee395e1dcff629094d7~mv2.png',
    postId: '2f2ce05e574a4ed89384b802d4e01c6c',
    placeholder: '[Notes app screenshot \\u2013 "Do you want to know why your endometriosis surgery only took an hour? And didn\\u2019t help much?"]',
    alt: 'Notes app screenshot about endometriosis surgery',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_b5e49698dc344608b9a9281affd32047~mv2.png',
    r2Key: 'community/wix-127d5c_b5e49698dc344608b9a9281affd32047~mv2.png',
    postId: 'b11017bdde714ffaa7a93ed890b36e7e',
    // This one has a very long placeholder; we'll match by prefix
    placeholderPrefix: '[Screenshot of PDF "Infertility_MentalHealth',
    alt: 'Infertility mental health PDF cover',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_05bc0338d09b4707ace6b68c8eb5903c~mv2.png',
    r2Key: 'community/wix-127d5c_05bc0338d09b4707ace6b68c8eb5903c~mv2.png',
    postId: '13212080145d4be4ad45c886de1ecc1f',
    placeholderPrefix: '[Infographic from RESOLVE',
    alt: 'RESOLVE infographic about RRM',
  },
  {
    url: 'https://static.wixstatic.com/media/127d5c_169bc56545e048a897d64a4dbb2db875~mv2.png',
    r2Key: 'community/wix-127d5c_169bc56545e048a897d64a4dbb2db875~mv2.png',
    postId: 'bbb21934b85d4f06ad9fff63c96ff038',
    placeholder: '[Uterus mascot image]',
    alt: 'Save the Uterus Club welcome mascot',
  },
];

// Additional images to upload to R2 (no post body update needed -- posts without placeholders)
const EXTRA_IMAGES = [
  'https://static.wixstatic.com/media/b27cf5_fe85a9ef7444415b9985aec15e651b0b~mv2.webp',
  'https://static.wixstatic.com/media/b27cf5_d216890a68094deda06da909eb85a03a~mv2.webp',
  'https://static.wixstatic.com/media/3a54ee_41168390130149af8db6abf104c3c375~mv2.jpg',
  'https://static.wixstatic.com/media/b27cf5_9181c5068dc94c948fc9c2b01664bebb~mv2.webp',
  'https://static.wixstatic.com/media/b27cf5_aafffc338105413ba444b14b0198111e~mv2.webp',
  'https://static.wixstatic.com/media/b27cf5_574633aa7e854180b45b03ffc9bf8fca~mv2.webp',
  'https://static.wixstatic.com/media/127d5c_17f41d9d75b847dfb205882d7447565b~mv2.jpg',
  'https://static.wixstatic.com/media/b27cf5_ea14ee6170e84857ae43bbddaf323587~mv2.png',
  'https://static.wixstatic.com/media/127d5c_8ae11ac7000141338ea459d9451cf64a~mv2.jpg',
  'https://static.wixstatic.com/media/b27cf5_b821da05de344082b8ff17149aa2237e~mv2.png',
  'https://static.wixstatic.com/media/1b8b3c_d834d54f54444adc913f4942c7b7c5d5~mv2.png',
];

function r2KeyFromUrl(url) {
  const filename = url.split('/media/')[1];
  return `community/wix-${filename}`;
}

async function downloadFile(url, destPath) {
  try {
    execSync(`curl -sS -L -o "${destPath}" "${url}"`, { timeout: 30000 });
    return true;
  } catch (e) {
    console.error(`  FAIL download: ${url} -- ${e.message}`);
    return false;
  }
}

function uploadToR2(localPath, r2Key) {
  try {
    execSync(`cd /Users/brian/iCode/projects/rrm-academy-cf && npx wrangler r2 object put "${BUCKET}/${r2Key}" --file="${localPath}"`, { timeout: 30000 });
    return true;
  } catch (e) {
    console.error(`  FAIL upload: ${r2Key} -- ${e.message}`);
    return false;
  }
}

// ── Main ──
mkdirSync(TMP, { recursive: true });

console.log('=== Downloading & uploading post images ===');
const updateSql = [];

for (const img of POST_IMAGES) {
  const filename = img.r2Key.split('/').pop();
  const localPath = `${TMP}/${filename}`;
  const imgMarkdown = `![${img.alt}](/api/assets/${img.r2Key})`;

  console.log(`\n[${img.postId}] ${img.alt}`);

  // Download
  if (!existsSync(localPath)) {
    console.log(`  Downloading ${img.url}`);
    if (!downloadFile(img.url, localPath)) continue;
  } else {
    console.log('  Already downloaded');
  }

  // Upload to R2
  console.log(`  Uploading to R2: ${img.r2Key}`);
  if (!uploadToR2(localPath, img.r2Key)) continue;

  // Build SQL update
  if (img.placeholder) {
    // Exact placeholder replacement
    const escaped = img.placeholder.replace(/'/g, "''");
    const escapedMd = imgMarkdown.replace(/'/g, "''");
    updateSql.push(
      `UPDATE community_post SET body = REPLACE(body, '${escaped}', '${escapedMd}'), updated_at = datetime('now') WHERE id = '${img.postId}';`
    );
  } else if (img.placeholderPrefix) {
    // For long placeholders, replace from prefix to closing ]
    // We'll handle these with targeted updates
    updateSql.push(
      `-- Manual: ${img.postId} (${img.alt}) -- prefix match needed`
    );
  }
}

// Extra images (upload only, no D1 update)
console.log('\n=== Uploading extra post images (no body update) ===');
for (const url of EXTRA_IMAGES) {
  const r2Key = r2KeyFromUrl(url);
  const filename = r2Key.split('/').pop();
  const localPath = `${TMP}/${filename}`;

  console.log(`\n  ${filename}`);
  if (!existsSync(localPath)) {
    console.log(`  Downloading ${url}`);
    if (!downloadFile(url, localPath)) continue;
  }
  console.log(`  Uploading to R2: ${r2Key}`);
  uploadToR2(localPath, r2Key);
}

// Print SQL
console.log('\n\n=== SQL Updates for D1 ===');
for (const sql of updateSql) {
  console.log(sql);
}
