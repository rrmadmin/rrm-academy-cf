#!/usr/bin/env node
/**
 * populate-avatars.mjs
 *
 * One-time batch: fetches avatars from unavatar.io for STUC members missing them,
 * uploads to R2 via Cloudflare API, updates D1 avatar_url.
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID env vars
 * Usage: node scripts/populate-avatars.mjs [--dry-run]
 */

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB_ID = '22742c9c-77fa-4344-abda-7e7e8b0da9de';
const R2_BUCKET = 'rrm-assets';
const DRY_RUN = process.argv.includes('--dry-run');

if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars');
  process.exit(1);
}

async function d1Query(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${DB_ID}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors));
  return data.result[0].results;
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  const members = await d1Query(`
    SELECT u.id, u.email, u.name
    FROM user u
    JOIN user_label ul ON ul.user_id = u.id AND ul.label = 'Save the Uterus Club \u{1F3F7}\u{FE0F}'
    WHERE (u.avatar_url IS NULL OR u.avatar_url = '')
      AND u.blocked = 0
  `);

  console.log(`Found ${members.length} STUC members without avatars\n`);

  let found = 0;
  let skipped = 0;

  for (const m of members) {
    const label = m.name || m.email;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`https://unavatar.io/${encodeURIComponent(m.email)}`, {
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!res.ok || res.status === 404) {
        console.log(`  SKIP ${label}: HTTP ${res.status}`);
        skipped++;
        continue;
      }

      const contentType = res.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        console.log(`  SKIP ${label}: not an image (${contentType})`);
        skipped++;
        continue;
      }

      const imageData = await res.arrayBuffer();
      if (imageData.byteLength < 100) {
        console.log(`  SKIP ${label}: image too small (${imageData.byteLength}b)`);
        skipped++;
        continue;
      }

      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const r2Key = `avatars/${m.id}.${ext}`;
      const avatarUrl = `/api/assets/${r2Key}`;

      if (DRY_RUN) {
        console.log(`  WOULD ${label} -> ${avatarUrl} (${imageData.byteLength}b)`);
        found++;
        continue;
      }

      // Upload to R2
      const uploadRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${r2Key}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${CF_API_TOKEN}`,
            'Content-Type': contentType,
          },
          body: imageData,
        }
      );

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.log(`  FAIL ${label}: R2 upload ${uploadRes.status} -- ${errText.slice(0, 100)}`);
        skipped++;
        continue;
      }

      // Update D1
      await d1Query('UPDATE user SET avatar_url = ? WHERE id = ?', [avatarUrl, m.id]);

      console.log(`  OK   ${label} -> ${avatarUrl}`);
      found++;
    } catch (err) {
      console.log(`  FAIL ${label}: ${err.message}`);
      skipped++;
    }

    // Rate limit: 1 req/sec to unavatar.io
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone: ${found} avatars ${DRY_RUN ? 'would be' : ''} saved, ${skipped} skipped`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
