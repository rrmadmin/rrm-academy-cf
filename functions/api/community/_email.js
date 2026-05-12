/**
 * Community email notification helpers.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 */
import { sendEmail } from '../_ses.js';
import { SITE_URL } from '../auth/_shared.js';
import { STUC_MEMBER_WHERE } from './_shared.js';

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      timeZoneName: 'short',
    }).format(d);
  } catch {
    return null;
  }
}

// Personal-sender addresses for known STUC post/reply authors.
// Falls back to a generic friendly sender when the author isn't in the map.
// `mail.rrmacademy.org` is the verified SES sending domain; any subaddress
// works without registering a new SES identity.
const AUTHOR_SENDERS = {
  // Brian Whittaker
  '301eb55c3f388e65f3f42b14e635dc7a': '"Brian Whittaker" <brian@mail.rrmacademy.org>',
  // Naomi Whittaker (id verified 2026-05-12 via D1 query on naomimwhittaker@gmail.com, role=admin)
  '710134def83240b7b47b22a9c9579c0c': '"Naomi Whittaker" <naomi@mail.rrmacademy.org>',
};

function authorFrom(authorId, authorName) {
  if (AUTHOR_SENDERS[authorId]) return AUTHOR_SENDERS[authorId];
  const safeName = (authorName || 'Save the Uterus Club').replace(/"/g, '');
  return `"${safeName}" <community@mail.rrmacademy.org>`;
}

export async function notifyNewPost(env, db, post, authorName) {
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

  if (!members.results.length) return;

  const link = `${SITE_URL}/community/post/${post.id}`;
  const isEvent = post.type === 'event';
  const safeAuthor = escapeHtml(authorName);
  const from = authorFrom(post.authorId, authorName);

  let subject;
  let buildEmail;

  if (isEvent) {
    const eventTitle = post.title || 'New Save the Uterus Club event';
    subject = post.title || 'New Save the Uterus Club event';
    const formattedDate = formatEventDate(post.event_date);
    const dateLine = formattedDate ? `<p>When: ${escapeHtml(formattedDate)}</p>` : '';
    const dateLineText = formattedDate ? `When: ${formattedDate}\n` : '';

    buildEmail = (m) => {
      const greeting = m.first_name && m.first_name.trim()
        ? `Hi ${escapeHtml(m.first_name.trim())},`
        : 'Hi,';
      const html = `
    <p>${greeting}</p>
    <p><strong>${escapeHtml(eventTitle)}</strong></p>
    ${dateLine}
    <p>Sign in to the community to view the link and join.</p>
    <p><a href="${link}">View event</a></p>
  `;
      const text = `${greeting}\n\n${eventTitle}\n${dateLineText}Sign in to the community to view the link and join.\nView: ${link}`;
      return { html, text };
    };
  } else {
    subject = `${authorName} posted in Save the Uterus Club`;

    buildEmail = (m) => {
      const greeting = m.first_name && m.first_name.trim()
        ? `Hi ${escapeHtml(m.first_name.trim())},`
        : 'Hi,';
      const html = `
    <p>${greeting}</p>
    <p><strong>${safeAuthor}</strong> posted in the Save the Uterus Club community.</p>
    <p>Sign in to read and reply.</p>
    <p><a href="${link}">View post</a></p>
  `;
      const text = `${greeting}\n\n${authorName} posted in the Save the Uterus Club community.\nSign in to read and reply.\nView: ${link}`;
      return { html, text };
    };
  }

  // Send individual emails to preserve privacy (don't expose member emails to each other)
  const emailPromises = members.results.map(m => {
    const { html, text } = buildEmail(m);
    return sendEmail(env, {
      from,
      to: m.email,
      subject,
      html,
      text,
      replyTo: 'administrator@rrmacademy.org',
      log: { db, source: 'community/new-post', category: 'transactional' },
    }).catch(err => console.error(`Failed to email ${m.email}:`, err.message));
  });
  await Promise.all(emailPromises);

  if (env.COMMUNITY_KV) {
    await env.COMMUNITY_KV.put('community:last_post_email', String(Date.now()), { expirationTtl: 900 });
  }
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

  const greeting = recipient.first_name && recipient.first_name.trim()
    ? `Hi ${escapeHtml(recipient.first_name.trim())},`
    : 'Hi,';

  const subject = `${replierName} replied to your ${targetLabel} in Save the Uterus Club`;
  const html = `
    <p>${greeting}</p>
    <p><strong>${escapeHtml(replierName)}</strong> replied to your ${targetLabel}:</p>
    <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#555;">${escapeHtml(preview)}${replyContent.length > 200 ? '...' : ''}</blockquote>
    <p><a href="${link}">View conversation</a></p>
  `;
  const text = `${greeting}\n\n${replierName} replied to your ${targetLabel}:\n"${preview}"\nView: ${link}`;

  await sendEmail(env, {
    from: authorFrom(replierId, replierName),
    to: recipient.email,
    subject,
    html,
    text,
    replyTo: 'administrator@rrmacademy.org',
    log: { db, source: 'community/reply', category: 'transactional' },
  }).catch(err => console.error(`Failed to email ${recipient.email}:`, err.message));
}
