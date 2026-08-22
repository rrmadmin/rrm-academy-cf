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
  STRIPE_API_VERSION, SITE_URL, checkRateLimit,
} from '../auth/_shared.js';
import { withIdempotency } from '../_idempotency.js';
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

export async function onRequestPost(context) {
  // Idempotency-Key replay (backlog #21): the enroll button sends a per-page-load
  // key, so a retry or second tap after the first response completes replays the
  // cached response — same Stripe checkoutUrl — instead of creating a new session.
  return withIdempotency(context, async ({ request, env, waitUntil }) => {
    try {
      return await handleEnroll(request, env, waitUntil);
    } catch (err) {
      log(env, waitUntil, 'courses', 'enroll_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }
  });
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
    try {
      await enrollUser(db, session.userId, courseId, existing.stripe_payment_intent || null);
    } catch (retryErr) {
      log(env, waitUntil, 'courses', 'enroll_retry_warn', 'warn', `userId=${session.userId} courseId=${courseId}: ${retryErr.message}`);
    }
    return json({ ok: true, enrolled: true });
  }

  // --- Free course: enroll immediately ---
  if (course.isFree) {
    const wasNewlyEnrolled = await enrollUser(db, session.userId, courseId, null);
    // enrollUser's UPSERT counts as a "change" whenever the conflict branch runs,
    // even if revoked_at was left untouched (still revoked). Re-check actual access
    // before reporting success -- an admin-revoked row must not report enrolled:true.
    const activeEnrollment = await db.prepare(
      'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ? AND revoked_at IS NULL'
    ).bind(session.userId, courseId).first();
    if (!activeEnrollment) {
      return json({ ok: false, error: 'Not enrolled' }, 403);
    }
    if (wasNewlyEnrolled) {
      const user = await db.prepare('SELECT email, name FROM user WHERE id = ?')
        .bind(session.userId).first();
      // Gating-test-harness accounts (administrator+test-*@rrmacademy.org) must not
      // fire the admin notify email or the GA4 conversion event -- they enroll in
      // live courses purely to verify access gating, and generate_lead feeds Ad
      // Grants conversion data.
      const isTestAccount = /^administrator\+test-[a-z0-9-]+@rrmacademy\.org$/i.test(user?.email || '');
      if (!isTestAccount) {
        if (course.accessType !== 'members') {
          waitUntil(notifyAdminEnrollment(env, {
            studentEmail: user?.email || 'unknown',
            studentName: user?.name || '',
            courseTitle: course.title,
            courseId,
            isFree: true,
          }).catch(() => {}));
        }
        waitUntil(sendGA4Event(env, request, 'generate_lead', {
          lead_source: course.accessType === 'members' ? 'member_course' : 'free_course',
          items: [{ item_name: `Course: ${courseId}` }],
        }).catch(() => {}));
      }
    }
    return json({ ok: true, enrolled: true });
  }

  // --- Paid course: create Stripe Checkout ---
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json({ ok: false, error: 'Payments not configured' }, 500);
  if (!course.stripePriceId) return json({ ok: false, error: 'Course pricing not configured' }, 500);

  // Double-tap guard (backlog #21): withIdempotency only replays *completed*
  // responses, so two rapid taps can both reach Stripe before the first
  // response is cached. Server-enforced KV lock closes that concurrent gap:
  // max 1 Checkout session per user+course per 10s window. Free enrollments
  // above are not affected (their INSERT is already ON CONFLICT-safe).
  const lockAllowed = await checkRateLimit(env, `enroll-stripe:${session.userId}:${courseId}`, 1, 10);
  if (!lockAllowed) {
    return json({ ok: false, error: 'Your enrollment is already being processed. Please wait a moment and try again.' }, 429);
  }

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
    payment_intent_data: {
      description: `Course: ${course.title}`,
      statement_descriptor_suffix: 'COURSE',
      metadata: { type: 'course', courseId: course.id },
    },
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
  // Gating-test-harness accounts (administrator+test-*@rrmacademy.org) must not
  // fire the GA4 begin_checkout event -- Stripe Checkout still runs so the
  // harness can assert checkoutUrl comes back, but generate_lead/begin_checkout
  // feed Ad Grants conversion data.
  const isTestAccount = /^administrator\+test-[a-z0-9-]+@rrmacademy\.org$/i.test(user?.email || '');
  if (!isTestAccount) {
    waitUntil(sendGA4Event(env, request, 'begin_checkout', {
      page_location: entryUrl || request.headers.get('Referer') || SITE_URL,
      currency: 'USD',
      ...(course.priceCents && { value: course.priceCents / 100 }),
      items: [{ item_name: `Course: ${courseId}` }],
    }).catch(() => {}));
  }
  return json({ ok: true, enrolled: false, checkoutUrl: checkoutSession.url });
}

/**
 * Create enrollment row(s) for a user. Handles "includes" (e.g. Masterclass → Long-Term Endo).
 * Returns true if the primary enrollment row was newly inserted or updated (e.g. re-enrollment after revocation).
 * Returns false only on an active-enrollment retry (no changes made).
 * Exported for use by stripe-webhook.js.
 */
export async function enrollUser(db, userId, courseId, stripePaymentIntent) {
  const statements = [
    db.prepare(
      'INSERT INTO enrollment (id, user_id, course_id, stripe_payment_intent) VALUES (?, ?, ?, ?)' +
      ' ON CONFLICT(user_id, course_id) DO UPDATE SET' +
      ' revoked_at = CASE' +
      '   WHEN excluded.stripe_payment_intent IS NOT NULL' +
      '     AND excluded.stripe_payment_intent IS NOT enrollment.stripe_payment_intent' +
      '   THEN NULL' +
      '   ELSE enrollment.revoked_at' +
      ' END,' +
      ' stripe_payment_intent = COALESCE(excluded.stripe_payment_intent, enrollment.stripe_payment_intent)'
    ).bind(generateId(), userId, courseId, stripePaymentIntent),
  ];

  // Enroll in included courses (e.g. Masterclass includes Long-Term Endo).
  // INSERT OR IGNORE (not full UPSERT) so an admin-revoked included-course enrollment
  // is never silently un-revoked by a parent-course re-enroll. Included-course rows
  // share the parent's stripe_payment_intent, so a full refund DOES revoke them via
  // the refund handler's WHERE stripe_payment_intent = ? filter -- that is intentional.
  const included = getIncludedCourseIds(courseId);
  for (const includedId of included) {
    statements.push(
      db.prepare(
        'INSERT OR IGNORE INTO enrollment (id, user_id, course_id, stripe_payment_intent) VALUES (?, ?, ?, ?)'
      ).bind(generateId(), userId, includedId, stripePaymentIntent),
    );
  }

  const results = await db.batch(statements);
  const allSucceeded = results.every(r => r?.success !== false);
  if (!allSucceeded) {
    // shouldn't happen with atomic batches but defense-in-depth
    return false;
  }
  return results[0]?.meta?.changes > 0;
}
