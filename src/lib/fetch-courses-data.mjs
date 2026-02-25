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

import { writeFileSync, mkdirSync, unlinkSync, mkdtempSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'courses.json');

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
  'Vimeo ID',      // ADDED
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
    for (let attempt = 0; attempt < 5; attempt++) {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${pat}` },
      });
      if (res.status !== 429) break;
      const delay = Math.pow(2, attempt) * 1000;
      console.warn(`Rate limited (429), retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable ${res.status}: ${err}`);
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

  if (f['Vimeo ID']) step.vimeoId = f['Vimeo ID'].trim();
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
          if (s.vimeoId) clean.vimeoId = s.vimeoId;
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
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    console.error('Error: AIRTABLE_PAT environment variable required');
    process.exit(1);
  }

  console.log('Fetching courses...');
  const courseRecords = await fetchTable(
    COURSES_TABLE_ID,
    COURSE_FIELDS,
    "{Status}='Published'",
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

  // Sync attachments: Airtable temp URLs → R2 permanent URLs
  console.log('\nSyncing attachments to R2...');
  await syncAttachmentsToR2(courses);

  // Validate: each course should have at least one section with steps
  for (const course of courses) {
    const stepCount = course.sections.reduce((sum, s) => sum + s.steps.length, 0);
    if (stepCount === 0) {
      console.warn(`Warning: course "${course.id}" has 0 steps — check Airtable links`);
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
