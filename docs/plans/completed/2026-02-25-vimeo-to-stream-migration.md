# Vimeo to Cloudflare Stream Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all Vimeo video hosting with Cloudflare Stream, migrate 53 course videos, build STUC call recording viewer, set up automated Meet recording pipeline, and cancel Vimeo.

**Architecture:** Cloudflare Stream for video storage/delivery with signed URL auth. Stream SDK replaces Vimeo postMessage API for course progress tracking. n8n workflow automates Google Meet recording ingestion.

**Tech Stack:** Cloudflare Stream, Stream SDK, CF Pages Functions (signed URL generation), n8n, Google Drive API, D1

---

## Current State Summary

- **53 Vimeo videos** across 4 courses (Masterclass: 39, Long-Term Endo: 7, Postpartum: 6, RRM vs IVF: 8)
- Vimeo IDs stored in Airtable `Lessons` table (base `app0nohI0WrgFWOE3`, table `tbl5RdpAUj8ub4nz4`), field `Vimeo ID`
- Course player at `src/pages/courses/[slug]/[stepId].astro` embeds Vimeo via iframe
- Progress tracking uses Vimeo postMessage API (`playProgress`, `finish` events, resume from `#t=Xs` URL hash)
- CSP header in `public/_headers` allows `frame-src https://player.vimeo.com`
- TypeScript type `CourseStep` has `vimeoId?: string` in `src/lib/courses.ts`
- Fetch script `src/lib/fetch-courses-data.mjs` reads `Vimeo ID` field from Airtable
- STUC events page at `src/pages/community/events.astro` already renders "View Recording" link for past events with `resourceUrl`
- Community posts API at `functions/api/community/posts.js` supports `type: "resource"` posts (staff-only create)
- Meet recordings live in Google Drive folder `1bfyQvpFW4ivBC_ZgeA4UZ_4jenRFhdDf` (~15 recordings, 800MB-1.5GB each)
- n8n at `n8n.rrmacademy.org` already has Google Drive OAuth configured

### Files That Reference Vimeo (5 total)

| File | What it does |
|------|-------------|
| `src/pages/courses/[slug]/[stepId].astro` | iframe embed + postMessage progress tracking |
| `src/lib/courses.ts` | TypeScript interface with `vimeoId` field |
| `src/lib/fetch-courses-data.mjs` | Airtable field mapping (`Vimeo ID` field) |
| `src/data/courses.json` | Generated data (auto-regenerated from fetch script) |
| `public/_headers` | CSP `frame-src https://player.vimeo.com` |

---

## Task 1: Enable Cloudflare Stream & Create Signing Key

**Goal:** Provision Stream, create a signing key for private video tokens, store secrets.

**Files:**
- `wrangler.toml` — no changes needed (secrets are set via `wrangler pages secret put`, not in toml)

### Steps

1. **Enable Cloudflare Stream** in the CF dashboard:
   - Go to dash.cloudflare.com > account `ecf2c5bc8b5ebd634bcb587b3890910a` > Stream
   - Stream is usage-billed (minutes stored + minutes delivered), no plan to select — it activates on first use

2. **Find your customer subdomain code:**
   - After enabling, go to Stream > any test upload (or the API overview page)
   - The embed URL format is `https://customer-<CODE>.cloudflarestream.com/<UID>/iframe`
   - Note the `<CODE>` value (e.g., `f84e45e966554e0088e3`) — this is your customer subdomain code

3. **Create a signing key via the API:**
   ```bash
   # Get your Cloudflare API token (needs Stream:Edit permission)
   # Or use Global API Key + Email

   curl -X POST "https://api.cloudflare.com/client/v4/accounts/ecf2c5bc8b5ebd634bcb587b3890910a/stream/keys" \
     -H "Authorization: Bearer $CF_API_TOKEN" \
     -H "Content-Type: application/json"
   ```

   Response will include:
   ```json
   {
     "result": {
       "id": "key-id-here",
       "pem": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
       "jwk": "base64url-encoded-jwk-string",
       "created": "2026-02-25T..."
     }
   }
   ```

   Save the `id` (this is the Key ID) and the `pem` or `jwk` (this is the private key for signing tokens).

4. **Store secrets as Pages environment variables:**
   ```bash
   # The PEM-format private key for RS256 signing
   echo "$SIGNING_KEY_PEM" | npx wrangler pages secret put STREAM_SIGNING_KEY --project-name rrm-academy

   # The key ID returned from the API
   echo "key-id-here" | npx wrangler pages secret put STREAM_KEY_ID --project-name rrm-academy

   # Your customer subdomain code
   echo "f84e45e966554e0088e3" | npx wrangler pages secret put STREAM_CUSTOMER_CODE --project-name rrm-academy

   # Your Cloudflare Account ID (already known, but needed for Stream API calls from functions)
   echo "ecf2c5bc8b5ebd634bcb587b3890910a" | npx wrangler pages secret put CF_ACCOUNT_ID --project-name rrm-academy
   ```

5. **Verify secrets are set:**
   ```bash
   npx wrangler pages secret list --project-name rrm-academy
   ```

### Verification

- `STREAM_SIGNING_KEY`, `STREAM_KEY_ID`, `STREAM_CUSTOMER_CODE`, and `CF_ACCOUNT_ID` appear in the secret list
- Stream dashboard is accessible at dash.cloudflare.com > Stream

### Commit message
```
feat: document Stream signing key setup (Task 1)
```

---

## Task 2: Upload 53 Course Videos to Stream

**Goal:** Upload all course videos from Vimeo to Cloudflare Stream with metadata, signed URL requirement, and domain restriction. Record the Vimeo ID to Stream UID mapping.

**Files:**
- `scripts/upload-to-stream.mjs` — **CREATE** (one-time upload script)
- `scripts/vimeo-to-stream-mapping.json` — **CREATE** (generated output)

### Steps

1. **Install tus-js-client for large file uploads:**
   ```bash
   npm install --save-dev tus-js-client node-fetch
   ```

2. **Create the upload script** at `scripts/upload-to-stream.mjs`:

   ```javascript
   /**
    * Upload course videos to Cloudflare Stream.
    *
    * Usage:
    *   CF_API_TOKEN=xxx CF_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a \
    *     node scripts/upload-to-stream.mjs --dir /path/to/videos
    *
    * Expected file naming: {vimeoId}.mp4 or {vimeoId}_{title}.mp4
    * Alternatively, use --from-url mode with a CSV of vimeoId,downloadUrl pairs.
    *
    * Outputs: scripts/vimeo-to-stream-mapping.json
    */

   import * as tus from 'tus-js-client';
   import fs from 'fs';
   import path from 'path';

   const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
   const CF_API_TOKEN = process.env.CF_API_TOKEN;
   const STREAM_API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`;

   if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
     console.error('CF_ACCOUNT_ID and CF_API_TOKEN required');
     process.exit(1);
   }

   const args = process.argv.slice(2);
   const dirIdx = args.indexOf('--dir');
   const videoDir = dirIdx >= 0 ? args[dirIdx + 1] : null;

   if (!videoDir) {
     console.error('Usage: node scripts/upload-to-stream.mjs --dir /path/to/videos');
     process.exit(1);
   }

   // Read existing mapping (resume support)
   const MAPPING_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), 'vimeo-to-stream-mapping.json');
   let mapping = {};
   try { mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf-8')); } catch {}

   const files = fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4'));
   console.log(`Found ${files.length} MP4 files in ${videoDir}`);

   for (const file of files) {
     const vimeoId = file.split('_')[0].replace('.mp4', '');

     if (mapping[vimeoId]) {
       console.log(`[skip] ${vimeoId} already uploaded → ${mapping[vimeoId]}`);
       continue;
     }

     const filePath = path.join(videoDir, file);
     const fileSize = fs.statSync(filePath).size;
     const title = file.replace('.mp4', '').replace(/_/g, ' ');

     console.log(`[upload] ${file} (${(fileSize / 1024 / 1024).toFixed(1)} MB)...`);

     try {
       const streamUid = await uploadViaTus(filePath, fileSize, title);
       mapping[vimeoId] = streamUid;
       console.log(`  → Stream UID: ${streamUid}`);

       // Set requireSignedURLs and allowedOrigins
       await configureVideo(streamUid);

       // Trigger AI caption generation
       await generateCaptions(streamUid);

       // Save mapping after each successful upload (resume-safe)
       fs.writeFileSync(MAPPING_PATH, JSON.stringify(mapping, null, 2));
     } catch (err) {
       console.error(`  [ERROR] ${file}: ${err.message}`);
     }
   }

   console.log(`\nMapping saved to ${MAPPING_PATH}`);
   console.log(`Total mapped: ${Object.keys(mapping).length}`);

   // --- Upload via tus protocol ---
   function uploadViaTus(filePath, fileSize, title) {
     return new Promise((resolve, reject) => {
       const fileStream = fs.createReadStream(filePath);

       const upload = new tus.Upload(fileStream, {
         endpoint: `${STREAM_API}?direct_user=true`,
         headers: {
           'Authorization': `Bearer ${CF_API_TOKEN}`,
         },
         chunkSize: 50 * 1024 * 1024, // 50 MB chunks
         retryDelays: [0, 3000, 5000, 10000, 20000],
         metadata: {
           name: title,
           requiresignedurls: 'true',
           allowedorigins: 'rrmacademy.org',
         },
         uploadSize: fileSize,
         onError: (err) => reject(err),
         onProgress: (bytesUploaded, bytesTotal) => {
           const pct = ((bytesUploaded / bytesTotal) * 100).toFixed(1);
           process.stdout.write(`\r  ${pct}%`);
         },
         onSuccess: () => {
           process.stdout.write('\r  100%\n');
           // Stream UID is in the upload URL path
           const uid = upload.url.split('/').pop();
           resolve(uid);
         },
       });

       upload.start();
     });
   }

   // --- Configure video settings ---
   async function configureVideo(uid) {
     const res = await fetch(`${STREAM_API}/${uid}`, {
       method: 'POST',
       headers: {
         'Authorization': `Bearer ${CF_API_TOKEN}`,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify({
         requireSignedURLs: true,
         allowedOrigins: ['rrmacademy.org'],
       }),
     });
     if (!res.ok) {
       const text = await res.text();
       console.warn(`  [warn] configure failed: ${text}`);
     }
   }

   // --- Trigger AI caption generation ---
   async function generateCaptions(uid) {
     const res = await fetch(`${STREAM_API}/${uid}/captions/en/generate`, {
       method: 'POST',
       headers: {
         'Authorization': `Bearer ${CF_API_TOKEN}`,
         'Content-Type': 'application/json',
       },
     });
     if (!res.ok) {
       const text = await res.text();
       console.warn(`  [warn] caption gen failed: ${text}`);
     } else {
       console.log('  captions: generation triggered');
     }
   }
   ```

3. **Download all 53 videos from Vimeo** (before running the upload):
   - Use the Vimeo desktop app's download feature, or the API:
     ```bash
     # Vimeo API — get download link for each video
     curl -H "Authorization: bearer $VIMEO_TOKEN" \
       "https://api.vimeo.com/videos/{vimeoId}?fields=download"
     ```
   - Name each file as `{vimeoId}.mp4` (e.g., `1032476835.mp4`)
   - Put all files in one directory (e.g., `~/Downloads/vimeo-export/`)

4. **Run the upload script:**
   ```bash
   CF_API_TOKEN=xxx CF_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a \
     node scripts/upload-to-stream.mjs --dir ~/Downloads/vimeo-export/
   ```

5. **Verify uploads in Stream dashboard:**
   - All 53 videos should appear with status "Ready"
   - Each should have `requireSignedURLs: true`
   - Each should have `allowedOrigins: ["rrmacademy.org"]`
   - AI captions should be generating (check after ~30 min)

6. **Save the mapping file** — `scripts/vimeo-to-stream-mapping.json` will contain:
   ```json
   {
     "1032476835": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
     "1032476900": "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1",
     ...
   }
   ```

### Verification

- `scripts/vimeo-to-stream-mapping.json` contains 53 entries
- All 53 videos show "Ready" status in Stream dashboard
- `requireSignedURLs` is `true` on each video
- AI captions are generating/complete

### Commit message
```
feat: add Stream upload script and video mapping (Task 2)
```

---

## Task 3: Update Airtable Schema

**Goal:** Add `Stream Video ID` field to the Lessons table and populate it from the mapping file. Keep `Vimeo ID` temporarily for rollback.

**Files:**
- `scripts/populate-stream-ids.mjs` — **CREATE** (one-time Airtable update script)

### Steps

1. **Add `Stream Video ID` field to Airtable Lessons table manually:**
   - Open Airtable base `app0nohI0WrgFWOE3`, table `tbl5RdpAUj8ub4nz4` (Lessons)
   - Add a new "Single line text" field named `Stream Video ID`
   - This field will hold 32-char hex Stream UIDs

2. **Create `scripts/populate-stream-ids.mjs`:**

   ```javascript
   /**
    * Populate Airtable Lessons with Stream Video IDs from the mapping file.
    *
    * Usage: AIRTABLE_PAT=xxx node scripts/populate-stream-ids.mjs
    */

   import { readFileSync } from 'fs';
   import { join, dirname } from 'path';
   import { fileURLToPath } from 'url';

   const __dirname = dirname(fileURLToPath(import.meta.url));
   const MAPPING_PATH = join(__dirname, 'vimeo-to-stream-mapping.json');

   const BASE_ID = 'app0nohI0WrgFWOE3';
   const LESSONS_TABLE = 'tbl5RdpAUj8ub4nz4';
   const API_URL = `https://api.airtable.com/v0/${BASE_ID}/${LESSONS_TABLE}`;

   const pat = process.env.AIRTABLE_PAT;
   if (!pat) { console.error('AIRTABLE_PAT required'); process.exit(1); }

   const mapping = JSON.parse(readFileSync(MAPPING_PATH, 'utf-8'));
   console.log(`Loaded mapping: ${Object.keys(mapping).length} entries`);

   // Fetch all lessons with Vimeo ID
   let records = [];
   let offset;
   do {
     const url = `${API_URL}?fields[]=Vimeo ID&fields[]=Step ID&pageSize=100${offset ? `&offset=${offset}` : ''}`;
     const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
     const data = await res.json();
     if (!res.ok) { console.error(data); process.exit(1); }
     records.push(...data.records);
     offset = data.offset;
   } while (offset);

   console.log(`Fetched ${records.length} lesson records`);

   // Batch update (Airtable allows 10 records per PATCH)
   const updates = [];
   for (const rec of records) {
     const vimeoId = rec.fields['Vimeo ID'];
     if (!vimeoId) continue;
     const streamId = mapping[vimeoId.trim()];
     if (!streamId) {
       console.warn(`[skip] No Stream mapping for Vimeo ID ${vimeoId} (step: ${rec.fields['Step ID']})`);
       continue;
     }
     updates.push({ id: rec.id, fields: { 'Stream Video ID': streamId } });
   }

   console.log(`Updating ${updates.length} records...`);

   for (let i = 0; i < updates.length; i += 10) {
     const batch = updates.slice(i, i + 10);
     const res = await fetch(API_URL, {
       method: 'PATCH',
       headers: {
         Authorization: `Bearer ${pat}`,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify({ records: batch }),
     });
     if (!res.ok) {
       const err = await res.text();
       console.error(`Batch ${i / 10 + 1} failed: ${err}`);
     } else {
       console.log(`Batch ${i / 10 + 1}: updated ${batch.length} records`);
     }
     // Rate limit: 5 req/sec
     await new Promise(r => setTimeout(r, 250));
   }

   console.log('Done.');
   ```

3. **Run the populate script:**
   ```bash
   source ~/.zshrc  # loads OP_SERVICE_ACCOUNT_TOKEN
   AIRTABLE_PAT=$(op read 'op://Automation/OpenClaw Airtable PAT/credential') \
     node scripts/populate-stream-ids.mjs
   ```

4. **Verify in Airtable:**
   - Open the Lessons table and confirm `Stream Video ID` is populated for all 53 video lessons
   - Each should be a 32-character hex string
   - The `Vimeo ID` field should still be intact (do NOT delete yet)

### Verification

- All 53 video lessons have both `Vimeo ID` and `Stream Video ID` populated
- Non-video lessons (articles, quizzes) have empty `Stream Video ID` (expected)

### Commit message
```
feat: add Airtable Stream ID population script (Task 3)
```

---

## Task 4: Build Signed URL Generation Endpoint

**Goal:** Create a Pages Function that generates short-lived signed tokens for Stream video playback. This endpoint serves both course videos (enrolled users) and STUC recordings (members).

**Files:**
- `functions/api/stream/token.js` — **CREATE**

### Steps

1. **Create `functions/api/stream/token.js`:**

   ```javascript
   /**
    * POST /api/stream/token — Generate a signed Cloudflare Stream token
    *
    * Body: { videoId: string, context?: "course" | "recording" }
    * Auth: session cookie required
    *
    * For course videos: validates user is enrolled in the course containing this video
    * For recordings: validates user has active STUC membership
    *
    * Returns: { ok: true, token: "...", customerCode: "..." }
    */
   import { json, optionsResponse, getSessionIdFromCookie, validateSession } from '../auth/_shared.js';
   import { requireMember } from '../community/_shared.js';
   import coursesData from '../../../src/data/courses.json';

   export async function onRequestOptions() {
     return optionsResponse();
   }

   export async function onRequestPost({ request, env }) {
     try {
       const db = env.DB;
       if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

       // --- Auth ---
       const sessionId = getSessionIdFromCookie(request);
       const session = await validateSession(db, sessionId);
       if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

       // --- Parse body ---
       const body = await request.json();
       const { videoId, context } = body;

       if (!videoId || typeof videoId !== 'string' || !/^[a-f0-9]{32}$/.test(videoId)) {
         return json({ ok: false, error: 'Invalid videoId' }, 400);
       }

       // --- Authorization check ---
       if (context === 'recording') {
         // STUC recording: require active membership
         const auth = await requireMember(request, env);
         if (auth instanceof Response) return auth; // 401 or 403
       } else {
         // Course video: require enrollment in the course that contains this video
         const courseId = findCourseByStreamId(videoId);
         if (!courseId) {
           return json({ ok: false, error: 'Video not found in any course' }, 404);
         }

         const enrollment = await db.prepare(
           'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ?'
         ).bind(session.userId, courseId).first();

         if (!enrollment) {
           return json({ ok: false, error: 'Not enrolled in this course' }, 403);
         }
       }

       // --- Generate signed token ---
       const token = await createSignedToken(videoId, env);

       return json({
         ok: true,
         token,
         customerCode: env.STREAM_CUSTOMER_CODE,
       });

     } catch (err) {
       console.error('stream token error:', err.message, err.stack);
       return json({ ok: false, error: 'Internal error' }, 500);
     }
   }

   /**
    * Find which course contains a video with the given Stream UID.
    * Returns the course ID string, or null if not found.
    */
   function findCourseByStreamId(streamId) {
     for (const course of coursesData) {
       for (const section of course.sections) {
         for (const step of section.steps) {
           if (step.streamVideoId === streamId) {
             return course.id;
           }
         }
       }
     }
     return null;
   }

   /**
    * Create an RS256-signed JWT for Cloudflare Stream.
    *
    * Claims:
    *   sub: video UID
    *   kid: signing key ID
    *   exp: current time + 1 hour
    *   accessRules: restrict to rrmacademy.org
    */
   async function createSignedToken(videoId, env) {
     const keyId = env.STREAM_KEY_ID;
     const pemKey = env.STREAM_SIGNING_KEY;

     if (!keyId || !pemKey) {
       throw new Error('STREAM_KEY_ID or STREAM_SIGNING_KEY not configured');
     }

     const now = Math.floor(Date.now() / 1000);
     const exp = now + 3600; // 1 hour

     const header = {
       alg: 'RS256',
       kid: keyId,
     };

     const payload = {
       sub: videoId,
       kid: keyId,
       exp: exp,
       accessRules: [
         {
           type: 'any',
           action: 'allow',
         },
       ],
     };

     // Import PEM key for signing
     const cryptoKey = await importPemKey(pemKey);

     // Encode header and payload
     const headerB64 = base64url(JSON.stringify(header));
     const payloadB64 = base64url(JSON.stringify(payload));
     const signingInput = `${headerB64}.${payloadB64}`;

     // Sign with RS256
     const signature = await crypto.subtle.sign(
       { name: 'RSASSA-PKCS1-v1_5' },
       cryptoKey,
       new TextEncoder().encode(signingInput)
     );

     const signatureB64 = base64url(signature);

     return `${headerB64}.${payloadB64}.${signatureB64}`;
   }

   /**
    * Import a PEM-encoded RSA private key into a CryptoKey.
    */
   async function importPemKey(pem) {
     // Strip PEM header/footer and whitespace
     const pemBody = pem
       .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
       .replace(/-----END RSA PRIVATE KEY-----/, '')
       .replace(/-----BEGIN PRIVATE KEY-----/, '')
       .replace(/-----END PRIVATE KEY-----/, '')
       .replace(/\s/g, '');

     const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

     // Try PKCS8 first (BEGIN PRIVATE KEY), fall back to pkcs1 workaround
     try {
       return await crypto.subtle.importKey(
         'pkcs8',
         binaryDer.buffer,
         { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
         false,
         ['sign']
       );
     } catch {
       // If the PEM is PKCS#1 (BEGIN RSA PRIVATE KEY), wrap it in PKCS#8
       // This is the common format returned by Stream API
       const pkcs8 = wrapPkcs1InPkcs8(binaryDer);
       return await crypto.subtle.importKey(
         'pkcs8',
         pkcs8.buffer,
         { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
         false,
         ['sign']
       );
     }
   }

   /**
    * Wrap a PKCS#1 RSA private key in PKCS#8 DER envelope.
    * Required because Web Crypto only accepts PKCS#8.
    */
   function wrapPkcs1InPkcs8(pkcs1Bytes) {
     // PKCS#8 header for RSA (OID 1.2.840.113549.1.1.1)
     const pkcs8Header = new Uint8Array([
       0x30, 0x82, 0x00, 0x00, // SEQUENCE (length placeholder)
       0x02, 0x01, 0x00,       // INTEGER 0 (version)
       0x30, 0x0d,             // SEQUENCE
       0x06, 0x09,             // OID
       0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // 1.2.840.113549.1.1.1
       0x05, 0x00,             // NULL
       0x04, 0x82, 0x00, 0x00, // OCTET STRING (length placeholder)
     ]);

     const totalLen = pkcs8Header.length + pkcs1Bytes.length;
     const result = new Uint8Array(totalLen);
     result.set(pkcs8Header);
     result.set(pkcs1Bytes, pkcs8Header.length);

     // Patch outer SEQUENCE length (total - 4 bytes for tag+length)
     const outerLen = totalLen - 4;
     result[2] = (outerLen >> 8) & 0xff;
     result[3] = outerLen & 0xff;

     // Patch OCTET STRING length (pkcs1 key length)
     const octetIdx = pkcs8Header.length - 2;
     result[octetIdx] = (pkcs1Bytes.length >> 8) & 0xff;
     result[octetIdx + 1] = pkcs1Bytes.length & 0xff;

     return result;
   }

   /**
    * Base64url encode (no padding).
    */
   function base64url(input) {
     let str;
     if (typeof input === 'string') {
       str = btoa(input);
     } else {
       // ArrayBuffer
       const bytes = new Uint8Array(input);
       let binary = '';
       for (let i = 0; i < bytes.length; i++) {
         binary += String.fromCharCode(bytes[i]);
       }
       str = btoa(binary);
     }
     return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
   }
   ```

2. **Test locally:**
   ```bash
   # Start the dev server
   npx wrangler pages dev dist --d1 DB=22742c9c-77fa-4344-abda-7e7e8b0da9de

   # Test (requires being logged in with a valid session cookie)
   curl -X POST http://localhost:8788/api/stream/token \
     -H "Content-Type: application/json" \
     -H "Cookie: session=YOUR_SESSION_ID" \
     -d '{"videoId":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"}'
   ```

### Verification

- POST with valid session + enrolled course returns `{ ok: true, token: "eyJ...", customerCode: "..." }`
- POST without session returns 401
- POST with valid session but non-enrolled course returns 403
- POST with `context: "recording"` requires active STUC membership
- Token is a valid 3-part JWT (header.payload.signature)
- Invalid `videoId` (not 32-char hex) returns 400

### Commit message
```
feat: add Stream signed URL token endpoint (Task 4)
```

---

## Task 5: Swap Course Player from Vimeo to Stream

**Goal:** Replace the Vimeo iframe embed and postMessage progress tracking with Cloudflare Stream iframe + Stream SDK. This is the core migration task.

**Files:**
- `src/pages/courses/[slug]/[stepId].astro` — **MODIFY**
- `src/lib/courses.ts` — **MODIFY**
- `src/lib/fetch-courses-data.mjs` — **MODIFY**
- `public/_headers` — **MODIFY**
- `src/data/courses.json` — **AUTO-REGENERATED** (by running `npm run fetch-courses`)

### Step 5a: Update TypeScript interface

**File:** `src/lib/courses.ts`

Change the `CourseStep` interface:

```typescript
// BEFORE:
export interface CourseStep {
  id: string;
  title: string;
  type: 'video' | 'article' | 'quiz';
  vimeoId?: string;
  duration?: number;
}

// AFTER:
export interface CourseStep {
  id: string;
  title: string;
  type: 'video' | 'article' | 'quiz';
  streamVideoId?: string;
  duration?: number;
}
```

### Step 5b: Update Airtable fetch script

**File:** `src/lib/fetch-courses-data.mjs`

1. In the `LESSON_FIELDS` array, replace `'Vimeo ID'` with `'Stream Video ID'`:

   ```javascript
   // BEFORE (line 92):
   'Vimeo ID',      // ADDED

   // AFTER:
   'Stream Video ID',      // Cloudflare Stream UID (replaces Vimeo ID)
   ```

2. In the `transformLesson` function, update the field mapping:

   ```javascript
   // BEFORE (line 227):
   if (f['Vimeo ID']) step.vimeoId = f['Vimeo ID'].trim();

   // AFTER:
   if (f['Stream Video ID']) step.streamVideoId = f['Stream Video ID'].trim();
   ```

3. In the `assembleNestedCourses` function, update the step cleanup:

   ```javascript
   // BEFORE (line 316):
   if (s.vimeoId) clean.vimeoId = s.vimeoId;

   // AFTER:
   if (s.streamVideoId) clean.streamVideoId = s.streamVideoId;
   ```

### Step 5c: Regenerate courses.json

```bash
source ~/.zshrc
AIRTABLE_PAT=$(op read 'op://Automation/OpenClaw Airtable PAT/credential') \
  npm run fetch-courses
```

Verify `src/data/courses.json` now contains `streamVideoId` fields instead of `vimeoId`.

### Step 5d: Update the course player page

**File:** `src/pages/courses/[slug]/[stepId].astro`

**5d-i: Replace the iframe embed (HTML section, around line 126-141):**

```html
<!-- BEFORE -->
{step.type === 'video' && step.vimeoId && (
  <div class="video-wrapper">
    <div class="video-container" id="video-container">
      <iframe
        id="vimeo-player"
        src={`https://player.vimeo.com/video/${step.vimeoId}?title=0&byline=0&portrait=0`}
        width="100%"
        height="100%"
        frameborder="0"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        title={step.title}
      ></iframe>
    </div>
  </div>
)}

<!-- AFTER -->
{step.type === 'video' && step.streamVideoId && (
  <div class="video-wrapper">
    <div class="video-container" id="video-container">
      <div id="stream-loading" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#888;">
        Loading video...
      </div>
      <iframe
        id="stream-player"
        style="display:none;border:none;width:100%;height:100%;"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
        allowfullscreen
        title={step.title}
      ></iframe>
    </div>
  </div>
)}
```

**5d-ii: Add Stream SDK script tag.** Add this immediately after the closing `</div>` of `video-wrapper`, but still inside the `player-content` div:

```html
{step.type === 'video' && step.streamVideoId && (
  <script src="https://embed.cloudflarestream.com/embed/sdk.latest.js"></script>
)}
```

**5d-iii: Update the `define:vars` block** (around line 263-276):

```javascript
// BEFORE:
define:vars={{
  courseId: course.id,
  courseSlug: course.slug,
  stepId: step.id,
  stepType: step.type,
  vimeoId: step.vimeoId || null,
  nextStepId: nextStep?.id || null,
  nextStepUrl: nextStep ? `/courses/${course.slug}/${nextStep.id}` : '',
  videoDuration: step.duration || 0,
  videoWatchReq: course.settings?.videoWatchRequirement || 0.9,
  fixedOrder: course.settings?.stepOrder === 'fixed',
  autoplayNext: course.settings?.autoplayNextVideo || false,
  hasCertificate: !!course.hasCertificate,
}}

// AFTER:
define:vars={{
  courseId: course.id,
  courseSlug: course.slug,
  stepId: step.id,
  stepType: step.type,
  streamVideoId: step.streamVideoId || null,
  nextStepId: nextStep?.id || null,
  nextStepUrl: nextStep ? `/courses/${course.slug}/${nextStep.id}` : '',
  videoDuration: step.duration || 0,
  videoWatchReq: course.settings?.videoWatchRequirement || 0.9,
  fixedOrder: course.settings?.stepOrder === 'fixed',
  autoplayNext: course.settings?.autoplayNextVideo || false,
  hasCertificate: !!course.hasCertificate,
}}
```

**5d-iv: Replace the entire Vimeo progress tracking block** (the section from `// --- Video progress tracking ---` through the closing of the Vimeo event listener).

Replace the old Vimeo block (approximately lines 355-426):

```javascript
// BEFORE: (lines 355-426)
// --- Video progress tracking ---
if (stepType === 'video' && vimeoId) {
  var lastSaved = 0;
  var maxPercent = 0;

  // Vimeo postMessage API (no SDK needed)
  var iframe = document.getElementById('vimeo-player');
  if (iframe) {
    window.addEventListener('message', function (event) {
      if (!event.origin.includes('vimeo.com')) return;
      var data;
      try { data = JSON.parse(event.data); } catch { return; }

      if (data.event === 'playProgress' || data.event === 'timeupdate') {
        // ... progress tracking ...
      }

      if (data.event === 'finish' || data.event === 'ended') {
        // ... finish handling ...
      }
    });

    // Tell Vimeo to send events
    function postToVimeo(action, value) {
      iframe.contentWindow.postMessage(JSON.stringify({ method: action, value: value }), '*');
    }
    iframe.addEventListener('load', function () {
      postToVimeo('addEventListener', 'playProgress');
      postToVimeo('addEventListener', 'finish');
    });
  }
}
```

Replace with the full Stream SDK implementation:

```javascript
// AFTER:
// --- Video progress tracking (Cloudflare Stream SDK) ---
if (stepType === 'video' && streamVideoId) {
  var lastSaved = 0;
  var maxPercent = 0;
  var streamPlayer = null;
  var resumeSeconds = 0;

  // Fetch signed token, then initialize player
  fetch('/api/stream/token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId: streamVideoId }),
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok || !data.token) {
        console.error('Stream token error:', data.error);
        var loadingEl = document.getElementById('stream-loading');
        if (loadingEl) loadingEl.textContent = 'Unable to load video. Please refresh.';
        return;
      }

      var iframe = document.getElementById('stream-player');
      var loadingEl = document.getElementById('stream-loading');
      if (!iframe) return;

      // Build Stream embed URL with signed token
      var src = 'https://customer-' + data.customerCode + '.cloudflarestream.com/' +
        data.token + '/iframe';
      iframe.setAttribute('src', src);
      iframe.style.display = 'block';
      if (loadingEl) loadingEl.style.display = 'none';

      // Wait for Stream SDK to be available, then bind events
      var waitForSdk = setInterval(function () {
        if (typeof Stream !== 'undefined') {
          clearInterval(waitForSdk);
          initStreamPlayer(iframe);
        }
      }, 100);
    })
    .catch(function (err) {
      console.error('Stream token fetch failed:', err);
      var loadingEl = document.getElementById('stream-loading');
      if (loadingEl) loadingEl.textContent = 'Unable to load video. Please refresh.';
    });

  function initStreamPlayer(iframe) {
    streamPlayer = Stream(iframe);

    // Resume from saved position
    streamPlayer.addEventListener('loadedmetadata', function () {
      if (resumeSeconds > 0) {
        streamPlayer.currentTime = resumeSeconds;
      }
    });

    // Progress tracking — fires continuously during playback
    streamPlayer.addEventListener('timeupdate', function () {
      var currentTime = streamPlayer.currentTime;
      var duration = streamPlayer.duration;

      if (!duration || duration <= 0) return;

      var percent = currentTime / duration;
      if (percent > maxPercent) maxPercent = percent;

      // Save position every 15 seconds of playback
      var seconds = Math.floor(currentTime);
      if (seconds - lastSaved >= 15) {
        lastSaved = seconds;
        saveProgress(seconds, false);
      }

      // Enable "Mark Complete" once watch requirement met
      if (maxPercent >= videoWatchReq && !isCompleted) {
        canComplete = true;
        markBtn.disabled = false;
      }
    });

    // Video finished
    streamPlayer.addEventListener('ended', function () {
      canComplete = true;
      markBtn.disabled = false;

      // Auto-complete + autoplay next
      if (!isCompleted) {
        isCompleted = true;
        saveProgress(null, true).then(function (res) {
          if (res && res.ok) {
            markBtn.textContent = 'Completed';
            markBtn.classList.add('mark-complete-btn--done');
            markBtn.disabled = true;
            var el = document.querySelector('.sidebar-step[data-step-id="' + stepId + '"]');
            if (el) el.classList.add('sidebar-step--done');
            var done = document.querySelectorAll('.sidebar-step--done').length;
            var total = document.querySelectorAll('.sidebar-step').length;
            updateProgressBar(done, total);

            if (res.courseCompleted) {
              markBtn.textContent = 'Course Complete!';
              showCertificateBanner();
            } else if (autoplayNext && nextStepUrl) {
              showAutoplayCountdown();
            }
          }
        });
      } else if (autoplayNext && nextStepUrl) {
        showAutoplayCountdown();
      }
    });
  }
}
```

**5d-v: Update the resume-from-position logic** in the auth/progress loading section (around lines 340-348):

```javascript
// BEFORE:
// Resume video position
if (stepType === 'video' && steps[stepId] && steps[stepId].lastPositionSeconds > 0) {
  var iframe = document.getElementById('vimeo-player');
  if (iframe) {
    // Append start time to Vimeo URL
    var src = iframe.getAttribute('src');
    var startTime = '#t=' + steps[stepId].lastPositionSeconds + 's';
    iframe.setAttribute('src', src + startTime);
  }
}

// AFTER:
// Resume video position — store for Stream SDK to apply after loadedmetadata
if (stepType === 'video' && steps[stepId] && steps[stepId].lastPositionSeconds > 0) {
  resumeSeconds = steps[stepId].lastPositionSeconds;
}
```

**IMPORTANT:** The `resumeSeconds` variable must be declared at the outer scope of the IIFE (near `var markBtn`, `var isCompleted`, `var canComplete`). Add it alongside the existing variable declarations:

```javascript
// Near the top of the IIFE, add:
var resumeSeconds = 0;
```

### Step 5e: Update CSP headers

**File:** `public/_headers`

In the `Content-Security-Policy` header, update the `frame-src` directive:

```
# BEFORE:
frame-src https://challenges.cloudflare.com https://player.vimeo.com;

# AFTER:
frame-src https://challenges.cloudflare.com https://*.cloudflarestream.com https://embed.cloudflarestream.com;
```

Also add to `script-src` to allow the Stream SDK:

```
# BEFORE:
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com;

# AFTER:
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://embed.cloudflarestream.com;
```

### Verification

- Run `npm run build` — no TypeScript errors, no build errors
- Course player page loads the Stream iframe (not Vimeo)
- Video plays (using a test video with signed URL)
- Progress saves every 15 seconds (check Network tab for PATCH to `/api/courses/progress`)
- "Mark Complete" enables after watching 90% (or configured threshold)
- Video resumes from saved position on page reload
- Autoplay countdown appears after video ends (if `autoplayNextVideo` is true)
- Browser console shows no CSP violations

### Commit message
```
feat: swap Vimeo player for Cloudflare Stream with SDK progress tracking (Task 5)
```

---

## Task 6: Build STUC Recording Viewer Page

**Goal:** Create a page where STUC members can watch past call recordings with Gemini notes displayed below the video.

**Files:**
- `src/pages/community/recordings/[...id].astro` — **CREATE**

### Steps

1. **Create `src/pages/community/recordings/[...id].astro`:**

   This follows the same static-shell-with-client-fetch pattern used by `src/pages/community/post/[...id].astro`.

   ```astro
   ---
   import BaseLayout from '../../../layouts/BaseLayout.astro';

   export function getStaticPaths() {
     return [{ params: { id: 'placeholder' } }];
   }
   ---
   <BaseLayout
     title="Call Recording"
     description="STUC call recording for Save the Uterus Club members."
     noindex
   >
     <section class="recording-page">
       <div class="container container--narrow">

         <!-- Back nav -->
         <nav class="back-nav">
           <a href="/community/events/">&larr; Back to Events</a>
         </nav>

         <!-- Loading -->
         <div id="rec-loading" class="post-loading">
           <p>Loading recording...</p>
         </div>

         <!-- Not authorized -->
         <div id="rec-unauthorized" hidden>
           <div class="post-empty-card">
             <h1>Membership Required</h1>
             <p>You need an active Save the Uterus Club membership to view recordings.</p>
             <a href="/login/" class="btn btn--primary">Log in</a>
           </div>
         </div>

         <!-- Not found -->
         <div id="rec-not-found" hidden>
           <div class="post-empty-card">
             <h1>Recording Not Found</h1>
             <p>This recording may not be available yet or the link is incorrect.</p>
             <a href="/community/events/" class="btn btn--secondary">Back to Events</a>
           </div>
         </div>

         <!-- Recording content -->
         <article id="rec-content" hidden>
           <h1 id="rec-title" class="rec-title"></h1>
           <p id="rec-date" class="rec-date"></p>

           <!-- Video player -->
           <div class="video-wrapper">
             <div class="video-container" id="rec-video-container">
               <div id="rec-video-loading" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#888;">
                 Loading video...
               </div>
               <iframe
                 id="rec-stream-player"
                 style="display:none;border:none;width:100%;height:100%;"
                 allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                 allowfullscreen
               ></iframe>
             </div>
           </div>

           <!-- Gemini Notes -->
           <div id="rec-notes-section" class="rec-notes" hidden>
             <h2 class="rec-notes__heading">Meeting Notes</h2>
             <div id="rec-notes-body" class="rec-notes__body"></div>
           </div>

           <!-- Chat Transcript -->
           <div id="rec-transcript-section" class="rec-transcript" hidden>
             <details>
               <summary class="rec-transcript__heading">Chat Transcript</summary>
               <pre id="rec-transcript-body" class="rec-transcript__body"></pre>
             </details>
           </div>
         </article>

       </div>
     </section>

     <script src="https://embed.cloudflarestream.com/embed/sdk.latest.js"></script>

     <script is:inline>
       (function () {
         var loadingEl = document.getElementById('rec-loading');
         var unauthorizedEl = document.getElementById('rec-unauthorized');
         var notFoundEl = document.getElementById('rec-not-found');
         var contentEl = document.getElementById('rec-content');

         // Extract post ID from URL: /community/recordings/{id}
         var pathParts = window.location.pathname.replace(/\/$/, '').split('/');
         var postId = pathParts[pathParts.length - 1];

         if (!postId || postId === 'placeholder') {
           loadingEl.hidden = true;
           notFoundEl.hidden = false;
           return;
         }

         // Check membership
         fetch('/api/community/status', { credentials: 'same-origin' })
           .then(function (r) { return r.json(); })
           .then(function (data) {
             if (!data.ok || data.access !== 'member') {
               loadingEl.hidden = true;
               unauthorizedEl.hidden = false;
               return;
             }
             loadRecording(postId);
           })
           .catch(function () {
             loadingEl.hidden = true;
             unauthorizedEl.hidden = false;
           });

         function loadRecording(id) {
           // Fetch the community post (type=resource) that contains the recording
           fetch('/api/community/posts/' + id, { credentials: 'same-origin' })
             .then(function (r) { return r.json(); })
             .then(function (data) {
               if (!data.ok || !data.post) {
                 loadingEl.hidden = true;
                 notFoundEl.hidden = false;
                 return;
               }

               var post = data.post;
               loadingEl.hidden = true;
               contentEl.hidden = false;

               // Set title and date
               document.getElementById('rec-title').textContent = post.title;
               if (post.eventDate) {
                 var d = new Date(post.eventDate);
                 document.getElementById('rec-date').textContent = d.toLocaleDateString('en-US', {
                   weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                 });
               }

               // Load video if resource_url contains a Stream video ID
               var streamId = post.resourceUrl || post.resource_url;
               if (streamId && /^[a-f0-9]{32}$/.test(streamId)) {
                 loadStreamVideo(streamId);
               }

               // Render notes (stored in post body as markdown/text)
               if (post.body) {
                 var notesSection = document.getElementById('rec-notes-section');
                 var notesBody = document.getElementById('rec-notes-body');
                 notesSection.hidden = false;
                 // Simple text rendering (newlines to paragraphs)
                 notesBody.innerHTML = post.body.split('\n\n').map(function (p) {
                   return '<p>' + escapeHtml(p.trim()) + '</p>';
                 }).filter(function (p) { return p !== '<p></p>'; }).join('');
               }

               // Render transcript if available (stored in metadata or a second field)
               if (post.metadata && post.metadata.transcript) {
                 var transcriptSection = document.getElementById('rec-transcript-section');
                 var transcriptBody = document.getElementById('rec-transcript-body');
                 transcriptSection.hidden = false;
                 transcriptBody.textContent = post.metadata.transcript;
               }
             })
             .catch(function () {
               loadingEl.hidden = true;
               notFoundEl.hidden = false;
             });
         }

         function loadStreamVideo(streamId) {
           fetch('/api/stream/token', {
             method: 'POST',
             credentials: 'same-origin',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ videoId: streamId, context: 'recording' }),
           })
             .then(function (r) { return r.json(); })
             .then(function (data) {
               if (!data.ok) {
                 var el = document.getElementById('rec-video-loading');
                 if (el) el.textContent = 'Unable to load video.';
                 return;
               }

               var iframe = document.getElementById('rec-stream-player');
               var loadingEl2 = document.getElementById('rec-video-loading');
               var src = 'https://customer-' + data.customerCode + '.cloudflarestream.com/' +
                 data.token + '/iframe';
               iframe.setAttribute('src', src);
               iframe.style.display = 'block';
               if (loadingEl2) loadingEl2.style.display = 'none';
             })
             .catch(function () {
               var el = document.getElementById('rec-video-loading');
               if (el) el.textContent = 'Unable to load video.';
             });
         }

         function escapeHtml(str) {
           var div = document.createElement('div');
           div.textContent = str;
           return div.innerHTML;
         }
       })();
     </script>

     <style>
       .recording-page {
         padding: 2rem 0 4rem;
       }
       .rec-title {
         font-size: 1.75rem;
         margin-bottom: 0.25rem;
       }
       .rec-date {
         color: var(--color-text-muted, #666);
         margin-bottom: 1.5rem;
       }
       .rec-notes {
         margin-top: 2rem;
       }
       .rec-notes__heading {
         font-size: 1.25rem;
         margin-bottom: 1rem;
         padding-bottom: 0.5rem;
         border-bottom: 1px solid var(--color-border, #e5e7eb);
       }
       .rec-notes__body p {
         margin-bottom: 1rem;
         line-height: 1.7;
       }
       .rec-transcript {
         margin-top: 2rem;
       }
       .rec-transcript__heading {
         font-size: 1rem;
         font-weight: 600;
         cursor: pointer;
         padding: 0.75rem 0;
       }
       .rec-transcript__body {
         background: var(--color-bg-muted, #f9fafb);
         padding: 1rem;
         border-radius: 0.5rem;
         font-size: 0.875rem;
         line-height: 1.6;
         white-space: pre-wrap;
         max-height: 400px;
         overflow-y: auto;
       }
     </style>
   </BaseLayout>
   ```

2. **Update the events page** to link recordings to the new viewer page.

   In `src/pages/community/events.astro`, the `renderPastCard` function currently links to `ev.resourceUrl` with `target="_blank"`. Update it to link to the recording viewer page instead:

   ```javascript
   // BEFORE (around line 225-226):
   if (ev.resourceUrl) {
     html += '<a href="' + escapeHtml(ev.resourceUrl) + '" target="_blank" rel="noopener noreferrer" class="event-recording-link">View Recording</a>';
   }

   // AFTER:
   if (ev.resourceUrl) {
     html += '<a href="/community/recordings/' + ev.id + '/" class="event-recording-link">View Recording</a>';
   }
   ```

   Note: `ev.id` is the community post ID. The recording viewer page fetches the post by ID and extracts the Stream video ID from `resourceUrl`.

### Verification

- Navigate to `/community/recordings/{postId}/` while logged in as a STUC member
- Video player loads and plays
- Meeting notes appear below the video
- Navigating to the page while not logged in shows "Membership Required"
- Invalid post IDs show "Recording Not Found"
- The events page "View Recording" links point to `/community/recordings/{id}/`

### Commit message
```
feat: add STUC recording viewer page with Stream player (Task 6)
```

---

## Task 7: Build Recording Upload Script

**Goal:** Create a CLI script to manually upload Meet recordings to Cloudflare Stream. This serves as both a standalone tool and the foundation for the n8n automation.

**Files:**
- `scripts/upload-recording.mjs` — **CREATE**

### Steps

1. **Create `scripts/upload-recording.mjs`:**

   ```javascript
   /**
    * Upload a STUC call recording to Cloudflare Stream.
    *
    * Usage:
    *   CF_API_TOKEN=xxx CF_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a \
    *     node scripts/upload-recording.mjs --file /path/to/recording.mp4 --title "Feb 2026 STUC Call"
    *
    * Options:
    *   --file      Path to MP4 file (required)
    *   --title     Video title (required)
    *   --signed    Require signed URLs (default: true)
    *
    * Output: prints Stream UID to stdout (for piping to other scripts)
    */

   import * as tus from 'tus-js-client';
   import fs from 'fs';

   const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
   const CF_API_TOKEN = process.env.CF_API_TOKEN;
   const STREAM_API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`;

   if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
     console.error('CF_ACCOUNT_ID and CF_API_TOKEN env vars required');
     process.exit(1);
   }

   // Parse args
   const args = process.argv.slice(2);
   function getArg(name) {
     const idx = args.indexOf(name);
     return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
   }

   const filePath = getArg('--file');
   const title = getArg('--title');
   const requireSigned = !args.includes('--no-signed');

   if (!filePath || !title) {
     console.error('Usage: node scripts/upload-recording.mjs --file <path> --title <title>');
     process.exit(1);
   }

   if (!fs.existsSync(filePath)) {
     console.error(`File not found: ${filePath}`);
     process.exit(1);
   }

   const fileSize = fs.statSync(filePath).size;
   console.error(`Uploading: ${title} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

   // Upload via tus
   const uid = await new Promise((resolve, reject) => {
     const fileStream = fs.createReadStream(filePath);
     const upload = new tus.Upload(fileStream, {
       endpoint: `${STREAM_API}?direct_user=true`,
       headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
       chunkSize: 50 * 1024 * 1024,
       retryDelays: [0, 3000, 5000, 10000, 20000],
       metadata: {
         name: title,
         requiresignedurls: requireSigned ? 'true' : 'false',
         allowedorigins: 'rrmacademy.org',
       },
       uploadSize: fileSize,
       onError: reject,
       onProgress: (bytesUploaded, bytesTotal) => {
         const pct = ((bytesUploaded / bytesTotal) * 100).toFixed(1);
         process.stderr.write(`\r  ${pct}%`);
       },
       onSuccess: () => {
         process.stderr.write('\r  100%\n');
         resolve(upload.url.split('/').pop());
       },
     });
     upload.start();
   });

   console.error(`Stream UID: ${uid}`);

   // Configure video
   if (requireSigned) {
     const configRes = await fetch(`${STREAM_API}/${uid}`, {
       method: 'POST',
       headers: {
         'Authorization': `Bearer ${CF_API_TOKEN}`,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify({
         requireSignedURLs: true,
         allowedOrigins: ['rrmacademy.org'],
       }),
     });
     if (!configRes.ok) {
       console.error('Warning: failed to set signed URL requirement');
     }
   }

   // Trigger AI captions
   const captionRes = await fetch(`${STREAM_API}/${uid}/captions/en/generate`, {
     method: 'POST',
     headers: {
       'Authorization': `Bearer ${CF_API_TOKEN}`,
       'Content-Type': 'application/json',
     },
   });
   if (captionRes.ok) {
     console.error('Captions: generation triggered');
   } else {
     console.error('Warning: caption generation failed');
   }

   // Print UID to stdout (for piping)
   console.log(uid);
   ```

2. **Test the script:**
   ```bash
   CF_API_TOKEN=xxx CF_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a \
     node scripts/upload-recording.mjs \
       --file ~/Downloads/stuc-feb-2026.mp4 \
       --title "February 2026 STUC Call"
   ```

   The Stream UID is printed to stdout. All status messages go to stderr, so you can pipe:
   ```bash
   STREAM_UID=$(node scripts/upload-recording.mjs --file ... --title ...)
   echo "Uploaded: $STREAM_UID"
   ```

### Verification

- Script uploads a file to Stream and returns a 32-char hex UID
- Video appears in Stream dashboard with `requireSignedURLs: true`
- AI caption generation is triggered
- Script handles errors gracefully (file not found, auth failure)

### Commit message
```
feat: add recording upload script for Stream (Task 7)
```

---

## Task 8: n8n Pipeline for Auto-Processing Meet Recordings

**Goal:** Create an n8n workflow that automatically detects new Google Meet recordings, uploads them to Stream, creates a community post with Gemini notes, and links the recording to the event.

**Files:**
- No site code changes — this is an n8n workflow configuration

### Workflow Design

```
Google Drive Trigger (watch folder)
  → Wait 5 min (for Gemini notes to generate)
  → [Branch A] Download MP4
  → [Branch B] Download Gemini Notes (Google Doc → text)
  → [Branch C] Download Chat Transcript (if exists)
  → Merge branches
  → Execute Command: upload-recording.mjs
  → HTTP Request: Create community post via D1 API
  → HTTP Request: Update event post's resource_url
```

### Steps

1. **Open n8n** at `n8n.rrmacademy.org`

2. **Create new workflow:** "STUC Recording Pipeline"

3. **Node 1: Google Drive Trigger**
   - Trigger type: "File Created"
   - Folder ID: `1bfyQvpFW4ivBC_ZgeA4UZ_4jenRFhdDf`
   - Poll interval: 5 minutes
   - File type filter: `video/mp4`
   - Credential: existing Google Drive OAuth

4. **Node 2: Wait**
   - Wait time: 5 minutes
   - Reason: Google generates Gemini notes and chat transcripts shortly after the recording is saved. Waiting ensures they are available.

5. **Node 3: List Files in Folder**
   - Google Drive > List Files
   - Folder: same as trigger folder
   - Filter: files with name containing the same date/meeting as the trigger file
   - Purpose: find the Gemini Notes (Google Doc) and Chat Transcript (text/plain) that correspond to this recording

6. **Node 4: Download MP4**
   - Google Drive > Download File
   - File ID: from trigger node
   - Save to: `/tmp/recording.mp4`

7. **Node 5: Download Gemini Notes**
   - Google Drive > Export File (Google Doc → plain text)
   - File ID: matched Google Doc from Node 3
   - Export MIME type: `text/plain`

8. **Node 6: Download Chat Transcript** (if exists)
   - Google Drive > Download File
   - File ID: matched text file from Node 3
   - Fallback: empty string if no chat transcript

9. **Node 7: Upload to Stream**
   - Execute Command node:
     ```bash
     CF_API_TOKEN={{ $env.CF_API_TOKEN }} \
     CF_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a \
       node /path/to/scripts/upload-recording.mjs \
         --file /tmp/recording.mp4 \
         --title "{{ $json.fileName.replace('.mp4', '') }}"
     ```
   - Capture stdout (Stream UID)

   Alternatively, use HTTP Request nodes to call the Stream tus endpoint directly, but the CLI script is simpler and already handles retries + captions.

10. **Node 8: Create Community Post**
    - HTTP Request > POST to `https://rrmacademy.org/api/community/posts`
    - Auth: admin session cookie or internal API key
    - Body:
      ```json
      {
        "type": "resource",
        "title": "STUC Call Recording — {{ date }}",
        "body": "{{ geminiNotesText }}",
        "resourceUrl": "{{ streamUid }}",
        "metadata": {
          "transcript": "{{ chatTranscriptText }}"
        }
      }
      ```
    - Note: The `resourceUrl` field stores the Stream UID (32-char hex). The recording viewer page uses this to fetch a signed token.

11. **Node 9: Update Event Post** (link recording to the calendar event)
    - Find the matching event post by date (query `type=event` posts from the same week)
    - PATCH the event post's `resource_url` to the Stream UID
    - This enables the "View Recording" link on past events

12. **Node 10: Cleanup**
    - Delete `/tmp/recording.mp4` to free disk space

13. **Node 11: Notification** (optional)
    - Send a Telegram/email notification that a new recording has been processed

### Environment Variables Needed on n8n Server

```bash
CF_API_TOKEN=xxx       # Cloudflare API token with Stream:Edit
CF_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a
```

### Manual Fallback

If the n8n pipeline fails or a recording needs manual processing:

```bash
# 1. Upload the recording
STREAM_UID=$(CF_API_TOKEN=xxx CF_ACCOUNT_ID=xxx \
  node scripts/upload-recording.mjs --file recording.mp4 --title "March 2026 STUC Call")

# 2. Create community post manually via the admin UI on /community/
#    Set type=resource, paste the Stream UID in resource_url

# 3. Update the event post's resource_url in the admin UI
```

### Verification

- Upload a test MP4 to the Google Drive folder
- Wait 10 minutes for the workflow to trigger
- Check: video appears in Stream dashboard
- Check: community post created with notes in body
- Check: event post updated with recording link
- Check: recording viewer page plays the video

### Commit message
```
docs: document n8n recording pipeline workflow (Task 8)
```

---

## Task 9: Test & Verify

**Goal:** End-to-end testing of all migration components before cancelling Vimeo.

**Files:** No code changes — this is a testing checklist.

### Test Plan

#### 9a: Course Video Playback
- [ ] Navigate to a course video as an enrolled student
- [ ] Video loads (Stream iframe appears, not Vimeo)
- [ ] Video plays without buffering issues
- [ ] Video quality is acceptable (compare to Vimeo)
- [ ] Captions are available (CC button on player)
- [ ] Fullscreen works
- [ ] Picture-in-picture works

#### 9b: Progress Tracking
- [ ] Play a video for 20+ seconds — check that `/api/courses/progress` PATCH fires at ~15s
- [ ] Refresh the page — video resumes from the saved position (not from beginning)
- [ ] Play past 90% — "Mark Complete" button enables
- [ ] Click "Mark Complete" — sidebar updates, progress bar updates
- [ ] Play to the end — auto-complete fires, autoplay countdown appears (if enabled)

#### 9c: Signed URL Security
- [ ] Open browser dev tools > Network tab
- [ ] Find the Stream iframe URL — it should contain a JWT token, NOT a raw video UID
- [ ] Copy the iframe URL and open in an incognito window — should work (token is time-limited, not session-bound at the iframe level)
- [ ] Wait 1+ hours and try the same URL — should fail (expired token)
- [ ] Try accessing `/api/stream/token` without a session cookie — returns 401
- [ ] Try accessing `/api/stream/token` for a course you are not enrolled in — returns 403

#### 9d: STUC Recording Viewer
- [ ] Navigate to `/community/recordings/{postId}/` as a STUC member
- [ ] Video loads and plays
- [ ] Meeting notes display below the video
- [ ] Chat transcript expandable section works (if present)
- [ ] Navigate to the same URL while not logged in — redirects to login
- [ ] Navigate to the same URL as a registered (non-member) user — shows "Membership Required"

#### 9e: CSP Headers
- [ ] Open browser dev tools > Console
- [ ] Navigate to a course video — no CSP violation errors
- [ ] Navigate to a recording — no CSP violation errors
- [ ] Verify `frame-src` includes `*.cloudflarestream.com` (check Response Headers)
- [ ] Verify `frame-src` does NOT include `player.vimeo.com`

#### 9f: Cross-Browser
- [ ] Test in Chrome, Safari, Firefox
- [ ] Test on iOS Safari (mobile)
- [ ] Test on Android Chrome (mobile)

#### 9g: All 53 Videos
- [ ] Spot-check at least 5 videos from each course (20 total)
- [ ] Verify the correct video plays for each lesson (not a mismatch)
- [ ] Verify durations roughly match Vimeo durations

### Commit message
```
(no commit — testing only)
```

---

## Task 10: Cancel Vimeo & Cleanup

**Goal:** Remove all Vimeo references and cancel the Vimeo subscription.

**Files:**
- `src/lib/fetch-courses-data.mjs` — **MODIFY** (remove Vimeo ID field comment)
- `scripts/upload-to-stream.mjs` — keep (for reference) or delete
- `scripts/vimeo-to-stream-mapping.json` — archive or delete
- `scripts/populate-stream-ids.mjs` — delete (one-time script)

### Steps

1. **Final verification pass:**
   - Confirm all 53 videos play correctly from Stream
   - Confirm all AI captions are generated and accurate
   - Confirm no remaining Vimeo references in the codebase:
     ```bash
     # Search for any remaining Vimeo references
     grep -ri "vimeo" src/ functions/ public/ --include="*.ts" --include="*.js" --include="*.astro" --include="*.mjs" --include="_headers"
     ```

2. **Remove `Vimeo ID` field from Airtable:**
   - Open Airtable base `app0nohI0WrgFWOE3`, table `tbl5RdpAUj8ub4nz4` (Lessons)
   - Delete the `Vimeo ID` field (or hide it as an archive)
   - The `Stream Video ID` field is now the sole video identifier

3. **Clean up one-time migration scripts:**
   ```bash
   # Archive the mapping file (useful for reference)
   mv scripts/vimeo-to-stream-mapping.json scripts/archive/

   # Remove one-time scripts
   rm scripts/populate-stream-ids.mjs
   rm scripts/upload-to-stream.mjs
   ```

   Keep `scripts/upload-recording.mjs` — it is used by the n8n pipeline and for manual uploads.

4. **Remove the old Vimeo ID comment** from `src/lib/fetch-courses-data.mjs`:
   - The `LESSON_FIELDS` array comment that said `// ADDED` for Vimeo ID was already replaced in Task 5b
   - Verify no stale comments remain

5. **Cancel Vimeo subscription:**
   - Log in to Vimeo account
   - Go to Settings > Membership > Cancel
   - Download any remaining videos before cancellation (just in case)
   - Note: Vimeo may retain videos for 30 days after cancellation

6. **Uninstall unused dependencies** (if any were Vimeo-specific):
   - Check `package.json` — the current codebase does NOT have a Vimeo SDK dependency (it used postMessage), so nothing to uninstall

### Verification

- `grep -ri "vimeo" src/ functions/ public/` returns zero results
- All courses function identically to before (but with Stream instead of Vimeo)
- Vimeo subscription is cancelled
- `scripts/upload-recording.mjs` still works for future recordings

### Commit message
```
chore: remove Vimeo references and clean up migration scripts (Task 10)
```

---

## Appendix A: Stream Video UID Format

Stream video UIDs are 32-character lowercase hexadecimal strings:
```
a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

The signed token endpoint validates this format with `/^[a-f0-9]{32}$/`.

## Appendix B: Signed Token JWT Structure

```
Header:
{
  "alg": "RS256",
  "kid": "<signing-key-id>"
}

Payload:
{
  "sub": "<video-uid>",
  "kid": "<signing-key-id>",
  "exp": 1740000000,
  "accessRules": [
    { "type": "any", "action": "allow" }
  ]
}
```

The token is used in the embed URL in place of the raw video UID:
```
https://customer-<CODE>.cloudflarestream.com/<TOKEN>/iframe
```

## Appendix C: Cost Estimate

| Item | Quantity | Stream Pricing | Monthly Cost |
|------|----------|---------------|--------------|
| Storage | 53 videos (~50 hours) | $5/1000 min stored | ~$15/mo |
| Delivery | ~500 hours viewed/mo (estimate) | $1/1000 min delivered | ~$30/mo |
| AI Captions | 53 + ~4/mo new | $0 (included) | $0 |
| **Total** | | | **~$45/mo** |

Compare to Vimeo Pro/Business: $240-600/year. Stream is likely comparable or cheaper depending on viewing volume, with the advantage of no third-party dependency and signed URL security.

## Appendix D: Rollback Plan

If Stream has issues after migration:

1. The `Vimeo ID` field is preserved in Airtable until Task 10
2. Re-add `Vimeo ID` to `LESSON_FIELDS` in `fetch-courses-data.mjs`
3. Revert the player changes in `stepId.astro` (git revert the Task 5 commit)
4. Re-add `player.vimeo.com` to CSP headers
5. Run `npm run fetch-courses` to regenerate courses.json with Vimeo IDs

This rollback is viable until Vimeo is cancelled in Task 10. After Task 10, Vimeo videos are no longer available.
