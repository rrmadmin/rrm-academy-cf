/**
 * POST /api/newsletter/bounce?secret={NEWSLETTER_BOUNCE_SECRET}
 * SNS webhook for SES bounce and complaint notifications.
 * Gated by query param secret (set when creating the SNS subscription).
 */
import { log } from '../_log.js';

const ALLOWED_SNS_TYPES = new Set(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']);

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

  // Type allowlist: reject unknown SNS message types
  if (!ALLOWED_SNS_TYPES.has(payload.Type)) {
    log(env, waitUntil, 'newsletter', 'sns_type_rejected', 'error', String(payload.Type || '').slice(0, 100), 0, 400);
    return new Response('Unsupported Type', { status: 400 });
  }

  // TopicArn guard: if configured, reject messages from unexpected topics
  if (env.NEWSLETTER_SNS_TOPIC_ARN && payload.TopicArn && payload.TopicArn !== env.NEWSLETTER_SNS_TOPIC_ARN) {
    log(env, waitUntil, 'newsletter', 'sns_topic_rejected', 'error', String(payload.TopicArn || '').slice(0, 200), 0, 403);
    return new Response('Topic mismatch', { status: 403 });
  }

  // TODO: implement full SNS Signature verification (SigningCertURL hostname check +
  // fetch cert + RSA-SHA1 PKCS#1 verify) for complete authenticity assurance.

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
    let r;
    try {
      r = await fetch(payload.SubscribeURL);
    } catch (err) {
      log(env, waitUntil, 'newsletter', 'sns_confirm_fetch_error', 'error', err?.message || 'network', 0, 502);
      return new Response('Confirmation fetch failed', { status: 502 });
    }
    if (!r.ok) {
      log(env, waitUntil, 'newsletter', 'sns_confirm_fetch_error', 'error', `HTTP ${r.status}`, 0, 502);
      return new Response('Confirmation fetch failed', { status: 502 });
    }
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
  } catch (err) {
    log(env, waitUntil, 'newsletter', 'sns_parse_error', 'error', `${err?.message || 'parse'}: ${(payload.Message || '').slice(0, 200)}`, 0, 200);
    return new Response('OK', { status: 200 });
  }

  const db = env.DB;
  if (!db) {
    log(env, waitUntil, 'newsletter', 'config_missing', 'error', 'DB binding not configured', 0, 500);
    return new Response('Server misconfigured', { status: 500 });
  }

  // Webhook event dedup: prevent replay double-processing
  const eventId = payload.MessageId;
  if (eventId) {
    try {
      const ins = await db.prepare(
        "INSERT OR IGNORE INTO webhook_event (event_id) VALUES (?)"
      ).bind(eventId).run();
      if (ins.meta.changes === 0) {
        // Already processed
        return new Response('OK', { status: 200 });
      }
    } catch (err) {
      log(env, waitUntil, 'newsletter', 'dedup_error', 'error', err?.message || 'unknown', 0, 500);
      return new Response('Server error', { status: 500 });
    }
  }

  let processingError = false;

  const notifType = message.notificationType || message.eventType;

  if (notifType === 'Bounce') {
    const bounceType = message.bounce?.bounceType;
    const recipients = message.bounce?.bouncedRecipients || [];
    for (const r of recipients) {
      try {
        const email = r.emailAddress?.toLowerCase();
        if (!email) continue;

        const subscriber = await db.prepare(
          "SELECT id FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE"
        ).bind(email).first();

        if (!subscriber) continue;

        const lastEvent = await db.prepare(
          "SELECT send_id FROM newsletter_event WHERE subscriber_id = ? AND event = 'sent' ORDER BY id DESC LIMIT 1"
        ).bind(subscriber.id).first();
        const sendId = lastEvent?.send_id || null;

        if (bounceType === 'Permanent') {
          const batch = [
            db.prepare(
              "UPDATE newsletter_subscriber SET status = 'bounced', bounce_count = bounce_count + 1 WHERE email = ? COLLATE NOCASE AND status NOT IN ('unsubscribed','complained')"
            ).bind(email),
            db.prepare(
              "INSERT INTO email_log (event, email, category, source, detail) VALUES ('bounced', ?, 'newsletter', 'ses/bounce-webhook', ?)"
            ).bind(email, bounceType),
          ];
          if (sendId) {
            batch.push(
              db.prepare(
                "UPDATE newsletter_send SET bounce_count = bounce_count + 1 WHERE id = ?"
              ).bind(sendId)
            );
          }
          await db.batch(batch);
        } else {
          // Soft bounce: increment count, suppress after 3 using single atomic UPDATE
          const batch = [
            db.prepare(
              "UPDATE newsletter_subscriber SET bounce_count = bounce_count + 1, status = CASE WHEN bounce_count + 1 >= 3 THEN 'bounced' ELSE status END WHERE email = ? COLLATE NOCASE AND status NOT IN ('unsubscribed','complained')"
            ).bind(email),
            db.prepare(
              "INSERT INTO email_log (event, email, category, source, detail) VALUES ('bounced', ?, 'newsletter', 'ses/bounce-webhook', ?)"
            ).bind(email, bounceType),
          ];
          if (sendId) {
            batch.push(
              db.prepare(
                "UPDATE newsletter_send SET bounce_count = bounce_count + 1 WHERE id = ?"
              ).bind(sendId)
            );
          }
          await db.batch(batch);
        }
        log(env, waitUntil, 'newsletter', 'bounce', bounceType === 'Permanent' ? 'error' : 'warn', email, 0, 0);
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'bounce_loop_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  if (notifType === 'Complaint') {
    const recipients = message.complaint?.complainedRecipients || [];
    for (const r of recipients) {
      try {
        const email = r.emailAddress?.toLowerCase();
        if (!email) continue;

        const subscriber = await db.prepare(
          "SELECT id FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE"
        ).bind(email).first();

        if (!subscriber) continue;

        await db.batch([
          db.prepare(
            "UPDATE newsletter_subscriber SET status = 'complained' WHERE email = ? COLLATE NOCASE"
          ).bind(email),
          db.prepare(
            "INSERT INTO email_log (event, email, category, source, detail) VALUES ('complained', ?, 'newsletter', 'ses/bounce-webhook', 'complaint')"
          ).bind(email),
        ]);
        log(env, waitUntil, 'newsletter', 'complaint', 'error', email, 0, 0);
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'complaint_loop_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  if (notifType === 'Delivery') {
    // Log delivery for deliverability tracking (sent != delivered)
    const recipients = message.delivery?.recipients || [];
    for (const rawEmail of recipients) {
      try {
        const email = rawEmail.toLowerCase();

        const subscriber = await db.prepare(
          "SELECT id FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE"
        ).bind(email).first();

        if (!subscriber) continue;

        await db.prepare(
          "INSERT INTO email_log (event, email, category, source, detail) VALUES ('delivered', ?, 'newsletter', 'ses/bounce-webhook', 'delivery')"
        ).bind(email).run();
        log(env, waitUntil, 'newsletter', 'delivered', 'ok', email, 0, 200);
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'delivery_loop_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  // On processing error, delete dedup row so SNS can retry
  if (processingError && eventId) {
    try {
      await db.prepare("DELETE FROM webhook_event WHERE event_id = ?").bind(eventId).run();
    } catch {}
    return new Response('Server error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
