#!/usr/bin/env node
/**
 * ssot-courses-snapshot: re-snapshot ssot/courses.json from src/data/courses.json.
 *
 * Phase 0a-bis (2026-04-29): D1 is SSOT for courses. The site-ssot tool doesn't
 * yet have a courses schema/loader, so ssot/courses.json is an out-of-band
 * Schema.org Course array. This script keeps it in sync with the D1 fetch
 * (src/data/courses.json) on every build, so course adds/removes/renames in D1
 * automatically flow into the SSOT.
 *
 * Mapping rules:
 *   - @id          = https://rrmacademy.org/courses/{slug}/#course
 *   - @type        = "Course"
 *   - name         = course.title
 *   - description  = "TBD-GIANNA" (preserve placeholder until Gianna fills it)
 *   - provider     = { "@id": "https://rrmacademy.org/#organization" }
 *   - instructor   = derived from course.instructors[].name
 *       - "Dr. Naomi Whittaker" / "Naomi Whittaker"  -> @id #naomi-whittaker
 *       - "Dr. Phil Boyle" / "Phil Boyle"            -> @id #instructor-phil-boyle
 *       - other named humans (role != "Organization") -> derived per-course @id
 *       - role == "Organization" entries skipped (not a Person)
 *   - hasCourseInstance = [{ courseMode: "online", courseWorkload: selfPaced ? "selfPaced" : "scheduled" }]
 *   - offers       = { @type: "Offer", price: priceCents/100, priceCurrency: "USD" }
 *
 * Idempotency: byte-equivalent output for the same input. Diff-stable.
 *
 * Run before ssot-emit so the schema/snapshot pipeline picks up fresh courses.
 * Wired into scripts/ssot-prebuild.mjs.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SRC = resolve(PROJECT_ROOT, 'src/data/courses.json');
const DST = resolve(PROJECT_ROOT, 'ssot/courses.json');

const ORG_ID = 'https://rrmacademy.org/#organization';
const NAOMI_ID = 'https://rrmacademy.org/#naomi-whittaker';

function slugifyName(name) {
  return name
    .toLowerCase()
    .replace(/^dr\.?\s+/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeInstructorName(raw) {
  // Strip "Dr." prefix and trailing degree suffixes (", MD", ", DPT", etc.) so
  // "Dr. Naomi Whittaker", "Naomi Whittaker, MD", and "Naomi Whittaker"
  // all collapse to the same key.
  return raw
    .toLowerCase()
    .replace(/^dr\.?\s+/i, '')
    .replace(/,\s*[a-z\.\-\s]+$/i, '')
    .trim();
}

function instructorIdFor(courseSlug, instructor) {
  const raw = (instructor.name || '').trim();
  if (!raw) return null;
  const norm = normalizeInstructorName(raw);
  if (norm === 'naomi whittaker') return NAOMI_ID;
  // Phil Boyle gets a stable per-course id (matches existing ssot/courses.json).
  if (norm === 'phil boyle') {
    return `https://rrmacademy.org/courses/${courseSlug}/#instructor-phil-boyle`;
  }
  // Other named human instructors: derived per-course @id from normalized name.
  return `https://rrmacademy.org/courses/${courseSlug}/#instructor-${slugifyName(norm)}`;
}

function buildInstructorRefs(course) {
  const list = Array.isArray(course.instructors) ? course.instructors : [];
  const refs = [];
  const seen = new Set();
  for (const ins of list) {
    const role = (ins.role || '').toLowerCase();
    if (role === 'organization') continue;
    const id = instructorIdFor(course.slug, ins);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    refs.push({ '@id': id });
  }
  return refs;
}

function buildCourseInstance(course) {
  return [
    {
      '@type': 'CourseInstance',
      courseMode: 'online',
      courseWorkload: course.selfPaced === false ? 'scheduled' : 'selfPaced',
    },
  ];
}

function buildOffer(course) {
  const cents = typeof course.priceCents === 'number' ? course.priceCents : 0;
  return {
    '@type': 'Offer',
    price: cents / 100,
    priceCurrency: 'USD',
  };
}

function buildSsotCourse(course) {
  return {
    '@id': `https://rrmacademy.org/courses/${course.slug}/#course`,
    '@type': 'Course',
    name: course.title,
    description: 'TBD-GIANNA',
    provider: { '@id': ORG_ID },
    instructor: buildInstructorRefs(course),
    hasCourseInstance: buildCourseInstance(course),
    offers: buildOffer(course),
  };
}

function main() {
  if (!existsSync(SRC)) {
    console.error(`[ssot-courses-snapshot] WARN: ${SRC} not found — skipping (no fetch yet?)`);
    process.exit(0);
  }
  const raw = JSON.parse(readFileSync(SRC, 'utf8'));
  if (!Array.isArray(raw)) {
    console.error(`[ssot-courses-snapshot] FATAL: ${SRC} is not an array`);
    process.exit(1);
  }

  // Preserve the existing wrapper (top-level keys: $schema, version, _note, courses).
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(DST, 'utf8'));
  } catch {
    // file missing or unparseable; start fresh
  }
  const wrapper = {
    $schema: existing.$schema || 'https://json-schema.org/draft/2020-12/schema',
    version: existing.version || '1.0.0',
    _note: existing._note || 'Courses snapshot — regenerated each build by scripts/ssot-courses-snapshot.mjs from src/data/courses.json (D1-merged with src/data/courses-overrides.json). Not validated by ssot-validate (out-of-band file).',
    courses: raw.map(buildSsotCourse),
  };

  const out = JSON.stringify(wrapper, null, 2) + '\n';
  writeFileSync(DST, out);
  console.log(`[ssot-courses-snapshot] wrote ${DST.replace(PROJECT_ROOT + '/', '')} (${wrapper.courses.length} courses)`);
}

main();
