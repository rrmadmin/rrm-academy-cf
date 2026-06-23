/**
 * GA4 Measurement Protocol helper for server-side conversion tracking.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 *
 * Usage: fire-and-forget after successful actions:
 *   sendGA4Event(env, request, 'purchase', { value: 10.00, currency: 'USD' }).catch(() => {});
 */

import { buildSourceParams, getClientId } from './_ga4-source.js';

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

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
    // so server-side headers are not the user's browser context. Attribution for the client
    // beacon comes from page_location (with utm_*) and page_referrer in the event params
    // which the client sends directly. session_number is included when provided.
    let sourceParams;
    if (overrides.client_id != null && overrides.session_id != null) {
      sourceParams = { session_id: overrides.session_id };
      if (overrides.session_number != null) sourceParams.session_number = overrides.session_number;
    } else {
      sourceParams = await buildSourceParams(request, clientId);
    }
    const payload = {
      client_id: clientId,
      events: [{
        name: eventName,
        params: {
          page_location: (() => { try { const u = new URL(request.headers.get('referer') || request.url); u.search = ''; return u.toString(); } catch { return ''; } })(),
          engagement_time_msec: 1,
          ...sourceParams,
          ...params,
        },
      }],
    };

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
