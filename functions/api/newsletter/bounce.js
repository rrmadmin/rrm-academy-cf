/**
 * POST /api/newsletter/bounce?secret={NEWSLETTER_BOUNCE_SECRET}
 * SNS webhook for SES bounce and complaint notifications.
 * Gated by query param secret (set when creating the SNS subscription).
 */
import { log } from '../_log.js';

export async function onRequestPost({ request, env, waitUntil }) {
  // Auth: shared secret in query param (configured in SNS subscription URL)
  const url = new URL(request.url);
  if (!env.NEWSLETTER_BOUNCE_SECRET || url.searchParams.get('secret') !== env.NEWSLETTER_BOUNCE_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return new Response('Invalid payload', { status: 400 });
  }

  // SNS subscription confirmation
  if (payload.Type === 'SubscriptionConfirmation' && payload.SubscribeURL) {
    // Validate that SubscribeURL points to AWS (prevent SSRF)
    try {
      const subUrl = new URL(payload.SubscribeURL);
      if (!subUrl.hostname.endsWith('.amazonaws.com')) {
        log(env, waitUntil, 'newsletter', 'sns_confirm_blocked', 'error', subUrl.hostname, 0, 400);
        return new Response('Invalid SubscribeURL', { status: 400 });
      }
    } catch {
      return new Response('Invalid SubscribeURL', { status: 400 });
    }
    await fetch(payload.SubscribeURL);
    log(env, waitUntil, 'newsletter', 'sns_confirmed', 'ok', payload.TopicArn || '', 0, 200);
    return new Response('OK', { status: 200 });
  }

  // SNS notification
  if (payload.Type !== 'Notification') {
    return new Response('OK', { status: 200 });
  }

  let message;
  try {
    message = JSON.parse(payload.Message);
  } catch {
    return new Response('OK', { status: 200 });
  }

  const db = env.DB;
  if (!db) {
    log(env, waitUntil, 'newsletter', 'config_missing', 'error', 'DB binding not configured', 0, 500);
    return new Response('Server misconfigured', { status: 500 });
  }

  const notifType = message.notificationType || message.eventType;

  if (notifType === 'Bounce') {
    const bounceType = message.bounce?.bounceType;
    const recipients = message.bounce?.bouncedRecipients || [];
    for (const r of recipients) {
      const email = r.emailAddress?.toLowerCase();
      if (!email) continue;

      if (bounceType === 'Permanent') {
        await db.batch([
          db.prepare(
            "UPDATE newsletter_subscriber SET status = 'bounced', bounce_count = bounce_count + 1 WHERE email = ? COLLATE NOCASE"
          ).bind(email),
          db.prepare(
            "INSERT INTO email_log (event, email, category, source, detail) VALUES ('bounced', ?, 'newsletter', 'ses/bounce-webhook', ?)"
          ).bind(email, bounceType),
        ]);
      } else {
        // Soft bounce: increment count, suppress after 3
        await db.prepare(
          "UPDATE newsletter_subscriber SET bounce_count = bounce_count + 1 WHERE email = ? COLLATE NOCASE"
        ).bind(email).run();
        const sub = await db.prepare(
          "SELECT bounce_count FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE"
        ).bind(email).first();
        if (sub && sub.bounce_count >= 3) {
          await db.prepare(
            "UPDATE newsletter_subscriber SET status = 'bounced' WHERE email = ? COLLATE NOCASE"
          ).bind(email).run();
        }
        await db.prepare(
          "INSERT INTO email_log (event, email, category, source, detail) VALUES ('bounced', ?, 'newsletter', 'ses/bounce-webhook', ?)"
        ).bind(email, bounceType).run();
      }
      log(env, waitUntil, 'newsletter', 'bounce', bounceType === 'Permanent' ? 'error' : 'warn', email, 0, 0);
    }
  }

  if (notifType === 'Complaint') {
    const recipients = message.complaint?.complainedRecipients || [];
    for (const r of recipients) {
      const email = r.emailAddress?.toLowerCase();
      if (!email) continue;
      await db.batch([
        db.prepare(
          "UPDATE newsletter_subscriber SET status = 'complained' WHERE email = ? COLLATE NOCASE"
        ).bind(email),
        db.prepare(
          "INSERT INTO email_log (event, email, category, source, detail) VALUES ('complained', ?, 'newsletter', 'ses/bounce-webhook', 'complaint')"
        ).bind(email),
      ]);
      log(env, waitUntil, 'newsletter', 'complaint', 'error', email, 0, 0);
    }
  }

  if (notifType === 'Delivery') {
    // Log delivery for deliverability tracking (sent != delivered)
    const recipients = message.delivery?.recipients || [];
    for (const rawEmail of recipients) {
      const email = rawEmail.toLowerCase();
      await db.prepare(
        "INSERT INTO email_log (event, email, category, source, detail) VALUES ('delivered', ?, 'newsletter', 'ses/bounce-webhook', 'delivery')"
      ).bind(email).run();
      log(env, waitUntil, 'newsletter', 'delivered', 'ok', email, 0, 200);
    }
  }

  return new Response('OK', { status: 200 });
}
