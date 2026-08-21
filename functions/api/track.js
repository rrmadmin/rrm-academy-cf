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
import { ALLOWED_CLIENT_EVENTS, REQUIRED_PARAMS, PII_REGEX, PII_VALUE_REGEX, RESERVED_PARAMS, LONG_PARAM_LIMITS, URL_SHAPED_LONG_PARAMS, isDigitRunOnlyMatch } from './_track-events.js';
import { log } from './_log.js';
import { isBotRequest } from './_bot.js';

const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
const PARAM_KEY_RE  = /^[a-z][a-z0-9_]{0,39}$/;

function safeSlice(str, limit) {
  if (str.length <= limit) return str;
  let end = limit;
  const code = str.charCodeAt(end - 1);
  if (code >= 0xD800 && code <= 0xDBFF) end -= 1;
  return str.slice(0, end);
}

function stripDigitRunQueryParams(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  let changed = false;
  for (const [key, value] of [...url.searchParams.entries()]) {
    if (isDigitRunOnlyMatch(value)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  return changed ? url.toString() : urlString;
}

// Fixed enums for the AE-only entry_category/device_type hints (see onRequestPost
// below). entry_category mirrors the value set classifySource()/buildSourceParams()
// actually emit in _ga4-source.js (direct/organic/social/referral/ai, plus 'email'
// from the UTM override and 'paid' from the click-id/paid-medium override in
// buildSourceParams) -- that file is the SSOT, kept in sync manually since AE
// hints never round-trip through it. device_type mirrors the mobile/tablet/desktop
// convention already used in survey/event.js.
const ENTRY_CATEGORY_VALUES = new Set(['direct', 'organic', 'social', 'referral', 'ai', 'email', 'paid']);
const DEVICE_TYPE_VALUES = new Set(['mobile', 'tablet', 'desktop']);

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    // GA4 secrets are required (primary destination). The EVENTS binding
    // (Analytics Engine, dataset 'worker_events') is a SECONDARY mirror -- if
    // it's missing we still want to accept events and relay them to GA4.
    // Codebase convention is `env.EVENTS` (see _log.js, ask.js, etc.); not
    // `env.ANALYTICS`. AE writes degrade silently below.
    if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) {
      return Response.json({ error: 'service_unavailable' }, {
        status: 503,
        headers: CORS_HEADERS,
      });
    }

    // Bot short-circuit -- no GA4 relay, no AE write. Two independent signals,
    // either trips it: UA string (spoofable) and request.cf.asn (datacenter/
    // cloud-provider ASN -- catches browser-UA crawls hosted on cloud IP
    // ranges that UA filtering alone misses).
    if (isBotRequest(request)) {
      env.EVENTS?.writeDataPoint({
        blobs: ['track', 'bot_skipped', '', '', ''],
        doubles: [0],
        indexes: ['bot_skipped'],
      });
      return new Response(null, { status: 204, headers: CORS_HEADERS });
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

    const { event, params: rawParams, cid, sid, sn } = body;

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
    if (paramKeys.length > 25) {
      return Response.json({ error: 'invalid_request', detail: 'params must have at most 25 keys' }, {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // Validate each key and value
    const longParamRawValues = new Map();
    for (const key of paramKeys) {
      if (!PARAM_KEY_RE.test(key)) {
        return Response.json({ error: 'invalid_request', detail: `param key "${key}" must match ^[a-z][a-z0-9_]{0,39}$` }, {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      let val = rawParams[key];
      if (LONG_PARAM_LIMITS.has(key) && typeof val !== 'string') {
        return Response.json({ error: 'invalid_request', detail: `param "${key}" must be a string` }, {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      if (typeof val === 'string') {
        const longLimit = LONG_PARAM_LIMITS.get(key);
        if (longLimit !== undefined) {
          if (URL_SHAPED_LONG_PARAMS.has(key) && isDigitRunOnlyMatch(val)) {
            val = stripDigitRunQueryParams(val) ?? val;
          }
          longParamRawValues.set(key, val);
          if (val.length > longLimit) {
            val = safeSlice(val, longLimit);
          }
          rawParams[key] = val;
        } else if (val.length > 100) {
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

    // AE-only hints, captured from rawParams BEFORE the reserved-key strip below
    // removes entry_category/device_type (both are RESERVED_PARAMS -- the
    // sanitized-params read further down would otherwise always see them as
    // absent). Never fed into sanitizedParams / GA4 params. This endpoint is
    // unauthenticated, so these hints are validated against a fixed enum rather
    // than the generic PII_VALUE_REGEX screen -- any value outside the enum
    // (arbitrary client strings, PII, spoofed values) becomes '', keeping the
    // AE blobs low-cardinality categorical values.
    const entryCategoryHint = ENTRY_CATEGORY_VALUES.has(rawParams.entry_category) ? rawParams.entry_category : '';
    const deviceTypeHint = DEVICE_TYPE_VALUES.has(rawParams.device_type) ? rawParams.device_type : '';

    // Build sanitized params: drop reserved keys silently, then strip PII keys
    const sanitizedParams = {};
    for (const key of paramKeys) {
      if (RESERVED_PARAMS.has(key)) continue;
      if (PII_REGEX.test(key)) continue;
      const val = rawParams[key];
      const piiScreenVal = longParamRawValues.has(key) ? longParamRawValues.get(key) : val;
      if (typeof piiScreenVal === 'string' && PII_VALUE_REGEX.test(piiScreenVal)) continue;
      sanitizedParams[key] = val;
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

    // Validate optional client session identity fields (cid/sid/sn).
    // These arrive at the top level of the body, NOT inside params, so they bypass
    // PII/RESERVED param stripping. Invalid values are silently ignored (fall back to
    // server-derived identity) -- analytics must never reject a beacon over bad overrides.
    const CID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const CID_FALLBACK_RE = /^[A-Za-z0-9._-]{1,64}$/;
    const SID_MIN = 1;
    const SID_MAX = 9_999_999_999; // epoch seconds; year 2286+
    let ga4Overrides = {};
    const cidValid = typeof cid === 'string' && (CID_UUID_RE.test(cid) || CID_FALLBACK_RE.test(cid));
    const sidValid = typeof sid === 'number' && Number.isInteger(sid) && sid >= SID_MIN && sid <= SID_MAX;
    const snValid = typeof sn === 'number' && Number.isInteger(sn) && sn >= 1 && sn <= 999_999;
    if (cidValid && sidValid) {
      ga4Overrides = { client_id: cid, session_id: sid };
      if (snValid) ga4Overrides.session_number = sn;
    }

    // Side effects on accept:
    // 1. GA4 Measurement Protocol -- fire-and-forget via waitUntil
    waitUntil(sendGA4Event(env, request, event, sanitizedParams, ga4Overrides));

    // 2. Analytics Engine -- synchronous (returns void, queues internally)
    //    Blobs: [dataset, event, entry_category-hint, device-hint, '']
    const numericCandidates = [
      sanitizedParams.depth,
      sanitizedParams.value,
      sanitizedParams.rank,
      sanitizedParams.query_length,
    ];
    const canonicalNumeric = numericCandidates.find((v) => typeof v === 'number' && Number.isFinite(v));

    // Optional-chained AE write: silently no-ops if binding missing.
    // Pattern matches _log.js / create-checkout.js / ask.js.
    env.EVENTS?.writeDataPoint({
      blobs: ['track', event, entryCategoryHint, deviceTypeHint, ''],
      doubles: [canonicalNumeric ?? 0],
      indexes: [event],
    });

    return new Response(null, { status: 204, headers: CORS_HEADERS });

  } catch (err) {
    console.error('[track] unexpected error:', err);
    log(env, waitUntil, 'track', 'unexpected_error', 'error', (err?.message || 'internal').slice(0, 200), 0, 500);
    return Response.json({ error: 'internal_error' }, {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
