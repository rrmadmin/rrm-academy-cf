/**
 * POST /api/stripe-webhook
 * Receives Stripe webhook events and processes them.
 *
 * Events handled:
 *   - checkout.session.completed      → link stripe_customer_id to D1 user + course enrollment
 *   - customer.subscription.updated   → notify user on past_due / tier change
 *   - customer.subscription.deleted   → email cancellation confirmation
 *   - invoice.payment_failed          → email user to update payment method
 *
 * No CORS headers — this is a server-to-server endpoint called by Stripe.
 * Uses constructEventAsync for CF Workers (async Web Crypto API).
 *
 * NOTE: Billing status (/api/billing/status) queries Stripe directly, so
 * subscription state is always fresh in the UI without needing D1 sync.
 */
import Stripe from 'stripe';
import { enrollUser } from './courses/enroll.js';
import { getCourse } from './courses/_shared.js';

export async function onRequestPost({ request, env }) {
  try {
    return await handleWebhook(request, env);
  } catch (err) {
    console.error('Unhandled webhook error:', err.message, err.stack);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleWebhook(request, env) {
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
    apiVersion: '2024-12-18.acacia',
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
    console.error('Webhook signature verification failed:', err.message);
    return new Response(JSON.stringify({ ok: false, error: 'Invalid signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = env.DB;
  if (!db) {
    console.error('DB binding missing — cannot process webhook event');
    return new Response(JSON.stringify({ ok: false, error: 'DB not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer;

      // Link Stripe customer to D1 user (requires customerId)
      if (customerId) {
        try {
          // Priority 1: client_reference_id (D1 user ID set during checkout)
          if (session.client_reference_id) {
            await db.prepare(
              'UPDATE user SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE id = ? AND (stripe_customer_id IS NULL OR stripe_customer_id = ?)'
            ).bind(customerId, session.client_reference_id, customerId).run();
            console.log(`Linked Stripe ${customerId} to user ${session.client_reference_id} (by ID)`);
          } else {
            // Priority 2: email match
            const emailForLink = session.customer_details?.email || session.customer_email;
            if (emailForLink) {
              const result = await db.prepare(
                'UPDATE user SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE email = ? COLLATE NOCASE AND stripe_customer_id IS NULL'
              ).bind(customerId, emailForLink.toLowerCase()).run();
              if (result.meta?.changes > 0) {
                console.log(`Linked Stripe ${customerId} to user by email ${emailForLink}`);
              }
            }
          }
        } catch (linkErr) {
          console.error(`Failed to link Stripe customer ${customerId}:`, linkErr.message);
        }
      }

      // Course purchase: create enrollment
      if (session.metadata?.type === 'course' && session.client_reference_id) {
        const courseId = session.metadata.courseId;
        const paymentIntent = session.payment_intent;
        if (!getCourse(courseId)) {
          console.error(`Course ${courseId} not found in catalog — skipping enrollment for user ${session.client_reference_id}`);
        } else {
          let enrolled = false;
          try {
            await enrollUser(db, session.client_reference_id, courseId, paymentIntent);
            console.log(`Enrolled user ${session.client_reference_id} in course ${courseId}`);
            enrolled = true;
          } catch (enrollErr) {
            console.error(`Failed to enroll user in course ${courseId}:`, enrollErr.message);
            // Return 500 so Stripe retries the webhook — don't silently eat enrollment failures
            return new Response(JSON.stringify({ error: 'Enrollment failed' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          // Send course enrollment confirmation email
          if (enrolled) {
            const email = session.customer_details?.email || session.customer_email;
            const name = session.customer_details?.name || '';
            if (email && env.RESEND_API_KEY) {
              try {
                const resp = await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    from: 'RRM Academy <accounts@rrmacademy.org>',
                    to: [email],
                    subject: 'Your course is ready',
                    text: [
                      `Hi ${name || 'there'},`,
                      '',
                      'Your course purchase is confirmed and your course is ready to start.',
                      '',
                      'Go to your courses: https://rrmacademy.org/account',
                      '',
                      'Thank you for investing in your health education.',
                      '',
                      'RRM Academy',
                      'A project of the RRM Foundation — 501(c)(3), EIN: 93-4594315',
                    ].join('\n'),
                  }),
                });
                if (!resp.ok) {
                  console.error(`Course enrollment email failed (${resp.status}) for ${email}`);
                } else {
                  console.log(`Course enrollment email sent to ${email} for ${courseId}`);
                }
              } catch (emailErr) {
                console.error('Failed to send course enrollment email:', emailErr.message);
              }
            }
          }
        }
      } else if (session.metadata?.type === 'course' && !session.client_reference_id) {
        console.warn(`Course purchase missing client_reference_id — courseId: ${session.metadata.courseId}, customer: ${session.customer}`);
      }

      // Send membership confirmation email for STUC subscriptions
      const stucTiers = { member: 'Member', hero: 'Uterus Hero', superhero: 'Super Hero' };
      const tier = session.metadata?.tier || '';
      if (session.mode === 'subscription' && stucTiers[tier] && env.RESEND_API_KEY) {
        const email = session.customer_details?.email || session.customer_email;
        const name = session.customer_details?.name || '';
        const tierLabel = stucTiers[tier];

        if (email) {
          try {
            const resp = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'RRM Academy <accounts@rrmacademy.org>',
                to: [email],
                subject: 'Welcome to the Save the Uterus Club',
                text: [
                  `Hi ${name || 'there'},`,
                  '',
                  `Welcome to the Save the Uterus Club! You're now a ${tierLabel} member.`,
                  '',
                  'Here\'s what to do next:',
                  '',
                  '1. Join the member group — this is where live call dates, resources, and discussion happen:',
                  // STUC-CUTOVER: replace with https://rrmacademy.org/community
                  '   https://rrmfoundation.wixstudio.com/rrm-academy/group/save-the-uterus-club',
                  '',
                  '2. Join the free Uterus Allies group chat on Instagram:',
                  '   https://www.instagram.com/direct/t/7768750249851959/',
                  '',
                  '3. Explore the Research Library — over 3,000 peer-reviewed resources:',
                  '   https://rrmacademy.org/library',
                  '',
                  'You can manage your membership anytime at https://rrmacademy.org/account',
                  '',
                  'Thank you for supporting evidence-based reproductive health.',
                  '',
                  'RRM Academy',
                  'A project of the RRM Foundation — 501(c)(3), EIN: 93-4594315',
                ].join('\n'),
              }),
            });
            if (!resp.ok) {
              console.error(`Membership confirmation email failed (${resp.status}) for ${email}`);
            } else {
              console.log(`Membership confirmation email sent to ${email} (${tierLabel})`);
            }
          } catch (emailErr) {
            console.error('Failed to send membership confirmation email:', emailErr.message);
          }
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      console.log(`Subscription updated: ${sub.id}, status: ${sub.status}`);

      // Notify user when subscription goes past_due (payment retry failing)
      if (sub.status === 'past_due' && env.RESEND_API_KEY) {
        const email = await getEmailByStripeCustomer(db, sub.customer);
        if (email) {
          await sendEmail(env.RESEND_API_KEY, {
            to: email,
            subject: 'Action needed: update your payment method',
            text: [
              'Hi there,',
              '',
              'We were unable to process your most recent payment for your Save the Uterus Club membership.',
              '',
              'Please update your payment method to keep your membership active:',
              'https://rrmacademy.org/account',
              '',
              'If you have questions, reply to this email or contact us at https://rrmacademy.org/contact',
              '',
              'RRM Academy',
              'A project of the RRM Foundation — 501(c)(3), EIN: 93-4594315',
            ].join('\n'),
          });
          console.log(`Past-due notification sent to ${email}`);
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      console.log(`Subscription deleted: ${sub.id}, customer: ${sub.customer}`);

      // Send cancellation confirmation email
      if (env.RESEND_API_KEY) {
        const email = await getEmailByStripeCustomer(db, sub.customer);
        if (email) {
          await sendEmail(env.RESEND_API_KEY, {
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
              'https://rrmacademy.org/save-the-uterus-club',
              '',
              'Thank you for supporting evidence-based reproductive health.',
              '',
              'RRM Academy',
              'A project of the RRM Foundation — 501(c)(3), EIN: 93-4594315',
            ].join('\n'),
          });
          console.log(`Cancellation confirmation sent to ${email}`);
        }
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`Payment failed for invoice: ${invoice.id}, customer: ${invoice.customer}`);

      // Email user about the failed payment
      if (env.RESEND_API_KEY) {
        const email = await getEmailByStripeCustomer(db, invoice.customer);
        if (email) {
          await sendEmail(env.RESEND_API_KEY, {
            to: email,
            subject: 'Payment failed for your RRM Academy membership',
            text: [
              'Hi there,',
              '',
              'Your most recent membership payment could not be processed.',
              '',
              'Stripe will automatically retry, but you can update your payment method now:',
              'https://rrmacademy.org/account',
              '',
              'If your payment method is not updated, your membership may be cancelled.',
              '',
              'If you have questions, contact us at https://rrmacademy.org/contact',
              '',
              'RRM Academy',
              'A project of the RRM Foundation — 501(c)(3), EIN: 93-4594315',
            ].join('\n'),
          });
          console.log(`Payment failed notification sent to ${email}`);
        }
      }
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  // Always return 200 to acknowledge receipt
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Look up a user's email by their Stripe customer ID.
 * Returns null if not found.
 */
async function getEmailByStripeCustomer(db, stripeCustomerId) {
  if (!stripeCustomerId) return null;
  try {
    const row = await db.prepare('SELECT email FROM user WHERE stripe_customer_id = ?')
      .bind(stripeCustomerId).first();
    return row?.email || null;
  } catch (err) {
    console.error(`Failed to look up email for Stripe customer ${stripeCustomerId}:`, err.message);
    return null;
  }
}

/**
 * Send a transactional email via Resend.
 * Logs errors but does not throw — email failure should not block webhook processing.
 */
async function sendEmail(apiKey, { to, subject, text }) {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'RRM Academy <accounts@rrmacademy.org>',
        to: [to],
        subject,
        text,
      }),
    });
    if (!resp.ok) {
      console.error(`Email send failed (${resp.status}) to ${to}: ${subject}`);
    }
  } catch (err) {
    console.error(`Email send error to ${to}:`, err.message);
  }
}
