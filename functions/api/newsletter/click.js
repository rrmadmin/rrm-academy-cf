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
        await env.DB.prepare(
          "INSERT INTO newsletter_event (send_id, subscriber_id, event, detail) VALUES (?, ?, 'clicked', ?)"
        ).bind(sendId, subscriberId, dest).run();
        // Dedupe click count: only increment once per subscriber per send
        const clickCount = await env.DB.prepare(
          "SELECT COUNT(*) as c FROM newsletter_event WHERE send_id = ? AND subscriber_id = ? AND event = 'clicked'"
        ).bind(sendId, subscriberId).first();
        if (clickCount && clickCount.c === 1) {
          await env.DB.prepare(
            "UPDATE newsletter_send SET click_count = click_count + 1 WHERE id = ?"
          ).bind(sendId).run();
        }
        await env.DB.prepare(
          "UPDATE newsletter_subscriber SET last_clicked_at = datetime('now') WHERE id = ?"
        ).bind(subscriberId).run();
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'click_track_error', 'error', err.message, 0, 0);
      }
    })();
    waitUntil(work);
  }

  return Response.redirect(dest, 302);
}
