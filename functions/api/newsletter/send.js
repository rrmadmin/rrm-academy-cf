/**
 * POST /api/newsletter/send
 * Admin-only: send a newsletter to subscribers (paginated).
 *
 * Body: { subject, body, segments?, slug?, sendId?, cursor? }
 *   - subject: email subject line
 *   - body: HTML content (the message, Gmail-plain style)
 *   - segments: optional array of segment names to filter (null = all active)
 *   - slug: commentary slug (for RSS-triggered sends, stored for dedup)
 *   - sendId: existing send ID to continue a paginated send
 *   - cursor: subscriber ID to resume from (returned by previous call)
 */
import { log } from '../_log.js';
import { sendRawEmail } from '../_ses.js';
import { renderEmail } from './_template.js';
import { unsubscribeHeaders } from './_tracking.js';
import { constantTimeEqual } from '../auth/_shared.js';

const PAGE_SIZE = 80;           // subscribers per invocation
const BATCH_SIZE = 10;          // concurrent sends per batch
const BATCH_DELAY_MS = 500;     // pause between batches; 10 concurrent + network latency keeps us under SES 14/sec

export async function onRequestPost({ request, env, waitUntil }) {
  // Admin auth
  const auth = request.headers.get('Authorization');
  if (!env.ADMIN_API_SECRET || !constantTimeEqual(auth, `Bearer ${env.ADMIN_API_SECRET}`)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!env.NEWSLETTER_SECRET) {
    return Response.json({ ok: false, error: 'NEWSLETTER_SECRET not configured' }, { status: 500 });
  }

  if (!env.DB) {
    return Response.json({ ok: false, error: 'DB not configured' }, { status: 500 });
  }

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ ok: false, error: 'Invalid payload' }, { status: 400 });
  }

  const { subject, body: htmlBody, segments, slug, sendId: existingSendId, cursor } = body;
  if (!subject || !htmlBody) {
    return Response.json({ ok: false, error: 'subject and body are required' }, { status: 400 });
  }

  const db = env.DB;

  // Create or resume send record
  let sendId = existingSendId;
  if (!sendId) {
    sendId = crypto.randomUUID();

    // Count total recipients upfront (only on first call)
    let totalRecipients;
    if (!segments || segments.length === 0) {
      const countResult = await db.prepare(
        "SELECT COUNT(*) as c FROM newsletter_subscriber WHERE status = 'active'"
      ).first();
      totalRecipients = countResult.c;
    } else {
      const allSubs = await db.prepare(
        "SELECT segments FROM newsletter_subscriber WHERE status = 'active'"
      ).all();
      totalRecipients = allSubs.results.filter(sub => {
        const subSegs = JSON.parse(sub.segments || '[]');
        return segments.some(seg => subSegs.includes(seg));
      }).length;
    }

    await db.prepare(
      "INSERT INTO newsletter_send (id, subject, html, segment_filter, status, total_recipients, commentary_slug) VALUES (?, ?, ?, ?, 'sending', ?, ?)"
    ).bind(sendId, subject, htmlBody, segments ? JSON.stringify(segments) : null, totalRecipients, slug || null).run();
  } else {
    await db.prepare("UPDATE newsletter_send SET status = 'sending' WHERE id = ?").bind(sendId).run();
  }

  // Build suppression set from ELV tags (spamtraps, disabled, disposable, invalid)
  // Safety net: even if a bad email somehow got into newsletter_subscriber, don't send to it
  const suppressedEmails = new Set();
  try {
    const badTags = (await db.prepare(
      `SELECT c.email FROM contact c
       JOIN contact_tag ct ON ct.contact_id = c.id
       WHERE ct.tag IN ('elv:spamtrap', 'elv:email_disabled', 'elv:disposable', 'elv:invalid', 'elv:dead_server', 'elv:invalid_mx')`
    ).all()).results;
    for (const r of badTags) suppressedEmails.add(r.email?.toLowerCase());
  } catch (err) {
    if (!err?.message?.includes('no such table')) {
      log(env, waitUntil, 'newsletter', 'suppression_query_error', 'warn', err?.message || 'unknown', 0, 0);
    }
  }

  // Query active subscribers, paginated by ID with LIMIT (parameterized, no string interpolation)
  // Fetch PAGE_SIZE * 2 to allow for segment filtering + already-sent exclusion, then slice
  const fetchLimit = PAGE_SIZE * 2 + 1;
  const params = [];
  let query = "SELECT id, email, name, segments FROM newsletter_subscriber WHERE status = 'active'";
  if (cursor) { query += ' AND id > ?'; params.push(cursor); }
  query += ' ORDER BY id ASC LIMIT ?';
  params.push(fetchLimit);
  const subscribers = (await db.prepare(query).bind(...params).all()).results;

  // Filter by segment if requested, and suppress bad ELV emails
  let recipients = subscribers.filter(s => !suppressedEmails.has(s.email?.toLowerCase()));
  if (segments && segments.length > 0) {
    recipients = recipients.filter(sub => {
      const subSegments = JSON.parse(sub.segments || '[]');
      return segments.some(seg => subSegments.includes(seg));
    });
  }

  // Exclude already-sent subscribers (handles resume after crash mid-page)
  // Scope to cursor range to avoid unbounded query
  const sentQuery = cursor
    ? "SELECT subscriber_id FROM newsletter_event WHERE send_id = ? AND event = 'sent' AND subscriber_id > ?"
    : "SELECT subscriber_id FROM newsletter_event WHERE send_id = ? AND event = 'sent'";
  const sentParams = cursor ? [sendId, cursor] : [sendId];
  const alreadySent = (await db.prepare(sentQuery).bind(...sentParams).all()).results.map(r => r.subscriber_id);
  const sentSet = new Set(alreadySent);
  recipients = recipients.filter(r => !sentSet.has(r.id));

  // Take only PAGE_SIZE for this invocation
  const page = recipients.slice(0, PAGE_SIZE);
  // hasMore: true if we fetched a full batch (more rows likely exist) or filtered recipients exceed PAGE_SIZE
  const hasMore = subscribers.length >= fetchLimit || recipients.length > PAGE_SIZE;

  // Send in batches
  let sentCount = 0;
  for (let i = 0; i < page.length; i += BATCH_SIZE) {
    const batch = page.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (sub) => {
        const { html, text } = await renderEmail({
          body: htmlBody,
          sendId,
          subscriberId: sub.id,
          email: sub.email,
          secret: env.NEWSLETTER_SECRET,
        });

        const headers = await unsubscribeHeaders(sub.email, env.NEWSLETTER_SECRET);

        await sendRawEmail(env, {
          from: '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>',
          to: sub.email,
          subject,
          html,
          text,
          headers,
          configurationSet: 'rrm-newsletter',
          log: { db, source: 'newsletter/send', category: 'newsletter' },
        });

        // Record sent event + bump last_sent_at atomically
        await db.batch([
          db.prepare("INSERT INTO newsletter_event (send_id, subscriber_id, event) VALUES (?, ?, 'sent')").bind(sendId, sub.id),
          db.prepare("UPDATE newsletter_subscriber SET last_sent_at = datetime('now') WHERE id = ?").bind(sub.id)
        ]);

        return sub.id;
      })
    );

    sentCount += results.filter(r => r.status === 'fulfilled').length;

    // Log failures
    results.filter(r => r.status === 'rejected').forEach(r => {
      log(env, waitUntil, 'newsletter', 'send_error', 'error', r.reason?.message || 'unknown', 0, 0);
    });

    // Rate limit delay between batches
    if (i + BATCH_SIZE < page.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // Update running sent_count
  await db.prepare(
    "UPDATE newsletter_send SET sent_count = sent_count + ? WHERE id = ?"
  ).bind(sentCount, sendId).run();

  // If no more recipients, mark as sent
  if (!hasMore) {
    await db.prepare(
      "UPDATE newsletter_send SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
    ).bind(sendId).run();
    log(env, waitUntil, 'newsletter', 'send_complete', 'ok', `send ${sendId} complete`, 0, 200);
  }

  const lastId = page.length > 0
    ? page[page.length - 1].id
    : (subscribers.length > 0 ? subscribers[subscribers.length - 1].id : null);
  const nextCursor = lastId;

  return Response.json({
    ok: true,
    done: !hasMore,
    sendId,
    cursor: hasMore ? nextCursor : null,
    sent: sentCount,
    remaining: hasMore ? recipients.length - PAGE_SIZE : 0,
  });
}
