/**
 * A PLAUSIBLE, WELL-FORMED BODY FOR EVERY WRITE ROUTE.
 *
 * Every case in the auth family sends one of these. That is deliberate and it
 * is the difference between a real test and a decorative one: a route that
 * parses its body BEFORE it checks the session answers 400 to an empty POST,
 * and a harness that sent `{}` would record that 400 as "refused" and never
 * discover whether the session check exists at all. Sending a body that would
 * SUCCEED if the caller were authorised means the only thing left that can
 * refuse the request is the gate under test.
 *
 * None of these bodies names a real person, a real price, or a real course.
 */

import {
  VICTIM_POST_ID, VICTIM_COMMENT_ID, SEEDED_COURSE_ID, NOBODYS_TOKEN,
} from '../targets.mjs';

const ATTACK_EMAIL = 'redteam-sender@redteam.example';

export const BODIES = Object.freeze({
  '/api/auth/profile': { name: 'Redteam Renamed' },
  '/api/auth/login': { email: ATTACK_EMAIL, password: 'Redteam-Wr0ng-Horse-Nope', turnstileToken: 'redteam-token' },
  '/api/auth/signup': { email: ATTACK_EMAIL, password: 'Redteam-Corr3ct-Horse', name: 'Redteam Signup', turnstileToken: 'redteam-token' },
  '/api/auth/logout': {},
  '/api/auth/forgot-password': { email: ATTACK_EMAIL, turnstileToken: 'redteam-token' },
  '/api/auth/reset-password': { token: NOBODYS_TOKEN, password: 'Redteam-Corr3ct-Horse' },
  '/api/auth/change-password': { currentPassword: 'Redteam-Corr3ct-Horse', newPassword: 'Redteam-N3w-Horse-Battery' },
  '/api/auth/resend-verification': { email: ATTACK_EMAIL },
  '/api/account/mcp-keys': { label: 'redteam key' },
  '/api/saved': { url: 'https://rrmacademy.org/library/', title: 'Redteam saved page' },
  '/api/ask/saved': { question: 'redteam question', answer: 'redteam answer' },
  '/api/billing/portal': {},
  '/api/community/posts': { type: 'discussion', title: 'Redteam post', body: 'Redteam body long enough to pass any minimum length check.' },
  '/api/community/posts#PATCH': { postId: VICTIM_POST_ID, title: 'Redteam edited', body: 'Redteam edited body, long enough to be a real edit.' },
  '/api/community/posts#DELETE': { postId: VICTIM_POST_ID },
  '/api/community/comments': { postId: VICTIM_POST_ID, content: 'Redteam comment body.' },
  '/api/community/comments#DELETE': { commentId: VICTIM_COMMENT_ID },
  '/api/community/reactions': { targetType: 'post', targetId: VICTIM_POST_ID, emoji: '👍' },
  '/api/community/flags': { targetType: 'post', targetId: VICTIM_POST_ID, reason: 'spam' },
  '/api/community/ban': { userId: 'u_victim', reason: 'redteam' },
  '/api/community/unban': { userId: 'u_victim' },
  '/api/community/upload': {},
  '/api/courses/enroll': { courseId: SEEDED_COURSE_ID },
  '/api/admin/faqs': { question: 'Redteam question?', published_answer: 'Redteam answer.', category: 'general', slug: 'redteam-inserted' },
  '/api/admin/courses': { id: 'redteam-inserted-course', slug: 'redteam-inserted-course', title: 'Redteam course' },
  '/api/admin/cleanup': {},
  '/api/create-checkout': { mode: 'payment', amount: 2500 },
  '/api/contact/submit': { name: 'Redteam Sender', email: ATTACK_EMAIL, message: 'Redteam contact message, comfortably over the minimum length.', turnstileToken: 'redteam-token' },
  '/api/survey/request': { email: ATTACK_EMAIL, turnstileToken: 'redteam-token' },
  '/api/survey/submit': {
    token: 'redteam-survey-token',
    symptoms: { tier1: ['pain'], tier2: [], tier3: [] },
    score: { total: 3, tier1: 3, tier2: 0, tier3: 0 },
  },
  '/api/quiz/request': { email: ATTACK_EMAIL, turnstileToken: 'redteam-token', answers: { a: 1 } },
  '/api/endo-quiz/start': {},
  '/api/endo-quiz/request': { email: ATTACK_EMAIL, turnstileToken: 'redteam-token' },
  '/api/newsletter/subscribe': { email: ATTACK_EMAIL, firstName: 'Redteam', turnstileToken: 'redteam-token' },
  '/api/events/register': { email: ATTACK_EMAIL, name: 'Redteam Attendee', eventSlug: 'redteam-event', turnstileToken: 'redteam-token' },
  '/api/partners/apply': { name: 'Redteam Partner', email: ATTACK_EMAIL, organization: 'Redteam Org', message: 'Redteam partner application message.', turnstileToken: 'redteam-token' },
  '/api/pdf/request': { email: ATTACK_EMAIL, guide: 'redteam-guide', turnstileToken: 'redteam-token' },
});

/** The body for one route+method, as a JSON string, or undefined for reads. */
export function bodyFor(path, method) {
  const keyed = BODIES[`${path}#${method}`];
  if (keyed !== undefined) return JSON.stringify(keyed);
  const plain = BODIES[path];
  return plain === undefined ? undefined : JSON.stringify(plain);
}
