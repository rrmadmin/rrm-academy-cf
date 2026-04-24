/**
 * Shared course utilities for CF Pages Functions.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 */
import coursesData from '../../../src/data/courses.json';
import { generateId } from '../auth/_shared.js';

// Index courses by id and slug for O(1) lookup
const coursesById = new Map(coursesData.map(c => [c.id, c]));
const coursesBySlug = new Map(coursesData.map(c => [c.slug, c]));

export function getCourse(courseId) {
  return coursesById.get(courseId) || null;
}

export function getCourseBySlug(slug) {
  return coursesBySlug.get(slug) || null;
}

export function getAllStepIds(courseId) {
  const course = getCourse(courseId);
  if (!course) return [];
  return course.sections.flatMap(s => s.steps.map(step => step.id));
}

export function getTotalSteps(courseId) {
  return getAllStepIds(courseId).length;
}

export function isValidStep(courseId, stepId) {
  return getAllStepIds(courseId).includes(stepId);
}

/**
 * Get course IDs that are included with a purchase of the given course.
 * e.g. Masterclass includes Long-Term Endo Management.
 * The `includes` field in courses.json uses slugs, so we resolve slug → id.
 */
export function getIncludedCourseIds(courseId) {
  const course = getCourse(courseId);
  if (!course?.includes) return [];
  return course.includes
    .map(slug => coursesBySlug.get(slug))
    .filter(Boolean)
    .map(c => c.id);
}

export const CERTIFICATE_MIN_SCORE = 80;

export function getCertificateQuizId(courseId) {
  const course = getCourse(courseId);
  return course?.certificateQuizId || null;
}

/**
 * Get the step ID that comes before the given step in course order.
 * Returns null if stepId is the first step or not found.
 */
export function getPreviousStepId(courseId, stepId) {
  const allSteps = getAllStepIds(courseId);
  const idx = allSteps.indexOf(stepId);
  if (idx <= 0) return null;
  return allSteps[idx - 1];
}

/**
 * If user is superadmin, silently auto-enroll in any course they access.
 * Creates an enrollment row so progress tracking works normally.
 */
export async function autoEnrollAdmin(db, userId, courseId) {
  const user = await db.prepare('SELECT role FROM user WHERE id = ?').bind(userId).first();
  if (user?.role !== 'superadmin') return;

  const courseObj = getCourse(courseId);
  if (courseObj?.isAffiliate) return;

  const id = generateId();
  await db.prepare(
    'INSERT OR IGNORE INTO enrollment (id, user_id, course_id) VALUES (?, ?, ?)'
  ).bind(id, userId, courseId).run();
}

export async function checkCourseCompletion(db, userId, courseId) {
  const course = getCourse(courseId);
  if (!course) return { courseCompleted: false, certificateIssued: false };

  const totalSteps = getTotalSteps(courseId);
  const { count } = await db.prepare(
    'SELECT COUNT(*) as count FROM step_progress WHERE user_id = ? AND course_id = ? AND completed = 1'
  ).bind(userId, courseId).first();

  let courseCompleted = false;
  let certificateIssued = false;

  if (totalSteps > 0 && count >= totalSteps) {
    await db.prepare(
      'UPDATE enrollment SET completed_at = datetime(\'now\') WHERE user_id = ? AND course_id = ? AND completed_at IS NULL'
    ).bind(userId, courseId).run();
    courseCompleted = true;

    if (course.hasCertificate) {
      const quizStepId = getCertificateQuizId(courseId);
      if (quizStepId) {
        const quiz = await db.prepare(
          'SELECT score FROM step_progress WHERE user_id = ? AND course_id = ? AND step_id = ? AND completed = 1'
        ).bind(userId, courseId, quizStepId).first();
        if (quiz?.score >= CERTIFICATE_MIN_SCORE) {
          await db.prepare(
            "UPDATE enrollment SET certificate_issued_at = datetime('now') WHERE user_id = ? AND course_id = ? AND certificate_issued_at IS NULL"
          ).bind(userId, courseId).run();
          certificateIssued = true;
        }
      }
    }
  }

  return { courseCompleted, certificateIssued };
}

/**
 * Returns true iff the given courseId corresponds to an affiliate course that
 * has a waitlistUrl (i.e. the course is currently in waitlist mode).
 */
export function isWaitlistCourse(courseId) {
  const course = getCourse(courseId);
  return !!(course?.isAffiliate && course?.waitlistUrl);
}

export { coursesData };
