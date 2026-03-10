/**
 * GA4 Measurement Protocol helper for server-side conversion tracking.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 *
 * Usage: fire-and-forget after successful actions:
 *   sendGA4Event(env, request, 'purchase', { value: 10.00, currency: 'USD' }).catch(() => {});
 */

import { buildSourceParams, getClientId } from './_ga4-source.js';

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/**
 * @param {object} overrides - Optional. { client_id, session_id } to use instead of
 *   deriving from request headers. Used by stripe-webhook to replay the real user identity.
 */
export async function sendGA4Event(env, request, eventName, params = {}, overrides = {}) {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return;

  try {
    const clientId = overrides.client_id || await getClientId(request);
    // When both client_id and session_id are overridden (webhook replay),
    // skip buildSourceParams entirely -- the request is from Stripe's servers,
    // not the user's browser, so headers are meaningless for attribution.
    const sourceParams = (overrides.client_id && overrides.session_id)
      ? { session_id: overrides.session_id }
      : await buildSourceParams(request, clientId);
    const payload = {
      client_id: clientId,
      events: [{
        name: eventName,
        params: {
          page_location: request.url,
          engagement_time_msec: 1,
          ...sourceParams,
          ...params,
        },
      }],
    };

    await fetch(
      `${GA4_ENDPOINT}?measurement_id=${env.GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
  } catch {
    // Silent -- never let analytics failures affect the user
  }
}
