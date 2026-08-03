/**
 * Dual-lane transactional email router.
 *
 * Recipients whose domain routes mail through a Microsoft 365 business
 * tenant (MX target ending in .mail.protection.outlook.com) are sent via
 * the Google Workspace lane (Gmail API, OAuth refresh-token grant) instead
 * of AWS SES. Everything else stays on SES unchanged.
 *
 * Requires CF Pages secrets: GOG_CLIENT_ID, GOG_CLIENT_SECRET,
 * VA_GMAIL_REFRESH_TOKEN. Missing any of these routes every send straight
 * to SES (lane 'ses') -- deploying this module ahead of the secrets is a
 * no-op, never a broken send path.
 */
import { sendEmail, insertEmailLog, sanitizeHeader } from './_ses.js';

const M365_MX_SUFFIX = '.mail.protection.outlook.com';
const DNS_TIMEOUT_MS = 1500;

// Domain MX lookups are stable for hours; cache to keep the DoH round trip
// off the hot path for repeat senders. Insertion-order eviction (not LRU) --
// simple and sufficient at this cap.
const DOMAIN_CACHE_TTL_MS = 60 * 60 * 1000;
const DOMAIN_CACHE_MAX_SIZE = 500;
const domainCache = new Map();

function cacheGetDomain(domain) {
  const entry = domainCache.get(domain);
  if (!entry) return undefined;
  if (Date.now() >= entry.expires) {
    domainCache.delete(domain);
    return undefined;
  }
  return entry.isM365;
}

function cacheSetDomain(domain, isM365) {
  if (!domainCache.has(domain) && domainCache.size >= DOMAIN_CACHE_MAX_SIZE) {
    const oldestKey = domainCache.keys().next().value;
    domainCache.delete(oldestKey);
  }
  domainCache.set(domain, { isM365, expires: Date.now() + DOMAIN_CACHE_TTL_MS });
}

/**
 * True iff `email`'s domain has an MX record pointed at Microsoft 365
 * (Exchange Online Protection). Fails toward false (SES lane) on any
 * network error, timeout, or malformed response -- a broken DNS lookup
 * must never block a send.
 */
export async function isM365Recipient(email) {
  const at = String(email ?? '').lastIndexOf('@');
  if (at === -1) return false;
  const domain = String(email).slice(at + 1).toLowerCase();
  if (!domain) return false;

  const cached = cacheGetDomain(domain);
  if (cached !== undefined) return cached;

  let isM365 = false;
  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
      }
    );
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data?.Answer)) {
        isM365 = data.Answer.some((a) => {
          // MX record data is "<preference> <exchange>." -- take the last
          // whitespace-separated token, not the whole string.
          const raw = String(a?.data ?? '').trim();
          const target = raw.split(/\s+/).pop() || '';
          const normalized = target.toLowerCase().replace(/\.$/, '');
          return normalized.endsWith(M365_MX_SUFFIX);
        });
      }
    }
  } catch {
    isM365 = false;
  }

  cacheSetDomain(domain, isM365);
  return isM365;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const WORKSPACE_FROM = 'RRM Academy <surveys@rrmacademy.org>';
const TOKEN_EXPIRY_SAFETY_MS = 60 * 1000;

// Single-slot cache: one Workspace sender identity, one refresh token.
let cachedToken = null; // { accessToken, expiresAt }

async function getWorkspaceAccessToken(env) {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken;
  }

  let resp;
  try {
    resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOG_CLIENT_ID,
        client_secret: env.GOG_CLIENT_SECRET,
        refresh_token: env.VA_GMAIL_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new Error(`Workspace token request failed (network): ${err.message}`, { cause: err });
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Workspace token request failed (${resp.status}): ${(body || '').slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data?.access_token) {
    throw new Error('Workspace token response missing access_token');
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - TOKEN_EXPIRY_SAFETY_MS,
  };
  return cachedToken.accessToken;
}

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sends via the Gmail API using the Workspace service account's refresh
 * token. Always sends as WORKSPACE_FROM regardless of the `from` the caller
 * passed -- this lane has exactly one sending identity.
 */
export async function sendViaWorkspace(env, { to, subject, html, text, replyTo }) {
  const accessToken = await getWorkspaceAccessToken(env);

  const boundary = `----=_Part_${crypto.randomUUID().replace(/-/g, '')}`;
  const toAddr = sanitizeHeader(Array.isArray(to) ? to[0] : to);

  const headers = [
    `From: ${sanitizeHeader(WORKSPACE_FROM)}`,
    `To: ${toAddr}`,
    `Subject: ${sanitizeHeader(subject)}`,
    'MIME-Version: 1.0',
  ];
  if (replyTo) headers.push(`Reply-To: ${sanitizeHeader(replyTo)}`);

  let body;
  if (html && text) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = headers.join('\r\n') + '\r\n\r\n'
      + `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n`
      + `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n`
      + `--${boundary}--\r\n`;
  } else {
    headers.push(`Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=UTF-8`);
    body = headers.join('\r\n') + '\r\n\r\n' + (html || text || '');
  }

  const raw = base64UrlEncode(body);

  let resp;
  try {
    resp = await fetch(GMAIL_SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new Error(`Gmail send request failed (network): ${err.message}`, { cause: err });
  }

  if (!resp.ok) {
    const body2 = await resp.text().catch(() => '');
    throw new Error(`Gmail send failed (${resp.status}): ${(body2 || '').slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data?.id) {
    throw new Error('Gmail send response missing id');
  }
  return { messageId: data.id };
}

/**
 * Routing wrapper: signature-compatible with sendEmail(env, opts). Sends via
 * Google Workspace when the recipient's domain is on Microsoft 365 and the
 * Workspace secrets are configured; otherwise (or on Workspace failure)
 * falls back to SES. Throws only if the final lane attempt throws.
 */
export async function sendTransactionalEmail(env, opts) {
  const { to, subject, log } = opts;

  const workspaceConfigured = !!(env.GOG_CLIENT_ID && env.GOG_CLIENT_SECRET && env.VA_GMAIL_REFRESH_TOKEN);
  if (!workspaceConfigured) {
    return sendEmail(env, opts);
  }

  if (Array.isArray(to)) {
    return sendEmail(env, opts);
  }

  const useWorkspace = await isM365Recipient(to);
  if (!useWorkspace) {
    return sendEmail(env, opts);
  }

  try {
    const result = await sendViaWorkspace(env, opts);
    if (log?.db) {
      await insertEmailLog(log.db, {
        event: 'send',
        email: to,
        category: log.category || 'transactional',
        source: log.source || '',
        subject,
        detail: `gmail:${result.messageId}`,
        send_id: result.messageId,
        ses_message_id: null,
        lane: 'workspace',
      });
    }
    return result;
  } catch (err) {
    if (log?.db) {
      await insertEmailLog(log.db, {
        event: 'lane_fallback',
        email: to,
        category: log.category || 'transactional',
        source: log.source || '',
        subject,
        detail: err.message,
        lane: 'workspace',
      });
    }
    return sendEmail(env, opts);
  }
}
