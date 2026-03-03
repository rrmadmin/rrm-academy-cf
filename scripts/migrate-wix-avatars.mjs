#!/usr/bin/env node
/**
 * Migrate member avatars from Wix/Google CDN to Cloudflare R2.
 * Prints SQL for D1 user.avatar_url updates.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';

const TMP = '/tmp/wix-migration/avatars';
const BUCKET = 'rrm-assets';
const PROJECT = '/Users/brian/iCode/projects/rrm-academy-cf';

// Avatar sources with full URLs (extracted from scrape, %7E decoded to ~)
// Format: { userId, name, url, ext }
const AVATARS = [
  // Full Wix URLs (decoded from scrape)
  { userId: '8ff76022b5e14be7b6fe6098b4e8a858', name: 'OvaWellness', url: 'https://static.wixstatic.com/media/1bf8c6_ae5c3b64074143369e91ef6c67cadeb0~mv2.jpg', ext: 'jpg' },
  { userId: '710134def83240b7b47b22a9c9579c0c', name: 'Naomi Whittaker', url: 'https://static.wixstatic.com/media/1b8b3c_5261ae3f02cc44d79d34398a1ce335b5~mv2.webp', ext: 'webp' },
  { userId: '5baf84d1ad1b4ac2b4463e4131ab6ae4', name: 'Lorraine Truman', url: 'https://static.wixstatic.com/media/1b8b3c_58fe8efb01aa47baac7efb7f6dde7e24~mv2.webp', ext: 'webp' },
  { userId: '52444a16bb194bd7a3d628100cf241e7', name: 'Lauren G', url: 'https://static.wixstatic.com/media/e71c71_f8a01a9dac574fb8ac06ed58649976c0~mv2.jpg', ext: 'jpg' },
  { userId: 'f8d67d49d4454242b3fd9490ff3db4bc', name: 'Kelsie Frank', url: 'https://static.wixstatic.com/media/1bf8c6_7829202d9ec440ee9d479a1aeaafa7ef~mv2.jpg', ext: 'jpg' },
  { userId: '4d7f0ae529404c359ed5ed597979f451', name: 'RRM Academy', url: 'https://static.wixstatic.com/media/1b8b3c_d4b677beaa60418db89107c4da137664~mv2.webp', ext: 'webp' },
  { userId: '301eb55c3f388e65f3f42b14e635dc7a', name: 'Brian Whittaker', url: 'https://static.wixstatic.com/media/3a54ee_41168390130149af8db6abf104c3c375~mv2.jpg', ext: 'jpg' },
  { userId: 'cd71fe5782704012a259c7110458dedf', name: 'Ana Garcia', url: 'https://static.wixstatic.com/media/1bf8c6_2f0ef2859da447bcbfb792a9f8ec9fa8~mv2.jpg', ext: 'jpg' },
  { userId: '07ea3c422156439a8571dd3a066ed598', name: 'Hannah Ducote', url: 'https://static.wixstatic.com/media/1bf8c6_c6b42f75a6ac4b67abcc2f95b479d23b~mv2.jpg', ext: 'jpg' },

  // Google avatar URLs (use =s200-c for higher res)
  { userId: '03986543f8fd49a08328ada8a97a54a4', name: 'Marah Van Diest', url: 'https://lh3.googleusercontent.com/a/ACg8ocIX9ZBtpbrx2e3AD9hi2u3Czeby1780pyfSjhXdspki3gg0rg=s200-c', ext: 'jpg' },
  { userId: '3b94468c6879478685aa248870191a82', name: 'Daniela Castillo', url: 'https://lh3.googleusercontent.com/a/ACg8ocLF2yHYp954NmHYb6Ife50H1pu4_iMcIavsUEeXCoGVXql5lfk4=s200-c', ext: 'jpg' },
];

mkdirSync(TMP, { recursive: true });

let success = 0;
let fail = 0;

for (const av of AVATARS) {
  const filename = `${av.userId}.${av.ext}`;
  const localPath = `${TMP}/${filename}`;
  const r2Key = `avatars/${filename}`;

  console.log(`\n[${av.name}] ${av.userId}`);

  // Download
  if (!existsSync(localPath)) {
    console.log(`  Downloading...`);
    try {
      execSync(`curl -sS -L -o "${localPath}" "${av.url}"`, { timeout: 30000 });
    } catch (e) {
      console.error(`  FAIL download: ${e.message}`);
      fail++;
      continue;
    }
  } else {
    console.log('  Already downloaded');
  }

  // Upload to R2
  console.log(`  Uploading to R2: ${r2Key}`);
  try {
    execSync(`cd ${PROJECT} && npx wrangler r2 object put "${BUCKET}/${r2Key}" --file="${localPath}"`, { timeout: 30000 });
    success++;
  } catch (e) {
    console.error(`  FAIL upload: ${e.message}`);
    fail++;
    continue;
  }

  // Print SQL
  const avatarUrl = `/api/assets/${r2Key}`;
  console.log(`  SQL: UPDATE user SET avatar_url = '${avatarUrl}' WHERE id = '${av.userId}';`);
}

console.log(`\n=== Done: ${success} uploaded, ${fail} failed ===`);
