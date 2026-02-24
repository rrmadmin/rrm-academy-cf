/**
 * POST /api/courses/enroll
 * Enroll the logged-in user in a course.
 *
 * Body: { courseId: string }
 *
 * - Free courses: enrollment created immediately.
 * - Paid courses: Stripe Checkout session created, returns { checkoutUrl }.
 * - "includes" handled: Masterclass enrollment also enrolls in Long-Term Endo.
 * - Idempotent: re-enrolling returns { enrolled: true } with no side effects.
 */
import Stripe from 'stripe';
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, generateId,
} from '../auth/_shared.js';
import { getCourse, getIncludedCourseIds } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  try {
    return await handleEnroll(request, env);
  } catch (err) {
    console.error('enroll error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

async function handleEnroll(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

  // Auth required
  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(db, sessionId);
  if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { courseId } = body;
  if (!courseId) return json({ ok: false, error: 'courseId required' }, 400);

  const course = getCourse(courseId);
  if (!course) return json({ ok: false, error: 'Course not found' }, 404);

  // Idempotent: already enrolled → return success
  // Re-run enrollUser to ensure included courses exist (handles partial-failure retry)
  const existing = await db.prepare(
    'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ?'
  ).bind(session.userId, courseId).first();
  if (existing) {
    await enrollUser(db, session.userId, courseId, null);
    return json({ ok: true, enrolled: true });
  }

  // --- Free course: enroll immediately ---
  if (course.isFree) {
    await enrollUser(db, session.userId, courseId, null);
    return json({ ok: true, enrolled: true });
  }

  // --- Paid course: create Stripe Checkout ---
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json({ ok: false, error: 'Payments not configured' }, 500);
  if (!course.stripePriceId) return json({ ok: false, error: 'Course pricing not configured' }, 500);

  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: '2024-12-18.acacia',
  });

  const user = await db.prepare('SELECT email, stripe_customer_id FROM user WHERE id = ?')
    .bind(session.userId).first();

  const origin = new URL(request.url).origin;
  const sessionParams = {
    mode: 'payment',
    line_items: [{ price: course.stripePriceId, quantity: 1 }],
    success_url: `${origin}/courses/${course.slug}?enrolled=1`,
    cancel_url: `${origin}/courses/${course.slug}`,
    metadata: { type: 'course', courseId: course.id },
    client_reference_id: session.userId,
  };

  // Use existing Stripe customer if linked, otherwise pre-fill email
  if (user?.stripe_customer_id) {
    sessionParams.customer = user.stripe_customer_id;
  } else if (user?.email) {
    sessionParams.customer_email = user.email;
  }

  const checkoutSession = await stripe.checkout.sessions.create(sessionParams);
  return json({ ok: true, enrolled: false, checkoutUrl: checkoutSession.url });
}

/**
 * Create enrollment row(s) for a user. Handles "includes" (e.g. Masterclass → Long-Term Endo).
 * Exported for use by stripe-webhook.js.
 */
export async function enrollUser(db, userId, courseId, stripePaymentIntent) {
  const enrollmentId = generateId();
  await db.prepare(
    'INSERT OR IGNORE INTO enrollment (id, user_id, course_id, stripe_payment_intent) VALUES (?, ?, ?, ?)'
  ).bind(enrollmentId, userId, courseId, stripePaymentIntent).run();

  // Enroll in included courses (e.g. Masterclass includes Long-Term Endo)
  const included = getIncludedCourseIds(courseId);
  for (const includedId of included) {
    const id = generateId();
    await db.prepare(
      'INSERT OR IGNORE INTO enrollment (id, user_id, course_id, stripe_payment_intent) VALUES (?, ?, ?, ?)'
    ).bind(id, userId, includedId, stripePaymentIntent).run();
  }
}
