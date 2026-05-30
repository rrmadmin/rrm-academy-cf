// src/lib/stuc-display-floors.ts
//
// Single source of truth for the STUC Action Areas hub "sparse-state" display
// floors (spec v3 §Sparse-state display gating; proof gate G-AREA-12).
//
// PRINCIPLE: lead with mission and invitation; reveal a number only when it
// flatters. With ~36 members and a handful of projects, raw counts advertise
// sparseness. These floors gate ONLY the public + member hub *display* — the
// /api/community/{areas,projects,impact} endpoints always compute and return the
// REAL counts (internal/admin views use them). The hub template (and any future
// admin view) decides whether to render. Floors are tunable; change here and the
// whole hub follows. Revisit when membership/projects materially grow.

/** Per-area project count is shown only at/above this many projects. Below: a "Get involved" CTA, no number. */
export const PROJECT_COUNT_FLOOR = 3;

/** "This month" impact strip renders only with at least this many curated entries in the current ET month. */
export const IMPACT_STRIP_FLOOR = 2;

/** Member counts are shown publicly only at/above this many members. */
export const MEMBER_COUNT_FLOOR = 100;

/** True when a per-area project count is healthy enough to display as "N projects". */
export function showProjectCount(count: number): boolean {
  return Number.isFinite(count) && count >= PROJECT_COUNT_FLOOR;
}

/** True when the current-month curated impact set is large enough to render the strip. */
export function showImpactStrip(entryCount: number): boolean {
  return Number.isFinite(entryCount) && entryCount >= IMPACT_STRIP_FLOOR;
}

/** True when the member count is large enough to surface publicly. */
export function showMemberCount(count: number): boolean {
  return Number.isFinite(count) && count >= MEMBER_COUNT_FLOOR;
}
