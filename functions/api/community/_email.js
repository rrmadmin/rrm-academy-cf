/**
 * Community email notification helpers.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 */
import { sendEmail } from '../_ses.js';
import { SITE_URL } from '../auth/_shared.js';

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function notifyNewPost(env, db, post, authorName) {
  // 15-minute cooldown via KV
  if (env.KV) {
    const lastSent = await env.KV.get('community:last_post_email');
    if (lastSent) {
      const elapsed = Date.now() - parseInt(lastSent, 10);
      if (elapsed < 15 * 60 * 1000) return;
    }
  }

  const members = await db.prepare(`
    SELECT DISTINCT u.email FROM user u
    WHERE u.blocked = 0
      AND u.community_email_opt_out = 0
      AND u.id != ?
      AND (
        u.role IN ('mod', 'admin', 'superadmin')
        OR u.id IN (SELECT user_id FROM user_label WHERE label = 'Save the Uterus Club \u{1F3F7}\u{FE0F}')
      )
  `).bind(post.authorId).all();

  if (!members.results.length) return;

  const link = `${SITE_URL}/community/post/${post.id}/`;
  const preview = post.body ? post.body.slice(0, 200) : '';

  const subject = `[Save the Uterus Club] New post: ${post.title}`;
  const html = `
    <p><strong>${escapeHtml(authorName)}</strong> posted in the Save the Uterus Club:</p>
    <h3>${escapeHtml(post.title)}</h3>
    ${preview ? `<p>${escapeHtml(preview)}${post.body && post.body.length > 200 ? '...' : ''}</p>` : ''}
    <p><a href="${link}">View post</a></p>
    <p style="font-size:12px;color:#888;">You're receiving this because you're a Save the Uterus Club member. <a href="${SITE_URL}/community/">Manage notifications</a></p>
  `;
  const text = `${authorName} posted: ${post.title}\n${preview}\nView: ${link}\n\nManage notifications: ${SITE_URL}/community/`;

  await sendEmail(env, {
    from: 'noreply@rrmacademy.org',
    to: members.results.map(m => m.email),
    subject,
    html,
    text,
  });

  if (env.KV) {
    await env.KV.put('community:last_post_email', String(Date.now()), { expirationTtl: 900 });
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
    'SELECT email, community_email_opt_out FROM user WHERE id = ? AND blocked = 0'
  ).bind(recipientId).first();

  if (!recipient || recipient.community_email_opt_out) return;

  const link = `${SITE_URL}/community/post/${postId}/`;
  const preview = replyContent.slice(0, 200);

  const subject = `[Save the Uterus Club] ${replierName} replied to your ${targetLabel}`;
  const html = `
    <p><strong>${escapeHtml(replierName)}</strong> replied to your ${targetLabel}:</p>
    <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#555;">${escapeHtml(preview)}${replyContent.length > 200 ? '...' : ''}</blockquote>
    <p><a href="${link}">View conversation</a></p>
    <p style="font-size:12px;color:#888;">You're receiving this because someone replied to your content. <a href="${SITE_URL}/community/">Manage notifications</a></p>
  `;
  const text = `${replierName} replied to your ${targetLabel}:\n"${preview}"\nView: ${link}\n\nManage notifications: ${SITE_URL}/community/`;

  await sendEmail(env, {
    from: 'noreply@rrmacademy.org',
    to: recipient.email,
    subject,
    html,
    text,
  });
}
