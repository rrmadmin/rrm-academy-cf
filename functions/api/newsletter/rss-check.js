/**
 * POST /api/newsletter/rss-check
 * Called by n8n cron. Checks RSS feed for new commentary posts.
 * If a new post exists that hasn't been sent, triggers a newsletter send.
 */
import { log } from '../_log.js';

export async function onRequestPost({ request, env, waitUntil }) {
  const auth = request.headers.get('Authorization');
  if (!env.ADMIN_API_SECRET || auth !== `Bearer ${env.ADMIN_API_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch RSS feed
  let rssText;
  try {
    const rssResp = await fetch('https://rrmacademy.org/commentary/rss.xml');
    if (!rssResp.ok) throw new Error(`RSS fetch failed: ${rssResp.status}`);
    rssText = await rssResp.text();
  } catch (err) {
    log(env, waitUntil, 'newsletter', 'rss_fetch_error', 'error', err.message, 0, 0);
    return Response.json({ ok: false, error: 'RSS fetch failed' }, { status: 502 });
  }

  // Extract first item (most recent post)
  const titleMatch = rssText.match(/<item>\s*<title><!\[CDATA\[(.*?)\]\]><\/title>/);
  const linkMatch = rssText.match(/<item>\s*<title>.*?<\/title>\s*<link>(.*?)<\/link>/s);
  const descMatch = rssText.match(/<item>.*?<description><!\[CDATA\[(.*?)\]\]><\/description>/s);

  if (!titleMatch || !linkMatch) {
    return Response.json({ ok: true, action: 'no_posts' });
  }

  const postTitle = titleMatch[1];
  const postUrl = linkMatch[1];
  const postExcerpt = descMatch ? descMatch[1] : '';
  const slug = postUrl.replace('https://rrmacademy.org/commentary/', '').replace(/\/$/, '');

  // Check if we already sent this post
  const existing = await env.DB.prepare(
    "SELECT id FROM newsletter_send WHERE commentary_slug = ? LIMIT 1"
  ).bind(slug).first();

  if (existing) {
    return Response.json({ ok: true, action: 'already_sent', slug });
  }

  // Build Gmail-plain email body
  const emailBody = `
<p>We just published something you might find useful:</p>
<p><strong><a href="${postUrl}" style="color:#725e7e;">${postTitle}</a></strong></p>
${postExcerpt ? `<p style="color:#555;">${postExcerpt}</p>` : ''}
<p>- Naomi</p>
`.trim();

  // Return the send payload for n8n to call /api/newsletter/send in a loop
  // (Don't self-fetch: CF Pages Functions share the 100s timeout budget)
  log(env, waitUntil, 'newsletter', 'rss_new_post', 'ok', slug, 0, 200);

  return Response.json({
    ok: true,
    action: 'new_post',
    slug,
    subject: postTitle,
    body: emailBody,
  });
}
