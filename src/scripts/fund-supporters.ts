// Shared client module for the provider-directory social-proof surface (SP2).
// ONE memoized GET of /api/fund-supporters so the stat cards, ticker, wall, and
// founding recognition do not each fire their own request. Always resolves to a
// valid, sanitized payload (never throws, never null) so every consumer renders.
//
// HARD CONTRACT: display_name is UNTRUSTED. Any consumer that builds HTML from
// these strings MUST run it through escapeHtml() (all five entities). In .astro
// use {expr} (auto-escaped); the OG badge uses a text node. Never innerHTML a
// raw displayName.

export interface Supporter {
  displayName: string;
  seq: number;
}

export interface SupportersPayload {
  ok: boolean;
  total_gifts: number;
  consented_count: number;
  recent: Supporter[];
  founding: Supporter[];
  founding_cap: number;
  founding_left: number;
  founding_closed: boolean;
  anonymous_founders: number;
}

export const EMPTY_SUPPORTERS: SupportersPayload = {
  ok: false,
  total_gifts: 0,
  consented_count: 0,
  recent: [],
  founding: [],
  founding_cap: 100,
  founding_left: 100,
  founding_closed: false,
  anonymous_founders: 0,
};

/** Escape all five HTML-significant entities. display_name is untrusted. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "Sarah M." -> "SM"; "Cher" -> "C"; empty -> "". Caps at 2 letters. */
export function initials(displayName: string): string {
  const tokens = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  const first = tokens[0][0] || '';
  const last = tokens.length > 1 ? (tokens[tokens.length - 1][0] || '') : '';
  return (first + last).toUpperCase();
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function coerceSupporters(arr: unknown): Supporter[] {
  if (!Array.isArray(arr)) return [];
  const out: Supporter[] = [];
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const dn = (r as Record<string, unknown>).displayName;
    if (typeof dn !== 'string' || !dn.trim()) continue;
    out.push({ displayName: dn, seq: num((r as Record<string, unknown>).seq) });
  }
  return out;
}

/** Coerce any response into a valid SupportersPayload (clamps, drops junk rows). */
export function sanitizeSupporters(d: unknown): SupportersPayload {
  if (!d || typeof d !== 'object') return { ...EMPTY_SUPPORTERS };
  const o = d as Record<string, unknown>;
  const cap = Math.max(1, Math.round(num(o.founding_cap, 100)));
  const total = Math.max(0, Math.round(num(o.total_gifts)));
  return {
    ok: o.ok === true,
    total_gifts: total,
    consented_count: Math.max(0, Math.round(num(o.consented_count))),
    recent: coerceSupporters(o.recent),
    founding: coerceSupporters(o.founding),
    founding_cap: cap,
    founding_left: Math.max(0, Math.round(num(o.founding_left, cap))),
    founding_closed: o.founding_closed === true,
    anonymous_founders: Math.max(0, Math.round(num(o.anonymous_founders))),
  };
}

let _cache: Promise<SupportersPayload> | null = null;

/** Memoized single fetch of the live endpoint. Fail-soft to EMPTY_SUPPORTERS. */
export function getSupporters(): Promise<SupportersPayload> {
  if (_cache) return _cache;
  _cache = fetch('/api/fund-supporters', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => sanitizeSupporters(d))
    .catch(() => ({ ...EMPTY_SUPPORTERS }));
  return _cache;
}
