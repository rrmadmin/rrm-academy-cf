# GA4 Improvement Program

Status: REV 2 after arise deep spec review (2 CRITICAL, 3 HIGH, 3 MEDIUM found
and folded). Awaiting Brian approval. 2026-08-27.
Scope: rrm-academy-cf (A) + local BQ tooling (B) + property hygiene (C) +
reusable FSP-scale skills (D).

## 1. Audited current state (corrected by review)

Property 526304690 (RRM Academy Cloudflare, stream G-TSWRY7XLR0):

- 100% of sessions report channel "Unassigned" (16,635 sessions/28d).
  CORRECTED ROOT-CAUSE PICTURE: the client beacon ALREADY sends
  page_referrer on every page_view (src/scripts/track.ts, unstripped through
  the relay), yet attribution is still fully Unassigned. Therefore the
  missing-referrer theory is dead. Leading hypotheses, in order: (H1) GA4
  does not compute session traffic-source for Measurement-Protocol-only
  properties (no gtag session_start ever collected); (H2) the relay's
  derived session_id / client_id mechanics break GA4 sessionization enough
  to defeat attribution; (H3) UTMs absent from page_location (stripped)
  are required IN ADDITION to referrer. No workstream builds on an unproven
  hypothesis: A0 below settles it empirically first.
- BigQuery export: link created 2026-05-17, but the earliest queryable
  table is events_20260611 (~2.5 months of data, verified via bq ls).
  gcloud + bq are ALREADY authenticated on this Mac as
  administrator@rrmacademy.org, project rrm-academy, dataset
  analytics_526304690 (location US). A representative weekly sessionized
  query dry-runs at ~74 KB processed: effective cost $0 (free-tier 1TB/mo).
- Healthy: 14-month retention, data-driven attribution, 4 key events,
  16 custom dimensions, Ads link (grant acct, personalization off), BQ link.
- Missing: Search Console link (UI-only action); custom metrics (none).

## 2. Goals / non-goals

Goals: (G1) real channel attribution, by whichever mechanism the A0
experiment proves; (G2) the BQ export turned into session/funnel truth
joined with the conversion_event ledger; (G3) surfaced in backoffice
/search + /funnel + the weekly digest; (G4) hygiene closed; (G5) a
REUSABLE provisioning + audit capability for the many FSP client GA4
setups Brian is about to build.

Non-goals: no full gtag/GTM adoption on rrmacademy.org; no consent-surface
changes; no retroactive GA4-native re-attribution (structurally
impossible); no paid BQ reservation.

## 3. Workstream A: attribution, experiment first

### A0 The experiment (GATE: nothing else in A ships until this reads out)

Send controlled MP sessions against the LIVE property (distinct utm_campaign
value ga4_a0_test_<variant> so they are findable and excludable), one variant
per synthetic client_id:

- V1 baseline: exactly today's payload shape.
- V2 + UTMs restored in page_location (screened allowlist).
- V3 + an explicit `session_start` event opening the session.
- V4 V2+V3 combined.
- V5 V4 with a GA4-format session_id (epoch seconds) instead of the
  derived hash.

Read out 24-48h later via the Data API: sessionSource/sessionMedium/
sessionDefaultChannelGroup per test campaign. Decision table:
- Any variant attributes -> A1 implements exactly that variant's deltas.
- No variant attributes -> H1 confirmed: GA4-native channels are
  unattainable for MP-only collection. A pivots: channel truth comes from
  B2.1 (BQ derivation) surfaced in /search, and a new decision D6 goes to
  Brian: accept BQ-derived channels as the house standard, or adopt a
  minimal first-party gtag-lite session bootstrap (a scope change requiring
  its own spec).

The experiment runs as a throwaway local script (no repo changes, no
deploys); its sessions are excluded from reporting by the test campaign name.

### A1 Implementation (conditional on A0)

Whatever variant wins, these review-mandated constraints bind:

1. UTM carry (if V2/V4/V5 wins): append the screened allowlist
   (utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid,
   wbraid, gbraid; 100-char caps; PII_VALUE_REGEX screen) to page_location
   ONLY when the event's page_location PATH equals the entry_url cookie's
   PATH (the landing page). This is stateless, implementable, and cannot
   stamp first-touch UTMs onto interior pages (the review killed both the
   "entry page_view" conditional, which is unimplementable statelessly, and
   append-on-all, which corrupts GA4 landing-page/page-path reporting
   site-wide). Conversion events (sign_up etc.) additionally carry the UTMs
   regardless of path, since GA4 uses them for event-scoped attribution and
   they do not feed page-path reports.
2. page_referrer: server-side events (the four conversion events + webhook
   replays) gain page_referrer from entry_ref, screened; page_views already
   carry it from the client and are untouched.
3. session_start / session_id changes (if V3/V5 wins): specified precisely
   at implementation time from the winning variant; any session_id format
   change must prove the ledger and funnel person-keying are unaffected
   (they key on client_id/user_id, not session_id, but the test suite must
   pin it).
4. Self-referral hardening: SELF_DOMAINS exact-match list gains
   suffix-matching for rrm-academy.pages.dev preview hosts (review finding:
   preview QA traffic currently classifies as external referral into
   production GA4).

### A2 Guardrails

- _ga4.js / _ga4-source.js guarded: coder agent + guard:update.
- The pinned "page_location must egress with no query string" contract
  lives in test/track-endpoint.test.js (line ~667 and siblings), NOT in
  ga4-conversion-ledger.test.js; the review corrected the spec's earlier
  wrong file reference. Both files' assertions are updated deliberately in
  the same commit, with new tests proving non-allowlisted params, an
  email-shaped utm_term, and a digit-run utm_content still never egress.
- AG6/AG13 unaffected (verified); ledger INSERT does not read
  page_location (verified).

### A3 Verification

Numeric floor applies ONLY if A0 proves attribution attainable: within 7
days of A1 deploy, Unassigned share of NEW sessions < 50%. The prior
justification ("organic should dominate") was arithmetically wrong (531
GSC clicks/week is ~13% of ~4,160 weekly sessions) and is withdrawn; the
floor is a floor on Unassigned share, with the channel mix an open
empirical question B2.1 answers.

## 4. Workstream B: BigQuery activation

### B1 Execution model (verified live)

gcloud/bq already authenticated (administrator@rrmacademy.org, Brian's own
login, not a service account; D2 asks Brian to own that explicitly).
Tooling at ~/iCode/tools/ga4-bq/: curated vendored SQL (Adswerve/
aliasoblomov-derived), no dbt in phase 1. Weekly launchd job
org.rrmacademy.ga4-bq created VIA THE /launchd-job-create SKILL, no
exceptions (review CRITICAL: raw plists here have twice reproduced the
missing-homebrew-PATH and op-TCC-storm incidents; the skill's wrapper +
PATH + verify gates are mandatory). maximum_bytes_billed set in the tool
config as the runaway bound.

### B2 Phase-1 queries (each names its question)

1. Sessionized acquisition by derived source/medium/channel per week,
   from raw utm event params (sent since 2026-03-09, so the FULL ~2.5-month
   export window is recoverable). This derivation is labeled "BQ-derived
   channels", never "GA4 channels" (R4), and D5 puts the long-term
   methodology choice to Brian.
2. Landing-page performance (entrances, engaged sessions, conversion rate).
3. Unsampled funnel by pseudo-id, reported ALONGSIDE the D1
   conversion_event ledger numbers (compare in the report, no cross-system
   join).
4. Content decay per content_pillar/article.
5. Data-quality: events/day vs AE relay counts. GATES the others: when
   weekly divergence exceeds 5%, queries 1-4 are marked degraded in that
   week's snapshot (review: quality must gate, not co-exist).
6. Quiz funnels by lead_source.

### B3 Surfacing

JSON report under ~/iCode/.run-log/ga4-bq/; compact snapshot to observatory
KV ga4-bq:latest via the established publish pattern. The digest/backoffice
reader MUST check snapshot age and mark stale past 12 days (weekly cadence
+ one grace tick; launchd does not fire while the Mac sleeps and does not
catch up).

## 5. Workstream C: property hygiene

- C1 Search Console link: UI-only (Comet-driven or Brian, 2 minutes).
- C2 Custom metrics: none in phase 1 (recorded decision).
- C3 utm_source/medium dims: not registered (become standard if A succeeds).
- C4 Enhanced-measurement stream settings are inert without gtag; leave,
  document.

## 6. Workstream D: FSP-scale reusable skills (the reason this is a program)

Brian will provision many GA4 setups for Five Star Practices clients.
Unlike rrmacademy.org, FSP client sites collect via standard gtag (the
clinic-site-template marketing backend), so NONE of the Workstream-A MP
complications apply to them; their attribution works out of the box when
provisioned correctly. Two skills in ~/iCode/skills, specced here, built
after approval:

### D1 /ga4-provision

End-to-end new-client GA4 stand-up via the Admin API:
- Inputs: client name, domain, owning Google account context (RRMA
  properties under administrator@; FSP client properties under the account
  the fsp-dashboard flow uses; the skill REQUIRES an explicit account
  choice and verifies the minted token's accessible account list before
  creating anything, per the site-analytics registry entity-verification
  rule).
- Creates: property (timezone/currency/industry), web data stream, GA4
  measurement id handed to the clinic config, enhanced-measurement review,
  14-month retention, baseline key events per the FSP playbook
  (generate_lead as primary; form-submit conversions), baseline custom
  dimensions only where the template emits them, Ads link when the client
  runs ads, GSC link step (UI-assisted via Comet, scripted URL deep-link).
- Registers the property in the site-analytics registry and the client's
  fsp-dashboard tenant config.
- Verifies falsifiably: fires a real test event, confirms via Data API
  realtime, confirms the property answers the audit skill clean.
- Credentials: the existing analytics-edit refresh token (minted 2026-07-02
  explicitly "for Five Star Practices GA4/GSC provisioning"); new account
  contexts go through /google-oauth-mint, never ad hoc.

### D2 /ga4-audit

The deterministic scorecard distilled from tonight's audit, runnable
against ANY property the tokens reach:
- Admin API sweep: retention, attribution settings, key events + counting
  methods, custom dims/metrics, data streams + enhanced measurement,
  BQ/Ads/SC links, channel-group inventory.
- Data API probes: Unassigned session share (the attribution health
  number), key-event volume sanity, (not set) landing-page share.
- Output: PASS/WARN/FAIL lines with concrete remediation per row, same
  action-required convention as the observatory subsystems.
- Used at provision time (exit gate), then periodically (a candidate
  future observatory daemon iterating the registry's properties).

## 7. Rollout order

A0 experiment (throwaway, immediate) -> D2 audit skill (needed as the
provision exit gate and immediately useful on rrmacademy) -> A1 (if A0
proves a variant) -> B (independent, any time) -> D1 provision skill ->
C1 link. Reverts: A1 git revert (payload returns to today's shape; the
same commit's test updates revert with it); B unload launchd job; D skills
are additive files.

## 8. Risks

- R1 PII in carried UTMs: screened allowlist + caps, test-pinned.
- R2 Transition-window attribution oddities for returning visitors:
  self-resolves inside the cookie horizon.
- R3 BQ cost: measured ~$0; maximum_bytes_billed bounds runaways.
- R4 Two channel methodologies visible at once (GA4-native vs BQ-derived):
  labeled distinctly; D5 decides the long-term posture.
- R5 A0 may prove GA4-native attribution unattainable (H1): the program
  still delivers channels via B2.1; D6 decides whether gtag-lite is worth
  its own spec.

## 9. Decisions for Brian

- D1 Approve the narrowed PII posture (screened attribution params on
  landing-page + conversion payloads only).
- D2 BQ runs locally under administrator@'s own gcloud login (not a
  service account): own it or ask for a service account.
- D3 SC link: Comet-driven now or you click it.
- D4 dbt-ga4 deferred to phase 2.
- D5 BQ-derived channel series: keep one methodology forever, or seam to
  GA4-native channels once/if A1 lands.
- D6 (only if A0 fails all variants) gtag-lite bootstrap: separate spec, or
  accept BQ-derived channels as the standard.
