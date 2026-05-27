# Natural Fertility Care — Category Hub Page (Design)

**Date:** 2026-05-22
**Status:** Draft for review
**Owner:** RRM Academy (rrm-academy-cf)
**Origin:** orank (ora.ai) agent-readiness audit. Discovery layer scored 15/41. The failing gap is **Category share of voice (0/6)**: for the query *"natural fertility and reproductive health education platform"*, rrmacademy.org does not surface in AI search results; the landscape is dominated by FEMM Health, Natural Womanhood, and NaProTechnology.

## Problem

orank measures whether AI search engines associate a domain with its category. RRM Academy has deep **entity/method pillars** (`/naprotechnology/`, `/femm/`, `/neofertility/`, `/what-is-rrm/`) and **condition pages** (`/endometriosis/`, `/pcos/`, `/miscarriage/`, `/endometritis/`), but no asset that claims the **category** itself — "natural / restorative fertility and reproductive health education." The tested query is a *category/platform* query, not a brand or method query. To surface for it, the site needs an entity-level page that defines the category and positions RRM Academy as the neutral education hub within it.

## Non-goals (YAGNI)

- **Not** a giant all-in-one comparison page. Mega-comparisons have diffuse intent, can't be cleanly extracted by LLMs, and cannibalize the existing method pillars. (Confirmed with Brian — he has built these before and they underperform.)
- **Not** head-to-head competitor framing. RRM Academy is a nonprofit education hub; the page treats FEMM, NaPro, NeoFertility, Creighton, Billings, Marquette, Sympto-Thermal as **methods on their merits**, never as rivals. No "why we beat X." (Brian-selected framing: *neutral hub above the methods*.)
- **Not** a programmatic page set. One focused page first; measure before extending.
- **Not** the "alternatives to IVF" spoke — deferred (see Future Work).

## Goal & success criteria

Publish one tightly-scoped **category hub** with a single clear intent: *what this field is, how the approaches compare, and where to learn / get care.* Success = rrmacademy.org begins surfacing for category/use-case queries in AI search, measured by a follow-up orank rescan (`POST https://ora.ai/api/scan {"url":"rrmacademy.org"}`) showing the Discovery / Category-share-of-voice line move off 0/6.

## Page design

**URL:** `/natural-fertility-care/` (root-level, matching the flat pillar-page IA in CLAUDE.md). Clean, matches the use-case phrasing agents see. Short vanity aliases (if any) 301 via rrm-router.

**Author/byline:** Dr. Naomi Whittaker (matches every other pillar in `ssot/pillars.json`; written in her clinical voice via Gianna).

**Length:** ~1,800–2,200 words. Single intent — not an everything-dump.

**Structure:**

1. **Definition lede.** One extractable opening paragraph defining natural / restorative reproductive healthcare. This is the passage AI engines lift and cite. Principle-level only (per `feedback-no-prescriptive-rrm-field-claims`).
2. **Comparison module (the only comparison — scoped to a module, not the page).** One clean table across decision-relevant columns:
   - Methods (rows): Creighton, Billings Ovulation, Marquette, FEMM, Sympto-Thermal, NeoFertility.
   - Columns: *What it tracks*, *Learning approach*, *Clinical/medical backing*, *Best-fit situation*.
   - Even-handed, evidence-based, no ranking-by-superiority.
3. **"How to choose" decision section.** Short, question-shaped guidance ("If you want X, start with Y"). No hard "yes" on outcomes (per `feedback-no-hard-yes-fertility-faqs`).
4. **Where RRM Academy fits.** Positions RRM Academy as the neutral education hub above all methods. Internal links out to `/what-is-rrm/`, `/femm/`, `/naprotechnology/`, `/neofertility/`, and the condition pages.
5. **FAQ block.** 4–6 real use-case questions (e.g. "Is there a natural alternative to IVF?", "Which fertility awareness method is most accurate?", "Can natural methods treat the cause of infertility?"). Answers lead with "In many cases…" framing, never a bare "Yes."

**Schema (JSON-LD `@graph`):**
- `CollectionPage` (the page) + `MedicalWebPage`.
- `ItemList` enumerating the six methods (per-method AEO).
- `FAQPage` for the FAQ block.
- `BreadcrumbList` (Home → Guides → Natural Fertility Care), built via `buildBreadcrumbList()` in `src/lib/identity.ts`.
- `author = #naomi-whittaker`, publisher/`isPartOf = #organization` via the identity graph helpers.

## Content sourcing & compliance

- All clinical facts grounded via **`rrm-cli`** against D1 `rrm-library` before drafting; verify any statistic against a primary source (per `feedback-verify-before-trust`).
- Prose written through **Gianna** (`/rrm-commentary` voice profile) in Dr. Whittaker's clinical voice.
- Hard rules enforced: principle-level RRM claims only; method-specific claims attributed to the named method; no Hilgers protocols/dosing on public pages (`feedback-no-public-protocols-or-dosings`); no hard "yes" on fertility/pregnancy questions; no em dashes.

## Wiring (registry + routing)

Built via the **`/pillar-create`** skill so all Gate 11.5 surfaces are updated together:

1. **`ssot/pillars.json`** — new pillar entry (`slug: natural-fertility-care`, `file`, `title`, `description`, `og_*`, `author`, `read_time`, `accent` from the brand ramp, `in_guides_catalogue: true`, `in_shell_guides_nav: true`, `_order`). This single edit flows into the 6 registered consumers (guides catalogue, library-sitemaps `PILLAR_PATHS`, AppShellChrome `GUIDES_PATHS`, BaseLayout `navigate_to_section`, build-guides-data, build-og-index).
2. **`src/pages/natural-fertility-care/index.astro`** — the page, using BaseLayout + MaybeShell + SectionTocChips, following the existing pillar-page template conventions.
3. **rrm-router `ASTRO_ROUTES`** (`~/iCode/projects/rrm-router/src/index.js`, separate repo / deploy cycle) — add `/natural-fertility-care` so the router serves it from Astro rather than proxying.
4. **OG card** — auto-handled via `build-og-index.mjs` once the pillar entry exists; verify the on-demand `/og/natural-fertility-care.png` renders.
5. **CI gate** — `scripts/gates/validate-pillar-registry.mjs` must pass.

## Verification

- `npm run check-types` and `npm run ssot:validate` clean before push.
- Build locally; confirm the page renders, JSON-LD validates, and the comparison table is mobile-responsive (393×852 Playwright screenshot, per `feedback-visual-verification`).
- After deploy: confirm `https://rrmacademy.org/natural-fertility-care/` returns 200 and appears in the guides catalogue + sitemap.
- Run `npm run embed` locally after the new content lands so semantic search indexes it.
- Follow-up orank rescan to confirm the Category-share-of-voice line improves.

## Future work (deferred, not in this build)

- If the hub ranks, add one single-intent spoke: **"Natural & restorative alternatives to IVF"** — carefully framed as root-cause-first, complementary care (not "skip IVF"), honoring the no-hard-yes and no-prescriptive-field-claims rules.

## Revert

Single page + one pillar-registry entry + one router-route line. Revert = remove the pillar entry from `ssot/pillars.json`, delete the page directory, and drop the `ASTRO_ROUTES` line. No data migrations, no schema changes.
