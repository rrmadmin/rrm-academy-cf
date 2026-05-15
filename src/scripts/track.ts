/**
 * First-party client analytics helper.
 *
 * Browsers fire beacons to /api/track (same-origin); the Worker validates
 * + forwards to GA4 Measurement Protocol and Cloudflare Analytics Engine.
 * No third-party scripts, no CSP exceptions, ad-blocker-resistant.
 *
 * Spec: docs/superpowers/specs/2026-05-15-client-analytics-spec.html
 *
 * Bundle budget: ≤ 2 KiB minified+gzipped (gate AG11).
 */

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

/**
 * Send an analytics event. Fire-and-forget — never throws, never blocks UX.
 *
 * @example
 *   track('cta_click', { id: 'donate-hero', page: '/' });
 *   track('scroll_depth', { depth: 75, page: location.pathname });
 */
export function track(event: string, params: TrackParams = {}): void {
  if (typeof navigator === 'undefined') return;
  if (DNT_HONORED) return;

  let payload: string;
  try {
    payload = JSON.stringify({ event, params });
  } catch {
    return; // params contained a circular ref or BigInt; drop silently
  }

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[track]', event, params);
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
