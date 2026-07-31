/**
 * Fixtures for the admin course-structure tree:
 *   course -> course_section -> course_step -> step_rendition / attachments.
 *
 * Every CRUD assertion in the suites that use this file reads the row back out
 * of a REAL SQLite engine (test/_d1-sqlite.mjs), built from the committed
 * schema.sql. mockDB() from _helpers.js matches SQL by substring and returns
 * canned rows, so it can neither create a UNIQUE-constraint conflict nor prove
 * that a sort_order actually moved; it is used here ONLY through throwingD1()
 * below, as a stand-in for "D1 threw".
 *
 * The seeded tree deliberately contains TWO courses so every handler can be
 * probed for the IDOR case: a section or step id that belongs to course-b must
 * not be reachable through the course-a path parameter.
 */
import { sqliteD1 } from './_d1-sqlite.mjs';

export const R2_PUBLIC_HOST = 'https://pub-4af88159ce884265baba8fb4f3470625.r2.dev/';

/**
 * course-a
 *   sec-a1 (sort 0)  -> step-a1 (article, sort 0), step-a2 (video, sort 1)
 *   sec-a2 (sort 1)  -> step-a3 (quiz, sort 0)
 * course-b
 *   sec-b1 (sort 0)  -> step-b1 (article, sort 0)
 */
export function seedTree(s) {
  const course = (id, slug) =>
    s.prepare('INSERT INTO course (id, slug, title, status) VALUES (?,?,?,?)').run(id, slug, `Course ${id}`, 'published');
  const section = (id, courseId, sort) =>
    s.prepare('INSERT INTO course_section (id, course_id, title, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(id, courseId, `Section ${id}`, sort, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
  const step = (id, sectionId, courseId, type, sort, extra = {}) =>
    s.prepare(`INSERT INTO course_step
        (id, section_id, course_id, title, type, stream_uid, duration_seconds, sort_order, attachments_json, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id, sectionId, courseId, `Step ${id}`, type,
        extra.streamUid ?? null, extra.duration ?? null, sort,
        extra.attachmentsJson ?? null, extra.status ?? 'published',
        '2026-01-01 00:00:00', '2026-01-01 00:00:00',
      );

  course('course-a', 'course-a');
  course('course-b', 'course-b');
  section('sec-a1', 'course-a', 0);
  section('sec-a2', 'course-a', 1);
  section('sec-b1', 'course-b', 0);
  step('step-a1', 'sec-a1', 'course-a', 'article', 0);
  step('step-a2', 'sec-a1', 'course-a', 'video', 1, { streamUid: 'uid-a2', duration: 120 });
  step('step-a3', 'sec-a2', 'course-a', 'quiz', 0);
  step('step-b1', 'sec-b1', 'course-b', 'article', 0);
}

/** A seeded engine-backed D1. `extraSeed` runs after the base tree. */
export function treeDb({ extraSeed, interleave } = {}) {
  return sqliteD1({
    interleave,
    seed(s) {
      seedTree(s);
      if (extraSeed) extraSeed(s);
    },
  });
}

/** Raw-handle helpers so assertions read rows back out of the real engine. */
export const readSection = (db, id) =>
  db._sqlite.prepare('SELECT * FROM course_section WHERE id = ?').get(id) ?? null;
export const readStep = (db, id) =>
  db._sqlite.prepare('SELECT * FROM course_step WHERE id = ?').get(id) ?? null;
export const readRendition = (db, stepId, format) =>
  db._sqlite.prepare('SELECT * FROM step_rendition WHERE step_id = ? AND format = ?').get(stepId, format) ?? null;
export const sectionOrder = (db, courseId) =>
  db._sqlite.prepare('SELECT id, sort_order FROM course_section WHERE course_id = ? ORDER BY sort_order ASC, id ASC')
    .all(courseId).map((r) => ({ id: r.id, sortOrder: r.sort_order }));
export const stepOrder = (db, sectionId) =>
  db._sqlite.prepare('SELECT id, sort_order FROM course_step WHERE section_id = ? ORDER BY sort_order ASC, id ASC')
    .all(sectionId).map((r) => ({ id: r.id, sortOrder: r.sort_order }));
export const attachmentsOf = (db, stepId) => {
  const row = readStep(db, stepId);
  if (!row?.attachments_json) return null;
  return JSON.parse(row.attachments_json);
};

/**
 * Wraps an engine-backed D1 so statements matching `needle` throw instead of
 * executing. This is the "D1 threw" stub the harness header asks for: a network
 * class failure the SQLite engine cannot produce, while every other statement in
 * the same handler still runs for real.
 */
export function throwingD1(db, needle, message = 'D1_ERROR: connection lost') {
  const boom = () => { throw new Error(message); };
  return {
    _calls: db._calls,
    _sqlite: db._sqlite,
    prepare(sql) {
      const real = db.prepare(sql);
      if (!sql.includes(needle)) return real;
      return {
        _sql: sql,
        _bindings: [],
        _throws: true,
        bind(...args) { this._bindings = args; return this; },
        async first() { boom(); },
        async all() { boom(); },
        async run() { boom(); },
      };
    },
    async batch(stmts) {
      if (stmts.some((s) => s._throws || s._sql.includes(needle))) boom();
      return db.batch(stmts);
    },
    close() { db.close(); },
  };
}

/** R2 stub that records writes and deletes, and can fail either operation. */
export function mockR2({ failPut = false, failDeleteKey = null } = {}) {
  const puts = [];
  const deleted = [];
  return {
    puts,
    deleted,
    async put(key, _body, opts) {
      if (failPut) throw new Error('R2 put failed');
      puts.push({ key, contentType: opts?.httpMetadata?.contentType ?? null });
      return { key };
    },
    async delete(key) {
      if (failDeleteKey !== null && (failDeleteKey === true || failDeleteKey === key)) {
        throw new Error(`R2 delete failed for ${key}`);
      }
      deleted.push(key);
    },
  };
}

/** Analytics Engine stub that records what log() emitted. */
export function capturingEvents() {
  const points = [];
  return {
    points,
    writeDataPoint(p) { points.push(p); },
    actions() { return points.map((p) => p.blobs[2]); },
  };
}

/** waitUntil that both collects and can be drained. */
export function collectingWaitUntil() {
  const promises = [];
  const fn = (p) => promises.push(p);
  fn.promises = promises;
  return fn;
}

export async function drain(waitUntil) {
  await Promise.allSettled(waitUntil.promises.slice());
}

/**
 * Context for an admin course-structure handler.
 *
 * `user: null` models an anonymous caller (the admin _middleware leaves
 * context.data.user undefined when the session cookie is absent or invalid).
 */
export function ctx({
  db,
  params = {},
  method = 'POST',
  body,
  rawBody,
  role = 'admin',
  user = undefined,
  r2 = undefined,
  url = 'https://rrmacademy.org/api/admin/courses/course-a/x',
  request,
  waitUntil,
  events,
} = {}) {
  const ev = events ?? capturingEvents();
  const env = { DB: db, EVENTS: ev };
  if (r2 !== undefined) env.R2_ASSETS = r2;
  const req = request ?? {
    method,
    url,
    headers: { get: () => null },
    async json() {
      if (rawBody !== undefined) return JSON.parse(rawBody);
      if (body === undefined) throw new SyntaxError('No body provided');
      return body;
    },
  };
  const data = user === null ? {} : { user: user ?? { id: 'admin-1', role } };
  return {
    request: req,
    env,
    params,
    data,
    waitUntil: waitUntil ?? collectingWaitUntil(),
    events: ev,
  };
}

/** Reads a handler Response into { status, body }. */
export async function read(res) {
  return { status: res.status, body: await res.json() };
}

/** Minimal File-like for the multipart attachment upload path. */
export function mockFile({ name = 'notes.pdf', type = 'application/pdf', size = 2048 } = {}) {
  return {
    name,
    type,
    size,
    stream() { return `stream:${name}`; },
  };
}

/** Request whose formData() answers from a plain object. */
export function formRequest(fields, { url = 'https://rrmacademy.org/api/admin/courses/course-a/attachments', throwOnFormData = false } = {}) {
  const map = new Map(Object.entries(fields));
  return {
    method: 'POST',
    url,
    headers: { get: () => null },
    async formData() {
      if (throwOnFormData) throw new TypeError('Could not parse content as FormData');
      return { get: (k) => (map.has(k) ? map.get(k) : null) };
    },
  };
}
