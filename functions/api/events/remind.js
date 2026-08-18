/**
 * GET /api/events/remind
 *
 * Day-of reminder sweep for FREE Save the Uterus Club events. Re-sends the
 * joining-link email (built by ./_email.js, the same builder POST
 * /api/events/register uses) to every registration that has not had one, for
 * every free event starting in the next 12 hours.
 *
 * AUTH
 * ----
 * `Authorization: Bearer <EVENTS_REMIND_KEY>`, a CF Pages secret. When the
 * secret is UNSET the endpoint answers 503 and sends nothing: an unconfigured
 * deploy must be inert, never open. The comparison is length-checked before it
 * is compared so a wrong-length token cannot be distinguished by timing alone.
 *
 * DRIVER
 * ------
 * There is no cron inside CF Pages Functions, so this is pulled by an external
 * scheduler (launchd on the operator's machine, or a small CF cron Worker).
 * Run it hourly; it is idempotent, because `reminder_sent_at IS NULL` is what
 * selects the recipients and it is stamped as each send succeeds.
 *
 *   curl -sS -X GET https://rrmacademy.org/api/events/remind \
 *     -H "Authorization: Bearer $EVENTS_REMIND_KEY"
 *
 * Set the secret with:
 *   npx wrangler pages secret put EVENTS_REMIND_KEY --project-name rrm-academy
 *
 * PACING
 * ------
 * Sends are SEQUENTIAL with a small delay between them, never a concurrent
 * burst -- the same discipline as sendBroadcastTrickle in
 * functions/api/community/_email.js -- and capped at MAX_SENDS per invocation so
 * one call cannot run away. Anything above the cap is picked up by the next run,
 * which is why the driver should fire more than once in the 12-hour window.
 *
 * The joining link appears in the sent message and NOWHERE ELSE. The response
 * body carries counts only.
 */
import { json } from '../auth/_shared.js';
import { log } from '../_log.js';
import { sendTransactionalEmail } from '../_mail-lanes.js';
import { buildLinkEmail, REGISTER_FROM, REGISTER_REPLY_TO } from './_email.js';

/** How far ahead a start time may be and still count as "today". */
const WINDOW_MS = 12 * 60 * 60 * 1000;
/** Hard ceiling on messages per invocation. The remainder waits for the next run. */
const MAX_SENDS = 200;
/** Gap between sequential sends. Deliverability pacing, not a rate limit. */
const SEND_DELAY_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Constant-time-ish bearer compare: length first, then every byte. */
function bearerMatches(header, secret) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = header.slice(7);
  if (supplied.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) {
    diff |= supplied.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.DB) {
    return json({ ok: false, error: 'service_unavailable' }, 503);
  }
  if (!env.EVENTS_REMIND_KEY) {
    return json({ ok: false, error: 'not_configured' }, 503);
  }
  if (!bearerMatches(request.headers.get('Authorization'), env.EVENTS_REMIND_KEY)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const untilIso = new Date(now + WINDOW_MS).toISOString();

  let events;
  try {
    events = await env.DB.prepare(
      `SELECT id, slug, title, content, event_date, event_link, speaker
       FROM community_post
       WHERE channel = 'stuc' AND type = 'event' AND is_free = 1
         AND event_date >= ? AND event_date <= ?
       ORDER BY event_date ASC`
    ).bind(nowIso, untilIso).all();
  } catch (err) {
    log(env, waitUntil, 'events', 'remind_lookup_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'server_error' }, 500);
  }

  let sent = 0;
  let failed = 0;
  let capped = false;

  for (const event of (events.results || [])) {
    if (sent + failed >= MAX_SENDS) { capped = true; break; }

    let registrations;
    try {
      registrations = await env.DB.prepare(
        `SELECT r.id, r.email, u.first_name
         FROM event_registration r
         LEFT JOIN user u ON u.id = r.user_id
         WHERE r.post_id = ? AND r.reminder_sent_at IS NULL
         ORDER BY r.created_at ASC
         LIMIT ?`
      ).bind(event.id, MAX_SENDS).all();
    } catch (err) {
      log(env, waitUntil, 'events', 'remind_roster_error', 'error', String(event.slug || event.id), 0, 500);
      continue;
    }

    for (const registration of (registrations.results || [])) {
      if (sent + failed >= MAX_SENDS) { capped = true; break; }

      const { subject, html, text } = buildLinkEmail(event, {
        kind: 'reminder',
        firstName: registration.first_name || null,
      });

      try {
        await sendTransactionalEmail(env, {
          from: REGISTER_FROM,
          to: registration.email,
          subject,
          html,
          text,
          replyTo: REGISTER_REPLY_TO,
          log: { db: env.DB, source: 'events/remind', category: 'transactional' },
        });
        await env.DB.prepare(
          "UPDATE event_registration SET reminder_sent_at = datetime('now') WHERE id = ?"
        ).bind(registration.id).run();
        sent++;
      } catch (err) {
        // reminder_sent_at stays NULL, so the next run retries this recipient.
        failed++;
        log(env, waitUntil, 'events', 'remind_send_failed', 'error', String(event.slug || event.id), 0, 500);
      }

      if (SEND_DELAY_MS > 0) await sleep(SEND_DELAY_MS);
    }
  }

  log(env, waitUntil, 'events', 'remind_sweep', 'ok', `${sent}/${sent + failed}`, 0, 200);

  return json({
    ok: true,
    events: (events.results || []).length,
    sent,
    failed,
    capped,
  });
}
