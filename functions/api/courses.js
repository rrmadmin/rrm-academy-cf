/**
 * GET /api/courses - Serve course data from D1.
 *
 * Auth: Bearer LIBRARY_BUILD_TOKEN (build-time fetch only, not public).
 *
 * Query params:
 *   ?id=<courseId>    - single course by ID (any status, for preview/rebuild).
 *                       Steps default to status='published'. Add ?preview=1 to
 *                       include draft/archived steps (explicit preview intent).
 *   (none)            - all published courses with sections + published steps,
 *                       sorted by sort_order ASC. Sections with no published
 *                       steps are omitted from output.
 */
import { json, optionsResponse, constantTimeEqual } from './auth/_shared.js';
import { log } from './_log.js';

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

  try {
    if (!env.LIBRARY_BUILD_TOKEN) {
      return json({ ok: false, error: 'Server misconfigured' }, 503);
    }

    const auth = request.headers.get('Authorization');
    if (!constantTimeEqual(auth, `Bearer ${env.LIBRARY_BUILD_TOKEN}`)) {
      return json({ ok: false, error: 'Unauthorized' }, 401);
    }

    if (!env.DB) {
      return json({ ok: false, error: 'Server misconfigured' }, 503);
    }

    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (id !== null && id !== '') {
      if (typeof id !== 'string' || id.length > 100) {
        return json({ ok: false, error: 'Invalid id' }, 400);
      }

      const preview = url.searchParams.get('preview') === '1';

      const [course, { results: sections }, { results: steps }] = await Promise.all([
        env.DB.prepare('SELECT * FROM course WHERE id = ?').bind(id).first(),
        env.DB.prepare('SELECT * FROM course_section WHERE course_id = ? ORDER BY sort_order ASC').bind(id).all(),
        preview
          ? env.DB.prepare('SELECT * FROM course_step WHERE course_id = ? ORDER BY section_id, sort_order ASC').bind(id).all()
          : env.DB.prepare("SELECT * FROM course_step WHERE course_id = ? AND status = 'published' ORDER BY section_id, sort_order ASC").bind(id).all(),
      ]);

      if (!course) {
        return json({ ok: false, error: 'not_found' }, 404);
      }

      return json({ ok: true, data: mapCourse(course, sections || [], steps || [], preview) });
    }

    const { results: courses } = await env.DB.prepare(
      "SELECT * FROM course WHERE status = 'published' ORDER BY sort_order ASC"
    ).all();

    if (!courses || courses.length === 0) {
      return json({ ok: true, results: [] });
    }

    const [{ results: allSections }, { results: allSteps }] = await Promise.all([
      env.DB.prepare(
        'SELECT s.* FROM course_section s JOIN course c ON s.course_id = c.id WHERE c.status = ? ORDER BY s.course_id, s.sort_order ASC'
      ).bind('published').all(),
      env.DB.prepare(
        "SELECT s.* FROM course_step s JOIN course c ON s.course_id = c.id WHERE c.status = ? AND s.status = 'published' ORDER BY s.section_id, s.sort_order ASC"
      ).bind('published').all(),
    ]);

    const sectionsByCourseId = groupBy(allSections || [], 'course_id');
    const stepsByCourseId = groupBy(allSteps || [], 'course_id');

    const results = courses.map(course => {
      const sections = sectionsByCourseId[course.id] || [];
      const stepsForCourse = stepsByCourseId[course.id] || [];
      return mapCourse(course, sections, stepsForCourse, false);
    });

    return json({ ok: true, results });
  } catch (err) {
    log(env, waitUntil, 'courses', 'list_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

function groupBy(rows, key) {
  const map = {};
  for (const row of rows) {
    const k = row[key];
    if (!map[k]) map[k] = [];
    map[k].push(row);
  }
  return map;
}

function mapCourse(c, sections, steps, preview) {
  const stepsBySectionId = groupBy(steps, 'section_id');

  let mappedSections = sections.map(sec => ({
    id: sec.id,
    title: sec.title,
    steps: (stepsBySectionId[sec.id] || []).map(mapStep),
  }));

  if (!preview) {
    mappedSections = mappedSections.filter(sec => sec.steps.length > 0);
  }

  const allStepIds = new Set(mappedSections.flatMap(sec => sec.steps.map(s => s.id)));

  const course = {
    id: c.id,
    slug: c.slug,
    title: c.title,
    description: c.description,
    shortDescription: c.short_description,
    image: c.image_url,
    imageAlt: c.image_alt,
    priceCents: c.price_cents,
    stripePriceId: c.stripe_price_id,
    isFree: !!Number(c.is_free),
    hasCertificate: !!Number(c.has_certificate),
    selfPaced: !!Number(c.self_paced),
    accessType: c.access_type,
    comingSoon: !!Number(c.coming_soon),
    participants: c.participants,
    instructors: parseArray(c.instructors_json),
    settings: parseObject(c.settings_json),
    seo: parseObject(c.seo_json),
    includes: parseArray(c.includes_json),
    includedIn: parseArray(c.included_in_json),
    faqs: parseArray(c.faqs_json),
    attachments: parseArray(c.attachments_json),
    status: c.status,
    sections: mappedSections,
  };

  if (c.certificate_quiz_step_id != null && allStepIds.has(c.certificate_quiz_step_id)) {
    course.certificateQuizId = c.certificate_quiz_step_id;
  }

  return course;
}

function mapStep(s) {
  const step = {
    id: s.id,
    title: s.title,
    type: s.type,
  };

  if (s.stream_uid != null) step.streamUid = s.stream_uid;
  if (s.duration_seconds != null) step.duration = s.duration_seconds;

  const attachments = parseArray(s.attachments_json);
  if (attachments.length > 0) step.attachments = attachments;

  return step;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseArray(value, fallback = []) {
  const parsed = parseJson(value, fallback);
  return Array.isArray(parsed) ? parsed : fallback;
}

function parseObject(value, fallback = {}) {
  const parsed = parseJson(value, fallback);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
}
