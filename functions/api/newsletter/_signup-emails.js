import { sendTracked } from './_mail.js';
import { unsubscribeUrl } from './_tracking.js';
import { log } from '../_log.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


export async function sendSignupEmails(env, waitUntil, email, _sendTracked, _tracking) {
  const tracked = _sendTracked || { sendTracked };
  const tracking = _tracking || { unsubscribeUrl };

  waitUntil(
    tracked.sendTracked(
      env,
      waitUntil,
      {
        from: '"RRM Academy" <newsletter@mail.rrmacademy.org>',
        to: 'administrator@rrmacademy.org',
        subject: 'New newsletter subscriber',
        text: `${email}\nsource: website\n${new Date().toISOString()}`,
      },
      { component: 'signup-admin-notify', category: 'transactional', source: 'newsletter/signup-admin' }
    ).then((res) => {
      if (!res.ok) log(env, waitUntil, 'newsletter', 'admin_notify_fail', 'warn', res.error, 0, 0);
    })
  );

  waitUntil(
    (async () => {
      if (!env.NEWSLETTER_SECRET) {
        log(env, waitUntil, 'newsletter', 'welcome_skipped_no_secret', 'warn', email, 0, 0);
        return;
      }

      const unsubLink = await tracking.unsubscribeUrl(email, env.NEWSLETTER_SECRET);

      let postLine = '';
      let postLineText = '';
      try {
        const latestPost = await env.DB.prepare(
          "SELECT title, slug FROM posts WHERE status = 'published' ORDER BY publish_date DESC LIMIT 1"
        ).first();
        if (latestPost?.title && latestPost?.slug) {
          const safeTitle = escapeHtml(latestPost.title);
          postLine = `<p>To start, here's a recent piece worth a read: <a href="https://rrmacademy.org/commentary/${latestPost.slug}/">${safeTitle}</a></p>`;
          postLineText = `To start, here's a recent piece worth a read:\nhttps://rrmacademy.org/commentary/${latestPost.slug}/\n${latestPost.title}\n\n`;
        }
      } catch (_e) {}

      const footer = `<p style="font-size:11px;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:12px;">RRM Academy, a program of Restorative Reproductive Medicine Foundation Inc. | 3401 Hartzdale Dr, Ste 103B PMB 3518, Camp Hill, PA 17011<br><a href="${unsubLink}" style="color:#999;">Unsubscribe</a></p>`;
      const footerText = `---\nRRM Academy, a program of Restorative Reproductive Medicine Foundation Inc. | 3401 Hartzdale Dr, Ste 103B PMB 3518, Camp Hill, PA 17011\nUnsubscribe: ${unsubLink}`;

      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:600px;line-height:1.6;"><p>Hi there,</p><p>Thanks for subscribing. I'm really glad you're here.</p><p>Here's what to expect: I'll only write when there's something genuinely worth your time. A new piece of commentary, research worth knowing about, or a resource that might actually help. No daily noise.</p><p>Restorative reproductive medicine starts by finding the underlying cause of what's happening with your cycle or your fertility, and then treating that directly. That's the thread through everything we publish, and I hope you find it useful.</p>${postLine}<p>If something ever resonates, or you have a question, just hit reply. A real person reads every one.</p><p>Warmly,<br>Dr. Naomi Whittaker, MD<br>RRM Academy</p>${footer}</div>`;

      const text = `Hi there,

Thanks for subscribing. I'm really glad you're here.

Here's what to expect: I'll only write when there's something genuinely worth your time. A new piece of commentary, research worth knowing about, or a resource that might actually help. No daily noise.

Restorative reproductive medicine starts by finding the underlying cause of what's happening with your cycle or your fertility, and then treating that directly. That's the thread through everything we publish, and I hope you find it useful.

${postLineText}If something ever resonates, or you have a question, just hit reply. A real person reads every one.

Warmly,
Dr. Naomi Whittaker, MD
RRM Academy

${footerText}`;

      const res = await tracked.sendTracked(
        env,
        waitUntil,
        {
          from: '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>',
          to: email,
          subject: 'Welcome to RRM Academy',
          replyTo: 'community@rrmacademy.org',
          html,
          text,
        },
        { component: 'welcome', category: 'newsletter', source: 'newsletter/welcome' }
      );
      if (!res.ok) log(env, waitUntil, 'newsletter', 'welcome_send_fail', 'warn', res.error, 0, 0);
    })().catch((err) => {
      log(env, waitUntil, 'newsletter', 'welcome_send_fail', 'warn', err?.message || String(err), 0, 0);
    })
  );
}
