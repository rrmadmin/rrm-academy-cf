/**
 * GET /api/newsletter/click?s={sendId}&u={subscriberId}&r={destinationUrl}
 * Logs click event, 302 redirects to destination.
 */
import { log } from '../_log.js';
import { checkRateLimit } from '../auth/_shared.js';

const UUID_RE = /^[0-9a-f-]{36}$/i;

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

  // Validate UUID-ish params before any DB work; skip tracking on invalid but still redirect
  const paramsValid = sendId && subscriberId &&
    UUID_RE.test(sendId) && UUID_RE.test(subscriberId);

  if (paramsValid && env.DB) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const work = (async () => {
      // Rate limit: high ceiling for legit fan-out, caps drive-by attackers
      const allowed = await checkRateLimit(env, `pixel:${ip}`, 600, 60);
      if (!allowed) return;

      try {
        const subRow = await env.DB.prepare(
          "SELECT id, email FROM newsletter_subscriber WHERE id = ?"
        ).bind(subscriberId).first();
        if (!subRow) return;
        const recipientEmail = (subRow.email || '').toLowerCase();

        const result = await env.DB.prepare(
          "INSERT INTO newsletter_event (send_id, subscriber_id, event, detail) SELECT ?, ?, 'clicked', ? WHERE NOT EXISTS (SELECT 1 FROM newsletter_event WHERE send_id = ? AND subscriber_id = ? AND event = 'clicked' AND detail = ?)"
        ).bind(sendId, subscriberId, dest, sendId, subscriberId, dest).run();

        if (result.changes > 0) {
          await env.DB.batch([
            env.DB.prepare("UPDATE newsletter_send SET click_count = click_count + 1 WHERE id = ?").bind(sendId),
            env.DB.prepare("UPDATE newsletter_subscriber SET last_clicked_at = datetime('now') WHERE id = ?").bind(subscriberId),
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
