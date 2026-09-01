/**
 * Community email notification helpers.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 */
import { sendEmail, logEmailFailure } from '../_ses.js';
import { sendTransactionalEmail } from '../_mail-lanes.js';
import { SITE_URL } from '../auth/_shared.js';
import { STUC_MEMBER_WHERE } from './_shared.js';
import { log } from '../_log.js';
import { greetingLine } from '../_greeting.js';

const EVENT_SHARE_LINK_RECIPIENTS = ['naomimwhittaker@gmail.com'];

const BROADCAST_BATCH_SIZE = 5;
const BROADCAST_BATCH_DELAY_MS = 1800;

/**
 * Paces member-roster broadcasts so they never fire as one concurrent burst
 * (SES rate safety + deliverability). This is ENFORCED by
 * `scripts/gates/validate-email-trickle.mjs`; never replace it with a bare
 * Promise.all/Promise.allSettled over the full recipient list. Results are
 * returned in recipient order, so callers can correlate results[i] with
 * recipients[i] (used below for per-failure logEmailFailure).
 */
async function sendBroadcastTrickle(env, recipients, buildEmail, { from, subject, replyTo, log }) {
  const results = [];
  for (let i = 0; i < recipients.length; i += BROADCAST_BATCH_SIZE) {
    const batch = recipients.slice(i, i + BROADCAST_BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(m => {
      const { html, text } = buildEmail(m);
      return sendTransactionalEmail(env, { from, to: m.email, subject, html, text, replyTo, log });
    }));
    results.push(...batchResults);
    if (i + BROADCAST_BATCH_SIZE < recipients.length) {
      await new Promise(resolve => setTimeout(resolve, BROADCAST_BATCH_DELAY_MS));
    }
  }
  return results;
}

function sanitizeSubject(s) {
  return String(s).replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nyDateOnlyUTC(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day));
}

// Calendar-day difference between an event and "now", both resolved in
// America/New_York -- never raw UTC milliseconds, so an evening-Eastern event
// (already past midnight UTC) doesn't come out one day off. Exported so it can
// be unit-tested directly and so notifyNewPost can inject `now` for tests.
// Returns null (never throws) if either date is unparseable or Intl fails.
export function daysUntilEventEastern(eventDate, now = Date.now()) {
  try {
    const nowDate = now instanceof Date ? now : new Date(now);
    if (isNaN(eventDate.getTime()) || isNaN(nowDate.getTime())) return null;
    return Math.round((nyDateOnlyUTC(eventDate) - nyDateOnlyUTC(nowDate)) / 86400000);
  } catch {
    return null;
  }
}

function formatEventDate(isoUtc) {
  if (!isoUtc) return null;
  try {
    const d = new Date(isoUtc);
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d) + ' Eastern';
  } catch {
    return null;
  }
}

// Personal-sender addresses for known STUC post/reply authors.
// Falls back to a generic friendly sender when the author isn't in the map.
// Sends from the `rrmacademy.org` apex SES identity (verified, apex DKIM
// signing, MAIL FROM = mail.rrmacademy.org). The earlier `@mail.` shape
// was Gmail-classified as transactional bulk infra; apex sending gives
// `signed-by: rrmacademy.org` so STUC notifications land in Primary.
const AUTHOR_SENDERS = {
  // Brian Whittaker
  '301eb55c3f388e65f3f42b14e635dc7a': '"Brian Whittaker" <brian@rrmacademy.org>',
  // Naomi Whittaker (id verified 2026-05-12 via D1 query on naomimwhittaker@gmail.com, role=admin)
  '710134def83240b7b47b22a9c9579c0c': '"Dr. Naomi Whittaker" <naomi@rrmacademy.org>',
};

// STUC member-facing broadcast emails always appear from Dr. Naomi Whittaker
// regardless of which admin created the post. Members expect the face of the
// club, not the admin/operator behind the scenes. See memory feedback-stuc-email-sender-naomi.
// Exported so the free-event joining-link mail (functions/api/events/_email.js)
// uses this exact identity rather than a second copy that can drift from it.
export const STUC_BROADCAST_SENDER = '"Dr. Naomi Whittaker" <community@rrmacademy.org>';

function authorFrom(authorId, authorName) {
  if (AUTHOR_SENDERS[authorId]) return AUTHOR_SENDERS[authorId];
  const safeName = (authorName || 'Save the Uterus Club')
    .replace(/[<>",;:\\()[\]\r\n]/g, '')
    .slice(0, 76);
  return `"${safeName}" <community@rrmacademy.org>`;
}

export async function notifyNewPost(env, db, post, authorName, now = Date.now()) {
  // 15-minute cooldown via KV
  if (env.COMMUNITY_KV) {
    const lastSent = await env.COMMUNITY_KV.get('community:last_post_email');
    if (lastSent) {
      const elapsed = Date.now() - parseInt(lastSent, 10);
      if (elapsed < 15 * 60 * 1000) return;
    }
  }

  const members = await db.prepare(`
    SELECT DISTINCT u.email, u.first_name FROM user u
    WHERE ${STUC_MEMBER_WHERE}
      AND u.community_email_opt_out = 0
      AND u.id != ?
    LIMIT 5000
  `).bind(post.authorId).all();

  if (members.results?.length === 5000) {
    log(env, null, 'community', 'notify_roster_cap_hit', 'warn',
      'STUC notify roster query returned 5000 rows -- review LIMIT and chunking strategy');
  }

  if (!members.results.length) return;

  // No UTM/tracking params on member-email links by rule: these emails must read as
  // personal/transactional (from Dr. Naomi), not bulk marketing. Arrivals are still
  // captured by the fingerprint worker on the landing page (a BaseLayout page).
  const link = `${SITE_URL}/community/post/${post.id}`;
  const isEvent = post.type === 'event';
  const safeAuthor = escapeHtml(authorName);
  const from = isEvent ? STUC_BROADCAST_SENDER : authorFrom(post.authorId, authorName);

  let subject;
  let buildEmail;

  if (isEvent) {
    const rawTitle = post.title || '';
    const eventTitle = rawTitle || 'New Save the Uterus Club event';
    const PREFIX = 'Save the Uterus Club';

    // Weekday in Eastern time — members must see the live-event day right in the
    // subject line (hard rule 2026-07-15).
    let weekday = null;
    // "this Monday" is only true within a 7-day window; further out it reads as
    // misleading (an event 2+ weeks away is not "this" anything). Past/unparseable
    // dates keep the original "this <weekday>" shape unchanged -- isNearEvent
    // defaults true and daysUntilEventEastern() only overrides it to false for a
    // genuinely far-future event (see daysUntilEventEastern doc comment).
    let isNearEvent = true;
    let monthDay = null;
    if (post.event_date) {
      const ed = new Date(post.event_date);
      if (!isNaN(ed.getTime())) {
        try {
          weekday = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            weekday: 'long',
          }).format(ed);
        } catch { weekday = null; }
        if (weekday) {
          const daysOut = daysUntilEventEastern(ed, now);
          isNearEvent = daysOut === null || daysOut < 7;
          try {
            monthDay = new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/New_York',
              month: 'long',
              day: 'numeric',
            }).format(ed);
          } catch { monthDay = null; }
        }
      }
    }

    const speaker = post.speaker && typeof post.speaker === 'string' ? post.speaker.trim() : null;

    // Strip a leading "Save the Uterus Club" (+ optional separator) from the title
    // so the subject prefix never doubles.
    let titlePortion = rawTitle.trim();
    if (titlePortion.toLowerCase().startsWith(PREFIX.toLowerCase())) {
      titlePortion = titlePortion.slice(PREFIX.length).replace(/^[\s:–—-]+/, '').trim();
    }
    if (!titlePortion) titlePortion = 'New Save the Uterus Club event';

    const subjectBase = weekday
      ? (isNearEvent
          ? `${PREFIX} live event this ${weekday}: ${titlePortion}`
          : `${PREFIX} live event ${weekday}${monthDay ? `, ${monthDay}` : ''}: ${titlePortion}`)
      : `${PREFIX} live event: ${titlePortion}`;
    const speakerSuffix = speaker ? ` with ${speaker}` : '';
    subject = sanitizeSubject(subjectBase + speakerSuffix);

    const formattedDate = formatEventDate(post.event_date);
    const dateLine = formattedDate ? `<p>When: ${escapeHtml(formattedDate)}</p>` : '';
    const dateLineText = formattedDate ? `When: ${formattedDate}\n` : '';

    const speakerLineHtml = speaker ? `<p>With <strong>${escapeHtml(speaker)}</strong></p>` : '';
    const speakerLineText = speaker ? `With ${speaker}\n` : '';

    // Context opener: reads as a personal invitation to the live call.
    let openerCore;
    if (weekday) {
      let dateTimeNoWeekday = null;
      const ed2 = new Date(post.event_date);
      if (!isNaN(ed2.getTime())) {
        try {
          dateTimeNoWeekday = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }).format(ed2);
        } catch { dateTimeNoWeekday = null; }
      }
      openerCore = isNearEvent
        ? (dateTimeNoWeekday
            ? `Our next Save the Uterus Club live call is this ${weekday}, ${dateTimeNoWeekday} Eastern, and you are invited.`
            : `Our next Save the Uterus Club live call is this ${weekday}, and you are invited.`)
        : (dateTimeNoWeekday
            ? `Our next Save the Uterus Club live call is ${weekday}, ${dateTimeNoWeekday} Eastern, and you are invited.`
            : `Our next Save the Uterus Club live call is ${weekday}, and you are invited.`);
    } else {
      openerCore = 'Our next Save the Uterus Club live call is coming up, and you are invited.';
    }
    const openerHtml = `<p>${escapeHtml(openerCore)}</p>`;
    const openerText = `${openerCore}\n\n`;

    // Teaser scrub: keep flyer markdown, Meet links, and the dial-in/PIN line out
    // of the 250-char preview by construction (not by body-ordering convention).
    const rawBody = post.body && typeof post.body === 'string' ? post.body : '';
    const scrubbedBody = rawBody
      .split(/\r?\n/)
      .filter(line => {
        if (/meet\.google\.com/i.test(line)) return false;
        if (/^\s*join google meet/i.test(line)) return false;
        if (/^\s*Phone:/i.test(line)) return false;
        return true;
      })
      .join('\n')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const plainBody = scrubbedBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const bodyPreview = plainBody.length > 0
      ? (plainBody.length > 250 ? plainBody.slice(0, 250) + '…' : plainBody)
      : '';
    const bodyPreviewHtml = bodyPreview ? `<p>${escapeHtml(bodyPreview)}</p>` : '';
    const bodyPreviewText = bodyPreview ? `${bodyPreview}\n` : '';

    buildEmail = (m) => {
      const greeting = greetingLine(m.first_name);
      const html = `
    <p>${escapeHtml(greeting)}</p>
    ${openerHtml}
    <p><strong>${escapeHtml(eventTitle)}</strong></p>
    ${dateLine}${speakerLineHtml}${bodyPreviewHtml}
    <p>Sign in to the community to view the link and join.</p>
    <p><a href="${link}">View event</a></p>
  `;
      const text = `${greeting}\n\n${openerText}${eventTitle}\n${dateLineText}${speakerLineText}${bodyPreviewText}Sign in to the community to view the link and join.\nView: ${link}`;
      return { html, text };
    };
  } else {
    subject = sanitizeSubject(`${authorName} posted in Save the Uterus Club`);

    buildEmail = (m) => {
      const greeting = greetingLine(m.first_name);
      const html = `
    <p>${escapeHtml(greeting)}</p>
    <p><strong>${safeAuthor}</strong> posted in the Save the Uterus Club community.</p>
    <p>Sign in to read and reply.</p>
    <p><a href="${link}">View post</a></p>
  `;
      const text = `${greeting}\n\n${authorName} posted in the Save the Uterus Club community.\nSign in to read and reply.\nView: ${link}`;
      return { html, text };
    };
  }

  // Send as a paced trickle (never an all-at-once concurrent burst): preserves
  // privacy (individual emails) AND stays under SES's send-rate cap. Order is
  // preserved, so results[i] still corresponds to members.results[i] below.
  const results = await sendBroadcastTrickle(env, members.results, buildEmail, {
    from,
    subject,
    replyTo: 'administrator@rrmacademy.org',
    log: { db, source: 'community/new-post', category: 'transactional' },
  });
  const successCount = results.filter(r => r.status === 'fulfilled').length;
  const totalCount = results.length;
  if (env.EVENTS) env.EVENTS.writeDataPoint({ blobs: ['rrm-academy', 'community', 'stuc_blast_result', String(post.id)], doubles: [totalCount, successCount, totalCount - successCount], indexes: ['stuc_blast_result'] });

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error('Failed to send community post email:', r.reason?.message);
      logEmailFailure(db, { email: members.results[i].email, category: 'transactional', source: 'community/new-post', subject, detail: r.reason?.message });
    }
  });

  if (env.COMMUNITY_KV) {
    if (successCount / totalCount >= 0.5) {
      await env.COMMUNITY_KV.put('community:last_post_email', String(Date.now()), { expirationTtl: 900 });
    } else {
      log(env, null, 'community', 'notify_cooldown_skipped', 'warn',
        `Only ${successCount}/${totalCount} emails succeeded — cooldown not set to allow retry`);
    }
  }
}

export async function notifyEventShareLink(env, db, post) {
  if (post.type !== 'event') return;

  if (!post.slug) {
    log(env, null, 'community', 'share_link_skipped_no_slug', 'warn',
      `notifyEventShareLink: post ${post.id} has no slug, skipping`);
    return;
  }

  const slug = post.slug;
  const rawTitle = post.title || '';
  const eventTitle = rawTitle || 'new Save the Uterus Club event';
  const safeTitle = escapeHtml(rawTitle || 'new Save the Uterus Club event');
  const subject = sanitizeSubject(rawTitle
    ? `Shareable link ready: ${rawTitle}`
    : 'Shareable link ready: new Save the Uterus Club event');

  const shareUrl = `${SITE_URL}/events/${slug}/`;

  const formattedDate = formatEventDate(post.event_date);
  const dateLine = formattedDate ? `<p><strong>When:</strong> ${escapeHtml(formattedDate)}</p>` : '';
  const dateLineText = formattedDate ? `When: ${formattedDate}\n` : '';

  const speaker = post.speaker && typeof post.speaker === 'string' ? post.speaker.trim() : null;
  const speakerLineHtml = speaker ? `<p><strong>Speaker:</strong> ${escapeHtml(speaker)}</p>` : '';
  const speakerLineText = speaker ? `Speaker: ${speaker}\n` : '';

  const captionSpeaker = speaker ? ` with ${speaker}` : '';
  const captionDate = formattedDate ? ` — ${formattedDate}` : '';
  const suggestedCaption = `Join us for "${eventTitle}"${captionSpeaker}${captionDate}. Link in bio.`;

  const emailPromises = EVENT_SHARE_LINK_RECIPIENTS.map(recipientEmail => {
    const greeting = recipientEmail === 'naomimwhittaker@gmail.com'
      ? 'Hi Dr. Whittaker,'
      : 'Hi,';

    const html = `
    <p>${escapeHtml(greeting)}</p>
    <p>A new Save the Uterus Club event was just posted and the public landing page is live with og:image and title ready to share.</p>
    <p><strong>${safeTitle}</strong></p>
    ${dateLine}${speakerLineHtml}
    <p>Public link (safe to share — Meet URL and dial-in are gated for members only; non-members see an upgrade CTA):</p>
    <p><a href="${shareUrl}">${shareUrl}</a></p>
    <p><strong>Suggested IG caption:</strong><br>${escapeHtml(suggestedCaption)}</p>
  `;
    const text = `${greeting}\n\nA new Save the Uterus Club event was just posted and the public landing page is live.\n\n${eventTitle}\n${dateLineText}${speakerLineText}\nPublic link (safe to share):\n${shareUrl}\n\nSuggested IG caption:\n${suggestedCaption}`;

    return sendEmail(env, {
      from: '"RRM Academy Events" <community@rrmacademy.org>',
      to: recipientEmail,
      subject,
      html,
      text,
      replyTo: 'administrator@rrmacademy.org',
      log: { db, source: 'community/event-share-link', category: 'transactional' },
    }).catch(err => console.error(`Failed to send share-link email to ${recipientEmail}:`, err.message));
  });
  await Promise.all(emailPromises);
}

export async function notifyReply(env, db, postId, parentId, replierId, replierName, replyContent) {
  let recipientId = null;
  let targetLabel = 'post';

  if (parentId) {
    const parentComment = await db.prepare('SELECT author_id FROM community_comment WHERE id = ?').bind(parentId).first();
    if (parentComment) {
      recipientId = parentComment.author_id;
      targetLabel = 'comment';
    }
  } else {
    const post = await db.prepare('SELECT author_id FROM community_post WHERE id = ?').bind(postId).first();
    if (post) {
      recipientId = post.author_id;
      targetLabel = 'post';
    }
  }

  if (!recipientId) return;
  // Don't notify yourself
  if (recipientId === replierId) return;

  const recipient = await db.prepare(
    'SELECT email, community_email_opt_out, first_name FROM user WHERE id = ? AND blocked = 0'
  ).bind(recipientId).first();

  if (!recipient || recipient.community_email_opt_out) return;

  const link = `${SITE_URL}/community/`;
  const preview = replyContent.slice(0, 200);

  const greeting = greetingLine(recipient.first_name);

  const subject = sanitizeSubject(`${replierName} replied to your ${targetLabel} in Save the Uterus Club`);
  const html = `
    <p>${escapeHtml(greeting)}</p>
    <p><strong>${escapeHtml(replierName)}</strong> replied to your ${targetLabel}:</p>
    <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#555;">${escapeHtml(preview)}${replyContent.length > 200 ? '...' : ''}</blockquote>
    <p><a href="${link}">View conversation</a></p>
  `;
  const text = `${greeting}\n\n${replierName} replied to your ${targetLabel}:\n"${preview}"\nView: ${link}`;

  await sendTransactionalEmail(env, {
    from: authorFrom(replierId, replierName),
    to: recipient.email,
    subject,
    html,
    text,
    replyTo: 'administrator@rrmacademy.org',
    log: { db, source: 'community/reply', category: 'transactional' },
  }).catch(err => console.error(`Failed to email ${recipient.email}:`, err.message));
}
