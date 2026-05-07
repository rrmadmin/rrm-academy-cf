/**
 * POST /api/courses/waitlist
 * Captures email sign-ups for waitlisted affiliate courses.
 * Dual-subscribes to newsletter_subscriber with a waitlist segment.
 */
import { json, optionsResponse, verifyTurnstile, generateId, getSessionIdFromCookie } from '../auth/_shared.js';
import { verifyAndTagEmail } from '../_elv.js';
import { log } from '../_log.js';
import { sendGA4Event } from '../_ga4.js';
import { validateBody } from '../_validate.js';
import { isWaitlistCourse } from './_shared.js';

// In-memory rate limiters: 10/15min per IP, 3/15min per email
const ipLimits = new Map();
const emailLimits = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const IP_MAX = 10;
const EMAIL_MAX = 3;

function gcMap(map) {
  if (map.size <= 5000) return;
  const now = Date.now();
  for (const [key, entry] of map) {
    if (now - entry.start > WINDOW_MS) map.delete(key);
  }
}

function checkIpLimit(ip) {
  gcMap(ipLimits);
  const now = Date.now();
  const entry = ipLimits.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    ipLimits.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= IP_MAX;
}

function checkEmailLimit(email) {
  gcMap(emailLimits);
  const now = Date.now();
  const entry = emailLimits.get(email);
  if (!entry || now - entry.start > WINDOW_MS) {
    emailLimits.set(email, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= EMAIL_MAX;
}

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  if (!env.DB || !env.CF_TURNSTILE_SECRET) {
    return json({ ok: false, error: 'service_unavailable' }, 503);
  }

  // 1. Parse JSON
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  // 2. Validate declared fields — `website` excluded so non-string values trip honeypot silently
  const validated = validateBody(body, {
    courseId:       { type: 'string', required: true, maxLength: 100 },
    email:          { type: 'email',  required: true },
    turnstileToken: { type: 'string', required: true, maxLength: 2048 },
  });
  if (!validated.valid) {
    return json({ ok: false, error: validated.error }, validated.status);
  }

  const { courseId, email, turnstileToken } = validated.data;

  // 3. Fail fast: reject non-waitlist courses before burning any external service credits
  if (!isWaitlistCourse(courseId)) {
    return json({ ok: false, error: 'not_waitlist_course' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // 4. Rate limit by IP
  if (!checkIpLimit(ip)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  // 5. Honeypot — inside rate-limited path so bots count toward the IP limit
  if (body.website) {
    log(env, waitUntil, 'courses', 'waitlist_honeypot', 'block', `${courseId}|${ip}`, 0, 200);
    return json({ ok: true });
  }

  // 6. Rate limit by email
  if (!checkEmailLimit(email)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  // 7. Turnstile verification
  let turnstileOk;
  try {
    turnstileOk = await verifyTurnstile(env.CF_TURNSTILE_SECRET, turnstileToken, ip, env);
  } catch {
    return json({ ok: false, error: 'spam_check_failed' }, 403);
  }
  if (!turnstileOk) {
    return json({ ok: false, error: 'spam_check_failed' }, 403);
  }

  // 8. ELV mailbox verification — now returns contactId via RETURNING id
  let elv;
  try {
    elv = await verifyAndTagEmail(email, env, { source: `waitlist-${courseId}` });
  } catch (err) {
    log(env, waitUntil, 'courses', 'waitlist_elv_error', 'error', courseId, 0, 500);
    return json({ ok: false, error: 'server_error' }, 500);
  }
  if (elv.blocked) {
    return json({ ok: false, error: 'email_rejected' }, 400);
  }

  const contactId = elv.contactId || null;
  if (!contactId) {
    log(env, waitUntil, 'courses', 'waitlist_contact_missing', 'warn', `${courseId}|${email}`, 0, 0);
  }

  // 9. Optional session check — single inline JOIN query; no renewal write for this read-only check
  let userId = null;
  const sessionId = getSessionIdFromCookie(request);
  if (sessionId) {
    try {
      const sessionRow = await env.DB.prepare(
        'SELECT s.user_id, u.email AS user_email, u.blocked FROM session s JOIN user u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > unixepoch()'
      ).bind(sessionId).first();
      if (sessionRow) {
        if (sessionRow.blocked === 1) {
          return json({ ok: false, error: 'forbidden' }, 403);
        }
        // Bind userId only when the session email matches the submitted email (prevents IDOR)
        if (sessionRow.user_email.toLowerCase() === email) {
          userId = sessionRow.user_id;
        }
      }
    } catch { // arise-ignore silent-catch -- session lookup is non-fatal; proceed without session
    }
  }

  // 10. Batch all D1 writes
  const waitlistId = generateId();
  const waitlistSegment = `waitlist:${courseId}`;

  // Newsletter merge: read existing row first, then INSERT or UPDATE segments
  let existingSub = null;
  try {
    existingSub = await env.DB.prepare(
      'SELECT id, status, segments FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE'
    ).bind(email).first();
  } catch { // arise-ignore silent-catch -- newsletter lookup is non-fatal; waitlist proceeds
  }

  try {
    const statements = [
      // 1. Waitlist upsert — preserve user_id if already set; clear unsubscribed_at on resignup
      env.DB.prepare(
        `INSERT INTO course_waitlist (id, course_id, email, user_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(course_id, email) DO UPDATE SET
           user_id = COALESCE(course_waitlist.user_id, excluded.user_id),
           unsubscribed_at = NULL`
      ).bind(waitlistId, courseId, email, userId),
    ];

    // 2. Newsletter: merge segment without touching unsubscribed status
    if (existingSub) {
      const segs = JSON.parse(existingSub.segments || '[]') || [];
      if (!segs.includes(waitlistSegment)) {
        segs.push(waitlistSegment);
        statements.push(
          env.DB.prepare(
            'UPDATE newsletter_subscriber SET segments = ? WHERE id = ?'
          ).bind(JSON.stringify(segs), existingSub.id)
        );
      }
      // else: segment already present — no-op, nothing to push
    } else {
      statements.push(
        env.DB.prepare(
          "INSERT INTO newsletter_subscriber (id, email, status, source, subscribed_at, segments) VALUES (?, ?, 'active', ?, datetime('now'), ?)"
        ).bind(generateId(), email, `waitlist-${courseId}`, JSON.stringify([waitlistSegment]))
      );
    }

    // 3. contact_tag if we have a contact_id
    if (contactId) {
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO contact_tag (contact_id, tag, source) VALUES (?, ?, 'waitlist')"
        ).bind(contactId, waitlistSegment)
      );
    }

    const results = await env.DB.batch(statements);

    // 11. Gate analytics on actual new insertion (changes > 0 on the waitlist upsert)
    const wasNew = results[0]?.meta?.changes > 0;
    if (wasNew) {
      log(env, waitUntil, 'courses', 'waitlist_signup', 'ok', courseId, 0, 200);
      waitUntil(sendGA4Event(env, request, 'generate_lead', {
        lead_source: 'course_waitlist',
        items: [{ item_name: `Course: ${courseId}` }],
      }).catch(() => {}));
    } else {
      log(env, waitUntil, 'courses', 'waitlist_duplicate', 'ok', courseId, 0, 200);
    }
  } catch (err) {
    log(env, waitUntil, 'courses', 'waitlist_error', 'error', courseId, 0, 500);
    return json({ ok: false, error: 'server_error' }, 500);
  }

  return json({ ok: true });
}
