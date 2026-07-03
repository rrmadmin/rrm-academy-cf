/**
 * Google Ads offline conversion upload (Enhanced Conversions for Leads style
 * click_conversions:upload via ConversionUploadService). No gtag.js, no
 * client-side third-party script -- server-to-server only, gclid-driven.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 *
 * Usage: fire-and-forget after a successful conversion action:
 *   sendGoogleAdsConversion(env, waitUntil, request.headers.get('Cookie') || '', NEWSLETTER_CONVERSION_ACTION_ID);
 *
 * Requires CF Pages secrets: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
 * GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_DEVELOPER_TOKEN. Missing any of these
 * is treated as "not configured yet" -- a silent no-op, not an error, since
 * this augments an already-successful user-facing response.
 */

import { log } from './_log.js';

const GOOGLE_ADS_API_VERSION = 'v21';
const GOOGLE_ADS_CUSTOMER_ID = '4262268858';
const GOOGLE_ADS_LOGIN_CUSTOMER_ID = '9177404425';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export const NEWSLETTER_CONVERSION_ACTION_ID = '7671737988';
export const QUIZ_CONVERSION_ACTION_ID = '7671737991';
export const ENDO_QUIZ_CONVERSION_ACTION_ID = '7671879303';

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

// Google Ads API requires "yyyy-MM-dd HH:mm:ss+00:00" (UTC).
function formatConversionTime(date) {
  const iso = date.toISOString();
  const [datePart, timePart] = iso.split('T');
  const time = timePart.split('.')[0];
  return `${datePart} ${time}+00:00`;
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
    resp = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${GOOGLE_ADS_CUSTOMER_ID}:uploadClickConversions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
          'login-customer-id': GOOGLE_ADS_LOGIN_CUSTOMER_ID,
        },
        body: JSON.stringify({
          conversions: [{
            gclid,
            conversionAction: `customers/${GOOGLE_ADS_CUSTOMER_ID}/conversionActions/${conversionActionId}`,
            conversionDateTime: formatConversionTime(new Date()),
          }],
          partialFailure: true,
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
  } catch (err) {
    throw new Error(`upload_network:${err.message}`, { cause: err });
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    throw new Error(`upload_${resp.status}:${bodyText.slice(0, 150)}`);
  }

  const result = await resp.json().catch(() => null);
  if (result?.partialFailureError) {
    throw new Error(`partial_failure:${JSON.stringify(result.partialFailureError).slice(0, 150)}`);
  }
}

/**
 * Fire-and-forget Google Ads conversion upload. Never throws -- a failed or
 * unconfigured upload must never affect the caller's user-facing response.
 * No-op if the gclid cookie is absent (no synthetic conversions).
 */
export function sendGoogleAdsConversion(env, waitUntil, cookieHeader, conversionActionId) {
  try {
    if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN || !env.GOOGLE_ADS_DEVELOPER_TOKEN) {
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
