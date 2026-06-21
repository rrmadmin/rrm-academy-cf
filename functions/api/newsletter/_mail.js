// INVARIANT: best-effort -- sendTracked NEVER throws to the caller.
// A send failure, a log failure, or an alert failure all resolve to {ok:false}.
// The logging+observation layers must never break a send path.

import { sendEmail as _sendEmail, logEmailFailure as _logEmailFailure } from '../_ses.js';
import { log } from '../_log.js';

// Intentionally does NOT apply _log.js PRIV-02 email redaction -- admin-only
// failure-alert channel (Brian's private chat), not long-retention telemetry.
async function alertFailure(env, component, to, error, fetchFn) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const fn = fetchFn || fetch;
  await fn(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: `Mail FAILED: ${component} -> ${to}: ${String(error).slice(0, 300)}`,
      }),
    }
  );
}

export async function sendTracked(env, waitUntil, mail, meta, deps = {}) {
  const sendEmail = deps.sendEmail || _sendEmail;
  const logEmailFailure = deps.logEmailFailure || _logEmailFailure;
  const fetchFn = deps.fetch || undefined;
  try {
    try {
      const res = await sendEmail(env, {
        ...mail,
        log: { db: env.DB, category: meta.category, source: meta.source },
      });
      log(env, waitUntil, 'mail', meta.component + '_sent', 'ok', mail.to, 0, 200);
      return { ok: true, messageId: res.messageId };
    } catch (err) {
      try {
        await logEmailFailure(env.DB, {
          email: mail.to,
          category: meta.category,
          source: meta.source,
          subject: mail.subject,
          detail: err.message,
        });
      } catch (_e) {}
      log(env, waitUntil, 'mail', meta.component + '_failed', 'error', err.message, 0, 0);
      await alertFailure(env, meta.component, mail.to, err.message, fetchFn).catch(() => {});
      return { ok: false, error: err.message };
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
