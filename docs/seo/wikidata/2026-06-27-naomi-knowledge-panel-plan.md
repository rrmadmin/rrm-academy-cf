---
title: Naomi Whittaker Google Knowledge Panel — plan
created: 2026-06-27
method_source: https://benobi.one/panel (Ben Sigman, "Knowledge Panel without Wikipedia", 73-day recipe)
entity: Wikidata Q139936526 (Naomi Whittaker), ORCID 0000-0003-3706-3112, NPI 1881034908
owner: Brian (gate) + Naomi (self-edits via her own Comet account, NEVER mowsenter)
status: BUILT — held at the two decision gates in §7 + the UPMC-sensitive items in §6
related: naomi-canonical-bio.md, naomi-profile-registry.md, naomi-wikidata-self-edit-comet.md,
  feedback-lunira-launch-language, wikidata-entity-strategy, orcid-openalex-binding-mechanics
companion: 2026-06-27-naomi-knowledge-panel-comet-handoff.md (the chunked execution doc)
---

# Naomi Whittaker — Google Knowledge Panel plan

## 1. TL;DR

A Google Knowledge Panel (the right-rail bio card in search) is auto-instantiated, not applied for. You feed Google the right entity signals and it builds one. Ben Sigman documented a 73-day path with no Wikipedia, no PR firm, no paid service. His own words: "You don't apply. You give it the right signals, and Google instantiates one."

We are roughly 70% of the way there already. Naomi's Wikidata item exists and is well-populated, and rrmacademy.org/about already carries a complete Person JSON-LD that bridges to Wikidata + ORCID. The single highest-leverage step we never did is the one Sigman calls "the unlock": a Wikimedia Commons headshot linked to the Wikidata item via property P18. His panel appeared about 5 weeks after he did exactly that.

This plan closes the gap inside the existing UPMC-separation hold boundary by anchoring the whole push on Naomi's portable author / educator / RRM Academy founder identity, which is true regardless of where she practices and never touches the clinical-address surfaces under hold.

## 2. The recipe (Sigman)

| Step | Action | Notes |
|------|--------|-------|
| 1 | Person JSON-LD on the homepage with a `sameAs` array bridging to Wikidata | "site-side bridge to Wikidata" |
| 2 | Wikidata Q-item, every substantive claim referenced (P854) | unreferenced claims risk deletion nomination |
| 3 | **Wikimedia Commons headshot (CC-BY-SA 4.0) + Wikidata `P18`** | THE UNLOCK. "single highest-impact step." Panel ~5 weeks later |
| 4 | Cross-platform consistency: same city, same title, same bio everywhere | LinkedIn, X, Crunchbase, Amazon, etc. |
| 5 | Wait ~5–10 weeks, do not tweak during the crawl window | "Let Google's crawl cycle catch up" |

What you do NOT need: a Wikipedia article (his was rejected for LLM drafting and insufficient notability; the panel appeared anyway), a PR firm, tier-1 press, or a "claim your panel" service.

Gotchas he flags: purge the CDN cache after every schema deploy (Googlebot indexed stale schema once); never use self-promotional language ("leading", "pioneering", "bestselling"); never tweak the panel after it goes live (can trigger retraction).

## 3. Live gap map (verified 2026-06-27, not from memory)

| Recipe step | Naomi status | Detail |
|---|---|---|
| 1. Homepage Person JSON-LD + sameAs bridge | **DONE, well** | rrmacademy.org/about: `Person` node, `sameAs` includes both `Q139936526` and ORCID, plus jobTitle, description, image, structured `identifier[]` (ORCID/NPI/OpenAlex/ABOG), 6 credentials, knowsAbout. This is the bridge, live. |
| 2. Wikidata Q-item | **EXISTS, minor polish** | Q139936526 has 13 properties incl. occupation×3, employer UPMC, education, ORCID, NPI, OpenAlex, names, field of work, P800 notable work. |
| 3. Commons image + P18 | **MISSING — the gap** | No `P18` on the item, no Commons upload. This is the unlock. |
| 4. Cross-platform consistency | **Failing on 3 axes** | See §3a. |
| 5. Wait | n/a | Blocked on step 3. |
| Existing Google panel? | **None confirmed** | No `P2622` (Google KG ID) mapped; nothing in SERP probes. Treat as not-yet-established. A thin directory-driven "doctor card" cannot be fully ruled out (region/personalization), but no dedicated panel. |

### 3a. Cross-platform findings

- **X display name is literally `NaPro_Fertility_Surgeon`**, not her real name (handle is @naomimwhittaker). Actively harmful for entity name-matching. Highest-value, lowest-effort fix.
- **Credential byline drifts across patient/marketing surfaces:** rrmacademy.org/about = `MD, Board-Certified OBGYN, MIGS, NFPMC, FCI` (canonical); bio.site swaps in `FACOG` and drops `MIGS`; Instagram = `MD, OBGYN` only.
- **ORCID prose writes `IRRMA`** (should be `IIRRM`). Wrong abbreviation on a high-authority surface.
- **No consistent city** anywhere; absent on 5 of 6 surfaces.

### 3b. Verified-and-cleared (do NOT "fix")

- `P800` notable work = `Q140180632` "Tuboplasty" is **correct**. Q140180632 is her book chapter (desc "book chapter by William Nolan and Naomi Whittaker", P31 scholarly chapter, DOI 10.1201/9781003312109-33, author Q139936526). The audit's "semantically odd" flag was wrong; verified at source. Leave it.

## 4. Reconciling "same everywhere" with our register SSOT

Sigman's step 4 says "same title, same bio everywhere." Naomi's canonical-bio SSOT says the opposite for name forms: the correct byline is register-dependent (patient/marketing byline keeps "Dr." and drops the middle initial; academic byline drops "Dr." and adds "M."), and variance is correct as long as every surface binds to her ORCID.

These are not in conflict once you separate two things:

1. **Entity identity** (what Google's resolver needs): every surface must point to the SAME entity. That is the ORCID + Wikidata `sameAs` binding, which we already have on the bridge surface and want to extend. Name FORM may vary by register without breaking the binding.
2. **Within-register credential accuracy** (what the audit flagged): on patient/marketing surfaces specifically (bio.site, Instagram, X), the credential string should be the canonical marketing byline `MD, Board-Certified OBGYN, MIGS, NFPMC, FCI`. The `FACOG`-for-`MIGS` swap on bio.site is a genuine within-register error, not legitimate register variance. `FACOG` is not in the SSOT credential set.

So our implementation of step 4 is: **same entity everywhere (binding), consistent credential string within the patient/marketing register, real name as the display name** — NOT literal string identity, which would violate the register SSOT.

## 5. The plan (tiers)

All Wikidata / Commons / social edits run through **Naomi's own account via Comet**, one chunk at a time, never the mowsenter account (mowsenter must stay un-deanonymized; letting Naomi's identity touch it breaks the COI separation). Execution chunks are in the companion handoff doc.

- **Tier 1 — the unlock (highest leverage):** Naomi releases one headshot under CC-BY-SA 4.0, uploads to Wikimedia Commons, adds `P18` to Q139936526. Expected effect ~5 weeks later.
- **Tier 2 — hold-safe Wikidata polish:** add `P856` official website = `https://rrmacademy.org/about/` (completes the bidirectional bridge: schema sameAs → Wikidata, Wikidata P856 → /about). Optionally add references to the substantive unreferenced claims (low priority; none are deletion-risk).
- **Tier 3 — hold-safe consistency:** fix X display name to her real name; align the bio.site credential string to the canonical marketing byline; fix ORCID `IRRMA` → `IIRRM`.
- **Tier 4 — verify + monitor:** query the Google Knowledge Graph Search API to definitively settle whether any KG entity exists; after `P18` lands, monitor an incognito/region-controlled SERP; add `P2622` once Google assigns a KG ID.

## 6. Hold boundary (UPMC separation)

The 2026-05-06 hold on Naomi profile updates is scoped to **clinical-address surfaces** (NPPES, payer directories, Healthgrades) for litigation-complication risk. The Knowledge-Panel lane is the carved-out exception: her Wikidata item is already being self-edited post-hold (2026-06-11), and [[feedback-lunira-launch-language]] explicitly allows the "RRMA-founder link."

Two items brush the hold and stay HELD until Brian clears them:

- **City (P551 / social location fields):** asserting a clinical city is hold-sensitive, and her home city is private. Recommendation: skip residence entirely. The image is the unlock, not the city; a panel can instantiate without it.
- **Primary-affiliation reframing:** do NOT change her primary employer. UPMC (`P108`) stays on Wikidata and in schema; her official title remains "OBGYN Physician Lead, UPMC Divine Mercy Women's Health" per the SSOT. This push is **additive** (strengthen the founder/author identity), not a re-framing away from UPMC. Framed this way it does not signal departure intent. Flagged so we never quietly flip it.

This is the de-risking move: the entire Tier 1–3 set is additive identity-strengthening on portable (non-clinical-address) facts, so it sits cleanly inside the hold.

## 7. Decisions needed from Brian (gate Tier 1)

1. **CC-BY-SA headshot.** This is the only true blocker. CC-BY-SA 4.0 is irrevocable and permits commercial reuse with attribution. Need: (a) a photo Naomi owns the rights to (or has a photographer's CC release for), and (b) her explicit consent to the license. The existing site headshot (`rrmacademy.org/images/authors/naomi-whittaker.webp`) is a candidate if its provenance/consent clears.
2. **Run scope.** Confirm Naomi runs the Tier 1+2+3 chunks now (handoff is ready), with city + affiliation held per §6.

## 8. Execution model + ownership

- **Wikidata (P18, P856, refs):** Naomi, her own account, Comet, one chunk per prompt. Mirrors the 2026-06-11 self-edit pattern. NEVER mowsenter.
- **Commons upload:** Naomi, her own Wikimedia account (same login works for Commons + Wikidata).
- **X / bio.site / ORCID:** Naomi self-serves (her logins).
- **Schema side:** already live; no edit needed beyond the (separate) GBP/`P2622` wiring later. If we ever want `P856` to also resolve to a more personal URL, revisit when a personal domain exists.

## 9. Timeline

Sigman's was 73 days from a bare schema. We start with steps 1–2 already done, so the clock effectively starts at the Commons upload:

| T | Action |
|---|--------|
| T0 | Commons upload + `P18` (Tier 1) |
| T0 | `P856` + Tier 3 consistency fixes (same sitting) |
| T0 + ~5 wk | Panel candidate window opens (Sigman's observed lag from P18) |
| T0 + 5–10 wk | Monitor incognito SERP; if KG ID assigned, add `P2622` |

## 10. Verification + monitoring

- Schema re-validate after any change: validator.schema.org (zero errors), Google Rich Results Test (append `?v=2` to bust the URL-level result cache).
- Settle existing-entity question: `kgsearch.googleapis.com/v1/entities:search?query=Naomi+Whittaker` with a valid API key (returns a `kg:/m` or `kg:/g` MID if one exists).
- After P18: incognito SERP for "Naomi Whittaker MD OBGYN" weekly; do not tweak the panel once it appears.

## 11. Cross-references

- Complementary, separate track: the **local** Google Business Profile practitioner panel (star rating, Maps) is its own post-separation playbook in `naomi-profile-registry.md` §"Google Business Profile — Practitioner Playbook". That is gated on the UPMC separation + an operational clinic and is NOT part of this organic-KP plan.
- Canonical facts for any claim/byline: `naomi-canonical-bio.md` (SSOT).
- Where each profile lives: `naomi-profile-registry.md` (38 surfaces).
