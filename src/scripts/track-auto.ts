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

import { track, trackOutbound } from './track';

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const start = (): void => {
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
    document.addEventListener(
      'click',
      (e: MouseEvent) => {
        const target = e.target as Element | null;
        if (!target) return;
        const cta = target.closest?.('[data-track-cta]') as HTMLElement | null;
        if (!cta) return;
        const id = cta.getAttribute('data-track-cta');
        if (!id) return;
        const position = cta.getAttribute('data-track-position') || undefined;
        const value = cta.getAttribute('data-track-value');
        const numericValue = value != null && value !== '' ? Number(value) : NaN;
        track('cta_click', {
          id,
          page: location.pathname,
          ...(position ? { position } : {}),
          ...(Number.isFinite(numericValue) ? { value: numericValue } : {}),
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
