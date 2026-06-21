import { sendEmail, sendRawEmail } from '../_ses.js';
import { unsubscribeUrl, unsubscribeHeaders } from './_tracking.js';
import { log } from '../_log.js';

export async function sendSignupEmails(env, waitUntil, email, _ses, _tracking) {
  const ses = _ses || { sendEmail, sendRawEmail };
  const tracking = _tracking || { unsubscribeUrl, unsubscribeHeaders };

  waitUntil(
    ses.sendEmail(env, {
      from: '"RRM Academy" <newsletter@mail.rrmacademy.org>',
      to: 'administrator@rrmacademy.org',
      subject: 'New newsletter subscriber',
      text: `${email}\nsource: website\n${new Date().toISOString()}`,
    }).catch((err) => {
      log(env, waitUntil, 'newsletter', 'admin_notify_fail', 'warn', err.message, 0, 0);
    })
  );

  waitUntil(
    (async () => {
      if (!env.NEWSLETTER_SECRET) {
        log(env, waitUntil, 'newsletter', 'welcome_skipped_no_secret', 'warn', email, 0, 0);
        return;
      }
      const url = await tracking.unsubscribeUrl(email, env.NEWSLETTER_SECRET);
      const headers = await tracking.unsubscribeHeaders(email, env.NEWSLETTER_SECRET);
      await ses.sendRawEmail(env, {
        from: '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>',
        to: email,
        subject: 'Welcome to RRM Academy',
        replyTo: 'community@rrmacademy.org',
        headers,
        text: `Hi there,

Thanks for subscribing. I'm really glad you're here.

Here's what to expect: I'll only write when there's something genuinely worth your time. A new piece of commentary, research worth knowing about, or a resource that might actually help. No daily noise.

Restorative reproductive medicine starts by finding the underlying cause of what's happening with your cycle or your fertility, and then treating that directly. That's the thread through everything we publish, and I hope you find it useful.

If something ever resonates, or you have a question, just hit reply. A real person reads every one.

Warmly,
Dr. Naomi Whittaker
RRM Academy

Unsubscribe anytime: ${url}`,
      });
    })().catch((err) => {
      log(env, waitUntil, 'newsletter', 'welcome_send_fail', 'warn', err.message, 0, 0);
    })
  );
}
