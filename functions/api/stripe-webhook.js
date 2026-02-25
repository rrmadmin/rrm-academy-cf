/**
 * POST /api/stripe-webhook
 * Receives Stripe webhook events and processes them.
 *
 * Events handled:
 *   - checkout.session.completed  → link stripe_customer_id to D1 user + course enrollment
 *   - customer.subscription.updated → (logged, no action needed — Stripe is source of truth)
 *   - customer.subscription.deleted → (logged)
 *   - invoice.payment_failed       → (logged)
 *
 * No CORS headers — this is a server-to-server endpoint called by Stripe.
 * Uses constructEventAsync for CF Workers (async Web Crypto API).
 */
import Stripe from 'stripe';
import { enrollUser } from './courses/enroll.js';
import { getCourse } from './courses/_shared.js';

export async function onRequestPost({ request, env }) {
  const stripeKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return new Response('Webhook not configured', { status: 500 });
  }

  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: '2024-12-18.acacia',
  });

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing signature', { status: 400 });
  }

  const body = await request.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response('Invalid signature', { status: 400 });
  }

  const db = env.DB;
  if (!db) {
    console.error('DB binding missing — cannot process webhook event');
    return new Response('DB not configured', { status: 500 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer;

      // Link Stripe customer to D1 user (requires customerId)
      if (customerId) {
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

      // Send membership confirmation email for subscriptions
      if (session.mode === 'subscription' && env.RESEND_API_KEY) {
        const email = session.customer_details?.email || session.customer_email;
        const name = session.customer_details?.name || '';
        const tier = session.metadata?.tier || '';
        const tierNames = { member: 'Member', hero: 'Uterus Hero', superhero: 'Super Hero' };
        const tierLabel = tierNames[tier] || 'Member';

        if (email) {
          try {
            await fetch('https://api.resend.com/emails', {
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
            console.log(`Membership confirmation email sent to ${email} (${tierLabel})`);
          } catch (emailErr) {
            console.error('Failed to send membership confirmation email:', emailErr.message);
          }
        }
      }
      break;
    }

    case 'customer.subscription.updated':
      console.log(`Subscription updated: ${event.data.object.id}, status: ${event.data.object.status}`);
      break;

    case 'customer.subscription.deleted':
      console.log(`Subscription deleted: ${event.data.object.id}`);
      break;

    case 'invoice.payment_failed':
      console.log(`Payment failed for invoice: ${event.data.object.id}, customer: ${event.data.object.customer}`);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  // Always return 200 to acknowledge receipt
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
