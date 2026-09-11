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
import { sendRawEmail, logEmailFailure, preflightLane, LaneRefused } from '../_ses.js';
import {
  remainingAllowance, truncateToAllowance, breakerVerdict, feedbackId, isCampaignKey,
  COHORT_ORDER_SQL, BULK_DOMAIN, PAUSE_LOG_WRITE_FAILED,
} from './_policy.js';
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

/**
 * THE BULK LANE.
 *
 * A second path through this endpoint, selected by `lane: 'bulk'`. It exists
 * because the 2026-09-06 to 09-08 drip sent about 2,880 messages as
 * rrmacademy.org and put a 0.55% user-reported spam day on the domain in Google
 * Postmaster Tools -- above the 0.3% policy line -- flipping its Compliance
 * status to "Needs work", a verdict every transactional send from the domain
 * shares. Bulk now leaves from a separate registrable domain under a ramp
 * table, a per-UTC-day counter and a 24h complaint breaker.
 *
 * THE LEGACY PATH BELOW IS UNTOUCHED, deliberately. Its drivers are live, and
 * the membership exclusion this path applies is the BULK audience's rule (a
 * paying STUC member is routed to the Warm lane, spec section 3), not a new
 * rule for every newsletter send. Narrowing the legacy audience without a
 * mandate would be a silent cohort change nobody asked for.
 */
const BULK_CONFIGURATION_SET = 'rrm-bulk';
const BULK_REPLY_TO = 'administrator@rrmacademy.org';
/** Spec section 5.1: "Pacing is 1 to 2 s between SES calls." */
const BULK_PACING_MS = 1500;

/**
 * The bulk audience. Two correlated NOT EXISTS clauses implement spec section
 * 3's routing rule verbatim: a recipient is WARM when wix_subscription.status
 * is 'active' for that email (COLLATE NOCASE) OR a contact carries the
 * stuc:member tag, and everything else is BULK. There is no per-send override.
 *
 * membership_state is deliberately NOT consulted. Migration 034 added it as a
 * LAPSE-REASON code: it is NULL for every active member and is populated only
 * when a membership leaves active, and 034's own header names `status` as "the
 * gating field other code depends on". Gating on membership_state would route
 * every lapsed member to the Warm lane, which is the opposite of what it means.
 *
 * Three exclusions ride along: consent state (spec section 5.5), the ELV and
 * wix suppression tags the legacy path already applies, and everyone this
 * campaign key has already been sent to. The last is a LIKE on the source
 * prefix rather than a join on sendId, so a campaign that spans several runs,
 * several sendIds and several days still never mails the same person twice.
 */
const BULK_AUDIENCE_SQL = `
  SELECT s.id, s.email, s.name, s.segments, s.source,
         s.last_clicked_at, s.last_opened_at, s.last_sent_at, s.subscribed_at
    FROM newsletter_subscriber s
   WHERE s.status = 'active'
     AND NOT EXISTS (
       SELECT 1 FROM wix_subscription ws
        WHERE ws.email = s.email COLLATE NOCASE AND ws.status = 'active'
     )
     AND NOT EXISTS (
       SELECT 1 FROM contact c
        JOIN contact_tag ct ON ct.contact_id = c.id
       WHERE c.email = s.email COLLATE NOCASE AND ct.tag = 'stuc:member'
     )
     AND NOT EXISTS (
       SELECT 1 FROM contact c2
        JOIN contact_tag ct2 ON ct2.contact_id = c2.id
       WHERE c2.email = s.email COLLATE NOCASE
         AND ct2.tag IN ('elv:spamtrap', 'elv:email_disabled', 'elv:disposable',
                         'elv:invalid', 'elv:dead_server', 'elv:invalid_mx',
                         'wix:unsubscribed', 'email:bounced', 'wix:bounced', 'email:complained')
     )
     AND NOT EXISTS (
       SELECT 1 FROM email_log el
        WHERE el.email = s.email COLLATE NOCASE
          AND el.event = 'send'
          AND el.source LIKE ?
     )
   ORDER BY ${COHORT_ORDER_SQL}
`;

/**
 * The TRUE size of the eligible audience, independent of any page LIMIT.
 *
 * runBulkSend fetches only `remaining + 1` cohort rows so it can answer
 * `done` without a second query, but that means `cohort.length` is capped at
 * the day's remaining allowance and cannot be used to report how many
 * recipients are left for tomorrow -- a 12-person audience with a
 * remaining-allowance of 5 would fetch 6 rows and, read naively, report a
 * deferral of 1 instead of 7. This wraps BULK_AUDIENCE_SQL (same WHERE, same
 * single sourcePrefix bind, ORDER BY is harmless inside a COUNT subquery) with
 * no LIMIT, so `deferred` is computed from the real audience count minus what
 * this call actually processed, not from how many rows happened to be fetched.
 */
const BULK_AUDIENCE_COUNT_SQL = `SELECT COUNT(*) AS c FROM (${BULK_AUDIENCE_SQL}) t`;

/**
 * The trailing-24h numbers the breaker judges.
 *
 * TWO TIME BOUNDS, TWO FORMATS, ON PURPOSE. email_log.created_at is written by
 * datetime('now') -- 'YYYY-MM-DD HH:MM:SS' -- while email_event.ts is the SES
 * event's own ISO 8601 stamp, 'YYYY-MM-DDTHH:MM:SS.sssZ'. The two differ at
 * offset 10, ' ' against 'T', and ' ' sorts BELOW 'T', so a single
 * datetime('now','-24 hours') bound compared against ts would silently admit
 * events from outside the window. The sends bound is computed in SQL; the
 * events bound is a JS ISO string bound as a parameter.
 *
 * Complaints and bounces are scoped to the campaign by joining email_event to
 * email_log on ses_message_id, NOT by email_event.source: the mail package
 * sends no SES message tags, so events.js has nothing to put in that column and
 * it is NULL for every row this path produces.
 */
async function bulkTrailingCounts(db, sourcePrefix, nowIso) {
  const since = new Date(Date.parse(nowIso) - 24 * 3600 * 1000).toISOString();
  // The bound below is compared against email_log.created_at (datetime('now'));
  // `since` is compared against email_event.ts (SES ISO 8601). One bound for
  // both would widen the complaint window. See the comment above the function.
  const sentRow = await db.prepare(
    // arise-ignore datetime-format-mismatch -- the mismatch is the design, see above
    "SELECT COUNT(*) AS c FROM email_log WHERE event = 'send' AND source LIKE ? AND created_at >= datetime('now','-24 hours')"
  ).bind(sourcePrefix).first();
  const events = (await db.prepare(
    `SELECT ev.event_type AS event_type, ev.bounce_type AS bounce_type, COUNT(*) AS c
       FROM email_event ev
       JOIN email_log el ON el.ses_message_id = ev.ses_message_id
      WHERE el.source LIKE ?
        AND el.event = 'send'
        AND ev.event_type IN ('complaint','bounce')
        AND ev.ts >= ?
      GROUP BY ev.event_type, ev.bounce_type`
  ).bind(sourcePrefix, since).all()).results;
  let complained = 0;
  let bounced = 0;
  for (const row of events) {
    if (row.event_type === 'complaint') complained += row.c;
    // Spec section 5.1: a HARD bounce is bounce_type = 'Permanent'. A transient
    // bounce is a mailbox full, not a bad address, and counting it would pause
    // a healthy run on somebody's holiday autoresponder.
    else if (row.bounce_type === 'Permanent') bounced += row.c;
  }
  return { sent: sentRow?.c || 0, complained, bounced };
}

/**
 * Write the pause and answer it. A pause is a STOP, not a retry: nothing in the
 * request path clears it, and the next run refuses until a human has read the
 * reason and passed --resume.
 */
async function pauseRun(db, { campaign, reason, detail, status, sendId, sent }) {
  await db.prepare(
    'INSERT INTO send_paused (id, campaign, reason, detail) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), campaign, reason, detail ? String(detail).slice(0, 500) : null).run();
  return Response.json({
    ok: false, error: 'bulk_paused', reason, detail: detail ? String(detail).slice(0, 300) : null,
    campaign, sendId: sendId || null, sent: sent || 0,
  }, { status });
}

/** The one open-pause question, asked before anything else touches a row. */
async function openPause(db, campaign) {
  return db.prepare(
    'SELECT id, reason, detail, paused_at FROM send_paused WHERE campaign = ? AND resumed_at IS NULL ORDER BY paused_at DESC LIMIT 1'
  ).bind(campaign).first();
}

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

  // The bulk lane is its own path. Everything below this line is the legacy
  // newsletter send, unchanged; see the BULK LANE comment above for why.
  if (body.lane === 'bulk') {
    return runBulkSend({ env, db, body, waitUntil });
  }

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

/**
 * THE BULK RUN. One call sends at most the day's remaining allowance, engaged
 * recipients first, and leaves the rest for tomorrow.
 *
 * The order of the gates is the design, not an accident. Every gate that can
 * refuse the WHOLE run runs before the first recipient row is read, so a
 * refusal leaves no newsletter_event rows, no last_sent_at stamps and no
 * newsletter_send row behind:
 *
 *   1. shape        -- campaign key, no cursor, dry-run default
 *   2. BULK_FROM    -- 503 rather than a silent fall back to the apex sender
 *   3. lane         -- preflightLane(), certain and total if it refuses
 *   4. open pause   -- a human has stopped this campaign
 *   5. first send   -- the domain has never sent and --first-send was not passed
 *   6. breaker      -- the trailing 24h is already over the line
 *   7. allowance    -- the day is spent
 *
 * Only then does it read the cohort.
 */
async function runBulkSend({ env, db, body, waitUntil }) {
  const nowIso = new Date().toISOString();
  const { subject, body: htmlBody, campaign, segments, send: doSend, firstSend, resume, cursor } = body;

  // 1. Shape.
  if (!isCampaignKey(campaign)) {
    return Response.json({
      ok: false, error: 'bulk_campaign_required',
      detail: 'campaign must be a lowercase slug of 2 to 64 characters, e.g. "sept-letter"',
    }, { status: 400 });
  }
  if (cursor) {
    return Response.json({
      ok: false, error: 'bulk_cursor_unsupported',
      detail: 'the bulk lane orders by engagement, which an id cursor cannot paginate; resume by calling again, already-sent recipients are excluded',
    }, { status: 400 });
  }
  const dryRun = doSend !== true;
  const source = `newsletter/bulk/${campaign}`;
  const sourcePrefix = `${source}%`;

  // 2. The sender, or nothing.
  if (!env.BULK_FROM) {
    return Response.json({ ok: false, error: 'bulk_from_not_configured' }, { status: 503 });
  }

  // 3. The lane. Certain and total if it refuses, so it is asked here.
  let lane;
  try {
    lane = preflightLane({ from: env.BULK_FROM, category: 'newsletter' });
  } catch (err) {
    if (err instanceof LaneRefused) {
      log(env, waitUntil, 'newsletter', 'bulk_lane_refused', 'error', `${err.reason}: ${err.detail}`.slice(0, 200), 0, 400);
      return Response.json({
        ok: false, error: 'bulk_lane_refused', reason: err.reason,
        detail: String(err.detail).slice(0, 300),
      }, { status: 400 });
    }
    throw err;
  }

  // 4. A pause a human has not cleared.
  const paused = await openPause(db, campaign);
  if (paused && resume !== true) {
    return Response.json({
      ok: false, error: 'bulk_paused', reason: paused.reason,
      detail: paused.detail, pausedAt: paused.paused_at, campaign,
      action: 'read the reason, then re-run with --resume',
    }, { status: 423 });
  }
  if (paused && resume === true && !dryRun) {
    await db.prepare("UPDATE send_paused SET resumed_at = datetime('now') WHERE id = ?").bind(paused.id).run();
  }

  // 5. The first-send gate. The row's ABSENCE means the domain has never sent,
  //    and --first-send creates it in its own write BEFORE any recipient is
  //    touched, so nothing ever computes a day count against a missing fact.
  let state = await db.prepare('SELECT first_send_at, day, sent_today FROM mail_domain_state WHERE domain = ?')
    .bind(BULK_DOMAIN).first();
  if ((!state || !state.first_send_at) && firstSend === true && !dryRun) {
    await db.prepare(
      `INSERT INTO mail_domain_state (domain, first_send_at, day, sent_today)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(domain) DO UPDATE SET first_send_at = COALESCE(mail_domain_state.first_send_at, excluded.first_send_at)`
    ).bind(BULK_DOMAIN, nowIso, nowIso.slice(0, 10)).run();
    state = await db.prepare('SELECT first_send_at, day, sent_today FROM mail_domain_state WHERE domain = ?')
      .bind(BULK_DOMAIN).first();
  }
  const allowance = remainingAllowance(state, nowIso);
  if (!allowance.ok) {
    return Response.json({
      ok: false, error: 'bulk_first_send_required', reason: allowance.reason, campaign,
      action: 'pass --first-send once, after reading the ramp table; it records the domain first-send and runs under the day 1 cap',
    }, { status: 409 });
  }

  // 6. The breaker, on the trailing 24h, before a single new message.
  const counts = await bulkTrailingCounts(db, sourcePrefix, nowIso);
  const verdict = breakerVerdict(counts);
  if (verdict.tripped && !dryRun) {
    log(env, waitUntil, 'newsletter', 'bulk_breaker_tripped', 'error', `${verdict.reason}: ${verdict.detail}`.slice(0, 200), 0, 423);
    return pauseRun(db, { campaign, reason: verdict.reason, detail: verdict.detail, status: 423, sent: 0 });
  }

  // 7. The day's allowance.
  if (allowance.remaining === 0 && !dryRun) {
    return Response.json({
      ok: false, error: 'bulk_cap_exhausted', campaign,
      cap: allowance.cap, ageDays: allowance.ageDays, sentToday: allowance.sentToday, remainingToday: 0,
    }, { status: 429 });
  }

  // The cohort, already ordered and already excluding everyone this campaign
  // has reached. Fetch one allowance's worth plus one, so `done` can be
  // answered without a second query.
  //
  // `cohort.length` is capped at fetchLimit, so it CANNOT stand in for the
  // true remaining audience: `deferred` must come from a separate COUNT(*)
  // (BULK_AUDIENCE_COUNT_SQL) over the same WHERE with no LIMIT, or a
  // 12-person audience with a remaining-allowance of 5 reports a deferral of
  // 1 instead of 7 (found reviewing this task against its own test). The
  // count does not account for a `segments` filter, which is applied in JS
  // below on the fetched page only -- a segment-filtered run's `deferred`
  // is therefore an upper bound on the truly-deferred count, not exact.
  const fetchLimit = Math.max(1, allowance.remaining) + 1;
  let cohort = (await db.prepare(`${BULK_AUDIENCE_SQL} LIMIT ?`).bind(sourcePrefix, fetchLimit).all()).results;
  const audienceCount = (await db.prepare(BULK_AUDIENCE_COUNT_SQL).bind(sourcePrefix).first()).c;
  if (segments && segments.length > 0) {
    cohort = cohort.filter((sub) => {
      const subSegments = parseSegments(sub.segments);
      return segments.some((seg) => subSegments.includes(seg));
    });
  }
  const { send: page } = truncateToAllowance(cohort, allowance.remaining);
  const segmentLabel = segments && segments.length > 0 ? segments.join('-') : null;

  if (dryRun) {
    const deferred = Math.max(0, audienceCount - page.length);
    return Response.json({
      ok: true, dryRun: true, done: false, lane, campaign,
      audience: audienceCount, wouldSend: page.length, deferred,
      cap: allowance.cap, ageDays: allowance.ageDays, sentToday: allowance.sentToday,
      remainingToday: allowance.remaining, sent: 0,
      feedbackId: feedbackId(campaign, segmentLabel),
      head: page.slice(0, 5).map((s) => s.email),
      breaker: verdict.detail,
      pausedNow: verdict.tripped ? verdict.reason : null,
    }, { status: 200 });
  }

  // A real run gets a newsletter_send row, so the existing surfaces that read
  // that table see a bulk campaign the same way they see any other send.
  const sendId = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO newsletter_send (id, subject, html, segment_filter, status, total_recipients, commentary_slug) VALUES (?, ?, ?, ?, 'sending', ?, ?)"
  ).bind(sendId, subject, htmlBody, segmentLabel ? JSON.stringify(segments) : null, page.length, null).run();

  let sentCount = 0;
  for (const sub of page) {
    // Re-check status immediately before SES so a concurrent unsubscribe during
    // a paced run is honoured, exactly as the legacy path does.
    // One read per recipient is the concurrent-unsubscribe guard the legacy path
    // also runs, and this loop is paced at BULK_PACING_MS between SES calls, so
    // a D1 round-trip is not the cost that matters here.
    // arise-ignore query-in-loop -- deliberate per-recipient guard, see above
    const stillActive = await db.prepare('SELECT status FROM newsletter_subscriber WHERE id = ?').bind(sub.id).first();
    if (stillActive?.status !== 'active') {
      log(env, waitUntil, 'newsletter', 'bulk_skipped_status_changed', 'warn', sub.email, 0, 200);
      continue;
    }

    const { html, text } = await renderEmail({
      body: htmlBody, sendId, subscriberId: sub.id, email: sub.email, secret: env.NEWSLETTER_SECRET,
    });
    const headers = {
      ...(await unsubscribeHeaders(sub.email, env.NEWSLETTER_SECRET)),
      'Feedback-ID': feedbackId(campaign, segmentLabel),
    };

    // Send intent first, same rule as the legacy path: on an SES failure a
    // false-positive sent beats a double-send.
    await db.batch([
      db.prepare("INSERT INTO newsletter_event (send_id, subscriber_id, event) VALUES (?, ?, 'sent')").bind(sendId, sub.id),
      db.prepare("UPDATE newsletter_subscriber SET last_sent_at = datetime('now') WHERE id = ?").bind(sub.id),
    ]);

    let messageId;
    try {
      // No `log` block: this path writes its own email_log row below, in the
      // SAME batch as the day counter, because insertEmailLog() swallows D1
      // failures by design and the counter must not be able to fall behind.
      ({ messageId } = await sendRawEmail(env, {
        from: env.BULK_FROM,
        to: sub.email,
        subject,
        html,
        text,
        headers,
        replyTo: BULK_REPLY_TO,
        configurationSet: BULK_CONFIGURATION_SET,
      }));
    } catch (err) {
      log(env, waitUntil, 'newsletter', 'bulk_send_error', 'error', String(err?.message || 'unknown').slice(0, 200), 0, 0);
      await logEmailFailure(db, {
        email: sub.email, category: 'newsletter', source, subject, detail: err?.message,
      });
      continue;
    }

    // The log row and the day counter, atomically. A failure here PAUSES the
    // run: the message is already delivered and is never reclassified, but the
    // cap has lost its only source of truth for the day, so sending stops.
    try {
      await db.batch([
        db.prepare(
          "INSERT INTO email_log (event, email, category, source, subject, send_id, ses_message_id, lane) VALUES ('send', ?, 'newsletter', ?, ?, ?, ?, ?)"
        ).bind(sub.email.toLowerCase(), source, subject, sendId, messageId, lane),
        db.prepare(
          `UPDATE mail_domain_state
              SET sent_today = CASE WHEN day = ? THEN sent_today + 1 ELSE 1 END,
                  day = ?,
                  updated_at = datetime('now')
            WHERE domain = ?`
        ).bind(nowIso.slice(0, 10), nowIso.slice(0, 10), BULK_DOMAIN),
      ]);
    } catch (err) {
      sentCount++;
      log(env, waitUntil, 'newsletter', 'bulk_log_write_failed', 'error', String(err?.message || 'unknown').slice(0, 200), 0, 500);
      // arise-ignore query-in-loop -- not per-iteration: this catch runs at most once, and the next statement returns out of the loop
      await db.prepare("UPDATE newsletter_send SET sent_count = sent_count + ?, status = 'failed' WHERE id = ?")
        .bind(sentCount, sendId).run();
      return pauseRun(db, {
        campaign, reason: PAUSE_LOG_WRITE_FAILED, detail: err?.message, status: 500, sendId, sent: sentCount,
      });
    }

    sentCount++;
    if (sentCount < page.length) await new Promise((r) => setTimeout(r, BULK_PACING_MS));
  }

  // deferred is recomputed here against the true audience count, not the
  // fetch-limited cohort -- see the comment above the cohort fetch. It uses
  // sentCount (what this run actually got through, skips and failures
  // excluded) rather than page.length, so a skip/failure correctly leaves
  // that recipient counted as still-eligible for the next run.
  const deferred = Math.max(0, audienceCount - sentCount);
  const done = deferred === 0 && sentCount >= page.length;
  await db.prepare(
    `UPDATE newsletter_send SET sent_count = sent_count + ?, status = ?, sent_at = CASE WHEN ? = 1 THEN datetime('now') ELSE sent_at END WHERE id = ?`
  ).bind(sentCount, done ? 'sent' : 'sending', done ? 1 : 0, sendId).run();

  const after = remainingAllowance(
    await db.prepare('SELECT first_send_at, day, sent_today FROM mail_domain_state WHERE domain = ?').bind(BULK_DOMAIN).first(),
    nowIso,
  );
  log(env, waitUntil, 'newsletter', 'bulk_send_page', 'ok', `${campaign}: ${sentCount} sent, ${deferred} deferred`, 0, 200);

  return Response.json({
    ok: true, dryRun: false, done, lane, campaign, sendId,
    sent: sentCount, deferred,
    cap: after.cap, ageDays: after.ageDays, sentToday: after.sentToday, remainingToday: after.remaining,
  }, { status: 200 });
}
