#!/usr/bin/env node
/**
 * STUC Course Publisher
 *
 * After editing in Descript, this script:
 *   1. Uploads the edited MP4 to Cloudflare Stream (tus protocol)
 *   2. Parses the Descript SRT transcript for chapter structure
 *   3. Creates Airtable Module + Lesson records
 *   4. Flips the Course's "Coming Soon" flag to false
 *   5. Triggers a site rebuild via GitHub Actions
 *
 * Usage:
 *   node scripts/stuc-pipeline/publish.mjs <course-id> [--dry-run]
 *
 * Expects in ./downloads/<course-id>/edited/:
 *   - video.mp4        (edited video from Descript)
 *   - transcript.srt   (SRT file from Descript export)
 *   - chapters.json    (optional -- Descript chapter markers, or auto-detected)
 *
 * Environment (auto-loaded from 1Password if not set):
 *   CF_STREAM_TOKEN   -- Cloudflare API token with Stream:Edit
 *   AIRTABLE_PAT      -- Airtable personal access token
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, execSync } from 'child_process';
import { createReadStream } from 'fs';
import { request as httpsRequest } from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, 'manifest.json');
const DOWNLOADS_BASE = join(__dirname, 'downloads');

// Cloudflare
const CF_ACCOUNT_ID = 'ecf2c5bc8b5ebd634bcb587b3890910a';
const TUS_ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`;
const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB

// Airtable
const AIRTABLE_BASE_ID = 'app0nohI0WrgFWOE3';
const COURSES_TABLE = 'tblsLSGVuza8NPlDK';
const MODULES_TABLE = 'tbloA6RVfnT8WMHFq';
const LESSONS_TABLE = 'tbl5RdpAUj8ub4nz4';

// --- CLI ---

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const courseId = args.find(a => !a.startsWith('--'));

if (!courseId) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  console.log('Usage: node publish.mjs <course-id> [--dry-run]\n');
  console.log('Available courses:');
  for (const c of manifest.courses) {
    console.log(`  ${c.courseId} [${c.status}]`);
  }
  process.exit(1);
}

// --- Helpers ---

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
  console.log(`[${ts}] ${msg}`);
}

function getSecret(name, opPath) {
  if (process.env[name]) return process.env[name];
  try {
    // --reveal required per feedback-op-reveal memory
    return execFileSync('op', ['item', 'get', opPath.split('/').pop(), '--vault', 'Automation', '--fields', 'credential', '--reveal'], { encoding: 'utf8' }).trim();
  } catch {
    console.error(`Error: ${name} not set and 1Password read failed.`);
    console.error(`  Set ${name} env var or store in 1Password Automation vault.`);
    if (name === 'CF_STREAM_TOKEN') {
      console.error('  Create at: dash.cloudflare.com > API Tokens > Custom > Account:Stream:Edit');
      console.error('  Save as "Cloudflare Stream Token" in 1Password Automation vault');
    }
    process.exit(1);
  }
}

// --- SRT Parser ---

function parseSRT(srtContent) {
  /**
   * Parse an SRT file into timed segments.
   * Returns: [{ index, startMs, endMs, text }]
   */
  const blocks = srtContent.trim().split(/\n\n+/);
  return blocks.map(block => {
    const lines = block.split('\n');
    if (lines.length < 3) return null;

    const index = parseInt(lines[0], 10);
    const timeParts = lines[1].split(' --> ');
    if (timeParts.length !== 2) return null;

    const startMs = srtTimeToMs(timeParts[0].trim());
    const endMs = srtTimeToMs(timeParts[1].trim());
    const text = lines.slice(2).join(' ').trim();

    return { index, startMs, endMs, text };
  }).filter(Boolean);
}

function srtTimeToMs(timeStr) {
  // 00:01:23,456 -> ms
  const [hms, ms] = timeStr.split(',');
  const [h, m, s] = hms.split(':').map(Number);
  return ((h * 3600) + (m * 60) + s) * 1000 + parseInt(ms, 10);
}

function msToSeconds(ms) {
  return Math.round(ms / 1000);
}

// --- Chapter Detection ---

function loadChapters(editedDir, srtSegments) {
  /**
   * Load chapters from:
   *   1. chapters.json (manual or Descript-exported)
   *   2. Auto-detect from transcript (fallback)
   *
   * Returns: [{ title, startMs, endMs }]
   */
  const chaptersPath = join(editedDir, 'chapters.json');
  if (existsSync(chaptersPath)) {
    log('Using chapters.json');
    return JSON.parse(readFileSync(chaptersPath, 'utf8'));
  }

  // Fallback: treat entire video as one section
  log('No chapters.json found -- treating as single section');
  if (srtSegments.length === 0) return [];

  const startMs = srtSegments[0].startMs;
  const endMs = srtSegments[srtSegments.length - 1].endMs;
  return [{ title: 'Full Presentation', startMs, endMs }];
}

// --- Cloudflare Stream Upload (TUS) ---

async function uploadToStream(filePath, videoName, cfToken) {
  const fileSize = statSync(filePath).size;
  log(`Uploading to CF Stream: ${videoName} (${(fileSize / 1024 / 1024).toFixed(0)} MB)`);

  if (DRY_RUN) {
    log('[DRY RUN] Would upload to CF Stream');
    return 'dry-run-stream-uid';
  }

  const nameB64 = Buffer.from(videoName).toString('base64');

  // Step 1: Create upload
  const createRes = await fetch(TUS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(fileSize),
      'Upload-Metadata': `name ${nameB64}`,
    },
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`TUS create failed (${createRes.status}): ${body.slice(0, 200)}`);
  }

  const location = createRes.headers.get('location');
  let streamUid = createRes.headers.get('stream-media-id');

  if (!location) throw new Error('TUS create: no Location header');
  log(`  Upload created: ${streamUid || '?'}`);

  // Step 2: Upload in chunks
  const buffer = readFileSync(filePath);
  let offset = 0;

  while (offset < fileSize) {
    const end = Math.min(offset + CHUNK_SIZE, fileSize);
    const chunk = buffer.subarray(offset, end);

    const patchRes = await fetch(location, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${cfToken}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream',
      },
      body: chunk,
    });

    if (!patchRes.ok) {
      const body = await patchRes.text();
      throw new Error(`TUS patch failed at offset ${offset} (${patchRes.status}): ${body.slice(0, 200)}`);
    }

    const newOffset = patchRes.headers.get('upload-offset');
    offset = newOffset ? parseInt(newOffset, 10) : end;
    const pct = Math.round(offset / fileSize * 100);
    log(`  ${pct}% uploaded (${(offset / 1024 / 1024).toFixed(0)}/${(fileSize / 1024 / 1024).toFixed(0)} MB)`);
  }

  // Extract UID from location if not in header
  if (!streamUid && location) {
    streamUid = location.replace(/\/$/, '').split('/').pop();
  }

  log(`  Stream UID: ${streamUid}`);
  return streamUid;
}

// --- Wait for Stream processing ---

async function waitForStreamReady(streamUid, cfToken, maxWaitMs = 300000) {
  log('Waiting for Stream processing...');
  if (DRY_RUN) return { duration: 3600 };

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${TUS_ENDPOINT}/${streamUid}`, {
      headers: { 'Authorization': `Bearer ${cfToken}` },
    });

    if (res.ok) {
      const data = await res.json();
      const video = data.result;
      if (video?.status?.state === 'ready') {
        const duration = Math.round(video.duration || 0);
        log(`  Ready! Duration: ${duration}s (${Math.round(duration / 60)}min)`);
        return { duration };
      }
      if (video?.status?.state === 'error') {
        throw new Error(`Stream processing failed: ${JSON.stringify(video.status)}`);
      }
      log(`  Status: ${video?.status?.state || 'unknown'}... waiting`);
    }

    await new Promise(r => setTimeout(r, 10000)); // poll every 10s
  }

  throw new Error(`Stream processing timed out after ${maxWaitMs / 1000}s`);
}

// --- Airtable ---

async function airtableRequest(tableId, method, body, pat, recordId) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}${recordId ? '/' + recordId : ''}`;

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable ${method} ${tableId} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function findCourseRecord(courseId, pat) {
  /**
   * Find the existing Airtable Course record by Course ID field.
   */
  const formula = encodeURIComponent(`{Course ID}='${courseId}'`);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${COURSES_TABLE}?filterByFormula=${formula}&maxRecords=1`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${pat}` },
  });
  if (!res.ok) throw new Error(`Airtable search failed: ${res.status}`);
  const data = await res.json();
  return data.records?.[0] || null;
}

async function createModulesAndLessons(courseRecordId, chapters, streamUid, videoDuration, courseId, pat) {
  /**
   * Create Module + Lesson records in Airtable for each chapter.
   * If only 1 chapter, create 1 module with 1 lesson.
   */
  const moduleIds = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const moduleId = `${courseId}-s${i + 1}`;
    const stepId = `${courseId}-s${i + 1}-1`;

    log(`  Creating Module: ${chapter.title} (${moduleId})`);
    if (!DRY_RUN) {
      const moduleRes = await airtableRequest(MODULES_TABLE, 'POST', {
        fields: {
          'Title': chapter.title,
          'Order': i + 1,
          'Course': [courseRecordId],
          'Module ID': moduleId,
        },
      }, pat);
      moduleIds.push(moduleRes.id);

      // Calculate lesson duration from chapter timestamps (or use full video duration for single chapter)
      const lessonDuration = chapters.length === 1
        ? videoDuration
        : msToSeconds(chapter.endMs - chapter.startMs);

      log(`  Creating Lesson: ${chapter.title} (${stepId}, ${lessonDuration}s)`);
      await airtableRequest(LESSONS_TABLE, 'POST', {
        fields: {
          'Title': chapter.title,
          'Order': 1,
          'Module': [moduleRes.id],
          'Step ID': stepId,
          'Type': 'Video',
          'Stream ID': streamUid,
          'Duration': lessonDuration,
          'Status': 'Published',
        },
      }, pat);
    } else {
      log(`  [DRY RUN] Would create Module ${moduleId} + Lesson ${stepId}`);
    }
  }

  return moduleIds;
}

async function publishCourse(courseRecordId, pat) {
  /**
   * Flip Coming Soon to false, set access to private (STUC gated).
   */
  log('  Updating course: Coming Soon = false, Access = Private');
  if (!DRY_RUN) {
    await airtableRequest(COURSES_TABLE, 'PATCH', {
      fields: {
        'Coming Soon': false,
        'Access Type': 'Private',
        'Is Free': true,
      },
    }, pat, courseRecordId);
  }
}

// --- GitHub Actions trigger ---

async function triggerRebuild() {
  log('Triggering site rebuild...');
  if (DRY_RUN) {
    log('[DRY RUN] Would trigger GitHub Actions rebuild');
    return;
  }

  try {
    execFileSync('gh', [
      'workflow', 'run', 'Build & Deploy',
      '--repo', 'rrmadmin/rrm-academy-cf',
    ], { encoding: 'utf8', stdio: 'pipe' });
    log('  Rebuild triggered via GitHub Actions');
  } catch (err) {
    log(`  Warning: rebuild trigger failed: ${err.message}`);
    log('  Run manually: gh workflow run "Build & Deploy"');
  }
}

// --- Main ---

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const course = manifest.courses.find(c => c.courseId === courseId);

  if (!course) {
    console.error(`Course '${courseId}' not found in manifest`);
    process.exit(1);
  }

  log(`=== Publishing: ${course.title} ===`);
  if (DRY_RUN) log('[DRY RUN MODE]');

  // Verify edited files exist
  const editedDir = join(DOWNLOADS_BASE, courseId, 'edited');
  const videoPath = join(editedDir, 'video.mp4');
  const srtPath = join(editedDir, 'transcript.srt');

  if (!existsSync(videoPath)) {
    console.error(`Missing: ${videoPath}`);
    console.error('Export your edited video from Descript as video.mp4 into:');
    console.error(`  ${editedDir}/`);
    process.exit(1);
  }

  // Load credentials
  const cfToken = getSecret('CF_STREAM_TOKEN', 'op://Automation/Cloudflare Stream Token/credential');
  const airtablePat = getSecret('AIRTABLE_PAT', 'op://Automation/OpenClaw Airtable PAT/credential');
  log(`  CF token: ${cfToken.slice(0, 8)}...`);
  log(`  Airtable PAT: ${airtablePat.slice(0, 8)}...`);

  // Step 1: Upload to CF Stream
  log('\n--- Step 1: Upload to Cloudflare Stream ---');
  const streamUid = await uploadToStream(videoPath, course.title, cfToken);

  // Step 2: Wait for processing
  log('\n--- Step 2: Wait for Stream processing ---');
  const { duration: videoDuration } = await waitForStreamReady(streamUid, cfToken);

  // Step 3: Parse transcript + chapters
  log('\n--- Step 3: Parse transcript + chapters ---');
  let srtSegments = [];
  if (existsSync(srtPath)) {
    const srtContent = readFileSync(srtPath, 'utf8');
    srtSegments = parseSRT(srtContent);
    log(`  Parsed ${srtSegments.length} SRT segments`);
  } else {
    log('  No SRT file found -- proceeding without transcript');
  }

  const chapters = loadChapters(editedDir, srtSegments);
  log(`  ${chapters.length} chapter(s) detected`);

  // Step 4: Find existing Airtable course record
  log('\n--- Step 4: Create Airtable records ---');
  const courseRecord = await findCourseRecord(courseId, airtablePat);
  if (!courseRecord) {
    console.error(`No Airtable Course record found with Course ID = '${courseId}'`);
    console.error('Create the course record in Airtable first.');
    process.exit(1);
  }
  log(`  Found course record: ${courseRecord.id}`);

  // Step 5: Create Modules + Lessons
  await createModulesAndLessons(courseRecord.id, chapters, streamUid, videoDuration, courseId, airtablePat);

  // Step 6: Flip Coming Soon
  log('\n--- Step 5: Publish course ---');
  await publishCourse(courseRecord.id, airtablePat);

  // Step 7: Update manifest
  log('\n--- Step 6: Update manifest ---');
  course.status = 'published';
  course.streamUid = streamUid;
  course.publishedAt = new Date().toISOString();
  if (!DRY_RUN) {
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    log('  Manifest updated');
  }

  // Step 8: Trigger rebuild
  log('\n--- Step 7: Trigger rebuild ---');
  await triggerRebuild();

  log('\n=== Done ===');
  log(`Course "${course.title}" is ${DRY_RUN ? 'ready to be ' : ''}published.`);
  log(`Stream UID: ${streamUid}`);
  log(`Chapters: ${chapters.length}`);
  if (!DRY_RUN) {
    log(`View at: https://rrmacademy.org/courses/${course.slug}/`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
