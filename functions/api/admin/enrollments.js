import { json, optionsResponse, requireSuperAdmin } from '../auth/_shared.js';
import { log } from '../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireSuperAdmin(request, env.DB);
    if (auth instanceof Response) return auth;

    if (!env.DB) {
      return json({ ok: false, error: 'Database unavailable' }, 503);
    }

    const url = new URL(request.url);
    const view = url.searchParams.get('view') || 'summary';

    if (view === 'summary') return handleSummary(env.DB);
    if (view === 'list') return handleList(url, env.DB, env);

    return json({ ok: false, error: 'Invalid view. Must be summary or list.' }, 400);
  } catch (err) {
    console.error('Enrollments admin error:', err);
    return json({ ok: false, error: 'Failed to fetch enrollment data' }, 500);
  }
}

async function handleSummary(db) {
  try {
    const totals = await db
      .prepare(
        `SELECT COUNT(*) as total_enrollments,
           COUNT(DISTINCT e.user_id) as unique_students,
           SUM(CASE WHEN e.enrolled_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as last_30d,
           SUM(CASE WHEN e.enrolled_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as last_7d
         FROM enrollment e`
      )
      .first();

    const byCourseRows = await db
      .prepare(
        `SELECT e.course_id,
           COUNT(*) as total,
           SUM(CASE WHEN e.enrolled_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as last_30d,
           SUM(CASE WHEN e.enrolled_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as last_7d,
           SUM(CASE WHEN e.completed_at IS NOT NULL THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN e.stripe_payment_intent IS NOT NULL THEN 1 ELSE 0 END) as paid
         FROM enrollment e
         GROUP BY e.course_id
         ORDER BY total DESC`
      )
      .all();

    return json({
      ok: true,
      data: {
        totals: {
          total_enrollments: totals?.total_enrollments ?? 0,
          unique_students: totals?.unique_students ?? 0,
          last_30d: totals?.last_30d ?? 0,
          last_7d: totals?.last_7d ?? 0,
        },
        by_course: byCourseRows.results ?? [],
      },
    });
  } catch (err) {
    console.error('Enrollments summary error:', err);
    return json({ ok: false, error: 'Database error' }, 500);
  }
}

async function handleList(url, db, env) {
  const rawPage = parseInt(url.searchParams.get('page') || '1', 10);
  const page = rawPage >= 1 ? rawPage : 1;

  const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = rawLimit >= 1 && rawLimit <= 200 ? rawLimit : 50;

  const offset = (page - 1) * limit;

  const rawCourseId = url.searchParams.get('course_id') || '';
  const courseId =
    typeof rawCourseId === 'string' && rawCourseId.length > 0 && rawCourseId.length <= 200
      ? rawCourseId
      : null;

  try {
    const countRow = courseId
      ? await db
          .prepare('SELECT COUNT(*) as total FROM enrollment e WHERE e.course_id = ?')
          .bind(courseId)
          .first()
      : await db.prepare('SELECT COUNT(*) as total FROM enrollment e').first();

    const total = countRow?.total ?? 0;

    const rows = courseId
      ? await db
          .prepare(
            `SELECT e.id, e.course_id, e.enrolled_at, e.stripe_payment_intent, e.completed_at,
                    u.email, u.name
             FROM enrollment e
             JOIN user u ON e.user_id = u.id
             WHERE e.course_id = ?
             ORDER BY e.enrolled_at DESC
             LIMIT ? OFFSET ?`
          )
          .bind(courseId, limit, offset)
          .all()
      : await db
          .prepare(
            `SELECT e.id, e.course_id, e.enrolled_at, e.stripe_payment_intent, e.completed_at,
                    u.email, u.name
             FROM enrollment e
             JOIN user u ON e.user_id = u.id
             ORDER BY e.enrolled_at DESC
             LIMIT ? OFFSET ?`
          )
          .bind(limit, offset)
          .all();

    return json({
      ok: true,
      data: {
        enrollments: rows.results ?? [],
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Enrollments list error:', err);
    log(env, null, 'admin', 'enrollments_list_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Database error' }, 500);
  }
}
