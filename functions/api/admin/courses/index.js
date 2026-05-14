import { json, optionsResponse } from '../../auth/_shared.js';
import { log } from '../../_log.js';

const VALID_STATUSES = new Set(['draft', 'published', 'archived']);
const VALID_ACCESS_TYPES = new Set(['public', 'private', 'members']);
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function onRequestOptions() {
  return optionsResponse();
}

function bool(v) {
  return (v === true || v === 1 || v === '1') ? 1 : 0;
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

function parseJson(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function parseArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function parseObject(value) {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function mapStep(s) {
  const step = {
    id: s.id,
    title: s.title,
    type: s.type,
    sortOrder: s.sort_order,
    status: s.status,
  };
  if (s.stream_uid != null) step.streamUid = s.stream_uid;
  if (s.duration_seconds != null) step.duration = s.duration_seconds;
  const attachments = parseArray(s.attachments_json);
  if (attachments.length > 0) step.attachments = attachments;
  return step;
}

function mapCourse(c, sections, steps) {
  const stepsBySectionId = groupBy(steps, 'section_id');

  const mappedSections = sections.map(sec => ({
    id: sec.id,
    title: sec.title,
    sortOrder: sec.sort_order,
    steps: (stepsBySectionId[sec.id] || []).map(mapStep),
  }));

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
    sortOrder: c.sort_order,
    status: c.status,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    sections: mappedSections,
  };

  if (c.certificate_quiz_step_id != null) {
    course.certificateQuizId = c.certificate_quiz_step_id;
  }

  return course;
}

export async function onRequestGet(context) {
  const { env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  try {
    const [{ results: courses }, { results: allSections }, { results: allSteps }] = await Promise.all([
      env.DB.prepare('SELECT * FROM course ORDER BY sort_order ASC').all(),
      env.DB.prepare('SELECT * FROM course_section ORDER BY sort_order ASC').all(),
      env.DB.prepare('SELECT * FROM course_step ORDER BY section_id, sort_order ASC').all(),
    ]);

    const sectionsByCourseId = groupBy(allSections || [], 'course_id');
    const stepsByCourseId = groupBy(allSteps || [], 'course_id');

    const results = (courses || []).map(course =>
      mapCourse(course, sectionsByCourseId[course.id] || [], stepsByCourseId[course.id] || [])
    );

    return json({ ok: true, results });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'list_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  const {
    id, slug, title, description, shortDescription, image, imageAlt,
    priceCents, stripePriceId, isFree, hasCertificate, certificateQuizId,
    selfPaced, accessType, comingSoon, participants, instructors, includes,
    includedIn, settings, seo, faqs, status, sortOrder,
  } = body;

  if (typeof id !== 'string' || !id.trim()) {
    return json({ ok: false, error: 'id_required' }, 400);
  }
  if (id.length > 80) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }
  if (!ID_PATTERN.test(id)) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  if (typeof slug !== 'string' || !slug.trim()) {
    return json({ ok: false, error: 'slug_required' }, 400);
  }
  if (slug.length > 100) {
    return json({ ok: false, error: 'invalid_slug' }, 400);
  }

  if (typeof title !== 'string' || !title.trim()) {
    return json({ ok: false, error: 'title_required' }, 400);
  }
  if (title.length > 200) {
    return json({ ok: false, error: 'title_too_long' }, 400);
  }

  if (description !== undefined && typeof description === 'string' && description.length > 50000) {
    return json({ ok: false, error: 'description_too_long' }, 400);
  }
  if (shortDescription !== undefined && typeof shortDescription === 'string' && shortDescription.length > 50000) {
    return json({ ok: false, error: 'short_description_too_long' }, 400);
  }
  if (image !== undefined && typeof image === 'string' && image.length > 500) {
    return json({ ok: false, error: 'image_too_long' }, 400);
  }
  if (imageAlt !== undefined && typeof imageAlt === 'string' && imageAlt.length > 500) {
    return json({ ok: false, error: 'image_alt_too_long' }, 400);
  }
  if (stripePriceId !== undefined && typeof stripePriceId === 'string' && stripePriceId.length > 100) {
    return json({ ok: false, error: 'stripe_price_id_too_long' }, 400);
  }

  if (priceCents !== undefined) {
    if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 999999) {
      return json({ ok: false, error: 'invalid_price_cents' }, 400);
    }
  }

  if (participants !== undefined && (!Number.isInteger(participants) || participants < 0 || participants > 1000000)) {
    return json({ ok: false, error: 'invalid_participants' }, 400);
  }

  const resolvedAccessType = accessType ?? 'public';
  if (!VALID_ACCESS_TYPES.has(resolvedAccessType)) {
    return json({ ok: false, error: 'invalid_access_type' }, 400);
  }

  const resolvedStatus = status ?? 'draft';
  if (!VALID_STATUSES.has(resolvedStatus)) {
    return json({ ok: false, error: 'invalid_status' }, 400);
  }

  if (instructors !== undefined && !Array.isArray(instructors)) {
    return json({ ok: false, error: 'instructors_must_be_array' }, 400);
  }
  if (includes !== undefined && !Array.isArray(includes)) {
    return json({ ok: false, error: 'includes_must_be_array' }, 400);
  }
  if (includedIn !== undefined && !Array.isArray(includedIn)) {
    return json({ ok: false, error: 'included_in_must_be_array' }, 400);
  }
  if (faqs !== undefined && !Array.isArray(faqs)) {
    return json({ ok: false, error: 'faqs_must_be_array' }, 400);
  }
  if (settings !== undefined && (typeof settings !== 'object' || Array.isArray(settings) || settings === null)) {
    return json({ ok: false, error: 'settings_must_be_object' }, 400);
  }
  if (seo !== undefined && (typeof seo !== 'object' || Array.isArray(seo) || seo === null)) {
    return json({ ok: false, error: 'seo_must_be_object' }, 400);
  }

  const resolvedSortOrder = typeof sortOrder === 'number' ? sortOrder : 0;

  try {
    await env.DB.prepare(
      `INSERT INTO course (id, slug, title, description, short_description, image_url, image_alt,
         price_cents, stripe_price_id, is_free, has_certificate, certificate_quiz_step_id,
         self_paced, access_type, coming_soon, participants, instructors_json, includes_json,
         included_in_json, settings_json, seo_json, faqs_json, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      slug.trim(),
      title.trim(),
      description ?? null,
      shortDescription ?? null,
      image ?? null,
      imageAlt ?? null,
      priceCents ?? 0,
      stripePriceId ?? null,
      bool(isFree),
      bool(hasCertificate),
      certificateQuizId ?? null,
      bool(selfPaced !== undefined ? selfPaced : true),
      resolvedAccessType,
      bool(comingSoon),
      typeof participants === 'number' ? participants : 0,
      instructors !== undefined ? JSON.stringify(instructors) : null,
      includes !== undefined ? JSON.stringify(includes) : null,
      includedIn !== undefined ? JSON.stringify(includedIn) : null,
      settings !== undefined ? JSON.stringify(settings) : null,
      seo !== undefined ? JSON.stringify(seo) : null,
      faqs !== undefined ? JSON.stringify(faqs) : null,
      resolvedSortOrder,
      resolvedStatus
    ).run();
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      if (err.message?.includes('course.id')) {
        return json({ ok: false, error: 'id_already_exists' }, 409);
      }
      return json({ ok: false, error: 'slug_already_exists' }, 409);
    }
    log(env, waitUntil, 'admin-courses', 'create_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }

  return json({ ok: true, data: { id, slug: slug.trim() } }, 201);
}
