# Provider Directory Fundraiser, Foregrounding and Promotion Design

Date: 2026-06-19
Status: Design v2 (arise-revised; awaiting review)
Owner: Brian / RRM Academy
Surface: rrmacademy.org (`rrm-academy-cf`)

> v2 resolves 15 findings from `/arise --deep` on the v1 spec (5 HIGH, 8 MEDIUM, 2 LOW).
> Material changes: a parameterized fund-progress precondition for reuse, a build-time
> snapshot for the homepage band, a shared thermometer module, a `campaigns.json` store,
> an explicit conversion-tracking hook, a relaunch transition plan (§7, directory stays at
> `/providers/`), a foreground ceiling (§6), honesty guardrails bound to funding the work,
> and the footer link carved out of the reframe.

## 1. Context

`rrmacademy.org/providers/` is a LIVE, indexable one-time-gift fundraiser ("Support Access
to Care"). It funds building the verified RRM Provider Directory. The directory LISTINGS
stay offline (standing decision, memory `provider-directory-keep-offline`); only the
fundraiser is live. Recipient is the RRM Foundation 501(c)(3) (EIN 93-4594315), never
"donate to RRM Academy". The live thermometer reads `/api/fund-progress`
(campaign=`provider-directory`).

Today the fundraiser is barely surfaced: a footer "Find a Provider" link, the app-shell
sidebar (already labeled "RRM Providers / Soon"), ~13 pillar/method cross-links, and the
page itself. Brian wants it foregrounded much more than now, prominent and unmissable, but
NOT a literal site-wide takeover.

(Adjacent, just shipped: per-page OG cards now auto-derive from each page's rendered title
and description via `scripts/augment-og-index.mjs`, and `/providers/` unfurls a correct
fundraiser card at `OG_VERSION=v5`. Changing the page title or adding a homepage band does
not create a stale OG state; cards re-derive at build.)

## 2. Strategy frame (decisions locked)

- **Goal:** momentum + donor PIPELINE. $10,000 is a milestone, not the ceiling. Because it
  is not the ceiling, the design MUST define an over-goal state (§3.1); a thermometer that
  hard-caps at 100% while copy keeps asking would signal "campaign over" and contradict the
  evergreen intent.
- **Audience:** warm first (STUC members, the newsletter list, Naomi's IG ~40K), then cold
  (allies, press, SEO/AEO).
- **On-site prominence:** foreground prominently within the §6 ceiling; NO site-wide
  ribbon/takeover.
- **STUC integration:** messaging-level (§3.6). Membership is unrestricted mission support;
  the directory is one thing that support makes possible. No fund earmarking.
- **Educational Partners:** DECOUPLED, separate track, concept-stage, not in this design.
  "Partner amplification" in §4 means informal aligned allies, not the formal program.

## 3. On-site architecture (Approach A: hub + reusable callout)

`/providers/` stays the campaign HUB. Everything else points into it through one reusable
component.

### 3.1 Reusable component, `CampaignCallout.astro`

**Data store:** a NEW `src/data/campaigns.json` (NOT an extension of `funding-projects.json`,
whose 5 rows have no goal/campaign fields and must stay untouched). Each record:
```
{ id, eyebrow, headline, one_liner, cta_label, cta_href, goal_cents, campaign_key, status }
```
`cta_href` is PER-RECORD (the provider-directory record uses `/providers/#give`); it is not
hardcoded for all campaigns. `goal_cents` is REQUIRED.

**Thermometer data source, and the reusability precondition:** `/api/fund-progress` is
single-campaign by construction (`CAMPAIGN='provider-directory'` and `GOAL_CENTS` are module
constants; `KV_KEY` is campaign-fixed; the Stripe query hardcodes the campaign). Therefore:
- For the provider-directory campaign it works as-is.
- For ANY OTHER campaign the component is layout-only until `/api/fund-progress` is
  parameterized to accept a validated `?campaign=` (allowlisted keys, per-campaign
  `GOAL_CENTS` and `KV_KEY`, per-campaign Stripe filter). Reuse for a second live total is
  blocked on that endpoint change. The component MUST NOT render a second campaign's live
  total against the provider-directory endpoint (it would show the wrong number).

**Homepage band data source (do NOT live-fetch on the apex):** the homepage is the
highest-traffic surface. The `band` variant MUST render the raised total from a build/deploy
snapshot (or a long-TTL cached value), NOT the per-visitor `fetch('/api/fund-progress')` the
`/providers/` page uses. A per-visitor live fetch on the apex multiplies calls to a
rate-limited, Stripe-backed endpoint exactly during the launch-traffic bursts §4 is built to
create, degrading the band to $0 and 429-ing shared-NAT visitors. The `card` variant on
`/providers/` and `/donate/` may live-fetch (low traffic).

**Shared fail-soft module:** extract the thermometer fetch + fail-soft + type-guard into a
shared module (e.g. `src/scripts/fund-thermo.ts`) that both `/providers/` and
`CampaignCallout.astro` import. Contract: on any response that is not
`{ raised_cents: number }`, render $0 / 0% and never throw. The current fail-soft lives only
as an inline IIFE on `/providers/`; "mirroring the page script" is not inheritance, so a
hand-copied band that drops the catch ships a broken homepage thermometer.

**Missing/zero goal guard:** if `goal_cents` is missing or `<= 0`, the component renders
goal-only (no thermometer), never `raised / undefined` (which yields `NaN%` width and
`aria-valuemax="undefined"`).

**Over-goal state:** define the `raised >= goal` render explicitly: either a data-driven
stretch goal (next milestone in `campaigns.json`) or a "goal met, every gift now sustains
it" variant. The component must never present a terminal, visually-complete 100% bar while
the campaign is evergreen.

Variants: `band` (slim, homepage, snapshot total) and `card` (donate page, end-of-content,
may live-fetch).

### 3.2 Homepage
One `band` callout placed high (after the hero trust strip), using the snapshot total per
§3.1. Exact slot and visual treatment confirmed on a mockup, evaluated against the §6
foreground ceiling.

### 3.3 `/donate/`
Add the provider-directory record to `campaigns.json` and render the `CampaignCallout`
`card` variant directly on `/donate/`, above the existing project cards. NOTE: the current
`/donate/` render is a plain array-order map of `funding-projects.json` with no
featuring/ordering primitive and no per-card thermometer or CTA; "featured/pinned" is
delivered by placing the `CampaignCallout` card above that loop, not by adding a sort/pin
field to `funding-projects.json`.

### 3.4 Existing "Find a Provider" entry points (honesty fix)

Reframe the cross-links that promise "Find a Provider" but land on the fundraiser, so the
click-promise matches the destination. Scope and rules:

- **Footer link is OUT of scope** per the standing owner decision (2026-06-10): the footer
  "Find a Provider" link (`Footer.astro`) stays as-is and is not renamed or repointed. (If
  that decision is being reopened, record it explicitly first.)
- **App-shell sidebar** is already labeled "RRM Providers / Soon" (not "Find a Provider");
  confirm copy, no dead-end claim needed there.
- **Enumerate the exact target surfaces**, do not estimate "~12". The set includes the
  pillar/method pages (`endo-survey`, `fertility-awareness-methods-compared`,
  `rrm-success-rates`, `creighton-model`, `fertility-preserving-surgery`, `marquette-model`,
  `billings-ovulation-method`, `sympto-thermal-method`, `twoday-method`, `boston-cross-check`,
  `fertility-awareness-method-quiz`) AND the AI-readable surfaces (`ai-instructions`).
- **Include the JSON-LD copies.** Several of those pages embed "Find a Provider" /
  `/providers/` language inside FAQPage `answerHtml` / `acceptedAnswer`. The codebase
  requires verbatim parity between the visible FAQ block and the schema; reframing visible
  copy without the schema text corrupts that parity. The reframe pass MUST update both.
- **Use a shared CTA constant/component** for the reframed text so the sweep is one edit and
  the §7 relaunch flip is one edit, not a 15-file hand sweep, and so a new page cannot
  silently reintroduce the old promise.
- **SEO note (intentional):** dropping the high-intent "find a provider" anchor phrase is
  deliberate. `/providers/` is a fundraiser, not a directory; it should not rank for that
  patient-intent query (cross-ref `rrma-not-patient-funnel-to-naomi`).

### 3.5 Navigation
No new top-level nav item. Surface the campaign through the existing Donate CTA. (Counts
toward the §6 ceiling.)

### 3.6 STUC integration (recurring arm) and conversion tracking
STUC is the ongoing arm; `/providers/` is the one-time/acquisition arm. They cross-feed:
- `/save-the-uterus-club/` join page: the directory as one "what your membership makes
  possible" impact point, secondary to community/events/Dr. Whittaker.
- Members area: surface the directory total (reuse the snapshot per §3.1; do not add a new
  per-visitor fetch).
- `/providers/`: a soft "make your support ongoing, join Save the Uterus Club" path near the
  one-time gift.
- Honesty: "your membership helps build and sustain the directory for everyone." Never
  "members get the directory" and never imply restricted funds (messaging-level).

**Conversion tracking (required for the §5 metric):** the one-time -> STUC conversion is
unmeasurable as-is, because the STUC subscription checkout carries no `campaign` and an
anonymous one-time donor shares no key with a later membership. Pick one and build it:
(a) capture email/account on the one-time gift and key conversion on email match, OR (b) tag
the STUC join initiated from the `/providers/`->STUC path with `campaign='provider-directory'`
(or `source`) and pass `campaign` through the SUBSCRIPTION branch of `create-checkout.js`
(today it is written only on the payment branch). Without (a) or (b), drop the metric from §5.

## 4. Promotion engine (warm-first, two-stage funnel)

Funnel: acquire a one-time gift at `/providers/`, convert to ongoing via STUC, steward into
repeat/major gifts.

### 4.1 Channel sequence
- **Wk 0, Email (newsletter):** announcement (the human "9-year wait" story + the
  thermometer). Segment: non-members get "give + sustain via STUC"; existing STUC members
  get "you are already building this, progress + please share".
- **Wk 0, STUC community:** members-area post + mention at the next event, in club voice
  (from Dr. Whittaker / community@).
- **Wk 0, Instagram:** Naomi posts (her ~40K) in her voice + story link sticker; RRMA runs
  the "9-year wait" carousel. Naomi posts herself; schedule, never block on her. Never
  scrape Naomi's IG.
- **Wk 1-2, Email + IG:** impact touch + a milestone beat. Informal aligned allies amplify.
- **Wk 3+, Press + SEO/AEO:** EIN Presswire release (no borrowed/major logos). The indexable
  page keeps pulling organic top-of-funnel.

### 4.2 Momentum mechanics (urgency without a fake deadline)
- **Challenge/match:** if used, it is a MANUAL, amount-or-time-bounded `campaigns.json` field
  with a named operator turn-off step (who flips it off when the pool is spent). The
  data-driven callout has NO automatic match tracking, so an unbounded "your gift is matched"
  line would keep soliciting under a false promise after exhaustion. Either bound it as
  described or descope it from the callout until real match tracking exists. Needs one
  matching donor (§9).
- **Milestone re-shares** at 25/50/75% (and a defined 100%+ state per §3.1).
- **Founding-supporter** recognition (optional; can tie to a STUC badge).

### 4.3 Pipeline mechanics
Every one-time donor: thank-you + invite to newsletter and STUC, then a short "what your
gift is building" stewardship cadence. Conversion is measured via the §3.6 hook.

### 4.4 Messaging spine
Evergreen frame "Support Access to Care"; the human "9-year wait" story; the directory framed
as funding the WORK (verification, infrastructure), per the §6 honesty guardrail. RRM content
rules apply (§6).

## 5. Measurement
$ raised (live/snapshot), # donors, one-time -> STUC conversion rate (only if the §3.6 hook is
built), email capture, channel attribution, repeat-gift rate.

Attribution note: the `/providers/` page passes `entry_referrer`/`entry_url` to
`/api/create-checkout`, which DERIVES and stamps `ga_source` / `ga_medium` / `ga_entry_*`
metadata. The raw `entry_referrer`/`entry_url` strings are NOT stored in Stripe metadata;
reporting must query the `ga_*` keys, not the raw fields.

## 6. Guardrails (hard)
- Recipient is always RRM Foundation 501(c)(3); never "donate to RRM Academy".
- Honesty: bind messaging to funding the WORK ("your gift funds verification and the work
  toward a verified directory"). Do NOT use launch-commitment or timeline language ("is
  coming", "will launch", "launches once X"), because the listings stay offline indefinitely
  with no committed date; soliciting tax-deductible gifts against a fixed deliverable that may
  not ship is a 501(c)(3) representation risk. Reframe the existing live `/providers/` "When
  will the directory launch?" FAQ to the funding-the-work frame too.
- Directory framed as work in progress; never "search now".
- No patient funnel to Naomi (rrmacademy.org must not route patients to Naomi).
- No absolutist patient copy; no "this is not X" negation-reframe; no em dashes.
- **Foreground ceiling (not a takeover):** global chrome gets AT MOST ONE of {footer-reframe
  (currently frozen, so effectively the sidebar or a homepage band)} plus the homepage band;
  do not stack a homepage band AND a global ribbon AND a sidebar push. Content-page
  cross-links are honesty fixes, not new placements. The homepage-band mockup (§9) is
  evaluated against this ceiling. No site-wide ribbon.
- Content-publication changes (live copy reframes, new homepage section) ship behind an
  explicit go-live; technical build is in-scope.

## 7. Relaunch transition (the campaign evolves, it does not end)

The directory stays at `/providers/` (its long-intended home). Relaunch is a transition, not
a teardown: the fundraising does not stop when the directory goes live. The live directory and
an ongoing "Support Access to Care" ask co-exist (the directory page can carry a "help sustain
and expand this" element), and the campaign messaging evolves from "help build it" to "help
sustain and grow it." Relaunch is a flip-and-adjust, not a rip-out.

What makes the flip cheap (and is why §3.4 mandates the shared constant):
- The reframed CTA text lives in ONE shared constant, so flipping "help build it" to "help
  sustain it" sitewide (including the JSON-LD copies) is a single edit.
- The homepage band and donate card are removable/editable components, so moving where the
  ongoing ask lives is a placement change, not a content rewrite across 15 files.
- §3 placements are enumerated, so nothing is missed at the flip.

A new directory path was considered and rejected: it would forfeit `/providers/` as the
natural, highest-intent directory URL only to avoid a "teardown" that, framed correctly, is a
messaging evolution.

## 8. Out of scope / deferred
- Educational Partners launch (separate track, separate future spec, concept-stage).
- Provider booking-software "upgrade" (separate track). A COMMERCIAL offering; likely belongs
  under Whittaker AI LLC (for-profit practice-tooling), integrating with the directory as a
  "book" action on opt-in listings rather than under the RRM Foundation 501(c)(3). Flagged for
  entity/UBI review.
- On-page recurring-donation widget; STUC IS the recurring path.
- Directory listings relaunch (offline per `provider-directory-keep-offline`); see §7 for the
  relaunch transition (directory stays at `/providers/`; the campaign evolves, it does not end).

## 9. Open items (resolve at plan/execution time)
- Exact homepage slot + callout visual, on a mockup, evaluated against the §6 ceiling.
- Matching donor for the challenge/match lever (and who owns the turn-off).
- Go-live approval for the content reframes (pillar pages + their JSON-LD, FAQ copy).

## 10. Build surface (feeds the implementation plan)
On-site, buildable: `campaigns.json` (new store, required `goal_cents` + per-record
`cta_href`/`campaign_key`); `src/scripts/fund-thermo.ts` shared module (fetch + fail-soft +
guard); `CampaignCallout.astro` (`band` snapshot variant + `card` live variant + missing-goal
guard + over-goal state); a build/deploy snapshot of the provider-directory total for the band;
homepage band; `/donate/` card; the enumerated §3.4 reframe behind a shared CTA constant
(including JSON-LD `answerHtml` parity); STUC join impact point + members-area snapshot total +
`/providers/`->STUC path; the §3.6 conversion-tracking hook (email capture OR `campaign` on the
STUC subscription branch of `create-checkout.js`). Conditional: parameterize `/api/fund-progress`
with a validated `?campaign=` ONLY if a second campaign needs a live total. Promotion (§4) is
execution, not code.
