import { json, optionsResponse, getSessionIdFromCookie, validateSession } from '../auth/_shared.js';
import { log } from '../_log.js';
import { getCourse } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { courseId } = body;
    if (!courseId || typeof courseId !== 'string' || courseId.length > 100) {
      return json({ ok: false, error: 'courseId required' }, 400);
    }

    const course = getCourse(courseId);
    if (!course) return json({ ok: false, error: 'Course not found' }, 404);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: true, tracked: false });

    try {
      await db.prepare(
        'INSERT OR IGNORE INTO affiliate_clicks (user_id, course_id) VALUES (?, ?)'
      ).bind(session.userId, courseId).run();
    } catch (err) {
      log(env, waitUntil, 'courses', 'affiliate_click_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }

    log(env, waitUntil, 'courses', 'affiliate_click', 'ok', courseId, 0, 200);
    return json({ ok: true, tracked: true });
  } catch (err) {
    log(env, waitUntil, 'courses', 'affiliate_click_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
