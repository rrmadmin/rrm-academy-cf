/**
 * Course data layer for RRM Academy.
 * Loads course structure from cached JSON (fetched from Airtable at build time).
 *
 * Unlike articles/blog/FAQ, there is no live Airtable fallback —
 * courses.json must exist at build time (either from fetch-courses-data.mjs
 * or from the Actions cache).
 */

export interface CourseStep {
  id: string;
  title: string;
  type: 'video' | 'article' | 'quiz';
  streamUid?: string;
  duration?: number;
  content?: string;
}

export interface CourseSection {
  id: string;
  title: string;
  steps: CourseStep[];
}

export interface CourseSettings {
  stepOrder: 'fixed' | 'flexible';
  futureStepContent: 'hidden' | 'visible';
  videoWatchRequirement: number;
  autoplayNextVideo: boolean;
}

export interface CourseSeo {
  title: string;
  description: string;
  keywords: string[];
}

export interface CourseInstructor {
  name: string;
  role: string;
}

export interface Course {
  id: string;
  title: string;
  slug: string;
  description: string;
  shortDescription: string;
  image: string;
  imageAlt: string;
  priceCents: number;
  stripePriceId: string | null;
  isFree: boolean;
  hasCertificate: boolean;
  certificateQuizId?: string;
  selfPaced: boolean;
  accessType: string;
  participants: number;
  instructors: CourseInstructor[];
  includes?: string[];
  includedIn?: string[];
  settings: CourseSettings;
  seo: CourseSeo;
  sections: CourseSection[];
  faqs?: { question: string; answer: string }[];
}

export async function fetchAllCourses(): Promise<Course[]> {
  try {
    const cached = await import('../data/courses.json');
    const courses = (cached.default || cached) as Course[];
    console.log(`[courses] Loaded ${courses.length} courses from cache`);
    return courses;
  } catch (err: any) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' && err?.message?.includes?.('JSON')) {
      throw new Error(`courses.json exists but is corrupt: ${err.message}`);
    }
    throw new Error('courses.json not found. Run: npm run fetch-courses');
  }
}

export function getCourseBySlug(courses: Course[], slug: string): Course | undefined {
  return courses.find(c => c.slug === slug);
}

export function getCourseById(courses: Course[], id: string): Course | undefined {
  return courses.find(c => c.id === id);
}

export function getStepById(course: Course, stepId: string): CourseStep | undefined {
  for (const section of course.sections) {
    const step = section.steps.find(s => s.id === stepId);
    if (step) return step;
  }
  return undefined;
}

export function getTotalSteps(course: Course): number {
  return course.sections.reduce((sum, s) => sum + s.steps.length, 0);
}

export function getTotalDuration(course: Course): number {
  return course.sections.reduce(
    (sum, sec) => sum + sec.steps.reduce((s, step) => s + (step.duration || 0), 0),
    0
  );
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
