<!-- Spec: PillarLayout normalization. Created 2026-06-06. Revised 2026-06-07 (v2) after /arise --deep spec trace: 14 findings folded in. -->
# PillarLayout: Normalized Construction for Pillar/Condition Pages

**Status:** Design v2, revised 2026-06-07 after a `/arise --deep` spec trace (4 Opus tracers, 14 findings, all folded in below). Awaiting spec review → implementation plan.
**Owner:** Brian (RRM Academy)
**Scope:** `rrm-academy-cf` — pillar/condition guide pages.

## Problem

The 13 pillar/condition guides (`/what-is-rrm/`, `/naprotechnology/`, `/femm/`, `/neofertility/`, `/common-questions-about-rrm/`, `/glossary/`, `/art-registries-and-codes/`, `/rrm-success-rates/`, `/pcos/`, `/endometriosis/`, `/endometritis/`, `/miscarriage/`, `/isthmocele/`) are **hand-authored 600–750 line `.astro` files cloned from one another.** No single constructor guarantees their SEO foundation, so it drifts and can be forgotten entirely: `/isthmocele/` shipped with the generic fallback OG card, no `sitemap-pillars.xml` entry, and no `/guides/` listing because a manual clone bypassed the `ssot/pillars.json` registry.

## Goals

1. A single `PillarLayout` component owns the **entire SEO foundation** so it cannot be forgotten or drift.
2. Every pillar is **normalized to one best-practice standard**, where "normalize up" means **additive-only at the schema/metadata layer** (nothing a page emits today is silently removed or changed).
3. Metadata becomes **genuinely single-sourced in `ssot/pillars.json`** — which today it is NOT (see "Reality check" below). Making the registry a true SSOT is a precondition (Phase 0), not an assumption.
4. A **gate** makes normalized construction mandatory without ever blocking deploys mid-rollout.
5. **Visible body content is never changed** by migration.

## Non-goals (YAGNI)

- No redesign / restyling of pillar bodies.
- No conversion of pillar prose into data; prose stays in each page's `.astro`, supplied via slot(s).
- No change to the library/commentary/FAQ/course dynamic templates.
- No new pillar content authored as part of this work.

## Reality check — the registry is NOT an SSOT today (must be fixed first)

The `/arise` trace proved the original "metadata is single-sourced in the registry" premise false. Before any layout migration, these gaps must be closed (Phase 0), or "additive normalize-up" is impossible:

- **Author field lies.** `pillars.json` `author` is free text and disagrees with emitted JSON-LD: isthmocele + glossary registry say `"Dr. Naomi Whittaker"` but the pages emit `author = #organization` + `reviewedBy = #naomi-whittaker`.
- **Author model varies across pages.** 9 of 13 pillars emit `author = #naomi-whittaker` (Person, no reviewer): what-is-rrm, naprotechnology, femm, neofertility, pcos, endometriosis, endometritis, miscarriage, common-questions. 4 emit org-author + Naomi reviewer: glossary, art-registries, rrm-success-rates, isthmocele. **femm** additionally has a *non-Naomi* reviewer (Erin Kay, DO) in its visible byline.
- **Missing schema inputs.** The layout needs values the registry lacks: `conditionName` (the disease name, e.g. "Polycystic Ovary Syndrome", which is NOT the SEO `title` "PCOS Explained: …"), `icd10System` (isthmocele uses `ICD-10-CM`; the other four use `ICD-10`), and distinct `headline` (JSON-LD) vs `breadcrumbName` (the short crumb, e.g. "Endometritis") vs `title` (the `<title>`) vs `og_title` — four distinct strings today.
- **Emission shapes differ.** Most pages emit separate `<script type="application/ld+json">` blocks; what-is-rrm, common-questions, and art-registries bundle everything in a single `@graph` with explicit node `@id`s.
- **FAQ is intentionally dual-shape.** The visible accordion answers carry inline `<a href="/library/…">` citation links; the JSON-LD `acceptedAnswer.text` is the link-stripped plain-text projection. They are deliberately different and must both be preserved.
- **Structural outliers.** `common-questions-about-rrm` is a root `.astro` file (not `<slug>/index.astro`), emits bare `Article` (no `MedicalWebPage`/`MedicalCondition`), is `data-pagefind-ignore`, and has no TOC/Cite/PDF band. `glossary` has a custom right-rail (`hasRail` + `slot="rail"`) and `in_shell_guides_nav:false`.

**Pillar taxonomy (drives `MedicalCondition`):** condition pillars (5) — pcos, endometriosis, endometritis, miscarriage, isthmocele; concept/method pillars (8) — the rest. `common-questions` currently emits bare `Article` and stays that way unless an intentional, explicitly-approved normalize-up adds `MedicalWebPage`.

## Design

### `src/layouts/PillarLayout.astro`

Wraps `BaseLayout`; owns all SEO scaffolding. The page passes structured props and supplies body via slots.

**Props (all resolved from `ssot/pillars.json` by `slug` unless noted; the registry is the source — no silent defaults that change attribution):**
- `slug` (required).
- Title set: `headline` (JSON-LD), `breadcrumbName` (short crumb), plus registry `title` (`<title>`) and `ogTitle`/`ogDescription` — four distinct fields, never overloaded onto one.
- Authorship: `authorId` (`#organization` or `#naomi-whittaker` or other person `@id`) and optional `reviewer` (`{ name, id? }`). The byline + JSON-LD `author`/`reviewedBy` render from these. Supports all three real patterns: Person-author/no-reviewer, Org-author/Naomi-reviewer, Person-author/non-Naomi-reviewer (femm). **No org-author default** — `authorId` is required per pillar so migration cannot silently flip authorship.
- Condition: `condition?` (bool); when true, the co-required `conditionName`, `icd10`, `icd10System` (default `'ICD-10'`), `alternateName?`. The `MedicalCondition.about` node is emitted only when `condition`.
- `tocItems?` (`{href,label}[]`) — drives mobile TOC, `SectionTocChips`, sidebar `.toc`. Optional (concept outliers like common-questions have none).
- `faqs?` (`{question, answerHtml, answerText?}[]`) — the accordion renders `answerHtml` (preserving inline links); the `FAQPage` `acceptedAnswer.text` renders `answerText ?? stripHtml(answerHtml)`. The `FAQPage` node is **omitted entirely when `faqs` is empty/absent** (no empty `mainEntity:[]`).
- `citations?` (`{name, author, datePublished, journal?}[]`) — emitted as JSON-LD `citation[]` via the existing `buildScholarlyArticleStub` (whose real signature is exactly these four fields; the earlier `librarySlug` idea is dropped — the helper ignores it). `citation[]` omitted when empty.
- `keyTakeaways?` (HTML[]); `disclaimer?` (HTML — defaults to the canonical condition-page text, but every migrated page passes its existing disclaimer verbatim; the disclaimer text varies in 4 known variants and must not be silently rewritten).
- `editingNotice?` (bool); `disambig?` (HTML, e.g. endometritis↔endometriosis); `citeThisPage?` (bool/props) — first-class layout-emitted options so migration cannot drop them.
- `schemaType?` — `['Article','MedicalWebPage']` (default for pillars) or `['Article']` (common-questions, until an intentional upgrade).
- Shell/scaffolding opt-outs: `hasRail?` (bool) + a forwarded `<slot name="rail">` (glossary's A-Z rail), and `pagefindIgnore?` / `showToc?` / `showCite?` / `showPdf?` for the concept outliers.

**Body:** default `<slot>` for prose sections + card grids; named `rail` slot forwarded into the inner `MaybeShell`.

**Emits uniformly:** `BaseLayout` (title/description/canonical/og/publishDate/`jsonLd`/`speakable`/`chrome`); `pageSchema` (`schemaType` + headline/description/`authorId`/publisher/datePublished/dateModified/wordCount/mainEntityOfPage/`articleSection`+`hasPart` from `tocItems`/`about` `MedicalCondition` when `condition`/`reviewedBy` when a reviewer is set); `BreadcrumbList` (Home › Guides › `breadcrumbName`); `FAQPage` (when faqs present); `citation[]` (when present); byline; breadcrumb nav; TOC trio; `MaybeShell` + `rail`; `LastUpdated`; disclaimer; `CiteThisPage`; FAQ accordion.

**Emission shape:** the layout emits one canonical shape (separate `<script>` blocks, matching the BaseLayout `jsonLd` + per-block precedent). The 3 `@graph` pages (what-is-rrm, common-questions, art-registries) are flagged in the migration plan as **shape conversions** requiring explicit `@id` preservation, not drop-in moves.

### Registry coupling (Phase 0)

Extend `ssot/pillars.json` entries with: structured `authorId`, optional `reviewer`, and for condition entries `condition`/`conditionName`/`icd10`/`icd10System`/`alternateName`; plus `headline`, `breadcrumbName`, and a per-slug `usesPillarLayout` boolean (default false; flipped per migration — see Gate). Reconcile the 2 lying `author` values (isthmocele, glossary) to match emitted schema. Update **both** validators atomically: `scripts/gates/validate-pillar-registry.mjs` (value-check new fields only when present; never add to `REQUIRED_FIELDS` as hard-required mid-rollout) **and** `docs/schemas/pillars.schema.json` (allow the new keys; keep `additionalProperties` permissive for them) — `ssot:validate` enforces the latter, and the original spec missed it. All of Phase 0 lands in one atomic commit so every intermediate state passes both validators.

### Gate (flag-based, never deadlocks)

- Keep **G6** (clinical page must be registered).
- **G7 (revised):** drive enforcement off the per-slug `usesPillarLayout` flag, resolved via the registry `file` field (so it handles the root-file pillar `common-questions-about-rrm.astro`, not just `<slug>/index.astro`):
  - every slug with `usesPillarLayout:true` **must** import `PillarLayout`, AND
  - must **not** contain a hand-rolled `'@type': ['Article'` / `FAQPage` / `BreadcrumbList` literal outside the layout (a `must_not_match`, mirroring G3 — closes the "imports the layout but still hand-rolls schema" gap), AND
  - every slug with `usesPillarLayout:false` **must not** import `PillarLayout` (catches half-reverts).
- Because the flag is false for all pillars at Phase 0/1 and flips atomically with each migration, the gate is **green at every commit** — no all-or-nothing deadlock, and `validate-pillar-registry.mjs` (a hard, deploy-blocking step at `deploy.yml:72`) never blocks the site mid-rollout.

## Migration plan (precondition → proof → waves)

0. **Make the registry an SSOT (atomic commit, no page migrated):** add the new registry fields + reconcile the 2 author values + update both validators + `pillars.schema.json`. Gates green (fields optional). This is what makes later migrations additive.
1. **Build** `PillarLayout.astro` + the comparator script (see Verification) + add the flag-based G7 (allowlist empty → green). Layout is unused/inert; landing it is zero-risk.
2. **Proof — 5 pages chosen to cover every structural edge case** (the original 2 missed all of them): `endometritis` (Person-author, FAQ round-trip), `isthmocele` (org-author + reviewer, ICD-10-CM, condition), `glossary` (custom rail + org-author + no FAQ), `femm` (Person-author + non-Naomi reviewer), `common-questions-about-rrm` (root `.astro` file + bare `Article` + `@graph` + pagefind-ignore + no TOC). Each migration commit flips its `usesPillarLayout` flag in the same commit. Verify (below) per page; gates green per commit.
3. **Waves:** migrate the remaining 8 in waves of ~3, same per-commit flag-flip + verification.

### Verification (semantic, not textual)

The original "textual pre/post HTML diff, additive only" is unrunnable (`safeJsonLd` does not sort keys, so a layout swap reorders semantically-identical JSON-LD). Replace with a **semantic comparator** (built in Phase 1, not hand-waved), run per migrated page: parse every `application/ld+json` block to objects and deep-compare key-order-insensitive (additive = post is a superset of pre nodes/keys, no removals, no value changes); parse `<meta og:*>`/`<link rel=canonical>`/`<title>`/speakable selectors into normalized maps; compare byline by normalized `textContent` AND the emitted `author`/`reviewedBy` `@id`s; assert `sitemap-pillars.xml` + `/guides/` + OG entry unchanged. Body prose checked unchanged via Playwright desktop + mobile (393×852) screenshots.

### Deploy choreography

Each migration ships via the standard worktree-off-`origin/main` → `claude/*` → auto-merge → deploy. **No per-slug OG purge** — OG cards are registry-derived from `og_title`/`og_description` (untouched by migration), so they are byte-identical; the `library-sitemaps.mjs` dist-existence assertion is the real safety net.

## Rollback

Revert the **entire migration commit** (page `.astro` **and** its `usesPillarLayout` flag together) — never the page alone, which would leave the flag true and re-trip G7. The bidirectional G7 check (flag↔import must agree) catches a partial revert locally before push. Phase 0 + the layout file are additive and inert for un-migrated pages.

## Testing / verification

- Gates: `validate-pillar-registry.mjs` (G1–G7) + `design-tokens:check` + `ssot:validate` green after every commit.
- Build: `npm run build` clean; `build-og-index` + `sitemap-pillars.xml` + `/guides/` list every pillar.
- Per-page: the semantic comparator (above) returns additive-only; Playwright visual parity.

## Risks

- **Layout bug across pages** → mitigated by the 5-page proof covering every edge case before waves + per-page semantic verification.
- **Authorship/schema regression** → eliminated by registry-driven `authorId`/`reviewer` (no org default) + the comparator checking `author`/`reviewedBy` `@id`s.
- **Gate deadlock / unsafe rollback** → eliminated by the per-slug flag (green at every state; whole-commit revert).

## Resolved in v2 (from the /arise --deep trace)

H1 gate-timing deadlock → per-slug `usesPillarLayout` flag. H2 author default backwards → registry-driven structured author/reviewer, no org default, 2 lying values reconciled. H3 FAQ single-field → `answerHtml`/`answerText`. H4 registry not SSOT → Phase 0 adds `conditionName`/`icd10System`/`headline`/`breadcrumbName`. H5 divergent pillars → proof set expanded to 5; rail slot, flexible reviewer, root-file/`@graph`/bare-Article handling, opt-out scaffolding props. H6 unrunnable verification → semantic comparator. H7 validator/schema ordering → atomic Phase 0 updating both validators + `pillars.schema.json`. M1 empty nodes → omit-when-empty. M2 disclaimer → `disclaimer?` prop, per-page verbatim. M3 asides → `CiteThisPage`/`editingNotice`/`disambig` first-class. M4 OG purge → dropped. M5 `librarySlug` → dropped. L1 proof FAQ coverage → endometritis + common-questions/glossary in proof set. L2 G7 grep → `must_not_match` for in-slot schema literals.
