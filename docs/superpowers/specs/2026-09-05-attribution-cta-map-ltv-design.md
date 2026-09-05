# Attribution, CTA map, and STUC LTV -- design

Status: DRAFT for Brian's review, 2026-09-05. Child of the GA4 Improvement
Program (`2026-08-27-ga4-improvement-program.md`): this spec executes that
program's A0 experiment, supersedes its A1 with a first-touch model Brian
chose in session, and adds two workstreams the program did not have (the CTA
map and the LTV surfaces). Brian's four decisions, made 2026-09-05:

- D-1 Source of truth for granular conversion data: the D1 ledger surfaced in
  rrm-backoffice. GA4 receives the same events for ads attribution only.
- D-2 CTA identity: one `data-cta` attribute in `page.zone.intent` form,
  build-linted.
- D-3 STUC LTV tiered four ways: plan, acquisition source, entry path, and
  signup-month cohort.
- D-4 Attribution window: first touch, 90-day first-party cookie.

## 1. What is true today (verified 2026-09-05)

- GA4 collection is a first-party Measurement Protocol relay
  (`functions/api/_ga4.js`); no gtag anywhere, CSP forbids it. The relay
  already forwards `utm_*`, `entry_category`, `entry_platform` and detects
  `gclid`/`gbraid`/`wbraid` (`_ga4-source.js`), reading session-scoped
  `entry_ref`/`entry_url` cookies set in `BaseLayout.astro`.
- BigQuery export (`rrm-academy.analytics_526304690`) shows GA4 DOES keep
  event-scoped source from those params (`collected_traffic_source`):
  2,172 direct / 950 google organic / 31 google cpc sessions in the week of
  08-28. Session-scoped source (`session_traffic_source_last_click`) is
  `(not set)` on 100 percent of sessions, which is why every Data API and
  UI report reads Unassigned.
- Purchases by collected source since 06-11 match Stripe metadata exactly
  (13 direct, 2 naomi-hub, 2 google organic, 1 google cpc). So event-level
  paid attribution already works end to end; what is missing is (a) session
  and user scope in GA4, (b) cross-session first touch anywhere, (c)
  per-button granularity, (d) LTV.
- The Google Ads campaigns append `utm_source=google&utm_medium=cpc&
  utm_campaign=google_ads_<x>_2026-q3&utm_content={creative}` via
  `final_url_suffix`, with auto-tagging on. Offline conversion upload
  (`_google-ads.js`) exists for quiz and newsletter actions only, keyed on a
  30-day `gclid` cookie.
- The conversion ledger (`conversion_event`, migration 036) records
  page_view, sign_up, generate_lead, begin_checkout, purchase with
  `entry_source`, `entry_category`, `utm_campaign`, `type`. The backoffice
  `/funnel` page reads it (first touch there means earliest ledger row for
  the person, bounded by the 400-day retention).
- The three donate-tier buttons and the STUC join button carry no click
  tracking; `cta_click` fires only for elements with the freeform
  `data-track-cta` attribute (header, footer, homepage hero). Click to
  checkout drop-off on the money buttons is unmeasured.
- `ShareKit.astro` emits event names (`copy-caption`, `download-square`,
  `x-intent`, ...) that the `/api/track` allowlist rejects with 400; that
  instrumentation has never reached GA4.

## 2. A0 experiment (in flight; readout gates section 3.2 only)

Sent 2026-09-05 ~00:40 ET against the live property, one synthetic
client_id each, `page_view` with `session_id` and `engagement_time_msec`:

| Variant | Shape | Campaign value to find |
|---|---|---|
| A | utm in `page_location` query | `spike_a_pageloc` |
| B | `campaign_source/medium/name` + `source/medium/campaign` params, clean URL | `spike_b_campaignparams` |
| C | today's relay shape: `utm_*` as custom params, stripped URL | `spike_c_utmparams` |

Variants with `session_start` or `first_visit` (the program's V3/V4/V5)
were REJECTED by the validation endpoint: those names are reserved and a
Measurement Protocol client cannot open a session. That closes hypothesis
H2 of the program and makes H1 (no session scope for MP-only properties)
the expected outcome.

Readout, 24-48h after send, Data API on property 526304690 with dimensions
`sessionCampaignName`, `sessionSource`, `sessionMedium`,
`firstUserCampaignName`, filter `sessionCampaignName` or
`firstUserCampaignName` CONTAINS `spike_`; and BigQuery
`events_20260905`/`06` on `session_traffic_source_last_click` and
`traffic_source` for `user_pseudo_id` rows whose params contain `spike_`.

Decision table:
- A or C attributes at session scope: 3.2 ships as "carry the screened
  allowlist in page_location on the landing page" (A1 constraint 1 of the
  program) or nothing (C already does it).
- Only B attributes: 3.2 ships campaign_* params on the first page_view of
  a session and on every conversion event.
- None attributes: H1 confirmed. GA4 session/user attribution is
  unattainable without a client tag, which stays banned. 3.2 is dropped,
  GA4 remains event-scoped only, and every attribution read moves to the
  ledger (3.1) and BigQuery `collected_traffic_source` (program workstream
  B). The program's decision D6 (gtag-lite) goes to Brian as a separate
  question; this spec does not depend on it.

## 3. Workstream 1: first-touch attribution

### 3.1 First-touch cookie and ledger columns

Client (`BaseLayout.astro`, same GPC-guarded block as today):

- New cookie `rrm_ft`, written ONLY when absent, `max-age=7776000`
  (90 days), `path=/; SameSite=Lax; Secure`. Value is a compact
  URL-encoded record: `s` source, `m` medium, `c` campaign, `k` content,
  `t` term, `g` gclid (or gbraid/wbraid with a one-letter kind), `r`
  referrer host, `l` landing path, `d` epoch seconds. Derived client-side
  from `location.search` and `document.referrer` with the same precedence
  the server uses (utm_* beats referrer classification; a click id forces
  medium `cpc`). Each field capped at 100 chars; total cookie under 1 KB.
- A returning visitor with an existing `rrm_ft` keeps it even when arriving
  on a new campaign. That is the first-touch definition. The existing
  session-scoped `entry_ref`/`entry_url` keep working as last touch, so
  nothing that reads them changes.
- The 30-day `gclid` cookie is retired in favor of `rrm_ft.g`; `_google-ads.js`
  reads the new location. Google's own click-through window for uploaded
  conversions is 90 days, matching the cookie.

Server (`_ga4-source.js` `buildSourceParams`):

- Parse `rrm_ft`, PII-screen every field with `PII_VALUE_REGEX` at the same
  boundary as `extractUtm`, and emit `ft_source`, `ft_medium`,
  `ft_campaign`, `ft_content`, `ft_landing`, `ft_days` (age in days at event
  time) as event params on every relayed event. Last-touch params are
  unchanged.

Ledger (migration 039, additive, `rrm-auth`):

```
ALTER TABLE conversion_event ADD COLUMN ft_source   TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_medium   TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_campaign TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_landing  TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_at       TEXT;   -- ISO, from d
ALTER TABLE conversion_event ADD COLUMN click_id    TEXT;   -- gclid/gbraid/wbraid, screened
CREATE INDEX IF NOT EXISTS idx_conversion_event_ft ON conversion_event (ft_source, ft_medium, ft_campaign);
```

`_ga4.js` binds them in the existing single INSERT OR IGNORE, screened by
`ledgerSafeText`. Rows written before 039 keep NULLs; the funnel page's
"earliest ledger row" first touch remains the fallback for them.

Stripe (`create-checkout.js`): session and payment-intent metadata gain
`ft_source`, `ft_medium`, `ft_campaign`, `ft_landing`, `ft_at`, `click_id`
(Stripe caps 50 keys and 500 chars per value; both are far off). The
checkout webhook forwards them into the `purchase` GA4 event params, so the
ledger purchase row carries the buyer's first touch even though the webhook
request has no browser cookies.

`donor_gift` gains no columns; it joins to `conversion_event` on
`dedup_key = 'purchase:<stripe event id>'`, which the webhook already binds.

### 3.2 GA4 session scope (conditional on section 2)

Implemented exactly per the decision table. Constraints from the program's
A1 bind unchanged: screened allowlist only, 100-char caps, landing-page
path match for URL carry, test files `test/track-endpoint.test.js` and
`test/ga4-conversion-ledger.test.js` updated in the same commit.

### 3.3 Google Ads value uploads

Two new UPLOAD_CLICKS conversion actions in account 426-226-8858,
`STUC Subscription (server upload)` category SUBSCRIBE_PAID and
`Donation (server upload)` category PURCHASE (Google has no donation
category), both with value. `_webhook-checkout.js` calls the existing
uploader with `click_id` from Stripe metadata, `conversion_value` in USD,
`currency_code`, and the Stripe payment intent id as the order id (Google
dedupes on it). Creation of the actions is a one-time API call recorded in
`skills/ads-sitting/helpers/`; the action ids become frozen constants in
`_google-ads.js` and in the backoffice `functions/api/ads.js` funnel
constants. The grant account cannot bid on value, so the point is
reporting, not bidding.

### 3.4 Guardrails

- `_ga4.js`, `_ga4-source.js`, `BaseLayout.astro` attribution block, and
  `create-checkout.js` are guarded files: coder agent, `guard:update`.
- New tests pin: cookie written once and never overwritten; GPC skips it;
  every `ft_*` field screened; an email-shaped `utm_term` never reaches the
  ledger or Stripe; a 1,100-byte cookie is ignored whole; a `purchase`
  replayed from the webhook carries `ft_*` from Stripe metadata only.
- `gates:analytics` in `merge.yml` stays green; AG6/AG13 untouched.

## 4. Workstream 2: CTA map

### 4.1 Vocabulary

`data-cta="<page>.<zone>.<intent>"`, lowercase, hyphenated tokens, regex
`^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$`.

- `page`: route slug (`home`, `donate`, `stuc`, `endo-quiz-results`,
  `course-<slug>`, `library-record`, `header`, `footer` for site-wide
  chrome, `nav-mobile`).
- `zone`: `hero`, `tiers`, `card`, `inline`, `sidebar`, `sticky`, `modal`,
  `error`, `column-<n>` for footer columns.
- `intent` (closed list, extended only in the vocabulary file):
  `donate`, `join-stuc-member`, `join-stuc-hero`, `join-stuc-superhero`,
  `manage-billing`, `newsletter`, `quiz-start`, `quiz-email`, `quiz-pdf`,
  `survey-start`, `course-enroll`, `course-checkout`, `signup`, `login`,
  `account`, `providers`, `contact`, `learn`.

Vocabulary lives in `src/data/cta-vocabulary.json` (pages, zones, intents)
and is the only place a new token is added.

### 4.2 Instrumentation

- `track-auto.ts` reads `[data-cta]` (and, for one release, the legacy
  `[data-track-cta]`, mapped through a rename table so old and new never
  double-fire) and sends `cta_click` with params `cta` (full id),
  `cta_page`, `cta_zone`, `cta_intent`. The freeform ids in Header, Footer
  and `index.astro` are renamed to the new form in the same PR; the legacy
  attribute is removed the release after.
- The three donate tiers, the STUC join button, Manage Billing, the footer
  STUC link, all three email forms (newsletter, endo-quiz email, survey
  gate) and the `mailto:` error fallbacks get ids.
- `cta_click` joins `LEDGER_EVENTS` with `type` = the full cta id (100-char
  cap already applies) and `value_cents` NULL. Expected volume is low
  thousands per month; the 400-day purge covers it. Click-to-checkout and
  click-to-purchase are then per-person joins the funnel page already
  knows how to make.
- `ShareKit.astro` event names are corrected to allowlisted snake_case
  (`share_click` with `network` param; `copy_citation`), which is a bug fix
  ridden along because the same file is touched.

### 4.3 Lint gate and generated map

`scripts/check-cta-map.mjs`, run in the lint chain before `astro build`
and in `merge.yml`:

1. Parses every `.astro` under `src/` and, for rendered pages, the built
   `dist/**/*.html` (so component composition is judged on output).
2. Any `<a>`/`<button>`/`<form>` whose href, action, or a `data-tier`,
   `data-checkout`, `data-enroll` attribute targets `/donate`, `/api/create-
   checkout`, `/api/billing/portal`, `/save-the-uterus-club`,
   `/api/newsletter/subscribe`, `/api/endo-quiz/*`, `/api/survey/*`,
   `/courses/*/enroll`, `/signup`, `/login`, `/account`, `/providers`, or
   `mailto:` MUST carry `data-cta` matching the regex with tokens from the
   vocabulary. Otherwise the build fails naming file and line.
3. Within one rendered page, duplicate `data-cta` values fail (the reason
   for the zone token). Site-wide chrome is exempt from the per-page
   duplicate rule but must be unique within the component.
4. Emits `docs/cta-map.json` (generated, committed, never hand-edited):
   one row per `(page path, cta id)` with label text, target, element type,
   and the source file. `docs/cta-map.md` is rendered from it by the same
   script as a table grouped by page. This file is the inventory Brian
   asked for and is what the backoffice CTA table labels its rows with.

Zero-CTA scan result fails loudly, per the estate's asset-gate convention.

## 5. Workstream 3: backoffice surfaces

All reads audited, all money in cents, house design system, coverage gate
90/85/90, `scripts/render-check.mjs` leg. Read-only against `rrm-auth`
(`DB`) plus the existing Stripe restricted key for the LTV panel's roster
cross-check; no writes, no migrations in the backoffice repo (schema is
vendored from rrm-academy-cf as today).

### 5.1 `/funnel` additions

- First-touch dimension: stage counts and forward paths grouped by
  `ft_source`/`ft_medium`/`ft_campaign`, falling back to the earliest-row
  method when `ft_*` is NULL, and labeled which method produced the row.
- CTA table: for each `cta` id in the window, clicks, unique persons,
  persons reaching `begin_checkout` within the same session, persons with
  a `purchase` within 7 days, and the resulting rates. Labels from
  `docs/cta-map.json` (fetched from the academy repo at build time, vendored
  read-only like the schema). Pages with more than one CTA render as a
  grouped block so hero versus tiers versus footer is one glance.

### 5.2 `/membership` LTV panel

Data: `wix_subscription` (tier, amount_cents, frequency, status,
started_at, lapsed_at, cycle_count, contact_id, email), `donor_gift`
(additional gifts by the same email or contact), `conversion_event`
(first touch and entry path for the person).

Definitions, fixed and displayed on the page:

- Realized LTV per member = sum of paid subscription cycles + gifts, cents.
- Monthly churn per segment = lapses in month / active at month start,
  trailing 6 months.
- Expected lifetime months = 1 / churn (capped at 36 when churn is under
  1/36 so a small segment cannot print an infinite number).
- Expected LTV per segment = ARPU x expected lifetime months.

Four tabs, each a table plus a 12-month sparkline:

1. By plan: member ($9), hero ($19), superhero ($99), complimentary
   (membership_state), legacy Wix. Annual does not exist today; the column
   appears when `frequency` first carries a non-MONTH value.
2. By acquisition source: `ft_source`/`ft_medium` from the person's
   earliest ledger row carrying `ft_*`; a bucket "before first-touch
   tracking" holds everyone else so historical members are counted, not
   hidden.
3. By entry path: the person's first non-page_view ledger event type
   (`endo_quiz_ads`, `newsletter`, `endo_survey`, course enroll, `checkout`
   sign-up, direct join).
4. Cohorts: signup month rows x months-since-signup columns, percent
   still active, plus cumulative revenue per cohort member.

Every table carries n, and any segment under n=10 renders its rates
greyed with the count instead of a percentage.

### 5.3 `/ads` additions

Per campaign: purchases and revenue attributed by `ft_campaign` (first
touch) and by `utm_campaign` (last touch) side by side, cost per purchase,
and the Google-side uploaded conversion value once 3.3 ships. Frozen
tracking-live date for the new columns is the 039 deploy date, for the
same reason the existing funnel windows are frozen.

## 6. Privacy and retention

- `rrm_ft` is first-party, no PII by construction (every field screened
  client-side against the same patterns, and again server-side), skipped
  under GPC, and expires at 90 days. It is a marketing-attribution cookie
  under the site's existing privacy policy language; the policy text gets
  one sentence naming the 90-day window. Brian reviews that sentence.
- Ledger retention stays 400 days; purge scheduling remains C7 stub debt.
- LTV surfaces show per-segment aggregates only; no per-member rows leave
  the existing `/membership` detail views.

## 7. Rollout and proof

1. A0 readout (section 2). Record the result in this spec's status line.
2. Workstream 1 as converge component `first-touch-attribution`: migration
   039 applied remote before deploy; proof = a synthetic first-touch
   session followed by a real $5 donation on a test card shows `ft_*` in
   the ledger row, in Stripe metadata, and in the BigQuery `purchase`
   event; the Ads upload log records the click id.
3. Workstream 2 as `cta-map`: lint gate red on a deliberately untagged
   button in CI, green on the tagged tree; `docs/cta-map.json` committed;
   `cta_click` rows appearing within minutes of deploy with the new ids.
4. Workstream 3 as `funnel-cta-and-ltv`: backoffice deploy with the pinned
   wrangler; smoke legs for the new routes; LTV totals tie to `/revenue`
   and `/membership` within one cent for the same window.

Reverts: each workstream is one revert; 039 columns are additive and can
stay populated through a revert.

## 8. Out of scope

Annual plans, a gtag-lite bootstrap (D6 of the parent program, Brian's
call), multi-touch models beyond first and last, FSP client sites (the
cookie and lint are portable and become a template feature later), and any
change to the Google Ads campaigns themselves.
