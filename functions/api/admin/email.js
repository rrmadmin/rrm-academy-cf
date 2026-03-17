/**
 * GET /api/admin/email
 * Unified email event log viewer for the admin dashboard.
 * Requires superadmin session auth.
 *
 * Query params:
 *   ?view=log|recipient|stats  (default: log)
 *   ?event=send,delivered,...  (comma-separated, allowlisted)
 *   ?category=transactional|newsletter
 *   ?source=string             (exact match)
 *   ?email=string              (prefix match, COLLATE NOCASE)
 *   ?from=ISO date             (default: 28 days ago)
 *   ?to=ISO date               (default: now)
 *   ?sort=created_at|event|email|category|source  (default: created_at)
 *   ?order=asc|desc            (default: desc)
 *   ?page=integer              (default: 1)
 *   ?limit=1-200               (default: 50)
 */
import { json, optionsResponse, requireSuperAdmin } from '../auth/_shared.js';

const VALID_EVENTS = new Set(['send', 'delivered', 'bounced', 'opened', 'clicked', 'unsubscribed', 'complained', 'failed']);
const VALID_CATEGORIES = new Set(['transactional', 'newsletter']);
const VALID_SORTS = {
  created_at: 'created_at',
  event: 'event',
  email: 'email',
  category: 'category',
  source: 'source',
};
const VALID_ORDERS = new Set(['asc', 'desc']);
const DEFAULT_DAYS = 28;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireSuperAdmin(request, env.DB);
    if (auth instanceof Response) return auth;

    if (!env.DB) {
      return json({ ok: false, error: 'Server misconfigured' }, 503);
    }

    const url = new URL(request.url);
    const view = url.searchParams.get('view') || 'log';

    if (view === 'log') return handleLog(url, env.DB);
    if (view === 'recipient') return handleRecipient(url, env.DB);
    if (view === 'stats') return handleStats(url, env.DB);

    return json({ ok: false, error: 'Invalid view. Must be log, recipient, or stats.' }, 400);
  } catch (err) {
    console.error('Email admin error:', err);
    return json({ ok: false, error: 'Failed to fetch email data' }, 502);
  }
}

function parseDateRange(url) {
  const defaultFrom = new Date(Date.now() - DEFAULT_DAYS * 86400 * 1000).toISOString().slice(0, 10);
  const defaultTo = new Date().toISOString().slice(0, 10);

  const rawFrom = url.searchParams.get('from');
  const rawTo = url.searchParams.get('to');

  const from = rawFrom && /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/.test(rawFrom) ? rawFrom : defaultFrom;
  const to = rawTo && /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/.test(rawTo) ? rawTo : defaultTo;

  return { from, to };
}

function escapeEmailLike(input) {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function handleLog(url, db) {
  const { from, to } = parseDateRange(url);

  const rawEvents = url.searchParams.get('event') || '';
  const eventFilter = rawEvents
    ? rawEvents.split(',').map(e => e.trim()).filter(e => VALID_EVENTS.has(e))
    : [];

  const rawCategory = url.searchParams.get('category') || '';
  const category = VALID_CATEGORIES.has(rawCategory) ? rawCategory : null;

  const rawSource = url.searchParams.get('source') || '';
  const source = typeof rawSource === 'string' && rawSource.length > 0 && rawSource.length <= 200
    ? rawSource
    : null;

  const rawEmail = url.searchParams.get('email') || '';
  const email = typeof rawEmail === 'string' && rawEmail.length > 0 && rawEmail.length <= 200
    ? rawEmail
    : null;

  const rawSort = url.searchParams.get('sort') || 'created_at';
  const sortCol = VALID_SORTS[rawSort] || 'created_at';

  const rawOrder = url.searchParams.get('order') || 'desc';
  const order = VALID_ORDERS.has(rawOrder) ? rawOrder : 'desc';

  const rawPage = parseInt(url.searchParams.get('page') || '1', 10);
  const page = rawPage >= 1 ? rawPage : 1;

  const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = rawLimit >= 1 && rawLimit <= 200 ? rawLimit : 50;

  const offset = (page - 1) * limit;

  const conditions = ['created_at >= ?', 'created_at <= ?'];
  const params = [from, to + 'T23:59:59'];

  if (eventFilter.length > 0) {
    conditions.push(`event IN (${eventFilter.map(() => '?').join(', ')})`);
    params.push(...eventFilter);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (source) {
    conditions.push('source = ?');
    params.push(source);
  }
  if (email) {
    const escaped = escapeEmailLike(email);
    conditions.push("email LIKE ? COLLATE NOCASE ESCAPE '\\'");
    params.push(escaped + '%');
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM email_log ${where}`)
    .bind(...params)
    .first();
  const total = countRow?.total ?? 0;

  const rows = await db
    .prepare(
      `SELECT id, event, email, category, source, subject, detail, send_id, created_at
       FROM email_log ${where}
       ORDER BY ${sortCol} ${order}
       LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset)
    .all();

  return json({
    ok: true,
    data: {
      events: rows.results ?? [],
      total,
      page,
      pages: Math.ceil(total / limit),
    },
  });
}

async function handleRecipient(url, db) {
  const rawEmail = url.searchParams.get('email') || '';
  if (!rawEmail || rawEmail.length > 200) {
    return json({ ok: false, error: 'email param required (max 200 chars)' }, 400);
  }

  const { from, to } = parseDateRange(url);

  const rawSort = url.searchParams.get('sort') || 'created_at';
  const sortCol = VALID_SORTS[rawSort] || 'created_at';

  const rawOrder = url.searchParams.get('order') || 'desc';
  const order = VALID_ORDERS.has(rawOrder) ? rawOrder : 'desc';

  const rawPage = parseInt(url.searchParams.get('page') || '1', 10);
  const page = rawPage >= 1 ? rawPage : 1;

  const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = rawLimit >= 1 && rawLimit <= 200 ? rawLimit : 50;

  const offset = (page - 1) * limit;

  const events = await db
    .prepare(
      `SELECT id, event, category, source, subject, detail, send_id, created_at
       FROM email_log
       WHERE email = ? COLLATE NOCASE
         AND created_at >= ?
         AND created_at <= ?
       ORDER BY ${sortCol} ${order}
       LIMIT ? OFFSET ?`
    )
    .bind(rawEmail, from, to + 'T23:59:59', limit, offset)
    .all();

  const summary = await db
    .prepare(
      `SELECT
         COUNT(*) AS total_sent,
         SUM(CASE WHEN event = 'opened' THEN 1 ELSE 0 END) AS opens,
         SUM(CASE WHEN event = 'clicked' THEN 1 ELSE 0 END) AS clicks,
         SUM(CASE WHEN event = 'bounced' THEN 1 ELSE 0 END) AS bounces,
         MAX(CASE WHEN event = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed,
         MIN(created_at) AS first_seen,
         MAX(created_at) AS last_activity
       FROM email_log
       WHERE email = ? COLLATE NOCASE`
    )
    .bind(rawEmail)
    .first();

  return json({
    ok: true,
    data: {
      recipient: rawEmail,
      events: events.results ?? [],
      summary: {
        total_sent: summary?.total_sent ?? 0,
        opens: summary?.opens ?? 0,
        clicks: summary?.clicks ?? 0,
        bounces: summary?.bounces ?? 0,
        unsubscribed: (summary?.unsubscribed ?? 0) === 1,
        first_seen: summary?.first_seen ?? null,
        last_activity: summary?.last_activity ?? null,
      },
    },
  });
}

async function handleStats(url, db) {
  const { from, to } = parseDateRange(url);

  const totalsRow = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN event = 'send' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN event = 'delivered' THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN event = 'bounced' THEN 1 ELSE 0 END) AS bounced,
         SUM(CASE WHEN event = 'opened' THEN 1 ELSE 0 END) AS opened,
         SUM(CASE WHEN event = 'clicked' THEN 1 ELSE 0 END) AS clicked,
         SUM(CASE WHEN event = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed,
         SUM(CASE WHEN event = 'complained' THEN 1 ELSE 0 END) AS complained,
         SUM(CASE WHEN event = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM email_log
       WHERE created_at >= ? AND created_at <= ?`
    )
    .bind(from, to + 'T23:59:59')
    .first();

  const bySourceRows = await db
    .prepare(
      `SELECT source,
         SUM(CASE WHEN event = 'send' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN event = 'delivered' THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN event = 'bounced' THEN 1 ELSE 0 END) AS bounced,
         SUM(CASE WHEN event = 'opened' THEN 1 ELSE 0 END) AS opened,
         SUM(CASE WHEN event = 'clicked' THEN 1 ELSE 0 END) AS clicked,
         SUM(CASE WHEN event = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM email_log
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY source
       ORDER BY sent DESC`
    )
    .bind(from, to + 'T23:59:59')
    .all();

  const byDayRows = await db
    .prepare(
      `SELECT DATE(created_at) AS day,
         SUM(CASE WHEN event = 'send' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN event = 'delivered' THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN event = 'bounced' THEN 1 ELSE 0 END) AS bounced,
         SUM(CASE WHEN event = 'opened' THEN 1 ELSE 0 END) AS opened,
         SUM(CASE WHEN event = 'clicked' THEN 1 ELSE 0 END) AS clicked,
         SUM(CASE WHEN event = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM email_log
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY day
       ORDER BY day ASC`
    )
    .bind(from, to + 'T23:59:59')
    .all();

  return json({
    ok: true,
    data: {
      period: { from, to },
      totals: {
        sent: totalsRow?.sent ?? 0,
        delivered: totalsRow?.delivered ?? 0,
        bounced: totalsRow?.bounced ?? 0,
        opened: totalsRow?.opened ?? 0,
        clicked: totalsRow?.clicked ?? 0,
        unsubscribed: totalsRow?.unsubscribed ?? 0,
        complained: totalsRow?.complained ?? 0,
        failed: totalsRow?.failed ?? 0,
      },
      by_source: bySourceRows.results ?? [],
      by_day: byDayRows.results ?? [],
    },
  });
}
