# Deep-Research Prompt: Registry / External-Control Benchmarking in Medicine

**Purpose:** Hand this to a second deep-research LLM (GPT-5 Deep Research, Gemini Deep
Research, or a fresh Claude) to independently substantiate and cross-check the
registry-benchmarking claim used in the RRM Editorial responding to the Ganci et al.
2026 *Fertility and Sterility* systematic review.

**How to use the result:** Diff whatever it returns against the already-verified set at
the bottom of this file. Keep only citations that survive independent confirmation
(identifier resolves to the same paper). Treat any prose PMID/DOI as unverified until
checked against PubMed/CrossRef directly.

---

## THE PROMPT (copy everything in the code block)

```
DEEP RESEARCH TASK: Substantiate a methodological claim with verifiable citations.

CLAIM TO SUBSTANTIATE
"Benchmarking single-center or single-cohort clinical outcomes against large
external registries is routine, accepted methodology across medicine. In
oncology, single-institution series are compared against the SEER Program and
the National Cancer Database (NCDB). In transplantation, individual programs
are benchmarked against the Scientific Registry of Transplant Recipients (SRTR).
In rare diseases, patient registries and natural-history cohorts serve as
external comparators. More broadly, external and historical controls are a
recognized evidentiary tool with an established methodological and regulatory
basis, used where randomized controlled trials are infeasible or unethical."

CONTEXT (do not let it bias you toward overstating)
This claim appears in a scholarly editorial responding to a systematic review
that excluded all studies of a clinical approach because none used a randomized
control group, and concluded the approach was therefore unproven. The editorial
argues that registry/external-control benchmarking is a legitimate evidentiary
standard widely used elsewhere in medicine. I need the claim to be defensible to
a skeptical reproductive-medicine readership. If any part of the claim is
weaker than stated, say so explicitly.

WHAT I NEED
1. Find REAL, independently published exemplars for EACH bucket below: a
   peer-reviewed study that benchmarks single-center/single-cohort outcomes
   against the named registry.
   - SEER (cancer)
   - NCDB (cancer)
   - SRTR (transplant)
   - A rare-disease registry used as an external comparator/evidence basis
2. Find the foundational METHODOLOGICAL literature on historical/external
   controls (e.g., seminal methods papers, modern causal-inference treatments).
3. Find the REGULATORY basis for external controls where RCTs are infeasible
   (e.g., FDA guidance on externally controlled trials, ICH E10 "Choice of
   Control Group," EMA reflection papers on registries / small populations).
   Give the exact document title, issuing body, and year, plus a stable URL.
4. GOVERNMENT-AGENCY USE (critical add-on question):
   For each registry and for the external-control methodology, determine whether
   it is operated, funded, mandated, or formally used by a government agency, and
   name the agency. Specifically resolve, with an official .gov / primary source
   for each:
     - SEER: which agency operates it? (e.g., NIH / National Cancer Institute)
     - NCDB: is it a government program or a professional-society program?
       (Be precise. If it is NOT government, say so plainly and name the actual
       operator.)
     - SRTR: which agency provides oversight/funding? (e.g., HRSA within HHS)
     - CDC: does the CDC run its own cancer-registry program (e.g., the National
       Program of Cancer Registries), and is national cancer surveillance a
       combined CDC + NIH effort? Confirm with a CDC .gov source.
     - External/historical controls: has the FDA (and/or EMA) formally accepted
       external or real-world-data controls in actual regulatory decisions?
       Cite the guidance document and, where possible, a documented approval.
   The goal is to be able to state truthfully which of these registries and
   methods carry the endorsement of a named federal agency (NIH, CDC, HHS/HRSA,
   FDA). Distinguish government-operated from professional-society/industry-operated.

5. For each source, also assess: how strong is the analogy to a clinical field
   where RCTs are largely absent? Where does the analogy hold, and where might a
   critic legitimately push back?

HARD RULES ON CITATIONS (CRITICAL)
- Every citation MUST be real and independently verifiable. For journal articles
  give: authors, exact title, journal, year, PMID, and DOI.
- DO NOT invent or guess identifiers. A PMID or DOI that "looks right" but
  resolves to a different paper is a failure. If you are not certain an
  identifier is correct, OMIT the identifier and say "identifier unverified"
  rather than fabricating one.
- Confirm each identifier resolves to the SAME paper you are describing (title
  + first author + year must match). State how you confirmed it.
- For government/regulatory documents, give the official issuing-body URL.
- Distinguish clearly between (a) sources you verified against a primary
  database/official site and (b) sources you are reporting from memory and could
  not confirm. Label every source with a verification status.

OUTPUT FORMAT
A table grouped by bucket (SEER / NCDB / SRTR / Rare-disease / Methods /
Regulatory), columns: Authors | Title | Venue+Year | PMID | DOI/URL |
Verification status | Strength-of-analogy note.

Then a separate GOVERNMENT-USE table: Registry/Method | Operating or endorsing
agency | Government? (Yes/No) | Primary .gov source URL | Exact confirming quote.

End with a short paragraph stating which parts of the CLAIM are fully supported,
which are partially supported, and any caveats a critic could raise.
```

---

## Already-verified baseline (for the diff, 2026-05-23)

Verified by direct PubMed eutils + CrossRef title resolution and official `.gov`
fetches. Every PMID below was confirmed to resolve to the named paper. The second
LLM should independently confirm or refute, not trust this list.

### Journal citations (12/12 PMIDs confirmed against PubMed)

| Bucket | Citation | PMID | DOI |
|---|---|---|---|
| SEER | Ai et al., N3 breast cancer single-institution vs US SEER, *Cancer Manag Res* 2020 | 32753951 | 10.2147/CMAR.S246162 |
| NCDB | Ju et al., robotic colectomy single-institution vs NCDB, *J Laparoendosc Adv Surg Tech A* 2019 | 30096003 | 10.1089/lap.2018.0358 |
| NCDB | Palis et al., NCDB conforms to Standardized Framework for Registry & Data Quality, *Ann Surg Oncol* 2024 | 38717542 | 10.1245/s10434-024-15393-8 |
| SRTR | Schold & Buccini, center performance evals & kidney transplant volume, *Am J Transplant* 2013 | 23279681 | 10.1111/j.1600-6143.2012.04345.x |
| SRTR | VanWagner & Skaro, SRTR program-specific reports, *Curr Opin Organ Transplant* 2013 | 23481412 | 10.1097/MOT.0b013e32835f07f8 |
| SRTR | Li et al., combined liver+pancreas tx vs SRTR national db, *Front Med* 2020 | 33195293 | 10.3389/fmed.2020.542905 |
| Methods | Pocock, randomized + historical controls combination, *J Chronic Dis* 1976 | 770493 | 10.1016/0021-9681(76)90044-8 |
| Methods | Rippin & Ballarini, causal inference for external comparator arms, *Drug Saf* 2022 | 35895225 | 10.1007/s40264-022-01206-y |
| Regulatory | Subramaniam et al., regulatory acceptance of single-arm trials, *Ther Innov Regul Sci* 2024 | 39285061 | 10.1007/s43441-024-00693-8 |
| Regulatory | Izem et al., RWD as external controls in marketing applications, *Ther Innov Regul Sci* 2022 | 35676557 | 10.1007/s43441-022-00413-0 |
| Rare disease | Wu et al., RWE in US regulatory decisions for rare diseases, *Pharmacoepidemiol Drug Saf* 2020 | 32003065 | 10.1002/pds.4962 |
| Rare disease | Mercuri et al., ataluren DMD STRIDE Registry, *J Neurol* 2023 | 37115359 | 10.1007/s00415-023-11687-1 |

### Government-use findings (verified against official sources)

| Registry / basis | Government? | Operator / oversight (verified) | Source |
|---|---|---|---|
| **SEER** | Yes — NIH | National Cancer Institute (NIH) | seer.cancer.gov: "An official website of the United States government" |
| **SRTR** | Yes — HHS | "oversight and funding from the Health Resources and Services Administration" (HRSA/HHS) | srtr.org program-specific reports page |
| **CDC cancer surveillance** | Yes — CDC | National Program of Cancer Registries; U.S. Cancer Statistics = CDC NPCR + NCI SEER combined | cdc.gov U.S. Cancer Statistics (official .gov) |
| **External-control methodology** | Yes — FDA | FDA acceptance of external & real-world-data controls (documented in Subramaniam/Izem/Wu) | FDA (HHS) — confirm guidance doc URL |
| **NCDB** | **No** | American College of Surgeons (Commission on Cancer) + American Cancer Society — professional society + nonprofit, NOT a government agency | facs.org NCDB page |

**Honesty flag for the editorial:** if agencies are named, NCDB must be attributed
to the ACS / American Cancer Society, not lumped with the federal registries (SEER,
SRTR) or a critic will catch it.

### Method note (why prose PMIDs were rejected)
`pplx-search.py` (Perplexity Sonar Pro via OpenRouter) generates fluent prose with
plausible-but-fabricated PMIDs/DOIs. The script's own docstring warns: the only
trustworthy citations are the grounded `search_results` URLs, never the prose
identifiers. An earlier batch of 13 prose PMIDs resolved 0/13 to their claimed
papers. All identifiers above were instead resolved directly via PubMed eutils
(esearch + esummary) and CrossRef title search, then confirmed by re-resolution.
