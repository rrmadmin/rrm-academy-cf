/**
 * GA4 Measurement Protocol helper for server-side conversion tracking.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 *
 * Usage: fire-and-forget after successful actions:
 *   sendGA4Event(env, request, 'purchase', { value: 10.00, currency: 'USD' }).catch(() => {});
 */

import { buildSourceParams, getClientId, parseCookie } from './_ga4-source.js';
import { PII_VALUE_REGEX } from './_track-events.js';

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

// Event names for which the MP payload gets a coarse user_properties.user_role
// stamp. Enum only, no identifiers -- lets GA4 segment registered vs anonymous
// traffic without carrying PII through Measurement Protocol.
// 'purchase' is deliberately excluded: anonymous no-login checkout is a
// first-class flow (create-checkout.js supports it explicitly), so stamping
// user_role='registered' on every purchase would mislabel anonymous donors
// as registered and invert the segmentation.
const REGISTERED_USER_EVENTS = new Set(['sign_up', 'signup_from_ask']);

let warnedMissing = false;

/**
 * @param {object} overrides - Optional. { client_id, session_id } to use instead of
 *   deriving from request headers. Used by stripe-webhook to replay the real user identity.
 */
export async function sendGA4Event(env, request, eventName, params = {}, overrides = {}) {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) {
    if (!warnedMissing) {
      console.warn('GA4: missing', !env.GA4_MEASUREMENT_ID ? 'GA4_MEASUREMENT_ID' : 'GA4_API_SECRET');
      warnedMissing = true;
    }
    return;
  }

  try {
    const clientId = overrides.client_id || await getClientId(request);
    // When both client_id and session_id are overridden (client beacon or webhook replay),
    // skip buildSourceParams -- the request arrives via the first-party /api/track relay,
    // so its URL is /api/track and its Referer is a same-origin self-referral to the page
    // the user is on, which classifySource files as direct. Neither one is the entry URL,
    // so page_location (with utm_*) and page_referrer come from the event params the
    // client sends directly, and the entry_ref/entry_url cookies are preferred over both
    // in the fallback below. Those cookies ARE the user's, because the beacon is
    // same-origin. session_number is included when provided.
    let sourceParams;
    if (overrides.client_id != null && overrides.session_id != null) {
      sourceParams = { session_id: overrides.session_id };
      if (overrides.session_number != null) sourceParams.session_number = overrides.session_number;
      // Entry-source attribution is normally skipped on this branch (see
      // comment above) because the relay request's own URL and self-referral
      // Referer are not the entry URL. But when the caller's own params are
      // missing entry_category/entry_platform, fall back to the entry_ref and
      // entry_url cookies (same signal buildSourceParams already reads) rather
      // than shipping the event with no attribution at all. The whole
      // attribution set travels, not just entry_category/entry_platform:
      // entry_*, utm_*, email_type, list_source.
      if (params.entry_category == null || params.entry_platform == null) {
        const cookies = request.headers.get('Cookie') || '';
        if (parseCookie(cookies, 'entry_ref') || parseCookie(cookies, 'entry_url')) {
          const derived = await buildSourceParams(request, clientId);
          // Forward everything buildSourceParams knows about the visit except
          // its server-derived session_id: the client's session_id (overrides)
          // is the real one and must win. Caller params still spread last in
          // the payload, so a caller-supplied value is never clobbered here.
          const { session_id: _serverSessionId, ...attribution } = derived;
          Object.assign(sourceParams, attribution);
        }
      }
    } else {
      sourceParams = await buildSourceParams(request, clientId);
    }
    // Server-derived attribution is parsed from the entry_url cookie, which is
    // authored by whoever built the inbound link (a newsletter that stamps the
    // subscriber's email into utm_term, for instance). Apply the same value
    // screen /api/track applies to client params so PII never reaches GA4 from
    // either branch. The utm_* values were already screened raw in extractUtm
    // before clamping, so this pass covers the rest of the set (list_source and
    // the referrer-derived values). Pure digit runs of 10 or 13-19 characters
    // are dropped (phone/card shapes); {creative} ad ids are 11-12 digits and pass.
    for (const [key, value] of Object.entries(sourceParams)) {
      if (typeof value === 'string' && PII_VALUE_REGEX.test(value)) delete sourceParams[key];
    }
    const defaultPageLocation = (() => { try { const u = new URL(request.headers.get('referer') || request.url); u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return u.toString(); } catch { return ''; } })();
    const payload = {
      client_id: clientId,
      events: [{
        name: eventName,
        params: {
          page_location: defaultPageLocation,
          engagement_time_msec: 1,
          ...sourceParams,
          ...params,
        },
      }],
    };
    // Caller-supplied page_location (via params) spreads last above and could
    // otherwise bypass this file's own query-string-stripping default -- strip
    // the query string and hash from whichever page_location won, regardless
    // of source, so no query string ever egresses to google-analytics.com.
    // Also clear userinfo (username/password) -- URL.search/hash clearing alone
    // leaves any embedded https://user:pass@host userinfo intact in toString().
    {
      const finalParams = payload.events[0].params;
      try {
        const u = new URL(finalParams.page_location);
        u.username = '';
        u.password = '';
        u.search = '';
        u.hash = '';
        finalParams.page_location = u.toString();
      } catch {
        finalParams.page_location = defaultPageLocation;
      }
    }
    if (REGISTERED_USER_EVENTS.has(eventName)) {
      payload.user_properties = { user_role: { value: 'registered' } };
    }

    const resp = await fetch(
      `${GA4_ENDPOINT}?measurement_id=${env.GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!resp.ok) {
      try {
        env.EVENTS?.writeDataPoint({
          blobs: ['rrm-academy', 'ga4', 'ga4_mp_error', 'error', String(resp.status)],
          doubles: [0, 1, resp.status],
          indexes: ['ga4_mp_error'],
        });
      } catch {
        // best-effort: AE write must not escalate analytics-error logging into a user-visible failure
      }
    }
  } catch {
    // Silent -- never let analytics failures affect the user
  }
}
