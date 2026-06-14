# Fertility-Preserving Surgery Pillar: Design

> Status: DESIGN (approved 2026-06-13). Build is held at the go-live gate. The
> page is built and staged for review; nothing publishes live until Brian
> explicitly says go.

## 1. Thesis

Surgery is not one thing. For a woman who wants to keep or improve her
fertility, the outcome depends far more on the surgeon's philosophy and
technique than on the procedure's name. This guide makes that legible as a
three-tier surgical-quality spectrum and applies it across the conditions that
send women to the operating room: endometriosis, ovarian cysts and
endometriomas, fibroids, tubal disease, pelvic adhesions, and polycystic ovary
syndrome (ovarian wedge resection).

The top tier is what restorative reproductive medicine (RRM) surgeons do:
complete disease removal plus the full restorative toolkit. The guide earns
that ranking through cited outcome differences, not rhetoric.

## 2. Gate 0 Brief

- **Slug / URL:** `/fertility-preserving-surgery/` (root, flat-URL IA). The
  searchable umbrella term; the RRM-specific tier is labeled "restorative
  reproductive surgery" inside the page. Confirmed not an existing route
  (existing: `/endometriosis/`, `/endometritis/`; no surgery route yet).
- **Working title:** "Fertility-Preserving Surgery: Restorative, Specialist, and
  Conventional Approaches Compared." The tier triad is Restorative / Specialist
  / Conventional.
- **Audience tilt:** Balanced patient + clinician, AEO co-primary. Patients
  first in each section (why it matters, what to ask), a tight technique/evidence
  layer for referring clinicians, and structure built so search engines and AI
  retrieval can quote it cleanly (the tier table, Key Takeaways, and FAQ are the
  citable blocks).
- **Design posture (goal, 2026-06-13):** Citeable, not exhaustive. The aim is a
  concise pillar that AI and search engines cite, NOT maximum depth. Target
  ~1200 to 1800 words. Every clinical claim is still sourced, but the page wins
  on structure and quotability, not length. The intro paragraph must be plain
  English and AEO-optimized: a direct, self-contained answer to "how do
  fertility-preserving surgeries differ" in the first two sentences.
- **Editorial stance:** RRM-aligned, critical-not-rhetorical. Excision-only for
  endometriosis. Every tier distinction anchored in a cited outcome. No public
  protocols or dosings.
- **SSOT scope:** Comparison data (the three tiers x dimensions, plus the
  per-condition tier rows) extracted to `src/data/fertility-preserving-surgery.json`
  and rendered via `.map()` with `set:html` for inline citation HTML. No
  hardcoded near-identical card blocks.
- **Library-record gap:** The build starts with a grounded evidence pass
  (Section 5). The ~5 to 15 source papers the guide cites that are not already
  in the library get ingested via `/rrm-ingest` before drafting. PMIDs are
  curl-verified, never asserted from memory.

## 3. The Tier Model (canonical definitions)

This block is the spine. It renders as the hero comparison and seeds the
JSON-LD ItemList.

### Tier 1: Restorative surgery, the fertility-first standard
Restorative reproductive (RRM) surgery. Complete excision or removal of disease
**plus** the full restorative toolkit: microsurgical, near-contiguous
dissection; reconstruction of normal anatomy; deliberate adhesion prevention
(technique plus barriers); ovarian-reserve sparing; and a root-cause focus that
treats the disease rather than only its symptoms. Goal: remove the disease and
leave the reproductive organs more functional than before.

### Tier 2: Specialist surgery, good but variable
A skilled specialist removes the disease (for example, excision of
endometriosis, myomectomy for fibroids, cystectomy for an ovarian cyst) but may
not employ the full restorative toolkit. Adhesion barriers, microsurgical
reconstructive closure, and explicit ovarian-reserve-sparing technique are
inconsistent. Outcomes are good and often very good, but depend heavily on the
individual surgeon.

### Tier 3: Conventional surgery, often sacrifices fertility
Ablation or fulguration of endometriosis (burning the surface rather than
removing the disease); reserve-depleting cyst stripping; "burn and move on";
default hysterectomy or oophorectomy where conservation was possible; or
surgery aimed only at symptom control. Fertility is frequently a casualty, not
a priority.

**Framing rule (hard):** Tier 1 is not asserted as "best." The page shows what
the evidence reports about specific technique contrasts and lets the tiers
follow. Language is "many/often," never "non-negotiable/always."

## 4. Section Outline (Approach A: philosophy-spectrum spine + per-condition application)

1. **Key Takeaways** (scannable bullets; the one-screen answer for patients and
   for AI retrieval).
2. **Why two operations with the same name can have opposite results** (the
   thesis: technique and philosophy over procedure name).
3. **The three tiers of reproductive surgery** (the Section 3 model + hero
   comparison table/card grid).
4. **Endometriosis surgery: excision vs ablation** (the sharpest, most-searched
   contrast; excision-only stance; recurrence, pain, and fertility evidence).
5. **Ovarian cysts and endometriomas: protecting ovarian reserve** (cystectomy
   technique and AMH/reserve impact; ablative/vaporization debate; why "just
   take the ovary" is tier 3 when conservation was possible).
6. **PCOS: ovarian wedge resection** (the purest illustration of the thesis.
   RRM ovarian wedge resection is the restorative, root-cause approach and the
   best option: with meticulous near-contiguous microsurgical technique and
   adhesion prevention it reduces the androgen-producing ovarian stroma to
   restore spontaneous ovulation and durable hormonal normalization, where
   drug-based ovulation induction only manages anovulation cycle by cycle
   without correcting the underlying ovarian pathology. NaPro/RRM technique is
   the whole point: the historical adhesion concern belongs to old-style
   bilateral wedge resection performed WITHOUT restorative technique, not to the
   RRM procedure, so non-RRM-technique adhesion data is not cited against it.
   Ovarian drilling is a destructive, tissue-ablating approach and is not
   presented as a competitive option. Cited to the library's wedge-resection
   hormone-normalization, long-term-effect, and fertility records plus the NaPro
   surgical-technique source. Non-surgical PCOS care cross-links to the PCOS
   pillar).
7. **Fibroids: myomectomy vs hysterectomy** (fertility-preserving removal vs
   definitive surgery; when each is appropriate).
8. **Tubal disease: reconstruction vs bypass** (microsurgical tubal repair /
   reversal as a restorative option vs default-to-IVF framing).
9. **Pelvic adhesions: prevention as technique** (adhesion barriers and
   microsurgical handling; why prevention is a tier-1 hallmark).
10. **What sets restorative surgery apart** (synthesis: the toolkit as a through
    line across conditions).
11. **How to find a restorative surgeon and what to ask** (patient action;
    routes to `/providers/`; a concrete question list for a surgical consult).
12. **Frequently Asked Questions** (FAQPage JSON-LD; no "Yes" leads on
    fertility/treatment questions).
13. **Continue exploring** (internal links to `/endometriosis/`, `/pcos/`,
    `/what-is-rrm/`, `/naprotechnology/`, relevant library records).

## 5. Evidence Backbone (research + ingest before drafting)

The guide is only as strong as its citations. Before any prose is written, run
a grounded evidence pass (Perplexity Sonar Pro + library audit), curl-verify
every PMID, and ingest missing sources. Claim targets, by section:

- **Excision vs ablation (endometriosis):** symptom/pain recurrence, reoperation
  rates, and fertility outcomes by technique.
- **Endometrioma technique and ovarian reserve:** cystectomy vs ablative
  vaporization and post-operative AMH / antral follicle count; bilateral-disease
  caution.
- **Myomectomy and fertility:** fertility-sparing fibroid removal vs
  hysterectomy; submucosal/intramural fibroid impact on conception.
- **Tubal microsurgery:** reconstruction / reversal outcomes as a restorative
  alternative to default IVF.
- **Adhesion prevention:** barrier agents and microsurgical technique on
  adhesion reformation and subsequent fertility.
- **PCOS ovarian wedge resection:** ovulation and pregnancy outcomes plus
  hormonal normalization after RRM wedge resection, and the NaPro surgical
  technique that distinguishes the RRM procedure from old-style wedge resection.
  The library holds 12+ wedge-resection records (long-term effects, hormone
  studies, fertility outcomes); cite the RRM-favorable outcome and technique
  records. Do NOT cite non-RRM-technique adhesion-comparison series (old
  bilateral wedge or drilling series) against the RRM procedure.
- **Restorative / microsurgical principles:** near-contiguous dissection and
  reconstructive technique in the RRM / NaPro surgical literature.

Citation density: every clinical claim carries an inline `/library/` link, but
the page chases citeability, not a link count. For a ~1200 to 1800 word guide
that is roughly 25 to 45 inline links, concentrated where claims are
contestable (excision vs ablation, reserve impact, wedge vs drilling). External
links reserved for legal/policy refs where no library record fits. The specific
PMID/DOI set is produced by the Gate-0 research pass and recorded in the
implementation plan, not invented here.

## 6. Comparison SSOT (`src/data/fertility-preserving-surgery.json`)

Two arrays:

- `tiers`: `[{ id, rank, label, shortLabel, goal, hallmarks[], fertilityImpact,
  whoPerformsIt }]` for the hero table. `shortLabel` values are
  `Restorative` / `Specialist` / `Conventional`.
- `conditions`: `[{ id, name, route, tier1, tier2, tier3, citationsHtml }]`
  where each `tierN` is the approach-at-that-tier for that condition, and
  `citationsHtml` carries inline `<a href="/library/...">` markup rendered with
  `set:html`.

Rendered via `.map()` in the `.astro` file. This keeps the per-condition rows
out of hardcoded duplicate markup and makes the ItemList JSON-LD a direct
projection of `tiers`.

## 7. JSON-LD `@graph`

- `['Article','MedicalWebPage']`: `author = #organization`,
  `reviewedBy = #naomi-whittaker`, `articleSection` strings matching in-page H2
  text exactly, `about` Thing entities (endometriosis, ovarian cyst, uterine
  fibroid, fallopian tube, fertility preservation, reproductive surgery).
- `BreadcrumbList`: Home -> Fertility-Preserving Surgery.
- `FAQPage`: from the Section 11 Q&A.
- `ItemList`: the three tiers as `ListItem`s (projection of `tiers`).

## 8. Content Guardrails (hard rules carried from memory)

1. **Earned superiority, not asserted.** Tier 1 ranks first because of cited
   outcome contrasts. Strip any sentence that ranks tiers without an adjacent
   citation.
2. **No absolutist patient copy.** No "non-negotiable," no most-never stacking.
   "Many/often" over "most/always." (`feedback-no-absolutist-patient-copy`)
3. **No "Yes" leads** on fertility/pregnancy/treatment FAQ answers; lead "In
   many cases..." (`feedback-no-hard-yes-fertility-faqs`)
4. **Excision-only** for endometriosis. Hormonal suppression is not framed as
   curative.
5. **No public protocols or dosings.** (`feedback-no-public-protocols-or-dosings`)
6. **Do not funnel patients to Dr. Whittaker.** She is reviewer/author voice,
   not a referral target; patient action routes to `/providers/`.
   (`rrma-not-patient-funnel-to-naomi`)
7. **Strong practice claims need provenance.** Any specific outcome or
   technique-superiority claim is sourced to data or a named authority, never
   agent-generated. (`feedback-no-absolutist-patient-copy`)

## 9. Authorship / Byline

Org-author + Naomi-reviewed, the standard pillar pattern:
`By RRM Academy / Reviewed by Dr. Naomi Whittaker, MD, Board-Certified OBGYN,
MIGS, NFPMC, FCI`. Her MIGS (minimally invasive gynecologic surgery) fellowship
makes this guide squarely within her surgical authority, which strengthens the
reviewer signal. JSON-LD `reviewedBy = #naomi-whittaker`.

## 10. Build, Gates, and Go-Live

- Built via the `guide-create` pillar workflow; structure copied from the
  closest matches (`/art-registries-and-codes/` for the comparison-frame card
  grid + ItemList; `/endometriosis/` for clinical-pillar voice).
- **Prose drafted/checked by the `gianna-copywriter` agent** (Dr. Whittaker's
  clinical voice, RRM compliance) and **the page checked by the
  `rrma-seo-operator` agent** for AEO/retrieval optimization (schema, FAQ
  schema, meta, quotable structure) before staging.
- **Plain-English AEO intro:** the lead paragraph answers the core question
  directly in its first two sentences, self-contained enough for an AI to quote.
- **Guide-convention compliance:** breadcrumb, org-author + Naomi-reviewed
  byline, `LastUpdated`, `SectionTocChips` on shell, `MaybeShell` wrap with
  `route='guides'` shell key, BackToTop, JSON-LD `@graph`, `articleSection`
  strings matching in-page H2 text exactly. Verified against an existing pillar.
- Register the guide in `ssot/guides.json` and `src/data/guides.json`
  (slug, title, description, url, sectionHeadings matching in-page H2s).
- **Routing:** add `/fertility-preserving-surgery` to `ASTRO_ROUTES` in
  `rrm-router/src/index.js` and deploy the router, or the page 404s on the apex
  even after the Pages deploy (new root paths route to Wix until listed).
- Pre-push: `npm run lint`, design-tokens check, lint-identity byline gate,
  arise-scan + lint-secrets pre-commit chain, `web-page-qa` render gate (mobile
  393x852 + desktop).
- Deploy guard floors unaffected (guide is a static page, not a counted
  pipeline). Single `workflow_dispatch` deploy after staging review.
- **Held at the go-live gate.** "Build it" and "fix all" mean technical work
  only; live publication requires an explicit go-live from Brian.
  (`feedback-mockup-gate-before-live-publish`)
- Spec commit stages ONLY this file (the shared clone has unrelated in-flight
  changes from parallel sessions). (`feedback-git-hygiene`)

## 11. Out of Scope (YAGNI)

- No surgeon directory or per-surgeon listings (the provider directory is
  offline and dark; route to `/providers/` only).
- PCOS appears only through its surgical dimension: ovarian wedge resection (a
  tier-1 restorative procedure), with drilling/electrocoagulation as the tier-3
  destructive contrast. Non-surgical PCOS management (diagnosis, ovulation
  induction, metabolic care) stays out of scope and cross-links to the PCOS
  pillar. Drilling is not featured as a recommended option, only as the
  destructive foil to wedge resection.
- No interactive tools or calculators in v1.
- No commentary or FAQ singletons in this build; those are downstream follow-ons
  that link back to the pillar.

## 12. Risks / Open Questions

- **Evidence symmetry:** apply the same rigor to RRM/NaPro surgical claims as to
  conventional-surgery claims. If the evidence on a specific contrast is weaker
  than the framing implies, soften the framing, not the citation.
- **Breadth vs depth:** six conditions risks thinning the evidence per section.
  Mitigation: endometriosis, endometrioma, and PCOS wedge resection carry the
  densest evidence (all three well-sourced in the library); tubal, fibroid, and
  adhesion sections stay tight and link out.
- **PCOS stance (settled by Brian, 2026-06-13):** RRM ovarian wedge resection
  is the restorative best approach, full stop. The case rests on root-cause
  correction and durable ovulation restoration documented in the library's
  wedge records plus NaPro surgical technique. Do NOT import an ART/RCT-supremacy
  lens, and do NOT cite non-RRM-technique adhesion data (e.g. 1981 bilateral
  wedge or drilling-comparison series) against the RRM procedure: the historical
  adhesion problem is an artifact of wedge resection done WITHOUT restorative
  technique, which is the opposite of the point. Drilling is a destructive,
  lesser approach and is not platformed.
- **Agent-selection rule:** the `art-evidence-analyst` agent is for critiquing
  IVF/ART papers and must NOT be used to assemble RRM's own clinical case; it
  imports an RCT-supremacy lens that punches down on RRM. RRM evidence work uses
  `rrm-cli` (library/canon) and the `gianna-copywriter` agent.
- **Title:** confirmed plain declarative with the Restorative / Specialist /
  Conventional triad. No pathology-lead variant.
