# Provider Directory Fundraiser, Social Proof and Participant Recognition Design

Date: 2026-06-19
Status: Design v2 (arise-revised; awaiting review)
Owner: Brian / RRM Academy
Surface: rrmacademy.org (`rrm-academy-cf`)
Builds on: `2026-06-19-provider-directory-fundraiser-promotion-design.md` (foregrounding) and the held callout core (branch `claude/campaign-callout-core`).

> v2 resolves 15 `/arise --deep` findings (4 CRITICAL) on v1. Material changes: the gift
> count + rank now come from Stripe metadata (the single source of truth that already carries
> the campaign tag and all history), so the `donor_gift.campaign` column and its backfill are
> gone; consent is a Stripe `dropdown` (no `checkbox` type exists) read by key; the donor name
> is reliably collected and the public name is server-derived "Sarah M." (no donor free-text in
> v1); `display_name` is HTML-escaped on every render; refunds tombstone the row; a
> founding-closed state is defined; the supporter insert is atomic with a real `id`.

## 1. Context

The `/providers/` "Support Access to Care" fundraiser shows only a thermometer and a raw count. This adds social proof and participant recognition: animated headline numbers, a live recent-supporter feed, a supporter wall, permanent Founding-Supporter recognition, and a shareable badge. The hard part is a consent + participant-data layer that touches the payments-guarded files.

## 2. Decisions locked

- **Depth:** the full layer (numbers + recent feed + wall + founding recognition + shareable badge).
- **Consent capture:** a Stripe Checkout `custom_fields` **dropdown** ("Yes, show my first name" / "Keep me anonymous"). Stripe has no `checkbox` custom-field type.
- **Founding tier:** the first N gifts in the campaign sequence (`FOUNDING_CAP = 100`, configurable).
- **No individual amounts** public. The aggregate raised total (thermometer) stays public.
- **Display form:** opt-in only, server-derived first name + last initial ("Sarah M."). No donor free-text name in v1. Default is anonymous.
- **Recipient:** always the RRM Foundation 501(c)(3).

## 3. Architecture (Approach A: data-first)

- **Phase 1, data (payments-guarded):** consent capture + name collection, the `supporter_recognition` D1 table, the webhook persist path, the refund tombstone path, and the `/api/fund-supporters` read endpoint. No public UI; supporters accrue.
- **Phase 2, UI (content-gated, behind go-live):** stats-2 + recent ticker + supporter wall + Founding recognition + shareable badge, reading the endpoint, composed into the held `CampaignCallout` + `/providers/` + the homepage band (via snapshot).

**Single source of truth for the gift count:** Stripe. The succeeded, not-fully-refunded PaymentIntents with `metadata.campaign='provider-directory'` are THE count, exactly as `functions/api/fund-progress.js` already queries them. The thermometer, the "Supporters" stat, `founding_left`, and the per-gift sequence all derive from this one source, so they cannot disagree. D1 (`rrm-auth`, binding `DB`) holds only the consented display rows.

## 4. Capture (Phase 1, payments-guarded)

`functions/api/create-checkout.js` (GUARDED), for `campaign === 'provider-directory'` `mode:'payment'` sessions only:
- `billing_address_collection: 'required'` so `customer_details.name` is reliably populated (it is NOT guaranteed for `mode:payment` otherwise, especially for wallet/Link payers). The server derives the public name from this; the donor never types a public name in v1.
- One `custom_fields` entry, type **`dropdown`**, key `show_supporter`, options `[{label:'Yes, show my first name as a public supporter', value:'yes'}, {label:'Keep me anonymous', value:'no'}]`, optional, default unselected (treated as no).

No `checkbox` type (it does not exist in Stripe). The optional donor-chosen display name is DEFERRED to a later version that ships with a moderation gate (see §9, §11).

## 5. Persist (Phase 1, payments-guarded)

`functions/api/billing/_webhook-checkout.js` (GUARDED) via a new `functions/api/billing/_supporter-gift.js` helper, on `checkout.session.completed`, `mode==='payment'`, `metadata.campaign==='provider-directory'`:
- Read consent by KEY (never by array index): `const f = (session.custom_fields||[]).find(c => c.key==='show_supporter'); const consented = f?.dropdown?.value === 'yes';`. If not consented, write no row (anonymous); the gift still counts via Stripe.
- Derive the display name from `customer_details.name`, all arities: split on whitespace; 2+ tokens -> `First` + " " + `Last[0]` + "." ("Sarah Martinez" -> "Sarah M."); exactly 1 token -> that token ("Cher"); empty/null after trim -> write NO row (treat as anonymous, never insert an empty `display_name`). NFKC-normalize, strip bidi-override (U+202A..U+202E, U+2066..U+2069) and zero-width chars, strip `<` `>` `&` `"` `'`, cap by grapheme count to 40.
- Capture `gift_seq` = the count of succeeded campaign PaymentIntents from Stripe at this moment (the same search `fund-progress.js` runs). This is the gift's true sequence position over ALL gifts (consented or not, including pre-existing ones, because Stripe metadata holds the full history). Under rare concurrency two gifts can read the same `gift_seq`; this is cosmetic mid-list and accepted, and the founder set is reconciled at read by `gift_seq <= FOUNDING_CAP`.
- Generate `id = 'sr_' + crypto.randomUUID()` in the helper (never insert a NULL id). Insert with `ON CONFLICT(source, source_id) DO NOTHING` (never `INSERT OR REPLACE`, which would rewrite `gift_seq` on a replay).
- **Atomicity:** the supporter insert is NOT independently fail-soft. It runs in the same `db.batch()` as the existing `donor_gift` write so that a failure surfaces as a 5xx, the webhook envelope rolls back (`webhook_event` is not marked completed), and Stripe re-delivers for a clean retry (the `ON CONFLICT` makes retry safe). This avoids the v1 trap where a fail-soft insert that failed after `completed_at` was stamped silently and permanently dropped a consenting supporter.

### Refund / removal (payments-guarded)

`charge.refunded` already has a live handler (`stripe-webhook.js` -> `_webhook-refund.js`). Extend it: on a refund of a provider-directory gift, tombstone the matching `supporter_recognition` row by `source_id = payment_intent` (delete it). A refunded donor leaves the public wall and frees their founding slot. Add `_webhook-refund.js` to the guarded edit set. Plus a documented manual "take me down" procedure for plain consent-withdrawal/GDPR requests (a single targeted DELETE by `source_id` or `id`).

### Schema (D1 `rrm-auth`, `migrations/031-supporter-recognition.sql`)

```sql
CREATE TABLE IF NOT EXISTS supporter_recognition (
  id TEXT PRIMARY KEY,                   -- 'sr_' + crypto.randomUUID(); never NULL
  campaign TEXT NOT NULL DEFAULT 'provider-directory',
  display_name TEXT NOT NULL,            -- server-derived "Sarah M." ONLY; no full name, no free-text
  gift_seq INTEGER NOT NULL,             -- true sequence position over ALL campaign gifts (from Stripe at insert)
  email TEXT COLLATE NOCASE,             -- PRIVATE: dedup / contact link; NEVER returned by the read endpoint
  source TEXT NOT NULL CHECK (source IN ('stripe')),
  source_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_supporter_recognition_campaign ON supporter_recognition(campaign);
CREATE INDEX IF NOT EXISTS idx_supporter_recognition_giftseq ON supporter_recognition(gift_seq);
CREATE INDEX IF NOT EXISTS idx_supporter_recognition_occurred ON supporter_recognition(occurred_at);
```

No `donor_gift` change (the v1 `ALTER ... ADD campaign` is gone, with its backfill + dual-writer problems). No `amount` column. `founding` is computed at read (`gift_seq <= FOUNDING_CAP`), not stored. This project has no migration runner; the Phase-1 plan applies `031` by hand (`wrangler d1 execute rrm-auth --remote --file=...`, mirroring the `030` header ritual) and verifies `supporter_recognition` exists BEFORE the dependent code deploys.

## 6. Read endpoint (`functions/api/fund-supporters.js`)

GET `/api/fund-supporters`. The campaign is HARDCODED to `provider-directory` (no `?campaign=` input, matching `fund-progress.js`); `limit` is validated to an integer in `[1,12]` with a default. `COMMUNITY_KV` 60s cache, rate-limited 30/60s per IP. EVERY failure path (missing binding, D1 error, KV error, Stripe error) returns HTTP 200 with the empty-but-valid payload below so the page always renders (it does NOT mirror `fund-progress.js`'s 503-on-missing-key path).

`total_gifts` + `founding_left` come from the SAME Stripe source as the thermometer (share the `fund-progress` KV value or recompute it identically, netting full refunds out of the count). The consented names come from D1 with an EXPLICIT column projection (never `SELECT *`, which would pull the private `email`):

```sql
SELECT display_name, gift_seq FROM supporter_recognition
WHERE campaign='provider-directory' AND gift_seq <= ? ORDER BY gift_seq ASC          -- founding
SELECT display_name, gift_seq FROM supporter_recognition
WHERE campaign='provider-directory' ORDER BY occurred_at DESC LIMIT ?               -- recent
```

Response (only `display_name` + `gift_seq` per supporter; never email/full-name/amount/`occurred_at`):
```
{
  ok: true,
  total_gifts,                  // Stripe: succeeded, not-fully-refunded campaign PaymentIntents
  consented_count,              // rows in supporter_recognition for the campaign
  recent: [ { displayName, seq } ],
  founding: [ { displayName, seq } ],          // gift_seq <= founding_cap
  founding_cap,                 // 100
  founding_left,                // max(0, founding_cap - total_gifts)
  founding_closed,              // founding_left === 0
  anonymous_founders            // max(0, min(total_gifts, founding_cap) - (founding.length))
}
```

## 7. Display (Phase 2, content-gated), composing into the held callout

- **stats-2** (existing experimental port; first production placement): three count-up cards, **Supporters** (`total_gifts`) / **Raised** (the thermometer aggregate) / **Founding spots left** (`founding_left` of `founding_cap`). When `founding_closed`, the third card reads "Founding complete" and stops counting down. Live on `/providers/`; the homepage band + `/donate/` read the snapshot.
- **Recent-supporter ticker** (bespoke, token-driven): `recent` names, no amounts.
- **Supporter wall** (bespoke): initials circles ("SM") for `recent`/all consented + "and N who gave anonymously" (`total_gifts - consented_count`).
- **Founding Supporters** recognition (bespoke): the `founding` list, named + a founding badge, + "and N anonymous founders" (`anonymous_founders`). When `founding_closed`, the section header reads "Founding Supporters" with no "become a founder" CTA anywhere (live or snapshot) and the badge drops "Founding" framing for non-founders.
- **Shareable badge** on the thank-you page (`src/pages/donate/thank-you.astro`): "I am building the RRM Provider Directory, Supporter #N" (`gift_seq`) as a satori image via `functions/og/`, with `display_name` inserted as a TEXT node only.
- **HARD render contract (escaping):** `display_name` is treated as untrusted on every surface. `.astro` uses `{expr}` (auto-escaped); any `innerHTML` / template-string / `set:html` path AND the snapshot-fed ticker use an explicit `escapeHtml()` (all five entities); the satori badge uses text-node insertion. No render path interpolates `display_name` into raw markup.
- **Snapshot:** the Plan-A `campaign-snapshot.json` carries `{ recent, total_gifts, founding_left, founding_closed }`, refreshed out-of-CI by `update-campaign-snapshot.mjs` (which GETs `/api/fund-supporters`). The band renders founding scarcity ONLY from `founding_closed`/`founding_left` and suppresses all "become a founder" copy once `founding_closed` is true, so a stale snapshot cannot keep promising founding spots after the cap fills (a stale low raised total is benign; a stale open-founding claim is not).

## 8. Primitives

`stats-2` (port, promote) + `tap-press`. The ticker, supporter wall, and Founding recognition are **bespoke** (token-driven, design-system-matched), because they need the no-amount / initials / anonymous-count / escaping shaping no registry component provides.

## 9. Privacy and guardrails (hard)

- Default anonymous: no `supporter_recognition` row without a `show_supporter='yes'` dropdown value.
- The public table/endpoint hold/return only the server-derived first-name + last-initial + `gift_seq`. Never email, full name, amount, or `occurred_at`. The read endpoint uses explicit column projection, never `SELECT *`.
- `display_name` is server-derived (no donor free-text in v1), NFKC-normalized, bidi/zero-width/`<>&"'`-stripped, grapheme-capped 40, and HTML-escaped at every render. An impersonation check rejects derived names containing "RRM", "Academy", "Official", or staff names; on a hit, write no row. The donor-chosen display-name field ships only with a moderation/denylist gate + an admin takedown path (deferred, §11).
- Refund and removal: `charge.refunded` tombstones the row; a documented manual takedown handles consent-withdrawal/GDPR.
- Single Stripe source for the count: thermometer, "Supporters", `founding_left`, and `gift_seq` all derive from the same succeeded-not-refunded campaign PaymentIntents, so no two surfaces disagree.
- Recipient always RRM Foundation 501(c)(3); honesty (fund the work; no "be a founder" solicitation once `founding_closed`); no em dashes; no absolutist copy.
- Payments-guarded files (`create-checkout.js`, `_webhook-checkout.js`, `_webhook-refund.js`, new `_supporter-gift.js`, `fund-supporters.js`) ship through the `coder` agent with `npm run guard:update` + `npm run gates:payment` (PG1-PG4) in their one commit. The supporter insert is in a `db.batch()` (no independent fail-soft); no dedup re-implementation; no `err.message` leak.
- The migration (031) is applied + verified before the dependent code deploys.

## 10. Measurement

`total_gifts`, consent opt-in rate (`consented_count / total_gifts`), Founding fill (`founding_left`), and the one-time -> recurring conversion (the foregrounding spec's STUC hook). Recognition is itself a conversion lever.

## 11. Out of scope / deferred / open items

- The recurring/STUC hook and the reframe live in the foregrounding spec, not here.
- `FOUNDING_CAP` value (100 proposed) and any re-open-after-close policy: confirm at plan time. v1 closes founding at the cap (`founding_closed`), permanently.
- The donor-chosen display-name free-text field + its moderation/denylist + admin takedown UI: deferred. v1 uses the server-derived "Sarah M." only.
- Avatar images are not collected (initials only).
- `gift_seq` concurrency collision is accepted as cosmetic mid-list; flagged here so it is a known, not a surprise.
- Go-live: Phase 2 public copy/sections ship behind explicit go-live; Phase 1 (data) ships normally so data accrues.

## 12. Build surface

**Phase 1 (data plan, payments-guarded):** migration `031` (`supporter_recognition` only) + manual apply step · `create-checkout.js` (`billing_address_collection:'required'` + the `show_supporter` dropdown, campaign-gated) · `_supporter-gift.js` helper (consent-by-key, name derivation, Stripe `gift_seq`, `id` gen, `ON CONFLICT DO NOTHING`) + `_webhook-checkout.js` `db.batch()` persist · `_webhook-refund.js` tombstone · `functions/api/fund-supporters.js` (Stripe count + D1 names, hardcoded campaign, limit-capped, always-200, explicit projection) · `guard-manifest.json` (`guard:update`) + `validate-payment-pipeline.mjs` PAYMENT_FILES additions.

**Phase 2 (UI plan, content-gated):** `stats-2` wiring (+ founding-closed state) + bespoke `ticker` / `supporter-wall` / `founding-recognition` (escaping contract) · composition into `CampaignCallout` + `/providers/` + `/donate/` · the thank-you shareable badge (text-node `display_name`) · the `campaign-snapshot.json` + `update-campaign-snapshot.mjs` extension (founding_closed). Depends on Phase 1's endpoint + the held callout core.
