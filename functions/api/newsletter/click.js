/**
 * GET /api/newsletter/click?s={sendId}&u={subscriberId}&r={destinationUrl}
 * Logs click event, 302 redirects to destination.
 */
import { log } from '../_log.js';

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const sendId = url.searchParams.get('s');
  const subscriberId = url.searchParams.get('u');
  const dest = url.searchParams.get('r');

  if (!dest) {
    return new Response('Missing redirect URL', { status: 400 });
  }

  // Validate destination is our own domain (prevent open redirect attacks)
  try {
    const destUrl = new URL(dest);
    if (destUrl.hostname !== 'rrmacademy.org') {
      return new Response('Redirect blocked: external URL', { status: 400 });
    }
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }

  if (sendId && subscriberId && env.DB) {
    const work = (async () => {
      try {
        const subRow = await env.DB.prepare(
          "SELECT email FROM newsletter_subscriber WHERE id = ?"
        ).bind(subscriberId).first();
        const recipientEmail = (subRow?.email || '').toLowerCase();

        const result = await env.DB.prepare(
          "INSERT OR IGNORE INTO newsletter_event (send_id, subscriber_id, event, detail) VALUES (?, ?, 'clicked', ?)"
        ).bind(sendId, subscriberId, dest).run();

        await env.DB.prepare("UPDATE newsletter_subscriber SET last_clicked_at = datetime('now') WHERE id = ?")
          .bind(subscriberId).run();

        if (result.changes > 0) {
          await env.DB.batch([
            env.DB.prepare("UPDATE newsletter_send SET click_count = click_count + 1 WHERE id = ?").bind(sendId),
            env.DB.prepare(
              "INSERT INTO email_log (event, email, category, source, detail, send_id) VALUES ('clicked', ?, 'newsletter', 'newsletter/click', ?, ?)"
            ).bind(recipientEmail, dest, sendId),
          ]);
        }
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'click_track_error', 'error', err.message, 0, 0);
      }
    })();
    waitUntil(work);
  }

  return Response.redirect(dest, 302);
}
