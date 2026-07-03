/**
 * Google Ads offline conversion upload via the Data Manager API
 * (datamanager.googleapis.com events:ingest). No gtag.js, no client-side
 * third-party script -- server-to-server only, gclid-driven.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 *
 * Why Data Manager and not the Google Ads API's uploadClickConversions:
 * that service is closed to new integrations (CUSTOMER_NOT_ALLOWLISTED_FOR_
 * THIS_FEATURE, verified live 2026-07-03); Google requires new offline click
 * uploads to go through Data Manager. The OAuth refresh token carries both
 * the adwords and datamanager scopes. The target conversion actions are type
 * UPLOAD_CLICKS (gclid uploads are rejected for WEBPAGE-type actions).
 * No login-customer-id equivalent is sent: the OAuth user has DIRECT access
 * to the grant account, which is NOT linked under the manager (917-740-4425);
 * routing through the manager returns 403 USER_PERMISSION_DENIED.
 *
 * Usage: fire-and-forget after a successful conversion action:
 *   sendGoogleAdsConversion(env, waitUntil, request.headers.get('Cookie') || '', NEWSLETTER_CONVERSION_ACTION_ID);
 *
 * Requires CF Pages secrets: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
 * GOOGLE_ADS_REFRESH_TOKEN. Missing any of these is treated as "not
 * configured yet" -- a silent no-op, not an error, since this augments an
 * already-successful user-facing response.
 */

import { log } from './_log.js';

const GOOGLE_ADS_CUSTOMER_ID = '4262268858';
const INGEST_ENDPOINT = 'https://datamanager.googleapis.com/v1/events:ingest';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Conversion actions of type UPLOAD_CLICKS in the Ad Grants account.
export const NEWSLETTER_CONVERSION_ACTION_ID = '7671519545';
export const QUIZ_CONVERSION_ACTION_ID = '7671519548';
export const ENDO_QUIZ_CONVERSION_ACTION_ID = '7671519551';

// gclid values are opaque alphanumeric-ish tokens Google generates; this is a
// sanity bound, not a real format spec.
const GCLID_RE = /^[A-Za-z0-9_-]{10,512}$/;

function parseGclidCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)gclid=([^;]*)/);
  if (!match) return null;
  let value;
  try {
    value = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!GCLID_RE.test(value)) return null;
  return value;
}

// Data Manager wants RFC 3339; strip fractional seconds for the exact shape
// verified against the live endpoint ("2026-07-03T18:00:00Z").
function formatEventTimestamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function getAccessToken(env) {
  let resp;
  try {
    resp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_ADS_CLIENT_ID,
        client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new Error(`token_network:${err.message}`, { cause: err });
  }
  if (!resp.ok) {
    throw new Error(`token_${resp.status}`);
  }
  const data = await resp.json();
  if (!data?.access_token) {
    throw new Error('token_missing');
  }
  return data.access_token;
}

async function uploadConversion(env, gclid, conversionActionId) {
  const accessToken = await getAccessToken(env);

  let resp;
  try {
    resp = await fetch(INGEST_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        destinations: [{
          operatingAccount: { accountType: 'GOOGLE_ADS', accountId: GOOGLE_ADS_CUSTOMER_ID },
          productDestinationId: conversionActionId,
        }],
        events: [{
          adIdentifiers: { gclid },
          eventTimestamp: formatEventTimestamp(new Date()),
          conversionValue: 1.0,
          currency: 'USD',
          eventSource: 'WEB',
        }],
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new Error(`upload_network:${err.message}`, { cause: err });
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    throw new Error(`upload_${resp.status}:${bodyText.slice(0, 150)}`);
  }
}

/**
 * Fire-and-forget Google Ads conversion upload. Never throws -- a failed or
 * unconfigured upload must never affect the caller's user-facing response.
 * No-op if the gclid cookie is absent (no synthetic conversions).
 */
export function sendGoogleAdsConversion(env, waitUntil, cookieHeader, conversionActionId) {
  try {
    if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
      return;
    }
    const gclid = parseGclidCookie(cookieHeader);
    if (!gclid) return;

    const task = uploadConversion(env, gclid, conversionActionId).catch((err) => {
      log(env, waitUntil, 'google_ads', 'conversion_error', 'error', err.message, 0, 502);
    });

    if (typeof waitUntil === 'function') {
      waitUntil(task);
    }
  } catch (err) {
    log(env, waitUntil, 'google_ads', 'conversion_error', 'error', err.message, 0, 500);
  }
}
