/**
 * Idempotency-Key wrapper for Pages Functions.
 *
 * Wrap a handler to support the RFC-draft `Idempotency-Key` request header so agents
 * (and any HTTP client) can safely retry a mutation without producing duplicate side
 * effects. Opt-in: handlers without the header behave exactly as before.
 *
 * Behaviour table (see docs/superpowers/specs for the orank discovery audit):
 *
 *   Condition                         | Response                        | Headers                       | Log
 *   ----------------------------------+---------------------------------+-------------------------------+------
 *   No Idempotency-Key header         | handler default                 | (none added)                  | none
 *   Header malformed                  | 400 invalid-idempotency-key     | (none added)                  | warn
 *   KV read fails / unavailable       | handler default (treat as miss) | Idempotency-Key echoed        | warn
 *   KV write fails                    | handler default                 | Idempotency-Key echoed        | error
 *   Hit with matching body fingerprint| cached status + body            | Idempotency-Replayed: true    | none
 *   Hit with mismatched fingerprint   | 422 idempotency-mismatch        | (none added)                  | warn
 *
 * Cached only when handler returns 2xx and content-type is not a stream
 * (text/event-stream, application/octet-stream). TTL: 24h.
 *
 * Usage:
 *   import { withIdempotency } from '../_lib/idempotency.js';
 *   export async function onRequestPost(context) {
 *     return withIdempotency(context, async (ctx) => {
 *       // original handler body unchanged -- ctx.request is the same object
 *     });
 *   }
 */

const KEY_RE = /^[\x21-\x7e]{16,128}$/;
const TTL_SECONDS = 24 * 60 * 60;
const NON_CACHEABLE_CONTENT_TYPES = ['text/event-stream', 'application/octet-stream'];

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function computeFingerprint(request) {
  const body = await request.clone().text();
  const url = new URL(request.url);
  return sha256Hex(`${request.method}\n${url.pathname}\n${body}`);
}

function scopeFromUrl(url) {
  return new URL(url).pathname.replace(/^\/+/, '').replace(/[^a-z0-9\-_/]/gi, '_');
}

function isCacheable(response) {
  if (response.status < 200 || response.status >= 300) return false;
  const ct = response.headers.get('content-type') || '';
  return !NON_CACHEABLE_CONTENT_TYPES.some((s) => ct.includes(s));
}

function tryLog(env, level, code, message) {
  try {
    if (env && env.EVENTS && typeof env.EVENTS.writeDataPoint === 'function') {
      env.EVENTS.writeDataPoint({
        blobs: ['idempotency', code, message || '', level],
        indexes: ['idempotency'],
      });
    }
  } catch {
    // Logging must never fail the request.
  }
}

export async function withIdempotency(context, handler) {
  const { request, env, waitUntil } = context;
  const rawKey = request.headers.get('Idempotency-Key');
  if (!rawKey) return handler(context);

  if (!KEY_RE.test(rawKey)) {
    tryLog(env, 'warn', 'invalid_key', `len=${rawKey.length}`);
    return jsonResponse(
      {
        ok: false,
        error: 'invalid-idempotency-key',
        message: 'Idempotency-Key must be 16-128 printable ASCII characters (RFC IETF idempotency-header draft).',
      },
      400,
    );
  }

  if (!env || !env.IDEMPOTENCY_KV) {
    tryLog(env, 'warn', 'kv_missing', 'IDEMPOTENCY_KV not bound; passthrough');
    const resp = await handler(context);
    return echoKey(resp, rawKey);
  }

  let fingerprint;
  try {
    fingerprint = await computeFingerprint(request);
  } catch (err) {
    tryLog(env, 'warn', 'fingerprint_failed', err?.message || 'unknown');
    const resp = await handler(context);
    return echoKey(resp, rawKey);
  }

  const cacheKey = `idem:${scopeFromUrl(request.url)}:${rawKey}`;
  let cached = null;
  try {
    cached = await env.IDEMPOTENCY_KV.get(cacheKey, { type: 'json' });
  } catch (err) {
    tryLog(env, 'warn', 'kv_read_failed', err?.message || 'unknown');
  }

  if (cached) {
    if (cached.fingerprint !== fingerprint) {
      tryLog(env, 'warn', 'fingerprint_mismatch', cacheKey);
      return jsonResponse(
        {
          ok: false,
          error: 'idempotency-mismatch',
          message: 'This Idempotency-Key was used with a different request body. Use a new key for a new request.',
        },
        422,
      );
    }
    const headers = new Headers(cached.headers || {});
    headers.delete('content-encoding');
    headers.delete('transfer-encoding');
    headers.set('Idempotency-Replayed', 'true');
    headers.set('Idempotency-Key', rawKey);
    return new Response(cached.body, { status: cached.status, headers });
  }

  const response = await handler(context);

  if (isCacheable(response)) {
    try {
      const cloned = response.clone();
      const body = await cloned.text();
      const headersObj = {};
      for (const [k, v] of cloned.headers.entries()) {
        // Skip per-hop / encoding headers that would corrupt a replay.
        if (k === 'content-encoding' || k === 'transfer-encoding' || k === 'content-length') continue;
        headersObj[k] = v;
      }
      const payload = {
        status: response.status,
        headers: headersObj,
        body,
        fingerprint,
        createdAt: Date.now(),
      };
      const put = env.IDEMPOTENCY_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: TTL_SECONDS });
      if (waitUntil) waitUntil(put);
      else await put;
    } catch (err) {
      tryLog(env, 'error', 'kv_write_failed', err?.message || 'unknown');
    }
  }

  return echoKey(response, rawKey);
}

function echoKey(response, rawKey) {
  const headers = new Headers(response.headers);
  headers.set('Idempotency-Key', rawKey);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
