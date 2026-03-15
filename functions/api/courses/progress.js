/**
 * GET  /api/courses/progress          — all enrollments + summary for current user
 * GET  /api/courses/progress?courseId= — detailed step progress for one course
 * PATCH /api/courses/progress          — save step progress (position, completion, score)
 *
 * All endpoints require authentication.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { getCourse, getTotalSteps, isValidStep, getPreviousStepId, autoEnrollAdmin, checkCourseCompletion } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

// --- GET: read progress ---

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const url = new URL(request.url);
    const courseId = url.searchParams.get('courseId');

    if (courseId) {
      return getDetailedProgress(db, session.userId, courseId);
    }
    return getProgressSummary(db, session.userId);
  } catch (err) {
    log(env, waitUntil, 'courses', 'progress_error', 'error', `GET: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

/**
 * Summary: all enrollments with completion counts.
 * Used by account dashboard / "My Courses".
 */
async function getProgressSummary(db, userId) {
  const enrollments = await db.prepare(`
    SELECT e.course_id, e.enrolled_at, e.completed_at, e.certificate_issued_at,
      (SELECT COUNT(*) FROM step_progress sp
       WHERE sp.user_id = e.user_id AND sp.course_id = e.course_id AND sp.completed = 1
      ) as completed_steps
    FROM enrollment e
    WHERE e.user_id = ?
    ORDER BY e.enrolled_at DESC
  `).bind(userId).all();

  const courses = enrollments.results.map(e => ({
    courseId: e.course_id,
    enrolledAt: e.enrolled_at,
    completedAt: e.completed_at,
    certificateIssuedAt: e.certificate_issued_at,
    completedSteps: e.completed_steps,
    totalSteps: getTotalSteps(e.course_id),
  }));

  return json({ ok: true, courses });
}

/**
 * Detailed: full step-by-step progress for one course.
 * Used by course player page.
 */
async function getDetailedProgress(db, userId, courseId) {
  const course = getCourse(courseId);
  if (!course) return json({ ok: false, error: 'Course not found' }, 404);

  // Superadmin: auto-enroll on first access so progress tracking works
  await autoEnrollAdmin(db, userId, courseId);

  // Verify enrolled
  const enrollment = await db.prepare(
    'SELECT id, enrolled_at, completed_at, certificate_issued_at FROM enrollment WHERE user_id = ? AND course_id = ?'
  ).bind(userId, courseId).first();
  if (!enrollment) return json({ ok: false, error: 'Not enrolled' }, 403);

  // Get all step progress
  const steps = await db.prepare(
    'SELECT step_id, completed, score, last_position_seconds, updated_at FROM step_progress WHERE user_id = ? AND course_id = ?'
  ).bind(userId, courseId).all();

  const stepMap = {};
  for (const s of steps.results) {
    stepMap[s.step_id] = {
      completed: !!s.completed,
      score: s.score,
      lastPositionSeconds: s.last_position_seconds,
      updatedAt: s.updated_at,
    };
  }

  return json({
    ok: true,
    enrollment: {
      enrolledAt: enrollment.enrolled_at,
      completedAt: enrollment.completed_at,
      certificateIssuedAt: enrollment.certificate_issued_at,
    },
    steps: stepMap,
  });
}

// --- PATCH: save progress ---

export async function onRequestPatch({ request, env, waitUntil }) {
  try {
    return await handleProgressUpdate(request, env);
  } catch (err) {
    log(env, waitUntil, 'courses', 'progress_error', 'error', `PATCH: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

async function handleProgressUpdate(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(db, sessionId);
  if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  const { courseId, stepId, completed, score, lastPositionSeconds } = body;
  if (!courseId || !stepId) {
    return json({ ok: false, error: 'courseId and stepId required' }, 400);
  }
  if (score !== undefined && (typeof score !== 'number' || score < 0 || score > 100)) {
    return json({ ok: false, error: 'score must be a number 0-100' }, 400);
  }
  if (lastPositionSeconds !== undefined && (typeof lastPositionSeconds !== 'number' || lastPositionSeconds < 0 || lastPositionSeconds > 86400)) {
    return json({ ok: false, error: 'lastPositionSeconds must be a number 0-86400' }, 400);
  }

  // Validate course and step exist
  const course = getCourse(courseId);
  if (!course) return json({ ok: false, error: 'Course not found' }, 404);
  if (!isValidStep(courseId, stepId)) return json({ ok: false, error: 'Invalid step' }, 400);

  // Superadmin: auto-enroll on first access
  await autoEnrollAdmin(db, session.userId, courseId);

  // Verify enrolled
  const enrollment = await db.prepare(
    'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ?'
  ).bind(session.userId, courseId).first();
  if (!enrollment) return json({ ok: false, error: 'Not enrolled' }, 403);

  // Step locking: enforce sequential order for fixed-order courses
  if (course.settings?.stepOrder === 'fixed') {
    const prevStepId = getPreviousStepId(courseId, stepId);
    if (prevStepId) {
      const prev = await db.prepare(
        'SELECT completed FROM step_progress WHERE user_id = ? AND course_id = ? AND step_id = ?'
      ).bind(session.userId, courseId, prevStepId).first();
      if (!prev?.completed) {
        return json({ ok: false, error: 'Previous step not completed' }, 403);
      }
    }
  }

  // Upsert step progress.
  // completed: monotonic (once true, stays true via MAX).
  // score/position: update only when provided (CASE WHEN preserves existing).
  const completedVal = completed ? 1 : 0;
  const scoreVal = score ?? null;
  const positionVal = lastPositionSeconds ?? null;

  await db.prepare(`
    INSERT INTO step_progress (user_id, course_id, step_id, completed, score, last_position_seconds, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, 0), datetime('now'))
    ON CONFLICT(user_id, course_id, step_id) DO UPDATE SET
      completed = MAX(step_progress.completed, ?4),
      score = CASE WHEN ?5 IS NOT NULL THEN ?5 ELSE step_progress.score END,
      last_position_seconds = CASE WHEN ?6 IS NOT NULL THEN ?6 ELSE step_progress.last_position_seconds END,
      updated_at = datetime('now')
  `).bind(session.userId, courseId, stepId, completedVal, scoreVal, positionVal).run();

  let courseCompleted = false;
  let certificateIssued = false;
  if (completed) {
    ({ courseCompleted, certificateIssued } = await checkCourseCompletion(db, session.userId, courseId));
  }

  return json({ ok: true, courseCompleted, certificateIssued });
}
