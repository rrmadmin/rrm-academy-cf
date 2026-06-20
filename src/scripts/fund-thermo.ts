/**
 * Shared fundraiser thermometer logic.
 *
 * Spec: docs/superpowers/specs/2026-06-19-provider-directory-fundraiser-promotion-design.md (§3.1)
 *
 * Extracted from the inline IIFE that lived in src/pages/providers/index.astro so the
 * /providers/ page and src/components/CampaignCallout.astro share ONE fail-soft
 * implementation. Contract: on any response that is not { raised_cents: number },
 * leave the server-rendered $0 / 0% in place and never throw.
 */

export interface FundProgress {
  raised_cents: number;
  goal_cents?: number;
  count?: number;
  supporters?: number;
}

export interface ThermoView {
  raisedText: string;
  pct: number;
  raisedCents: number;
  met: boolean;
  supportersText: string | null;
}

export function fmtDollars(cents: number): string {
  return '$' + Math.round(cents / 100).toLocaleString();
}

/** Pure, DOM-free, never throws. Returns null when the payload is unusable or the goal is non-positive. */
export function computeThermo(data: unknown, fallbackGoalCents: number): ThermoView | null {
  const d = data as FundProgress | null;
  if (!d || typeof d.raised_cents !== 'number') return null;
  const goal = typeof d.goal_cents === 'number' && d.goal_cents > 0 ? d.goal_cents : fallbackGoalCents;
  if (!(goal > 0)) return null;
  const raisedCents = Math.max(0, d.raised_cents);
  const pct = Math.min(100, Math.round((raisedCents / goal) * 100));
  const met = raisedCents >= goal;
  const supporters = typeof d.supporters === 'number' ? d.supporters : null;
  const supportersText = supporters && supporters > 0
    ? (supporters === 1 ? '1 supporter so far' : `${supporters.toLocaleString()} supporters so far`)
    : null;
  return { raisedText: fmtDollars(raisedCents), pct, raisedCents, met, supportersText };
}

export interface ThermoEls {
  root: HTMLElement;
  fill: HTMLElement;
  raised: HTMLElement;
  supporters: HTMLElement;
}

/** Apply a computed view to the thermometer DOM. Sets data-state="met" when raised >= goal (spec §3.1 over-goal). */
export function applyThermo(els: ThermoEls, view: ThermoView): void {
  els.raised.textContent = view.raisedText;
  els.fill.style.width = view.pct + '%';
  els.root.setAttribute('aria-valuenow', String(view.raisedCents));
  els.root.setAttribute('data-state', view.met ? 'met' : 'active');
  if (view.supportersText) {
    els.supporters.textContent = view.supportersText;
    els.supporters.hidden = false;
  }
}

/** Live variant: fetch /api/fund-progress and apply. Never throws; leaves $0/0% on any error. */
export function initFundThermo(root: HTMLElement, fallbackGoalCents: number): void {
  if (typeof fetch === 'undefined') return;
  const fill = root.querySelector<HTMLElement>('.fund-thermo__fill');
  const raised = root.querySelector<HTMLElement>('.fund-thermo__raised');
  const supporters = root.querySelector<HTMLElement>('.fund-thermo__meta');
  if (!fill || !raised || !supporters) return;
  fetch('/api/fund-progress', { credentials: 'omit' })
    .then((r) => r.json())
    .then((data) => {
      const view = computeThermo(data, fallbackGoalCents);
      if (view) applyThermo({ root, fill, raised, supporters }, view);
    })
    .catch(() => { /* fail-soft: leave $0 / 0% rendered */ });
}
