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
 *
 * Every attempted upload (success or failure) logs the gclid to Analytics
 * Engine via log() -- see _log.js -- so a stale-secret failure (e.g. a dead
 * OAuth client secret returning token_401) leaves a replayable audit row
 * instead of losing the click permanently. Success rows also carry the Data
 * Manager requestId for cross-referencing against Google's own ingest logs.
 *
 * Mail: every real upload attempt (success or failure) also sends an email
 * to administrator@rrmacademy.org via SES (see _ses.js), on top of the AE
 * logging above -- built after six real conversions were lost silently for
 * 18 days (07-29..08-12) when the deployed OAuth client secret went stale
 * and nobody noticed the AE rows. Mail is best-effort and capped via
 * checkRateLimit (12/hr success, 6/hr failure) PER CONVERSION ACTION -- the
 * budget is scoped per action, not shared across all 6 actions, because the
 * quiz-start actions fire on every ad landing-page load and would otherwise
 * exhaust a shared success budget in under an hour, silently suppressing the
 * alert for a rarer, higher-value conversion (found 2026-08-21, the morning
 * after the funnel split added the two quiz-start actions). It can never
 * throw back into the upload task, never change AE logging, and never
 * affects the caller's response. Missing SES secrets are a silent no-op,
 * same posture as missing Google Ads secrets above. Rate-limit dampening is
 * deliberately fail-OPEN here (opposite of checkRateLimit's normal
 * fail-closed default): a missing COMMUNITY_KV binding must not silently
 * swallow the alarm that exists to catch exactly this kind of outage. A
 * suppressed alert (real cap hit, KV present) still logs its own AE row so
 * suppression is never invisible.
 *
 * Retry: a transient network throw (fetch itself throwing/timing out, not an
 * HTTP error status) on either the token fetch or the ingest fetch gets ONE
 * retry of the whole upload, fresh token included, after a ~2s delay -- see
 * uploadConversionWithRetry(). HTTP-status failures (token_401, upload_4xx/
 * 5xx) are never retried: a 5xx from Google could double-record the click,
 * and the ingest is not idempotent on the wire. A retry attempt logs its own
 * 'conversion_retry' AE row before waiting; the final conversion_ok/
 * conversion_error row and the alert email fire only after the retry (or
 * lack of one) resolves, so neither logging contract nor alert timing change.
 */

import { log } from './_log.js';
import { sendEmail } from './_ses.js';
import { checkRateLimit } from './auth/_shared.js';
import { parseGclidCookie, GCLID_RE } from './_ga4-source.js';

const GOOGLE_ADS_CUSTOMER_ID = '4262268858';
const INGEST_ENDPOINT = 'https://datamanager.googleapis.com/v1/events:ingest';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Conversion actions of type UPLOAD_CLICKS in the Ad Grants account.
export const NEWSLETTER_CONVERSION_ACTION_ID = '7671519545';
// FABM quiz funnel (2026-08-21, mirrors the endo quiz funnel below): START is
// the primary action (drives Maximize Conversions bidding); the post-quiz
// email request is a secondary action (observed, not bid on) so completion
// depth per keyword stays visible.
export const QUIZ_CONVERSION_ACTION_ID = '7671519548'; // FABM Quiz Start (primary)
export const QUIZ_EMAIL_CONVERSION_ACTION_ID = '7729254901'; // secondary
export const QUIZ_RESULTS_CONVERSION_ACTION_ID = '7735340854'; // secondary
// Endo quiz funnel (2026-08-21): START is the primary action (drives Maximize
// Conversions bidding); PDF download and email request are secondary actions
// (observed, not bid on) so completion depth per keyword stays visible.
export const ENDO_QUIZ_CONVERSION_ACTION_ID = '7671519551'; // Endo Quiz Start (primary)
export const ENDO_QUIZ_PDF_CONVERSION_ACTION_ID = '7728951095'; // secondary
export const ENDO_QUIZ_EMAIL_CONVERSION_ACTION_ID = '7728951098'; // secondary
export const ENDO_QUIZ_RESULTS_CONVERSION_ACTION_ID = '7735340851'; // secondary

const ALERT_FROM = 'RRM Academy <alerts@mail.rrmacademy.org>';
const ALERT_TO = 'administrator@rrmacademy.org';

const CONVERSION_ACTION_NAMES = {
  [NEWSLETTER_CONVERSION_ACTION_ID]: 'Newsletter Signup',
  [QUIZ_CONVERSION_ACTION_ID]: 'FABM Quiz Start',
  [QUIZ_EMAIL_CONVERSION_ACTION_ID]: 'FABM Quiz Email Request',
  [QUIZ_RESULTS_CONVERSION_ACTION_ID]: 'FABM Quiz Results Reached',
  [ENDO_QUIZ_CONVERSION_ACTION_ID]: 'Endo Quiz Start',
  [ENDO_QUIZ_PDF_CONVERSION_ACTION_ID]: 'Endo Quiz PDF Download',
  [ENDO_QUIZ_EMAIL_CONVERSION_ACTION_ID]: 'Endo Quiz Email Request',
  [ENDO_QUIZ_RESULTS_CONVERSION_ACTION_ID]: 'Endo Quiz Results Reached',
};

function conversionActionName(conversionActionId) {
  return CONVERSION_ACTION_NAMES[conversionActionId] || conversionActionId;
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

  try {
    const data = await resp.json();
    return typeof data?.requestId === 'string' ? data.requestId : '';
  } catch {
    return '';
  }
}

// Transient network failures (fetch throwing, not an HTTP error status) get
// one retry of the WHOLE upload, fresh token fetch included. HTTP-status
// failures (token_401, upload_4xx/5xx) are never retried here -- a 5xx from
// Google could double-record, and this call is not idempotent on the wire.
const RETRYABLE_MESSAGE_PREFIXES = ['token_network:', 'upload_network:'];
const RETRY_DELAY_MS = 2000;

function isRetryableUploadError(err) {
  const message = err?.message;
  return typeof message === 'string' && RETRYABLE_MESSAGE_PREFIXES.some((prefix) => message.startsWith(prefix));
}

async function uploadConversionWithRetry(env, waitUntil, gclid, conversionActionId) {
  try {
    return await uploadConversion(env, gclid, conversionActionId);
  } catch (err) {
    if (!isRetryableUploadError(err)) throw err;
    log(env, waitUntil, 'google_ads', 'conversion_retry', 'warn', err.message, 0, 0, [gclid, conversionActionId]);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return uploadConversion(env, gclid, conversionActionId);
  }
}

/**
 * Fail-OPEN rate check for alert mail -- the inverse posture of
 * checkRateLimit's normal fail-closed default. A missing COMMUNITY_KV
 * binding must send the alert rather than swallow it: KV being down is
 * exactly the class of silent failure this alarm exists to catch. When KV
 * is bound and the cap is genuinely hit, the suppression itself is logged
 * to AE as its own action so it stays visible. Scoped per conversion action
 * (not just per kind) so a noisy action's cap can't crowd out the alert for
 * a rarer one sharing the same success/failure budget.
 */
async function alertAllowed(env, waitUntil, kind, conversionActionId, max, windowS) {
  if (!env.COMMUNITY_KV) return true;
  const allowed = await checkRateLimit(env, `google_ads_alert_${kind}_${conversionActionId}`, max, windowS);
  if (!allowed) {
    log(env, waitUntil, 'google_ads', 'conversion_alert_suppressed', 'warn', kind, 0, 0);
  }
  return allowed;
}

async function sendConversionSuccessEmail(env, waitUntil, conversionActionId, gclid, requestId) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    log(env, waitUntil, 'google_ads', 'conversion_alert_no_ses', 'warn', 'success', 0, 0);
    return;
  }
  try {
    if (!(await alertAllowed(env, waitUntil, 'success', conversionActionId, 12, 3600))) return;

    const name = conversionActionName(conversionActionId);
    const timestamp = formatEventTimestamp(new Date());
    const subject = `Ad Grants conversion recorded: ${name}`;
    const text = [
      'A Google Ads conversion was uploaded successfully.',
      '',
      `Conversion action: ${name} (${conversionActionId})`,
      `gclid: ${gclid}`,
      `Data Manager requestId: ${requestId || '(none returned)'}`,
      `Timestamp: ${timestamp}`,
      '',
      'Google usually reflects this in the Ads account within a few hours.',
    ].join('\n');
    const html = `
      <p>A Google Ads conversion was uploaded successfully.</p>
      <p>
        Conversion action: ${name} (${conversionActionId})<br>
        gclid: ${gclid}<br>
        Data Manager requestId: ${requestId || '(none returned)'}<br>
        Timestamp: ${timestamp}
      </p>
      <p>Google usually reflects this in the Ads account within a few hours.</p>
    `;

    await sendEmail(env, { from: ALERT_FROM, to: ALERT_TO, subject, text, html });
  } catch (err) {
    log(env, waitUntil, 'google_ads', 'conversion_alert_send_failed', 'error', err.message, 0, 0);
  }
}

async function sendConversionFailureEmail(env, waitUntil, conversionActionId, gclid, errorMessage) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    log(env, waitUntil, 'google_ads', 'conversion_alert_no_ses', 'warn', 'failure', 0, 0);
    return;
  }
  try {
    if (!(await alertAllowed(env, waitUntil, 'failure', conversionActionId, 6, 3600))) return;

    const name = conversionActionName(conversionActionId);
    const timestamp = formatEventTimestamp(new Date());
    const subject = 'Ad Grants conversion upload FAILED';
    const text = [
      'A Google Ads conversion upload failed.',
      '',
      `Conversion action: ${name} (${conversionActionId})`,
      `gclid: ${gclid}`,
      `Error: ${errorMessage}`,
      `Timestamp: ${timestamp}`,
      '',
      'This gclid can be replayed via the Data Manager API within the roughly 30-day click window. It is not lost yet, but it will be if nobody replays it before then.',
    ].join('\n');
    const html = `
      <p>A Google Ads conversion upload failed.</p>
      <p>
        Conversion action: ${name} (${conversionActionId})<br>
        gclid: ${gclid}<br>
        Error: ${errorMessage}<br>
        Timestamp: ${timestamp}
      </p>
      <p>This gclid can be replayed via the Data Manager API within the roughly 30-day click window. It is not lost yet, but it will be if nobody replays it before then.</p>
    `;

    await sendEmail(env, { from: ALERT_FROM, to: ALERT_TO, subject, text, html });
  } catch (err) {
    log(env, waitUntil, 'google_ads', 'conversion_alert_send_failed', 'error', err.message, 0, 0);
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

    const task = uploadConversionWithRetry(env, waitUntil, gclid, conversionActionId).then(async (requestId) => {
      log(env, waitUntil, 'google_ads', 'conversion_ok', 'ok', conversionActionId, 0, 200, [gclid, requestId]);
      await sendConversionSuccessEmail(env, waitUntil, conversionActionId, gclid, requestId);
    }).catch(async (err) => {
      log(env, waitUntil, 'google_ads', 'conversion_error', 'error', err.message, 0, 502, [gclid, conversionActionId]);
      await sendConversionFailureEmail(env, waitUntil, conversionActionId, gclid, err.message);
    });

    if (typeof waitUntil === 'function') {
      waitUntil(task);
    }
  } catch (err) {
    log(env, waitUntil, 'google_ads', 'conversion_error', 'error', err.message, 0, 500);
  }
}
