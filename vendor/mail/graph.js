/**
 * THE GRAPH RAIL: Microsoft Graph `sendMail`, app-only client credentials.
 *
 * Merged from the estate's two copies. fsp-dashboard's
 * `workers/fsp-intake-sheets/src/graph.js` holds the token in a module
 * variable because that Worker has no KV binding; neofertility-ie's
 * `functions/api/_lib/sendNotification.ts` caches it in KV so a burst of form
 * posts shares one mint. Both are right for their consumer, so this file does
 * both: the token lives in `deps.kv` under `mail:graph:token` when a namespace
 * is injected, and in an isolate-local variable when one is not.
 *
 * ONE RETRY, ONLY ON 401 AND 403, ONLY AFTER A FRESH TOKEN. Both copies agree
 * on this and both are right: those two statuses are what an expired or
 * revoked token looks like, and nothing else Graph answers gets better by
 * being asked twice. The KV entry is evicted before the refresh so the next
 * isolate does not inherit the token that just failed, AND AGAIN IF THE RETRY
 * IS ALSO REFUSED: a freshly minted token that is immediately rejected means
 * the cache was not the problem, but it now holds a token Graph will go on
 * refusing for the rest of its TTL, and every other isolate would read it.
 * Clearing it is cheap and the alternative is an hour of silent failures
 * (neofertility-ie's rule, the stricter of the two merged).
 *
 * A CONSUMER MAY COMPOSE THE BODY ITSELF. `msg.graphPayload`, when present, is
 * POSTed verbatim in place of anything `buildGraphPayload` would make. Graph's
 * message shape carries more than a portable message does -- a from DISPLAY
 * NAME, a named replyTo, inline attachments with content ids -- and
 * neofertility.ie uses all three, so flattening its payload into this
 * package's message shape would have cost the clinic real behaviour to buy
 * uniformity nobody asked for. What the package still owns for such a caller
 * is everything that was actually duplicated: the token, its cache, the one
 * retry, the 202 rule, and the lane check, which reads `msg.from` exactly as
 * it does for every other send.
 *
 * SUCCESS IS 202 AND NOTHING ELSE. Graph's sendMail answers 202 with an empty
 * body when it accepts a message; fsp-intake-sheets already refuses to read
 * any other 2xx as sent, and that is the stricter of the two rules, so it is
 * the one that survives the merge.
 */

import { MailPermanent, sanitizeHeader } from './lanes.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_KV_KEY = 'mail:graph:token';
const TOKEN_TIMEOUT_MS = 10000;
const SEND_TIMEOUT_MS = 20000;
/** Mint again a little before Microsoft's own expiry. */
const EXPIRY_MARGIN_SECONDS = 300;

/** The PS_INTERNET_HEADERS namespace: Exchange emits these as SMTP headers. */
const HEADER_PROP_NS = 'String {00020386-0000-0000-C000-000000000046} Name';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

/** Test hook: force the next call to mint. Clears the isolate cache only. */
export function forgetGraphTokenForTests() {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
}

async function mintToken(env, deps) {
  const doFetch = deps.fetch || globalThis.fetch;
  const url = `https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.GRAPH_CLIENT_ID,
    client_secret: env.GRAPH_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
  });

  let res;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`graph_token_network_error:${String(err?.message ?? err).slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(`graph_token_failed:${res.status}`);

  const data = await res.json().catch(() => ({}));
  if (typeof data?.access_token !== 'string' || !data.access_token) throw new Error('graph_token_missing');

  const ttlSeconds = Math.max((Number(data.expires_in) || 3600) - EXPIRY_MARGIN_SECONDS, 60);
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + ttlSeconds * 1000;
  if (deps.kv) {
    await deps.kv.put(TOKEN_KV_KEY, data.access_token, { expirationTtl: ttlSeconds }).catch(() => {});
  }
  return data.access_token;
}

/** The current app-only token, from KV or the isolate, minting when needed. */
export async function graphToken(env, deps = {}, { forceFresh = false } = {}) {
  if (forceFresh) {
    if (deps.kv) await deps.kv.delete(TOKEN_KV_KEY).catch(() => {});
    return mintToken(env, deps);
  }
  if (deps.kv) {
    const cached = await deps.kv.get(TOKEN_KV_KEY).catch(() => null);
    if (cached) return cached;
  } else if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }
  return mintToken(env, deps);
}

function recipients(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value])
    .map((v) => sanitizeHeader(v, 320))
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

/** The Graph `sendMail` request body for one message. */
export function buildGraphPayload(env, msg) {
  const message = {
    subject: sanitizeHeader(msg.subject),
    from: { emailAddress: { address: sanitizeHeader(msg.from, 320) } },
    body: msg.html
      ? { contentType: 'HTML', content: msg.html }
      : { contentType: 'Text', content: msg.text ?? '' },
    toRecipients: recipients(msg.to),
  };
  const cc = recipients(msg.cc);
  if (cc.length) message.ccRecipients = cc;
  const replyTo = recipients(msg.replyTo);
  if (replyTo.length) message.replyTo = replyTo;
  const headers = Object.entries(msg.headers || {});
  if (headers.length) {
    message.singleValueExtendedProperties = headers.map(([name, value]) => ({
      id: `${HEADER_PROP_NS} ${sanitizeHeader(name, 200)}`,
      value: sanitizeHeader(value),
    }));
  }
  if (Array.isArray(msg.attachments) && msg.attachments.length) message.attachments = msg.attachments;
  return { message, saveToSentItems: false };
}

/**
 * Send one message on a Graph rail (FSP or Neo, the rails differ only by
 * tenant secrets and sender).
 * -> { ok: true, id } | { ok: false, reason, status }
 * Throws MailPermanent when Graph refuses the sender itself.
 */
export async function sendViaGraph(env, msg, deps = {}, lane = 'graph') {
  const doFetch = deps.fetch || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    return { ok: false, status: 0, reason: 'no-fetch', detail: 'the Graph rail needs deps.fetch' };
  }
  const upn = msg.senderUpn || env?.GRAPH_SENDER_UPN;
  if (!upn) {
    return { ok: false, status: 0, reason: 'graph-not-configured', detail: 'GRAPH_SENDER_UPN is not set' };
  }

  let token;
  try {
    token = await graphToken(env, deps);
  } catch (err) {
    return { ok: false, status: 0, reason: 'graph-token-error', detail: String(err?.message ?? err).slice(0, 200) };
  }

  // A consumer-composed body wins over the package's own. See the header.
  const payload = JSON.stringify(msg.graphPayload ?? buildGraphPayload(env, msg));
  const timeoutMs = Number.isFinite(msg.timeoutMs) && msg.timeoutMs > 0 ? msg.timeoutMs : SEND_TIMEOUT_MS;
  const post = (tok) => doFetch(`${GRAPH_BASE}/users/${encodeURIComponent(upn)}/sendMail`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: payload,
    signal: AbortSignal.timeout(timeoutMs),
  });

  let res;
  try {
    res = await post(token);
    if (res.status === 401 || res.status === 403) {
      let fresh;
      try {
        fresh = await graphToken(env, deps, { forceFresh: true });
      } catch (err) {
        return {
          ok: false,
          status: res.status,
          reason: 'graph-refresh-failed',
          detail: String(err?.message ?? err).slice(0, 200),
        };
      }
      res = await post(fresh);
      if ((res.status === 401 || res.status === 403) && deps.kv) {
        // See the header: a fresh token refused on arrival must not stay in
        // the cache for the next isolate to inherit.
        await deps.kv.delete(TOKEN_KV_KEY).catch(() => {});
      }
    }
  } catch (err) {
    const name = err?.name;
    const timedOut = name === 'AbortError' || name === 'TimeoutError';
    return {
      ok: false,
      status: 0,
      reason: timedOut ? 'graph-timeout' : 'graph-network-error',
      detail: String(err?.message ?? err).slice(0, 200),
    };
  }

  if (res.status !== 202) {
    const body = await res.text().catch(() => '');
    if (res.status === 400 && /ErrorInvalidUser|ErrorNonExistentMailbox|MailboxNotEnabledForRESTAPI/.test(body)) {
      throw new MailPermanent(`graph:${body.slice(0, 200)}`, { lane, status: res.status });
    }
    return { ok: false, status: res.status, reason: 'graph-error', detail: body.slice(0, 200) };
  }
  return { ok: true, status: 202, id: res.headers?.get?.('request-id') ?? null };
}
