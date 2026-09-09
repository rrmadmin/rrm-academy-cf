/**
 * THE CLOUDFLARE EMAIL SENDING RAIL, for FSP client clinic sites.
 *
 * Ported from mystical-rose `functions/_lib/mail.js`, itself ported from
 * fivestarpractices-site `functions/_lib/email-send.js` and proven live
 * against api.cloudflare.com with DKIM, SPF and DMARC all passing.
 *
 * THE PAYLOAD IS FLAT STRINGS. `to`, `from`, `subject`, `text`. This was
 * measured against the live endpoint on 2026-08-13: a nested or array `to`
 * answers `10001 invalid_request_schema`, even though the API's published
 * schema shows an array builder form. The flat shape is the working shape, not
 * a shortcut, so it stays flat. One recipient per send, which is also why any
 * non-empty `permanent_bounces` is this message's bounce.
 *
 * SUCCESS IS `success: true` PLUS NO BOUNCE, AND NOTHING ELSE. Do not add a
 * check that the recipient appears in `result.delivered` or `result.queued`: a
 * genuinely queued send answers with all three arrays empty and `message_id`
 * as the only evidence.
 *
 * No attachments. Nothing on a clinic site sends one, and carrying the base64
 * chunking and size projection from the ported module as dead weight would be
 * worse than porting it back the day a caller needs it.
 */

import { MailPermanent, bareAddress, sanitizeHeader } from './lanes.js';

const CLOUDFLARE_TIMEOUT_MS = 10000;

/**
 * Characters that occupy no width and can still change what a reader sees: the
 * bidi overrides and isolates reorder a line, the zero-width marks hide inside
 * one. Every string reaching this rail may have been typed into a public form.
 *
 * U+200B-U+200F zero width space, joiners, LRM and RLM
 * U+202A-U+202E bidi embeddings and overrides
 * U+2060-U+2069 word joiner, invisible operators, bidi isolates
 * U+FEFF        zero width no-break space (BOM)
 */
const INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** A single-line value with the invisibles removed as well as the controls. */
export function sanitizeLine(value) {
  return sanitizeHeader(String(value ?? '').replace(INVISIBLE_RE, ''));
}

/** A body: invisibles gone, line endings normalised, other controls dropped. */
export function sanitizeBodyText(value) {
  return String(value ?? '')
    .replace(INVISIBLE_RE, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // eslint-disable-next-line no-control-regex -- intentional: drop control characters, keep \n and \t
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/**
 * The account id, refused before any request when it is missing or carries
 * anything that is not a plain identifier: a stray quote or slash pasted into
 * a secret would otherwise build a URL pointing somewhere else entirely and
 * answer with an opaque 400.
 */
export function cloudflareSendUrl(env) {
  const accountId = String(env?.EMAIL_SEND_ACCOUNT_ID ?? '').trim();
  if (!accountId) return { error: 'EMAIL_SEND_ACCOUNT_ID is not configured' };
  if (!/^[A-Za-z0-9]+$/.test(accountId)) {
    return { error: 'EMAIL_SEND_ACCOUNT_ID is not a plain Cloudflare account id' };
  }
  return { url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send` };
}

function firstErrorOf(payload) {
  const errors = payload && Array.isArray(payload.errors) ? payload.errors : [];
  const first = errors[0];
  if (!first) return 'no error detail';
  const code = first.code === undefined || first.code === null ? '' : `${first.code} `;
  return `${code}${first.message || 'no message'}`.slice(0, 300);
}

/**
 * Whether this send bounced permanently. `success: true` only means the API
 * ACCEPTED the request; a non-empty `permanent_bounces` means the recipient is
 * dead and the caller must still record a failure.
 */
function bounceOf(payload, recipient) {
  const result = payload && payload.result;
  const bounces = result && Array.isArray(result.permanent_bounces) ? result.permanent_bounces : [];
  if (bounces.length === 0) return null;
  const target = String(recipient).toLowerCase();
  const named = bounces.some((entry) => {
    const address = typeof entry === 'string' ? entry : entry && (entry.email || entry.address);
    return typeof address === 'string' && address.trim().toLowerCase() === target;
  });
  return named ? recipient : `${bounces.length} recipient(s) on a single-recipient message`;
}

/**
 * Send one message on the Cloudflare Email Sending rail.
 * -> { ok: true, id } | { ok: false, reason, status }
 * Throws MailPermanent on a permanent bounce.
 */
export async function sendViaCfEmail(env, msg, deps = {}) {
  const doFetch = deps.fetch || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    return { ok: false, status: 0, reason: 'no-fetch', detail: 'the Cloudflare rail needs deps.fetch' };
  }
  const token = env?.EMAIL_SEND_TOKEN;
  if (!token) {
    return { ok: false, status: 0, reason: 'cf-email-not-configured', detail: 'EMAIL_SEND_TOKEN is not configured' };
  }
  const endpoint = cloudflareSendUrl(env);
  if (endpoint.error) {
    return { ok: false, status: 0, reason: 'cf-email-not-configured', detail: endpoint.error };
  }

  // The proven payload sends a BARE address even though a config may hold the
  // readable display-name form.
  const from = sanitizeLine(bareAddress(msg.from));
  const recipient = sanitizeLine(Array.isArray(msg.to) ? msg.to[0] : msg.to);
  if (!recipient) return { ok: false, status: 0, reason: 'no-recipient', detail: 'no recipient address' };

  const body = JSON.stringify({
    to: recipient,
    from,
    subject: sanitizeLine(msg.subject),
    text: sanitizeBodyText(msg.text ?? msg.html ?? ''),
    ...(msg.replyTo ? { reply_to: sanitizeLine(Array.isArray(msg.replyTo) ? msg.replyTo[0] : msg.replyTo) } : {}),
  });

  let res;
  try {
    res = await doFetch(endpoint.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err?.name;
    const timedOut = name === 'AbortError' || name === 'TimeoutError';
    return {
      ok: false,
      status: 0,
      reason: timedOut ? 'cf-email-timeout' : 'cf-email-network-error',
      detail: String(err?.message ?? err).slice(0, 200),
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, reason: 'cf-email-error', detail: text.slice(0, 200) };
  }

  let answer;
  try {
    answer = await res.json();
  } catch {
    return {
      ok: false,
      status: res.status,
      reason: 'cf-email-bad-body',
      detail: 'answered 2xx with a body that is not JSON',
    };
  }
  if (!answer || answer.success === false) {
    return { ok: false, status: res.status, reason: 'cf-email-refused', detail: firstErrorOf(answer) };
  }

  const bounced = bounceOf(answer, recipient);
  if (bounced) throw new MailPermanent(`bounced permanently for ${bounced}`, { lane: 'cf_email', status: res.status });

  return { ok: true, status: res.status, id: answer?.result?.message_id ?? null };
}
