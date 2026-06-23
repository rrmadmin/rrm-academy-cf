/**
 * First-party client analytics helper.
 *
 * Browsers fire beacons to /api/track (same-origin); the Worker validates
 * + forwards to GA4 Measurement Protocol and Cloudflare Analytics Engine.
 * No third-party scripts, no CSP exceptions, ad-blocker-resistant.
 *
 * Every beacon carries the GA4 client_id (cid) + ga_session_id (sid) + session
 * number (sn) from ga-session.ts, so the server relay opens REAL GA4 sessions.
 * page_view -> GA4 derives session_start/first_visit; user_engagement carries
 * measured foreground time so engaged-session metrics are accurate.
 *
 * Spec: docs/superpowers/specs/2026-05-15-client-analytics-spec.html
 *
 * Bundle budget: see gate AG11.
 */

import { resolveGaSession, touchGaSession, type GaSession } from './ga-session';

type TrackPrim = string | number | boolean;
export type TrackParams = Record<string, TrackPrim>;

const ENDPOINT = '/api/track';

// Debug mode: ?debug_track=1 logs every track() call to console for QA.
const DEBUG =
  typeof window !== 'undefined' &&
  typeof window.location !== 'undefined' &&
  window.location.search.includes('debug_track=1');

// Honor Do-Not-Track per spec §10.
const DNT_HONORED =
  typeof navigator !== 'undefined' &&
  (navigator.doNotTrack === '1' ||
    // @ts-expect-error -- IE/legacy globals
    window.doNotTrack === '1');

// Session/identity resolved once per page view (page_view rolls it forward).
let currentSession: GaSession | null = null;

/** Resolve (and possibly roll) the session for the current page view. */
function refreshSession(): GaSession {
  currentSession = resolveGaSession();
  return currentSession;
}

function ensureSession(): GaSession {
  return currentSession || refreshSession();
}

/**
 * Send an analytics event. Fire-and-forget — never throws, never blocks UX.
 * Attaches the GA4 client_id / session_id / session_number so the server relay
 * forwards them as Measurement Protocol overrides.
 *
 * @example
 *   track('cta_click', { id: 'donate-hero', page: '/' });
 *   track('scroll_depth', { depth: 75, page: location.pathname });
 */
export function track(event: string, params: TrackParams = {}): void {
  if (typeof navigator === 'undefined') return;
  if (DNT_HONORED) return;

  const s = ensureSession();
  touchGaSession();

  let payload: string;
  try {
    // sid is a number — JSON.stringify keeps it unquoted so GA4 receives an
    // integer ga_session_id (a string-typed session_id would not form a session).
    payload = JSON.stringify({ event, params, cid: s.cid, sid: s.sid, sn: s.sn });
  } catch {
    return; // params contained a circular ref or BigInt; drop silently
  }

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[track]', event, params, { cid: s.cid, sid: s.sid, sn: s.sn });
  }

  // sendBeacon is preferred: survives page-unload, no CORS preflight,
  // no response handling. Returns false if the browser refuses the queue
  // (rare, e.g., payload too large or Beacon disabled).
  try {
    const blob = new Blob([payload], { type: 'application/json' });
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;
  } catch {
    // sendBeacon threw — fall through to fetch keepalive.
  }

  // Fallback: keepalive fetch. `keepalive: true` lets the request outlive
  // the page unload event (same survival guarantee as sendBeacon, but with
  // a body byte cap of 64 KiB per spec — irrelevant for our payloads).
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      body: payload,
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
  } catch {
    // Even fetch construction threw; nothing to do. Analytics must never break the page.
  }
}

/**
 * Convenience wrapper for outbound link instrumentation. Auto-extracts the
 * host so the caller doesn't have to parse the URL.
 *
 * @example
 *   trackOutbound('outbound_click', 'https://doi.org/10.1234/foo', { label: 'DOI' });
 */
export function trackOutbound(
  event: string,
  href: string,
  extra: TrackParams = {}
): void {
  let host = '';
  try {
    host = new URL(href, typeof location !== 'undefined' ? location.href : 'https://rrmacademy.org/').hostname;
  } catch {
    /* opaque URL; ship without host */
  }
  track(event, { href, host, ...extra });
}

/**
 * Fire the GA4 page_view for this page load. Resolves (and may roll) the session
 * first, so GA4 opens a real session keyed on a fresh ga_session_id and derives
 * session_start / first_visit. Call once per full page load.
 */
export function trackPageView(): void {
  if (typeof navigator === 'undefined') return;
  if (DNT_HONORED) return;

  refreshSession();

  let pageLocation = '';
  try {
    pageLocation = location.href; // full URL incl. utm_* so GA4 attributes source/medium
  } catch {
    /* ignore */
  }
  const pageReferrer =
    (typeof document !== 'undefined' && document.referrer) || '';

  track('page_view', {
    page_location: pageLocation,
    page_referrer: pageReferrer,
    engagement_time_msec: 1, // real engagement is flushed by startEngagementTracking()
  });
}

/**
 * Measure real foreground engagement and flush a GA4 user_engagement event when
 * the page is hidden or unloaded. GA4 cannot derive engaged-session time from
 * page_view alone, so this restores accurate engaged-session + engagement-time
 * metrics. Call once per page load.
 */
export function startEngagementTracking(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (DNT_HONORED) return;

  let engagedMs = 0;
  let lastTick = Date.now();
  let visible = document.visibilityState === 'visible';

  const accrue = (): void => {
    const now = Date.now();
    if (visible) engagedMs += now - lastTick;
    lastTick = now;
  };

  const flush = (): void => {
    accrue();
    if (engagedMs < 1000) return; // ignore sub-second blips
    const ms = Math.min(Math.round(engagedMs), 1_800_000); // cap at 30 min
    engagedMs = 0;
    track('user_engagement', { engagement_time_msec: ms });
  };

  document.addEventListener('visibilitychange', () => {
    accrue();
    visible = document.visibilityState === 'visible';
    if (!visible) flush();
  });

  // pagehide is the reliable terminal signal (bfcache-safe); 'unload' is not.
  window.addEventListener('pagehide', flush);
}
