import { json, optionsResponse } from '../../auth/_shared.js';
import { log } from '../../_log.js';

const VALID_STATUSES = new Set(['draft', 'published', 'archived']);
const VALID_ACCESS_TYPES = new Set(['public', 'private', 'members']);

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

async function fetchWithNested(db, id) {
  const [course, { results: sections }, { results: steps }] = await Promise.all([
    db.prepare('SELECT * FROM course WHERE id = ?').bind(id).first(),
    db.prepare('SELECT * FROM course_section WHERE course_id = ? ORDER BY sort_order ASC').bind(id).all(),
    db.prepare('SELECT * FROM course_step WHERE course_id = ? ORDER BY section_id, sort_order ASC').bind(id).all(),
  ]);

  if (!course) return null;
  return mapCourse(course, sections || [], steps || []);
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

  const id = context.params?.id;
  if (!id || typeof id !== 'string' || id.length > 100) {
    return json({ ok: false, error: 'Invalid id' }, 400);
  }

  try {
    const data = await fetchWithNested(env.DB, id);
    if (!data) return json({ ok: false, error: 'not_found' }, 404);
    return json({ ok: true, data });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'get_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  const id = context.params?.id;
  if (!id || typeof id !== 'string' || id.length > 100) {
    return json({ ok: false, error: 'Invalid id' }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  if (body.slug !== undefined) {
    if (typeof body.slug !== 'string' || !body.slug.trim()) {
      return json({ ok: false, error: 'slug_required' }, 400);
    }
    if (body.slug.length > 100) {
      return json({ ok: false, error: 'invalid_slug' }, 400);
    }
  }

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return json({ ok: false, error: 'title_required' }, 400);
    }
    if (body.title.length > 200) {
      return json({ ok: false, error: 'title_too_long' }, 400);
    }
  }

  if (body.description !== undefined && typeof body.description === 'string' && body.description.length > 50000) {
    return json({ ok: false, error: 'description_too_long' }, 400);
  }
  if (body.shortDescription !== undefined && typeof body.shortDescription === 'string' && body.shortDescription.length > 50000) {
    return json({ ok: false, error: 'short_description_too_long' }, 400);
  }
  if (body.image !== undefined && typeof body.image === 'string' && body.image.length > 500) {
    return json({ ok: false, error: 'image_too_long' }, 400);
  }
  if (body.imageAlt !== undefined && typeof body.imageAlt === 'string' && body.imageAlt.length > 500) {
    return json({ ok: false, error: 'image_alt_too_long' }, 400);
  }
  if (body.stripePriceId !== undefined && typeof body.stripePriceId === 'string' && body.stripePriceId.length > 100) {
    return json({ ok: false, error: 'stripe_price_id_too_long' }, 400);
  }

  if (body.priceCents !== undefined) {
    if (!Number.isInteger(body.priceCents) || body.priceCents < 0 || body.priceCents > 999999) {
      return json({ ok: false, error: 'invalid_price_cents' }, 400);
    }
  }

  if (body.participants !== undefined && (!Number.isInteger(body.participants) || body.participants < 0 || body.participants > 1000000)) {
    return json({ ok: false, error: 'invalid_participants' }, 400);
  }

  if (body.accessType !== undefined && !VALID_ACCESS_TYPES.has(body.accessType)) {
    return json({ ok: false, error: 'invalid_access_type' }, 400);
  }

  if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
    return json({ ok: false, error: 'invalid_status' }, 400);
  }

  if (body.instructors !== undefined && !Array.isArray(body.instructors)) {
    return json({ ok: false, error: 'instructors_must_be_array' }, 400);
  }
  if (body.includes !== undefined && !Array.isArray(body.includes)) {
    return json({ ok: false, error: 'includes_must_be_array' }, 400);
  }
  if (body.includedIn !== undefined && !Array.isArray(body.includedIn)) {
    return json({ ok: false, error: 'included_in_must_be_array' }, 400);
  }
  if (body.faqs !== undefined && !Array.isArray(body.faqs)) {
    return json({ ok: false, error: 'faqs_must_be_array' }, 400);
  }
  if (body.settings !== undefined && (typeof body.settings !== 'object' || Array.isArray(body.settings) || body.settings === null)) {
    return json({ ok: false, error: 'settings_must_be_object' }, 400);
  }
  if (body.seo !== undefined && (typeof body.seo !== 'object' || Array.isArray(body.seo) || body.seo === null)) {
    return json({ ok: false, error: 'seo_must_be_object' }, 400);
  }

  if (body.certificateQuizId !== undefined && body.certificateQuizId !== null) {
    const stepCheck = await (async () => {
      try {
        return await env.DB.prepare(
          "SELECT id FROM course_step WHERE id = ? AND course_id = ? AND status = 'published' AND type = 'quiz'"
        ).bind(body.certificateQuizId, id).first();
      } catch {
        return null;
      }
    })();
    if (!stepCheck) {
      return json({ ok: false, error: 'invalid_certificate_quiz_step_id' }, 400);
    }
  }

  const FIELD_MAP = {
    slug: 'slug',
    title: 'title',
    description: 'description',
    shortDescription: 'short_description',
    image: 'image_url',
    imageAlt: 'image_alt',
    priceCents: 'price_cents',
    stripePriceId: 'stripe_price_id',
    accessType: 'access_type',
    status: 'status',
    sortOrder: 'sort_order',
    participants: 'participants',
  };

  const BOOL_FIELDS = {
    isFree: 'is_free',
    hasCertificate: 'has_certificate',
    selfPaced: 'self_paced',
    comingSoon: 'coming_soon',
  };

  const JSON_FIELDS = {
    instructors: 'instructors_json',
    includes: 'includes_json',
    includedIn: 'included_in_json',
    settings: 'settings_json',
    seo: 'seo_json',
    faqs: 'faqs_json',
  };

  const setClauses = [];
  const bindings = [];

  for (const [bodyKey, colName] of Object.entries(FIELD_MAP)) {
    if (body[bodyKey] !== undefined) {
      setClauses.push(`${colName} = ?`);
      bindings.push(body[bodyKey]);
    }
  }

  for (const [bodyKey, colName] of Object.entries(BOOL_FIELDS)) {
    if (body[bodyKey] !== undefined) {
      setClauses.push(`${colName} = ?`);
      bindings.push(bool(body[bodyKey]));
    }
  }

  for (const [bodyKey, colName] of Object.entries(JSON_FIELDS)) {
    if (body[bodyKey] !== undefined) {
      setClauses.push(`${colName} = ?`);
      bindings.push(JSON.stringify(body[bodyKey]));
    }
  }

  if (body.certificateQuizId !== undefined) {
    setClauses.push('certificate_quiz_step_id = ?');
    bindings.push(body.certificateQuizId ?? null);
  }

  if (setClauses.length === 0) {
    return json({ ok: false, error: 'no_fields_provided' }, 400);
  }

  setClauses.push("updated_at = datetime('now')");
  bindings.push(id);

  try {
    const result = await env.DB.prepare(
      `UPDATE course SET ${setClauses.join(', ')} WHERE id = ?`
    ).bind(...bindings).run();

    if (result.meta.changes === 0) {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    const data = await fetchWithNested(env.DB, id);
    return json({ ok: true, data });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return json({ ok: false, error: 'slug_already_exists' }, 409);
    }
    log(env, waitUntil, 'admin-courses', 'update_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestDelete(context) {
  const { env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  const id = context.params?.id;
  if (!id || typeof id !== 'string' || id.length > 100) {
    return json({ ok: false, error: 'Invalid id' }, 400);
  }

  try {
    const existing = await env.DB.prepare('SELECT id, slug FROM course WHERE id = ?').bind(id).first();
    if (!existing) return json({ ok: false, error: 'not_found' }, 404);

    const [
      { results: enrollmentRows },
      { results: progressRows },
      { results: quizRows },
      { results: commentRows },
      { results: clickRows },
      { results: waitlistRows },
    ] = await Promise.all([
      env.DB.prepare('SELECT id FROM enrollment WHERE course_id = ? LIMIT 1').bind(id).all(),
      env.DB.prepare('SELECT id FROM step_progress WHERE course_id = ? LIMIT 1').bind(id).all(),
      env.DB.prepare('SELECT id FROM quiz_response WHERE course_id = ? LIMIT 1').bind(id).all(),
      env.DB.prepare('SELECT id FROM lesson_comment WHERE course_id = ? LIMIT 1').bind(id).all(),
      env.DB.prepare('SELECT user_id FROM affiliate_clicks WHERE course_id = ? LIMIT 1').bind(id).all(),
      env.DB.prepare('SELECT id FROM course_waitlist WHERE course_id = ? LIMIT 1').bind(id).all(),
    ]);

    const tables = [];
    if (enrollmentRows?.length > 0) tables.push('enrollment');
    if (progressRows?.length > 0) tables.push('step_progress');
    if (quizRows?.length > 0) tables.push('quiz_response');
    if (commentRows?.length > 0) tables.push('lesson_comment');
    if (clickRows?.length > 0) tables.push('affiliate_clicks');
    if (waitlistRows?.length > 0) tables.push('course_waitlist');

    if (tables.length > 0) {
      return json({ ok: false, error: 'references_exist', detail: { tables } }, 409);
    }

    const includesRefs = await env.DB.prepare(
      "SELECT id FROM course WHERE id != ? AND (includes_json LIKE '%\"' || ? || '\"%' OR included_in_json LIKE '%\"' || ? || '\"%' OR includes_json LIKE '%\"' || ? || '\"%' OR included_in_json LIKE '%\"' || ? || '\"%') LIMIT 1"
    ).bind(id, id, id, existing.slug, existing.slug).first();
    if (includesRefs) {
      return json({ ok: false, error: 'references_exist', detail: 'Another course includes this one' }, 409);
    }

    await env.DB.batch([
      env.DB.prepare('DELETE FROM course_step WHERE course_id = ?').bind(id),
      env.DB.prepare('DELETE FROM course_section WHERE course_id = ?').bind(id),
      env.DB.prepare('DELETE FROM course WHERE id = ?').bind(id),
    ]);

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
