/**
 * Fetch course data from D1 via /api/courses endpoint and cache as JSON.
 * Run: LIBRARY_BUILD_TOKEN=xxx node src/lib/fetch-courses-data.mjs
 *
 * Single-record mode: RECORD_ID=courseId fetches one course.
 * Full mode: fetches all published courses.
 *
 * Override merge: courses-overrides.json (affiliate / externally-hosted
 * courses NOT in D1) is merged after the D1 pull, honoring _position.
 *
 * Endpoint-down resilience: if /api/courses returns 5xx after retries, log
 * loudly and exit 0 WITHOUT modifying courses.json. This makes an outage a
 * no-op deploy (the existing committed courses.json ships unchanged) instead
 * of a data-loss deploy. Combined with deploy.yml's MAX_DROP=1 and
 * ABSOLUTE_FLOOR=8 guards, the pipeline is hardened against partial failures.
 *
 * Replaces the previous Airtable-based fetch.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fetchResponseWithRetry } from './fetch-retry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'courses.json');
const OVERRIDES_PATH = join(__dirname, '..', 'data', 'courses-overrides.json');
const DRY_RUN = process.argv.includes('--dry-run');

const COURSES_URL = 'https://rrmacademy.org/api/courses';

function sortD1Courses(courses) {
  // Sort D1-origin courses by sortOrder ASC. Overrides MUST be filtered out
  // before calling this -- they have no sortOrder and slot in via mergeOverrides
  // splice afterward.
  courses.sort((a, b) => (a.sortOrder ?? 999999) - (b.sortOrder ?? 999999));
  return courses;
}

function readOverrideIdSet() {
  if (!existsSync(OVERRIDES_PATH)) return new Set();
  let overrides;
  try {
    overrides = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf-8'));
  } catch {
    return new Set();
  }
  if (!Array.isArray(overrides)) return new Set();
  const set = new Set();
  for (const o of overrides) {
    if (o?.id) set.add(o.id);
    if (o?.slug) set.add(o.slug);
  }
  return set;
}

async function fetchSingle(recordId) {
  const token = process.env.LIBRARY_BUILD_TOKEN;
  if (!token) {
    console.error('Error: LIBRARY_BUILD_TOKEN environment variable required');
    process.exit(1);
  }

  console.log(`Fetching single course: ${recordId}`);
  let res;
  try {
    res = await fetchResponseWithRetry(`${COURSES_URL}?id=${encodeURIComponent(recordId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error(`FATAL: courses API request failed after retries: ${err.message}`);
    console.error('Leaving courses.json untouched (no-op deploy).');
    process.exit(0);
  }

  if (res.status >= 500) {
    console.error(`FATAL: courses API returned ${res.status} after retries.`);
    console.error('Leaving courses.json untouched (no-op deploy).');
    process.exit(0);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Courses API ${res.status}: ${err}`);
  }

  const body = await res.json();
  if (!body.ok || !body.data) {
    throw new Error(`Courses API error: ${body.error || 'no data'}`);
  }
  const course = body.data;

  // Load existing courses.json (single mode requires existing cache).
  let courses = [];
  if (existsSync(OUTPUT_PATH)) {
    courses = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    console.log(`Loaded ${courses.length} existing courses from cache`);
  } else {
    console.warn('WARN: cache miss on single-record dispatch — promoting to fetchAll. This means src/data/courses.json was not restored from git before fetch (deploy.yml step "Restore git-committed data files over cache" failed or was skipped). Investigate if this recurs.');
    return fetchAll();
  }

  // Filter out (a) the updated id and (b) all overrides. We re-add the
  // updated course (if published) and re-merge overrides at the end. Overrides
  // are filtered because mergeOverrides will splice them at their _position;
  // leaving them in the array first would create duplicates after merge.
  const overrideIdSet = readOverrideIdSet();
  const before = courses.length;
  courses = courses.filter(c => c.id !== recordId && !overrideIdSet.has(c.id) && !overrideIdSet.has(c.slug));
  const wasPresent = before - courses.length > overrideIdSet.size;

  // Add updated course only if published. Drafts and archived stay removed.
  // This handles BOTH publish (status='published': re-add) AND un-publish
  // (status='draft'/'archived': leave removed) per the plan's contract.
  if (course.status !== 'published') {
    console.log(`Removed non-published course (status: ${course.status}): ${course.slug || course.id}`);
  } else {
    // status field is admin-mode-only (endpoint exposes it for the R5 guard
    // above); strip before persist to keep cache shape byte-equivalent to the
    // pre-D1 Airtable contract and prevent downstream code from branching on
    // a field that's already filtered upstream.
    delete course.status;
    courses.push(course);
    if (wasPresent) {
      console.log(`Updated course: ${course.slug || course.id}`);
    } else {
      console.warn(`WARN: appended new course (not in cache): ${course.slug || course.id}. If sortOrder is undefined, course will land at end of catalog.`);
    }
  }

  // Sort D1 courses by sortOrder so the catalog order is stable across
  // single-record updates (otherwise filter+push moves the updated course to
  // the end of the array).
  sortD1Courses(courses);

  // Re-merge overrides at their _position. Overrides have no sortOrder, so
  // they are spliced relative to the (now-sorted) D1 array indices.
  mergeOverrides(courses);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(courses, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
  console.log(`Wrote ${courses.length} courses to ${OUTPUT_PATH}`);
}

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

  const token = process.env.LIBRARY_BUILD_TOKEN;
  if (!token) {
    console.error('Error: LIBRARY_BUILD_TOKEN environment variable required');
    process.exit(1);
  }

  console.log('Fetching all published courses from D1...');
  let res;
  try {
    res = await fetchResponseWithRetry(COURSES_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error(`FATAL: courses API request failed after retries: ${err.message}`);
    console.error('Leaving courses.json untouched (no-op deploy).');
    process.exit(0);
  }

  if (res.status >= 500) {
    console.error(`FATAL: courses API returned ${res.status} after retries.`);
    console.error('Leaving courses.json untouched (no-op deploy).');
    process.exit(0);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Courses API ${res.status}: ${err}`);
  }

  const body = await res.json();
  if (!body.ok || !body.results) {
    throw new Error(`Courses API error: ${body.error || 'no results'}`);
  }
  const courses = body.results;
  console.log(`Fetched ${courses.length} published courses from D1`);

  // Strip status field — endpoint exposes it for the R5 status guard in
  // fetchSingle, but persisting it widens the courses.json contract beyond
  // what the pre-D1 Airtable shape carried. Downstream code (Astro pages,
  // override entries) doesn't read course.status; keep the cache shape tight.
  for (const course of courses) {
    delete course.status;
  }

  // Sort D1 courses by sortOrder before merging overrides (endpoint already
  // sorts but explicit sort here is defensive against future endpoint changes).
  sortD1Courses(courses);

  // Merge affiliate / externally-hosted courses (NOT in D1, source of truth
  // is courses-overrides.json). Without this, every full fetch silently wipes
  // them and 404s their /courses/<slug>/ URLs.
  mergeOverrides(courses);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(courses, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
  console.log(`Wrote ${courses.length} courses to ${OUTPUT_PATH}`);
}

function mergeOverrides(courses) {
  // Overrides are INSERT/REPLACE only — never PRUNE. If you remove an entry
  // from courses-overrides.json that previously slotted into the catalog, the
  // next full fetch will simply not re-insert it (D1 doesn't know about it
  // either), so it disappears from courses.json. But if a course was added
  // both as a D1 row AND an override (collision below), the override wins
  // forever until the override entry is deleted. Don't expect this function
  // to clean up stale state — it operates per-fetch from a clean D1 base.
  if (!existsSync(OVERRIDES_PATH)) {
    throw new Error(`FATAL: ${OVERRIDES_PATH} missing. NeoFertility (and any other affiliate / externally-hosted courses) cannot be merged. Without these, the build silently 404s their /courses/<slug>/ URLs. If the file was deleted intentionally, restore it from git or remove the affected courses from the catalog explicitly.`);
  }

  let overrides;
  try {
    overrides = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse ${OVERRIDES_PATH}: ${err.message}`);
  }
  if (!Array.isArray(overrides)) {
    throw new Error(`${OVERRIDES_PATH} must be a JSON array`);
  }

  console.log(`\nMerging ${overrides.length} override course(s)...`);
  for (const raw of overrides) {
    if (!raw || typeof raw !== 'object' || !raw.id || !raw.slug) {
      throw new Error(`Override entry missing required id/slug: ${JSON.stringify(raw)}`);
    }
    const position = Number.isInteger(raw._position) ? raw._position : courses.length;
    const entry = { ...raw };
    delete entry._position;

    const existingIndex = courses.findIndex(c => c.id === entry.id || c.slug === entry.slug);
    if (existingIndex >= 0) {
      console.warn(`  WARN: override ${entry.id} collides with D1 row at index ${existingIndex} — D1 data discarded. If the course has fully migrated to D1, remove the override entry from courses-overrides.json.`);
      courses[existingIndex] = entry;
    } else {
      const insertAt = Math.max(0, Math.min(position, courses.length));
      courses.splice(insertAt, 0, entry);
      console.log(`  ${entry.id}: inserted at index ${insertAt}`);
    }
  }
}

const recordId = process.env.RECORD_ID;
const main = recordId ? () => fetchSingle(recordId) : fetchAll;

main().catch(err => {
  console.error(err);
  process.exit(1);
});
