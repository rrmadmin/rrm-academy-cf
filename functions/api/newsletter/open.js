/**
 * GET /api/newsletter/open?s={sendId}&u={subscriberId}
 * Returns 1x1 transparent GIF, logs open event.
 */
import { log } from '../_log.js';

// 1x1 transparent GIF (43 bytes)
const PIXEL = new Uint8Array([
  0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,
  0x80,0x00,0x00,0xff,0xff,0xff,0x00,0x00,0x00,0x21,
  0xf9,0x04,0x01,0x00,0x00,0x00,0x00,0x2c,0x00,0x00,
  0x00,0x00,0x01,0x00,0x01,0x00,0x00,0x02,0x02,0x44,
  0x01,0x00,0x3b
]);

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const sendId = url.searchParams.get('s');
  const subscriberId = url.searchParams.get('u');

  if (sendId && subscriberId && env.DB) {
    // Fire-and-forget: don't block the pixel response
    const work = (async () => {
      try {
        // Dedupe: only count first open per subscriber per send
        const existing = await env.DB.prepare(
          "SELECT 1 FROM newsletter_event WHERE send_id = ? AND subscriber_id = ? AND event = 'opened' LIMIT 1"
        ).bind(sendId, subscriberId).first();
        if (!existing) {
          await env.DB.prepare(
            "INSERT INTO newsletter_event (send_id, subscriber_id, event) VALUES (?, ?, 'opened')"
          ).bind(sendId, subscriberId).run();
          await env.DB.prepare(
            "UPDATE newsletter_send SET open_count = open_count + 1 WHERE id = ?"
          ).bind(sendId).run();
          await env.DB.prepare(
            "UPDATE newsletter_subscriber SET last_opened_at = datetime('now') WHERE id = ?"
          ).bind(subscriberId).run();
        }
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'open_track_error', 'error', err.message, 0, 0);
      }
    })();
    waitUntil(work);
  }

  return new Response(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Expires': '0',
    },
  });
}
