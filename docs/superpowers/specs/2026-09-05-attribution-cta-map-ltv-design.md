# Attribution, CTA map, and STUC LTV -- design

Status: REV 2 after /arise deep spec review (2 CRITICAL, 9 HIGH, 6 MEDIUM
found, all applied), 2026-09-05. Pending Brian's review. Child of the GA4 Improvement
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
  `t` term, `g` click id (or gbraid/wbraid, with a one-letter kind marker),
  `r` referrer host, `l` landing path, `d` epoch seconds. Derived
  client-side from `location.search` and `document.referrer` with the same
  precedence the server uses (utm_* beats referrer classification; a click
  id forces medium `cpc`). Before the cookie is written, every field is
  screened by a small inline regex covering the two branches of
  `PII_VALUE_REGEX` a client script can reasonably re-implement (email
  shape; a bare 13-19 digit run); a field that matches is written empty
  rather than blocking the write. `s`/`m`/`c`/`k`/`t`/`r`/`l` are each
  capped at 100 chars; `g` gets its own 512-char cap, matching
  `_google-ads.js`'s `GCLID_RE` bound rather than the 100-char param cap
  (Google click ids run longer than a UTM value ever does). The write
  aborts the cookie entirely -- nothing is set -- if the encoded total
  exceeds 1 KB, rather than truncating a field and corrupting it; that
  ceiling holds only as long as every field but `g` stays at its 100-char
  cap.
- A returning visitor with an existing `rrm_ft` keeps it even when arriving
  on a new campaign. That is the first-touch definition. The existing
  session-scoped `entry_ref`/`entry_url` keep working as last touch, so
  nothing that reads them changes.
- The 30-day `gclid` cookie is NOT retired. It stays exactly as today --
  30 days, overwritten on every new ad click -- and remains the sole
  source for every Google Ads conversion upload, existing and new
  (section 3.3). `rrm_ft.g` is a separate, first-touch-only value: it holds
  the click id from the visitor's FIRST paid click, feeds the ledger's
  `click_id` column and the acquisition-source reporting in section 5, and
  is never uploaded to Google Ads -- last-click is still what the account's
  bidding and the existing eight upload actions run on, and retiring the
  30-day cookie in favor of a 90-day first-touch one would silently break
  all of them. One-time bridge: the first time `rrm_ft` is written after
  this deploys, if a legacy `gclid` cookie is already present, `g` is
  seeded from it, so a visitor mid-window at deploy time still gets a
  first-touch click id instead of a blank one.

Server (`_ga4-source.js` `buildSourceParams`):

- Parse `rrm_ft`, PII-screen every field with `PII_VALUE_REGEX` at the same
  boundary as `extractUtm`, and emit `ft_source`, `ft_medium`,
  `ft_campaign`, `ft_content`, `ft_landing`, `ft_at` (ISO timestamp derived
  from `d`) as event params on every relayed event. Last-touch params are
  unchanged.
- `create-checkout.js` cannot read `rrm_ft` or `gclid` today: it derives
  attribution entirely from the POST body (`entry_referrer`/`entry_url`),
  which is last-touch and never sees a cookie. It now also parses `rrm_ft`
  and the `gclid` cookie straight from the request's `Cookie` header, via a
  small shared helper added to `_ga4-source.js` (the same cookie parser
  `buildSourceParams` already uses), so the two checkout pages themselves
  are untouched. The cookie is the source of truth for first touch and for
  the current click id; the body's `entry_referrer`/`entry_url` keep
  supplying last-touch source the way they do today.

Ledger (migration 039, additive, `rrm-auth`; header follows the shape
migrations 034 and 036 established -- WHY, PII class including which screen
`click_id` and `transaction_id` each get, apply commands, and a
partial-apply recovery note: SQLite has no `ADD COLUMN IF NOT EXISTS`, so a
failed run is resumed by executing the remaining `ALTER TABLE` statements
individually by hand, never by re-running the file):

```
ALTER TABLE conversion_event ADD COLUMN ft_source      TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_medium      TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_campaign    TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_landing     TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_at          TEXT;   -- ISO, from d
ALTER TABLE conversion_event ADD COLUMN click_id       TEXT;   -- first-touch gclid/gbraid/wbraid, PII-screened
ALTER TABLE conversion_event ADD COLUMN transaction_id TEXT;   -- Stripe pi_/sub_ id, opaque: length-capped only, exempt from the digit-run PII screen
CREATE INDEX IF NOT EXISTS idx_conversion_event_ft ON conversion_event (ft_source, ft_medium, ft_campaign);
CREATE INDEX IF NOT EXISTS idx_conversion_event_transaction ON conversion_event (transaction_id);
```

`ft_content` is emitted to GA4 as an event param but deliberately carries no
ledger column -- the ledger's free-text budget stays scoped to what the
funnel and LTV surfaces actually group by.

`_ga4.js` binds the new columns in the existing single INSERT OR IGNORE.
`click_id` is screened by `ledgerSafeText` like every other free-text
column. `transaction_id` is bound from the existing `transaction_id` param
the webhook already sends on `begin_checkout` and `purchase`: it is an
opaque Stripe identifier, not free text, so it is exempt from the
digit-run branch of the PII screen the way `session_id`/`client_id`/
`user_id`/`dedup_key` already are, and only the length cap applies. Rows
written before 039 keep NULLs; the funnel page's "earliest ledger row"
first touch remains the fallback for them.

This migration has more homes than the SQL file itself, all landing in one
commit: `migrations/039-first-touch-attribution.sql`; a new `EXTRA_DDL`
entry in rrm-academy-cf's `scripts/gates/validate-sql-columns.mjs`, carrying
the same kind of provenance `why` string the existing entries for 031/033/
034/035 do; and, in rrm-backoffice, both `test/fixtures/conversion-event.sql`
(the vendored read-only copy of the table) and the `EXPECTED` column array
in `test/funnel-api.test.js` that asserts against it. The fixture is not
sha-asserted today; this change graduates it to `schema/` with a `.sha256`
sidecar, matching how the other vendored DDL in that repo is tracked.

Stripe (`create-checkout.js` and `courses/enroll.js`, the two Stripe session
creators): session and payment-intent metadata gain `ft_source`,
`ft_medium`, `ft_campaign`, `ft_landing`, `ft_at`, `click_id` (the visitor's
first-touch click id, from `rrm_ft.g`) and `gclid_last` (the CURRENT
`gclid` cookie, read server-side from the Cookie header at checkout time --
Stripe caps 50 keys and 500 chars per value; all of these are far off).
Course-checkout sessions carry the same six `ft_*` keys plus `gclid_last`
so the webhook's course branch has the same fields to forward as the
donation/subscription branches do. The checkout webhook forwards
`ft_*`/`click_id` into the `purchase` GA4 event params, so the ledger
purchase row carries the buyer's first touch even though the webhook
request has no browser cookies; `gclid_last` is read separately by section
3.3's uploader and is never written to the ledger's `click_id` column,
which stays first-touch-only.

`donor_gift` gains no columns. It cannot join to `conversion_event` on
`dedup_key`: `donor_gift.source_id` is the Stripe payment_intent id
(`pi_...`), while `dedup_key` is built from the webhook's Stripe *event* id
(`evt_...`) -- the two are never the same value. It joins instead on
`donor_gift.source_id = conversion_event.transaction_id`, both populated
from the same payment_intent id.

### 3.2 GA4 session scope (conditional on section 2)

Implemented exactly per the decision table. Constraints from the program's
A1 bind unchanged: screened allowlist only, 100-char caps, landing-page
path match for URL carry, test files `test/track-endpoint.test.js` and
`test/ga4-conversion-ledger.test.js` updated in the same commit.

### 3.3 Google Ads value uploads

Two new UPLOAD_CLICKS conversion actions in account 426-226-8858,
`STUC Subscription (server upload)` category SUBSCRIBE_PAID and
`Donation (server upload)` category PURCHASE (Google has no donation
category), both with value.

The existing `uploadConversion(env, gclid, conversionActionId)` cannot
carry any of this: it hardcodes `conversionValue: 1.0`, has no order-id
field, and takes a bare `gclid` string rather than a click-id kind. It is
replaced with `uploadConversion(env, { clickId, clickIdKind,
conversionActionId, conversionValue, currency, orderId })`. The existing
eight call sites (newsletter, both quiz funnels) keep behaving exactly as
today by passing the current defaults (`clickIdKind: 'gclid'`,
`conversionValue: 1.0`, `currency: 'USD'`, no `orderId`); `adIdentifiers` is
built keyed by `clickIdKind` (`gclid`/`gbraid`/`wbraid`) rather than always
`{ gclid }`.

`_webhook-checkout.js` calls the new signature with `clickId` from the
`gclid_last` Stripe metadata key (section 3.1 -- the CURRENT click at
checkout time, preserving last-click for Ads uploads exactly as today),
`orderId` set to `session.payment_intent || session.id` for donations and
`session.subscription || session.id` for subscriptions, and
`conversionValue` derived the same way the `purchase` GA4 send in that file
already derives its dollar value: `amount_total || stucTierCentsFallback[tier]`,
converted to dollars. Google dedupes on the order id, but that is a second
line of defense, not the only one: the upload call sits behind the same
`webhook_event` dedup that already protects the ledger write, so a Stripe
redelivery does not re-attempt the upload at all rather than relying on
Google to catch a duplicate order id.

The `_google-ads.js` failure-alert email's "roughly 30-day click window"
wording stays correct as written, because the `gclid` cookie it describes
is unchanged by this spec (section 3.1's #2 fix) -- only the ledger's own
first-touch `click_id` is new, and that is never what this email is about.

Creation of the actions is a one-time API call recorded in
`skills/ads-sitting/helpers/`; the action ids become frozen constants in
`_google-ads.js` and in the backoffice `functions/api/ads.js` funnel
constants. The Data Manager order-id field name must be verified against
the live API at implementation time, the same way this file's header
records having verified the existing fields against the live endpoint. The
grant account cannot bid on value, so the point is reporting, not bidding.

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

- `page`: a closed list of route FAMILIES, never a slug -- current list
  (read `src/data/cta-vocabulary.json` for the live source of truth, this
  is a snapshot): `home`, `donate`, `stuc`, `endo-quiz`,
  `endo-quiz-results`, `endo-survey`, `course`, `course-step`,
  `library-record`, `guide`, `faqs`, `header`, `footer` for site-wide
  chrome, `nav-mobile`, `app-shell` for the shell nav-drawer chrome
  (rendered only when `PUBLIC_SHELL_ROUTES` is set), `error`, `account`,
  `community`, `developers`
  (one pooled family for the agent-auth/ai-instructions/connect/developers/
  webhooks API-docs pages), `providers`, `about`, `contact`, `press`,
  `sitemap`, `linkinbio`, `maintenance`. Per-page distinction (which
  course, which library record) comes from the ledger row's own
  `page_location`/pathname, which it already stores -- `page` never carries
  a slug.
- `zone`: a closed list, footer columns enumerated rather than
  parameterized: `hero`, `tiers`, `card`, `inline`, `sidebar`, `sticky`,
  `modal`, `error`, `footer-col-1`, `footer-col-2`, `footer-col-3`,
  `footer-col-4`, `repeat` (for the 2nd+ occurrence of the same CTA type
  repeated on one content-heavy page, when no other zone fits -- e.g. a
  4th `mailto:` on `/press/`; the FIRST occurrence still keeps its real
  zone).
- `intent` (closed list, extended only in the vocabulary file):
  `donate`, `join-stuc-member`, `join-stuc-hero`, `join-stuc-superhero`,
  `manage-billing`, `newsletter`, `quiz-start`, `quiz-email`, `quiz-pdf`,
  `survey-start`, `course-enroll`, `course-checkout`, `signup`, `login`,
  `account`, `providers`, `contact`, `learn`, `home`, `retry`.

The lint gate enforces a 64-character maximum on the composed id (matching
`LEDGER_SHORT_CAP`, the same cap the ledger's `type` column binds against),
not the 100-char figure a naive reading of the regex might suggest; the
regex itself is unchanged.

Vocabulary lives in `src/data/cta-vocabulary.json` (pages, zones, intents)
and is the only place a new token is added.

### 4.2 Instrumentation

- `/api/track`'s `REQUIRED_PARAMS` already demands `id` and `page` for
  `cta_click` (`_track-events.js`); `track-auto.ts` has to actually send
  them. It reads `[data-cta]` (and, for one release, the legacy
  `[data-track-cta]`, mapped through a rename table so old and new never
  double-fire) and sends `cta_click` with `id` (the full `page.zone.intent`
  cta id) and `page` (`location.pathname`), plus `cta_zone` and
  `cta_intent`. There is no separate `cta`/`cta_page` param name: `id` IS
  the cta id and `page` IS the path, matching the allowlist exactly rather
  than inventing a parallel naming that would still fail the required-param
  check. `REQUIRED_PARAMS` itself stays `['id', 'page']`. The freeform ids
  in Header, Footer, `index.astro`, and `500.astro` (page token `error`,
  intents `home` and `retry` for its two buttons) are renamed to the new
  form in the same PR; the legacy attribute is removed the release after.
  Guarded/touched files for this workstream: `functions/api/_track-events.js`,
  `functions/api/track.js`, `test/track-endpoint.test.js`, and
  `functions/api/_ga4.js`. Because gate AG4 skips `track-auto.ts` (a client
  file, not a server allowlist), a runtime-shaped test is added alongside
  the unit tests: a real POST to `/api/track` with the new `cta_click`
  payload shape, asserting a 2xx response and the resulting GA4 params.
- The three donate tiers, the STUC join button, Manage Billing, the footer
  STUC link, all three email forms (newsletter, endo-quiz email, survey
  gate) and the `mailto:` error fallbacks get ids.
- `cta_click` joins `LEDGER_EVENTS`. `deriveLedgerType` (`_ga4.js`) gains a
  `cta_click` branch returning the screened `params.id` (the same
  PII/length screen the `generate_lead` branch already applies to
  `lead_source`), with `value_cents` NULL. `cta_click` is deliberately NOT
  added to `LEDGER_USER_EVENTS`: like `page_view`, it is excluded there on
  volume -- it is the CTA map's highest-frequency event, and a per-person
  `user_id` trail on every click is well past what the funnel questions
  need, so a `cta_click` row keys to `client_id` only, logged-in or not.
  Migration 036's header TYPE-derivation comment block is amended in the
  same commit that adds the branch. The stages and by-type queries in the
  backoffice `functions/api/funnel.js` gain an explicit `FUNNEL_EVENTS`
  filter so `cta_click` (and any future ledger event) cannot surface as a
  stage, and `FUNNEL_EVENTS`/`TYPED_EVENTS` themselves are unchanged. The
  section 5.1 CTA table is
  its own aggregate query, joining click rows to `begin_checkout` and
  `purchase` on `client_id` (present on both sides of a `cta_click` row,
  which carries no `user_id`) rather than on the funnel's `PERSON_SQL`
  person-key expression. Expected volume is low thousands per month; the
  400-day purge covers it.

### 4.3 Lint gate and generated map

`scripts/check-cta-map.mjs`, run in the lint chain before `astro build`
and in `merge.yml`:

1. Parses every `.astro` under `src/` and, for rendered pages, the built
   `dist/**/*.html` (so component composition is judged on output).
2. Any `<a>`/`<button>`/`<form>` whose href, action, or a `data-tier`,
   `data-checkout`, `data-enroll` attribute targets `/donate`, `/api/create-
   checkout`, `/api/billing/portal`, `/save-the-uterus-club`,
   `/api/newsletter/subscribe`, `/api/endo-quiz/*`, `/api/survey/*`,
   `/api/courses/enroll`, `/api/courses/waitlist`, or `mailto:`, or whose
   `rel` contains `sponsored`, MUST carry `data-cta` matching the regex
   with tokens from the vocabulary. Otherwise the build fails naming file
   and line. Navigation targets (account, login, signup, the provider
   directory) are NOT policed -- they are not money or lead capture, they
   are chrome navigation; chrome links to them (Header, nav-mobile, the
   homepage) still carry `data-cta`, but by choice, not because this rule
   requires it. Elements inside an authored content body (a container
   carrying `data-cta-content`: commentary and library bodies, guide and
   FAQ bodies, course step bodies) are not policed; an in-prose link is
   copy, not a CTA.
2b. Rule 2's href/action/data-* scan cannot see an id-plus-listener button
    (`#donate-btn`, `#manage-billing-btn`, `#fund-give-btn`) or a `mailto:`
    fallback a script builds at runtime -- there is no href for step 2 to
    read. Scope: any `<button>`, or any `<a>`/`<form>` with no real
    href/action, carrying an `id`, `class`, or `data-*` attribute (other
    than `data-cta`) that is referenced from an inline `<script>` in the
    same file. "Referenced" means the id/selector's OWN click/submit
    handler -- not merely "the script that references it also happens to
    contain a literal somewhere" -- contains one of the RULE_2B_LITERALS
    (`/api/create-checkout`, `/api/billing/portal`, `mailto:`,
    `/api/newsletter/subscribe`, `/api/endo-quiz/*`, `/api/survey/*`,
    `/api/courses/enroll`, `/api/courses/waitlist`). The implementation does
    not brace-match the handler body (unreliable against a minified or
    multi-statement handler with nested `{}`); it instead anchors at the
    position right after the handler-chain (`.addEventListener(`,
    `.onclick =`, `.onsubmit =`) and accepts a literal within an 800-
    character window on either side of that anchor (`HANDLER_BODY_WINDOW`
    in `scripts/lib/cta-map-rules.mjs`). 800 was picked from the two real
    shapes this rule has to tell apart in this codebase: a genuinely-wired
    id (`#fund-give-btn` on `/providers/`) sits 2,561 characters from its
    own handler across an unrelated UI-setup block, while unrelated ids
    merely referenced nearby (two disclosure-toggle buttons on
    `account/index.astro`) sit only 464/737 characters from a billing
    literal that has nothing to do with them -- raw proximity alone cannot
    separate the two, so the window is generous enough to reach the real
    case while the anchor-on-the-actual-handler-chain (not just anchor-on-
    any-reference) is what actually does the discriminating work. Recognized handler
    forms, for `#id` selectors (`getElementById`/`querySelector('#id')`,
    direct-chained or assigned to a variable first) and for `.cls`/
    `[data-x]` selectors (`querySelector`/`querySelectorAll`, including
    compound selectors like `.enroll-btn.primary` -- the selector need only
    START with the class/attribute token): `.addEventListener(...)`,
    `.onclick = ...`, `.onsubmit = ...`, and (class/data-attr selectors via
    `querySelectorAll` only) `.forEach(function (el) { ... })` where the
    forEach body is itself the handler. A committed allowlist,
    `src/data/cta-required-ids.json`, names the known money-button ids that
    must carry `data-cta` as an independent coverage check (any listed id
    absent from `dist/`, or present but untagged, fails); the gate checks
    it against `dist/`. `/` and `javascript:` targets are deliberately out
    of scope for rules 2 and 2b (no money or PII crosses either);
    `500.astro`'s two ids are migrated to `data-cta` by hand as part of
    this change rather than caught by either rule.

    A `type="submit"` button inside a `<form>` that already carries
    `data-cta` is exempt from needing its own tag -- the form-level tag is
    sufficient, per the click-bubbles-to-`closest('[data-cta]')` tracking
    design -- ONLY if the button's own handler (if it has one at all)
    contains no RULE_2B_LITERALS entry. A button that is merely referenced
    for unrelated UI purposes (disabling during submit, feedback text) with
    no click/submit handler of its own stays exempt; a button that
    independently wires its own money/lead action is NOT exempt and needs
    its own tag.
3. Within one rendered page, duplicate `data-cta` values fail (the reason
   for the zone token). Site-wide chrome is exempt from the per-page
   duplicate rule but must be unique within the component.
4. Emits `docs/cta-map.json`/`.md` (generated, committed, never
   hand-edited) as a FAMILY DIGEST: one row per distinct `(page family, cta
   id)` -- `page family` being the cta id's own `page` token, never an
   individual rendered page path -- with `elementType` and `label` (from
   the first occurrence). The digest carries NO counts of any kind. This is
   deliberately NOT one row per rendered page, and it is deliberately not a
   byte-for-byte snapshot either: library, commentary, and course-step
   pages are generated at deploy time from D1 content, so a per-page map
   reshuffles and grows on every routine content publish (measured: 12 MB,
   ~4,650 rows, one per page), and a page-count column on a chrome id
   (header/footer/nav-mobile, present on every rendered page) moves in
   lockstep with the site's total page count for the same reason -- either
   shape would fail `--check` on a deploy that touched zero templates. The
   digest is small (measured: under 10 KB) and changes only when a
   TEMPLATE's CTAs change -- exactly when a developer should recommit it.
   `--check` is therefore a COVERAGE FLOOR over the `(page family, cta id)`
   key set, not an equality comparison: every key present in the committed
   digest must still be present in a fresh build, or the gate FAILS naming
   the missing keys (a template dropped a CTA). A key present in the fresh
   build but absent from the committed digest does not fail -- it WARNs and
   exits 0, because content state can legitimately reveal a template CTA
   that has never rendered before (e.g. a course's closed-cohort waitlist
   modal, which only renders once a cohort actually closes); the developer
   recommits it at leisure. `label`/`elementType` changes on an existing
   key are never compared -- label text is copy and changes legitimately
   without indicating a coverage regression. The FULL per-page map (every
   occurrence, every page) is still produced every dist-mode run, as a
   build artifact at `.cta-map/full.json` (repo root, gitignored,
   regenerated every run, never committed, never part of the `--check`
   comparison, and never written under `dist/` -- that directory deploys to
   the live site verbatim, so an internal debugging artifact must live
   outside it); it exists for local debugging of a specific page. This file
   is the inventory Brian asked for and is what the backoffice CTA table
   labels its rows with.

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
- CTA table: for each `cta` id in the window, clicks, unique `client_id`s,
  `client_id`s reaching `begin_checkout` within the same session,
  `client_id`s with a `purchase` within 7 days, and the resulting rates.
  This is a query of its own, joined on `client_id` rather than the
  funnel's `PERSON_SQL` expression, because `cta_click` rows carry no
  `user_id` (section 4.2); `FUNNEL_EVENTS` and `TYPED_EVENTS` are not
  extended to include it. Labels from `docs/cta-map.json` (fetched from the
  academy repo at build time, vendored read-only like the schema). Pages
  with more than one CTA render as a grouped block so hero versus tiers
  versus footer is one glance.

### 5.2 `/membership` LTV panel

Data: `wix_subscription` has no INSERT anywhere in this repo for a
Stripe-native member -- it is a Wix-era table, and its `cycle_count` column
has no Stripe-era writer at all -- so realized subscription revenue is not
read from it. It comes instead from Stripe paid invoices, read through the
existing restricted key and the `scanStripe()` helper `/membership` already
uses (cached in `REPORT_CACHE` the same way), unioned with `wix_payment`
rows for the Wix era. `wix_subscription` is used only for tier and status
on legacy rows; `cycle_count` is not used anywhere in this panel. Member
identity across sources is the Stripe customer email joined
`COLLATE NOCASE` to `contact`/`user`. `donor_gift` supplies additional
gifts by the same email or contact; `conversion_event` supplies first touch
and entry path for the person.

Definitions, fixed and displayed on the page:

- Realized LTV per member = sum of paid subscription cycles + gifts, cents.
- Monthly churn per segment = lapses in month / active at month start,
  trailing 6 months. When active-at-month-start is 0, the cell renders
  "--" and is excluded from totals rather than dividing by zero.
- Expected lifetime months = 1 / churn, capped at 36 when churn is under
  1/36 -- including when churn is exactly 0 -- so a small or zero-churn
  segment cannot print an infinite number; the cap is applied before any
  division is attempted.
- Expected LTV per segment = ARPU x expected lifetime months.

Four tabs, each a table plus a 12-month sparkline:

1. By plan: member ($9), hero ($19), superhero ($99), complimentary, legacy
   Wix. Complimentary is derived the same way `/membership`'s existing
   `partitionRoster()` already partitions the roster today: staff role
   (`user.role` in mod/admin/superadmin) -- NOT `membership_state`, which
   holds lapse reasons, not complimentary status. Annual does not exist
   today; the column appears when `frequency` first carries a non-MONTH
   value.
2. By acquisition source: `ft_source`/`ft_medium` from the person's
   earliest ledger row carrying `ft_*`. Two buckets hold everyone else, so
   historical members are counted rather than hidden, and split by cause
   rather than lumped together: "before first-touch tracking" for rows
   dated before the 039 deploy date (expected -- the field did not exist
   yet), and "attribution redacted" for rows dated on or after that date
   with `ft_source` still NULL (the value was screened out or genuinely
   absent). Without the split, a redacted row from live tracking would look
   identical to one from before tracking existed.
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
   event; the Ads upload log records the click id; and a second, later ad
   click from the same returning visitor re-attributes the 30-day `gclid`
   cookie for last-click Ads uploads while `rrm_ft` (the first-touch
   record) is unchanged, pinned by a test.
3. Workstream 2 as `cta-map`: lint gate red on a deliberately untagged
   button in CI, including an id-plus-listener button caught only by rule
   2b, green on the tagged tree; `docs/cta-map.json` committed; `cta_click`
   rows appearing within minutes of deploy with the new ids.
4. Workstream 3 as `funnel-cta-and-ltv`: backoffice deploy with the pinned
   wrangler; smoke legs for the new routes; LTV totals tie to `/revenue`
   and `/membership` within one cent for the same window; the CTA table's
   `client_id` join proven on a synthetic click-to-purchase pair.

Reverts: each workstream is one revert; 039 columns are additive and can
stay populated through a revert.

## 8. Out of scope

Annual plans, a gtag-lite bootstrap (D6 of the parent program, Brian's
call), multi-touch models beyond first and last, FSP client sites (the
cookie and lint are portable and become a template feature later), and any
change to the Google Ads campaigns themselves.
