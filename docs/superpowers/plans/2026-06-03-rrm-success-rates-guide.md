# RRM Success Rates Guide (`/rrm-success-rates/`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish the comprehensive, citable RRM/NaPro outcomes evidence pillar at `/rrm-success-rates/` per the approved spec `docs/superpowers/specs/2026-06-03-rrm-success-rates-guide-design.md`.

**Architecture:** Static Astro pillar page driven by a committed schema'd JSON SSOT (`src/data/rrm-success-rates.json`), rendered with the house chart-figure light/dark SVG pattern, per-section share/anchor controls via a new `SectionShare.astro`, study-level `citation` JSON-LD, print stylesheet, and (final step) a branded static PDF handout. Wiring follows `/pillar-create` Gate 11.5 (`ssot/pillars.json` SSOT + rrm-router `ASTRO_ROUTES`).

**Tech Stack:** Astro 5.3 static, CF Pages, D1 (`rrm-library` for citations, `rrm-auth` for glossary), rrm-cli, hand-authored SVG charts, CF Browser Rendering (PDF).

---

## HARD EXECUTION RULES (read before Task 0)

1. **Gianna writes all prose.** Every piece of patient-facing/citable copy on this page (lede, at-a-glance caveats, section intros, IVF-comparison framing, condition paragraphs, how-to-read section, FAQ answers, chart captions) is produced by dispatching the `gianna-copywriter` agent, grounded in rrm-cli first. The executing engineer NEVER writes patient-facing copy directly. Engineer-authored text is limited to: table cells rendered from verified JSON, chart alt-text data restatements, button/UI labels, and reference list entries.
2. **No statistic without verification.** No number appears in page, chart, or alt text unless its JSON row has `verified: true` with a `verificationNote` naming the source location (table/figure/page in the source paper). Charts copy values ONLY from the verified JSON.
3. **Citation integrity.** Never insert a PMID/DOI/journal reference from model knowledge. Sources: the D1 library record, PubMed E-utilities, Perplexity live search, or Brian. (CLAUDE.md rule; hallucinated citations are existential risk.)
4. **One branch, one push, explicit go-live.** All work happens locally on `claude/rrm-success-rates-pillar` in an isolated worktree. NOTHING is pushed until Task 15's go-live gate (Naomi sign-off + Brian's explicit go-live). Pushing `claude/*` auto-merges and deploys within minutes — do not push half-finished work. Exception: library ingests (Task 1) run against the worker/D1 pipeline and are normal library ops, not page publication.
5. **Worktree isolation.** The shared clone holds another session's uncommitted work. Use `superpowers:using-git-worktrees` to create a worktree off `origin/main`. Run `npm ci` inside it.
6. **Voice rules:** no em dashes anywhere in copy; never lead a fertility/pregnancy FAQ with "Yes" (lead "In published cohorts…" / "In many cases…"); no Hilgers protocols/dosings; critical-not-rhetorical; evidence-honest about cohort design, selection effects, and the absence of RCTs.
7. **Design system:** read `docs/design/design-system.json` before any CSS. Phantom-token traps: `--bg-secondary`, `--link-color`, `--surface-elevated` do not exist. Copy the chart-figure CSS block VERBATIM (Task 7 includes it) — do not add `display:` to `.chart-figure img`.
8. **SVG = XML.** No HTML named entities in standalone SVGs (`&ndash;` etc. break parsing). Literal Unicode or numeric entities only. Validate every SVG with the Python XML gate before committing.
9. **Deviation from spec (flagged for Brian):** spec §11 asked to cross-link `/ivf-success-calculator/` both ways. That page is a `noindex`, passphrase-dev-gated stub. This plan links `/art-registries-and-codes/` both ways and SKIPS the calculator link until the tool ships. If Brian wants the calculator link anyway, add it in Task 12.

---

## REVERT PLAYBOOK (know before you start)

- **Branch not yet pushed:** nothing to revert remotely; delete the worktree + local branch.
- **Pushed but auto-merge has not completed:** delete the remote branch immediately: `git push origin :claude/rrm-success-rates-pillar` (the merge workflow operates on the branch; removing it aborts pickup if it has not merged yet — verify with `gh run list --branch claude/rrm-success-rates-pillar`).
- **Merged to main / deployed:** push a revert commit via a fresh `claude/revert-success-rates` branch off `origin/main` (`git revert <merge-sha> -m 1`), let auto-merge fire, verify Build & Deploy success AND live absence (`curl -sI https://rrmacademy.org/rrm-success-rates/`). Page will 404 at apex anyway until the router entry lands, which is why the router deploy (Task 15.3) comes AFTER page verification — router rollback is simply removing the `ASTRO_ROUTES` line + `npx wrangler deploy`.
- **Glossary uplink (Task 16):** revert = same `/glossary-update` flow setting `pillar_link` back to NULL + single-record dispatch.

## File Map

| File | Action | Task |
|---|---|---|
| `src/data/rrm-success-rates.json` | Create (study SSOT) | 2, 3 |
| `src/components/SectionShare.astro` | Create (heading + anchor + share) | 5 |
| `public/images/rrm-success-rates/*.svg` | Create (10 light + 10 dark) | 6 |
| `src/pages/rrm-success-rates/index.astro` | Create (the page) | 7–11 |
| `ssot/pillars.json` | Modify (append entry) | 12 |
| `static-overrides/llms.txt` | Modify (bullet + paragraph) | 12 |
| `ssot/agent-surfaces.json` | Modify (`llms.primary_urls`) | 12 |
| `src/pages/art-registries-and-codes/index.astro` | Modify (cross-link back) | 12 |
| `docs/audits/2026-06-XX-rrm-success-rates-claim-audit.md` | Create | 13 |
| `~/iCode/projects/rrm-router/src/index.js` | Modify (`ASTRO_ROUTES`) — separate repo, deploys at Task 15 | 15 |
| D1 `rrm-auth.glossary_term` | UPDATE `pillar_link` via `/glossary-update` | 16 |
| `public/downloads/rrm-success-rates-evidence-handout.pdf` | Create (branded PDF) | 17 |

---

### Task 0: Worktree + branch setup

- [ ] **Step 0.1:** Invoke `superpowers:using-git-worktrees`. Create a worktree off `origin/main` on branch `claude/rrm-success-rates-pillar`:

```bash
cd ~/iCode/projects/rrm-academy-cf && git fetch origin main
git worktree add ~/iCode/.worktrees/rrm-success-rates -b claude/rrm-success-rates-pillar origin/main
cd ~/iCode/.worktrees/rrm-success-rates && npm ci
```

- [ ] **Step 0.2:** Copy this plan + commit it (docs-only first commit):

```bash
cp ~/iCode/projects/rrm-academy-cf/docs/superpowers/plans/2026-06-03-rrm-success-rates-guide.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-06-03-rrm-success-rates-guide.md
git commit -m "docs: rrm-success-rates implementation plan"
```

- [ ] **Step 0.3:** Read `docs/design/design-system.json` (palette for charts) and one existing chart SVG (`public/images/naprotechnology/success-rates.svg`) to absorb the house SVG conventions (viewBox, fonts, hex usage — standalone SVGs cannot use CSS vars; hexes are hardcoded per theme variant).

### Task 1: Ingest the 6 missing studies into the library

These run against the live library pipeline (worker + D1), independent of the branch. Each must reach a live 200 at `https://rrmacademy.org/library/<slug>/` BEFORE the page can cite it (pillar-create Gate 4).

- [ ] **Step 1.1:** For each study below, invoke the `/rrm-ingest` skill (full 6-stage pipeline: ingest → fulltext → classify → publish → facts if relevance ≥3 → live verify). Resolve each to PMID/DOI via PubMed/CrossRef first — do NOT guess identifiers. Track each with TaskCreate/TaskUpdate.

| # | Study (identify via PubMed/CrossRef search) |
|---|---|
| 7 | 2026 Frontiers in Reproductive Health (Italy), FAM/waiting-conduct idiopathic infertility, n=97, RRM pregnancy 51.2% @12mo |
| 8 | 2025 Eur J Obstet Gynecol Reprod Biol (France), n=551, conception 37% in-study |
| 9 | 2025 Andrology (Italy), n=1,014 couples, conception 40.9% |
| 11 | 2021 medRxiv (Australia) PREPRINT, restorative model case series, n=162 |
| 13 | 2017 Arch Gynecol Obstet (Germany), fertility-awareness training, n=187 |
| 14 | 2020 Fides et Ratio (Ukraine), RRM infertility + recurrent miscarriage, n=282 — lower-tier journal; if no PMID/DOI exists, ingest from source URL/PDF via `/rrm-source-ingest`; if unresolvable, mark the study EXCLUDED in Task 2 with reason "source not verifiable" |

- [ ] **Step 1.2:** Record the resulting library slugs. Verify each: `curl -sI https://rrmacademy.org/library/<slug>/ | head -1` → `HTTP/2 200`.

### Task 2: Create `src/data/rrm-success-rates.json`

- [ ] **Step 2.0:** Defensive check: `git show origin/main:src/data/rrm-success-rates.json` — verified ABSENT on origin/main 2026-06-03, but re-check in case a parallel session added it. If it exists, READ it and merge (never clobber populated fields with nulls).
- [ ] **Step 2.1:** Create the file with this exact structure. Slugs already resolved (research 2026-06-03) are filled; Task 1 slugs get patched in; ALL rows start `verified: false`. Stats below are seeded from the spec §4 (handout/pillar-block provenance) and are NOT trusted until Task 3.

```jsonc
{
  "_meta": {
    "purpose": "Curated SSOT for /rrm-success-rates/ evidence pillar. Every statistic on the page, in charts, and in chart alt text derives from this file.",
    "updated": "2026-06-03",
    "library_base_url": "https://rrmacademy.org/library/",
    "verification_rule": "No row renders on the page unless verified:true with a verificationNote naming the exact source location. Rows with excluded:true never render.",
    "outcome_type_rule": "Never blend conception rates into live-birth comparisons. outcomeType drives table grouping and chart eligibility."
  },
  "studies": [
    {
      "id": "stanford-2008-jabfm",
      "authors": "Stanford JB, Parnell TA, Boyle PC",
      "year": 2008, "journal": "Journal of the American Board of Family Medicine", "country": "Ireland",
      "n": 1072, "population": "avg age 35.8; 33% prior ART; 5.6 yr trying",
      "outcomeType": "live-birth", "crudeLbr": 0.255, "adjCumLbr": 0.528, "adjCumConception": 0.648, "followUpMonths": 24,
      "notes": "Crude 25.5% vs adjusted cumulative 52.8% — label both explicitly.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null,
      "librarySlug": "outcomes-from-treatment-of-infertility-with-natural-procreative-technology-in-an-recj7cwubt4vlyfjl",
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "tham-2012-cfp",
      "authors": "Tham E, Schliep K, Stanford JB",
      "year": 2012, "journal": "Canadian Family Physician", "country": "Canada",
      "n": 108, "population": "avg age 35.4; 8% prior IVF",
      "outcomeType": "live-birth", "crudeLbr": null, "adjCumLbr": 0.66, "adjCumConception": 0.73, "followUpMonths": 24,
      "notes": "Recurrent-miscarriage subgroup improved.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null,
      "librarySlug": "natural-procreative-technology-for-infertility-and-recurrent-miscarriage-outcome-recmv6gf3xlcbt6ny",
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "boyle-2018-frontmed",
      "authors": "Boyle PC, de Groot T, Andralojc KM, Parnell TA",
      "year": 2018, "journal": "Frontiers in Medicine", "country": "Ireland",
      "n": 403, "population": "100% prior failed IVF (avg 2.1 cycles, 5% LBR); avg age 37.2",
      "outcomeType": "live-birth", "crudeLbr": null, "adjCumLbr": 0.321, "adjCumConception": null, "followUpMonths": 24,
      "notes": "92% of births at 37+ weeks; twins 1.4% (1/74).",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null,
      "librarySlug": "healthy-singleton-pregnancies-from-restorative-reproductive-medicine-rrm-after-f-recior3akxtg2a6ya",
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "stanford-2021-bmc",
      "authors": "Stanford JB, Carpentier PA, Meier BL, Rollo M",
      "year": 2021, "journal": "BMC Pregnancy and Childbirth", "country": "USA",
      "n": 370, "population": "mean age 34.8; two New England family-medicine clinics",
      "outcomeType": "live-birth", "crudeLbr": null, "adjCumLbr": 0.29, "adjCumConception": null, "followUpMonths": 24,
      "notes": null,
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null,
      "librarySlug": "restorative-reproductive-medicine-for-infertility-in-two-family-medicine-clinics-recyiv7uvglmix9ex",
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "boyle-2025-jrrm",
      "authors": "Boyle PC, et al.",
      "year": 2025, "journal": "Journal of Restorative Reproductive Medicine", "country": "Ireland",
      "n": 187, "population": "mean age 33.6; 19% prior IVF; 2019 clinic cohort",
      "outcomeType": "live-birth", "crudeLbr": 0.41, "adjCumLbr": null, "adjCumConception": 0.52, "followUpMonths": 24,
      "notes": "First head-to-head RRM vs IVF. Singleton prematurity 4.0% vs 11.8% CDC, 14.4% SART. Funnel 249 to 187 to 98 conceived to 77 live births. Diagnostic reassignment: unexplained 24% to 1%.",
      "peerReviewed": true, "preprint": false, "journalTier": "specialty",
      "doi": null, "pmid": null,
      "librarySlug": "restorative-reproductive-medicine-rrm-outcomes-compared-to-in-vitro-fertilization-rec4qqhafqb8stlnd",
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "sanchez-mendez-2025-frh",
      "authors": "Sánchez-Méndez S, et al.",
      "year": 2025, "journal": "Frontiers in Reproductive Health", "country": "Spain",
      "n": 1310, "population": "mean age 35; 27.5% prior ART; Madrid single center, 5-year cohort",
      "outcomeType": "live-birth", "crudeLbr": 0.353, "adjCumLbr": 0.50, "adjCumConception": null, "followUpMonths": 24,
      "notes": "Largest NaPro cohort to date. Adjusted cumulative 62.1% at 36+ months. Under 2% remained idiopathic after workup. Cumulative-over-time + by-age + by-diagnosis chart data extracted in Task 3.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null,
      "librarySlug": "natural-procreative-technology-naprotechnology-for-infertility-take-home-baby-ra-recv02qu0r8ycnzoa",
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "italy-2026-fam-frh",
      "authors": "TBD from ingest (Task 1 #7)",
      "year": 2026, "journal": "Frontiers in Reproductive Health", "country": "Italy",
      "n": 97, "population": "idiopathic infertility; age <40",
      "outcomeType": "conception", "crudeLbr": null, "adjCumLbr": null, "adjCumConception": null, "followUpMonths": 12,
      "notes": "RRM pregnancy 51.2% at 12mo (age<34 subgroup 90.9%) vs ART 17.8% per cycle — verify exact endpoints in Task 3.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null, "librarySlug": null,
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "france-2025-ejog",
      "authors": "TBD from ingest (Task 1 #8)",
      "year": 2025, "journal": "European Journal of Obstetrics & Gynecology and Reproductive Biology", "country": "France",
      "n": 551, "population": "2 yr average trying",
      "outcomeType": "conception", "crudeLbr": null, "adjCumLbr": null, "adjCumConception": 0.37, "followUpMonths": null,
      "notes": "Conception 37% in-study; actuarial ~40-60% at 1yr — verify exact figures in Task 3.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null, "librarySlug": null,
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "italy-2025-andrology",
      "authors": "TBD from ingest (Task 1 #9)",
      "year": 2025, "journal": "Andrology", "country": "Italy",
      "n": 1014, "population": "919 treated; 28.9% prior ART",
      "outcomeType": "conception", "crudeLbr": null, "adjCumLbr": null, "adjCumConception": 0.409, "followUpMonths": null,
      "notes": "Idiopathic reduced to 8% after workup.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null, "librarySlug": null,
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "inest-2022-hropen",
      "authors": "Stanford JB, et al.",
      "year": 2022, "journal": "Human Reproduction Open", "country": "USA/Canada/UK/Poland",
      "n": 834, "population": "age 19-47; 21.4% prior IUI/IVF",
      "outcomeType": "methods", "crudeLbr": null, "adjCumLbr": null, "adjCumConception": 0.57, "followUpMonths": null,
      "notes": "iNEST enrollment & methods paper — label as methods paper, not an outcomes cohort.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null,
      "librarySlug": "international-natural-procreative-technology-evaluation-and-surveillance-of-trea-recudgdct40otosdm",
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "australia-2021-medrxiv",
      "authors": "TBD from ingest (Task 1 #11)",
      "year": 2021, "journal": "medRxiv", "country": "Australia",
      "n": 162, "population": "avg age 33.7",
      "outcomeType": "live-birth", "crudeLbr": null, "adjCumLbr": 0.574, "adjCumConception": null, "followUpMonths": 24,
      "notes": "PREPRINT — not peer reviewed. Badge prominently.",
      "peerReviewed": false, "preprint": true, "journalTier": "preprint",
      "doi": null, "pmid": null, "librarySlug": null,
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "marshell-2019-humfert",
      "authors": "Marshell M, Corkill M, Whitty M, Thomas A, Turner J",
      "year": 2019, "journal": "Human Fertility", "country": "Australia",
      "n": 384, "population": "51% infertility 12+ months",
      "outcomeType": "conception", "crudeLbr": null, "adjCumLbr": null, "adjCumConception": 0.625, "followUpMonths": 24,
      "notes": "Cervical-mucus stratification cohort.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null,
      "librarySlug": "stratification-of-fertility-potential-according-to-cervical-mucus-symptoms-achie-recy9fpzmcvrv1x8z",
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "germany-2017-ago",
      "authors": "TBD from ingest (Task 1 #13)",
      "year": 2017, "journal": "Archives of Gynecology and Obstetrics", "country": "Germany",
      "n": 187, "population": "age 21-47",
      "outcomeType": "conception", "crudeLbr": null, "adjCumLbr": null, "adjCumConception": 0.38, "followUpMonths": 8,
      "notes": "Conception 38% at 8mo all-comers; 56% at 8mo for couples trying 1-2 yr.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null, "librarySlug": null,
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "ukraine-2020-fides",
      "authors": "TBD from ingest (Task 1 #14)",
      "year": 2020, "journal": "Fides et Ratio", "country": "Ukraine",
      "n": 282, "population": "3 yr trying",
      "outcomeType": "live-birth", "crudeLbr": null, "adjCumLbr": 0.736, "adjCumConception": 0.777, "followUpMonths": 24,
      "notes": "Lower-tier journal — tier note rendered on row.",
      "peerReviewed": true, "preprint": false, "journalTier": "lower-tier",
      "doi": null, "pmid": null, "librarySlug": null,
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "bulletti-2025-tarh",
      "authors": "Bulletti C, et al.",
      "year": 2025, "journal": "Therapeutic Advances in Reproductive Health", "country": null,
      "n": null, "population": "systematic review, 145 studies",
      "outcomeType": "review", "crudeLbr": null, "adjCumLbr": null, "adjCumConception": null, "followUpMonths": null,
      "notes": "RRM LBR ~40-60% range; cost RRM $2-5K vs ART $10-15K. Review, not a cohort.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null,
      "librarySlug": "revitalizing-reproductive-health-innovations-and-future-frontiers-in-restorative-reccddj5kun7yn1ir",
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "ganci-2026-fs",
      "authors": "Ganci, et al.",
      "year": 2026, "journal": "Fertility and Sterility", "country": null,
      "n": null, "population": "systematic review: RRM vs ART or unassisted conception",
      "outcomeType": "review", "crudeLbr": null, "adjCumLbr": null, "adjCumConception": null, "followUpMonths": null,
      "notes": "Comparative effectiveness + safety systematic review.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null,
      "librarySlug": "the-effectiveness-and-safety-of-restorative-reproductive-medicine-rrm-compared-t-vrqg1wuo",
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "kiani-2020-ivf-complications",
      "authors": "Kiani, et al.",
      "year": 2020, "journal": "TBD from library record", "country": null,
      "n": null, "population": "rationale review",
      "outcomeType": "review", "crudeLbr": null, "adjCumLbr": null, "adjCumConception": null, "followUpMonths": null,
      "notes": "IVF complication profile as rationale for NaPro implementation.",
      "peerReviewed": true, "preprint": false, "journalTier": "indexed",
      "doi": null, "pmid": null,
      "librarySlug": "complications-related-to-in-vitro-reproductive-techniques-support-the-implementa-reclfeffnu2v67szk",
      "verified": false, "verificationNote": null, "excluded": false
    }
  ],
  "safety_comparators": [
    {
      "id": "simonsen-bjog-art-perinatal",
      "authors": "Simonsen SE, et al.",
      "year": 2015, "journal": "BJOG", "country": "USA (FL/MD/UT)",
      "finding": "ART singletons: preterm OR 3.28 (1.74-6.20), LBW OR 2.91 (1.99-4.26); n=21,803 weighted to 1.02M. SPEC SAID 2016 — reconcile epub vs print year in Task 3.",
      "doi": null, "pmid": null,
      "librarySlug": "fertility-treatments-and-adverse-perinatal-outcomes-in-a-population-based-sampli-rec9u2zrqqgyuipxq",
      "verified": false, "verificationNote": null, "excluded": false
    },
    {
      "id": "sanders-2022-preterm",
      "authors": "Sanders JN, et al.",
      "year": 2022, "journal": "Reproductive Health", "country": "USA (Utah)",
      "finding": "IVF 4.24x preterm rate; IUI 3.17x (linked-data retrospective cohort).",
      "doi": null, "pmid": null,
      "librarySlug": "fertility-treatments-and-the-risk-of-preterm-birth-among-women-with-subfertility-recpxh63cqyktiu3x",
      "verified": false, "verificationNote": null, "excluded": false
    }
  ],
  "candidate_additions": [
    { "id": "stanford-2026-tfr-simulation", "librarySlug": "potential-increase-of-the-us-total-fertility-rate-resulting-from-restorative-tre-zanksw9x", "why": "2026 Frontiers in Reproductive Health simulation: population-level RRM impact" },
    { "id": "gallo-tham-2022-comparison", "librarySlug": "how-naprotechnology-compares-with-assisted-reproductive-technology-comparación-d-rech4qbbtomwrara9", "why": "NaPro vs ART comparison review" },
    { "id": "paul-2022-ebp", "librarySlug": "in-couples-with-infertility-is-natural-procreative-technology-successful-in-achi-rechrsj3cvwgugoc0", "why": "Evidence-Based Practice structured review of NaPro live-birth question" },
    { "id": "boyle-stanford-2011-multifactorial", "librarySlug": "multifactorial-approach-to-infertility-using-naprotechnology-natural-procreative-rec81uzej0crjsoal", "why": "Early NaPro cohort description" },
    { "id": "almasi-2019-preeclampsia", "librarySlug": "assisted-reproductive-technology-and-the-risk-of-preeclampsia-an-updated-systema-reccpdeshwwxvgzwt", "why": "ART preeclampsia meta-analysis (safety comparator)" },
    { "id": "sachdev-2023-stroke", "librarySlug": "risk-of-stroke-hospitalization-after-infertility-treatment-A9juHmAF", "why": "JAMA Netw Open stroke after infertility treatment (safety comparator)" },
    { "id": "rodriguez-wallberg-2020-mortality", "librarySlug": "mortality-from-infancy-to-adolescence-in-singleton-children-conceived-from-assis-rec1ltuyoubtmueyp", "why": "ART vs natural conception child mortality (safety comparator)" },
    { "id": "wang-2017-nicu", "librarySlug": "fertility-treatment-is-associated-with-stay-in-the-neonatal-intensive-care-unit--rec95pcvy1wytajxx", "why": "NICU stay after fertility treatment (safety comparator)" },
    { "id": "vonversen-2019-preeclampsia-cl", "librarySlug": "increased-preeclampsia-risk-and-reduced-aortic-compliance-with-in-vitro-fertiliz-GBHW8wcb", "why": "Corpus-luteum-absent IVF cycles and preeclampsia (mechanistic safety)" }
  ],
  "cost": {
    "rrm_range_usd": "2000-5000", "art_range_usd": "10000-15000",
    "sourceStudyId": "bulletti-2025-tarh", "verified": false, "verificationNote": null
  },
  "charts": {
    "_rule": "Chart-only datapoints (Sánchez-Méndez time-curve/by-age/by-diagnosis, Boyle funnel + reassignment) are appended here by Task 3 with per-datapoint verificationNote. Chart SVGs read ONLY from this file."
  }
}
```

- [ ] **Step 2.2:** Patch in the Task 1 slugs (`librarySlug` for the 6 ingested rows). Any Task 1 failure → set that row `excluded: true` with reason in `notes`.
- [ ] **Step 2.3:** Validate JSON parses: `node -e "JSON.parse(require('fs').readFileSync('src/data/rrm-success-rates.json','utf8')); console.log('ok')"` → `ok`. (Note: final committed file must be strict JSON — no comments.)
- [ ] **Step 2.4:** Commit: `git add src/data/rrm-success-rates.json && git commit -m "feat(success-rates): study corpus SSOT seed (unverified)"`

### Task 3: Stat verification pass (spec gate §12.1 — non-negotiable)

- [ ] **Step 3.1:** For EACH non-excluded row: pull the library record + R2 fulltext (`rrm-cli get article <slug> --full`; fall back to DOI landing page via cf-render or PubMed). Confirm: n, population, year, journal, country, every rate (crude vs adjusted-cumulative vs conception, follow-up window). Fill `doi`/`pmid` FROM THE RECORD/PubMed (never from memory). Set `verified: true` + `verificationNote` like `"crude LBR 41% (77/187) Table 2; prematurity 4.0% p.6"`. Where the spec's seeded number disagrees with the source, THE SOURCE WINS — update the JSON and note the correction. Failure modes: study not on PubMed → native Perplexity Sonar Pro live search (then curl-verify any PMID it returns — pplx IDs carry fabrication risk); source still unconfirmable → `excluded: true` + claim-audit note; R2 fulltext missing/insufficient → DOI landing page via cf-render.
- [ ] **Step 3.2:** Extract chart-only datasets into `charts`: Sánchez-Méndez cumulative LBR at 6/12/18/24/36 mo, by-age-group, crude-LBR-by-diagnostic-category; Boyle 2025 funnel (249→187→98→77) and diagnostic reassignment rows (unexplained 24%→1%, corpus luteum deficiency 0%→71%, plus remaining categories from the paper); ART multiples/LBW/preterm comparator values for chart 5. Each datapoint gets a verificationNote.
- [ ] **Step 3.3:** Reconcile flagged discrepancies: Stanford 2008 crude 25.5% vs adj 52.8% (label both); Simonsen BJOG 2015-vs-2016 year; Boyle 2025 conception 52% vs funnel 98/187=52.4% (use paper's stated figure).
- [ ] **Step 3.4:** Gate check: `node -e "const d=require('./src/data/rrm-success-rates.json'); const bad=[...d.studies,...d.safety_comparators].filter(r=>!r.excluded&&!r.verified); if(bad.length){console.error('UNVERIFIED:',bad.map(r=>r.id));process.exit(1)} console.log('all verified')"` → `all verified`.
- [ ] **Step 3.5:** Commit: `git commit -am "feat(success-rates): corpus verified against sources"`

### Task 4: Naomi inclusion-list package (Brian-owned gate)

- [ ] **Step 4.1:** Produce a one-page summary (markdown, in `/tmp/` — not committed): final inclusion list (studies + safety comparators + which `candidate_additions` to include), per-study headline stat + tier/preprint flags, and the three honesty mechanisms (outcome-type discipline, crude-vs-adjusted labeling, How-to-read section). Hand to Brian to route to Naomi (per doctor-schedule pattern — Brian sends, never a launch-blocking direct ask).
- [ ] **Step 4.2:** The package MUST include the `candidate_additions` list with a recommended include/exclude per candidate — Brian (or Naomi) decides candidates HERE, before Task 6 draws any chart, so SVGs are never authored for studies that later get cut.
- [ ] **Step 4.3:** Record the verdict. Publish (Task 15) is BLOCKED until sign-off. **Concurrency contract while Task 4 is open:** Tasks 5, 7 (skeleton), 11, 12 may proceed (corpus-independent); Task 6 (charts), 8 (table), 9 (prose), 10 (FAQ), 13 (audit) should wait for the candidates decision (or proceed using only the 17 core rows and treat candidate inclusion as an additive patch); Task 15 is hard-blocked.

### Task 5: `SectionShare.astro` component

- [ ] **Step 5.1:** Create `src/components/SectionShare.astro`. It renders the section heading row (h2 + hover/focus anchor copy-link + Share button) and registers one deduped script (Astro hoists + dedupes component scripts). Pattern lifted from `guides/index.astro:289` + `GlossaryTerm.astro:952` (research report has both verbatim; unify on dynamic `ensureToast()` with class `share-toast`):

```astro
---
// SectionShare.astro — linkable section heading + per-section share control.
// Props: id (section anchor), title (H2 text — MUST equal JSON-LD articleSection entry).
import { Share2, Check, Link as LinkIcon } from 'lucide-astro';
interface Props { id: string; title: string; }
const { id, title } = Astro.props;
---
<div class="section-head">
  <h2 id={id}>
    {title}
    <button type="button" class="section-anchor" aria-label={`Copy link to "${title}"`}
      data-share-url={`https://rrmacademy.org/rrm-success-rates/#${id}`} data-anchor-only="1"
      data-share-title={title}>
      <LinkIcon size={16} aria-hidden="true" />
    </button>
  </h2>
  <button type="button" class="section-share" aria-label={`Share "${title}"`}
    data-share-url={`https://rrmacademy.org/rrm-success-rates/#${id}`}
    data-share-title={`RRM Success Rates: ${title}`}>
    <Share2 class="section-share__icon" size={14} aria-hidden="true" />
    <Check class="section-share__icon section-share__icon--check" size={14} aria-hidden="true" />
    <span class="section-share__label">Share section</span>
  </button>
</div>

<script>
  function ensureToast(): HTMLDivElement {
    let el = document.getElementById('share-toast') as HTMLDivElement | null;
    if (el) return el;
    el = document.createElement('div');
    el.id = 'share-toast'; el.className = 'share-toast';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el); return el;
  }
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(msg: string) {
    const toast = ensureToast();
    toast.textContent = msg; toast.classList.add('share-toast--show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('share-toast--show'), 2400);
  }
  async function copyUrl(btn: HTMLButtonElement, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      btn.dataset.state = 'copied'; showToast('Link copied');
      setTimeout(() => { if (btn.dataset.state === 'copied') delete btn.dataset.state; }, 2400);
    } catch { showToast('Could not copy link'); }
  }
  document.querySelectorAll<HTMLButtonElement>('.section-share, .section-anchor').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.preventDefault(); event.stopPropagation();
      const url = btn.dataset.shareUrl || window.location.href;
      const title = btn.dataset.shareTitle || document.title;
      const anchorOnly = btn.dataset.anchorOnly === '1';
      const hasWebShare = typeof navigator.share === 'function';
      try {
        if ((window as any).__rrmTrack__) {
          (window as any).__rrmTrack__('share_click', {
            surface: 'success-rates-section',
            network: !anchorOnly && hasWebShare ? 'web-share' : 'copy-link',
          });
        }
      } catch (e) { /* never block share UI */ }
      if (!anchorOnly && hasWebShare) {
        try { await navigator.share({ title, url }); return; }
        catch (err) { if (err && (err as DOMException).name === 'AbortError') return; }
      }
      await copyUrl(btn, url);
    });
  });
</script>

<style>
  .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); }
  .section-head h2 { scroll-margin-top: 96px; }
  .section-anchor { background: none; border: none; cursor: pointer; color: var(--text-secondary);
    opacity: 0; transition: opacity 0.15s ease; padding: 0 var(--space-1); vertical-align: middle; }
  .section-head h2:hover .section-anchor, .section-anchor:focus-visible { opacity: 1; }
  .section-share { display: inline-flex; align-items: center; gap: var(--space-1);
    background: none; border: 1px solid var(--border-color); border-radius: var(--radius-pill);
    color: var(--text-secondary); font-size: 0.75rem; padding: 4px 10px; cursor: pointer; white-space: nowrap; }
  .section-share:hover { color: var(--text-primary); }
  .section-share__icon--check { display: none; }
  .section-share[data-state="copied"] .section-share__icon { display: none; }
  .section-share[data-state="copied"] .section-share__icon--check { display: inline; }
  /* toast (created dynamically; global because appended to body) */
  :global(.share-toast) { position: fixed; bottom: calc(env(safe-area-inset-bottom, 0px) + var(--space-6));
    left: 50%; transform: translateX(-50%) translateY(16px); z-index: 9999;
    background: var(--text-primary); color: var(--bg-body); padding: 10px 20px;
    border-radius: var(--radius-pill); font-family: 'Inter', sans-serif; font-size: 0.8125rem; font-weight: 500;
    box-shadow: 0 8px 28px -8px color-mix(in srgb, var(--text-primary) 35%, transparent);
    opacity: 0; pointer-events: none; transition: opacity 0.22s ease, transform 0.22s ease;
    max-width: calc(100vw - var(--space-6) * 2); }
  :global(.share-toast--show) { opacity: 1; transform: translateX(-50%) translateY(0); }
  @media (prefers-reduced-motion: reduce) {
    :global(.share-toast) { transition: opacity 0.15s; }
    :global(.share-toast--show) { transform: translateX(-50%); }
  }
</style>
```

  Verify token names against `docs/design/design-system.json` first (`--border-color`, `--radius-pill`, `--space-*`, `--text-secondary`, `--bg-body`); substitute the SSOT names if these differ. Check `lucide-astro` is the icon import used by guides/index.astro and match it.
- [ ] **Step 5.2:** Commit: `git add src/components/SectionShare.astro && git commit -m "feat(success-rates): SectionShare component (anchor + share + toast)"`

### Task 6: Chart SVGs (10 light/dark pairs)

- [ ] **Step 6.1:** Read 2-3 existing SVGs in `public/images/naprotechnology/` and extract the house conventions (viewBox ~700x340, font family/sizes, axis style, light vs dark hex sets). Read `docs/design/design-system.json` and list the brand hexes used per theme.
- [ ] **Step 6.2:** Author `public/images/rrm-success-rates/` SVGs. Values come ONLY from the verified JSON (`studies` + `charts`). Inventory (filenames fixed; `-dark` suffix for dark variants):

| # | File (light) | Type | Data (from verified JSON) |
|---|---|---|---|
| 1 | `cross-study-lbr.svg` | horizontal bars | adjusted-cumulative LBR per cohort (live-birth rows only, with follow-up window labels; preprint/tier-flagged bars visually annotated) |
| 2 | `by-country.svg` | dot/bar map-style spread | cohorts grouped by country showing independent replication |
| 3 | `rrm-vs-ivf.svg` | grouped bars | Boyle 2025 crude 41%, Sánchez-Méndez 50% @24mo / 62.1% @36mo vs HFEA per-cycle figure (reuse the verified HFEA 33% datapoint already live on /naprotechnology/ chart) |
| 4 | `cost-comparison.svg` | paired bars | RRM $2-5K vs ART $10-15K per cycle (Bulletti 2025) |
| 5 | `obstetric-safety.svg` | grouped bars | preterm: Boyle 2025 4.0% vs CDC 11.8% vs SART 14.4%; ART ORs (Simonsen); IVF 4.24x / IUI 3.17x (Sanders); multiples per Task 3 extraction |
| 6 | `sm-cumulative-curve.svg` | line/step curve | Sánchez-Méndez cumulative LBR at 6/12/18/24/36 mo (Task 3 `charts` data) |
| 7 | `sm-by-age.svg` | bars | Sánchez-Méndez adjusted cumulative by age group |
| 8 | `sm-by-diagnosis.svg` | horizontal bars | Sánchez-Méndez crude LBR by diagnostic category |
| 9 | `boyle-funnel.svg` | funnel | 249 enrolled → 187 treated → 98 conceived → 77 live births |
| 10 | `boyle-reassignment.svg` | paired before/after bars | diagnostic reassignment (unexplained 24%→1%, corpus luteum deficiency 0%→71%, + categories from Task 3) |

  Rules: XML-safe only (no HTML named entities; literal Unicode `–` or `&#8211;`); no number not present in the verified JSON; light + dark for every chart.
- [ ] **Step 6.3:** XML gate: `python3 -c "import xml.etree.ElementTree as ET, glob; [ET.parse(f) for f in glob.glob('public/images/rrm-success-rates/*.svg')]; print('xml ok')"` → `xml ok`.
- [ ] **Step 6.4:** Commit: `git add public/images/rrm-success-rates && git commit -m "feat(success-rates): 10 themed chart SVG pairs"`

### Task 7: Page skeleton — `src/pages/rrm-success-rates/index.astro`

- [ ] **Step 7.1:** Create the page following the naprotechnology/art-registries house anatomy. Frontmatter:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import MaybeShell from '../../components/MaybeShell.astro';
import SectionTocChips from '../../components/SectionTocChips.astro';
import SectionShare from '../../components/SectionShare.astro';
import BackToTop from '../../components/BackToTop.astro';
import LastUpdated from '../../components/LastUpdated.astro';
import { isShellEnabled } from '../../lib/shell-routes';
import { buildScholarlyArticleStub } from '../../lib/identity';
import { safeJsonLd } from '../../lib/jsonld';
import data from '../../data/rrm-success-rates.json';

const SHELL_ENABLED = isShellEnabled('guides');
const included = data.studies.filter((s) => s.verified && !s.excluded);
const safety = data.safety_comparators.filter((s) => s.verified && !s.excluded);

const SECTIONS = [
  { id: 'at-a-glance', title: 'The Evidence at a Glance' },
  { id: 'outcome-studies', title: 'The Outcome Studies' },
  { id: 'rrm-vs-ivf', title: 'How RRM Compares to IVF and ART' },
  { id: 'obstetric-safety', title: 'Obstetric Safety' },
  { id: 'by-condition', title: 'Effectiveness by Condition' },
  { id: 'spotlight-studies', title: 'Spotlight Studies' },
  { id: 'how-to-read-these-numbers', title: 'How to Read These Numbers' },
  { id: 'faq', title: 'Frequently Asked Questions' },
  { id: 'references', title: 'References' },
  { id: 'downloads', title: 'Downloads and Sharing' },
];
const TOC_ITEMS = SECTIONS.map((s) => ({ href: `#${s.id}`, label: s.title }));
---
```

  (Verify `buildScholarlyArticleStub` is the actual export name in `src/lib/identity.ts`; `src/pages/endometritis/index.astro` shows the citation-stub usage precedent — match it exactly.)
- [ ] **Step 7.2:** JSON-LD `@graph` (Article + MedicalWebPage node with `author: {'@id': 'https://rrmacademy.org/#organization'}`, `reviewedBy: {'@id': 'https://rrmacademy.org/#naomi-whittaker'}`, `articleSection: SECTIONS.map(s => s.title)`, `hasPart` WebPageElements per section, and **`citation: included.concat(safety).map(s => stub({name, author, datePublished, journal, sameAs: doi ? 'https://doi.org/'+doi : undefined, url: 'https://rrmacademy.org/library/'+s.librarySlug+'/'}))`** — the on-thesis machine-readable evidence compendium) + separate `BreadcrumbList` (Home › Guides › RRM Success Rates) and `FAQPage` blocks via `safeJsonLd`, matching the art-registries-and-codes structure.
- [ ] **Step 7.3:** Body scaffold: BaseLayout (`title="RRM Success Rates: What the Published Evidence Shows"`, description placeholder until Gianna's Task 9, `canonicalUrl="https://rrmacademy.org/rrm-success-rates/"`, `ogType="article"`, `jsonLd={pageSchema}`, `speakable={['.pillar-lead','h1']}`, `chrome={SHELL_ENABLED ? 'shell' : 'default'}`, `trackScroll`) → MaybeShell (`context="page"`, `saveTitle="RRM Success Rates"`) → org-author byline (copy the art-registries-and-codes `.author-avatar-stack`/`.has-reviewer` block VERBATIM, swapping `path="/rrm-success-rates/"`) → `{SHELL_ENABLED && <SectionTocChips items={TOC_ITEMS} />}` → ten `<section id={...}>` blocks each opening with `<SectionShare id={s.id} title={s.title} />` → CTA box (`/providers/` + `/library/` buttons — NEVER book-with-Naomi) → disclaimer paragraph (copy the naprotechnology disclaimer verbatim) → BackToTop.
- [ ] **Step 7.4:** Page `<style>` block at bottom. Copy VERBATIM from naprotechnology: `.author-byline`, `.table-wrap`/table, `.references`, `.cta-box`, `.disclaimer`, and the canonical chart-figure block:

```css
.chart-figure { margin: var(--space-8) 0; }
.chart-figure img { width: 100%; height: auto; border-radius: var(--radius-md); box-shadow: var(--shadow-sm); }
.chart-dark { display: none; }
:global([data-theme="dark"]) .chart-light { display: none; }
:global([data-theme="dark"]) .chart-dark { display: block; }
```

- [ ] **Step 7.5:** Build smoke: `npm run build` → exits 0, `dist/rrm-success-rates/index.html` exists. (pillars.json registration comes in Task 12; the sitemap integration only validates slugs that are registered, so an unregistered page builds fine.)
- [ ] **Step 7.6:** Commit: `git add src/pages/rrm-success-rates && git commit -m "feat(success-rates): page skeleton + JSON-LD evidence compendium"`

### Task 8: Evidence table + references render

- [ ] **Step 8.1:** In `#outcome-studies`: render `included` (live-birth + conception + methods/review rows grouped separately per the outcome-type discipline) as the comprehensive table inside `.table-wrap`. Columns: Study (→ `/library/<librarySlug>/` link), Journal/Year/Country, n, Population, Outcome (crude vs adjusted-cumulative explicitly labeled with follow-up window). Badge rows: `preprint` → "Preprint — not peer reviewed"; `journalTier==='lower-tier'` → tier note; `outcomeType==='methods'` → "Methods paper"; `'review'` → "Review". Badges render from JSON fields, engineer-authored.
- [ ] **Step 8.2:** In `#references`: ordered list mapping `included.concat(safety)` → full citation line + `/library/<slug>/` link + DOI link (`https://doi.org/<doi>`) when present.
- [ ] **Step 8.3:** Insert chart figures at spec §5 positions (charts 1-2 in `#outcome-studies` and `#at-a-glance`; 3-4 in `#rrm-vs-ivf`; 5 in `#obstetric-safety`; 8 in `#by-condition`; 6-7, 9-10 in `#spotlight-studies`). Every `<img>` alt restates the full chart data (house AEO pattern — copy alt-text style from the naprotechnology chart figures).
- [ ] **Step 8.4:** `npm run build` → 0. Commit: `git commit -am "feat(success-rates): evidence table, references, chart figures"`

### Task 9: Gianna prose (ALL page copy)

- [ ] **Step 9.1:** Dispatch the `gianna-copywriter` agent ONCE with the full brief: write all prose slots for `/rrm-success-rates/`, grounded in rrm-cli (`--intent=voice` + `--intent=cite`) and the verified JSON (attach the file contents). Slots + constraints:
  1. **Meta description** (≤160 chars) and **lede** (h1 subhead + 2-3 paragraph patient-readable summary, `.pillar-lead` first paragraph; honest framing: published cohorts, not RCTs).
  2. **At-a-glance intro + key-number card captions** (crude LBR range, adjusted cumulative up to 62.1% @36mo, safety advantages — each with inline caveat).
  3. **Outcome-studies section intro** (incl. the crude-vs-adjusted comparison frame BEFORE any statistic, per comparison-lens-before-statistics methodology).
  4. **RRM vs IVF section** (cohort-vs-RCT caveat; registry context HFEA/CDC/SART; link `/art-registries-and-codes/`).
  5. **Obstetric safety section.**
  6. **Five condition paragraphs** (endometriosis, PCOS, recurrent miscarriage, post-failed-IVF, male factor) each cross-linking its pillar (`/endometriosis/`, `/pcos/`, `/miscarriage/`, `/endometritis/` where apt).
  7. **Two spotlight write-ups** (Boyle 2025, Sánchez-Méndez 2025).
  8. **How to read these numbers** (crude vs adjusted-cumulative; per-couple vs per-cycle; selection effects; no head-to-head RCTs; journal tiers + preprint flags).
  9. **Five FAQ answers** (80-200 words each, never lead "Yes"): "What is the success rate of NaProTechnology?", "Is RRM more effective than IVF?", "How does RRM compare to IVF on safety?", "Is RRM evidence-based?", "Are there randomized controlled trials comparing RRM and IVF?"
  Constraints: no em dashes; no Hilgers dosing; every claim must trace to a verified JSON row or an existing library/pillar link; flag any claim Gianna cannot source instead of writing around it.
- [ ] **Step 9.2:** Insert Gianna's copy verbatim into the page slots (engineer adds only inline `<a href="/library/...">` hooks where Gianna marked citations). Re-run `npm run build` → 0.
- [ ] **Step 9.3:** Commit: `git commit -am "feat(success-rates): Gianna prose pass"`

### Task 10: FAQ markup + schema sync

- [ ] **Step 10.1:** `#faq` section: H2 "Frequently Asked Questions" (already via SectionShare), each Q as `<details><summary>{question}</summary><div class="faq-answer">{answer}</div></details>` (pillar-create Gate 6 pattern).
- [ ] **Step 10.2:** Define the 5 Q/A pairs as a frontmatter `FAQS` array and render BOTH the markup and the `FAQPage` JSON-LD `mainEntity` from it (single source — exact-match guarantee).
- [ ] **Step 10.3:** `npm run build` → 0. Commit: `git commit -am "feat(success-rates): FAQ + FAQPage schema"`

### Task 11: Print stylesheet + print button

- [ ] **Step 11.1:** Append to the page `<style>`:

```css
@media print {
  .section-share, .section-anchor, .toc-chips, .cta-box .btn, .print-button, .app-shell-nav { display: none !important; }
  .chart-figure, .table-wrap, details { break-inside: avoid; }
  details { display: block; }
  details > summary { font-weight: 600; }
  .chart-dark { display: none !important; }
  .chart-light { display: block !important; }
  #references a[href^="https://doi.org"]::after,
  #references a[href^="https://rrmacademy.org"]::after { content: " (" attr(href) ")"; font-size: 0.85em; }
}
```

  (Check the actual class SectionTocChips renders — substitute for `.toc-chips` if different. `details` won't auto-expand answers in all print engines; add `<script>window.addEventListener('beforeprint',()=>document.querySelectorAll('details').forEach(d=>d.open=true));</script>` to the page.)
- [ ] **Step 11.2:** In `#downloads`: a "Print or save as PDF" button (`onclick` → module script listener calling `window.print()`; first `window.print()` in the codebase, that's expected) + a "Download the evidence handout (PDF)" link STUBBED as hidden (`hidden` attribute) until Task 17 ships the artifact.
- [ ] **Step 11.3:** `npm run build` → 0. Commit: `git commit -am "feat(success-rates): print stylesheet + print button"`

### Task 12: Wiring (pillar-create Gate 11.5, in-repo half)

- [ ] **Step 12.1:** Append to `ssot/pillars.json` `pillars[]` (read the file first; use max existing `_order` + 1):

```json
{
  "slug": "rrm-success-rates",
  "file": "rrm-success-rates/index.astro",
  "title": "RRM Success Rates: What the Published Evidence Shows",
  "description": "<Gianna meta description from Task 9>",
  "og_title": "RRM Success Rates: The Published Evidence",
  "og_description": "<Gianna og description from Task 9>",
  "author": "RRM Academy",
  "read_time": "25 min read",
  "accent": "var(--purple-700)",
  "in_guides_catalogue": true,
  "in_shell_guides_nav": true,
  "_order": <max+1>
}
```

- [ ] **Step 12.2:** `static-overrides/llms.txt`: add one bullet under "Pillar Guides" + one paragraph summary (use Gianna's meta description as the base).
- [ ] **Step 12.3:** `ssot/agent-surfaces.json`: add `{ "label": "RRM Success Rates", "path": "/rrm-success-rates/" }` to `llms.primary_urls`.
- [ ] **Step 12.4:** Cross-link back: in `src/pages/art-registries-and-codes/index.astro`, add one in-context sentence linking `/rrm-success-rates/` (this is a correctness/wiring link required by the approved spec §11, not unsolicited copy).
- [ ] **Step 12.5:** Run `node scripts/gates/validate-pillar-registry.mjs` → pass (G5 router warning expected until Task 15). Run `npm run ssot:validate` → pass. `npm run build` → 0 and `dist/sitemap-pillars.xml`... (sitemap is emitted at build; grep `dist/sitemap-pillars.xml` for `/rrm-success-rates/` → present).
- [ ] **Step 12.6:** Commit: `git commit -am "feat(success-rates): register pillar (ssot, llms, agent-surfaces, cross-links)"`

### Task 13: Claim audit + external fact-check (Gates 7 + 9 + 10)

- [ ] **Step 13.1:** Create `docs/audits/2026-06-XX-rrm-success-rates-claim-audit.md` (precedent format: `docs/audits/2026-05-12-art-hub-claim-audit.md`): every assertion catalogued `| # | Claim | [C]/[U]/[D]/[S] | Notes |`, gaps ranked by attackability (universal-negatives, superlatives, quantitative ranges first).
- [ ] **Step 13.2:** External fact-check: run the final stat set claim-by-claim through Perplexity Sonar Pro (`/pplx` skill, `--detailed`). Triage: hard catches → correct; soft catches → soften or source; hostile reads → judgment, soften wording.
- [ ] **Step 13.3:** Remediate (Phase A quick fixes inline; Phase B = new research via verified sources only). Corrections read as native prose (Gate 8 anti-patterns).
- [ ] **Step 13.4:** Commit: `git add docs/audits && git commit -am "docs(success-rates): claim audit + fact-check remediation"`

### Task 14: Local QA gates

- [ ] **Step 14.1:** `npm run design-tokens:audit` → "No phantom tokens". `npm run check-types` → errors ≤ baseline (if over baseline: FIX the errors; a baseline bump is a decision requiring explicit authorization, never a mechanical step). `npm run lint` → 0. SVG XML gate (Task 6.3 command) → ok. `node scripts/gates/validate-pillar-registry.mjs` → pass.
- [ ] **Step 14.2:** `npm run build && npx wrangler pages dev dist` (or `astro preview` for non-404 work) → invoke the `web-page-qa` skill against `http://localhost:8788/rrm-success-rates/`: mobile 393x852 AND desktop; horizontal-overflow, table responsiveness, chart rendering (BOTH themes — toggle `data-theme`), anchor landings clear the header, share buttons + toast work, print preview sane (Playwright `page.emulateMedia({media:'print'})` screenshot).
- [ ] **Step 14.3:** Verify every internal link resolves in dist (`/library/<slug>/` pages exist live — curl each cited library URL → 200). Verify JSON-LD parses: extract the `@graph` from dist HTML and `JSON.parse` it.
- [ ] **Step 14.4:** Fix findings, re-run, commit: `git commit -am "fix(success-rates): QA pass"`

### Task 15: GO-LIVE GATE → single push → deploy verification

- [ ] **Step 15.1:** ⛔ **HARD STOP.** Confirm BOTH: (a) Naomi sign-off recorded (Task 4), (b) Brian's explicit go-live for this page. Localhost screenshots + the claim audit are the review artifacts. Do not proceed on "fix all" / "ship it" phrasing — require explicit go-live (house rule).
- [ ] **Step 15.2:** Push ONCE: `git push origin claude/rrm-success-rates-pillar`. Auto-merge fires. Watch: `gh run list --branch claude/rrm-success-rates-pillar` then the main Build & Deploy run → conclusion `success` (read the exact failing step if not).
- [ ] **Step 15.3:** Router (separate repo — page 404s on apex until this lands):

```bash
cd ~/iCode/projects/rrm-router
# add '/rrm-success-rates', to ASTRO_ROUTES (alphabetical-ish placement near other pillar routes)
node test/router.test.js     # all smoke tests pass
CLOUDFLARE_API_TOKEN=$(op read "op://Automation/CF - Worker Deploy - account/credential") npx wrangler deploy
```

  Always pass `CLOUDFLARE_API_TOKEN` explicitly (wrangler hangs on interactive OAuth without it — confirmed in this repo 2026-06-03). Abort condition: if deploy hangs >60s, kill it and report to Brian; do NOT retry blind. Verify after deploy: `curl -sI https://rrmacademy.org/rrm-success-rates/ | head -1` → 200 (was 404-via-router before).

- [ ] **Step 15.4:** Live verification: `curl -sI https://rrmacademy.org/rrm-success-rates/ | head -1` → 200; `curl -s https://rrmacademy.org/sitemap-pillars.xml | grep rrm-success-rates` → present; `curl -sI "https://rrmacademy.org/og/rrm-success-rates.png"` → 200 PNG; JSON-LD `@type` set includes Article/MedicalWebPage/FAQPage/BreadcrumbList; charts render (load page in browser, scroll charts into viewport, screenshot — 200 from curl is NOT sufficient for images, per house rule).

### Task 16: Glossary entry uplink

- [ ] **Step 16.1:** Via the `/glossary-update` skill (NEVER raw SQL outside it): UPDATE `glossary_term` SET `pillar_link='/rrm-success-rates/'` WHERE `id='term_rrm-outcomes-published-evidence'` (verified in D1 2026-06-03: exists, published, pillar_link currently null). Keep the entry body as the summary tier (do not delete).
- [ ] **Step 16.2:** Single-record rebuild dispatch (`glossary_term_id: "term_rrm-outcomes-published-evidence"`), wait for deploy, verify the live glossary heading now links to the guide.

### Task 17: Branded PDF handout (explicit final step)

- [ ] **Step 17.0:** ⛔ **HARD STOP.** The PDF link un-hide is a content-publication change (mockup-gate rule applies independently of Task 15). Confirm Brian's explicit go-live for the PDF artifact — show him the generated PDF first — before pushing Step 17.3's branch.
- [ ] **Step 17.1:** Generate the PDF from the LIVE page's print rendering via CF Browser Rendering REST `/pdf` endpoint (`/cf-render` skill; pass `https://rrmacademy.org/rrm-success-rates/`; print CSS does the formatting work). Inspect output quality (fonts, charts, page breaks). If Browser Rendering output is inadequate, fall back to local Playwright `page.pdf()` against the live URL.
- [ ] **Step 17.2:** `mkdir -p public/downloads` (directory does not exist yet), then save as `public/downloads/rrm-success-rates-evidence-handout.pdf`. Un-hide the Task 11.2 download link. Note: this uses the stable direct-URL approach per spec §8; the email-gated `GUIDE_PDFS` infra stays untouched.
- [ ] **Step 17.3:** Commit + push (technical follow-up within approved scope): `git checkout -b claude/success-rates-pdf origin/main` (fresh branch off updated main), add the PDF + link un-hide, push, verify deploy, `curl -sI https://rrmacademy.org/downloads/rrm-success-rates-evidence-handout.pdf` → 200 `application/pdf`.

### Task 18: Post-publish hygiene (pillar-create Gate 13)

- [ ] **Step 18.1:** IndexNow ping: `curl -s "https://api.indexnow.org/indexnow?url=https://rrmacademy.org/rrm-success-rates/&key=<INDEXNOW_KEY from repo/1P>"`. Dispatch the `rrma-seo-operator` SUBAGENT (`subagent_type: "rrma-seo-operator"` — it is an agent type, not a slash skill) for post-publish hygiene incl. the AEO `retrieval.py` check scheduled 24-48h out. (`ai-surface-check` is not a standalone skill — the seo-operator covers surface checks.)
- [ ] **Step 18.2:** Worktree cleanup: `git worktree remove ~/iCode/.worktrees/rrm-success-rates`; delete merged local branches.
- [ ] **Step 18.3:** Offer Brian (do not auto-send): draft of Naomi→Emma reply with the live URL (spec §13 keeps this out of build scope).

---

## Self-Review Notes

- **Spec coverage:** §1-2 (Tasks 7, 9), §3-4 corpus (1-3), §5 structure (7-10), §6 charts (6), §7 share (5), §8 PDF (11, 17), §9 data model (2), §10 JSON-LD (7.2), §11 wiring (12, 15.3, 16), §12 gates (3, 4, 13, 14, 15.1), §13 out-of-scope respected (18.3 offer only).
- **Decisions honored (spec §14):** print CSS with page + branded PDF final step; committed JSON; concise condition paragraphs + chart.
- **Known judgment calls baked in:** ivf-success-calculator cross-link skipped (dev-gated stub — Rule 9); direct-URL PDF over email-gated GUIDE_PDFS; FAQ uses details/summary (pillar-create Gate 6) not the napro dl pattern; 5 FAQs (spec's 4 + RCT-honesty question).
- **Type consistency:** `SECTIONS`/`TOC_ITEMS`/`articleSection`/SectionShare `title` all derive from one `SECTIONS` array; FAQ markup + FAQPage derive from one `FAQS` array; all stats derive from one JSON file.
