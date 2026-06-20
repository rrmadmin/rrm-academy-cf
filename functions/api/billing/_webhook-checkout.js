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
import { getStripeClient } from './_shared.js';
import { enrollUser } from '../courses/enroll.js';
import { getCourse } from '../courses/_shared.js';
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';
import { sendEmailSafe } from './_webhook-shared.js';
import { verifyAndTagEmail } from '../_elv.js';
import { notifyAdminEnrollment } from '../courses/_notify-admin.js';
import { recordDonorGift, giftFromCheckoutSession } from './_donor-gift.js';
import { readSupporterConsent, deriveDisplayName, recordSupporterGift } from './_supporter-gift.js';

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

  // Warn when logged-in user edited their email at checkout — account link uses
  // client_reference_id (pre-checkout identity) but confirmation email goes to
  // customer_details.email (edited value). Silent divergence is the risk.
  if (session.client_reference_id && session.customer_details?.email && session.customer_email &&
      session.customer_details.email !== session.customer_email) {
    log(env, waitUntil, 'billing', 'checkout_email_mismatch', 'warn',
      `client_ref=${session.client_reference_id} pre=${session.customer_email} edited=${session.customer_details.email}`);
  }

  // Link Stripe customer to D1 user, or auto-create account for anonymous checkout
  const checkoutType = session.metadata?.type;
  try {
    await ensureAccountForCheckout(db, session, env, waitUntil);
  } catch (linkErr) {
    log(env, waitUntil, 'billing', 'account_link_fail', 'error', linkErr.message, 0, 500);
    if (checkoutType === 'course') {
      return new Response(JSON.stringify({ ok: false, error: 'Account linkage failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Course purchase: create enrollment
  if (session.metadata?.type === 'course') {
    const courseId = session.metadata.courseId;

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
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (!getCourse(courseId)) {
      log(env, waitUntil, 'billing', 'course_not_found', 'error', `${courseId} user=${userId}`);
      return new Response(JSON.stringify({ ok: false, error: 'Course not found' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      await enrollUser(db, userId, courseId, session.payment_intent || session.id);
      log(env, waitUntil, 'billing', 'course_enrolled', 'ok', `${courseId} user=${userId}`);
    } catch (enrollErr) {
      log(env, waitUntil, 'billing', 'course_enroll_fail', 'error', `${courseId}: ${enrollErr.message}`, 0, 500);
      return new Response(JSON.stringify({ ok: false, error: 'Enrollment failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Send course enrollment confirmation email
    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim() || null;
    const name = (session.customer_details?.name || '').slice(0, 200);
    // Admin notify is not gated on SES -- notifyAdminEnrollment checks AWS_ACCESS_KEY_ID internally
    // and can use alternate transports. Always fire so admin sees paid enrollments even when SES
    // creds are absent or misconfigured.
    const course = getCourse(courseId);
    waitUntil(notifyAdminEnrollment(env, {
      studentEmail: email || 'unknown',
      studentName: name || '',
      courseTitle: course?.title || courseId,
      courseId,
      isFree: false,
    }).catch(() => {}));
    if (email && env.AWS_ACCESS_KEY_ID) {
      waitUntil(sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Your course is ready',
        source: 'billing/checkout-course',
        text: [
          `Hi ${name || 'there'},`,
          '',
          'Your course purchase is confirmed and your course is ready to start.',
          '',
          `Go to your courses: ${SITE_URL}/account/`,
          '',
          'Thank you for investing in your health education.',
          '',
          'RRM Academy',
          'A project of the RRM Foundation -- 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      }).catch(() => {}));
    } else if (email && !env.AWS_ACCESS_KEY_ID) {
      log(env, waitUntil, 'billing', 'enrollment_email_skipped', 'skipped', `${email} ${courseId} (SES not configured)`);
    }
  }

  // Build GA4 identity overrides from checkout metadata (real user, not Stripe server)
  const gaOverrides = {};
  if (session.metadata?.ga_client_id) gaOverrides.client_id = session.metadata.ga_client_id;
  if (session.metadata?.ga_session_id) {
    const sid = Number(session.metadata.ga_session_id);
    if (Number.isFinite(sid)) gaOverrides.session_id = sid;
  }

  const pageLocation = (session.cancel_url || session.success_url || SITE_URL).replace(/\?.*$/, '');

  // GA4: track completed course purchase
  if (session.metadata?.type === 'course') {
    waitUntil(sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || 0) / 100,
      transaction_id: session.payment_intent || session.id,
      items: [{ item_name: `Course: ${session.metadata.courseId || 'unknown'}` }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
      ...(session.metadata?.ga_entry_category && { entry_category: session.metadata.ga_entry_category }),
      ...(session.metadata?.ga_entry_platform && { entry_platform: session.metadata.ga_entry_platform }),
    }, gaOverrides).catch(() => {}));
  }

  // Send membership confirmation email for STUC subscriptions
  const stucTiers = { member: 'Member', hero: 'Uterus Hero', superhero: 'Super Hero' };
  const tier = session.metadata?.tier || '';
  if (session.mode === 'subscription' && stucTiers[tier]) {
    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim().replace(/[\r\n]/g, '') || null;
    const name = (session.customer_details?.name || '').slice(0, 200);
    const tierLabel = stucTiers[tier];

    if (email && env.AWS_ACCESS_KEY_ID) {
      const isMigrationDonor = typeof session.metadata?.wix_subscription_id === 'string' &&
        /^wxs_[a-z0-9_-]+$/i.test(session.metadata.wix_subscription_id);

      if (isMigrationDonor) {
        // Verify Stripe sub is active before sending "switch complete" email.
        // checkout.session.completed fires before 3DS confirms; an incomplete sub
        // should get a "in progress" email, not a false confirmation.
        let migrationEmailSubStatus = null;
        if (env.STRIPE_SECRET_KEY && session.subscription) {
          try {
            const stripeForEmail = getStripeClient(env);
            const subForEmail = await stripeForEmail.subscriptions.retrieve(session.subscription);
            migrationEmailSubStatus = subForEmail.status;
          } catch (subEmailErr) {
            log(env, waitUntil, 'billing', 'migration_email_sub_retrieve_fail', 'error',
              `${session.metadata.wix_subscription_id}: ${subEmailErr.message}`);
          }
        }

        if (migrationEmailSubStatus !== 'active' && migrationEmailSubStatus !== 'trialing') {
          waitUntil(sendEmailSafe(env, waitUntil, {
            to: email,
            subject: 'Your donation switch is in progress',
            source: 'billing/checkout-membership-migration-pending',
            text: [
              `Hi ${name || 'there'},`,
              '',
              'Your donation switch is in progress. Your card needs an extra confirmation step.',
              '',
              'Watch for an email from Stripe to complete the payment. We\'ll keep your previous donation active until the new one confirms.',
              '',
              `Manage your membership any time at ${SITE_URL}/account/`,
              '',
              'If you have questions, email us at administrator@rrmacademy.org',
              '',
              'RRM Academy',
              'A project of the RRM Foundation -- 501(c)(3), EIN: 93-4594315',
            ].join('\n'),
          }).catch(() => {}));
        } else {
        let nextChargeSentence = '';
        let wixAmountDollars = null;
        try {
          const wixRow = await db.prepare(
            "SELECT amount_cents, next_expected_at FROM wix_subscription WHERE wix_subscription_id = ?"
          ).bind(session.metadata.wix_subscription_id).first();

          if (wixRow) {
            const amountNum = Number(wixRow.amount_cents);
            wixAmountDollars = (Number.isFinite(amountNum) && amountNum > 0) ? (amountNum / 100).toFixed(0) : null;
            const nowSec = Math.floor(Date.now() / 1000);
            const nextAtSec = wixRow.next_expected_at
              ? Math.floor(new Date(wixRow.next_expected_at).getTime() / 1000)
              : null;
            const isUsable = Number.isFinite(nextAtSec) && nextAtSec > nowSec;
            if (isUsable && wixAmountDollars) {
              const humanDate = new Date(wixRow.next_expected_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              });
              nextChargeSentence = `Your next donation will be processed on ${humanDate} at $${wixAmountDollars}/month -- the same date and same amount you were already on.`;
            } else if (!isUsable && wixAmountDollars) {
              const fallbackDate = new Date();
              fallbackDate.setMonth(fallbackDate.getMonth() + 1);
              const humanDate = fallbackDate.toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              });
              nextChargeSentence = `Your next donation will be processed on ${humanDate} at $${wixAmountDollars}/month -- going forward you'll be charged on the same day each month.`;
            }
          }
        } catch (wixReadErr) {
          log(env, waitUntil, 'billing', 'migration_email_wix_read_fail', 'error',
            `${session.metadata.wix_subscription_id}: ${wixReadErr.message}`);
        }

        const amountLine = wixAmountDollars
          ? ` at $${wixAmountDollars}/month`
          : '';
        const chargeLine = nextChargeSentence ||
          `Your donation${amountLine} will continue going forward.`;

        waitUntil(sendEmailSafe(env, waitUntil, {
          to: email,
          subject: 'Your donation switch is complete',
          source: 'billing/checkout-membership-migration',
          text: [
            `Hi ${name || 'there'},`,
            '',
            'Your switch over to our new payment system is complete. Thank you for staying with us.',
            '',
            `${chargeLine} You won't be double-charged. We'll cancel your previous Wix donation within 24 hours.`,
            '',
            `Manage your membership any time at ${SITE_URL}/account/`,
            '',
            'If you see two charges in the same month, please email us at administrator@rrmacademy.org and we\'ll sort it immediately.',
            '',
            'Thank you for supporting evidence-based reproductive health.',
            '',
            'RRM Academy',
            'A project of the RRM Foundation -- 501(c)(3), EIN: 93-4594315',
          ].join('\n'),
        }).catch(() => {}));
        }
      } else {
        // New member — standard welcome email with onboarding list
        waitUntil(sendEmailSafe(env, waitUntil, {
          to: email,
          subject: 'Welcome to the Save the Uterus Club',
          source: 'billing/checkout-membership',
          text: [
            `Hi ${name || 'there'},`,
            '',
            `Welcome to the Save the Uterus Club! You're now a ${tierLabel} member.`,
            '',
            'Here\'s what to do next:',
            '',
            '1. Join the member group -- this is where live call dates, resources, and discussion happen:',
            `   ${SITE_URL}/community/`,
            '',
            '2. Join the free Uterus Allies group chat on Instagram:',
            '   https://www.instagram.com/direct/t/7768750249851959/',
            '',
            '3. Explore the Research Library -- over 3,000 peer-reviewed resources:',
            `   ${SITE_URL}/library/`,
            '',
            `You can manage your membership anytime at ${SITE_URL}/account/`,
            '',
            'Thank you for supporting evidence-based reproductive health.',
            '',
            'RRM Academy',
            'A project of the RRM Foundation -- 501(c)(3), EIN: 93-4594315',
          ].join('\n'),
        }).catch(() => {}));
      }
    } else if (email && !env.AWS_ACCESS_KEY_ID) {
      log(env, waitUntil, 'billing', 'membership_email_skipped', 'skipped', `${email} ${tierLabel} (SES not configured)`);
    }

    // Metadata-first migration handoff (INV-3, INV-9)
    // When create-checkout (Phase 3.1) sets session.metadata.wix_subscription_id, we know
    // EXACTLY which Wix sub to migrate -- no email guessing required. Defense against
    // email-mismatch hijack and against multi-Wix-sub donors getting the wrong row marked.
    let migrationHandled = false;
    const wixSubIdMeta = session.metadata?.wix_subscription_id || null;
    if (wixSubIdMeta && db && typeof wixSubIdMeta === 'string' && /^wxs_[a-z0-9_-]+$/i.test(wixSubIdMeta)) {
      try {
        // Pre-read the row so we can include next_expected_at in the admin email.
        const wixRow = await db.prepare(
          "SELECT email, tier, amount_cents, next_expected_at, stripe_subscription_id " +
          "FROM wix_subscription WHERE wix_subscription_id = ?"
        ).bind(wixSubIdMeta).first();

        if (!wixRow) {
          // Token referenced a row that doesn't exist -- log and fall through to email-match.
          env.EVENTS?.writeDataPoint({
            blobs: ['billing', 'stuc-migration', 'metadata-row-missing', wixSubIdMeta, ''],
            indexes: ['metadata-row-missing'],
          });
        } else if (wixRow.stripe_subscription_id) {
          // Already migrated. Benign if Stripe is replaying the same event (same sub ID).
          // If a different session.subscription is arriving, the donor has two active Stripe subs.
          if (wixRow.stripe_subscription_id === session.subscription) {
            env.EVENTS?.writeDataPoint({
              blobs: ['billing', 'stuc-migration', 'metadata-duplicate-webhook', wixSubIdMeta, session.subscription || ''],
              indexes: ['metadata-duplicate-webhook'],
            });
          } else {
            env.EVENTS?.writeDataPoint({
              blobs: ['billing', 'stuc-migration', 'metadata-duplicate-stripe-sub', wixSubIdMeta, session.subscription || ''],
              indexes: ['metadata-duplicate-stripe-sub'],
            });
            const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim();
            if (env.AWS_ACCESS_KEY_ID) {
              waitUntil(sendEmailSafe(env, waitUntil, {
                to: 'administrator@rrmacademy.org',
                subject: `STUC migration: duplicate Stripe sub for ${email || wixSubIdMeta}`,
                source: 'billing/migration-metadata-dup',
                text: [
                  `A donor created a second Stripe subscription for an already-migrated Wix donor.`,
                  ``,
                  `Wix subscription:       ${wixSubIdMeta}`,
                  `Donor email (checkout): ${email || '(unknown)'}`,
                  `Existing Stripe sub:    ${wixRow.stripe_subscription_id}`,
                  `New Stripe sub:         ${session.subscription || '(unknown)'}`,
                  ``,
                  `Refund the duplicate (typically the newer one: ${session.subscription || 'see above'}) via Stripe Dashboard.`,
                ].join('\n'),
              }).catch(() => {}));
            }
          }
          migrationHandled = true;
        } else {
          // 3DS-incomplete guard (Bug #11): Stripe sub may still be 'incomplete' when this
          // webhook fires if the donor's 3DS challenge timed out or the bank declined mid-flow.
          // Flipping migration_status='stripe_active' + emailing admin to cancel Wix at this
          // moment can leave the donor with zero active subs if the Stripe sub never confirms.
          //
          // Conservative behavior: verify sub.status is 'active' or 'trialing' BEFORE the UPDATE.
          // If not, clear the lock (so the donor can retry without 15-min penalty), log to AE,
          // and skip the migration flip. Phase 7 cron Sweep 2 will reconcile slow-3DS donors
          // whose subs eventually become active.
          let stripeSubStatus = null;
          try {
            if (env.STRIPE_SECRET_KEY && session.subscription) {
              const stripe = getStripeClient(env);
              const sub = await stripe.subscriptions.retrieve(session.subscription);
              stripeSubStatus = sub.status;
            }
          } catch (stripeReadErr) {
            // Stripe API hiccup — log and fail-CLOSED (skip UPDATE) for safety.
            log(env, waitUntil, 'billing', 'metadata_stripe_retrieve_fail', 'error',
              `${wixSubIdMeta}: ${stripeReadErr.message}`);
            env.EVENTS?.writeDataPoint({
              blobs: ['billing', 'stuc-migration', 'stripe-retrieve-error', wixSubIdMeta, session.subscription || ''],
              indexes: ['stripe-retrieve-error'],
            });
            stripeSubStatus = 'unknown';
          }

          if (stripeSubStatus !== 'active' && stripeSubStatus !== 'trialing') {
            // Sub is not yet usable — clear the lock so the donor can retry, but DO NOT
            // flip migration_status or email admin. Phase 7 cron handles slow-3DS reconciliation.
            // arise-ignore unbatched-writes -- single write in an early-return branch; no multi-table write here
            await db.prepare(
              "UPDATE wix_subscription SET migration_handoff_started_at = NULL " +
              "WHERE wix_subscription_id = ? AND stripe_subscription_id IS NULL"
            ).bind(wixSubIdMeta).run();

            env.EVENTS?.writeDataPoint({
              blobs: ['billing', 'stuc-migration', 'stripe-sub-not-ready', wixSubIdMeta, stripeSubStatus || 'unknown'],
              indexes: ['stripe-sub-not-ready'],
            });
            log(env, waitUntil, 'billing', 'metadata_handoff_deferred', 'info',
              `${wixSubIdMeta}: Stripe sub status=${stripeSubStatus} (not active/trialing); skipping UPDATE`);

            migrationHandled = true;
          } else {
            // Atomic UPDATE filtered by stripe_subscription_id IS NULL gives idempotency
            // even without the pre-check above (defense in depth against retry race).
            const upd = await db.prepare(
              "UPDATE wix_subscription " +
              "SET migration_status='stripe_active', " +
              "    stripe_subscription_id=?, " +
              "    migration_handoff_started_at=NULL, " +
              "    migration_notes=COALESCE(migration_notes,'') || " +
              "      strftime('%Y-%m-%dT%H:%M:%fZ','now') || ' metadata-handoff session=' || ? || char(10), " +
              "    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
              "WHERE wix_subscription_id=? AND stripe_subscription_id IS NULL"
            ).bind(session.subscription, session.id, wixSubIdMeta).run();

            if ((upd.meta?.changes ?? 0) === 0) {
              // Lost the race (another retry beat us). Log and treat as handled.
              env.EVENTS?.writeDataPoint({
                blobs: ['billing', 'stuc-migration', 'metadata-no-update', wixSubIdMeta, session.subscription || ''],
                indexes: ['metadata-no-update'],
              });
              migrationHandled = true;
            } else {
              // Send admin "cancel Wix sub" email, then mark admin_notified_at.
              const donorEmail = (session.customer_details?.email || session.customer_email || wixRow.email || '').toLowerCase().trim().replace(/[\r\n]/g, '');
              const nextChargeDate = wixRow.next_expected_at
                ? new Date(wixRow.next_expected_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                : 'their next scheduled donation date';

              try {
                await sendEmailSafe(env, waitUntil, {
                  to: 'administrator@rrmacademy.org',
                  subject: `STUC migration: cancel Wix sub for ${donorEmail || wixSubIdMeta}`,
                  source: 'billing/migration-metadata',
                  text:
`${donorEmail || '(unknown email)'} just migrated Wix → Stripe via the new self-service flow.

Wix sub:        ${wixSubIdMeta}
Stripe sub:     ${session.subscription}
Tier:           ${wixRow.tier}
Amount:         ${(() => { const n = Number(wixRow.amount_cents); return (Number.isFinite(n) && n > 0) ? `$${(n / 100).toFixed(2)}/mo` : '(unknown)'; })()}
Next charge:    ${nextChargeDate}

Stripe is set to start the subscription with trial_end clamped to the donor's next
expected Wix charge date -- they will not be double-charged.

VERIFY in Stripe Dashboard that the sub status is 'active', then cancel the Wix sub
within 24 hours to prevent double-billing.

Wix Dashboard -> Subscriptions -> Cancel immediately (NOT end-of-cycle).`,
                });

                // Mark notified so cron Sweep 2 doesn't re-send.
                await db.prepare(
                  "UPDATE wix_subscription SET admin_notified_at=strftime('%s','now') WHERE wix_subscription_id=?"
                ).bind(wixSubIdMeta).run();

                env.EVENTS?.writeDataPoint({
                  blobs: ['billing', 'stuc-migration', 'metadata-handoff-ok', wixSubIdMeta, session.subscription || ''],
                  indexes: ['metadata-handoff-ok'],
                });
              } catch (notifyErr) { // arise-ignore webhook-handler-swallow -- migration UPDATE already succeeded; SES admin-notify failure is recoverable via cron Sweep 2 (admin_notified_at IS NULL retry). Re-running webhook would hit idempotent-no-changes branch and miss the alert.
                // SES failed -- log, leave admin_notified_at NULL so cron Sweep 2 retries.
                log(env, waitUntil, 'billing', 'metadata_admin_notify_fail', 'error',
                  `${wixSubIdMeta}: ${notifyErr.message}`);
              }

              migrationHandled = true;
            }
          }
        }
      } catch (metaErr) { // arise-ignore webhook-handler-swallow -- defense-in-depth: metadata-path failure deliberately falls through to email-match path below; not a dispatcher-contract violation
        // Metadata path threw -- log and fall through to email-match (defense in depth).
        log(env, waitUntil, 'billing', 'metadata_handoff_fail', 'error',
          `${wixSubIdMeta}: ${metaErr.message}`);
        env.EVENTS?.writeDataPoint({
          blobs: ['billing', 'stuc-migration', 'metadata-handoff-error', wixSubIdMeta, ''],
          indexes: ['metadata-handoff-error'],
        });
      }
    }

    // Existing email-match path runs only if metadata path didn't successfully handle.
    // TODO (future round): the email-match path has the same 3DS race condition as Bug #11.
    // It is intentionally NOT guarded here because email-match is the legacy fallback for
    // cold checkouts (no wix_subscription_id metadata) — the existing admin email already
    // says "VERIFY FIRST in Stripe Dashboard that the sub status is 'active'", which covers
    // the manual verification step. Phase 3.1 + 3.2 route all migration handoffs through the
    // metadata path, so email-match is cold-checkout-only in practice. If that changes,
    // add a stripe.subscriptions.retrieve guard here matching the metadata-path pattern.
    if (!migrationHandled && email && db) {
      try {
        const wixSubs = await db.prepare(
          "SELECT wix_subscription_id, status FROM wix_subscription " +
          "WHERE email = ? COLLATE NOCASE " +
          "ORDER BY started_at DESC"
        ).bind(email).all();
        const rows = wixSubs.results || [];
        const primary = rows[0];
        if (primary) {
          const upd = await db.prepare(
            "UPDATE wix_subscription " +
            "SET migration_status='stripe_active', " +
            "    stripe_subscription_id=?, " +
            "    migration_notes=COALESCE(migration_notes,'') || " +
            "      strftime('%Y-%m-%dT%H:%M:%fZ','now') || ' handoff session=' || ? || char(10) " +
            "WHERE wix_subscription_id=? AND stripe_subscription_id IS NULL"
          ).bind(session.subscription, session.id, primary.wix_subscription_id).run();

          if (upd.meta.changes === 0) {
            const existing = await db.prepare(
              "SELECT stripe_subscription_id FROM wix_subscription WHERE wix_subscription_id=?"
            ).bind(primary.wix_subscription_id).first();
            await sendEmailSafe(env, waitUntil, {
              to: 'administrator@rrmacademy.org',
              subject: `STUC migration: duplicate Stripe sub for ${email}`,
              source: 'billing/migration-handoff-dup',
              text:
`A second Stripe sub started for an already-handed-off donor.
Email:    ${email}
Existing: ${existing?.stripe_subscription_id || '(none)'}
New:      ${session.subscription}
Wix sub:  ${primary.wix_subscription_id}

Refund the duplicate in Stripe Dashboard, then cancel the Wix sub if not already done.`,
            });
          } else {
            const siblingLines = rows.map(r =>
              `  - ${r.wix_subscription_id} (status=${r.status})`
            ).join('\n');
            await sendEmailSafe(env, waitUntil, {
              to: 'administrator@rrmacademy.org',
              subject: `STUC migration: cancel Wix sub for ${email}`,
              source: 'billing/migration-handoff',
              text:
`${email} just started Stripe sub ${session.subscription}.

VERIFY FIRST in Stripe Dashboard that the sub status is 'active'
(checkout.session.completed fires before subscription confirms -- a 3DS
failure or card decline mid-flow can leave the customer without an
active Stripe sub. Cancelling Wix prematurely creates a coverage gap).

Once confirmed active, cancel the following Wix sub(s) within 24h
to prevent double-billing:
${siblingLines}

Wix Dashboard -> Subscriptions -> Cancel immediately (NOT end-of-cycle).`,
            });
          }
        }
      } catch (handoffErr) { // arise-ignore webhook-handler-swallow -- the catch BODY (next block) sends an explicit admin SES alert and writes AE event; the migration handoff is NOT silently dropped. Re-running the webhook would re-attempt the email-match path and double-flip migration_status. This is intentional remediation, not dispatcher swallow.
        log(env, waitUntil, 'billing', 'migration_handoff_fail', 'error',
          `${email}: ${handoffErr.message}`);
        try {
          await sendEmailSafe(env, waitUntil, {
            to: 'administrator@rrmacademy.org',
            subject: `STUC migration handoff FAILED for ${email}`,
            source: 'billing/migration-handoff-error',
            text:
`Migration handoff threw for ${email}.
Error: (see AE log for details)
Stripe sub: ${session.subscription}

To investigate, query the wix_subscription row by email or wix_subscription_id (see Analytics Engine logs for the wix_sub_id).
Manually set migration_status='stripe_active' and stripe_subscription_id to the Stripe sub ID above once you have confirmed the correct row.`,
          });
        } catch (_emailErr) {
          // intentionally swallowed - this is the error-path fallback email
          log(env, waitUntil, 'billing', 'handoff_fallback_email_failed', 'error', _emailErr.message);
        }
      }
    }
  }

  // Donor data layer: record one-time donations in donor_gift (CRM mirror).
  // STUC/course payments are swept by the rrm-observatory donor-gift-feed daemon
  // from Stripe charges, keyed on payment_intent, so they are skipped here.
  const donorGift = giftFromCheckoutSession(session, event.created);
  if (donorGift && db) {
    try {
      const res = await recordDonorGift(db, donorGift);
      log(env, waitUntil, 'billing', 'donor_gift_record', res.recorded ? 'ok' : 'skipped',
        res.recorded ? donorGift.sourceId : res.reason);
    } catch (err) {
      // Never fail the webhook over CRM mirroring; the daily daemon sweep self-heals.
      log(env, waitUntil, 'billing', 'donor_gift_record', 'error', err.message);
    }
  }

  // Supporter recognition: persist a row for consented provider-directory gifts.
  // Non-fail-soft: DB insert errors propagate so Stripe re-delivers (insert is idempotent).
  // The Stripe gift_seq count call is fail-soft (catch + skip) since a missing count is
  // not a data-integrity loss.
  if (
    session.mode === 'payment' &&
    session.metadata?.campaign === 'provider-directory' &&
    readSupporterConsent(session)
  ) {
    const displayName = deriveDisplayName(session.customer_details?.name);
    if (displayName && db) {
      let giftSeq = 0;
      try {
        const stripe = getStripeClient(env);
        let seqCount = 0;
        let hasMore = true;
        let nextPage = undefined;
        while (hasMore) {
          const params = {
            query: `status:'succeeded' AND metadata['campaign']:'provider-directory'`,
            limit: 100,
            expand: ['data.latest_charge'],
          };
          if (nextPage) params.page = nextPage;
          const page = await stripe.paymentIntents.search(params);
          for (const pi of page.data) {
            const ch = pi.latest_charge;
            const refunded = (ch && typeof ch === 'object') ? (ch.amount_refunded || 0) : 0;
            const net = Math.max(0, (pi.amount_received ?? pi.amount) - refunded);
            if (net > 0) seqCount++;
          }
          hasMore = page.has_more;
          if (hasMore && page.data.length > 0) {
            nextPage = page.next_page;
          } else {
            hasMore = false;
          }
        }
        giftSeq = seqCount;
      } catch (seqErr) {
        log(env, waitUntil, 'billing', 'supporter_seq_count_fail', 'warn', seqErr.message);
        giftSeq = 0;
      }
      await recordSupporterGift(db, {
        campaign: 'provider-directory',
        displayName,
        giftSeq,
        email: session.customer_details?.email,
        sourceId: session.payment_intent || session.id,
        occurredAt: new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      });
      log(env, waitUntil, 'billing', 'supporter_recognition_recorded', 'ok',
        `${displayName} seq=${giftSeq} src=${session.payment_intent || session.id}`);
    }
  }

  // GA4: track completed donation or membership purchase
  if (session.mode === 'payment' && (session.metadata?.type === 'donation' || !session.metadata?.type)) {
    waitUntil(sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || 0) / 100,
      transaction_id: session.payment_intent || session.id,
      items: [{ item_name: 'Donation' }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
      ...(session.metadata?.ga_entry_category && { entry_category: session.metadata.ga_entry_category }),
      ...(session.metadata?.ga_entry_platform && { entry_platform: session.metadata.ga_entry_platform }),
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
      ...(session.metadata?.ga_entry_category && { entry_category: session.metadata.ga_entry_category }),
      ...(session.metadata?.ga_entry_platform && { entry_platform: session.metadata.ga_entry_platform }),
    }, gaOverrides).catch(() => {}));
  }

  return null;
}

/**
 * Handle checkout.session.expired: release migration lock so donor can retry immediately.
 */
export async function handleCheckoutExpired(db, event, env, waitUntil) {
  const session = event.data.object;
  const wixSubId = session.metadata?.wix_subscription_id;
  if (!wixSubId || typeof wixSubId !== 'string' || !/^wxs_[a-z0-9_-]+$/i.test(wixSubId)) {
    return null;
  }
  try {
    await db.prepare(
      "UPDATE wix_subscription SET migration_handoff_started_at = NULL " +
      "WHERE wix_subscription_id = ? AND stripe_subscription_id IS NULL"
    ).bind(wixSubId).run();
    log(env, waitUntil, 'billing', 'migration_lock_released_on_expiry', 'ok', wixSubId);
    env.EVENTS?.writeDataPoint({
      blobs: ['billing', 'stuc-migration', 'lock-released-session-expired', wixSubId, session.id || ''],
      indexes: ['lock-released-session-expired'],
    });
  } catch (err) {
    log(env, waitUntil, 'billing', 'migration_lock_release_fail', 'error', `${wixSubId}: ${err.message}`);
    // Return 500 so dispatcher rolls back webhook_event dedup; Stripe retries.
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
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
  const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim().replace(/[\r\n]/g, '');

  if (!email) {
    log(env, waitUntil, 'billing', 'no_checkout_email', 'skipped', session.id);
    return;
  }

  // Case 1: User was logged in (client_reference_id = D1 user ID)
  const name = (session.customer_details?.name || '').slice(0, 200);
  const [first, ...rest] = name.split(' ');
  const emailLocalParts = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b(\w)/g, c => c.toUpperCase()).split(' ');
  const derivedFirstName = first || emailLocalParts[0] || '';
  const derivedLastName = rest.join(' ') || (first ? '' : emailLocalParts.slice(1).join(' '));

  if (session.client_reference_id) {
    if (customerId) {
      // arise-ignore unbatched-writes -- conditional UPDATE only (no second .run() in this branch path)
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

  // ELV tag (non-blocking -- payment already completed, just tag for CRM)
  // Only needed for Cases 2+3 (anonymous checkout); skip for logged-in users (Case 1).
  waitUntil(verifyAndTagEmail(email, env, {
    firstName: derivedFirstName || '', lastName: derivedLastName || '', source: 'checkout',
  }).catch(() => {}));

  // Case 2: Anonymous checkout -- check if email matches existing account
  const existing = await db.prepare('SELECT id, stripe_customer_id FROM user WHERE email = ? COLLATE NOCASE')
    .bind(email).first();

  if (existing) {
    if (customerId && !existing.stripe_customer_id) {
      await db.prepare('UPDATE user SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .bind(customerId, existing.id).run();
      log(env, waitUntil, 'billing', 'stripe_linked', 'ok', `${customerId} -> user ${existing.id} (by email)`);
    } else if (customerId && existing.stripe_customer_id && existing.stripe_customer_id !== customerId) {
      log(env, waitUntil, 'billing', 'stripe_customer_mismatch', 'warning',
        `user ${existing.id} has ${existing.stripe_customer_id} but checkout used ${customerId}`);
      if (env.AWS_ACCESS_KEY_ID) {
        waitUntil(sendEmailSafe(env, waitUntil, {
          to: 'administrator@rrmacademy.org',
          subject: `Stripe customer mismatch: ${email}`,
          source: 'billing/customer-mismatch',
          text: [
            'A Stripe customer mismatch was detected during checkout.',
            '',
            `Email:             ${email}`,
            `User ID:           ${existing.id}`,
            `Linked customer:   ${existing.stripe_customer_id}`,
            `Checkout customer: ${customerId}`,
            '',
            'The checkout customer may need to be merged in Stripe Dashboard.',
          ].join('\n'),
        }).catch(() => {}));
      }
    }
    return;
  }

  // Case 3: No account exists -- auto-create one
  // Use INSERT OR IGNORE to handle race conditions (concurrent webhook retries for same email)
  const id = generateId();

  const ins = await db.prepare(
    `INSERT OR IGNORE INTO user (id, email, email_verified, hashed_password, name, first_name, last_name, stripe_customer_id, role)
     VALUES (?, ?, 1, '', ?, ?, ?, ?, 'member')`
  ).bind(id, email, name || null, derivedFirstName || null, derivedLastName || null, customerId || null).run();

  if (ins.meta.changes === 0) {
    // Another request created the account first -- atomically link Stripe ID to existing account.
    // Single UPDATE keyed by email (COLLATE NOCASE via idx_user_email_nocase index) with
    // COALESCE so an already-set customer_id is preserved and only a NULL slot gets filled.
    // This avoids the SELECT-then-UPDATE race where a third concurrent webhook could update
    // between our SELECT and UPDATE.
    if (customerId) {
      const upd = await db.prepare(
        "UPDATE user SET stripe_customer_id = COALESCE(stripe_customer_id, ?), updated_at = datetime('now') WHERE email = ? COLLATE NOCASE AND (stripe_customer_id IS NULL OR stripe_customer_id = ?)"
      ).bind(customerId, email, customerId).run();
      if (upd.meta.changes === 0) {
        log(env, waitUntil, 'billing', 'orphaned_stripe_customer', 'warning',
          `${email} already linked to different customer, ${customerId} orphaned`);
        if (env.AWS_ACCESS_KEY_ID) {
          waitUntil(sendEmailSafe(env, waitUntil, {
            to: 'administrator@rrmacademy.org',
            subject: `Orphaned Stripe customer: ${customerId}`,
            source: 'billing/orphaned-customer',
            text: [
              'A concurrent checkout created an orphaned Stripe customer.',
              '',
              `Email:             ${email}`,
              `Orphaned customer: ${customerId}`,
              '',
              'This customer has no D1 user linked. Consider merging in Stripe Dashboard.',
            ].join('\n'),
          }).catch(() => {}));
        }
      }
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

      // ON CONFLICT: idx_password_reset_user_purpose UNIQUE(user_id, purpose) (migration 020)
      // ensures at most one welcome token per user. Stripe deduplication via webhook_event
      // prevents double-sends, but ON CONFLICT avoids a UNIQUE error on re-drive edge cases.
      await db.prepare(
        "INSERT INTO password_reset (id, user_id, token_hash, expires_at, purpose) VALUES (?, ?, ?, ?, 'welcome') ON CONFLICT(user_id, purpose) DO UPDATE SET id = excluded.id, token_hash = excluded.token_hash, expires_at = excluded.expires_at"
      ).bind(generateId(), id, tokenHash, expiresAt).run();

      const setPasswordUrl = `${SITE_URL}/reset-password/?token=${token}`;

      waitUntil(sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Your RRM Academy account is ready',
        source: 'billing/checkout-account',
        text: [
          `Hi ${derivedFirstName || 'there'},`,
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
      }).catch(() => {}));
      log(env, waitUntil, 'billing', 'welcome_email_sent', 'ok', `${email} account=${id}`);
    } catch (tokenErr) {
      log(env, waitUntil, 'billing', 'welcome_setup_fail', 'error', `${email}: ${tokenErr.message}`);
    }
  } else {
    log(env, waitUntil, 'billing', 'welcome_email_skipped', 'skipped', `${email} account=${id} (SES not configured)`);
  }
}
