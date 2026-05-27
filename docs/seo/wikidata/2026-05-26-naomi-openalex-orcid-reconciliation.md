# Naomi Whittaker — OpenAlex ↔ ORCID reconciliation handoff

**Date:** 2026-05-26
**Goal:** Bind OpenAlex author record `A5035074827` (11 works, 15 citations, currently `orcid: null`) to her verified ORCID `0000-0003-3706-3112`, so her citation record stops reading as a separate, unidentified person.

## Diagnosis (via ORCID public API, verified)

Her ORCID record has **17 works but only 8 carry DOIs**. Against the 11 works OpenAlex clustered under `A5035074827`:

- **6 DOIs already overlap** (enough shared signal that OpenAlex *could* auto-link, but it hasn't):
  - `10.1200/jco.2013.31.15_suppl.e14641`
  - `10.1200/jco.2012.30.34_suppl.34`
  - `10.1200/jco.2012.30.34_suppl.29`
  - `10.1200/jco.2012.30.34_suppl.257`
  - `10.1200/jco.2012.30.34_suppl.64`
  - `10.1096/fasebj.23.1_supplement.104.4`
- **5 OpenAlex DOIs are missing from ORCID** (4 ACOG case reports entered on ORCID by title without their DOIs, + the 2026 Tuboplasty chapter not on ORCID at all).

## Prong A — OpenAlex Author curation form (fixes the orphan now)

OpenAlex has **no self-serve ORCID login/claim** (verified). The only route is the curation form.

1. Open the Author disambiguation help article: `https://help.openalex.org/hc/en-us/articles/24347048891543-Author-disambiguation`
2. Follow its **"author curation form"** link.
3. Submit, pasting this (adjust contact fields):

> **Author record:** https://openalex.org/A5035074827
> **Request:** Please attach ORCID `0000-0003-3706-3112` to this author record. This author is Naomi M. Whittaker, MD.
> **Identity verification:** The following works already on this OpenAlex record are also on ORCID `0000-0003-3706-3112`:
> - 10.1200/jco.2013.31.15_suppl.e14641
> - 10.1200/jco.2012.30.34_suppl.34
> - 10.1200/jco.2012.30.34_suppl.29
> - 10.1200/jco.2012.30.34_suppl.257
> - 10.1200/jco.2012.30.34_suppl.64
> - 10.1096/fasebj.23.1_supplement.104.4
> Please also confirm no duplicate author records exist for this person (a name search returns only A5035074827).

No published SLA; changes propagate on their next index pass.

## Prong B — add the 5 missing DOIs to ORCID (hygiene; tightens auto-linkage)

**API automation is NOT available on the free tier** — adding/updating ORCID works requires the paid **Member API** (`/activities/update` scope). The free Public API is read-only. So do this in the ORCID UI (signed into orcid.org as Naomi), via **Add works → Search & Link → Crossref Metadata Search** (paste the DOI; it auto-fills the correct work). After adding the DOI-bearing version, delete the older no-DOI manual duplicate for that work.

| DOI to add | Matches the existing no-DOI ORCID entry (or new) |
|---|---|
| `10.1097/01.aog.0000514274.33429.53` | "Diamine Oxidase Deficiency as a Proposed Mechanism for Anaphylaxis…" (2017) |
| `10.1097/01.aog.0000483396.15861.e1` | "Five-Month Survival of a Neonate after Serial Amnioinfusions…" (2016) |
| `10.1097/01.aog.0000483921.49298.48` | "Ruptured Ectopic Pregnancy with Intact Abdominal Fetus" / "Case Study" (2016) |
| `10.1097/01.aog.0000483833.89572.19` | "An Ethical Analysis of the Antepartum Management of Pregnancy Complicated by Fetal Bilateral Renal Agenesis" (2015/2016) |
| `10.1201/9781003312109-33` | "Tuboplasty" (2026 book chapter) — NOT on ORCID; add new |

Confirm each title when Crossref auto-fills (a couple of the 2015–2016 entries are close in wording).

## Strategic option — ORCID membership

If RRM Foundation / RRM Academy becomes an ORCID member, the Member API enables programmatic write for ALL RRMA-authored works going forward (preprints, JRRM papers, library editorials) and "trusted party" auto-update from Crossref/DataCite. That's on-thesis for the citation-authority goal, but it's a paid institutional membership + application — a separate decision, not needed to fix this orphan.
