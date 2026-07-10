# Client Analytics -- Design Spec

Date: 2026-05-15
Status: SHIPPED 2026-05-19; Amended 2026-07-09

## 2026-07-09 amendments

Source: the GA4 audit at `~/iCode/.wip/ga4-audit-and-conversion-plan-2026-07-09.md` (GA4 property `526304690`). Corrections applied to this spec:

- The Phase 3 assumption that server-side MP `page_view` "counts hold" after Zaraz removal is FALSIFIED (see the annotations in Current State Audit and Migration/Rollout below). Zaraz removal on 2026-05-19 zeroed collection; a first-party thin beacon (`src/scripts/track.ts` + `track-auto.ts` -> `POST /api/track` -> MP relay `functions/api/_ga4.js`) restored `page_view` on 2026-06-23.
- New section: "Hard MP limits (permanent constraints of the no-gtag architecture)".
- New section: "Synthetic and internal traffic policy" (production canary exclusion; the canary fabricated ~2,750 of 2,758 `begin_checkout` events in 30 days and left ~91 open Stripe sessions/day before the 2026-07-09 fix).
- `eventDataRetention` was TWO_MONTHS; set to 14 months 2026-07-09.
- Key events pruned from 8 to 3: `purchase`, `sign_up`, `generate_lead` (`ads_conversion_About_Us_1` deleted; `begin_checkout` / `copy_citation` / `video_complete` / `pdf_download` unmarked; `begin_checkout` to be re-marked after 7 clean days).
- User-scoped custom dims `user_role` / `audience_type` / `cohort_date` / `engagement_tier` were registered 2026-05-15 but no code sent `user_properties`; `user_role` is now stamped centrally in `_ga4.js` for `sign_up` / `signup_from_ask` / `purchase`.
- `internal_click` removed from the client allowlist (zero call sites); see the allowlist annotation below.
- New decision record: beacon-only (Option D) RECOMMENDED, PENDING Brian's ratification.
- Cross-ref: KPI scoreboard cadence is owned by `rrm-academy-internal/plans/2026-06-26-12-month-seo-master-plan.md`, not this spec.
- The system-of-record map for every measurement question now lives at `docs/measurement-ssot.md`.

## Goal

Get rich behavior + conversion tracking in GA4 *without* loading any third-party scripts in the browser, *without* widening CSP, and *without* the 588 KiB Zaraz/GTM payload at `/analytics/`. Replace the current half-broken hybrid (server-side MP for conversions + Zaraz GTM for the rest) with a single coherent pipeline.

## Current State Audit (2026-05-15)

### Server-side via Measurement Protocol ~~(works, keep as-is)~~

> **FALSIFIED 2026-06-22:** the middleware MP `page_view` did NOT hold after the 2026-05-19 Zaraz removal; collection zeroed. The thin-beacon fix (`src/scripts/track.ts` + `track-auto.ts` -> `POST /api/track` -> `functions/api/_ga4.js`) restored `page_view` on 2026-06-23. Original 2026-05-15 text preserved below unchanged.

| Where | Event | Params |
|---|---|---|
| `functions/_middleware.js` | `page_view` | url, referrer, geo, UTM (from cookie/Referer) |
| `functions/api/auth/signup.js` | `sign_up` | method=email, source |
| `functions/api/auth/signup.js` | `signup_from_ask` | source=ask |
| `functions/api/auth/google-callback.js` | `sign_up` | method=google |
| `functions/api/newsletter/subscribe.js` | `generate_lead` | lead_source=newsletter |
| `functions/api/survey/request.js` | `generate_lead` | lead_source=endo_survey_request |
| `functions/api/survey/submit.js` | `generate_lead` | lead_source=endo_survey |
| `functions/api/courses/waitlist.js` | `generate_lead` | course |
| `functions/api/courses/enroll.js` | `generate_lead` | course (free enrollment) |
| `functions/api/courses/enroll.js` | `begin_checkout` | course (paid enrollment) |
| `functions/api/create-checkout.js` | `begin_checkout` x2 | donation, subscription |
| `functions/api/billing/_webhook-checkout.js` | `purchase` x3 | donation, course, sub |

**Coverage:** every conversion that happens server-side (signup, lead, checkout start, purchase) is wired through `sendGA4Event()`. Solid foundation.

### Cloudflare Analytics Engine (separate dataset)

`functions/api/survey/event.js` writes to `env.ANALYTICS.writeDataPoint()` (dataset `worker_events`) for endo-survey UI actions: `calculate`, `download_pdf`, `copy_for_ai`, `follow_instagram`. Allowlist enforced, rate-limited at 60/min/IP. **This is the precedent shape we extend in §3 below** -- same beacon pattern, but the new endpoint will also relay to GA4 (not just AE) so events show up in the GA4 dashboard Brian already uses.

### Zaraz GTM (currently injecting noise, removing)

- `/analytics/` returns 587 KiB of GTM container code (GA4 measurement ID `G-TSWRY7XLR0`, same as middleware)
- Fires duplicate page_views (Zaraz client + middleware MP both fire = double-counted in GA4 unless GA4 dedupes by session_id+timestamp, which it doesn't reliably for page_view)
- Inside the proxied bundle, GTM tags try to direct-connect to `analytics.google.com`, `stats.g.doubleclick.net`, and `googletagmanager.com` -- all CSP-blocked, all logged as console errors hurting Best Practices score
- 3 CSP violations on every page load
- 187 KiB unused JS on PSI's "Reduce unused JavaScript" audit

### On-page behavior (currently zero)

Not tracked today:
- Scroll depth
- CTA / button clicks (donate, signup, course enroll, library article reads)
- Search submissions + result clicks
- Outbound link clicks (NaPro provider directory, external journal DOIs)
- Video plays (CF Stream lessons)
- Time-on-page / dwell
- FAQ expansions
- Library filter changes
- Glossary term lookups

These are the gaps Brian's looking to close.

## Architecture

```
┌─────────────────────────────────┐
│ Page HTML                       │
│  <script type="module">         │
│    import {track} from          │
│      '/src/scripts/track.ts'    │  ← 0-dep, ~1 KiB minified
│    track('cta_click',{id:'x'})  │
│  </script>                      │
└──────────────┬──────────────────┘
               │
               │ navigator.sendBeacon('/api/track', {event, params})
               ▼
┌─────────────────────────────────┐
│ functions/api/track.js          │
│  • Rate-limited (60/min/IP)     │
│  • Event-name allowlist         │
│  • Param sanitization           │
│  • Fire-and-forget GA4 MP       │
│  • Mirror to AE for AE queries  │
└──────────────┬──────────────────┘
               │
               ├──→ GA4 (via existing sendGA4Event)
               │
               └──→ CF Analytics Engine (worker_events dataset)
```

### Why both GA4 and Analytics Engine?

- **GA4** is what Brian already opens; engagement reports, funnel analysis, retention -- familiar tooling
- **Analytics Engine** is queryable from `/api/admin/seo` and the SEO monitor worker (5-min granularity, free up to 10M rows/day). Gives us *raw* event log without GA4's sampling. Already in use for survey events. Tiny incremental cost.

Mirroring is a 5-line addition; not having AE means we'd lose visibility once GA4 dashboards aggregate.

### Why not just gtag()?

| Concern | gtag (client) | /api/track (server-side relay) |
|---|---|---|
| Third-party script | 350 KiB GA4 library | 0 KiB (helper is ~1 KiB) |
| CSP changes | yes (google.com, doubleclick) | none |
| Ad-blocker bypass | blocked by uBlock/Brave | not blocked (own origin) |
| Privacy / first-party data | data goes direct to Google | data flows through our origin first |
| Event attribution | client headers/cookie | server-side (cookies, CF geo, server time) |
| Cookie consent friction | needs banner in some regions | first-party only, lower bar |
| Page weight | +350 KiB JS | +1 KiB JS |

Server-side relay wins on every axis except "convenience of pasting GA snippet" -- which we don't need because the surface is already built.

## /api/track Endpoint Design

**File:** `functions/api/track.js`

**Methods:** `POST` (event submission), `OPTIONS` (CORS preflight)

**Auth:** none required (anonymous behavior tracking is by design)

**Rate limit:** 60 events / minute / IP via `checkRateLimit()`. Same limit as `survey/event.js`. Lower than the cost of writing to AE+GA4 per request.

**Request shape (validated):**
```json
{
  "event": "cta_click",          // string, allowlist (see §6), max 40 chars
  "params": {                     // object, max 25 keys, max 100 chars per value
    "id": "donate-hero",
    "page": "/",
    "value": 100                  // optional numeric (for value-bearing events)
  }
}
```

**Response:** `204 No Content` on accept, `400` invalid shape, `429` rate-limited, `503` if GA4 env vars missing.

**Validation rules:**
- `event` must match `^[a-z][a-z0-9_]{0,39}$` AND appear in the allowlist
- `params` must be a plain object with 1-25 keys
- Each param key matches `^[a-z][a-z0-9_]{0,39}$`
- Each param value is string (max 100 chars), number (finite, in [-1e9, 1e9]), or boolean. Arrays/objects rejected.
- Reserved param names ignored (page_location, page_referrer, engagement_time_msec -- those come from server)

**Side effects on accept (both fire-and-forget via waitUntil):**
1. `sendGA4Event(env, request, body.event, body.params)` -- relays to GA4 with server-derived session_id, source, medium
2. `env.ANALYTICS.writeDataPoint({ blobs: [...], doubles: [...], indexes: [event] })` -- mirrors to AE for raw queries

**Failure modes:**
- GA4 5xx / network error: silent (caught in `_ga4.js`), AE still gets the event
- AE not bound: silent, GA4 still gets the event
- Both fail: still return 204 (analytics failures must never block UX)

**Security gate (added to `scripts/guard.mjs` manifest):** the file gets hashed alongside other Phase 4/5 endpoints. Rate-limit must be present. Allowlist must be present.

## Client Helper

**File:** `src/scripts/track.ts`

```ts
type TrackParams = Record<string, string | number | boolean>;

const ENDPOINT = '/api/track';
const DEBUG = (typeof window !== 'undefined') && window.location.search.includes('debug_track=1');

export function track(event: string, params: TrackParams = {}): void {
  if (typeof navigator === 'undefined') return;
  const payload = JSON.stringify({ event, params });

  if (DEBUG) console.log('[track]', event, params);

  // sendBeacon preferred: survives page unload, no CORS preflight, fire-and-forget.
  // Falls back to keepalive fetch for browsers without sendBeacon (none in current
  // matrix, but the cost is one if-check).
  const blob = new Blob([payload], { type: 'application/json' });
  if (navigator.sendBeacon?.(ENDPOINT, blob)) return;

  fetch(ENDPOINT, { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
}

// Convenience wrapper for outbound link instrumentation. Auto-extracts hostname.
export function trackOutbound(event: string, href: string, extra: TrackParams = {}): void {
  let host = '';
  try { host = new URL(href, location.href).hostname; } catch {}
  track(event, { href, host, ...extra });
}
```

**Bundle treatment:** Astro bundles `src/scripts/track.ts` once when imported by any `<script>` block; CF Pages caches the hashed `/_astro/track.*.js` for 1 year. Pages that don't import it pay zero bytes.

**Import pattern:** pages opt in via `<script>` block:
```astro
<script>
  import { track } from '../scripts/track.ts';
  document.getElementById('donate-cta')?.addEventListener('click', () => {
    track('cta_click', { id: 'donate-hero', page: location.pathname });
  });
</script>
```

For widely-reused events (scroll depth, outbound links), a thin `src/scripts/track-auto.ts` module is imported once in `BaseLayout.astro`, auto-instrumenting anything with a `data-track-*` attribute. See §6.

## Event Allowlist + Schema

Single source of truth: `functions/api/_track-events.js`. Exported `ALLOWED_EVENTS` Set + per-event `REQUIRED_PARAMS` map.

### Behavior events (new)

| Event | Required params | Optional | Notes |
|---|---|---|---|
| `cta_click` | `id`, `page` | `position`, `value` | Hero buttons, sticky CTAs, in-content donate prompts |
| `outbound_click` | `href`, `host` | `label`, `page` | External links (NaPro directory, journal DOIs, social) |
| ~~`internal_click`~~ | `href`, `page` | `position`, `label` | Important internal nav (article-to-glossary, FAQ-to-pillar). **REMOVED 2026-07-09** from the client allowlist: never fired, zero call sites |
| `scroll_depth` | `depth`, `page` | -- | Fires at 25/50/75/100%, throttled (one per depth per page-view) |
| `search_submit` | `query_length`, `surface` | `results_count`, `filter` | Pagefind submission. Query *length*, NOT query (PII) |
| `search_result_click` | `surface`, `result_type`, `rank` | `query_length` | Click within results dropdown |
| `faq_expand` | `slug` | `position` | FAQ accordion open |
| `glossary_lookup` | `term` | `from_page` | Glossary entry view from a non-glossary page |
| `video_play` | `course`, `step` | `position_pct` | CF Stream lesson play |
| `video_complete` | `course`, `step` | -- | Lesson completion |
| `share_click` | `surface`, `network` | `slug` | Article/commentary share buttons |
| `theme_toggle` | `to` | -- | light/dark/eink |
| `pdf_download` | `slug`, `source` | -- | Guide PDF, library article reprint |
| `copy_citation` | `surface`, `format` | `slug` | Library citation copy |

> **Allowlist status (2026-07-09):** `internal_click` REMOVED (never fired; zero call sites). `glossary_lookup` and `pdf_download` are wired but near-zero-traffic; `pdf_download` has been live on one page since 2026-07-03.

### Conversion events (existing server-side, do NOT duplicate client-side)

`sign_up`, `signup_from_ask`, `generate_lead`, `begin_checkout`, `purchase`, `page_view` -- all fire from server. Client helper rejects these via allowlist split (`ALLOWED_CLIENT_EVENTS` is a subset of `ALLOWED_EVENTS`).

### Engagement parameters (auto-added server-side)

Every event gets:
- `engagement_time_msec: 1` (GA4 requires for session counting)
- `session_id`, `utm_source`, `utm_medium` (derived in `buildSourceParams`)
- `page_location` from `request.url` if not provided

## Starter Events to Instrument (Phase 1)

This is the minimum that pays back the effort. Brian can extend afterward.

| Surface | Event | Trigger |
|---|---|---|
| Homepage hero CTA | `cta_click` | Click on `Browse all N articles`, `Glossary`, `FAQs` links |
| Homepage donate button | `cta_click` | Header donate, footer donate, in-page donate prompts |
| `/library/[slug]` | `scroll_depth` | 25/50/75/100% |
| `/library/[slug]` | `outbound_click` | DOI / journal links |
| `/library/[slug]` | `copy_citation` | Citation copy button |
| `/commentary/[slug]` | `scroll_depth` | 25/50/75/100% |
| `/glossary/[slug]` | `glossary_lookup` | Page load (fires once) |
| Pillar pages (6) | `scroll_depth` + `internal_click` | TOC navigation |
| `/faqs/` + `/faqs/[slug]` | `faq_expand` | Accordion open |
| Search (SearchBar + MobileSearchModal) | `search_submit` + `search_result_click` | Existing handlers already debounce + emit beacon to AE; add GA4 mirror |
| Course lesson player | `video_play`, `video_complete` | Stream.js callbacks |
| Theme toggle (footer + header) | `theme_toggle` | Existing click handler |
| Outbound to NaPro providers | `outbound_click` | Provider directory + pillar CTA links |

**Auto-instrumentation via `data-track-*`:** add to `track-auto.ts` (loaded once in BaseLayout):
- Any `<a data-track-out>` → `outbound_click` on click
- Any `<button data-track-cta="id">` → `cta_click` on click
- Any element with `data-track-scroll-page` on `<body>` → enable scroll-depth on that page

This way new events become a 1-attribute change, not a 5-line script block per page.

## Zaraz Removal Plan

1. **Inventory Zaraz config first.** Brian (or me with a CF API token) opens dashboard `Zaraz → Tools`. Note every tool + every trigger. Most likely: only `Google Analytics 4` is configured with the measurement ID, but there may be Cloudflare-internal tools (Loading config, Speed Insights) we want to keep.
2. **Disable the GA4 tool** (don't delete yet -- can re-enable in 1 click if migration regresses).
3. **Verify `/analytics/` 404s** (or returns minimal stub if Cloudflare keeps the path live for other Zaraz uses).
4. **Confirm in GA4 Realtime:** page_views still flow (these come from middleware MP, not Zaraz), new behavior events from `/api/track` start arriving.
5. **After 7-day soak**, delete the GA4 tool entirely from Zaraz.
6. **If Zaraz has no other tools enabled, disable Zaraz on the zone**. Cuts the `/analytics/` route and the Zaraz client loader entirely.

**Rollback:** re-enable the GA4 tool in Zaraz. Takes 60 seconds. Both pipelines can co-exist during transition (GA4 dedupes on identical event_name + session_id within tight time window, page_views will double for a moment).

## CSP Cleanup

Current connect-src: `'self' https://challenges.cloudflare.com https://cloudflareinsights.com`

**No CSP changes needed** for `/api/track` -- it's same-origin (`'self'` covers it).

After Zaraz removal:
- Remove `https://cloudflareinsights.com` from `connect-src` if CF Web Analytics is also being dropped (separate decision -- see Open Questions).
- The CSP violations from PSI all stem from the Zaraz GTM container's outbound calls. Once that's gone, console errors clear.

## Privacy & Compliance

- **No PII in event params.** Allowlist enforces no `email`, `name`, `user_id` as param keys. Query *strings* are never sent -- only `query_length`. The endpoint strips any param key matching `/email|user|name|password|token|cookie|address|phone|ssn/i` defensively before forwarding.
- **Client ID is anonymous hash of IP+UA** (existing `getClientId` in `_ga4-source.js`). No cookies set by `/api/track` itself.
- **Do-Not-Track honored.** Client helper checks `navigator.doNotTrack === '1'` and no-ops.
- **EU consent:** since data flow is first-party and no third-party scripts run, the ePrivacy bar is lower than gtag. We document this in `/privacy-policy/` (separate copy update).

## Sampling & Cost

GA4 free tier: 10M events/month. CF Analytics Engine: 10M write_data_points/month free.

At current ~10k unique visitors/month and ~10 events/visit, we're at ~100k events/month -- 1% of either ceiling. No sampling needed.

If traffic grows 100x, add client-side sampling in `track.ts`: `if (Math.random() > 0.5) return;` gated by a config flag. Conversion events stay 100% (already server-side).

## Testing

1. **Unit:** none for the endpoint -- the logic is a thin shell over `sendGA4Event` (already covered) + `writeDataPoint` (CF binding, mocked in `test/_helpers.js`).
2. **Integration smoke test:** `test/track-endpoint.test.js`
   - POST valid event → 204 + `sendGA4Event` called once
   - POST invalid event name → 400, no GA4 call
   - POST rate-limited → 429
   - POST with PII keys → keys stripped, 204
3. **End-to-end:** `tests/e2e/track-smoke.spec.ts` -- Playwright opens homepage, clicks donate CTA, asserts network shows `POST /api/track` with `cta_click` body.
4. **Manual:** `?debug_track=1` query param logs every `track()` call to console. Confirms instrumentation triggers fire as expected.
5. **GA4 Realtime check:** within minutes of deploy, see events flowing in GA4 → Reports → Realtime → Events list.

## Migration / Rollout

**Phase 1 (one PR):** infrastructure
- `functions/api/track.js`
- `functions/api/_track-events.js` (allowlist + schema)
- `src/scripts/track.ts` + `src/scripts/track-auto.ts`
- BaseLayout imports `track-auto.ts`
- Update `scripts/guard.mjs` manifest + add R2/security invariant
- Tests
- Spec finalized in this doc

**Phase 2 (separate PRs, one per surface):** instrumentation
- Phase 2a: scroll depth + outbound + cta auto-instrumentation (via attributes)
- Phase 2b: search events (SearchBar + MobileSearchModal)
- Phase 2c: glossary, FAQ, theme toggle
- Phase 2d: course lesson player (video_play, video_complete)
- Phase 2e: PDF download, copy_citation, share_click

**Phase 3 (after 7-day soak):** Zaraz GA4 disable
- Disable in CF dashboard
- Confirm CSP errors clear
- ~~Confirm GA4 page_view counts hold (server-side MP remains)~~ **FALSIFIED 2026-06-22:** counts did not hold; Zaraz removal on 2026-05-19 zeroed collection. Thin-beacon fix deployed 2026-06-23 restored page_view.
- Open Questions: Zaraz fully removed?

**Phase 4 (optional, weeks later):** Looker Studio / GA4 explorer dashboard rebuilt around the new event names. Brian's call when he wants to look at the data.

## Open Questions

1. **Cloudflare Web Analytics:** the `cloudflareinsights.com/cdn-cgi/rum` beacon (which is also throwing CORS errors per PSI) is a separate product from Zaraz. Keep it (provides Core Web Vitals via RUM), drop it (CSP cleaner), or proxy it? Recommend: keep + fix the CORS error in a separate PR.
2. **Ahrefs Worker (`ahrefs--bot-analytics`):** paused per Brian. Separate decision after this lands.
3. **Funnel definitions:** does Brian want me to set up the standard funnels (Library article → signup, Course page → enrollment, Pillar → donate) in GA4 Explorer once events are flowing? That's a 30-minute dashboard task.
4. **Event taxonomy lock-in:** the names in §6 will be stable forever (renaming events orphans historical data). Brian should confirm naming before Phase 2 ships any beacons. Default: ship what's in this spec, rename later via a transformation rule in GA4 if needed.
5. **Server-side dedup:** `page_view` currently fires from both middleware AND Zaraz GTM. After Zaraz GA4 disable, only middleware fires -- so the dashboard sessions/users counts will *drop slightly* and look like a regression for ~1 week of historical comparison. Worth noting in a CHANGELOG.

## Out of Scope (this spec)

- Conversion attribution modeling (multi-touch, lookback windows) -- GA4 handles default
- Cross-domain tracking to `library.rrmacademy.org` (separate subdomain) -- existing setup already handles via shared client_id
- A/B testing framework -- separate spec if Brian wants
- Heatmap / session replay -- separate decision (most tools require client SDK)
- Server-side conversion API for Meta/LinkedIn ads -- separate spec if running ads

## Acceptance Criteria

- [ ] `/api/track` deployed and accepting events (verifiable by `curl -X POST -d '{"event":"test","params":{}}' /api/track` → 204)
- [ ] `src/scripts/track.ts` bundled and used by at least 1 page
- [ ] BaseLayout imports `track-auto.ts`
- [ ] At least 3 starter events flowing into GA4 Realtime within 24 hours of Phase 1 merge
- [ ] CSP errors from `/analytics/` cleared (Best Practices = 100)
- [ ] PSI "Reduce unused JavaScript" no longer flags 187 KiB at `/analytics/` (Performance improves)
- [ ] `npm run guard` passes on the new endpoint
- [ ] Tests green

## File Inventory (Phase 1)

```
functions/api/track.js                      NEW   ~150 lines
functions/api/_track-events.js              NEW   ~80 lines (allowlist + schemas)
src/scripts/track.ts                        NEW   ~40 lines
src/scripts/track-auto.ts                   NEW   ~80 lines (scroll depth, outbound, cta auto)
src/layouts/BaseLayout.astro                MOD   +3 lines (import track-auto)
scripts/guard.mjs                           MOD   add api/track.js to manifest
test/track-endpoint.test.js                 NEW   ~120 lines
tests/e2e/track-smoke.spec.ts               NEW   ~50 lines
docs/superpowers/specs/.../client-analytics-spec.md   THIS FILE
```

No existing files changed except BaseLayout (1 import) and guard manifest.

## Hard MP limits (permanent constraints of the no-gtag architecture)

Added 2026-07-09. The site is beacon-only (no gtag) since 2026-05-19. GA4 property `526304690` receives everything via the Measurement Protocol relay (`functions/api/_ga4.js`). These limits are permanent under this architecture, not bugs to fix:

| Limit | Effect in GA4 |
|---|---|
| `session_start` / `first_visit` / `user_engagement` are reserved MP event names; GA4 silently drops them | `newUsers` = 0 and `engagedSessions` = 0 in all reports, forever |
| MP cannot set session traffic source | `sessionSource` / `sessionMedium` / `sessionDefaultChannelGroup` are 100 percent "(not set)" / Unassigned |

Compensation layer (use these instead of the dead GA4 natives):

- `entry_platform` / `entry_category` event params, derived from the `entry_ref` / `entry_url` first-touch cookies in `functions/api/_ga4-source.js`
- The `fp.rrmacademy.org` fingerprint worker (D1 `fp_event` / `fp_visitor` / `fp_visitor_link`) for visitor identity and referrer trails
- GSC as the traffic source of truth
- Stripe as the revenue truth (GA4 `purchase` is an indicator only)

Full question-to-system map: `docs/measurement-ssot.md`.

## Synthetic and internal traffic policy

Added 2026-07-09. MP has no automatic bot filtering: anything relayed through `_ga4.js` lands in reports as real traffic. The 2026-07-09 audit found the production canary (`scripts/canary.mjs`) had fabricated ~2,750 of 2,758 `begin_checkout` events in 30 days and was leaving ~91 open Stripe sessions/day.

Policy:

- Probers MUST be excluded from the MP relay.
- Mechanism: the `X-Canary-Token` header -> `isCanary` flag in `functions/api/create-checkout.js`. On the `isCanary` branch: the GA4 fire is suppressed, the Stripe session is expired, and the session carries `metadata.canary=1`.
- `/api/track` carries a UA-regex bot drop (the only automated filtering in the pipeline).
- Any NEW prober must reuse this flag pattern (header -> flag -> suppress GA4 + expire/mark side effects). Do not invent a second exclusion mechanism.

## Decision record: architecture (2026-07-09)

Architecture: RECOMMENDED beacon-only (Option D) with the fingerprint worker + `entry_platform` as the attribution layer; one minimal gtag is the held fallback with an explicit kill criterion. PENDING Brian's explicit ratification (audit decision queue item 2, `~/iCode/.wip/ga4-audit-and-conversion-plan-2026-07-09.md`).
