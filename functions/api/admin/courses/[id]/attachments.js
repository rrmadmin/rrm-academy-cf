import { json, optionsResponse } from '../../../auth/_shared.js';
import { log } from '../../../_log.js';

const R2_PUBLIC_HOST = 'https://pub-4af88159ce884265baba8fb4f3470625.r2.dev/';
const MAX_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function sanitizeName(raw) {
  let out = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) continue;
    if (ch === '/' || ch === '\\') continue;
    out += ch;
  }
  return out.trim();
}

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (!['superadmin', 'admin'].includes(user.role)) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) return json({ ok: false, error: 'server_misconfigured' }, 503);
  if (!env.R2_ASSETS) return json({ ok: false, error: 'server_misconfigured' }, 503);

  const courseId = context.params?.id;
  if (!courseId || typeof courseId !== 'string' || courseId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid_form_data' }, 400);
  }

  const stepId = formData.get('stepId');
  if (!stepId || typeof stepId !== 'string' || !stepId.trim()) {
    return json({ ok: false, error: 'invalid_step_id' }, 400);
  }
  if (stepId.length > 100) {
    return json({ ok: false, error: 'invalid_step_id' }, 400);
  }

  const file = formData.get('file');
  if (!file || !file.size) {
    return json({ ok: false, error: 'file_required' }, 400);
  }

  if (file.size > MAX_SIZE) {
    return json({ ok: false, error: 'file_too_large' }, 400);
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return json({ ok: false, error: 'unsupported_file_type' }, 400);
  }

  const rawName = formData.get('name') || file.name || 'attachment';
  if (typeof rawName !== 'string') {
    return json({ ok: false, error: 'invalid_name' }, 400);
  }
  const name = sanitizeName(rawName);
  if (!name) {
    return json({ ok: false, error: 'invalid_name' }, 400);
  }
  if (name.length > 200) {
    return json({ ok: false, error: 'invalid_name' }, 400);
  }

  let course;
  let step;
  try {
    [course, step] = await Promise.all([
      env.DB.prepare('SELECT id FROM course WHERE id = ?').bind(courseId).first(),
      env.DB.prepare(
        'SELECT id, attachments_json FROM course_step WHERE id = ? AND course_id = ?'
      ).bind(stepId.trim(), courseId).first(),
    ]);
  } catch (err) {
    log(env, waitUntil, 'admin-courses-attachments', 'db_lookup_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }

  if (!course) return json({ ok: false, error: 'course_not_found' }, 404);
  if (!step) return json({ ok: false, error: 'step_not_found' }, 404);

  const attachmentId = crypto.randomUUID().replace(/-/g, '');
  const key = `courses/${stepId.trim()}/${attachmentId}.${ext}`;
  const url = R2_PUBLIC_HOST + key;

  try {
    await env.R2_ASSETS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
  } catch (err) {
    log(env, waitUntil, 'admin-courses-attachments', 'r2_put_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }

  let attachments;
  try {
    const parsed = step.attachments_json ? JSON.parse(step.attachments_json) : [];
    attachments = Array.isArray(parsed) ? parsed : [];
  } catch {
    attachments = [];
  }

  const newEntry = { name, url, size: file.size, type: file.type };
  attachments.push(newEntry);

  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE course_step SET attachments_json = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(JSON.stringify(attachments), stepId.trim()),
    ]);
  } catch (err) {
    log(env, waitUntil, 'admin-courses-attachments', 'db_write_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }

  return json({ ok: true, data: newEntry }, 201);
}

export async function onRequestDelete(context) {
  const { request, env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (!['superadmin', 'admin'].includes(user.role)) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) return json({ ok: false, error: 'server_misconfigured' }, 503);
  if (!env.R2_ASSETS) return json({ ok: false, error: 'server_misconfigured' }, 503);

  const courseId = context.params?.id;
  if (!courseId || typeof courseId !== 'string' || courseId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { stepId, url } = body;

  if (!stepId || typeof stepId !== 'string' || !stepId.trim()) {
    return json({ ok: false, error: 'invalid_step_id' }, 400);
  }
  if (stepId.length > 100) {
    return json({ ok: false, error: 'invalid_step_id' }, 400);
  }

  if (!url || typeof url !== 'string' || !url.trim()) {
    return json({ ok: false, error: 'attachment_not_found' }, 400);
  }
  if (url.length > 2000) {
    return json({ ok: false, error: 'attachment_not_found' }, 400);
  }

  let course;
  let step;
  try {
    [course, step] = await Promise.all([
      env.DB.prepare('SELECT id FROM course WHERE id = ?').bind(courseId).first(),
      env.DB.prepare(
        'SELECT id, attachments_json FROM course_step WHERE id = ? AND course_id = ?'
      ).bind(stepId.trim(), courseId).first(),
    ]);
  } catch (err) {
    log(env, waitUntil, 'admin-courses-attachments', 'db_lookup_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }

  if (!course) return json({ ok: false, error: 'course_not_found' }, 404);
  if (!step) return json({ ok: false, error: 'step_not_found' }, 404);

  let attachments;
  try {
    const parsed = step.attachments_json ? JSON.parse(step.attachments_json) : [];
    attachments = Array.isArray(parsed) ? parsed : [];
  } catch {
    attachments = [];
  }

  const normalizedUrl = url.trim();
  const match = attachments.find(a => a.url === normalizedUrl);
  if (!match) {
    return json({ ok: false, error: 'attachment_not_found' }, 404);
  }

  const filtered = attachments.filter(a => a.url !== normalizedUrl);

  if (!normalizedUrl.startsWith(R2_PUBLIC_HOST)) {
    return json({ ok: false, error: 'attachment_not_found' }, 400);
  }
  const r2Key = normalizedUrl.slice(R2_PUBLIC_HOST.length);

  try {
    await env.R2_ASSETS.delete(r2Key);
  } catch (err) {
    log(env, waitUntil, 'admin-courses-attachments', 'r2_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE course_step SET attachments_json = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(JSON.stringify(filtered), stepId.trim()),
    ]);
  } catch (err) {
    log(env, waitUntil, 'admin-courses-attachments', 'db_write_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }

  return json({ ok: true });
}
