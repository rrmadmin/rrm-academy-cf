/**
 * POST /api/events/register
 *
 * Email-gated registration for a FREE Save the Uterus Club event.
 *
 * A free event is a public recruitment call: anyone may attend. The public
 * landing page /events/<slug> still renders the SCRUBBED body to every
 * non-member, so the joining credential does not appear on the page, in
 * og:description, in the JSON-LD or in the .ics -- see the long scope note at
 * the top of functions/events/[slug].js, which this endpoint does not weaken.
 * The credential leaves the gate in exactly ONE place: the message this endpoint
 * sends to the address that just asked for it. It is never in a response body,
 * a log line or an analytics blob.
 *
 * Structure and safeguards mirror functions/api/courses/waitlist.js: declared-
 * field validation, an IP rate limit, a honeypot inside the rate-limited path, a
 * hashed-email rate limit, Turnstile, mailbox verification, an optional
 * session binding that refuses to attach a session to a foreign address, and one
 * atomic D1 batch.
 *
 * Body: { slug, email, turnstileToken, website }
 */
import { json, optionsResponse, verifyTurnstile, generateId, getSessionIdFromCookie, checkRateLimit, hashToken } from '../auth/_shared.js';
import { verifyAndTagEmail } from '../_elv.js';
import { log } from '../_log.js';
import { sendGA4Event } from '../_ga4.js';
import { validateBody } from '../_validate.js';
import { sendTransactionalEmail } from '../_mail-lanes.js';
import { buildLinkEmail, REGISTER_FROM, REGISTER_REPLY_TO } from './_email.js';

/** A call is still joinable for an hour after its start time. */
const ENDED_GRACE_MS = 60 * 60 * 1000;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // 1. Rate limit by IP
  if (!await checkRateLimit(env, `event-reg-ip:${ip}`, 10, 900)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  if (!env.DB || !env.CF_TURNSTILE_SECRET) {
    return json({ ok: false, error: 'service_unavailable' }, 503);
  }

  // 2. Parse JSON
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  // 3. Validate declared fields. `website` is excluded so a non-string value trips the honeypot silently.
  const validated = validateBody(body, {
    slug:           { type: 'string', required: true, maxLength: 200 },
    email:          { type: 'email',  required: true },
    turnstileToken: { type: 'string', required: true, maxLength: 2048 },
  });
  if (!validated.valid) {
    return json({ ok: false, error: validated.error }, validated.status);
  }

  const { slug, email, turnstileToken } = validated.data;

  // 4. Honeypot, inside the rate-limited path so bots count toward the IP limit
  if (body.website) {
    log(env, waitUntil, 'events', 'register_honeypot', 'block', `${slug}|${ip}`, 0, 200);
    return json({ ok: true });
  }

  // 5. Eligibility, before burning Turnstile or mailbox-verification credits.
  //    is_free = 1 is part of the WHERE, not a post-check: a members-only event
  //    must be indistinguishable from one that does not exist.
  let event;
  try {
    event = await env.DB.prepare(
      `SELECT id, slug, title, content, event_date, event_link, speaker
       FROM community_post
       WHERE channel = 'stuc' AND type = 'event' AND is_free = 1 AND slug = ? COLLATE NOCASE
       LIMIT 1`
    ).bind(slug).first();
  } catch (err) {
    log(env, waitUntil, 'events', 'register_lookup_error', 'error', slug, 0, 500);
    return json({ ok: false, error: 'server_error' }, 500);
  }

  if (!event) {
    return json({ ok: false, error: 'not_found' }, 404);
  }

  const startMs = Date.parse(event.event_date);
  if (Number.isFinite(startMs) && startMs < Date.now() - ENDED_GRACE_MS) {
    return json({ ok: false, error: 'event_ended' }, 400);
  }

  // 6. Rate limit by email. The key is a hash, never the raw address, so it never
  // reaches the COMMUNITY_KV key name or an Analytics Engine index (PRIV-02).
  const emailHash = (await hashToken(email)).slice(0, 32);
  if (!await checkRateLimit(env, `event-reg-email:${emailHash}`, 3, 900)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  // 7. Turnstile verification
  const turnstileResult = await verifyTurnstile(env.CF_TURNSTILE_SECRET, turnstileToken, ip, env);
  if (!turnstileResult.ok) {
    return json({ ok: false, error: 'spam_check_failed' }, 403);
  }

  // 8. ELV mailbox verification. A link email to a dead mailbox is a bounce.
  const source = `event-${event.slug || slug}`;
  let elv;
  try {
    elv = await verifyAndTagEmail(email, env, { source });
  } catch (err) {
    log(env, waitUntil, 'events', 'register_elv_error', 'error', slug, 0, 500);
    return json({ ok: false, error: 'server_error' }, 500);
  }
  if (elv.blocked) {
    return json({ ok: false, error: 'email_rejected' }, 400);
  }

  const contactId = elv.contactId || null;
  if (!contactId) {
    log(env, waitUntil, 'events', 'register_contact_missing', 'warn', slug, 0, 0);
  }

  // 9. Optional session check: one inline JOIN, no renewal write for this read-only check
  let userId = null;
  let firstName = null;
  const sessionId = getSessionIdFromCookie(request);
  if (sessionId) {
    try {
      const sessionRow = await env.DB.prepare(
        'SELECT s.user_id, u.email AS user_email, u.first_name, u.blocked FROM session s JOIN user u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > unixepoch()'
      ).bind(sessionId).first();
      if (sessionRow) {
        if (sessionRow.blocked === 1) {
          return json({ ok: false, error: 'forbidden' }, 403);
        }
        // Bind userId only when the session email matches the submitted email (prevents IDOR)
        if (sessionRow.user_email.toLowerCase() === email) {
          userId = sessionRow.user_id;
          firstName = sessionRow.first_name || null;
        }
      }
    } catch { // arise-ignore silent-catch -- session lookup is non-fatal; proceed without session
    }
  }

  // 10. Batch all D1 writes
  const registrationId = generateId();
  const segment = `event:${event.slug || slug}`;

  // Newsletter merge: read existing row first, then INSERT or UPDATE segments
  let existingSub = null;
  try {
    existingSub = await env.DB.prepare(
      'SELECT id, status, segments FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE'
    ).bind(email).first();
  } catch { // arise-ignore silent-catch -- newsletter lookup is non-fatal; registration proceeds
  }

  // No initializer: every path out of the try either assigns this or returns,
  // so a default would be dead and eslint's no-useless-assignment says so.
  let wasNew;
  try {
    const statements = [
      // 1. Registration upsert. Preserves user_id if it is already set.
      env.DB.prepare(
        `INSERT INTO event_registration (id, post_id, email, user_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(post_id, email) DO UPDATE SET
           user_id = COALESCE(event_registration.user_id, excluded.user_id)`
      ).bind(registrationId, event.id, email, userId),
    ];

    // 2. Newsletter: merge segment without touching unsubscribed status
    if (existingSub) {
      const segs = JSON.parse(existingSub.segments || '[]') || [];
      if (!segs.includes(segment)) {
        segs.push(segment);
        statements.push(
          env.DB.prepare(
            'UPDATE newsletter_subscriber SET segments = ? WHERE id = ?'
          ).bind(JSON.stringify(segs), existingSub.id)
        );
      }
      // else: segment already present, so nothing to push
    } else {
      statements.push(
        env.DB.prepare(
          "INSERT INTO newsletter_subscriber (id, email, status, source, subscribed_at, segments) VALUES (?, ?, 'active', ?, datetime('now'), ?) ON CONFLICT(email) DO NOTHING"
        ).bind(generateId(), email, source, JSON.stringify([segment]))
      );
    }

    // 3. contact_tag if we have a contact_id
    if (contactId) {
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO contact_tag (contact_id, tag, source) VALUES (?, ?, 'event')"
        ).bind(contactId, segment)
      );
    }

    const results = await env.DB.batch(statements);
    wasNew = results[0]?.meta?.changes > 0;
  } catch (err) {
    log(env, waitUntil, 'events', 'register_error', 'error', slug, 0, 500);
    return json({ ok: false, error: 'server_error' }, 500);
  }

  // 11. The one channel the joining link is allowed to travel. A duplicate
  // registration RESENDS: someone who lost the email needs it back, and the two
  // rate limits above are what bounds the abuse, not a "you already registered"
  // refusal that would strand them.
  const { subject, html, text } = buildLinkEmail(event, { kind: 'register', firstName });
  try {
    await sendTransactionalEmail(env, {
      from: REGISTER_FROM,
      to: email,
      subject,
      html,
      text,
      replyTo: REGISTER_REPLY_TO,
      log: { db: env.DB, source: 'events/register', category: 'transactional' },
    });
    // link_sent_at records the LAST successful send, so a resend refreshes it.
    await env.DB.prepare(
      "UPDATE event_registration SET link_sent_at = datetime('now') WHERE post_id = ? AND email = ? COLLATE NOCASE"
    ).bind(event.id, email).run();
  } catch (err) {
    // The row is already written, so the registration is real and the reminder
    // sweep will still reach them. Report the send failure honestly rather than
    // claiming an inbox has a link in it.
    log(env, waitUntil, 'events', 'register_send_failed', 'error', slug, 0, 500);
    return json({ ok: false, error: 'send_failed' }, 500);
  }

  if (wasNew) {
    log(env, waitUntil, 'events', 'register_signup', 'ok', slug, 0, 200);
    waitUntil(sendGA4Event(env, request, 'generate_lead', {
      lead_source: 'free_event',
      items: [{ item_name: `Event: ${event.slug || slug}` }],
    }).catch(() => {}));
  } else {
    log(env, waitUntil, 'events', 'register_duplicate', 'ok', slug, 0, 200);
  }

  return json({ ok: true });
}
