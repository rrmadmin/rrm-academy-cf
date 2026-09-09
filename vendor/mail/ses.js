/**
 * THE SES RAIL: Amazon SESv2, `outbound-emails`, Simple and Raw.
 *
 * Ported from rrm-academy-cf `functions/api/_ses.js` (`sendEmail` and
 * `sendRawEmail`), with the one structural change this package exists for:
 * THE SIGNER IS INJECTED. The consumer builds its own `aws4fetch` AwsClient
 * and hands it in as `deps.signer`, so this file, and therefore console-kit,
 * has no dependency at all. Anything with a `fetch(url, init)` method that
 * signs SigV4 works, which is also what makes the rail testable with a fake.
 *
 * No retry, deliberately. SESv2 answers a 4xx for a request it will never
 * accept and a 5xx for its own trouble; the callers in this estate are cron
 * ticks, webhooks and form handlers that already run again, and a retry inside
 * the send is how a transient 500 becomes two copies of the same receipt.
 */

import { MailPermanent, sanitizeHeader } from './lanes.js';

const SEND_TIMEOUT_MS = 15000;

/**
 * SES error codes that mean "not now and not ever": the identity is not
 * verified, the address is dead, the account cannot send. A retry of any of
 * these is a retry of the same refusal, so they throw MailPermanent and the
 * caller records a failure instead of queueing.
 */
const PERMANENT_CODES = [
  'MessageRejected',
  'MailFromDomainNotVerified',
  'AccountSuspendedException',
  'SendingPausedException',
  'AccountSendingPausedException',
];

function endpointFor(env) {
  const region = env?.AWS_SES_REGION || 'us-east-1';
  return { region, url: `https://email.${region}.amazonaws.com/v2/email/outbound-emails` };
}

function listOf(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value]).map((v) => sanitizeHeader(v, 320)).filter(Boolean);
}

/** The SESv2 Simple payload for one message. Exported so a test can read it. */
export function buildSimplePayload(env, msg) {
  const payload = {
    FromEmailAddress: sanitizeHeader(msg.from, 320),
    Destination: { ToAddresses: listOf(msg.to) },
    Content: {
      Simple: {
        Subject: { Data: sanitizeHeader(msg.subject), Charset: 'UTF-8' },
        Body: {},
      },
    },
  };
  const cc = listOf(msg.cc);
  if (cc.length) payload.Destination.CcAddresses = cc;
  if (msg.html) payload.Content.Simple.Body.Html = { Data: msg.html, Charset: 'UTF-8' };
  if (msg.text) payload.Content.Simple.Body.Text = { Data: msg.text, Charset: 'UTF-8' };
  const replyTo = listOf(msg.replyTo);
  if (replyTo.length) payload.ReplyToAddresses = replyTo;
  const configurationSet = msg.configurationSet || env?.SES_CONFIGURATION_SET;
  if (configurationSet) payload.ConfigurationSetName = configurationSet;
  return payload;
}

/**
 * The SESv2 Raw payload: a MIME document, base64. Raw is what carries custom
 * headers (List-Unsubscribe above all), which is the only reason it exists
 * here; a message with no `headers` should use Simple.
 */
export function buildRawPayload(env, msg) {
  const boundary = `----=_Part_${crypto.randomUUID().replace(/-/g, '')}`;
  const toAddr = listOf(msg.to).join(', ');
  const messageId = `<${crypto.randomUUID()}@${msg.messageIdDomain || 'mail.rrmacademy.org'}>`;

  const rawHeaders = [
    `From: ${sanitizeHeader(msg.from, 320)}`,
    `To: ${toAddr}`,
    `Subject: ${sanitizeHeader(msg.subject)}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Precedence: bulk',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const cc = listOf(msg.cc);
  if (cc.length) rawHeaders.push(`Cc: ${cc.join(', ')}`);
  const replyTo = listOf(msg.replyTo);
  if (replyTo.length) rawHeaders.push(`Reply-To: ${replyTo.join(', ')}`);
  for (const [name, value] of Object.entries(msg.headers || {})) {
    rawHeaders.push(`${sanitizeHeader(name, 200)}: ${sanitizeHeader(value)}`);
  }

  let body = `${rawHeaders.join('\r\n')}\r\n\r\n`;
  if (msg.text) body += `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${msg.text}\r\n`;
  if (msg.html) body += `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${msg.html}\r\n`;
  body += `--${boundary}--\r\n`;

  const bytes = new TextEncoder().encode(body);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);

  const payload = { Content: { Raw: { Data: btoa(binary) } } };
  const configurationSet = msg.configurationSet || env?.SES_CONFIGURATION_SET;
  if (configurationSet) payload.ConfigurationSetName = configurationSet;
  return payload;
}

function permanentDetail(status, body) {
  if (status < 400 || status >= 500) return null;
  const code = PERMANENT_CODES.find((c) => body.includes(c));
  return code ? `${code}: ${body.slice(0, 200)}` : null;
}

/**
 * Send one message on the SES rail.
 * -> { ok: true, id } | { ok: false, reason, status }
 * Throws MailPermanent when SES says the message can never be delivered.
 */
export async function sendViaSes(env, msg, deps = {}) {
  const signer = deps.signer;
  if (!signer || typeof signer.fetch !== 'function') {
    return {
      ok: false,
      status: 0,
      reason: 'no-signer',
      detail: 'the SES rail needs deps.signer, a SigV4 client with a fetch(url, init) method',
    };
  }

  const { url } = endpointFor(env);
  const payload = msg.headers && Object.keys(msg.headers).length
    ? buildRawPayload(env, msg)
    : buildSimplePayload(env, msg);

  let res;
  try {
    res = await signer.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err?.name;
    const timedOut = name === 'AbortError' || name === 'TimeoutError';
    return {
      ok: false,
      status: 0,
      reason: timedOut ? 'ses-timeout' : 'ses-network-error',
      detail: String(err?.message ?? err).slice(0, 200),
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const permanent = permanentDetail(res.status, body || '');
    if (permanent) throw new MailPermanent(permanent, { lane: 'ses_rrm', status: res.status });
    return { ok: false, status: res.status, reason: 'ses-error', detail: (body || '').slice(0, 200) };
  }

  const data = await res.json().catch(() => ({}));
  return { ok: true, status: res.status, id: data?.MessageId ?? null };
}
