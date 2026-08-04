/**
 * POST /api/newsletter/send
 * Admin-only: send a newsletter to subscribers (paginated).
 *
 * Body: { subject, body, segments?, excludeSegments?, slug?, sendId?, cursor? }
 *   - subject: email subject line
 *   - body: HTML content (the message, Gmail-plain style)
 *   - segments: optional array of segment names to filter (null = all active)
 *   - excludeSegments: optional array of segment names to exclude; a subscriber
 *     matching ANY excluded segment is dropped even if they also match an
 *     included segment (lets disjoint-cohort sends target "segment X minus
 *     anyone also in segment Y")
 *   - slug: commentary slug (for RSS-triggered sends, stored for dedup)
 *   - sendId: existing send ID to continue a paginated send
 *   - cursor: subscriber ID to resume from (returned by previous call)
 *
 * Both segments and excludeSegments are persisted on the newsletter_send row
 * (segment_filter / exclude_segment_filter) on the call that creates it. Every
 * resume call (one carrying sendId) re-reads BOTH from that row and filters
 * against the PERSISTED values, never the values a resume call happens to
 * supply -- a driver that omits either parameter on a later page must keep
 * getting the same cohort, not silently fall back to "no filter". A resume
 * call may still pass segments/excludeSegments (n8n resends the same body on
 * every page for this endpoint), but if what it sends disagrees with what was
 * persisted, the call is refused with 409 rather than picking one silently --
 * a mid-campaign filter change is an operator error worth stopping for.
 *
 * A request carrying cursor MUST also carry a sendId that resolves to an
 * existing row (400 cursor_requires_send_id otherwise). Without this, a page
 * beyond the first that drops sendId mints a brand-new send with no history --
 * defeating both the persisted-filter resume above and the already-sent guard
 * (scoped by sendId), and reaching subscribers the original call excluded.
 *
 * A persisted filter that fails to parse as JSON aborts the send (500
 * persisted_filter_unreadable) rather than degrading to "no filter" -- an
 * unreadable filter is not the same as no filter.
 */
import { log } from '../_log.js';
import { sendRawEmail } from '../_ses.js';
import { renderEmail } from './_template.js';
import { unsubscribeHeaders } from './_tracking.js';
import { constantTimeEqual } from '../auth/_shared.js';

function parseSegments(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Parses a persisted newsletter_send filter column (segment_filter /
 * exclude_segment_filter). Unlike parseSegments (used for a subscriber's own
 * segment list, where a corrupt value only misclassifies that one row), an
 * unreadable persisted filter is a send-wide safety property -- defaulting it
 * to [] would silently turn a scoped/excluded send into an unfiltered one.
 * Throws on anything that isn't valid JSON encoding an array.
 */
function parsePersistedFilter(s) {
  if (s === null || s === undefined) return [];
  const v = JSON.parse(s);
  if (!Array.isArray(v)) throw new Error('persisted filter is not an array');
  return v;
}

/** Order-insensitive set equality for segment-name arrays. */
function sameSegmentSet(a, b) {
  const na = [...new Set(a)].sort();
  const nb = [...new Set(b)].sort();
  if (na.length !== nb.length) return false;
  return na.every((v, i) => v === nb[i]);
}

const PAGE_SIZE = 80;           // subscribers per invocation
const BATCH_SIZE = 10;          // concurrent sends per batch
const BATCH_DELAY_MS = 500;     // pause between batches; 10 concurrent + network latency keeps us under SES 14/sec

// Circuit breaker: aborts the run on systemic send failure (e.g. a bad SES
// configuration set or revoked credentials) instead of marching through the
// whole recipient list marking everyone sent while delivering nothing.
// Recipients here are already ELV-verified + suppression-filtered, so an
// individual SES rejection is rare -- a whole batch failing is strong
// evidence of misconfiguration, not bad addresses. Bounds phantom
// newsletter_event rows per invocation to at most BATCH_SIZE (first-batch
// case) or FAILURE_RATE_MIN_SAMPLE (sustained-partial-failure case).
const FAILURE_RATE_THRESHOLD = 0.5;   // 50%+ failures across the min sample below aborts the run
const FAILURE_RATE_MIN_SAMPLE = 20;   // don't judge systemic failure on fewer than 2 batches' worth of attempts

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

  const { subject, body: htmlBody, segments, excludeSegments, slug, sendId: existingSendId, cursor } = body;
  if (typeof subject !== 'string' || typeof htmlBody !== 'string' || !subject.trim() || !htmlBody.trim()) {
    return Response.json({ ok: false, error: 'subject and body required as non-empty strings' }, { status: 400 });
  }
  if (subject.length > 998 || htmlBody.length > 500_000) {
    return Response.json({ ok: false, error: 'subject or body too long' }, { status: 400 });
  }
  if (segments !== undefined && segments !== null) {
    if (!Array.isArray(segments) || !segments.every(s => typeof s === 'string' && s.length > 0 && s.length < 100)) {
      return Response.json({ ok: false, error: 'segments must be an array of strings' }, { status: 400 });
    }
  }
  if (excludeSegments !== undefined && excludeSegments !== null) {
    if (!Array.isArray(excludeSegments) || !excludeSegments.every(s => typeof s === 'string' && s.length > 0 && s.length < 100)) {
      return Response.json({ ok: false, error: 'excludeSegments must be an array of strings' }, { status: 400 });
    }
  }

  if (cursor !== undefined && cursor !== null && (
    typeof cursor !== 'string' ||
    cursor.length > 50 ||
    !/^[0-9a-f-]+$/i.test(cursor)
  )) {
    return Response.json({ ok: false, error: 'invalid_cursor' }, { status: 400 });
  }

  // Any request carrying a cursor MUST also carry a sendId (resolved to an
  // existing row just below, in the resume branch) -- see the file-level
  // comment above for why. This is a create-vs-resume decision, so it must be
  // checked before the `!sendId` branch below ever runs.
  if (cursor && !existingSendId) {
    return Response.json({ ok: false, error: 'cursor_requires_send_id' }, { status: 400 });
  }

  const db = env.DB;

  // Effective filters used for this invocation's query/send logic. On the
  // first call these are just the validated request values; on a resume call
  // they are overwritten below with whatever was persisted on the row.
  let effectiveSegments = segments && segments.length > 0 ? segments : null;
  let effectiveExcludeSegments = excludeSegments && excludeSegments.length > 0 ? excludeSegments : null;

  // Create or resume send record
  let sendId = existingSendId;
  if (!sendId) {
    sendId = crypto.randomUUID();

    // Count candidate recipients upfront (only on first call); does not account for suppression set
    let totalRecipients;
    if (!effectiveSegments && !effectiveExcludeSegments) {
      const countResult = await db.prepare(
        "SELECT COUNT(*) as c FROM newsletter_subscriber WHERE status = 'active'"
      ).first();
      totalRecipients = countResult.c;
    } else {
      const allSubs = await db.prepare(
        "SELECT segments FROM newsletter_subscriber WHERE status = 'active'"
      ).all();
      totalRecipients = allSubs.results.filter(sub => {
        const subSegs = parseSegments(sub.segments);
        if (effectiveExcludeSegments && effectiveExcludeSegments.some(seg => subSegs.includes(seg))) {
          return false;
        }
        if (effectiveSegments && !effectiveSegments.some(seg => subSegs.includes(seg))) {
          return false;
        }
        return true;
      }).length;
    }

    // arise-ignore unbatched-writes -- if/else branch; only one .run() executes per request
    await db.prepare(
      "INSERT INTO newsletter_send (id, subject, html, segment_filter, exclude_segment_filter, status, total_recipients, commentary_slug) VALUES (?, ?, ?, ?, ?, 'sending', ?, ?)"
    ).bind(
      sendId,
      subject,
      htmlBody,
      effectiveSegments ? JSON.stringify(effectiveSegments) : null,
      effectiveExcludeSegments ? JSON.stringify(effectiveExcludeSegments) : null,
      totalRecipients,
      slug || null
    ).run();
  } else {
    // Resume: the persisted filters on this row are authoritative. A resume
    // call that omits segments/excludeSegments must keep filtering by the
    // cohort the send was created with, not silently fall back to "everyone".
    const existingSend = await db.prepare(
      "SELECT segment_filter, exclude_segment_filter FROM newsletter_send WHERE id = ?"
    ).bind(sendId).first();
    if (!existingSend) {
      return Response.json({ ok: false, error: 'send_not_found' }, { status: 404 });
    }

    let persistedSegments, persistedExcludeSegments;
    try {
      persistedSegments = parsePersistedFilter(existingSend.segment_filter);
      persistedExcludeSegments = parsePersistedFilter(existingSend.exclude_segment_filter);
    } catch (err) {
      log(env, waitUntil, 'newsletter', 'persisted_filter_unreadable', 'error', err.message, 0, 500);
      return Response.json({ ok: false, error: 'persisted_filter_unreadable', sendId }, { status: 500 });
    }

    if (segments !== undefined && segments !== null && !sameSegmentSet(segments, persistedSegments)) {
      return Response.json({
        ok: false,
        error: 'segments_conflict',
        persisted: persistedSegments,
        supplied: segments,
      }, { status: 409 });
    }
    if (excludeSegments !== undefined && excludeSegments !== null && !sameSegmentSet(excludeSegments, persistedExcludeSegments)) {
      return Response.json({
        ok: false,
        error: 'exclude_segments_conflict',
        persisted: persistedExcludeSegments,
        supplied: excludeSegments,
      }, { status: 409 });
    }

    effectiveSegments = persistedSegments.length > 0 ? persistedSegments : null;
    effectiveExcludeSegments = persistedExcludeSegments.length > 0 ? persistedExcludeSegments : null;

    await db.prepare("UPDATE newsletter_send SET status = 'sending' WHERE id = ?").bind(sendId).run();
  }

  // Build suppression set from ELV tags (spamtraps, disabled, disposable, invalid)
  // Safety net: even if a bad email somehow got into newsletter_subscriber, don't send to it
  const suppressedEmails = new Set();
  try {
    const badTags = (await db.prepare(
      `SELECT c.email FROM contact c
       JOIN contact_tag ct ON ct.contact_id = c.id
       WHERE ct.tag IN ('elv:spamtrap', 'elv:email_disabled', 'elv:disposable',
                        'elv:invalid', 'elv:dead_server', 'elv:invalid_mx',
                        'wix:unsubscribed', 'email:bounced', 'wix:bounced', 'email:complained')`
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

  // Filter by segment if requested, and suppress bad ELV emails.
  // Uses the effective (persisted-on-resume) filters, never the raw request values.
  let recipients = subscribers.filter(s => !suppressedEmails.has(s.email?.toLowerCase()));
  if (effectiveSegments) {
    recipients = recipients.filter(sub => {
      const subSegments = parseSegments(sub.segments);
      return effectiveSegments.some(seg => subSegments.includes(seg));
    });
  }
  if (effectiveExcludeSegments) {
    recipients = recipients.filter(sub => {
      const subSegments = parseSegments(sub.segments);
      return !effectiveExcludeSegments.some(seg => subSegments.includes(seg));
    });
  }

  // Exclude already-sent subscribers (handles resume after crash mid-page)
  // Not scoped to cursor range so that failed sends from prior pages can be retried
  const alreadySent = (await db.prepare(
    "SELECT subscriber_id FROM newsletter_event WHERE send_id = ? AND event = 'sent'"
  ).bind(sendId).all()).results.map(r => r.subscriber_id);
  const sentSet = new Set(alreadySent);
  recipients = recipients.filter(r => !sentSet.has(r.id));

  // Take only PAGE_SIZE for this invocation
  const page = recipients.slice(0, PAGE_SIZE);
  // hasMore: true if we fetched a full batch (more rows likely exist) or filtered recipients exceed PAGE_SIZE
  const hasMore = subscribers.length >= fetchLimit || recipients.length > PAGE_SIZE;

  // Send in batches
  let sentCount = 0;
  let attemptedCount = 0;
  let failedCount = 0;
  let abortReason = null;
  const succeededIds = [];
  for (let i = 0; i < page.length; i += BATCH_SIZE) {
    const batch = page.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (sub) => {
        // Re-check status: guard against concurrent unsubscribe during send
        const stillActive = await db.prepare(
          "SELECT status FROM newsletter_subscriber WHERE id = ?"
        ).bind(sub.id).first();
        if (stillActive?.status !== 'active') {
          log(env, waitUntil, 'newsletter', 'send_skipped_status_changed', 'warn', sub.email, 0, 200);
          return null;
        }

        const { html, text } = await renderEmail({
          body: htmlBody,
          sendId,
          subscriberId: sub.id,
          email: sub.email,
          secret: env.NEWSLETTER_SECRET,
        });

        const headers = await unsubscribeHeaders(sub.email, env.NEWSLETTER_SECRET);

        // Record send intent before calling SES; if SES throws after this point the
        // subscriber is marked sent and skipped on retry (false-positive sent < double-send)
        await db.batch([
          db.prepare("INSERT INTO newsletter_event (send_id, subscriber_id, event) VALUES (?, ?, 'sent')").bind(sendId, sub.id),
          db.prepare("UPDATE newsletter_subscriber SET last_sent_at = datetime('now') WHERE id = ?").bind(sub.id),
        ]);

        await sendRawEmail(env, {
          from: '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>',
          to: sub.email,
          subject,
          html,
          text,
          headers,
          replyTo: 'community@rrmacademy.org',
          configurationSet: 'rrm-email',
          log: { db, source: 'newsletter/send', category: 'newsletter' },
        });

        return sub.id;
      })
    );

    let batchAttempted = 0;
    let batchFailed = 0;
    let lastFailureMessage = null;
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled' && results[j].value !== null) {
        sentCount++;
        succeededIds.push(batch[j].id);
        attemptedCount++;
        batchAttempted++;
      } else if (results[j].status === 'rejected') {
        lastFailureMessage = results[j].reason?.message || 'unknown';
        log(env, waitUntil, 'newsletter', 'send_error', 'error', lastFailureMessage, 0, 0);
        attemptedCount++;
        batchAttempted++;
        failedCount++;
        batchFailed++;
      }
    }

    // Circuit breaker -- see constants above for threshold rationale.
    if (
      (batchAttempted > 0 && batchFailed === batchAttempted) ||
      (attemptedCount >= FAILURE_RATE_MIN_SAMPLE && failedCount / attemptedCount >= FAILURE_RATE_THRESHOLD)
    ) {
      abortReason = lastFailureMessage;
      break;
    }

    // Rate limit delay between batches
    if (i + BATCH_SIZE < page.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // Update running sent_count (reflects whatever succeeded before an abort, if any)
  await db.prepare(
    "UPDATE newsletter_send SET sent_count = sent_count + ? WHERE id = ?"
  ).bind(sentCount, sendId).run();

  if (abortReason) {
    await db.prepare(
      "UPDATE newsletter_send SET status = 'failed' WHERE id = ?"
    ).bind(sendId).run();
    log(env, waitUntil, 'newsletter', 'send_aborted_systemic_failure', 'error', abortReason, 0, 502);
    return Response.json({
      ok: false,
      error: 'ses_systemic_failure',
      sesError: String(abortReason).slice(0, 300),
      sendId,
      sent: sentCount,
    }, { status: 502 });
  }

  // If no more recipients, mark as sent
  if (!hasMore) {
    await db.prepare(
      "UPDATE newsletter_send SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
    ).bind(sendId).run();
    log(env, waitUntil, 'newsletter', 'send_complete', 'ok', `send ${sendId} complete`, 0, 200);
  }

  // Cursor = highest successful ID so failed sends in this page get retried on resume.
  // If nothing in this fetch was even a send candidate (whole page filtered out by
  // segment/excludeSegments/suppression/already-sent -- expected for narrow cohorts
  // like a 48-person segment scanned in 80-row windows across 6,229 subscribers),
  // advance past the whole scanned range so pagination keeps making forward
  // progress instead of re-fetching the same non-matching rows forever.
  const rawLastId = subscribers.length > 0 ? subscribers[subscribers.length - 1].id : null;
  const lastSuccess = succeededIds.length > 0 ? succeededIds[succeededIds.length - 1] : null;
  const nextCursor = lastSuccess || (page.length === 0 ? rawLastId : cursor) || null;

  // recipients.length can be < PAGE_SIZE on a page where most of the fetch
  // window was filtered out by segments/excludeSegments/suppression (the
  // common case for a narrow cohort) -- clamp so a driver branching on
  // `remaining` never sees a negative "recipients left" count. This is an
  // estimate scoped to the current fetch window, not a total-outstanding count.
  const remaining = hasMore ? Math.max(recipients.length - PAGE_SIZE, 0) : 0;

  return Response.json({
    ok: true,
    done: !hasMore,
    sendId,
    cursor: hasMore ? nextCursor : null,
    sent: sentCount,
    remaining,
  });
}
