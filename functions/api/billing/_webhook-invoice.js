/**
 * Handler for Stripe invoice webhook events.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 *
 * handlePaymentFailed -- invoice.payment_failed: notify user about failed payment
 * handleInvoicePaid  -- invoice.paid: record recurring donation gift for provider-directory subs
 */
import { SITE_URL } from '../auth/_shared.js';
import { log } from '../_log.js';
import { getEmailByStripeCustomer, sendEmailSafe } from './_webhook-shared.js';
import { recordDonorGift } from './_donor-gift.js';
import { deriveDisplayName, readSupporterConsent, recordSupporterGift } from './_supporter-gift.js';
import { countCampaignSupporters } from './_campaign-count.js';
import { getStripeClient } from './_shared.js';

/**
 * @param {D1Database} db
 * @param {Stripe.Event} event
 * @param {Object} env
 * @param {Request} request
 * @param {Function} waitUntil
 * @returns {null}
 */
export async function handlePaymentFailed(db, event, env, request, waitUntil) {
  const invoice = event.data.object;
  log(env, waitUntil, 'billing', 'payment_failed', 'error', `${invoice.id} customer=${invoice.customer}`);

  // Email user about the failed payment
  if (env.AWS_ACCESS_KEY_ID) {
    const email = await getEmailByStripeCustomer(db, invoice.customer, env, waitUntil);
    if (email) {
      waitUntil(sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Payment failed for your RRM Academy membership',
        source: 'billing/invoice-failed',
        text: [
          'Hi there,',
          '',
          'Your most recent membership payment could not be processed.',
          '',
          'Stripe will automatically retry, but you can update your payment method now:',
          `${SITE_URL}/account/`,
          '',
          'If your payment method is not updated, your membership may be cancelled.',
          '',
          `If you have questions, contact us at ${SITE_URL}/contact/`,
          '',
          'RRM Academy',
          'A project of the RRM Foundation -- 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      }).catch(() => {}));
      log(env, waitUntil, 'billing', 'payment_failed_notified', 'ok', email);
    }
  }

  return null;
}

/**
 * Handle invoice.paid for provider-directory recurring subscriptions.
 *
 * Acts only when:
 *   - invoice.subscription is set (subscription invoice, not a one-time charge)
 *   - the subscription's metadata.campaign === 'provider-directory'
 *
 * For any other invoice (STUC, course, unrelated) this function returns null
 * and leaves all existing handling untouched.
 *
 * Gift dedup key: (source='stripe', source_id=invoice.id) -- per invoice, not
 * per subscription, so each monthly charge produces one gift row. The
 * ON CONFLICT(source, source_id) DO NOTHING inside recordDonorGift makes
 * Stripe webhook retries safe.
 *
 * Supporter recognition fires ONCE: only on billing_reason==='subscription_create'
 * (the first invoice). Consent is read from the originating checkout session's
 * custom_fields (Stripe does NOT auto-copy custom_fields into subscription.metadata).
 * The session is retrieved via stripe.checkout.sessions.list({ subscription }).
 * sourceId for supporter_recognition = the subscription id so that Stripe retries
 * on the same first-invoice event dedup to one row.
 *
 * Fail-hard posture for the gift INSERT: errors propagate to the dispatcher,
 * which rolls back the webhook_event dedup row so Stripe re-delivers and retries.
 * This matches the SP1 webhook posture described in CLAUDE.md.
 *
 * Fail-soft posture for supporter recognition: errors are caught and logged but
 * do not block the gift (a missing supporter row is recoverable; a missing gift
 * row is not).
 *
 * @param {D1Database} db
 * @param {Stripe.Event} event
 * @param {Object} env
 * @param {Request} request
 * @param {Function} waitUntil
 * @returns {Response|null}
 */
export async function handleInvoicePaid(db, event, env, request, waitUntil) {
  const invoice = event.data.object;

  // Only handle subscription invoices.
  if (!invoice.subscription) return null;

  // Retrieve the subscription to read its metadata.campaign.
  // The invoice object itself may not carry subscription metadata reliably.
  const stripe = getStripeClient(env);
  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(invoice.subscription);
  } catch (err) {
    log(env, waitUntil, 'billing', 'invoice_paid_sub_retrieve_fail', 'error',
      `${invoice.id} sub=${invoice.subscription}: ${err.message}`);
    // Return 500 so dispatcher rolls back dedup and Stripe retries.
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Only process provider-directory campaign subscriptions.
  if (sub.metadata?.campaign !== 'provider-directory') return null;

  log(env, waitUntil, 'billing', 'invoice_paid_recurring', 'ok',
    `${invoice.id} sub=${invoice.subscription} amount=${invoice.amount_paid}`);

  // Resolve donor email: invoice.customer_email preferred; fallback to D1 lookup.
  let email = invoice.customer_email || null;
  if (!email) {
    email = await getEmailByStripeCustomer(db, invoice.customer, env, waitUntil);
  }

  // Record the gift. Fail-hard: errors propagate so Stripe retries.
  // sourceId = invoice.id (not subscription id) so each charge gets its own row.
  await recordDonorGift(db, {
    email: email || '',
    displayName: '',
    amountCents: invoice.amount_paid,
    source: 'stripe',
    sourceId: invoice.id,
    entity: 'foundation',
    kind: 'recurring',
    occurredAt: new Date(invoice.created * 1000).toISOString(),
    currency: invoice.currency || 'usd',
  });

  log(env, waitUntil, 'billing', 'recurring_gift_recorded', 'ok',
    `invoice=${invoice.id} sub=${invoice.subscription}`);

  // Supporter recognition: only on the first invoice for this subscription.
  // billing_reason==='subscription_create' is Stripe's canonical marker for the
  // invoice generated when a subscription first starts.
  if (invoice.billing_reason === 'subscription_create') {
    try {
      // Retrieve the originating checkout session to read custom_fields consent.
      // Stripe does NOT auto-propagate custom_fields into subscription.metadata,
      // so we must look up the session that created this subscription.
      let consentSession = null;
      try {
        const sessions = await stripe.checkout.sessions.list({ subscription: invoice.subscription, limit: 1 });
        consentSession = sessions?.data?.[0] || null;
      } catch (sessionErr) {
        log(env, waitUntil, 'billing', 'invoice_paid_session_retrieve_fail', 'warn',
          `sub=${invoice.subscription}: ${sessionErr.message}`);
      }

      const showSupporter = consentSession ? readSupporterConsent(consentSession) : false;

      if (showSupporter) {
        const rawName = consentSession?.customer_details?.name || '';
        const displayName = deriveDisplayName(rawName);
        if (displayName) {
          const giftSeq = (await countCampaignSupporters(db, 'provider-directory')) + 1;
          const res = await recordSupporterGift(db, {
            campaign: 'provider-directory',
            displayName,
            giftSeq,
            email: email || '',
            // sourceId is the SUBSCRIPTION id so that Stripe webhook retries for the
            // same first-invoice event all dedup to one supporter_recognition row
            // (ON CONFLICT(source, source_id) DO NOTHING).
            sourceId: invoice.subscription,
            occurredAt: new Date(invoice.created * 1000).toISOString(),
          });
          if (res.recorded) {
            log(env, waitUntil, 'billing', 'recurring_supporter_recorded', 'ok',
              `${displayName} seq=${giftSeq} sub=${invoice.subscription}`);
          }
        }
      }
    } catch (err) {
      // Fail-soft: never block the gift over a missing supporter row.
      log(env, waitUntil, 'billing', 'recurring_supporter_fail', 'warn',
        `sub=${invoice.subscription}: ${err.message}`);
    }
  }

  return null;
}
