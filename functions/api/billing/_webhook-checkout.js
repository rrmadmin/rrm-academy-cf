/**
 * Handler for Stripe checkout.session.completed webhook events.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 *
 * Responsibilities:
 * - Link Stripe customer to D1 user (or auto-create account)
 * - Enroll user in purchased course
 * - Send STUC membership welcome email
 * - Fire GA4 purchase events (course, donation, subscription)
 */
import {
  SITE_URL, generateId, generateToken, hashToken,
} from '../auth/_shared.js';
import { enrollUser } from '../courses/enroll.js';
import { getCourse } from '../courses/_shared.js';
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';
import { sendEmailSafe } from './_webhook-shared.js';
import { verifyAndTagEmail } from '../_elv.js';

/**
 * @param {D1Database} db
 * @param {Stripe.Event} event
 * @param {Object} env
 * @param {Request} request
 * @param {Function} waitUntil
 * @returns {Response|null}
 */
export async function handleCheckoutCompleted(db, event, env, request, waitUntil) {
  const session = event.data.object;

  // Link Stripe customer to D1 user, or auto-create account for anonymous checkout
  try {
    await ensureAccountForCheckout(db, session, env, waitUntil);
  } catch (linkErr) {
    log(env, waitUntil, 'billing', 'account_link_fail', 'error', linkErr.message, 0, 500);
    // Return 500 so Stripe retries -- user needs an account for course access
    return new Response(JSON.stringify({ ok: false, error: 'Account linkage failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Course purchase: create enrollment
  if (session.metadata?.type === 'course') {
    const courseId = session.metadata.courseId;
    const paymentIntent = session.payment_intent;

    // Resolve the user ID: logged-in user or look up by email for anonymous checkout
    let userId = session.client_reference_id;
    if (!userId) {
      const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim();
      if (email) {
        const user = await db.prepare('SELECT id FROM user WHERE email = ? COLLATE NOCASE').bind(email).first();
        if (user) userId = user.id;
      }
      if (!userId) {
        log(env, waitUntil, 'billing', 'course_no_user', 'error', `courseId:${courseId} customer:${session.customer}`);
        return new Response(JSON.stringify({ ok: false, error: 'No user account for course enrollment' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (!getCourse(courseId)) {
      log(env, waitUntil, 'billing', 'course_not_found', 'error', `${courseId} user=${userId}`);
      return new Response(JSON.stringify({ ok: false, error: 'Course not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      await enrollUser(db, userId, courseId, paymentIntent);
      log(env, waitUntil, 'billing', 'course_enrolled', 'ok', `${courseId} user=${userId}`);
    } catch (enrollErr) {
      log(env, waitUntil, 'billing', 'course_enroll_fail', 'error', `${courseId}: ${enrollErr.message}`, 0, 500);
      return new Response(JSON.stringify({ ok: false, error: 'Enrollment failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Send course enrollment confirmation email
    const email = session.customer_details?.email || session.customer_email;
    const name = session.customer_details?.name || '';
    if (email && env.AWS_ACCESS_KEY_ID) {
      await sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Your course is ready',
        text: [
          `Hi ${name || 'there'},`,
          '',
          'Your course purchase is confirmed and your course is ready to start.',
          '',
          `Go to your courses: ${SITE_URL}/account`,
          '',
          'Thank you for investing in your health education.',
          '',
          'RRM Academy',
          'A project of the RRM Foundation -- 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      });
    } else if (email && !env.AWS_ACCESS_KEY_ID) {
      log(env, waitUntil, 'billing', 'enrollment_email_skipped', 'skipped', `${email} ${courseId} (SES not configured)`);
    }
  }

  // Build GA4 identity overrides from checkout metadata (real user, not Stripe server)
  const gaOverrides = {};
  if (session.metadata?.ga_client_id) gaOverrides.client_id = session.metadata.ga_client_id;
  if (session.metadata?.ga_session_id) gaOverrides.session_id = Number(session.metadata.ga_session_id);

  const pageLocation = session.success_url?.replace(/\?.*$/, '') || SITE_URL;

  // GA4: track completed course purchase
  if (session.metadata?.type === 'course' && session.payment_intent) {
    waitUntil(sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || 0) / 100,
      transaction_id: session.payment_intent,
      items: [{ item_name: `Course: ${session.metadata.courseId || 'unknown'}` }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
    }, gaOverrides).catch(() => {}));
  }

  // Send membership confirmation email for STUC subscriptions
  const stucTiers = { member: 'Member', hero: 'Uterus Hero', superhero: 'Super Hero' };
  const tier = session.metadata?.tier || '';
  if (session.mode === 'subscription' && stucTiers[tier]) {
    const email = session.customer_details?.email || session.customer_email;
    const name = session.customer_details?.name || '';
    const tierLabel = stucTiers[tier];

    if (email && env.AWS_ACCESS_KEY_ID) {
      await sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Welcome to the Save the Uterus Club',
        text: [
          `Hi ${name || 'there'},`,
          '',
          `Welcome to the Save the Uterus Club! You're now a ${tierLabel} member.`,
          '',
          'Here\'s what to do next:',
          '',
          '1. Join the member group -- this is where live call dates, resources, and discussion happen:',
          `   ${SITE_URL}/community`,
          '',
          '2. Join the free Uterus Allies group chat on Instagram:',
          '   https://www.instagram.com/direct/t/7768750249851959/',
          '',
          '3. Explore the Research Library -- over 3,000 peer-reviewed resources:',
          `   ${SITE_URL}/library`,
          '',
          `You can manage your membership anytime at ${SITE_URL}/account`,
          '',
          'Thank you for supporting evidence-based reproductive health.',
          '',
          'RRM Academy',
          'A project of the RRM Foundation -- 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      });
    } else if (email && !env.AWS_ACCESS_KEY_ID) {
      log(env, waitUntil, 'billing', 'membership_email_skipped', 'skipped', `${email} ${tierLabel} (SES not configured)`);
    }
  }

  // GA4: track completed donation or membership purchase
  if (session.mode === 'payment') {
    waitUntil(sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || 0) / 100,
      transaction_id: session.payment_intent || session.id,
      items: [{ item_name: 'Donation' }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
    }, gaOverrides).catch(() => {}));
  } else if (session.mode === 'subscription' && stucTiers[tier]) {
    waitUntil(sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || 0) / 100,
      transaction_id: session.subscription || session.id,
      items: [{ item_name: `STUC ${stucTiers[tier]}` }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
    }, gaOverrides).catch(() => {}));
  }

  return null;
}

/**
 * Ensure a D1 account exists for the checkout session's customer.
 *
 * 1. Logged-in user (client_reference_id set) -> link stripe_customer_id
 * 2. Anonymous, email matches existing account -> link stripe_customer_id
 * 3. Anonymous, no account -> create account, send welcome email with password-setup link
 */
async function ensureAccountForCheckout(db, session, env, waitUntil) {
  const customerId = session.customer;
  const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim();

  if (!email) {
    log(env, waitUntil, 'billing', 'no_checkout_email', 'skipped', session.id);
    return;
  }

  // ELV tag (non-blocking -- payment already completed, just tag for CRM)
  const name = session.customer_details?.name || '';
  const [first, ...rest] = name.split(' ');
  waitUntil(verifyAndTagEmail(email, env, {
    firstName: first || '', lastName: rest.join(' ') || '', source: 'checkout',
  }).catch(() => {}));

  // Case 1: User was logged in (client_reference_id = D1 user ID)
  if (session.client_reference_id) {
    if (customerId) {
      const result = await db.prepare(
        'UPDATE user SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE id = ? AND (stripe_customer_id IS NULL OR stripe_customer_id = ?)'
      ).bind(customerId, session.client_reference_id, customerId).run();
      if (result.meta.changes === 0) {
        const existing = await db.prepare('SELECT stripe_customer_id FROM user WHERE id = ?').bind(session.client_reference_id).first();
        if (existing?.stripe_customer_id && existing.stripe_customer_id !== customerId) {
          log(env, waitUntil, 'billing', 'stripe_id_mismatch', 'error',
            `user ${session.client_reference_id} has ${existing.stripe_customer_id}, checkout used ${customerId}`);
        }
      } else {
        log(env, waitUntil, 'billing', 'stripe_linked', 'ok', `${customerId} -> user ${session.client_reference_id} (by ID)`);
      }
    }
    return;
  }

  // Case 2: Anonymous checkout -- check if email matches existing account
  const existing = await db.prepare('SELECT id, stripe_customer_id FROM user WHERE email = ? COLLATE NOCASE')
    .bind(email).first();

  if (existing) {
    if (customerId && !existing.stripe_customer_id) {
      await db.prepare('UPDATE user SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .bind(customerId, existing.id).run();
      log(env, waitUntil, 'billing', 'stripe_linked', 'ok', `${customerId} -> user ${existing.id} (by email)`);
    }
    return;
  }

  // Case 3: No account exists -- auto-create one
  // Use INSERT OR IGNORE to handle race conditions (concurrent webhook retries for same email)
  const id = generateId();
  const name = session.customer_details?.name || '';

  const ins = await db.prepare(
    `INSERT OR IGNORE INTO user (id, email, email_verified, hashed_password, name, stripe_customer_id, role)
     VALUES (?, ?, 1, '', ?, ?, 'member')`
  ).bind(id, email, name, customerId || null).run();

  if (ins.meta.changes === 0) {
    // Another request created the account first -- link Stripe ID to existing account
    if (customerId) {
      await db.prepare('UPDATE user SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE email = ? COLLATE NOCASE AND stripe_customer_id IS NULL')
        .bind(customerId, email).run();
    }
    log(env, waitUntil, 'billing', 'stripe_linked', 'ok', `${email} concurrent, linked ${customerId}`);
    return;
  }
  log(env, waitUntil, 'billing', 'auto_account_created', 'ok', `${id} ${email} stripe=${customerId}`);

  // Generate 7-day password reset token so user can set a password
  if (env.AWS_ACCESS_KEY_ID) {
    try {
      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

      await db.prepare(
        'INSERT INTO password_reset (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
      ).bind(generateId(), id, tokenHash, expiresAt).run();

      const setPasswordUrl = `${SITE_URL}/reset-password?token=${token}`;

      await sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Your RRM Academy account is ready',
        text: [
          `Hi ${name || 'there'},`,
          '',
          'Thank you for your support! We\'ve created an RRM Academy account for you so you can view your donation history, receipts, and membership details.',
          '',
          'Set your password to get started:',
          setPasswordUrl,
          '',
          'This link expires in 7 days. You can also sign in with Google if you prefer.',
          '',
          'RRM Academy',
          'A project of the RRM Foundation -- 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      });
      log(env, waitUntil, 'billing', 'welcome_email_sent', 'ok', `${email} account=${id}`);
    } catch (tokenErr) {
      log(env, waitUntil, 'billing', 'welcome_setup_fail', 'error', `${email}: ${tokenErr.message}`);
    }
  } else {
    log(env, waitUntil, 'billing', 'welcome_email_skipped', 'skipped', `${email} account=${id} (SES not configured)`);
  }
}
