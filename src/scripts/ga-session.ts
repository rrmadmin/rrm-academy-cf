/**
 * First-party GA4 session + client identity for the analytics beacon.
 *
 * Mints and persists a GA4 client_id (cross-session, localStorage) and a
 * ga_session_id (per visit, epoch seconds, 30-minute idle timeout). The beacon
 * (track.ts) sends these on every hit so the server relay can open REAL GA4
 * sessions: GA4 derives session_start from a new session_id, first_visit from a
 * new client_id, and user_engagement from engagement_time_msec. No gtag, no
 * cookies, no third-party script.
 *
 * Spec: docs/superpowers/specs/2026-05-15-client-analytics-spec.html
 */

const CID_KEY = 'rrm_ga_cid';
const SES_KEY = 'rrm_ga_ses';
const TIMEOUT_MS = 30 * 60 * 1000; // GA4 default session timeout
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GaSession {
  /** GA4 client_id (UUID v4), persistent across sessions. */
  cid: string;
  /** GA4 ga_session_id: epoch SECONDS at session start. */
  sid: number;
  /** Session number: increments each new session. */
  sn: number;
}

function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  // RFC4122-ish fallback for browsers without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode / storage disabled — identity becomes per-pageview, still valid */
  }
}

/**
 * Resolve (and refresh) the client_id + session for THIS page view. Call once
 * per page load, before firing page_view. Rolls a new session_id when the prior
 * session has been idle longer than the 30-minute timeout.
 */
export function resolveGaSession(now: number = Date.now()): GaSession {
  // Persistent client_id.
  let cid = lsGet(CID_KEY);
  if (!cid || !UUID_RE.test(cid)) {
    cid = uuid();
    lsSet(CID_KEY, cid);
  }

  // Session: { sid, sn, last }.
  let sid = 0;
  let sn = 0;
  let last = 0;
  const raw = lsGet(SES_KEY);
  if (raw) {
    try {
      const o = JSON.parse(raw) as { sid?: number; sn?: number; last?: number };
      sid = Number(o.sid) || 0;
      sn = Number(o.sn) || 0;
      last = Number(o.last) || 0;
    } catch {
      /* corrupt — treat as no session */
    }
  }

  if (!sid || now - last > TIMEOUT_MS) {
    sid = Math.floor(now / 1000); // epoch seconds = a fresh ga_session_id
    sn = sn + 1;
  }
  lsSet(SES_KEY, JSON.stringify({ sid, sn, last: now }));

  return { cid, sid, sn };
}

/** Slide the session's last-activity timestamp forward (call on every hit). */
export function touchGaSession(now: number = Date.now()): void {
  const raw = lsGet(SES_KEY);
  if (!raw) return;
  try {
    const o = JSON.parse(raw) as { sid: number; sn: number; last: number };
    o.last = now;
    lsSet(SES_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}
