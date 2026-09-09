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
 * WHAT IS PROVEN LIVE AND WHAT IS FROM THE DOCS. `to`, `from`, `subject`,
 * `text` and `attachments` (as `{ content, filename, type, disposition }`)
 * have all ridden this endpoint in production from fivestarpractices-site and
 * mystical-rose. `html`, `reply_to` and `headers` are the request schema
 * Cloudflare documents at developers.cloudflare.com/email-service/api/
 * send-emails/rest-api/ and have not carried real RRM mail yet; Task 10 Step 4
 * is the inbox-placement run that proves them. They are additive keys, so a
 * field the far side ignores costs a missing alternative part rather than a
 * refused send, which is why they are built here rather than held back.
 */

import { MailPermanent, bareAddress, sanitizeHeader } from './lanes.js';

const CLOUDFLARE_TIMEOUT_MS = 10000;

/**
 * The service caps a message at 5 MiB INCLUDING attachments. This bound is on
 * the BASE64 length, which is what actually rides in the JSON body (~4/3 of
 * the raw bytes), and it sits deliberately under the real ceiling so the
 * refusal is ours and legible rather than an opaque 413 from the far end.
 * Ported with the attachment code from fivestarpractices-site.
 */
export const MAX_ATTACHMENT_BASE64 = 4_500_000;

/**
 * Statuses that mean "not now and not ever", the Cloudflare half of the rule
 * `ses.js` applies to SES codes. 403 is the token or the domain: the sending
 * domain is not onboarded on this account, or this token has no permission
 * on it, and the same request tomorrow gets the same answer. 422 is the
 * message: the far side understood it and will not take it. Everything else
 * in the 4xx range is an ordinary refusal a caller may fix and retry, and a
 * 5xx is Cloudflare's own trouble, which is what the fallback exists for.
 */
const PERMANENT_STATUSES = new Set([403, 422]);

/**
 * The loud failure a domain that was never onboarded produces, measured
 * 2026-08-14. It arrives as an ordinary error body rather than a status of
 * its own, so it is matched on the text; without this a misconfigured domain
 * would look transient and every send would fall back to SES forever.
 */
const PERMANENT_BODY_RE = /Email sending is not enabled for domain|5\.7\.1/i;

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

/** A readable plain-text alternative for an html body that came without one. */
export function textFromHtml(html) {
  return String(html ?? '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

/** btoa over bytes, in chunks: String.fromCharCode(...) on a whole PDF blows the stack. */
function base64FromBytes(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  let binary = '';
  const CHUNK = 0x2000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * How many bytes an attachment claims to be, WITHOUT touching them. Read off
 * byteLength/length rather than by constructing anything, because the size
 * bound is checked against this before any encoding happens: the one input
 * the bound exists to refuse is the one that can take the isolate down with
 * an allocation failure while being materialised twice over.
 */
function rawByteLength(bytes) {
  if (!bytes) return 0;
  if (typeof bytes.byteLength === 'number') return bytes.byteLength;
  if (typeof bytes.length === 'number') return bytes.length;
  return 0;
}

/** What base64 will cost: 4 characters per 3 bytes, rounded up to the block. */
function base64Length(byteLength) {
  return Math.ceil(byteLength / 3) * 4;
}

/**
 * A filename that cannot carry MIME or header structure, whatever the caller
 * hands over.
 */
function sanitizeFilename(name) {
  const cleaned = String(name == null ? '' : name)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned || 'attachment';
}

/**
 * The attachment parts, or a refusal.
 * -> { parts } | { refusal: { ok:false, reason:'attachment-too-large', ... } }
 *
 * Per file AND in total, both measured before encoding and the total checked
 * again on the finished base64 in case an attachment reported a length it did
 * not have. A refusal is an ANSWER, never a throw and never a transport
 * error: the message is too big is something the caller can act on, and a
 * caller that could not tell it apart from a 500 would fall back to SES with
 * the same oversized attachment.
 */
function buildAttachments(list) {
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) return { parts: [] };

  const tooLarge = (bytes) => ({
    refusal: {
      ok: false,
      status: 0,
      reason: 'attachment-too-large',
      detail: `attachments too large to send (${bytes} base64 bytes, cap ${MAX_ATTACHMENT_BASE64})`,
    },
  });

  let projected = 0;
  for (const attachment of items) {
    const one = base64Length(rawByteLength(attachment && attachment.bytes));
    if (one > MAX_ATTACHMENT_BASE64) return tooLarge(one);
    projected += one;
  }
  if (projected > MAX_ATTACHMENT_BASE64) return tooLarge(projected);

  const parts = [];
  let encoded = 0;
  for (const attachment of items) {
    const content = attachment && typeof attachment.content === 'string'
      ? attachment.content
      : base64FromBytes(attachment && attachment.bytes);
    encoded += content.length;
    parts.push({
      content,
      filename: sanitizeFilename(attachment && attachment.filename),
      type: (attachment && (attachment.contentType || attachment.type)) || 'application/octet-stream',
      disposition: (attachment && attachment.disposition) || 'attachment',
    });
  }
  if (encoded > MAX_ATTACHMENT_BASE64) return tooLarge(encoded);
  return { parts };
}

/**
 * The custom headers, every name and value through the package's own
 * sanitiser so nothing a caller composed can fold a second header into the
 * JSON the far side turns back into MIME. This is where the newsletter's
 * `List-Unsubscribe`, `List-Unsubscribe-Post` and `Precedence` ride, and
 * where a caller's own `Message-ID` rides: the package mints none, because a
 * consumer that wants to correlate a send with its own record has to choose
 * the id itself.
 */
function buildHeaders(headers) {
  const entries = Object.entries(headers || {})
    .map(([name, value]) => [sanitizeLine(name).slice(0, 200), sanitizeLine(value)])
    .filter(([name]) => name.length > 0);
  return entries.length ? Object.fromEntries(entries) : null;
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

  const built = buildAttachments(msg.attachments);
  if (built.refusal) return built.refusal;
  const customHeaders = buildHeaders(msg.headers);

  /**
   * HTML AND A TEXT ALTERNATIVE, not one or the other. A caller that hands
   * over both gets both parts; a caller with html alone gets the html plus a
   * text body derived from it, because a message with no text part is the
   * message most likely to be filed as bulk. The derivation is deliberately
   * crude (tags out, entities for the four that matter, blank lines
   * collapsed): it is a fallback for readers that cannot show html, not a
   * renderer, and a caller who cares composes its own `text`.
   */
  const html = msg.html ? String(msg.html) : '';
  const text = sanitizeBodyText(msg.text ?? (html ? textFromHtml(html) : ''));

  const body = JSON.stringify({
    to: recipient,
    from,
    subject: sanitizeLine(msg.subject),
    ...(text ? { text } : {}),
    ...(html ? { html } : {}),
    ...(msg.replyTo ? { reply_to: sanitizeLine(Array.isArray(msg.replyTo) ? msg.replyTo[0] : msg.replyTo) } : {}),
    ...(customHeaders ? { headers: customHeaders } : {}),
    ...(built.parts.length > 0 ? { attachments: built.parts } : {}),
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
    const detail = (await res.text().catch(() => '')) || '';
    if (PERMANENT_STATUSES.has(res.status) || PERMANENT_BODY_RE.test(detail)) {
      throw new MailPermanent(`${res.status}: ${detail.slice(0, 200)}`, { lane: 'cf_email', status: res.status });
    }
    return { ok: false, status: res.status, reason: 'cf-email-error', detail: detail.slice(0, 200) };
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
    const detail = firstErrorOf(answer);
    // A 2xx that carries the not-onboarded refusal is the same permanent fact
    // as the 4xx form of it, and must not look transient to the fallback.
    if (PERMANENT_BODY_RE.test(detail)) {
      throw new MailPermanent(detail, { lane: 'cf_email', status: res.status });
    }
    return { ok: false, status: res.status, reason: 'cf-email-refused', detail };
  }

  const bounced = bounceOf(answer, recipient);
  if (bounced) throw new MailPermanent(`bounced permanently for ${bounced}`, { lane: 'cf_email', status: res.status });

  return { ok: true, status: res.status, id: answer?.result?.message_id ?? null };
}
