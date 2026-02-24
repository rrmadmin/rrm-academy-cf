/**
 * Shared course utilities for CF Pages Functions.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 */
import coursesData from '../../../src/data/courses.json';

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

export { coursesData };
