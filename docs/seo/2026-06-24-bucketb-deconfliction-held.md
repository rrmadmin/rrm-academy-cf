# Bucket-B Cannibalization Deconfliction (re-implementation) -- HELD for go-live

**Status:** HELD at Brian's content go-live gate. The `ssot/guides.json` changes in this
commit are NOT yet deployed. The D1 commentary changes below are NOT yet executed.

**Why this exists:** the original Bucket-B work (drafted 2026-06-19, branch
`claude/bucketb-deconfliction`) was never committed -- it lived as uncommitted edits in a
`/tmp` worktree that macOS reaped, so the code was lost. Spec survived in memory
`rrma-bucketb-ctr-audit`. This is the re-implementation onto current `origin/main`, committed
this time.

**Problem being fixed:** two of our own pages split authority and cannibalize each other.
Live Ahrefs (2026-06-24) shows `/what-is-rrm/` lost 24 monthly visits to its own FAQ over the
prior month (pillar "rrm meaning" #8 down, FAQ "rrm meaning" #7 up). Fix = stop the pages
competing: protect the AEO-winning FAQ untouched; reposition the pillar off the bare
definition; and split the NaPro pillar (definition + "find a doctor") from the surgery
commentary (surgery/surgeons).

## Applied in this commit (`ssot/guides.json`, 3 method pillars)

GuideLayout renders the SEO `<title>` from `pageTitle` and the on-page `<h1>` from `pageH1`.

| Slug | Field | Before | After |
|------|-------|--------|-------|
| what-is-rrm | pageTitle | What Is RRM? Restorative Reproductive Medicine | How RRM Works: Conditions, Causes, and Restorative Care |
| what-is-rrm | pageH1 | What Is Restorative Reproductive Medicine (RRM)? | Restorative Reproductive Medicine: A Field Guide to Root-Cause Care |
| naprotechnology | pageTitle | NaProTechnology Explained by a Trained OBGYN | NaProTechnology: What It Is and How to Find a NaPro Doctor |
| naprotechnology | pageH1 | NaProTechnology: How It Works and What It Treats | What Is NaProTechnology? A Guide for Patients Looking for a NaPro Doctor |
| femm | pageTitle | FEMM Method Explained: A Clinician's Guide | FEMM Method: What It Is, How It Works, and What It Treats |

`pageDescription`, `title` (catalogue), and `og_title` left UNCHANGED (out of spec scope).

## Decisions baked in
- **Negation-reframe avoided.** The original draft's new `/what-is-rrm/` meta carried "treat the
  condition, not the symptom" (trips the negation-reframe ban). The current `pageDescription`
  ("...diagnoses and treats root causes of infertility, endometriosis, PCOS, and recurrent
  miscarriage. Learn how RRM works.") is already compliant and on-message for the repositioning,
  so it is KEPT as-is. No banned phrasing introduced. (Resolves the open 06-19 question by default.)
- **og_title / catalogue title left old.** Minor inconsistency (social card + guides-catalogue
  card still say "What Is RRM?"). Deconfliction works off `pageTitle`/`pageH1` (the Google +
  on-page signals), so this is non-blocking. Flag if full alignment is wanted.
- **Title length.** With BaseLayout's " | RRM Academy" suffix, the new titles run ~68-70 chars
  (Google may truncate ~60). Existing pillars run ~57. The longer titles are the approved 06-19
  copy; trim on request.

## HELD -- NOT in this commit (D1 content + internal links, go-live actions)

The commentary posts live in D1 `rrm-auth` (`posts` table), not in this repo. Confirm the H1
column vs title before running (commentary may render H1 from `title`). DO NOT RUN until go-live.

1. **`/commentary/naprotechnology-surgery-a-restorative-approach-to-fertility-and-gynecologic-health/`**
   - title -> `NaPro Surgery: Endometriosis Excision and Tubal Repair`
   - H1 -> `NaPro Surgery: What NaPro Surgeons Treat and How`
2. **`/commentary/uterine-isthmocele-c-section-scar-restorative-solutions/`**
   - title -> `Uterine Isthmocele: Symptoms and C-Section Scar Defect Repair`

```sql
-- HELD. Run against rrm-auth at go-live only. Verify column names + add H1 column if separate.
UPDATE posts SET title = 'NaPro Surgery: Endometriosis Excision and Tubal Repair'
  WHERE slug = 'naprotechnology-surgery-a-restorative-approach-to-fertility-and-gynecologic-health';
UPDATE posts SET title = 'Uterine Isthmocele: Symptoms and C-Section Scar Defect Repair'
  WHERE slug = 'uterine-isthmocele-c-section-scar-restorative-solutions';
```

3. **Internal-link wiring (structural):** link the surgery commentary up to `/naprotechnology/`,
   and the pillar's surgery section down to the commentary. Reinforces the pillar=definition /
   commentary=surgery split. Pillar side = edit `src/pages/naprotechnology/index.astro`
   (`#napro-surgery` section); commentary side = D1 post body.

## Go-live checklist (when Brian approves)
1. Deploy this branch's `ssot/guides.json` change (pillar titles/H1s).
2. Run the two D1 `UPDATE`s above against `rrm-auth`.
3. Add the napro pillar<->commentary internal links.
4. Verify the 3 pillar pages render the new `<title>`/`<h1>`; verify the 2 commentary titles live.
5. Watch `/what-is-rrm/` + the napro cluster vs the aeo-slip-check baseline; confirm the pillar
   recovers and the FAQ holds.
