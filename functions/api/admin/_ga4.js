/**
 * Shared GA4 Data API helpers.
 * Prefixed with _ so CF Pages doesn't treat this as a route handler.
 */

const GA4_DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export async function getAccessToken(env) {
  const creds = JSON.parse(env.GA4_OAUTH_CREDS);
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Token refresh failed: ${resp.status} ${err}`);
  }
  const data = await resp.json();
  return data.access_token;
}

export async function runReport(accessToken, propertyId, body) {
  const resp = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': 'rrm-academy',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GA4 report failed: ${resp.status} ${err}`);
  }
  return resp.json();
}
