# Webhook Decomposition + Endpoint Template Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `stripe-webhook.js` (509 lines) into focused per-event handler files and create a canonical endpoint template to prevent sibling divergence.

**Architecture:** Pure refactoring -- no logic changes. Extract event handlers into `billing/_webhook-*.js` files, slim entry point to sig verify + dedup + dispatch. Create reference template and fix one live divergence (`contact/submit.js`).

**Tech Stack:** Cloudflare Pages Functions, Stripe SDK, D1, SES (aws4fetch)

**Spec:** `docs/superpowers/specs/2026-03-10-webhook-decomposition-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `functions/api/billing/_webhook-shared.js` | `getEmailByStripeCustomer`, `sendEmailSafe` |
| Create | `functions/api/billing/_webhook-checkout.js` | `handleCheckoutCompleted` + `ensureAccountForCheckout` |
| Create | `functions/api/billing/_webhook-subscription.js` | `handleSubscriptionUpdated`, `handleSubscriptionDeleted` |
| Create | `functions/api/billing/_webhook-invoice.js` | `handlePaymentFailed` |
| Rewrite | `functions/api/stripe-webhook.js` | Slim entry: sig verify, dedup, switch dispatch |
| Create | `functions/api/_endpoint-template.js` | Reference-only canonical endpoint pattern |
| Modify | `functions/api/contact/submit.js` | Replace local `json()`/`CORS_HEADERS` with shared imports |
| Modify | `guard-manifest.json` | Regenerate hashes |

---

## Chunk 1: Extract Webhook Handlers

### Task 1: Create `billing/_webhook-shared.js`

**Files:**
- Create: `functions/api/billing/_webhook-shared.js`

- [ ] **Step 1: Create the shared helpers file**

```js
/**
 * Shared utilities for Stripe webhook event handlers.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 */
import { sendEmail as sesSendEmail } from '../_ses.js';
import { log } from '../_log.js';

/**
 * Look up a user's email by their Stripe customer ID.
 * Returns null if not found.
 */
export async function getEmailByStripeCustomer(db, stripeCustomerId, env, waitUntil) {
  if (!stripeCustomerId) return null;
  try {
    const row = await db.prepare('SELECT email FROM user WHERE stripe_customer_id = ?')
      .bind(stripeCustomerId).first();
    return row?.email || null;
  } catch (err) {
    log(env, waitUntil, 'billing', 'email_lookup_fail', 'error', `${stripeCustomerId}: ${err.message}`);
    return null;
  }
}

/**
 * Send a transactional email via SES.
 * Logs errors but does not throw -- email failure should not block webhook processing.
 */
export async function sendEmailSafe(env, waitUntil, { to, subject, text }) {
  try {
    await sesSendEmail(env, {
      from: 'RRM Academy <accounts@mail.rrmacademy.org>',
      to,
      subject,
      text,
    });
  } catch (err) {
    log(env, waitUntil, 'billing', 'email_send_fail', 'error', `${to}: ${err.message}`);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/brian/iCode/projects/rrm-academy-cf && npx wrangler pages functions build --outdir=dist 2>&1 | tail -5`
Expected: Build succeeds (new file is `_`-prefixed, no new routes)

- [ ] **Step 3: Commit**

```bash
git add functions/api/billing/_webhook-shared.js
git commit -m "refactor: extract webhook shared helpers to billing/_webhook-shared.js"
```

---

### Task 2: Create `billing/_webhook-checkout.js`

**Files:**
- Create: `functions/api/billing/_webhook-checkout.js`

This is the largest handler. It contains `handleCheckoutCompleted` (the exported handler) and `ensureAccountForCheckout` (private helper, only called from this file).

- [ ] **Step 1: Create the checkout handler file**

```js
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
import { sendEmail as sesSendEmail } from '../_ses.js';
import { sendGA4Event } from '../_ga4.js';
import { log } from '../_log.js';
import { sendEmailSafe } from './_webhook-shared.js';

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
    return new Response(JSON.stringify({ error: 'Account linkage failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Course purchase: create enrollment
  if (session.metadata?.type === 'course' && session.client_reference_id) {
    const courseId = session.metadata.courseId;
    const paymentIntent = session.payment_intent;
    if (!getCourse(courseId)) {
      log(env, waitUntil, 'billing', 'course_not_found', 'error', `${courseId} user=${session.client_reference_id}`);
    } else {
      // eslint-disable-next-line no-useless-assignment -- readability: tracks enrollment state for email below
      let enrolled = false;
      try {
        await enrollUser(db, session.client_reference_id, courseId, paymentIntent);
        log(env, waitUntil, 'billing', 'course_enrolled', 'ok', `${courseId} user=${session.client_reference_id}`);
        enrolled = true;
      } catch (enrollErr) {
        log(env, waitUntil, 'billing', 'course_enroll_fail', 'error', `${courseId}: ${enrollErr.message}`, 0, 500);
        // Return 500 so Stripe retries the webhook -- don't silently eat enrollment failures
        return new Response(JSON.stringify({ error: 'Enrollment failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Send course enrollment confirmation email
      if (enrolled) {
        const email = session.customer_details?.email || session.customer_email;
        const name = session.customer_details?.name || '';
        if (email && env.AWS_ACCESS_KEY_ID) {
          try {
            await sesSendEmail(env, {
              from: 'RRM Academy <accounts@mail.rrmacademy.org>',
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
                'A project of the RRM Foundation \u2014 501(c)(3), EIN: 93-4594315',
              ].join('\n'),
            });
            log(env, waitUntil, 'billing', 'enrollment_email_sent', 'ok', `${email} ${courseId}`);
          } catch (emailErr) {
            log(env, waitUntil, 'billing', 'enrollment_email_fail', 'error', `${email}: ${emailErr.message}`);
          }
        }
      }
    }
  } else if (session.metadata?.type === 'course' && !session.client_reference_id) {
    log(env, waitUntil, 'billing', 'course_no_ref_id', 'skipped', `courseId:${session.metadata.courseId} customer:${session.customer}`);
  }

  // Build GA4 identity overrides from checkout metadata (real user, not Stripe server)
  const gaOverrides = {};
  if (session.metadata?.ga_client_id) gaOverrides.client_id = session.metadata.ga_client_id;
  if (session.metadata?.ga_session_id) gaOverrides.session_id = Number(session.metadata.ga_session_id);

  const pageLocation = session.success_url?.replace(/\?.*$/, '') || SITE_URL;

  // GA4: track completed course purchase
  if (session.metadata?.type === 'course' && session.payment_intent) {
    sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || 0) / 100,
      transaction_id: session.payment_intent,
      items: [{ item_name: `Course: ${session.metadata.courseId || 'unknown'}` }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
    }, gaOverrides).catch(() => {});
  }

  // Send membership confirmation email for STUC subscriptions
  const stucTiers = { member: 'Member', hero: 'Uterus Hero', superhero: 'Super Hero' };
  const tier = session.metadata?.tier || '';
  if (session.mode === 'subscription' && stucTiers[tier] && env.AWS_ACCESS_KEY_ID) {
    const email = session.customer_details?.email || session.customer_email;
    const name = session.customer_details?.name || '';
    const tierLabel = stucTiers[tier];

    if (email) {
      try {
        await sesSendEmail(env, {
          from: 'RRM Academy <accounts@mail.rrmacademy.org>',
          to: email,
          subject: 'Welcome to the Save the Uterus Club',
          text: [
            `Hi ${name || 'there'},`,
            '',
            `Welcome to the Save the Uterus Club! You're now a ${tierLabel} member.`,
            '',
            'Here\'s what to do next:',
            '',
            '1. Join the member group \u2014 this is where live call dates, resources, and discussion happen:',
            `   ${SITE_URL}/community`,
            '',
            '2. Join the free Uterus Allies group chat on Instagram:',
            '   https://www.instagram.com/direct/t/7768750249851959/',
            '',
            '3. Explore the Research Library \u2014 over 3,000 peer-reviewed resources:',
            `   ${SITE_URL}/library`,
            '',
            `You can manage your membership anytime at ${SITE_URL}/account`,
            '',
            'Thank you for supporting evidence-based reproductive health.',
            '',
            'RRM Academy',
            'A project of the RRM Foundation \u2014 501(c)(3), EIN: 93-4594315',
          ].join('\n'),
        });
        log(env, waitUntil, 'billing', 'membership_email_sent', 'ok', `${email} ${tierLabel}`);
      } catch (emailErr) {
        log(env, waitUntil, 'billing', 'membership_email_fail', 'error', `${email}: ${emailErr.message}`);
      }
    }
  }

  // GA4: track completed donation or membership purchase
  if (session.mode === 'payment') {
    sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || 0) / 100,
      transaction_id: session.payment_intent || session.id,
      items: [{ item_name: 'Donation' }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
    }, gaOverrides).catch(() => {});
  } else if (session.mode === 'subscription' && stucTiers[tier]) {
    sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || 0) / 100,
      transaction_id: session.subscription || session.id,
      items: [{ item_name: `STUC ${stucTiers[tier]}` }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
    }, gaOverrides).catch(() => {});
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
  const id = generateId();
  const name = session.customer_details?.name || '';

  const ins = await db.prepare(
    `INSERT OR IGNORE INTO user (id, email, email_verified, hashed_password, name, stripe_customer_id, role)
     VALUES (?, ?, 1, '', ?, ?, 'member')`
  ).bind(id, email, name, customerId || null).run();

  if (ins.meta.changes === 0) {
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
        'A project of the RRM Foundation \u2014 501(c)(3), EIN: 93-4594315',
      ].join('\n'),
    });
    log(env, waitUntil, 'billing', 'welcome_email_sent', 'ok', `${email} account=${id}`);
  }
}
```

**Critical check:** Compare character-for-character with the original `stripe-webhook.js` lines 103-475. The only changes should be:
- Function signature: `handleCheckoutCompleted(db, event, env, request, waitUntil)` instead of inline switch case
- Extracts `session = event.data.object` at the top
- Returns `null` instead of `break` at the end
- Import paths adjusted (`../` instead of `./`)
- `ensureAccountForCheckout` is private to this file (not exported)
- Em dashes in email text use `\u2014` (the original file had literal `\u2014` characters)

- [ ] **Step 2: Verify build**

Run: `cd /Users/brian/iCode/projects/rrm-academy-cf && npx wrangler pages functions build --outdir=dist 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add functions/api/billing/_webhook-checkout.js
git commit -m "refactor: extract checkout handler to billing/_webhook-checkout.js"
```

---

### Task 3: Create `billing/_webhook-subscription.js`

**Files:**
- Create: `functions/api/billing/_webhook-subscription.js`

- [ ] **Step 1: Create the subscription handler file**

```js
/**
 * Handlers for Stripe subscription webhook events.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 *
 * - customer.subscription.updated: notify user on past_due
 * - customer.subscription.deleted: send cancellation confirmation
 */
import { SITE_URL } from '../auth/_shared.js';
import { log } from '../_log.js';
import { getEmailByStripeCustomer, sendEmailSafe } from './_webhook-shared.js';

/**
 * @param {D1Database} db
 * @param {Stripe.Event} event
 * @param {Object} env
 * @param {Request} request
 * @param {Function} waitUntil
 * @returns {null}
 */
export async function handleSubscriptionUpdated(db, event, env, request, waitUntil) {
  const sub = event.data.object;
  log(env, waitUntil, 'billing', 'subscription_updated', 'ok', `${sub.id} status=${sub.status}`);

  // Notify user when subscription goes past_due (payment retry failing)
  if (sub.status === 'past_due' && env.AWS_ACCESS_KEY_ID) {
    const email = await getEmailByStripeCustomer(db, sub.customer, env, waitUntil);
    if (email) {
      await sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Action needed: update your payment method',
        text: [
          'Hi there,',
          '',
          'We were unable to process your most recent payment for your Save the Uterus Club membership.',
          '',
          'Please update your payment method to keep your membership active:',
          `${SITE_URL}/account`,
          '',
          `If you have questions, reply to this email or contact us at ${SITE_URL}/contact`,
          '',
          'RRM Academy',
          'A project of the RRM Foundation \u2014 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      });
      log(env, waitUntil, 'billing', 'past_due_notified', 'ok', email);
    }
  }

  return null;
}

/**
 * @param {D1Database} db
 * @param {Stripe.Event} event
 * @param {Object} env
 * @param {Request} request
 * @param {Function} waitUntil
 * @returns {null}
 */
export async function handleSubscriptionDeleted(db, event, env, request, waitUntil) {
  const sub = event.data.object;
  log(env, waitUntil, 'billing', 'subscription_deleted', 'ok', `${sub.id} customer=${sub.customer}`);

  // Send cancellation confirmation email
  if (env.AWS_ACCESS_KEY_ID) {
    const email = await getEmailByStripeCustomer(db, sub.customer, env, waitUntil);
    if (email) {
      await sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Your Save the Uterus Club membership has ended',
        text: [
          'Hi there,',
          '',
          'Your Save the Uterus Club membership has been cancelled.',
          '',
          'You still have access to any courses you purchased separately.',
          '',
          'If you\'d like to rejoin, you can do so anytime at:',
          `${SITE_URL}/save-the-uterus-club`,
          '',
          'Thank you for supporting evidence-based reproductive health.',
          '',
          'RRM Academy',
          'A project of the RRM Foundation \u2014 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      });
      log(env, waitUntil, 'billing', 'cancellation_email_sent', 'ok', email);
    }
  }

  return null;
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/brian/iCode/projects/rrm-academy-cf && npx wrangler pages functions build --outdir=dist 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add functions/api/billing/_webhook-subscription.js
git commit -m "refactor: extract subscription handlers to billing/_webhook-subscription.js"
```

---

### Task 4: Create `billing/_webhook-invoice.js`

**Files:**
- Create: `functions/api/billing/_webhook-invoice.js`

- [ ] **Step 1: Create the invoice handler file**

```js
/**
 * Handler for Stripe invoice.payment_failed webhook events.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 */
import { SITE_URL } from '../auth/_shared.js';
import { log } from '../_log.js';
import { getEmailByStripeCustomer, sendEmailSafe } from './_webhook-shared.js';

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
      await sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Payment failed for your RRM Academy membership',
        text: [
          'Hi there,',
          '',
          'Your most recent membership payment could not be processed.',
          '',
          'Stripe will automatically retry, but you can update your payment method now:',
          `${SITE_URL}/account`,
          '',
          'If your payment method is not updated, your membership may be cancelled.',
          '',
          `If you have questions, contact us at ${SITE_URL}/contact`,
          '',
          'RRM Academy',
          'A project of the RRM Foundation \u2014 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      });
      log(env, waitUntil, 'billing', 'payment_failed_notified', 'ok', email);
    }
  }

  return null;
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/brian/iCode/projects/rrm-academy-cf && npx wrangler pages functions build --outdir=dist 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add functions/api/billing/_webhook-invoice.js
git commit -m "refactor: extract invoice handler to billing/_webhook-invoice.js"
```

---

### Task 5: Rewrite `stripe-webhook.js` as slim entry point

**Files:**
- Rewrite: `functions/api/stripe-webhook.js`

This is the critical task. The entry point keeps: Stripe init, signature verification, dedup, and the switch dispatch. All business logic is now in the imported handlers.

- [ ] **Step 1: Rewrite the entry point**

Replace the entire contents of `functions/api/stripe-webhook.js` with:

```js
/**
 * POST /api/stripe-webhook
 * Receives Stripe webhook events and processes them.
 *
 * Events handled:
 *   - checkout.session.completed      -> billing/_webhook-checkout.js
 *   - customer.subscription.updated   -> billing/_webhook-subscription.js
 *   - customer.subscription.deleted   -> billing/_webhook-subscription.js
 *   - invoice.payment_failed          -> billing/_webhook-invoice.js
 *
 * No CORS headers -- this is a server-to-server endpoint called by Stripe.
 * Uses constructEventAsync for CF Workers (async Web Crypto API).
 *
 * NOTE: Billing status (/api/billing/status) queries Stripe directly, so
 * subscription state is always fresh in the UI without needing D1 sync.
 */
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from './auth/_shared.js';
import { handleCheckoutCompleted } from './billing/_webhook-checkout.js';
import { handleSubscriptionUpdated, handleSubscriptionDeleted } from './billing/_webhook-subscription.js';
import { handlePaymentFailed } from './billing/_webhook-invoice.js';
import { log } from './_log.js';

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    return await handleWebhook(request, env, waitUntil);
  } catch (err) {
    console.error('Unhandled webhook error:', err.message, err.stack);
    log(env, waitUntil, 'billing', 'webhook_error', 'error', err.message, 0, 500);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleWebhook(request, env, waitUntil) {
  const stripeKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'Webhook not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: STRIPE_API_VERSION,
  });

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    log(env, waitUntil, 'billing', 'webhook_sig_fail', 'error', err.message, 0, 400);
    return new Response(JSON.stringify({ ok: false, error: 'Invalid signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = env.DB;
  if (!db) {
    console.error('DB binding missing -- cannot process webhook event');
    log(env, waitUntil, 'billing', 'webhook_no_db', 'error', event.id, 0, 500);
    return new Response(JSON.stringify({ ok: false, error: 'DB not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Deduplicate: skip events already processed (Stripe retries send same event.id)
  try {
    const ins = await db.prepare('INSERT OR IGNORE INTO webhook_event (event_id) VALUES (?)').bind(event.id).run();
    if (ins.meta.changes === 0) {
      log(env, waitUntil, 'billing', 'webhook_duplicate', 'skipped', event.id);
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (_e) {
    // Table may not exist yet -- proceed without dedup
    log(env, waitUntil, 'billing', 'dedup_check_fail', 'error', _e.message);
  }

  // Dispatch to per-event handler. Handlers return Response (to short-circuit) or null (200).
  let result = null;
  switch (event.type) {
    case 'checkout.session.completed':
      result = await handleCheckoutCompleted(db, event, env, request, waitUntil);
      break;
    case 'customer.subscription.updated':
      result = await handleSubscriptionUpdated(db, event, env, request, waitUntil);
      break;
    case 'customer.subscription.deleted':
      result = await handleSubscriptionDeleted(db, event, env, request, waitUntil);
      break;
    case 'invoice.payment_failed':
      result = await handlePaymentFailed(db, event, env, request, waitUntil);
      break;
    default:
      log(env, waitUntil, 'billing', 'webhook_unhandled', 'skipped', event.type);
  }

  if (result) return result;

  // Always return 200 to acknowledge receipt
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

**Verification checklist:**
- `stripe-signature` header check: present (line with `request.headers.get('stripe-signature')`)
- `constructEventAsync`: present (line with `stripe.webhooks.constructEventAsync`)
- No business logic in this file -- only infrastructure (verify, dedup, route)
- Import paths: `./auth/_shared.js`, `./billing/_webhook-*.js`, `./_log.js`

- [ ] **Step 2: Verify build**

Run: `cd /Users/brian/iCode/projects/rrm-academy-cf && npx wrangler pages functions build --outdir=dist 2>&1 | tail -5`
Expected: Build succeeds. No new routes (handlers are `_`-prefixed).

- [ ] **Step 3: Verify line count**

Run: `wc -l functions/api/stripe-webhook.js`
Expected: Under 120 lines

- [ ] **Step 4: Commit**

```bash
git add functions/api/stripe-webhook.js
git commit -m "refactor: slim stripe-webhook.js to entry point, dispatch to per-event handlers"
```

---

## Chunk 2: Endpoint Template + Contact Fix + Guard

### Task 6: Create endpoint template

**Files:**
- Create: `functions/api/_endpoint-template.js`

- [ ] **Step 1: Create the reference template**

```js
/**
 * REFERENCE ONLY -- do not import this file.
 *
 * Canonical endpoint pattern for CF Pages Functions.
 * Copy this when creating new endpoints. Derived from /arise-intel analysis
 * of 35 sibling-divergence bugs across 11 /arise runs (2026-03-10).
 *
 * Conventions enforced:
 * 1. Import json, optionsResponse from auth/_shared.js (never define locally)
 * 2. Import log from _log.js
 * 3. Export onRequestOptions -> optionsResponse()
 * 4. Export onRequest[Method] with outer try/catch
 * 5. Inner handler: DB check -> auth -> validate input -> business logic -> json response
 * 6. Never leak err.message to client (generic error string only)
 * 7. Wrap external service calls (Stripe, SES, fetch) in try/catch
 */

// --- Example: authenticated POST endpoint ---

// DELETE THIS LINE: import { json, optionsResponse, getSessionIdFromCookie, validateSession, checkRateLimit } from './auth/_shared.js';
// DELETE THIS LINE: import { log } from './_log.js';

/*
export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    return await handlePost(request, env, waitUntil);
  } catch (err) {
    log(env, waitUntil, 'DOMAIN', 'ACTION_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

async function handlePost(request, env, waitUntil) {
  // 1. Check required bindings
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

  // 2. Authenticate (skip for public endpoints)
  const session = await validateSession(db, getSessionIdFromCookie(request));
  if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

  // 3. Rate limit (for endpoints that create resources or send email)
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(`action:${ip}`)) {
    return json({ ok: false, error: 'Too many requests' }, 429);
  }

  // 4. Parse and validate input
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { fieldA, fieldB } = body;
  if (typeof fieldA !== 'string' || fieldA.length > 200) {
    return json({ ok: false, error: 'Invalid fieldA' }, 400);
  }

  // 5. Business logic
  // ...

  // 6. External service calls -- always wrap in try/catch
  // try {
  //   await stripe.subscriptions.list({ ... });
  // } catch (err) {
  //   log(env, waitUntil, 'DOMAIN', 'stripe_error', 'error', err.message, 0, 502);
  //   return json({ ok: false, error: 'Payment service unavailable' }, 502);
  // }

  // 7. Return structured response
  return json({ ok: true, data: {} });
}
*/
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/_endpoint-template.js
git commit -m "docs: add canonical endpoint template to prevent sibling divergence"
```

---

### Task 7: Fix `contact/submit.js` divergence

**Files:**
- Modify: `functions/api/contact/submit.js:1-23`

- [ ] **Step 1: Replace local definitions with shared imports**

Replace lines 1-23 of `functions/api/contact/submit.js`:

```js
/**
 * POST /api/contact/submit
 * Validates Turnstile token, rate-limits by IP, sends email via SES.
 */
import { sendEmail } from '../_ses.js';
import { log } from '../_log.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://rrmacademy.org',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
```

With:

```js
/**
 * POST /api/contact/submit
 * Validates Turnstile token, rate-limits by IP, sends email via SES.
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { sendEmail } from '../_ses.js';
import { log } from '../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}
```

**Behavioral equivalence note:** The shared `CORS_HEADERS` includes `Access-Control-Allow-Credentials: true` and broader `Access-Control-Allow-Methods` (adds GET, PATCH, DELETE). Both are harmless additions -- the endpoint only exports `onRequestPost` and `onRequestOptions`, so CF Pages rejects other methods before CORS matters. The credential header is a no-op since this endpoint doesn't use cookies.

- [ ] **Step 2: Verify build**

Run: `cd /Users/brian/iCode/projects/rrm-academy-cf && npx wrangler pages functions build --outdir=dist 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add functions/api/contact/submit.js
git commit -m "refactor: use shared json/optionsResponse in contact/submit.js"
```

---

### Task 8: Update guard manifest and final verification

**Files:**
- Modify: `guard-manifest.json`

- [ ] **Step 1: Update guard manifest**

Run: `cd /Users/brian/iCode/projects/rrm-academy-cf && npm run guard:update`
Expected: Manifest regenerated with new hashes for `stripe-webhook.js` and `contact/submit.js` (if guarded).

- [ ] **Step 2: Verify guard passes**

Run: `npm run guard`
Expected: All checks pass, including security invariants (`stripe-signature` + `constructEventAsync` in `stripe-webhook.js`).

- [ ] **Step 3: Full build verification**

Run: `npx wrangler pages functions build --outdir=dist 2>&1 | tail -10`
Expected: Build succeeds. Verify no unexpected routes by checking output for `_webhook` -- these should NOT appear as route entries.

- [ ] **Step 4: Verify line counts**

Run: `wc -l functions/api/stripe-webhook.js functions/api/billing/_webhook-*.js`
Expected:
- `stripe-webhook.js`: ~105 lines
- `_webhook-checkout.js`: ~195 lines
- `_webhook-subscription.js`: ~70 lines
- `_webhook-invoice.js`: ~40 lines
- `_webhook-shared.js`: ~35 lines

- [ ] **Step 5: Commit guard manifest**

```bash
git add guard-manifest.json
git commit -m "chore: update guard manifest after webhook decomposition"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```
