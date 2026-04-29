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
/**
 * NOTE: For courses with accessType === 'members', isFree=true semantically means
 * "no Stripe checkout required" (membership is the access grant), NOT "free for everyone".
 * The members-gate runs before the isFree branch so non-members are blocked even though
 * isFree is true. Do not refactor the isFree fast-path without preserving this ordering.
 */
import Stripe from 'stripe';
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, generateId,
  STRIPE_API_VERSION, SITE_URL,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { getCourse, getIncludedCourseIds } from './_shared.js';
import { sendGA4Event } from '../_ga4.js';
import { classifySource, extractUtm, getClientId, deriveSessionId } from '../_ga4-source.js';
import { notifyAdminEnrollment } from './_notify-admin.js';
import { requireMember } from '../community/_shared.js';

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return '';
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

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
  if (course.comingSoon && course.accessType !== 'members') {
    return json({ ok: false, error: 'Course not yet available' }, 400);
  }
  if (course.isAffiliate) return json({ ok: false, error: 'External enrollment only' }, 400);
  if (course.accessType === 'members') {
    const memberResult = await requireMember(request, env);
    if (memberResult instanceof Response) return memberResult;
  }

  // Idempotent: already enrolled → return success
  // Re-run enrollUser to ensure included courses exist (handles partial-failure retry)
  const existing = await db.prepare(
    'SELECT id, stripe_payment_intent FROM enrollment WHERE user_id = ? AND course_id = ? AND revoked_at IS NULL'
  ).bind(session.userId, courseId).first();
  if (existing) {
    await enrollUser(db, session.userId, courseId, existing.stripe_payment_intent || null);
    return json({ ok: true, enrolled: true });
  }

  // --- Free course: enroll immediately ---
  if (course.isFree) {
    const wasNewlyEnrolled = await enrollUser(db, session.userId, courseId, null);
    if (wasNewlyEnrolled) {
      if (course.accessType !== 'members') {
        waitUntil((async () => {
          const user = await db.prepare('SELECT email, name FROM user WHERE id = ?')
            .bind(session.userId).first();
          await notifyAdminEnrollment(env, {
            studentEmail: user?.email || 'unknown',
            studentName: user?.name || '',
            courseTitle: course.title,
            courseId,
            isFree: true,
          });
        })().catch(() => {}));
      }
      waitUntil(sendGA4Event(env, request, 'generate_lead', {
        lead_source: course.accessType === 'members' ? 'member_course' : 'free_course',
        items: [{ item_name: `Course: ${courseId}` }],
      }).catch(() => {}));
    }
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

  // Derive GA4 source attribution from entry cookies (same as create-checkout.js)
  const cookies = request.headers.get('Cookie') || '';
  const entryRef = parseCookie(cookies, 'entry_ref');
  const entryUrl = parseCookie(cookies, 'entry_url');
  const referrer = entryRef || request.headers.get('Referer') || '';
  const landingUrl = entryUrl || request.url;
  const utmParams = extractUtm(landingUrl);
  const { source, medium } = classifySource(referrer);
  const gaSource = utmParams.utm_source || source;
  const gaMedium = utmParams.utm_medium || medium;
  const gaCampaign = utmParams.utm_campaign || '';
  const clientId = await getClientId(request);
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const gaSessionId = await deriveSessionId(clientId, dateStr);

  const origin = SITE_URL;
  const sessionParams = {
    mode: 'payment',
    line_items: [{ price: course.stripePriceId, quantity: 1 }],
    success_url: `${origin}/courses/${course.slug}/?enrolled=1`,
    cancel_url: `${origin}/courses/${course.slug}/`,
    metadata: {
      type: 'course',
      courseId: course.id,
      ga_client_id: clientId,
      ga_session_id: String(gaSessionId),
      ga_source: gaSource,
      ga_medium: gaMedium,
      ...(gaCampaign && { ga_campaign: gaCampaign }),
    },
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
    page_location: entryUrl || request.headers.get('Referer') || SITE_URL,
    currency: 'USD',
    ...(course.priceCents && { value: course.priceCents / 100 }),
    items: [{ item_name: `Course: ${courseId}` }],
  }).catch(() => {}));
  return json({ ok: true, enrolled: false, checkoutUrl: checkoutSession.url });
}

/**
 * Create enrollment row(s) for a user. Handles "includes" (e.g. Masterclass → Long-Term Endo).
 * Returns true if the primary enrollment row was newly inserted (INSERT OR IGNORE changed a row).
 * Returns false if the user was already enrolled (idempotent re-call).
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

  const results = await db.batch(statements);
  return results[0]?.meta?.changes > 0;
}
