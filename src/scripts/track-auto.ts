/**
 * Auto-instrumentation for client analytics.
 *
 * Imported once in BaseLayout.astro. Wires three universal listeners that
 * cover the bulk of behavior tracking without per-page boilerplate:
 *
 *   1. data-track-out  → outbound_click on any anchor with this attribute
 *   2. data-track-cta="id" → cta_click on any element with this attribute
 *   3. data-track-scroll-page on <body> → scroll_depth at 25/50/75/100%
 *
 * Pages that need richer instrumentation (search submissions, FAQ expands,
 * etc.) import track() directly and call it from their own handlers.
 *
 * Spec: docs/superpowers/specs/2026-05-15-client-analytics-spec.html §7
 *
 * Bundle budget: ≤ 3.5 KiB minified+gzipped (gate AG11).
 */

import { track, trackOutbound, trackPageView, startEngagementTracking } from './track';

// Maps every pre-existing freeform data-track-cta id to its data-cta
// replacement, for the one release both attributes coexist. Every id this
// plan renamed lives here so the legacy listener never sends a freeform id
// once the new attribute exists on the same element (in which case the
// data-cta branch above already wins and this map is never consulted for
// that element) -- this map matters only for any surviving element that
// still carries ONLY the legacy attribute. An id with NO entry here is
// dropped by the listener above, not sent as-is.
const LEGACY_CTA_RENAME_MAP: Record<string, string> = {
  'account-mobile-nav': 'nav-mobile.sidebar.account',
  'donate-mobile-nav': 'nav-mobile.sidebar.donate',
  'account-header': 'header.sticky.account',
  'donate-header': 'header.sticky.donate',
  'donate-footer': 'footer.footer-col-4.donate',
  'hero-start-learning': 'home.hero.learn',
  'hero-endo-survey': 'home.hero.survey-start',
  'hero-for-patients': 'home.inline.learn',
  'hero-for-clinicians': 'home.inline.providers',
  'hero-donate': 'home.inline.donate',
  '500-home': 'error.error.home',
  '500-retry': 'error.error.retry',
};

// Expose track() on the global window so `is:inline` scripts (Footer + Header
// theme toggles, etc.) can fire analytics events without importing the helper
// directly. Astro bundles regular `<script>` blocks but `<script is:inline>`
// runs from raw HTML and cannot import — the global bridge solves that.
// Wired here (not in track.ts) so the bridge is only present after the
// auto-instrumenter has loaded.
if (typeof window !== 'undefined') {
  // @ts-expect-error -- intentional global bridge for is:inline callers
  window.__rrmTrack__ = track;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const start = (): void => {
    // ── 0. Page view + session backbone ─────────────────────────────────
    // Fires page_view with a real per-visit ga_session_id so GA4 forms a
    // session (and derives session_start/first_visit); then tracks foreground
    // engagement for accurate engaged-session metrics.
    trackPageView();
    startEngagementTracking();

    // ── 1. Outbound clicks ──────────────────────────────────────────────
    // Capture-phase so we record before navigation strips the listener context.
    document.addEventListener(
      'click',
      (e: MouseEvent) => {
        const target = e.target as Element | null;
        if (!target) return;
        const a = (target.closest?.('a[data-track-out]') as HTMLAnchorElement | null);
        if (!a || !a.href) return;
        const label = a.getAttribute('data-track-label') || a.textContent?.trim().slice(0, 80) || '';
        trackOutbound('outbound_click', a.href, {
          page: location.pathname,
          ...(label ? { label } : {}),
        });
      },
      true,
    );

    // ── 2. CTA clicks ───────────────────────────────────────────────────
    // Bubble-phase: by the time it reaches document the value is final.
    //
    // Reads [data-cta] (the closed-vocabulary "<page>.<zone>.<intent>" id,
    // see docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md
    // §4) FIRST, and falls back to the legacy [data-track-cta] attribute for
    // one release through LEGACY_CTA_RENAME_MAP -- an element carrying BOTH
    // attributes fires exactly once, matching data-cta and never re-firing
    // on the legacy path. A legacy id with NO rename-table entry sends
    // nothing at all: it would fail _ga4.js's own id-shape screen anyway
    // (see below) and land as 'other' in the ledger for no reason, so there
    // is no value in beaconing it client-side either. LEGACY_CTA_RENAME_MAP
    // is deleted, along with this fallback branch and every remaining
    // data-track-cta attribute in the codebase, in the release after this
    // one ships.
    document.addEventListener(
      'click',
      (e: MouseEvent) => {
        const target = e.target as Element | null;
        if (!target) return;
        const cta = target.closest?.('[data-cta], [data-track-cta]') as HTMLElement | null;
        if (!cta) return;

        const newId = cta.getAttribute('data-cta');
        const legacyId = cta.getAttribute('data-track-cta');
        // newId wins when both are present -- this is what makes an element
        // carrying both attributes during the transition fire exactly once.
        // A legacy-only id with no map entry is dropped, not sent freeform.
        const id = newId || (legacyId ? LEGACY_CTA_RENAME_MAP[legacyId] : null);
        if (!id) return;

        const [page, zone, intent] = id.includes('.') ? id.split('.') : [];

        track('cta_click', {
          id,
          page: location.pathname,
          ...(zone ? { cta_zone: zone } : {}),
          ...(intent ? { cta_intent: intent } : {}),
        });
      },
      false,
    );

    // ── 3. Scroll depth ─────────────────────────────────────────────────
    // Fires once per threshold per page-view at 25/50/75/100%.
    // Throttled via rAF to avoid main-thread thrash on scroll.
    if (document.body && document.body.hasAttribute('data-track-scroll-page')) {
      const thresholds = [25, 50, 75, 100];
      const fired = new Set<number>();
      let scheduled = false;

      const check = (): void => {
        scheduled = false;
        const docHeight = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
        );
        const viewport = window.innerHeight || document.documentElement.clientHeight;
        const scrolled = window.scrollY || document.documentElement.scrollTop;
        // Use the FURTHEST point in viewport (scrolled + viewport) so 100%
        // fires when the bottom of the page is visible, not when scrolled
        // equals docHeight (which is impossible — that would be off-screen).
        const reach = scrolled + viewport;
        const pct = docHeight > 0 ? Math.round((reach / docHeight) * 100) : 0;
        for (const t of thresholds) {
          if (pct >= t && !fired.has(t)) {
            fired.add(t);
            track('scroll_depth', { depth: t, page: location.pathname });
          }
        }
      };

      const onScroll = (): void => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(check);
      };

      window.addEventListener('scroll', onScroll, { passive: true });
      // Fire once on load in case the page is short enough that 25%/50%/...
      // is already visible without any scroll.
      check();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
