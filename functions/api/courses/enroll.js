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
  STRIPE_API_VERSION, SITE_URL,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { getCourse, getIncludedCourseIds } from './_shared.js';
import { sendGA4Event } from '../_ga4.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    return await handleEnroll(request, env, waitUntil);
  } catch (err) {
    log(env, waitUntil, 'courses', 'enroll_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

async function handleEnroll(request, env, waitUntil) {
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
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  const { courseId } = body;
  if (!courseId || typeof courseId !== 'string' || courseId.length > 100) return json({ ok: false, error: 'courseId required' }, 400);

  const course = getCourse(courseId);
  if (!course) return json({ ok: false, error: 'Course not found' }, 404);
  if (course.comingSoon) return json({ ok: false, error: 'Course not yet available' }, 400);
  if (course.isAffiliate) return json({ ok: false, error: 'External enrollment only' }, 400);

  // Idempotent: already enrolled → return success
  // Re-run enrollUser to ensure included courses exist (handles partial-failure retry)
  const existing = await db.prepare(
    'SELECT id, stripe_payment_intent FROM enrollment WHERE user_id = ? AND course_id = ?'
  ).bind(session.userId, courseId).first();
  if (existing) {
    await enrollUser(db, session.userId, courseId, existing.stripe_payment_intent || null);
    return json({ ok: true, enrolled: true });
  }

  // --- Free course: enroll immediately ---
  if (course.isFree) {
    await enrollUser(db, session.userId, courseId, null);
    waitUntil(sendGA4Event(env, request, 'sign_up', {
      event_category: 'course_enrollment', items: [{ item_name: `Course: ${courseId}` }],
    }).catch(() => {}));
    return json({ ok: true, enrolled: true });
  }

  // --- Paid course: create Stripe Checkout ---
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json({ ok: false, error: 'Payments not configured' }, 500);
  if (!course.stripePriceId) return json({ ok: false, error: 'Course pricing not configured' }, 500);

  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: STRIPE_API_VERSION,
  });

  const user = await db.prepare('SELECT email, stripe_customer_id FROM user WHERE id = ?')
    .bind(session.userId).first();

  const origin = SITE_URL;
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

  let checkoutSession;
  try {
    checkoutSession = await stripe.checkout.sessions.create(sessionParams);
  } catch (err) {
    log(env, waitUntil, 'courses', 'enroll_error', 'error', `stripe checkout: ${err.message}`, 0, 503);
    return json({ ok: false, error: 'Payment service unavailable. Please try again shortly.' }, 503);
  }
  waitUntil(sendGA4Event(env, request, 'begin_checkout', {
    currency: 'USD', items: [{ item_name: `Course: ${courseId}` }],
  }).catch(() => {}));
  return json({ ok: true, enrolled: false, checkoutUrl: checkoutSession.url });
}

/**
 * Create enrollment row(s) for a user. Handles "includes" (e.g. Masterclass → Long-Term Endo).
 * Exported for use by stripe-webhook.js.
 */
export async function enrollUser(db, userId, courseId, stripePaymentIntent) {
  const statements = [
    db.prepare(
      'INSERT OR IGNORE INTO enrollment (id, user_id, course_id, stripe_payment_intent) VALUES (?, ?, ?, ?)'
    ).bind(generateId(), userId, courseId, stripePaymentIntent),
  ];

  // Enroll in included courses (e.g. Masterclass includes Long-Term Endo)
  const included = getIncludedCourseIds(courseId);
  for (const includedId of included) {
    statements.push(
      db.prepare(
        'INSERT OR IGNORE INTO enrollment (id, user_id, course_id, stripe_payment_intent) VALUES (?, ?, ?, ?)'
      ).bind(generateId(), userId, includedId, stripePaymentIntent),
    );
  }

  await db.batch(statements);
}
