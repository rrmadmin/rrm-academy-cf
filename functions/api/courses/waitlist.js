/**
 * POST /api/courses/waitlist
 * Captures email sign-ups for waitlisted affiliate courses.
 * Dual-subscribes to newsletter_subscriber with a waitlist segment.
 */
import { json, optionsResponse, verifyTurnstile, generateId, getSessionIdFromCookie, validateSession } from '../auth/_shared.js';
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

function checkIpLimit(ip) {
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

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const validated = validateBody(body, {
    courseId:       { type: 'string', required: true, maxLength: 100 },
    email:          { type: 'email',  required: true },
    turnstileToken: { type: 'string', required: true, maxLength: 2048 },
    website:        { type: 'string', required: false, maxLength: 200 },
  });
  if (!validated.valid) {
    return json({ ok: false, error: validated.error }, validated.status);
  }

  const { courseId, email, turnstileToken } = validated.data;

  // Honeypot
  if (body.website) {
    return json({ ok: true });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Rate limit by IP
  if (!checkIpLimit(ip)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  // Rate limit by email
  if (!checkEmailLimit(email)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  // Turnstile verification
  let turnstileOk;
  try {
    turnstileOk = await verifyTurnstile(env.CF_TURNSTILE_SECRET, turnstileToken, ip);
  } catch {
    return json({ ok: false, error: 'spam_check_failed' }, 403);
  }
  if (!turnstileOk) {
    return json({ ok: false, error: 'spam_check_failed' }, 403);
  }

  // Validate this is actually a waitlist course
  if (!isWaitlistCourse(courseId)) {
    return json({ ok: false, error: 'not_waitlist_course' }, 400);
  }

  // ELV mailbox verification
  let elv;
  try {
    elv = await verifyAndTagEmail(email, env, { source: `waitlist-${courseId}` });
  } catch {
    return json({ ok: false, error: 'email_rejected' }, 400);
  }
  if (elv.blocked) {
    return json({ ok: false, error: 'email_rejected' }, 400);
  }

  // Optional: read session; check blocked flag; capture user_id
  let userId = null;
  const sessionId = getSessionIdFromCookie(request);
  if (sessionId) {
    try {
      const session = await validateSession(env.DB, sessionId);
      if (session) {
        const user = await env.DB.prepare(
          'SELECT id, blocked FROM user WHERE id = ?'
        ).bind(session.userId).first();
        if (user?.blocked === 1) {
          return json({ ok: false, error: 'forbidden' }, 403);
        }
        userId = user?.id || null;
      }
    } catch {
      // Non-fatal: proceed without session
    }
  }

  // Get contact_id from ELV CRM upsert for contact_tag
  let contactId = null;
  try {
    const contact = await env.DB.prepare(
      'SELECT id FROM contact WHERE email = ? COLLATE NOCASE'
    ).bind(email).first();
    contactId = contact?.id || null;
  } catch {
    // Non-fatal
  }

  // Batch all D1 writes
  const waitlistId = generateId();
  const newsletterSegments = JSON.stringify([`waitlist:${courseId}`]);

  try {
    const statements = [
      // 1. Waitlist entry (UNIQUE on course_id + email — idempotent)
      env.DB.prepare(
        'INSERT OR IGNORE INTO course_waitlist (id, course_id, email, user_id) VALUES (?, ?, ?, ?)'
      ).bind(waitlistId, courseId, email, userId),

      // 2. Dual-subscribe to newsletter with segment
      env.DB.prepare(
        "INSERT OR IGNORE INTO newsletter_subscriber (id, email, status, source, subscribed_at, segments) VALUES (?, ?, 'active', ?, datetime('now'), ?)"
      ).bind(generateId(), email, `waitlist-${courseId}`, newsletterSegments),
    ];

    // 3. contact_tag if we have a contact_id
    if (contactId) {
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO contact_tag (contact_id, tag, source) VALUES (?, ?, 'waitlist')"
        ).bind(contactId, `waitlist:${courseId}`)
      );
    }

    await env.DB.batch(statements);
  } catch (err) {
    log(env, waitUntil, 'courses', 'waitlist_error', 'error', courseId, 0, 500);
    return json({ ok: false, error: 'server_error' }, 500);
  }

  // Analytics (fire-and-forget)
  log(env, waitUntil, 'courses', 'waitlist_signup', 'ok', courseId, 0, 200);
  waitUntil(sendGA4Event(env, request, 'generate_lead', {
    lead_source: 'course_waitlist',
    items: [{ item_name: `Course: ${courseId}` }],
  }).catch(() => {}));

  return json({ ok: true });
}
