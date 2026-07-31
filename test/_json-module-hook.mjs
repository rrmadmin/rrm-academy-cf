/**
 * Makes the CF Pages Functions module graph importable under plain `node --test`.
 *
 * WHY THIS EXISTS
 * `functions/api/courses/_shared.js` does `import coursesData from
 * '../../../src/data/courses.json'` with no import attribute. Wrangler's esbuild
 * bundle accepts that; Node ESM does not (ERR_IMPORT_ATTRIBUTE_MISSING, the
 * attribute became mandatory in Node 22). On top of that, `src/data/courses.json`
 * is a build artifact and is gitignored, so a `npm ci && npm test` CI job does
 * not even have the file.
 *
 * Between them those two facts made `functions/api/stripe-webhook.js` and
 * `functions/api/billing/_webhook-checkout.js` IMPOSSIBLE to import in a unit
 * test -- which is why the previous stripe-webhook.test.js read them with
 * readFileSync and asserted on source TEXT, and why the whole billing webhook
 * cluster (1,956 lines) reported 0% coverage while looking tested.
 *
 * WHAT IT DOES
 * Registers synchronous module hooks (node:module registerHooks, Node >= 22.15)
 * that:
 *   1. supply `type: 'json'` for any .json module load, so the bare imports
 *      resolve exactly as they do in the bundler;
 *   2. serve a small deterministic FIXTURE for the gitignored build artifacts,
 *      always -- including on machines where the real file happens to exist --
 *      so a local run and a CI run load byte-identical data.
 *
 * This is test-only. It does not change what ships. The production fix (adding
 * `with { type: 'json' }` and committing a checked-in courses fixture) is a
 * separate change with deploy risk, deliberately not bundled into a test PR.
 *
 * Import this module for side effects BEFORE dynamically importing anything in
 * the functions/ graph:
 *
 *   import './_json-module-hook.mjs';
 *   const webhook = await import('../functions/api/stripe-webhook.js');
 */
import { registerHooks } from 'node:module';

/** Minimal course catalogue. Ids/slugs are fixture-owned, never real content. */
export const COURSE_FIXTURE = [
  {
    id: 'test-course-basic',
    slug: 'test-course-basic',
    title: 'Test Course: Basic',
    status: 'published',
    access_type: 'public',
    price: 4900,
    sections: [
      { id: 'sec-1', title: 'Section One', steps: [{ id: 'step-1', title: 'Step One', type: 'video' }] },
    ],
  },
  {
    id: 'test-course-bundle',
    slug: 'test-course-bundle',
    title: 'Test Course: Bundle',
    status: 'published',
    access_type: 'public',
    price: 19900,
    sections: [
      { id: 'sec-2', title: 'Section Two', steps: [{ id: 'step-2', title: 'Step Two', type: 'video' }] },
    ],
  },
  // ---------------------------------------------------------------------------
  // Added for the courses/progress + courses/quiz suites. Field NAMES here are
  // the ones the live build artifact actually uses (`accessType`,
  // `settings.stepOrder`, `hasCertificate`, `certificateQuizId`, `isAffiliate`,
  // `waitlistUrl`) -- verified against src/data/courses.json, where
  // neofertility-med-training carries settings.stepOrder='fixed' and
  // masterclass-endo-surgery carries hasCertificate + certificateQuizId.
  //
  // NOTE the two entries above use `access_type` (snake), which no consumer in
  // functions/ reads. Left as-is so this change stays additive; the two courses
  // below are the ones whose field names are load-bearing.
  {
    id: 'test-course-fixed',
    slug: 'test-course-fixed',
    title: 'Test Course: Fixed Order',
    status: 'published',
    accessType: 'members',
    hasCertificate: true,
    certificateQuizId: 'fx-step-3',
    settings: { stepOrder: 'fixed' },
    sections: [
      {
        id: 'fx-sec-1',
        title: 'Fixed Section',
        steps: [
          { id: 'fx-step-1', title: 'Lesson One', type: 'video' },
          { id: 'fx-step-2', title: 'Feedback', type: 'quiz' },
          { id: 'fx-step-3', title: 'Certificate Quiz', type: 'quiz' },
        ],
      },
    ],
  },
  {
    id: 'test-course-affiliate',
    slug: 'test-course-affiliate',
    title: 'Test Course: Affiliate',
    status: 'published',
    accessType: 'public',
    isAffiliate: true,
    waitlistUrl: 'https://example.invalid/waitlist',
    sections: [
      { id: 'af-sec-1', title: 'Affiliate Section', steps: [{ id: 'af-step-1', title: 'Intro', type: 'video' }] },
    ],
  },
  // ---------------------------------------------------------------------------
  // Added for the learner-path suites (courses/enroll, courses/certificate,
  // courses/waitlist, courses/_shared). Every entry below exists to put ONE
  // catalogue predicate at its boundary, because the predicates in
  // functions/api/courses/_shared.js and enroll.js branch on catalogue shape
  // rather than on database state:
  //   isFree / stripePriceId / priceCents -> the free-vs-Stripe fork in enroll.js
  //   comingSoon x accessType             -> the members exemption from the
  //                                          coming-soon block (enroll.js:78)
  //   isAffiliate x waitlistUrl           -> isWaitlistCourse(), which is the
  //                                          ONLY eligibility gate the waitlist
  //                                          endpoint has; all four corners of
  //                                          that pair are represented
  //   hasCertificate x certificateQuizId  -> the two arms of the certificate
  //                                          quiz-score requirement
  //   includes                            -> getIncludedCourseIds(), including
  //                                          an unresolvable slug so the
  //                                          .filter(Boolean) arm is real
  // Ids and slugs are fixture-owned and never appear in production data.
  {
    id: 'test-course-free',
    slug: 'test-course-free',
    title: 'Test Course: Free',
    status: 'published',
    accessType: 'public',
    isFree: true,
    priceCents: 0,
    sections: [
      { id: 'fr-sec-1', title: 'Free Section', steps: [{ id: 'fr-step-1', title: 'Only Step', type: 'video' }] },
    ],
  },
  {
    id: 'test-course-paid',
    slug: 'test-course-paid',
    title: 'Test Course: Paid',
    status: 'published',
    accessType: 'public',
    isFree: false,
    priceCents: 4900,
    stripePriceId: 'price_test_paid',
    sections: [
      { id: 'pd-sec-1', title: 'Paid Section', steps: [{ id: 'pd-step-1', title: 'Only Step', type: 'video' }] },
    ],
  },
  {
    // Paid, but with no priceCents, so the begin_checkout GA4 payload takes its
    // no-value arm. Same slug family as test-course-paid on purpose.
    id: 'test-course-paid-nofigure',
    slug: 'test-course-paid-nofigure',
    title: 'Test Course: Paid Without Price Figure',
    status: 'published',
    accessType: 'public',
    isFree: false,
    stripePriceId: 'price_test_nofigure',
    sections: [
      { id: 'pn-sec-1', title: 'Section', steps: [{ id: 'pn-step-1', title: 'Only Step', type: 'video' }] },
    ],
  },
  {
    id: 'test-course-free-bundle',
    slug: 'test-course-free-bundle',
    title: 'Test Course: Free Bundle',
    status: 'published',
    accessType: 'public',
    isFree: true,
    includes: ['test-course-free', 'slug-that-does-not-resolve'],
    sections: [
      { id: 'fb-sec-1', title: 'Bundle Section', steps: [{ id: 'fb-step-1', title: 'Only Step', type: 'video' }] },
    ],
  },
  {
    id: 'test-course-soon',
    slug: 'test-course-soon',
    title: 'Test Course: Coming Soon',
    status: 'published',
    accessType: 'public',
    isFree: true,
    comingSoon: true,
    sections: [
      { id: 'cs-sec-1', title: 'Section', steps: [{ id: 'cs-step-1', title: 'Only Step', type: 'video' }] },
    ],
  },
  {
    // comingSoon AND members: the members exemption means this one is NOT
    // blocked by the coming-soon gate, it falls through to requireMember().
    id: 'test-course-soon-members',
    slug: 'test-course-soon-members',
    title: 'Test Course: Coming Soon For Members',
    status: 'published',
    accessType: 'members',
    isFree: true,
    comingSoon: true,
    sections: [
      { id: 'sm-sec-1', title: 'Section', steps: [{ id: 'sm-step-1', title: 'Only Step', type: 'video' }] },
    ],
  },
  {
    id: 'test-course-members-free',
    slug: 'test-course-members-free',
    title: 'Test Course: Members',
    status: 'published',
    accessType: 'members',
    isFree: true,
    sections: [
      { id: 'mb-sec-1', title: 'Section', steps: [{ id: 'mb-step-1', title: 'Only Step', type: 'video' }] },
    ],
  },
  {
    id: 'test-course-cert',
    slug: 'test-course-cert',
    title: 'Test Course: Certificated',
    status: 'published',
    accessType: 'public',
    isFree: true,
    hasCertificate: true,
    certificateQuizId: 'ct-step-2',
    instructors: [{ name: 'Dr. Fixture Instructor' }],
    sections: [
      {
        id: 'ct-sec-1',
        title: 'Certificated Section',
        steps: [
          { id: 'ct-step-1', title: 'Lesson', type: 'video' },
          { id: 'ct-step-2', title: 'Final Quiz', type: 'quiz' },
        ],
      },
    ],
  },
  {
    // hasCertificate with NO certificateQuizId: the quiz-score requirement is
    // skipped entirely, so completion alone issues.
    id: 'test-course-cert-noquiz',
    slug: 'test-course-cert-noquiz',
    title: 'Test Course: Certificated Without Quiz',
    status: 'published',
    accessType: 'public',
    isFree: true,
    hasCertificate: true,
    sections: [
      { id: 'cn-sec-1', title: 'Section', steps: [{ id: 'cn-step-1', title: 'Only Step', type: 'video' }] },
    ],
  },
  {
    // Affiliate WITHOUT waitlistUrl: isWaitlistCourse() must be false.
    id: 'test-course-affiliate-open',
    slug: 'test-course-affiliate-open',
    title: 'Test Course: Affiliate Without Waitlist',
    status: 'published',
    accessType: 'public',
    isAffiliate: true,
    sections: [
      { id: 'ao-sec-1', title: 'Section', steps: [{ id: 'ao-step-1', title: 'Intro', type: 'video' }] },
    ],
  },
  {
    // waitlistUrl WITHOUT isAffiliate: isWaitlistCourse() must also be false.
    id: 'test-course-waitlisturl-only',
    slug: 'test-course-waitlisturl-only',
    title: 'Test Course: Waitlist URL Only',
    status: 'published',
    accessType: 'public',
    isFree: true,
    waitlistUrl: 'https://example.invalid/not-a-waitlist-course',
    sections: [
      { id: 'wo-sec-1', title: 'Section', steps: [{ id: 'wo-step-1', title: 'Intro', type: 'video' }] },
    ],
  },
];

/**
 * Static quiz content, the FALLBACK arm of getQuizContent() (D1 step_rendition
 * is read first). Shapes mirror the real src/data/quizzes.json: a scored `quiz`
 * with correctIndex per question, and a `questionnaire` carrying one of each
 * declared question type so every validation branch in courses/quiz.js has
 * something to run against.
 */
export const QUIZ_FIXTURE = {
  'fx-step-3': {
    type: 'quiz',
    title: 'Certificate Quiz',
    description: 'Scored, 80 to pass.',
    passingScore: 80,
    questions: [
      { id: 'q1', text: 'First?', options: ['a', 'b', 'c'], correctIndex: 1 },
      { id: 'q2', text: 'Second?', options: ['a', 'b'], correctIndex: 0 },
    ],
  },
  'fx-step-2': {
    type: 'questionnaire',
    title: 'Feedback',
    description: 'Not scored.',
    questions: [
      { id: 'fq1', text: 'How useful?', type: 'likert', scale: { min: 1, max: 5, labels: ['low', 'high'] } },
      { id: 'fq2', text: 'Which topics?', type: 'multiselect', options: ['endo', 'pcos', 'charting'] },
      { id: 'fq3', text: 'Anything else?', type: 'freetext' },
      { id: 'fq4', text: 'Untyped legacy question' },
    ],
  },
  'fx-step-empty': { type: 'quiz', title: 'Not written yet', questions: [] },
};

const FIXTURES = new Map([
  ['src/data/courses.json', COURSE_FIXTURE],
  ['src/data/quizzes.json', QUIZ_FIXTURE],
  ['src/data/og-index.json', {}],
]);

const REPO_ROOT = new URL('../', import.meta.url);
const fixtureByUrl = new Map(
  [...FIXTURES].map(([rel, value]) => [new URL(rel, REPO_ROOT).href, JSON.stringify(value)])
);

registerHooks({
  resolve(specifier, context, next) {
    // Short-circuit BEFORE the default resolver, which stats the file and
    // throws ERR_MODULE_NOT_FOUND. src/data/courses.json is gitignored, so on a
    // clean CI checkout it does not exist and a load-only hook never runs.
    // Verified by deleting the file locally and re-running the suite.
    if (specifier.endsWith('.json') && context.parentURL) {
      let href;
      try { href = new URL(specifier, context.parentURL).href; } catch { href = null; }
      if (href && fixtureByUrl.has(href)) {
        return { url: href, format: 'json', importAttributes: { type: 'json' }, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },

  load(url, context, next) {
    if (!url.endsWith('.json')) return next(url, context);
    const fixture = fixtureByUrl.get(url);
    if (fixture !== undefined) {
      return { format: 'json', source: fixture, shortCircuit: true };
    }
    // Real JSON file: pass through, but declare the attribute the source omitted.
    return next(url, { ...context, importAttributes: { type: 'json' } });
  },
});
