/**
 * POST /api/track
 * Client-side behavior event relay: validates, sanitizes, then fans out to
 * GA4 Measurement Protocol (via sendGA4Event) and CF Analytics Engine.
 *
 * No auth required -- anonymous behavior tracking by design.
 * Rate limit: 60 events / minute / IP.
 */
import { checkRateLimit, CORS_HEADERS, optionsResponse } from './auth/_shared.js';
import { sendGA4Event } from './_ga4.js';
import { ALLOWED_CLIENT_EVENTS, REQUIRED_PARAMS, PII_REGEX, RESERVED_PARAMS } from './_track-events.js';
import { log } from './_log.js';

const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
const PARAM_KEY_RE  = /^[a-z][a-z0-9_]{0,39}$/;

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET || !env.ANALYTICS) {
      return Response.json({ error: 'service_unavailable' }, {
        status: 503,
        headers: CORS_HEADERS,
      });
    }

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const allowed = await checkRateLimit(env, `track:${ip}`, 60, 60);
    if (!allowed) {
      return Response.json({ error: 'rate_limited' }, {
        status: 429,
        headers: CORS_HEADERS,
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid_request', detail: 'body must be valid json' }, {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return Response.json({ error: 'invalid_request', detail: 'body must be a json object' }, {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const { event, params: rawParams } = body;

    // Validate event name: format + allowlist
    if (typeof event !== 'string' || !EVENT_NAME_RE.test(event)) {
      return Response.json({ error: 'invalid_request', detail: 'event name must match ^[a-z][a-z0-9_]{0,39}$' }, {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    if (!ALLOWED_CLIENT_EVENTS.has(event)) {
      return Response.json({ error: 'invalid_request', detail: 'event not in allowlist' }, {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Validate params object
    if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
      return Response.json({ error: 'invalid_request', detail: 'params must be a plain object' }, {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    const paramKeys = Object.keys(rawParams);
    if (paramKeys.length < 1 || paramKeys.length > 25) {
      return Response.json({ error: 'invalid_request', detail: 'params must have 1-25 keys' }, {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Validate each key and value
    for (const key of paramKeys) {
      if (!PARAM_KEY_RE.test(key)) {
        return Response.json({ error: 'invalid_request', detail: `param key "${key}" must match ^[a-z][a-z0-9_]{0,39}$` }, {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const val = rawParams[key];
      if (typeof val === 'string') {
        if (val.length > 100) {
          return Response.json({ error: 'invalid_request', detail: `param "${key}" string value exceeds 100 chars` }, {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
      } else if (typeof val === 'number') {
        if (!Number.isFinite(val) || val < -1e9 || val > 1e9) {
          return Response.json({ error: 'invalid_request', detail: `param "${key}" number must be finite and in [-1e9, 1e9]` }, {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
      } else if (typeof val !== 'boolean') {
        return Response.json({ error: 'invalid_request', detail: `param "${key}" must be string, number, or boolean` }, {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
    }

    // Build sanitized params: drop reserved keys silently, then strip PII keys
    const sanitizedParams = {};
    for (const key of paramKeys) {
      if (RESERVED_PARAMS.has(key)) continue;
      if (PII_REGEX.test(key)) continue;
      sanitizedParams[key] = rawParams[key];
    }

    // Check required params (after reserved/PII stripping -- required keys must be non-PII)
    const required = REQUIRED_PARAMS.get(event) || [];
    for (const reqKey of required) {
      if (!(reqKey in sanitizedParams)) {
        return Response.json({ error: 'invalid_request', detail: `missing required param "${reqKey}" for event "${event}"` }, {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
    }

    // Side effects on accept:
    // 1. GA4 Measurement Protocol -- fire-and-forget via waitUntil
    waitUntil(sendGA4Event(env, request, event, sanitizedParams));

    // 2. Analytics Engine -- synchronous (returns void, queues internally)
    //    Blobs: [dataset, event, entry_category-hint, device-hint, '']
    const entryCategory = typeof sanitizedParams.entry_category === 'string'
      ? sanitizedParams.entry_category : '';
    const deviceType = typeof sanitizedParams.device_type === 'string'
      ? sanitizedParams.device_type : '';

    const numericValues = Object.values(sanitizedParams).filter(v => typeof v === 'number');

    env.ANALYTICS.writeDataPoint({
      blobs: ['track', event, entryCategory, deviceType, ''],
      doubles: numericValues.length > 0 ? numericValues.slice(0, 5) : [0],
      indexes: [event],
    });

    return new Response(null, { status: 204, headers: CORS_HEADERS });

  } catch (err) {
    console.error('[track] unexpected error:', err);
    log(env, waitUntil, 'track', 'unexpected_error', 'error', 'internal', 0, 500);
    return Response.json({ error: 'internal_error' }, {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
