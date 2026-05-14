/**
 * Newsletter email template renderer.
 * Produces Gmail-plain HTML: system fonts, no header/footer graphics.
 */
import { trackClick, trackOpen, unsubscribeUrl } from './_tracking.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap all <a href="..."> links in the body for click tracking.
 * Only wraps links pointing to rrmacademy.org (not unsubscribe or external).
 */
export function wrapLinks(html, sendId, subscriberId) {
  return html.replace(
    /href="(https:\/\/rrmacademy\.org\/[^"]+)"/g,
    (match, url) => `href="${trackClick(sendId, subscriberId, url)}"`
  );
}

/**
 * Render a newsletter email.
 * @param {object} opts
 * @param {string} opts.body - HTML body content (the message itself, already escaped if needed)
 * @param {string} opts.sendId
 * @param {string} opts.subscriberId
 * @param {string} opts.email - subscriber email (for unsubscribe token)
 * @param {string} opts.secret - NEWSLETTER_SECRET
 * @returns {Promise<{html: string, text: string}>}
 */
export async function renderEmail({ body, sendId, subscriberId, email, secret }) {
  const unsubLink = await unsubscribeUrl(email, secret);
  const pixel = trackOpen(sendId, subscriberId);
  const wrappedBody = wrapLinks(body, sendId, subscriberId);

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:600px;line-height:1.6;">
${wrappedBody}
<p style="font-size:11px;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:12px;">
RRM Academy, a program of Restorative Reproductive Medicine Foundation Inc. | 3401 Hartzdale Dr, Ste 103B PMB 3518, Camp Hill, PA 17011<br>
<a href="${unsubLink}" style="color:#999;">Unsubscribe</a>
</p>
<img src="${pixel}" width="1" height="1" style="display:none" alt="" />
</div>`;

  // Plain text fallback: use original body (not wrapped) so readers don't see tracking URLs
  const text = body.replace(/<[^>]+>/g, '').trim()
    + `\n\n---\nRRM Academy, a program of Restorative Reproductive Medicine Foundation Inc. | 3401 Hartzdale Dr, Ste 103B PMB 3518, Camp Hill, PA 17011\nUnsubscribe: ${unsubLink}`;

  return { html, text };
}
