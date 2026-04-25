#!/usr/bin/env node
/**
 * migrate-courses-to-d1.mjs
 *
 * Reads src/data/courses.json (canonical post-merge snapshot) and emits SQL INSERT
 * statements for course / course_section / course_step.
 *
 * Skips entries whose id or slug appears in courses-overrides.json -- affiliate
 * courses stay JSON-only and are merged at fetch time.
 *
 * Existing human-readable IDs are PRESERVED verbatim because enrollment.course_id,
 * step_progress.step_id, quiz_response, lesson_comment, affiliate_clicks, and
 * course_waitlist tables already reference these strings.
 *
 * IDEMPOTENCY: Uses INSERT OR REPLACE for all three tables. Re-running this
 * migration is SAFE for the seed phase, but it WILL overwrite admin edits made
 * to migrated rows after seeding. The intent is one-shot seeding -- post-seed,
 * admin endpoints (Phase 4) become the source of mutations. Do not re-run this
 * script against a D1 that has accepted admin writes without first taking a
 * backup snapshot.
 *
 * Usage:
 *   node scripts/migrate-courses-to-d1.mjs > scripts/migrate-courses-data.sql
 *   wrangler d1 execute rrm-auth --remote --file=scripts/migrate-courses-data.sql
 *
 *   # Pre-flight FK check (asserts every enrollment.course_id is satisfied by
 *   # either a migrated course or an override-only course). Runs wrangler under
 *   # the hood -- requires local wrangler auth.
 *   node scripts/migrate-courses-to-d1.mjs --check-fk
 */

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Read source files first, with try/catch -- bail BEFORE writing anything to
// stdout so a `> file` redirect never leaves a partial / 0-byte SQL file.
let courses;
let overrides;
try {
  courses = JSON.parse(readFileSync(join(projectRoot, 'src/data/courses.json'), 'utf-8'));
} catch (err) {
  process.stderr.write(`FATAL: cannot read src/data/courses.json: ${err.message}\n`);
  process.exit(1);
}
try {
  overrides = JSON.parse(readFileSync(join(projectRoot, 'src/data/courses-overrides.json'), 'utf-8'));
} catch (err) {
  process.stderr.write(`FATAL: cannot read src/data/courses-overrides.json: ${err.message}\n`);
  process.exit(1);
}

// Lower-case both sides of override membership tests because the D1 schema
// declares `course.slug TEXT UNIQUE NOT NULL COLLATE NOCASE`. A mixed-case
// override slug would otherwise bypass the skip filter and crash on UNIQUE.
const overrideIds = new Set(overrides.map((o) => (o.id || '').toLowerCase()));
const overrideSlugs = new Set(overrides.map((o) => (o.slug || '').toLowerCase()));

// --check-fk: assert every course_id and step_id referenced in user-data
// tables is satisfied by either a migrated course (this script's output IDs)
// or an override course. Exits non-zero on drift. Designed for manual operator
// use -- not invoked by CI. Validates wrangler envelope shape; distinguishes
// empty-table from satisfied-FK.
//
// Tables checked:
//   course_id: enrollment, step_progress, quiz_response, lesson_comment,
//              affiliate_clicks, course_waitlist
//   step_id:   step_progress, quiz_response, lesson_comment
if (process.argv.includes('--check-fk')) {
  runFkCheck();
  process.exit(0);
}

// Re-run guard: refuse to emit SQL without an explicit acknowledgement flag.
// This script uses INSERT OR REPLACE, which clobbers admin edits (notably
// status='archived') on re-run. Operator discipline is enforced here so a
// stray `node migrate-courses-to-d1.mjs > migrate-courses-data.sql` from
// shell history can't silently regenerate destructive SQL.
if (!process.argv.includes('--seed-mode-i-understand')) {
  process.stderr.write(
    'REFUSING TO EMIT SQL: this script generates INSERT OR REPLACE statements that\n' +
    'will overwrite admin-edited rows (notably course.status) on the next wrangler\n' +
    'd1 execute. To proceed, pass --seed-mode-i-understand explicitly:\n' +
    '\n' +
    '  node scripts/migrate-courses-to-d1.mjs --seed-mode-i-understand \\\n' +
    '    > scripts/migrate-courses-data.sql\n' +
    '\n' +
    'For a read-only FK pre-flight (no SQL emitted), use --check-fk instead.\n'
  );
  process.exit(5);
}

function runFkCheck() {
  const migratedCourseIds = new Set();
  const migratedStepIds = new Set();
  for (const course of courses) {
    const idLower = (course.id || '').toLowerCase();
    const slugLower = (course.slug || '').toLowerCase();
    if (overrideIds.has(idLower) || overrideSlugs.has(slugLower)) continue;
    migratedCourseIds.add(course.id);
    for (const section of course.sections || []) {
      for (const step of section.steps || []) {
        if (step.id) migratedStepIds.add(step.id);
      }
    }
  }
  const overrideRawIds = new Set(overrides.map((o) => o.id));
  const allowedCourseIds = new Set([...migratedCourseIds, ...overrideRawIds]);

  const courseIdQuery = [
    'SELECT course_id FROM enrollment',
    'SELECT course_id FROM step_progress',
    'SELECT course_id FROM quiz_response',
    'SELECT course_id FROM lesson_comment',
    'SELECT course_id FROM affiliate_clicks',
    'SELECT course_id FROM course_waitlist',
  ].join(' UNION ');

  const stepIdQuery = [
    'SELECT step_id FROM step_progress',
    'SELECT step_id FROM quiz_response',
    'SELECT step_id FROM lesson_comment',
  ].join(' UNION ');

  const courseIdRows = runWranglerQuery(courseIdQuery, 'course_id union');
  const courseIdValues = courseIdRows.map((r) => r.course_id).filter((v) => v !== null && v !== undefined);
  const courseOrphans = courseIdValues.filter((id) => !allowedCourseIds.has(id));

  const stepIdRows = runWranglerQuery(stepIdQuery, 'step_id union');
  const stepIdValues = stepIdRows.map((r) => r.step_id).filter((v) => v !== null && v !== undefined);
  const stepOrphans = stepIdValues.filter((id) => !migratedStepIds.has(id));

  if (courseOrphans.length > 0 || stepOrphans.length > 0) {
    if (courseOrphans.length > 0) {
      process.stderr.write(
        `FK CHECK FAIL: ${courseOrphans.length} course_id values orphaned: ${courseOrphans.join(', ')}\n`
      );
    }
    if (stepOrphans.length > 0) {
      process.stderr.write(
        `FK CHECK FAIL: ${stepOrphans.length} step_id values orphaned: ${stepOrphans.join(', ')}\n`
      );
    }
    process.exit(3);
  }

  const courseStatus = courseIdValues.length === 0
    ? `0 rows (verify the 6 tables are intentionally empty)`
    : `${courseIdValues.length} distinct course_id values satisfied (${migratedCourseIds.size} migrated + ${overrideRawIds.size} override)`;
  const stepStatus = stepIdValues.length === 0
    ? `0 rows (verify the 3 tables are intentionally empty)`
    : `${stepIdValues.length} distinct step_id values satisfied (${migratedStepIds.size} migrated)`;

  process.stderr.write(`FK CHECK PASS (course_id): ${courseStatus}\n`);
  process.stderr.write(`FK CHECK PASS (step_id):   ${stepStatus}\n`);
  process.exit(0);
}

function runWranglerQuery(sql, label) {
  let raw;
  try {
    raw = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', 'rrm-auth', '--remote', '--json', '--command', sql],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    process.stderr.write(`FATAL: wrangler ${label} query failed: ${err.message}\n`);
    process.exit(2);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`FATAL: cannot parse wrangler --json output for ${label}: ${err.message}\n`);
    process.exit(2);
  }

  // wrangler --json returns an array of result envelopes. Verify shape before
  // pulling .results -- a `success: false` envelope or unexpected key would
  // otherwise nullish-coalesce to [] and silently pass the FK check.
  const envelope = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!envelope || typeof envelope !== 'object') {
    process.stderr.write(`FATAL: wrangler ${label} returned non-object envelope\n`);
    process.exit(2);
  }
  if (envelope.success === false) {
    process.stderr.write(`FATAL: wrangler ${label} envelope reports success=false: ${JSON.stringify(envelope).slice(0, 500)}\n`);
    process.exit(2);
  }
  if (!('results' in envelope)) {
    process.stderr.write(`FATAL: wrangler ${label} envelope missing .results key: ${JSON.stringify(envelope).slice(0, 500)}\n`);
    process.exit(2);
  }
  return Array.isArray(envelope.results) ? envelope.results : [];
}

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  const escaped = String(val).replace(/'/g, "''");
  // wrangler d1 execute --file splits on newlines; embedded \n in string literals
  // breaks the parser even though SQLite itself accepts multi-line strings.
  // Convert newlines to char(10) concatenation to keep each INSERT on one line.
  if (escaped.includes('\n')) {
    return escaped.split('\n').map((s) => `'${s}'`).join(" || char(10) || ");
  }
  return `'${escaped}'`;
}

function escJson(val) {
  if (val === null || val === undefined) return 'NULL';
  return esc(JSON.stringify(val));
}

// Strict boolean coercion. Plain `val ? 1 : 0` returns 1 for the string
// "false" (any non-empty string is truthy), which would silently corrupt
// boolean columns if courses.json ever held stringy booleans.
function bool(val) {
  return (val === true || val === 1 || val === '1') ? 1 : 0;
}

function intOrZero(val) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

const lines = [];
const now = new Date().toISOString();

// NOTE: wrangler d1 execute --file has a parser bug where mixing SQL comments and
// blank lines between INSERT statements triggers "syntax error at offset N: SQLITE_ERROR".
// Emit only INSERT statements -- no comments, no blank lines.
// Manifest is written to stderr instead.
// D1 remote execution also does not support BEGIN/COMMIT transaction blocks.
process.stderr.write(`-- Course migration data (auto-generated)\n`);
process.stderr.write(`-- Generated: ${now}\n`);
process.stderr.write(`-- Source: D1-origin courses from src/data/courses.json (overrides excluded)\n`);
process.stderr.write(`-- Run: wrangler d1 execute rrm-auth --remote --file=scripts/migrate-courses-data.sql\n`);

let courseCount = 0;
let sectionCount = 0;
let stepCount = 0;
const skipped = [];
// Separate counter so skipped overrides do not leave gaps in sort_order.
// courseIdx walks the input array; sortOrder advances only on emit.
let sortOrder = 0;

for (let courseIdx = 0; courseIdx < courses.length; courseIdx++) {
  const course = courses[courseIdx];

  if (
    overrideIds.has((course.id || '').toLowerCase()) ||
    overrideSlugs.has((course.slug || '').toLowerCase())
  ) {
    skipped.push(course.id);
    continue;
  }

  const courseCols = [
    'id',
    'slug',
    'title',
    'description',
    'short_description',
    'image_url',
    'image_alt',
    'price_cents',
    'stripe_price_id',
    'is_free',
    'has_certificate',
    'certificate_quiz_step_id',
    'self_paced',
    'access_type',
    'coming_soon',
    'participants',
    'instructors_json',
    'includes_json',
    'included_in_json',
    'settings_json',
    'seo_json',
    'faqs_json',
    'sort_order',
    'status',
  ].join(', ');

  const courseVals = [
    esc(course.id),
    esc(course.slug),
    esc(course.title),
    esc(course.description ?? null),
    esc(course.shortDescription ?? null),
    esc(course.image ?? null),
    esc(course.imageAlt ?? null),
    intOrZero(course.priceCents),
    esc(course.stripePriceId ?? null),
    bool(course.isFree),
    bool(course.hasCertificate),
    esc(course.certificateQuizId ?? null),
    bool(course.selfPaced ?? true),
    esc(course.accessType ?? 'public'),
    bool(course.comingSoon),
    intOrZero(course.participants),
    escJson(course.instructors ?? null),
    escJson(course.includes ?? null),
    escJson(course.includedIn ?? null),
    escJson(course.settings ?? null),
    escJson(course.seo ?? null),
    escJson(course.faqs ?? null),
    sortOrder,
    esc('published'),
  ].join(', ');

  lines.push(`INSERT OR REPLACE INTO course (${courseCols}) VALUES (${courseVals});`);
  courseCount++;
  sortOrder++;

  const sections = Array.isArray(course.sections) ? course.sections : [];
  for (let sectionIdx = 0; sectionIdx < sections.length; sectionIdx++) {
    const section = sections[sectionIdx];
    const sectionVals = [
      esc(section.id),
      esc(course.id),
      esc(section.title),
      sectionIdx,
    ].join(', ');
    lines.push(
      `INSERT OR REPLACE INTO course_section (id, course_id, title, sort_order) VALUES (${sectionVals});`
    );
    sectionCount++;

    const steps = Array.isArray(section.steps) ? section.steps : [];
    for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
      const step = steps[stepIdx];
      const stepVals = [
        esc(step.id),
        esc(section.id),
        esc(course.id),
        esc(step.title),
        esc(step.type),
        esc(step.streamUid ?? null),
        step.duration !== undefined && step.duration !== null ? intOrZero(step.duration) : 'NULL',
        stepIdx,
        escJson(step.attachments ?? null),
        esc('published'),
      ].join(', ');
      lines.push(
        `INSERT OR REPLACE INTO course_step (id, section_id, course_id, title, type, stream_uid, duration_seconds, sort_order, attachments_json, status) VALUES (${stepVals});`
      );
      stepCount++;
    }
  }
}

process.stdout.write(lines.join('\n') + '\n');

// Print to stderr so a `> file` redirect still surfaces the manifest in CI logs.
process.stderr.write(
  `migrate-courses-to-d1: ${courseCount} courses, ${sectionCount} sections, ${stepCount} steps; skipped overrides: ${skipped.join(', ') || 'none'}\n`
);
