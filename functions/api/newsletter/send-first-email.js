/**
 * POST /api/newsletter/send-first-email
 * Admin-only: send a "welcome / first email" to an explicit list of subscriber IDs.
 * Auto-queries the latest published commentary post for the body link.
 * Supports dry-run mode (no writes, no sends; returns rendered sample).
 *
 * Body: { recipientIds: string[], dryRun?: boolean }
 */
import { log } from '../_log.js';
import { sendEmail } from '../_ses.js';
import { renderEmail } from './_template.js';
import { constantTimeEqual } from '../auth/_shared.js';

const SUBJECT = 'Welcome to RRM Academy';
const MAX_RECIPIENTS = 200;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildBodyFragment(title, slug) {
  const safeTitle = escapeHtml(title);
  return `<p>Hi there,</p>
<p>Thanks for subscribing. I'm really glad you're here.</p>
<p>Here's what to expect: I'll only write when there's something genuinely worth your time. A new piece of commentary, research worth knowing about, or a resource that might actually help. No daily noise.</p>
<p>Restorative reproductive medicine starts by finding the underlying cause of what's happening with your cycle or your fertility, and then treating that directly. That's the thread through everything we publish, and I hope you find it useful.</p>
<p>To start, here's a recent piece worth a read:<br><a href="https://rrmacademy.org/commentary/${slug}/">${safeTitle}</a></p>
<p>If something ever resonates, or you have a question, just hit reply. A real person reads every one.</p>
<p>Warmly,<br>Dr. Naomi Whittaker, MD<br>Board-Certified OBGYN, RRM Academy</p>`;
}

/**
 * Send the first-email body to a list of active subscribers.
 * Injectable ses/template/tracking/db for testability (mirrors _signup-emails.js seam).
 *
 * @returns {{ sentCount: number, errors: number }}
 */
export async function sendBatch({
  db,
  ses,
  template,
  env,
  waitUntil,
  subscribers,
  body,
  subject,
  sendId,
}) {
  let sentCount = 0;
  let errors = 0;

  for (const sub of subscribers) {
    try {
      const { html, text } = await template.renderEmail({
        body,
        sendId,
        subscriberId: sub.id,
        email: sub.email,
        secret: env.NEWSLETTER_SECRET,
      });

      await db.batch([
        db.prepare("INSERT INTO newsletter_event (send_id, subscriber_id, event) VALUES (?, ?, 'sent')").bind(sendId, sub.id),
        db.prepare("UPDATE newsletter_subscriber SET last_sent_at = datetime('now') WHERE id = ?").bind(sub.id),
      ]);

      await ses.sendEmail(env, {
        from: '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>',
        to: sub.email,
        subject,
        replyTo: 'community@rrmacademy.org',
        html,
        text,
        log: { db, source: 'newsletter/send-first-email', category: 'newsletter' },
      });

      sentCount++;
    } catch (err) {
      log(env, waitUntil, 'newsletter', 'first_email_send_error', 'error', err?.message || 'unknown', 0, 0);
      errors++;
    }
  }

  return { sentCount, errors };
}

export async function onRequestPost({ request, env, waitUntil }) {
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

  const { recipientIds, dryRun } = body;

  if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
    return Response.json({ ok: false, error: 'recipientIds must be a non-empty array' }, { status: 400 });
  }
  if (recipientIds.length > MAX_RECIPIENTS) {
    return Response.json({ ok: false, error: `recipientIds exceeds max of ${MAX_RECIPIENTS}` }, { status: 400 });
  }
  if (!recipientIds.every(id => typeof id === 'string' && id.length > 0)) {
    return Response.json({ ok: false, error: 'recipientIds must be an array of non-empty strings' }, { status: 400 });
  }

  const db = env.DB;

  const latestPost = await db.prepare(
    "SELECT title, slug FROM posts WHERE status = 'published' ORDER BY publish_date DESC LIMIT 1"
  ).first();
  if (!latestPost) {
    return Response.json({ ok: false, error: 'no_published_post' }, { status: 404 });
  }

  const { title, slug } = latestPost;

  const placeholders = recipientIds.map(() => '?').join(', ');
  const subscriberRows = await db.prepare(
    `SELECT id, email FROM newsletter_subscriber WHERE id IN (${placeholders}) AND status = 'active'`
  ).bind(...recipientIds).all();
  const subscribers = subscriberRows.results || [];

  const bodyFragment = buildBodyFragment(title, slug);

  if (dryRun === true) {
    let sample = null;
    if (subscribers.length > 0) {
      const first = subscribers[0];
      sample = await renderEmail({
        body: bodyFragment,
        sendId: 'dry-run',
        subscriberId: first.id,
        email: first.email,
        secret: env.NEWSLETTER_SECRET,
      });
    }
    return Response.json({
      ok: true,
      dry_run: true,
      recipient_count: subscribers.length,
      recipient_ids: subscribers.map(s => s.id),
      latest_post: { title, slug },
      sample,
    });
  }

  const sendId = crypto.randomUUID();

  await db.prepare(
    "INSERT INTO newsletter_send (id, subject, html, segment_filter, status, total_recipients, commentary_slug) VALUES (?, ?, ?, ?, 'sending', ?, ?)"
  ).bind(sendId, SUBJECT, bodyFragment, null, subscribers.length, slug).run();

  const { sentCount } = await sendBatch({
    db,
    ses: { sendEmail },
    template: { renderEmail },
    env,
    waitUntil,
    subscribers,
    body: bodyFragment,
    subject: SUBJECT,
    sendId,
  });

  await db.prepare(
    "UPDATE newsletter_send SET status = 'sent', sent_count = ?, sent_at = datetime('now') WHERE id = ?"
  ).bind(sentCount, sendId).run();

  log(env, waitUntil, 'newsletter', 'first_email_complete', 'ok', `send ${sendId} complete`, 0, 200);

  return Response.json({
    ok: true,
    send_id: sendId,
    sent_count: sentCount,
    total_recipients: subscribers.length,
  });
}
