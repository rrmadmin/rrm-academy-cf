# RRM Success Rates Guide — Design Spec

**Date:** 2026-06-03
**Status:** Approved — open decisions resolved by Brian 2026-06-03 (see §14)
**Route:** `/rrm-success-rates/`
**Type:** New root-level pillar guide
**Origin:** Emma Waters (Senior Policy Analyst, The Heritage Foundation) emailed Naomi 2026-06-03 asking for "another page on RRM Academy that includes all the studies done assessing RRM" — including older studies "from 2008 onwards" — to cite in a Heritage project ("better to link to you than anything Heritage has done"). She is currently linking the thin glossary entry `/glossary/rrm-outcomes-published-evidence/`.

---

## 1. Purpose & strategic frame

A single, comprehensive, citable evidence page documenting RRM/NaProTechnology outcomes. This is a **citation-authority asset** (core thesis: win the citation/authority layer). The immediate consumer is Heritage; the durable consumers are researchers, policy analysts, journalists, AI assistants, and patients searching "does RRM work / RRM success rates."

**Success criteria:**
- Heritage (and others) link to this page instead of compiling their own.
- Every study and every statistic is verifiably accurate against the source paper.
- Every cited study links to its **RRM Academy library detail page** (internal citation authority — Brian confirmed most/all of the corpus is already in the D1 `rrm-library`).
- The page is machine-readable as an evidence compendium (study-level `citation` JSON-LD) so AI systems retrieve and attribute it.
- A downloadable, branded PDF handout exists as a shareable artifact (RRM Academy's answer to the IIRRM handout).

## 2. Audience & framing

**Hybrid.** Patient-readable lede on top ("Does RRM work? Here is what the published evidence shows"), rigorous citable evidence below. Evidence-honest throughout — never a "hard yes," lead with "In published cohorts…"; openly state design limitations (cohort studies, not RCTs; selection effects; crude vs adjusted rates).

**Voice:** Gianna clinical voice. Ground claims in `rrm-cli` (library/facts) before writing.

**Byline:** `By RRM Academy · Reviewed by Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI` (reference-tier precedent: `/art-registries-and-codes/`, `/glossary/`). Naomi's review is prominent because her sign-off is the legitimacy Emma explicitly asked for.

## 3. Scope (Brian-selected: broadest)

Outcomes + safety + IVF/ART comparison + condition-specific effectiveness. Concretely:
- All peer-reviewed RRM/NaPro **live-birth & conception cohort studies**, 2008→present.
- **Obstetric safety** outcomes (preterm birth, low birth weight, multiples) and the ART comparators that contextualize them.
- **Head-to-head vs IVF/ART** framing, honest about study design; cross-link `/art-registries-and-codes/`.
- **Condition-specific** effectiveness where published (endometriosis, PCOS, recurrent miscarriage, post-surgical / post-failed-IVF, male-factor).
- **Cost** comparison where published (RRM ~$2–5K vs ART ~$10–15K per the 2025 review).

## 4. Study corpus (seed set — verify every stat before publish)

Seeded from three sources: the IIRRM `rrm-outcomes-handout.pdf` (5 pp.), the existing pillar-page evidence block, and a D1 `rrm-library` sweep for the remainder. **Each row's statistics must be verified against the source paper during implementation** (library abstracts may not carry exact LBR figures; the pillar block and handout occasionally cite different cuts — e.g. crude vs adjusted — of the same study).

### 4a. Conception & live-birth outcome studies

| Study | Journal / Year / Country | n | Population | Headline outcome |
|---|---|---|---|---|
| Stanford et al. | JABFM, 2008, Ireland | 1,072 | avg age 35.8, 33% prior ART, 5.6 yr trying | adj. cum. LBR 52.8% @24mo; conception 64.8% @24mo |
| Tham et al. | Canadian Family Physician, 2012, Canada | 108 | avg age 35.4, 8% prior IVF | adj. cum. LBR 66% @24mo; conception 73%; recurrent-miscarriage subgroup improved |
| Boyle et al. | Frontiers in Medicine, 2018, Ireland | 403 | 100% prior IVF (avg 2.1 cycles, 5% LBR), avg age 37.2 | adj. cum. LBR 32.1%; 92% ≥37 wk; twins 1.4% (1/74) |
| Stanford et al. | BMC Pregnancy & Childbirth, 2021, USA (2 NE family-med clinics) | 370 | mean age 34.8 | adj. cum. LBR 29% @24mo |
| Boyle et al. | JRRM, 2025, Ireland | 187 | mean age 33.6, 19% prior IVF | crude LBR 41%; conception 52%; singleton prematurity 4.0% (vs 11.8% CDC, 14.4% SART). **First head-to-head RRM vs IVF** |
| Sánchez-Méndez et al. | Frontiers in Reproductive Health, 2025, Spain (Madrid) | 1,310 | mean age 35, 27.5% prior ART | crude LBR 35.3%; adj. cum. 50.0% @24mo, 62.1% @36+mo; <2% idiopathic post-workup. **Largest NaPro cohort to date** |
| (FAM/waiting-conduct) | Frontiers in Reproductive Health, 2026, Italy | 97 | idiopathic infertility, age <40 | RRM pregnancy 51.2% @12mo (age<34 90.9%) vs ART 17.8%/cycle |
| ECOG (Eur J Obstet Gynecol Reprod Biol) | 2025, France | 551 | 2 yr avg trying | conception 37% in-study; actuarial ~40–60% @1yr |
| Andrology | 2025, Italy | 1,014 (919 treated) | 28.9% prior ART | conception 40.9%; idiopathic reduced to 8% |
| iNEST (Human Reproduction Open) | 2022, USA/Canada/UK/Poland | 834 | age 19–47, 21.4% prior IUI/IVF | conception 57%. **Methods/enrollment paper — label as such** |
| Restorative model case series | medRxiv, 2021, Australia | 162 | avg age 33.7 | adj. cum. LBR 57.4% @24mo. **PREPRINT — not peer reviewed; label explicitly** |
| (Cervical-mucus stratification) | Human Fertility, 2019, Australia | 384 | 51% infertility ≥12mo | adj. cum. conception 62.5% @24mo |
| (FA training) | Arch Gynecol Obstet, 2017, Germany | 187 | age 21–47 | conception 38% @8mo (all); 56% @8mo (trying 1–2 yr) |
| RRM infertility & recurrent miscarriage | Fides et Ratio, 2020, Ukraine | 282 | 3 yr trying | adj. cum. LBR 73.6% @24mo; conception 77.7%. **Lower-tier journal — note tier** |
| Revitalizing reproductive health | Ther Adv Reprod Health, 2025 | 145 studies | systematic review | RRM LBR ~40–60%, cost $2–5K vs ART $10–15K. **Review, not a cohort** |

### 4b. Obstetric safety / ART comparators

| Study | Journal / Year | Finding |
|---|---|---|
| ART adverse perinatal outcomes (FL/MD/UT) | BJOG, 2016, USA | ART singletons: preterm OR 3.28 (1.74–6.20), LBW OR 2.91 (1.99–4.26); n=21,803 weighted to 1.02M |
| Preterm risk in subfertility | BMC Reproductive Health, 2022, USA/Utah | IVF 4.24× preterm rate; IUI 3.17× |

### 4c. Library sweep (the "not all")
Brian: most/all of the handout is already in the D1 `rrm-library`. Implementation runs a `rrm-cli` sweep (`tradition: napro|rrm-shared`, outcome/safety intent) to (a) resolve each seed study to its library detail-page slug for internal linking, and (b) surface outcome/safety studies beyond the handout already spotted in the library: a 2020 "complications of IVF support implementation of NaPro" rationale study and a 2026 "effectiveness and safety of RRM compared to ART" comparative review. Net corpus expected ≈ 18–25 studies.

**Outcome-type discipline:** the table/charts must distinguish **live birth** vs **conception/pregnancy** vs **safety/comparative**, and **crude** vs **adjusted-cumulative** (with follow-up window). Never blend a conception rate into a live-birth comparison.

## 5. Page structure

Each `<section>` has a stable `id` (kebab-case), a linkable heading, and a **Share section** control (see §7). Order:

1. **Lede / H1** — "RRM Success Rates: What the Published Evidence Shows." Patient-readable summary + honest framing.
2. **At a glance** — key-number cards (crude LBR range 26–41%; adjusted cumulative up to 62.1% @36mo; safety advantages) with inline caveats. *(Chart: cross-study cumulative-LBR comparison.)*
3. **The evidence: outcome studies** — the comprehensive table (§4a), every row → library detail page + DOI/PMID. *(Charts: cross-study adjusted-cumulative LBR; by-country spread.)*
4. **How RRM compares to IVF/ART** — head-to-head; cohort-vs-RCT caveat; HFEA/CDC/SART registry context; cross-link `/art-registries-and-codes/` and `/ivf-success-calculator/`. *(Charts: RRM vs IVF live birth; cost comparison.)*
5. **Obstetric safety** — preterm, LBW, multiples; §4b comparators. *(Chart: RRM vs IVF/ART preterm + multiples + LBW grouped bars.)*
6. **Condition-specific effectiveness** — endometriosis, PCOS, recurrent miscarriage, post-failed-IVF, male factor; cross-link the condition pillars (`/endometriosis/`, `/pcos/`, `/miscarriage/`, `/endometritis/`). *(Chart: Sánchez-Méndez crude LBR by diagnostic category; by age group.)*
7. **Spotlight studies** — Boyle 2025 (funnel: 249→187→98 conceived→77 LB; diagnostic reassignment: unexplained 24%→1%) and Sánchez-Méndez 2025 (cumulative-over-time curve; by-age). *(Charts: funnel; diagnostic reassignment; cumulative curve; by-age.)*
8. **How to read these numbers** — crude vs adjusted cumulative; per-couple vs per-cycle; selection effects; absence of head-to-head RCTs; journal tiers & preprint flags. Credibility anchor.
9. **FAQ** — "What is the success rate of NaProTechnology?", "Is RRM more effective than IVF?", "How does RRM compare to IVF on safety?", "Is RRM evidence-based?" Evidence-honest, no hard-yes. FAQPage schema.
10. **References** — full citation list, each → library detail page + DOI/PMID.
11. **CTA + downloads** — Find a provider (`/providers/`, never book-with-Naomi); "Download the evidence handout (PDF)"; Add-to-AI / Share page (guide pattern).

## 6. Charts & visuals (Brian: "lots of charts and visuals")

**Reuse the house pattern** (no JS charting lib): pre-rendered **themed SVG pairs** in `public/images/rrm-success-rates/`, light + dark variants, swapped via `data-theme`, wrapped in `<figure class="chart-figure">` with light/dark `<img>` and **full data restated in `alt`** (the alt text is the accessible + AEO-readable data table). Precedent: `src/pages/naprotechnology/index.astro:497`.

**Chart inventory (≈10):**
1. Cross-study adjusted-cumulative LBR (horizontal bars, all cohorts) — the "money" chart.
2. Cross-study by-country spread (shows independent international replication).
3. RRM vs IVF live birth (Boyle 2025 + Sánchez-Méndez vs HFEA/CDC/SART).
4. Cost comparison (RRM $2–5K vs ART $10–15K).
5. Obstetric safety grouped bars (preterm / LBW / multiples, RRM vs IVF/ART).
6. Sánchez-Méndez cumulative LBR over time (6/12/18/24/36 mo).
7. Sánchez-Méndez adjusted cum. by age group.
8. Sánchez-Méndez crude LBR by diagnostic category.
9. Boyle 2025 outcome funnel (249→187→98→77).
10. Boyle 2025 diagnostic reassignment (unexplained 24%→1%, corpus luteum deficiency 0%→71%, etc.).

Charts must match the design-system palette (read `docs/design/design-system.json` first; chart hexes are scoped local accents, not new global tokens). Each chart needs both light and dark SVGs. **No chart asserts a number not present in the verified §4 corpus.**

## 7. Linkable sections + "Share section" (Brian request)

- Every section heading gets `id` + an anchor affordance (link icon revealed on hover/focus; clicking copies the deep link `…/rrm-success-rates/#<section-id>`).
- A **"Share section"** button per section reusing the existing copy-link + `navigator.share` + toast machinery (precedent: `src/pages/guides/index.astro:303`, `src/components/GlossaryTerm.astro:962`). Extracted into a small reusable `SectionShare.astro` (or shared script) so the page body stays clean.
- Smooth-scroll + `scroll-margin-top` so anchored landings clear the app-shell/header.
- Works shell-on and shell-off.

## 8. Printable / downloadable PDF (Brian: "final step")

**Two layers, recommend both:**
- **(Baseline) Print stylesheet** — a thorough `@media print` block: hide chrome/nav/share buttons, force light-theme chart SVGs, keep tables/figures un-clipped (`break-inside: avoid`), show full reference URLs. A "Print / Save as PDF" button calls `window.print()`. Always accurate (renders the live page); zero infra.
- **(Recommended final step) Branded static PDF artifact** — a polished, downloadable handout (RRM Academy's branded answer to the IIRRM PDF) at a stable URL, linked as "Download the evidence handout (PDF)." Generated from a print-optimized variant of the page via **CF Browser Rendering** (cf-render) at deploy time → stored in `public/` (or R2), refreshed when the corpus changes.

**Open decision for spec review:** ship both, or baseline-only (print stylesheet) first with the branded static PDF as a fast-follow. Recommendation: ship the print stylesheet with the page; generate the branded static PDF as the explicit final implementation step.

## 9. Data model (engineering)

**Recommended:** study data in a committed, schema'd JSON file `src/data/rrm-success-rates.json` (reviewable/diffable; matches the codebase's SSOT-JSON habit). The `.astro` renders the table, reference list, and study-level JSON-LD from it. Each study record:

```jsonc
{
  "id": "boyle-2025-jrrm",
  "authors": "Boyle et al.",
  "year": 2025,
  "journal": "Journal of Restorative Reproductive Medicine",
  "country": "Ireland",
  "n": 187,
  "population": "mean age 33.6; 19% prior IVF",
  "outcomeType": "live-birth",        // live-birth | conception | safety | review
  "crudeLbr": 0.41,
  "adjCumLbr": null,
  "followUpMonths": 24,
  "notes": "First head-to-head RRM vs IVF; singleton prematurity 4.0%",
  "peerReviewed": true,               // false => preprint badge
  "journalTier": "specialty",         // for honest tiering
  "doi": "…", "pmid": "…",
  "librarySlug": "…"                  // → /library/<slug>/
}
```

Alternatives considered: inline typed array (mixes data + presentation — rejected); build-time from D1 (library isn't structured as clean LBR/n/follow-up rows; over-engineered for ~20 hand-curated rows — rejected).

## 10. JSON-LD

- `MedicalWebPage` + `Article` (author = `#organization`, `reviewedBy` = `#naomi-whittaker`).
- `BreadcrumbList` (Home › Guides › RRM Success Rates).
- `FAQPage` for §9 FAQ.
- **Every study emitted as a `citation` → `MedicalScholarlyArticle`** (name, author, datePublished, `sameAs` = DOI). This is the on-thesis move: the page becomes a machine-readable evidence compendium.

## 11. Wiring & surfaces (via `/pillar-create` Gate 11.5)

- Register in `ssot/guides.json` (`slug: rrm-success-rates`, `author: RRM Academy`, accent, `in_guides_catalogue: true`, `in_shell_guides_nav: true`, `_order`). This drives the guides catalogue, sitemaps, shell nav, OG index, and `navigate_to_section`.
- **Add `/rrm-success-rates` to rrm-router `ASTRO_ROUTES`** (`~/iCode/projects/rrm-router/src/index.js`) — separate repo/deploy; without it the page 404s on the apex while working on `pages.dev` (ref memory `rrm-router-new-root-paths`).
- OG image entry; verify `routeToOgSlug()` maps `/rrm-success-rates` → `rrm-success-rates`.
- **Update the glossary entry** `/glossary/rrm-outcomes-published-evidence/` to cross-link up to the full guide (set `pillar_link`); keep the entry as a summary tier (do not delete — SEO).
- Cross-link `/ivf-success-calculator/` (exists) and `/art-registries-and-codes/` both ways.

## 12. Data-integrity & publish gates (non-negotiable)

1. **Verify every statistic** (LBR crude/adjusted, n, follow-up, year, journal, country) against the source paper — not the library abstract, not the handout summary. Reconcile crude-vs-adjusted discrepancies (e.g. Stanford 2008 crude 25.5% vs adj. cum. 52.8%) and label both explicitly.
2. **Flag non-cohort / non-peer-reviewed entries:** medRxiv 2021 = preprint badge; iNEST = methods paper; Ther Adv 2025 = review; Fides et Ratio = lower-tier journal note.
3. **Naomi legitimacy sign-off** on the final inclusion list before publish (Emma asked "if you think they're legitimate").
4. **Go-live gate:** build → localhost preview (`web-page-qa` mobile + desktop) → Naomi review → **explicit go-live** (per `feedback-mockup-gate-before-live-publish`; never push content-publication live without explicit go-live).
5. Run `npm run lint` + design-tokens check + pillar-registry gate before push; deploy choreography per house rules.

## 13. Out of scope (separate, after go-live)
- Drafting Naomi's reply to Emma with the live URL (offer after publish).
- Building/finishing the `/ivf-success-calculator/` tool (cross-link only).
- Any change to the IIRRM site.

## 14. Decisions (resolved by Brian, 2026-06-03)
1. **PDF:** print-stylesheet ships with the page; branded static PDF (CF Browser Rendering) is the explicit final implementation step before go-live.
2. **Data file (§9):** committed `src/data/rrm-success-rates.json` — confirmed.
3. **Condition-specific depth (§5.6):** concise per-condition paragraphs + the Sánchez-Méndez diagnostic-category chart; no per-condition sub-tables (condition pillars carry the depth).
