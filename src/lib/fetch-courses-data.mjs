/**
 * Standalone script to fetch course data from Airtable and cache as JSON.
 * Run: AIRTABLE_PAT=xxx node src/lib/fetch-courses-data.mjs
 *
 * Airtable structure: 3 linked tables in the RRM Courses base.
 *   - Courses: course-level metadata (4 records)
 *   - Modules: sections within a course, linked to Course (33 records)
 *   - Lessons: individual steps, linked to Module (69 records)
 *
 * Hierarchy: Course → Module (section) → Lesson (step)
 * The fetch resolves these links and outputs nested JSON matching
 * the existing courses.json format consumed by Astro pages.
 *
 * Attachments: Lessons may have PDF/file attachments in Airtable.
 * Airtable attachment URLs expire in ~2 hours, so during build we
 * download each file and upload to R2 (rrm-assets bucket) for
 * permanent CDN-served URLs.
 *
 * Tables to IGNORE (from template, not used):
 *   - Students (enrollment lives in D1, not Airtable)
 *   - Assignments (quiz content lives in quizzes.json)
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, mkdtempSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'courses.json');
const DRY_RUN = process.argv.includes('--dry-run');

const R2_BUCKET = 'rrm-assets';
const R2_PUBLIC_URL = 'https://pub-4af88159ce884265baba8fb4f3470625.r2.dev';

const AIRTABLE_BASE_ID = 'app0nohI0WrgFWOE3';
const COURSES_TABLE_ID = 'tblsLSGVuza8NPlDK';
const MODULES_TABLE_ID = 'tbloA6RVfnT8WMHFq';
const LESSONS_TABLE_ID = 'tbl5RdpAUj8ub4nz4';

const BASE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

// --- Field names (must match Airtable exactly) ---

// Courses table: template fields + custom fields we add
const COURSE_FIELDS = [
  'Title',                    // template
  'Description',              // template
  'Status',                   // template (Draft, Published, Archived)
  'Modules',                  // template (linked records — auto)
  'Course ID',                // ADDED — internal ID, e.g. "masterclass-endo-surgery"
  'Slug',                     // ADDED
  'Short Description',        // ADDED
  'Image',                    // ADDED
  'Image Alt',                // ADDED
  'Price Cents',              // ADDED
  'Stripe Price ID',          // ADDED
  'Is Free',                  // ADDED (checkbox)
  'Has Certificate',          // ADDED (checkbox)
  'Certificate Quiz Step ID', // ADDED
  'Self Paced',               // ADDED (checkbox)
  'Access Type',              // ADDED (single select: Public, Private)
  'Participants',             // ADDED
  'Instructors',              // ADDED (long text — JSON)
  'Includes',                 // ADDED (comma-separated course slugs)
  'Included In',              // ADDED (comma-separated course slugs)
  'Step Order',               // ADDED (single select: Fixed, Flexible)
  'Video Watch Requirement',  // ADDED (number, 0-1)
  'Autoplay Next Video',      // ADDED (checkbox)
  'SEO Title',                // ADDED
  'SEO Description',          // ADDED
  'SEO Keywords',             // ADDED (comma-separated)
  'Sort Order',               // ADDED
  'Coming Soon',              // ADDED (checkbox — true for placeholder courses not yet published)
  'FAQs',                     // ADDED (long text — JSON array of {question, answer})
];

// Modules table: template fields + Module ID
const MODULE_FIELDS = [
  'Title',         // template
  'Order',         // template
  'Course',        // template (linked record)
  'Lessons',       // template (linked records — auto)
  'Module ID',     // ADDED — internal ID, e.g. "mc-intro"
];

// Lessons table: template fields + custom fields
const LESSON_FIELDS = [
  'Title',         // template
  'Order',         // template
  'Module',        // template (linked record)
  'Step ID',       // ADDED — internal ID, e.g. "mc-intro-1"
  'Type',          // ADDED (single select: Video, Article, Quiz)
  'Stream ID',     // ADDED — Cloudflare Stream video UID
  'Duration',      // ADDED (number — seconds)
  'Status',        // ADDED (single select: Published, Draft)
  // 'Attachments' — not yet created in Airtable; uncomment when field exists
];

// --- Fetch with pagination + retry ---

async function fetchTable(tableId, fields, formula, pat) {
  const records = [];
  let offset;
  let page = 0;

  const apiUrl = `${BASE_URL}/${tableId}`;
  const fieldsParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
  const formulaParam = formula ? `&filterByFormula=${encodeURIComponent(formula)}` : '';

  do {
    page++;
    const url = `${apiUrl}?${fieldsParams}${formulaParam}&pageSize=100${
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
    records.push(...data.records);

    console.log(`  Page ${page}: ${data.records.length} records (${records.length} total)`);
  } while (offset);

  return records;
}

// --- Transform functions ---

function transformCourse(record) {
  const f = record.fields;

  const courseId = f['Course ID'];
  const slug = f['Slug'];
  const title = f['Title'];
  if (!courseId || !slug || !title) return null;

  const course = {
    id: courseId.trim(),
    title: title.trim(),
    slug: slug.trim(),
    description: f['Description'] || '',
    shortDescription: f['Short Description'] || '',
    image: f['Image'] || '',
    imageAlt: f['Image Alt'] || '',
    priceCents: Number(f['Price Cents']) || 0,
    stripePriceId: f['Stripe Price ID'] || null,
    isFree: !!f['Is Free'],
    hasCertificate: !!f['Has Certificate'],
    selfPaced: f['Self Paced'] !== false,
    accessType: (f['Access Type'] || 'public').toLowerCase(),
    comingSoon: !!f['Coming Soon'],
    participants: Number(f['Participants']) || 0,
    instructors: parseJsonField(f['Instructors'], []),
    settings: {
      stepOrder: (f['Step Order'] || 'fixed').toLowerCase(),
      futureStepContent: 'hidden',
      videoWatchRequirement: f['Video Watch Requirement'] != null ? Number(f['Video Watch Requirement']) : 0.9,
      autoplayNextVideo: !!f['Autoplay Next Video'],
    },
    seo: {
      title: f['SEO Title'] || '',
      description: f['SEO Description'] || '',
      keywords: f['SEO Keywords'] ? f['SEO Keywords'].split(',').map(s => s.trim()) : [],
    },
    _recordId: record.id,
    _sortOrder: Number(f['Sort Order']) || 0,
    sections: [],
  };

  if (f['Certificate Quiz Step ID']) {
    course.certificateQuizId = f['Certificate Quiz Step ID'].trim();
  }
  if (f['Includes']) {
    course.includes = f['Includes'].split(',').map(s => s.trim());
  }
  if (f['Included In']) {
    course.includedIn = f['Included In'].split(',').map(s => s.trim());
  }

  const faqs = parseJsonField(f['FAQs'], []);
  if (faqs.length > 0) {
    course.faqs = faqs;
  }

  return course;
}

function transformModule(record) {
  const f = record.fields;

  const title = f['Title'];
  if (!title) return null;

  return {
    _recordId: record.id,
    id: (f['Module ID'] || '').trim(),
    title: title.trim(),
    order: Number(f['Order']) || 0,
    _courseRecordIds: Array.isArray(f['Course']) ? f['Course'] : [],
    steps: [],
  };
}

function transformLesson(record) {
  const f = record.fields;

  const stepId = f['Step ID'];
  const title = f['Title'];
  if (!stepId || !title) return null;

  const step = {
    id: stepId.trim(),
    title: title.trim(),
    type: (f['Type'] || 'article').toLowerCase(),
    order: Number(f['Order']) || 0,
    _moduleRecordIds: Array.isArray(f['Module']) ? f['Module'] : [],
  };

  if (f['Stream ID']) step.streamUid = f['Stream ID'].trim();
  if (f['Duration']) step.duration = Number(f['Duration']);

  // Airtable attachment objects: { id, url, filename, size, type }
  // URLs are temporary (~2h expiry) — will be replaced with R2 URLs
  if (Array.isArray(f['Attachments']) && f['Attachments'].length > 0) {
    step._rawAttachments = f['Attachments'].map(att => ({
      id: att.id,
      filename: att.filename,
      size: att.size,
      type: att.type,
      tempUrl: att.url,
    }));
  }

  return step;
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// --- Assembly: 3 tables → nested JSON ---

function assembleNestedCourses(courses, modules, lessons) {
  // Build maps: Airtable record ID → object
  const courseByRecordId = new Map();
  for (const course of courses) {
    courseByRecordId.set(course._recordId, course);
  }

  const moduleByRecordId = new Map();
  for (const mod of modules) {
    moduleByRecordId.set(mod._recordId, mod);
  }

  // Assign modules to courses
  for (const mod of modules) {
    if (mod._courseRecordIds.length === 0) {
      console.warn(`Warning: module "${mod.id || mod.title}" has no Course link — skipped`);
      continue;
    }
    for (const courseRecId of mod._courseRecordIds) {
      const course = courseByRecordId.get(courseRecId);
      if (!course) {
        console.warn(`Warning: module "${mod.id}" linked to unknown course record ${courseRecId}`);
        continue;
      }
      if (!course._modules) course._modules = [];
      course._modules.push(mod);
    }
  }

  // Assign lessons to modules
  for (const lesson of lessons) {
    if (lesson._moduleRecordIds.length === 0) {
      console.warn(`Warning: lesson "${lesson.id}" has no Module link — skipped`);
      continue;
    }
    for (const modRecId of lesson._moduleRecordIds) {
      const mod = moduleByRecordId.get(modRecId);
      if (!mod) {
        console.warn(`Warning: lesson "${lesson.id}" linked to unknown module record ${modRecId}`);
        continue;
      }
      mod.steps.push(lesson);
    }
  }

  // Build sections from modules, sort everything
  for (const course of courses) {
    const courseMods = course._modules || [];
    courseMods.sort((a, b) => a.order - b.order);

    course.sections = courseMods.map(mod => {
      // Sort lessons within module by order
      mod.steps.sort((a, b) => a.order - b.order);

      return {
        id: mod.id,
        title: mod.title,
        steps: mod.steps.map(s => {
          const clean = { id: s.id, title: s.title, type: s.type };
          if (s.streamUid) clean.streamUid = s.streamUid;
          if (s.duration) clean.duration = s.duration;
          if (s._rawAttachments) clean._rawAttachments = s._rawAttachments;
          return clean;
        }),
      };
    });

    // Remove internal fields (keep _sortOrder for course sort below)
    delete course._recordId;
    delete course._modules;
  }

  // Sort courses by sort order, then clean up
  courses.sort((a, b) => (a._sortOrder || 0) - (b._sortOrder || 0));
  for (const course of courses) {
    delete course._sortOrder;
  }

  return courses;
}

// --- Image Optimization ---

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

async function processCoverImage(imageUrl, courseId) {
  const tinifyKey = process.env.TINIFY_API_KEY;
  if (!tinifyKey) {
    console.log(`  ${courseId}: TINIFY_API_KEY not set, skipping optimization`);
    return null;
  }

  console.log(`  ${courseId}: downloading cover image...`);
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    console.error(`  ${courseId}: download failed (${imgRes.status})`);
    return null;
  }
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  console.log(`  ${courseId}: downloaded ${(imgBuffer.length / 1024).toFixed(0)} KB`);

  const auth = Buffer.from(`api:${tinifyKey}`).toString('base64');
  const tinifyAuth = { Authorization: `Basic ${auth}` };

  // Compress via Tinify
  console.log(`  ${courseId}: compressing via Tinify...`);
  const shrinkRes = await fetch('https://api.tinify.com/shrink', {
    method: 'POST',
    headers: tinifyAuth,
    body: imgBuffer,
  });

  if (!shrinkRes.ok) {
    const errText = await shrinkRes.text();
    console.error(`  ${courseId}: Tinify compression failed (${shrinkRes.status}): ${errText}`);
    return null;
  }

  const outputUrl = shrinkRes.headers.get('Location');
  const meta = await shrinkRes.json();
  const ratio = ((1 - meta.output.ratio) * 100).toFixed(0);
  console.log(`  ${courseId}: compressed (${ratio}% smaller)`);

  // Convert to WebP + resize to 800px wide (2x retina for ~400px cards)
  console.log(`  ${courseId}: converting to WebP...`);
  const webpRes = await fetch(outputUrl, {
    method: 'POST',
    headers: { ...tinifyAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      convert: { type: 'image/webp' },
      resize: { method: 'scale', width: 800 },
    }),
  });
  if (!webpRes.ok) {
    console.error(`  ${courseId}: WebP conversion failed (${webpRes.status})`);
    return null;
  }
  const webpBuffer = Buffer.from(await webpRes.arrayBuffer());

  // Convert to JPG fallback + resize
  console.log(`  ${courseId}: converting to JPG...`);
  const jpgRes = await fetch(outputUrl, {
    method: 'POST',
    headers: { ...tinifyAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      convert: { type: 'image/jpeg' },
      resize: { method: 'scale', width: 800 },
    }),
  });
  if (!jpgRes.ok) {
    console.error(`  ${courseId}: JPG conversion failed (${jpgRes.status})`);
    return null;
  }
  const jpgBuffer = Buffer.from(await jpgRes.arrayBuffer());

  // Upload both to R2 under course-covers/ (public, no auth gate)
  const webpKey = `course-covers/${courseId}.webp`;
  const jpgKey = `course-covers/${courseId}.jpg`;
  uploadBufferToR2(webpBuffer, webpKey, 'image/webp');
  uploadBufferToR2(jpgBuffer, jpgKey, 'image/jpeg');

  console.log(`  ${courseId}: done - WebP ${(webpBuffer.length / 1024).toFixed(0)} KB, JPG ${(jpgBuffer.length / 1024).toFixed(0)} KB`);
  return `/api/assets/${webpKey}`;
}

async function processCoverImages(courses) {
  console.log('\nProcessing cover images...');
  for (const course of courses) {
    if (!course.image) continue;
    const optimizedUrl = await processCoverImage(course.image, course.id);
    if (optimizedUrl) {
      course.image = optimizedUrl;
    } else {
      // No Tinify: still route through proxy for caching (if image is on R2)
      course.image = r2UrlToProxy(course.image);
    }
  }
}

/**
 * Transform R2 public URLs to /api/assets/ proxy paths for caching.
 * R2 public domain serves with no cache headers; the proxy adds
 * Cache-Control: public, max-age=31536000, immutable.
 */
function r2UrlToProxy(url) {
  if (url && url.startsWith(R2_PUBLIC_URL)) {
    return url.replace(R2_PUBLIC_URL, '/api/assets');
  }
  return url;
}

// --- R2 Upload ---

async function uploadToR2(tempUrl, r2Key, contentType) {
  // Download from Airtable's expiring URL
  const res = await fetch(tempUrl);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${tempUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  // Write to temp file for wrangler
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
  console.log(`  ✓ ${r2Key} (${sizeKB} KB)`);
  return `${R2_PUBLIC_URL}/${r2Key}`;
}

async function syncAttachmentsToR2(courses) {
  let uploadCount = 0;

  for (const course of courses) {
    for (const section of course.sections) {
      for (const step of section.steps) {
        if (!step._rawAttachments) continue;

        const attachments = [];
        for (const att of step._rawAttachments) {
          const ext = att.filename.split('.').pop() || 'bin';
          // R2 key: courses/{stepId}/{airtableAttId}.{ext}
          // Using attachment ID ensures uniqueness and enables cache-busting on replace
          const r2Key = `courses/${step.id}/${att.id}.${ext}`;
          const url = await uploadToR2(att.tempUrl, r2Key, att.type);
          attachments.push({
            name: att.filename,
            url,
            size: att.size,
            type: att.type,
          });
          uploadCount++;
        }
        step.attachments = attachments;
        delete step._rawAttachments;
      }
    }
  }

  if (uploadCount > 0) {
    console.log(`\nUploaded ${uploadCount} attachment(s) to R2`);
  }
}

// --- Main ---

async function fetchAll() {
  if (DRY_RUN) {
    const fixturePath = join(__dirname, '..', '..', '.pipeline', 'snapshots', 'latest', 'courses.json');
    const fallbackPath = join(__dirname, '..', 'data', 'courses.json');
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

  console.log('Fetching courses...');
  const courseRecords = await fetchTable(
    COURSES_TABLE_ID,
    COURSE_FIELDS,
    "OR({Status}='Published',{Coming Soon}=1)",
    pat
  );

  console.log('Fetching modules...');
  const moduleRecords = await fetchTable(
    MODULES_TABLE_ID,
    MODULE_FIELDS,
    null, // no status filter — all modules for published courses
    pat
  );

  console.log('Fetching lessons...');
  const lessonRecords = await fetchTable(
    LESSONS_TABLE_ID,
    LESSON_FIELDS,
    "{Status}='Published'",
    pat
  );

  const courses = courseRecords.map(transformCourse).filter(Boolean);
  const modules = moduleRecords.map(transformModule).filter(Boolean);
  const lessons = lessonRecords.map(transformLesson).filter(Boolean);

  console.log(`\nTransformed: ${courses.length} courses, ${modules.length} modules, ${lessons.length} lessons`);

  assembleNestedCourses(courses, modules, lessons);

  // Optimize cover images: compress, convert to WebP, upload to R2
  await processCoverImages(courses);

  // Sync attachments: Airtable temp URLs → R2 permanent URLs
  console.log('\nSyncing attachments to R2...');
  await syncAttachmentsToR2(courses);

  // Validate: each course should have at least one section with steps
  // (Coming Soon placeholder courses are exempt — they have no content yet)
  for (const course of courses) {
    const stepCount = course.sections.reduce((sum, s) => sum + s.steps.length, 0);
    if (stepCount === 0) {
      if (course.comingSoon) {
        console.log(`  ${course.id}: coming soon (no steps yet)`);
      } else {
        console.warn(`Warning: course "${course.id}" has 0 steps — check Airtable links`);
      }
    } else {
      console.log(`  ${course.id}: ${course.sections.length} sections, ${stepCount} steps`);
    }
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(courses, null, 2));
  console.log(`\nWrote ${courses.length} courses to ${OUTPUT_PATH}`);
}

fetchAll().catch(err => {
  console.error(err);
  process.exit(1);
});
