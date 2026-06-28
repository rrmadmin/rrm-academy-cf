/**
 * GET /api/admin/email?view=summary|broadcasts|log|cohort|recipient
 * Email observability dashboard API. Requires superadmin session auth.
 *
 * Tables: email_log (rrm-auth), email_event (rrm-auth, held/empty),
 *         newsletter_subscriber, newsletter_send, newsletter_event.
 *
 * All views are empty-safe: email_event is empty until the SES feed connects.
 * Every numeric defaults to 0 / [] — never null/undefined, never throws.
 */
import { json, optionsResponse, requireSuperAdmin } from '../auth/_shared.js';
import { log } from '../_log.js';

// Log view: events from email_log vs email_event are semantically partitioned.
// email_log carries send/failed; email_event carries delivery/bounce/complaint/open/click/reject.
const LOG_SIDE_EVENTS = new Set(['send', 'failed']);
const EVENT_SIDE_EVENTS = new Set(['delivery', 'bounce', 'complaint', 'open', 'click', 'reject']);
const VALID_EVENTS = new Set([...LOG_SIDE_EVENTS, ...EVENT_SIDE_EVENTS]);

const VALID_SORTS = new Set(['created_at', 'event', 'email', 'category', 'source']);
const VALID_ORDERS = new Set(['asc', 'desc']);
const VALID_COHORT_TYPES = new Set(['delivery', 'bounce', 'complaint', 'open', 'click']);
const DEFAULT_DAYS = 28;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const auth = await requireSuperAdmin(request, env.DB);
    if (auth instanceof Response) return auth;

    const url = new URL(request.url);
    const view = url.searchParams.get('view') || 'summary';

    const db = env.DB;

    if (view === 'summary') return handleSummary(url, db);
    if (view === 'broadcasts') return handleBroadcasts(db);
    if (view === 'log') return handleLog(url, db);
    if (view === 'cohort') return handleCohort(url, db);
    if (view === 'recipient') return handleRecipient(url, db);

    return json({ ok: false, error: 'invalid_view' }, 400);
  } catch (err) {
    log(env, waitUntil, 'admin', 'email_admin_error', 'error', err?.message || 'unknown', 0, 500);
    return json({ ok: false, error: 'server_error' }, 500);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDateRange(url) {
  const defaultFrom = new Date(Date.now() - DEFAULT_DAYS * 86400 * 1000).toISOString().slice(0, 10);
  const defaultTo = new Date().toISOString().slice(0, 10);
  const rawFrom = url.searchParams.get('from') || '';
  const rawTo = url.searchParams.get('to') || '';
  const from = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/.test(rawFrom) ? rawFrom.slice(0, 10) : defaultFrom;
  const to = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/.test(rawTo) ? rawTo.slice(0, 10) : defaultTo;
  return { from, to };
}

function toEndOfDay(dateStr) {
  return dateStr + ' 23:59:59';
}

function escapeEmailLike(input) {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function safeRate(numerator, denominator) {
  if (!denominator || denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// view=summary
// ---------------------------------------------------------------------------

async function handleSummary(url, db) {
  const { from, to } = parseDateRange(url);
  const fromTs = from;
  const toTs = toEndOfDay(to);
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;

  // All 10 queries run in parallel — no sequential awaits
  const [listRow, sendsRow, sendsByDayRows, sendsBySourceRows,
         deliverabilityRow, delivByDayRows, engRow, neRow,
         unsubPeriodRow, unsubImportedRow] = await Promise.all([

    // List health from newsletter_subscriber
    db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'active'       THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed,
        SUM(CASE WHEN status = 'bounced'      THEN 1 ELSE 0 END) AS bounced,
        SUM(CASE WHEN status = 'complained'   THEN 1 ELSE 0 END) AS complained,
        COUNT(*) AS total
      FROM newsletter_subscriber
    `).first(),

    // Sends totals from email_log in date range
    db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN category = 'transactional' THEN 1 ELSE 0 END) AS transactional,
        SUM(CASE WHEN category = 'newsletter'    THEN 1 ELSE 0 END) AS newsletter
      FROM email_log
      WHERE event = 'send' AND created_at >= ? AND created_at <= ?
    `).bind(fromTs, toTs).first(),

    // Sends by day
    db.prepare(`
      SELECT DATE(created_at) AS day,
        SUM(CASE WHEN category = 'transactional' THEN 1 ELSE 0 END) AS transactional,
        SUM(CASE WHEN category = 'newsletter'    THEN 1 ELSE 0 END) AS newsletter
      FROM email_log
      WHERE event = 'send' AND created_at >= ? AND created_at <= ?
      GROUP BY day ORDER BY day ASC
    `).bind(fromTs, toTs).all(),

    // Sends by source (top 12)
    db.prepare(`
      SELECT source, COUNT(*) AS n
      FROM email_log
      WHERE event = 'send' AND created_at >= ? AND created_at <= ?
      GROUP BY source ORDER BY n DESC LIMIT 12
    `).bind(fromTs, toTs).all(),

    // Deliverability totals from email_event (empty-safe)
    db.prepare(`
      SELECT
        SUM(CASE WHEN event_type = 'delivery'  THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN event_type = 'bounce'    THEN 1 ELSE 0 END) AS bounced,
        SUM(CASE WHEN event_type = 'complaint' THEN 1 ELSE 0 END) AS complained,
        SUM(CASE WHEN event_type = 'reject'    THEN 1 ELSE 0 END) AS rejected
      FROM email_event
      WHERE ts >= ? AND ts <= ?
    `).bind(fromTs, toTs).first(),

    // Deliverability by day from email_event (empty-safe)
    db.prepare(`
      SELECT DATE(ts) AS day,
        SUM(CASE WHEN event_type = 'delivery'  THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN event_type = 'bounce'    THEN 1 ELSE 0 END) AS bounced,
        SUM(CASE WHEN event_type = 'complaint' THEN 1 ELSE 0 END) AS complained
      FROM email_event
      WHERE ts >= ? AND ts <= ?
      GROUP BY day ORDER BY day ASC
    `).bind(fromTs, toTs).all(),

    // Engagement from email_event (SES open/click — empty-safe)
    db.prepare(`
      SELECT
        SUM(CASE WHEN event_type = 'open'  THEN 1 ELSE 0 END) AS ev_opened,
        SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS ev_clicked
      FROM email_event
      WHERE ts >= ? AND ts <= ?
    `).bind(fromTs, toTs).first(),

    // Engagement from newsletter_event (pixel opens/clicks)
    db.prepare(`
      SELECT
        SUM(CASE WHEN event = 'opened'  THEN 1 ELSE 0 END) AS ne_opened,
        SUM(CASE WHEN event = 'clicked' THEN 1 ELSE 0 END) AS ne_clicked
      FROM newsletter_event
      WHERE created_at >= ? AND created_at <= ?
    `).bind(fromTs, toTs).first(),

    // Organic unsubscribes in the selected period (excludes import source)
    db.prepare(`
      SELECT COUNT(*) AS n
      FROM newsletter_subscriber
      WHERE status = 'unsubscribed'
        AND COALESCE(source, '') <> 'import'
        AND unsubscribed_at >= ?
        AND unsubscribed_at <= ?
    `).bind(fromTs, toTs).first(),

    // All import-source unsubscribes (legacy opt-outs, no date filter)
    db.prepare(`
      SELECT COUNT(*) AS n
      FROM newsletter_subscriber
      WHERE status = 'unsubscribed'
        AND COALESCE(source, '') = 'import'
    `).first(),
  ]);

  const listActive = listRow?.active ?? 0;
  const listUnsub  = listRow?.unsubscribed ?? 0;
  const listTotal  = listRow?.total ?? 0;

  const unsubPeriod   = unsubPeriodRow?.n   ?? 0;
  const unsubImported = unsubImportedRow?.n  ?? 0;

  const sendTotal       = sendsRow?.total         ?? 0;
  const sendTransact    = sendsRow?.transactional  ?? 0;
  const sendNewsletter  = sendsRow?.newsletter     ?? 0;

  const deliv       = deliverabilityRow?.delivered  ?? 0;
  const delivBounce = deliverabilityRow?.bounced    ?? 0;
  const delivCompl  = deliverabilityRow?.complained ?? 0;
  const delivReject = deliverabilityRow?.rejected   ?? 0;

  const evOpened  = (engRow?.ev_opened  ?? 0) + (neRow?.ne_opened  ?? 0);
  const evClicked = (engRow?.ev_clicked ?? 0) + (neRow?.ne_clicked ?? 0);
  // tracked=true means email_event has any open/click rows in this period
  const tracked = ((engRow?.ev_opened ?? 0) + (engRow?.ev_clicked ?? 0)) > 0;

  return json({
    ok: true,
    data: {
      period: { from, to, days },
      list: {
        active: listActive,
        unsubscribed: listUnsub,
        bounced: listRow?.bounced ?? 0,
        complained: listRow?.complained ?? 0,
        total: listTotal,
        unsub_rate: safeRate(listUnsub, listTotal),
        unsub_period: unsubPeriod,
        unsub_imported: unsubImported,
        unsub_period_rate: safeRate(unsubPeriod, listActive),
      },
      sends: {
        total: sendTotal,
        transactional: sendTransact,
        newsletter: sendNewsletter,
        by_day: sendsByDayRows.results ?? [],
        by_source: sendsBySourceRows.results ?? [],
      },
      deliverability: {
        delivered: deliv,
        bounced: delivBounce,
        complained: delivCompl,
        rejected: delivReject,
        bounce_rate: safeRate(delivBounce, deliv + delivBounce),
        complaint_rate: safeRate(delivCompl, deliv + delivBounce),
        by_day: delivByDayRows.results ?? [],
      },
      engagement: {
        opened: evOpened,
        clicked: evClicked,
        open_rate: safeRate(evOpened, sendTotal),
        click_rate: safeRate(evClicked, sendTotal),
        tracked,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// view=broadcasts
// ---------------------------------------------------------------------------

async function handleBroadcasts(db) {
  // Single query: newsletter_send columns + correlated subqueries from email_event.
  // Subqueries return 0 when email_event is empty (pre-SES-wiring state).
  const rows = await db.prepare(`
    SELECT
      ns.id,
      ns.subject,
      ns.sent_at,
      ns.status,
      COALESCE(ns.total_recipients, 0) AS total_recipients,
      COALESCE(ns.sent_count, 0)       AS sent,
      COALESCE(ns.open_count, 0)       AS opened,
      COALESCE(ns.click_count, 0)      AS clicked,
      COALESCE(ns.bounce_count, 0)     AS bounced,
      COALESCE((SELECT COUNT(*) FROM email_event WHERE send_id = ns.id AND event_type = 'delivery'),  0) AS delivered,
      COALESCE((SELECT COUNT(*) FROM email_event WHERE send_id = ns.id AND event_type = 'complaint'), 0) AS complained
    FROM newsletter_send ns
    ORDER BY ns.sent_at DESC
  `).all();

  const sends = (rows.results ?? []).map(s => {
    const sent    = s.sent    ?? 0;
    const opened  = s.opened  ?? 0;
    const clicked = s.clicked ?? 0;
    return {
      id:               s.id,
      subject:          s.subject,
      sent_at:          s.sent_at,
      status:           s.status,
      total_recipients: s.total_recipients,
      sent,
      delivered:        s.delivered  ?? 0,
      opened,
      clicked,
      bounced:          s.bounced    ?? 0,
      complained:       s.complained ?? 0,
      open_rate:        safeRate(opened,  sent),
      click_rate:       safeRate(clicked, sent),
    };
  });

  return json({ ok: true, data: { broadcasts: sends } });
}

// ---------------------------------------------------------------------------
// view=log
// ---------------------------------------------------------------------------

async function handleLog(url, db) {
  const { from, to } = parseDateRange(url);
  const fromTs = from;
  const toTs   = toEndOfDay(to);

  // Event filter — split into which side of the UNION each event belongs to
  const rawEvents = url.searchParams.get('event') || '';
  const requestedEvents = rawEvents
    ? rawEvents.split(',').map(e => e.trim()).filter(e => VALID_EVENTS.has(e))
    : [];

  const logEvents   = requestedEvents.length > 0
    ? requestedEvents.filter(e => LOG_SIDE_EVENTS.has(e))
    : [...LOG_SIDE_EVENTS];
  const eventEvents = requestedEvents.length > 0
    ? requestedEvents.filter(e => EVENT_SIDE_EVENTS.has(e))
    : [...EVENT_SIDE_EVENTS];

  // Category / source / email filters
  const rawCategory = url.searchParams.get('category') || '';
  const category = rawCategory === 'transactional' || rawCategory === 'newsletter' ? rawCategory : null;

  const rawSource = url.searchParams.get('source') || '';
  const source = rawSource.length > 0 && rawSource.length <= 200 ? rawSource : null;

  const rawEmail = url.searchParams.get('email') || '';
  const emailPrefix = rawEmail.length > 0 && rawEmail.length <= 200 ? rawEmail : null;

  // Sort / order / page / limit
  const rawSort  = url.searchParams.get('sort') || 'created_at';
  const sortCol  = VALID_SORTS.has(rawSort) ? rawSort : 'created_at';
  const rawOrder = url.searchParams.get('order') || 'desc';
  const order    = VALID_ORDERS.has(rawOrder) ? rawOrder : 'desc';

  const rawPage  = parseInt(url.searchParams.get('page')  || '1',  10);
  const page     = rawPage >= 1 ? rawPage : 1;
  const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit    = rawLimit >= 1 && rawLimit <= 200 ? rawLimit : 50;
  const offset   = (page - 1) * limit;

  // Build parameterized UNION parts
  const logParams   = [];
  const eventParams = [];
  const logConds    = ['created_at >= ?', 'created_at <= ?'];
  const eventConds  = ['ts >= ?', 'ts <= ?'];

  logParams.push(fromTs, toTs);
  eventParams.push(fromTs, toTs);

  if (logEvents.length > 0) {
    logConds.push(`event IN (${logEvents.map(() => '?').join(',')})`);
    logParams.push(...logEvents);
  } else {
    logConds.push('1=0');
  }
  if (eventEvents.length > 0) {
    eventConds.push(`event_type IN (${eventEvents.map(() => '?').join(',')})`);
    eventParams.push(...eventEvents);
  } else {
    eventConds.push('1=0');
  }

  if (category) {
    logConds.push('category = ?');   logParams.push(category);
    eventConds.push('category = ?'); eventParams.push(category);
  }
  if (source) {
    logConds.push('source = ?');   logParams.push(source);
    eventConds.push('source = ?'); eventParams.push(source);
  }
  if (emailPrefix) {
    const escaped = escapeEmailLike(emailPrefix);
    logConds.push("email LIKE ? COLLATE NOCASE ESCAPE '\\'");   logParams.push(escaped + '%');
    eventConds.push("email LIKE ? COLLATE NOCASE ESCAPE '\\'"); eventParams.push(escaped + '%');
  }

  const logWhere   = logConds.join(' AND ');
  const eventWhere = eventConds.join(' AND ');

  const unionSql = `
    SELECT id, event AS event, email, category, source, subject, detail, send_id, created_at
    FROM email_log
    WHERE ${logWhere}
    UNION ALL
    SELECT id, event_type AS event, email, category, source,
           NULL AS subject,
           COALESCE(bounce_type, feedback_type, link_url) AS detail,
           send_id,
           ts AS created_at
    FROM email_event
    WHERE ${eventWhere}
  `;

  const allParams = [...logParams, ...eventParams];

  const [countRow, rowsResult] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM (${unionSql})`).bind(...allParams).first(),
    db.prepare(`SELECT * FROM (${unionSql}) ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`)
      .bind(...allParams, limit, offset).all(),
  ]);

  return json({
    ok: true,
    data: {
      events: rowsResult.results ?? [],
      total:  countRow?.total ?? 0,
      page,
      pages:  Math.ceil((countRow?.total ?? 0) / limit),
    },
  });
}

// ---------------------------------------------------------------------------
// view=cohort
// ---------------------------------------------------------------------------

async function handleCohort(url, db) {
  const rawType = url.searchParams.get('type') || '';
  if (!VALID_COHORT_TYPES.has(rawType)) {
    return json({ ok: false, error: 'type_required' }, 400);
  }

  const rawSendId = url.searchParams.get('send_id') || '';
  const sendId = rawSendId.length > 0 && rawSendId.length <= 100 ? rawSendId : null;

  const { from, to } = parseDateRange(url);
  const fromTs = from;
  const toTs   = toEndOfDay(to);

  const rawPage  = parseInt(url.searchParams.get('page')  || '1',  10);
  const page     = rawPage >= 1 ? rawPage : 1;
  const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit    = rawLimit >= 1 && rawLimit <= 200 ? rawLimit : 50;
  const offset   = (page - 1) * limit;

  const conds  = ['event_type = ?', 'ts >= ?', 'ts <= ?'];
  const params = [rawType, fromTs, toTs];

  if (sendId) {
    conds.push('send_id = ?');
    params.push(sendId);
  }

  const where = conds.join(' AND ');

  const [countRow, rowsResult] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM email_event WHERE ${where}`).bind(...params).first(),
    db.prepare(`
      SELECT email, ts, bounce_type, feedback_type, link_url,
             COALESCE(bounce_type, feedback_type, link_url) AS detail
      FROM email_event
      WHERE ${where}
      ORDER BY ts DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all(),
  ]);

  const count = countRow?.n ?? 0;

  return json({
    ok: true,
    data: {
      cohort: rawType,
      send_id: sendId,
      count,
      recipients: rowsResult.results ?? [],
      page,
      pages: Math.ceil(count / limit),
    },
  });
}

// ---------------------------------------------------------------------------
// view=recipient
// ---------------------------------------------------------------------------

async function handleRecipient(url, db) {
  const rawEmail = url.searchParams.get('email') || '';
  if (!rawEmail || rawEmail.length > 200) {
    return json({ ok: false, error: 'email_required' }, 400);
  }

  const rawPage  = parseInt(url.searchParams.get('page')  || '1',  10);
  const page     = rawPage >= 1 ? rawPage : 1;
  const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit    = rawLimit >= 1 && rawLimit <= 200 ? rawLimit : 50;
  const offset   = (page - 1) * limit;

  // UNION email_log + email_event for this recipient, newest first
  const unionSql = `
    SELECT id, event AS event, category, source, subject, detail, send_id, created_at
    FROM email_log
    WHERE email = ? COLLATE NOCASE
    UNION ALL
    SELECT id, event_type AS event, category, source,
           NULL AS subject,
           COALESCE(bounce_type, feedback_type, link_url) AS detail,
           send_id,
           ts AS created_at
    FROM email_event
    WHERE email = ? COLLATE NOCASE
  `;

  const [eventsResult, logSummary, eventSummary, subRow] = await Promise.all([
    db.prepare(`SELECT * FROM (${unionSql}) ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(rawEmail, rawEmail, limit, offset).all(),

    // Counts from email_log
    db.prepare(`
      SELECT
        SUM(CASE WHEN event = 'send' THEN 1 ELSE 0 END) AS total_sent,
        MIN(created_at) AS first_seen,
        MAX(created_at) AS last_activity
      FROM email_log
      WHERE email = ? COLLATE NOCASE
    `).bind(rawEmail).first(),

    // Counts from email_event (empty-safe)
    db.prepare(`
      SELECT
        SUM(CASE WHEN event_type = 'delivery'  THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN event_type = 'open'      THEN 1 ELSE 0 END) AS opens,
        SUM(CASE WHEN event_type = 'click'     THEN 1 ELSE 0 END) AS clicks,
        SUM(CASE WHEN event_type = 'bounce'    THEN 1 ELSE 0 END) AS bounces,
        MIN(ts) AS first_event,
        MAX(ts) AS last_event
      FROM email_event
      WHERE email = ? COLLATE NOCASE
    `).bind(rawEmail).first(),

    // Subscriber status for complained flag
    db.prepare(`SELECT status FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE LIMIT 1`)
      .bind(rawEmail).first(),
  ]);

  const logFirst    = logSummary?.first_seen    ?? null;
  const logLast     = logSummary?.last_activity ?? null;
  const eventFirst  = eventSummary?.first_event ?? null;
  const eventLast   = eventSummary?.last_event  ?? null;

  // Earliest first_seen and latest last_activity across both tables
  const firstSeen   = [logFirst, eventFirst].filter(Boolean).sort()[0]     ?? null;
  const lastActivity= [logLast,  eventLast ].filter(Boolean).sort().pop()  ?? null;

  return json({
    ok: true,
    data: {
      recipient: rawEmail,
      events: eventsResult.results ?? [],
      summary: {
        total_sent:    logSummary?.total_sent  ?? 0,
        delivered:     eventSummary?.delivered ?? 0,
        opens:         eventSummary?.opens     ?? 0,
        clicks:        eventSummary?.clicks    ?? 0,
        bounces:       eventSummary?.bounces   ?? 0,
        complained:    subRow?.status === 'complained',
        first_seen:    firstSeen,
        last_activity: lastActivity,
      },
    },
  });
}
