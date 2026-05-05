# Glossary Review 2026-05-02 -- P2 Resolution Log

**Date closed:** 2026-05-03 (Brian's "tier 3" batch)
**Source review:** `docs/glossary-review-2026-05-02.md`
**Branches:** `claude/glossary-p2-wave1` (commits 3cf394c + bc35db4 + b284310)
**SQL applied:** `scripts/glossary-p2-wave1.sql`, `scripts/glossary-p2-wave2.sql`, `scripts/glossary-p2-wave3.sql`

## Disposition summary

P2 totals 36 issues. Resolved as:

| Wave | Count | Type | Disposition |
|------|-------|------|-------------|
| W1 | 14 | Mechanical + clear factual | Shipped to D1 |
| W2 | 6 | Well-specified body edits | Shipped to D1 (incl. new ref-86) |
| W3 | 3 | Framing / tone | Shipped to D1 |
| W4 | 13 | Log-only consensus_conflict | No edit; documented below |
| **Total** | **36** | | **23 shipped, 13 documented** |

## W1 -- 14 mechanical + factual (shipped)

**Abbreviation table inserts (9):**
- BIP -- Base Infertile Pattern
- ESP -- Essential Sameness Pattern
- FABMs -- Fertility Awareness-Based Methods (plural; FABM singular already existed)
- MCS -- Mucus Cycle Score
- POC -- Point of Change
- PMB -- Premenstrual Bleeding
- STM -- Sympto-Thermal Method
- TEB -- Tail-End Brown Bleeding
- VDRS -- Vaginal Discharge Recording System

**Body fixes (5):**
- `adhesion-prevention`: "over a decade" -> "over 23 years" (per Hilgers 2010 J Gynecol Surg primary)
- `prematurity-prevention-program`: "12.7% U.S. national" -> "12.0% comparison group" (matches Hilgers's actual cited Pope Paul VI Institute comparator)
- `sperm-dna-fragmentation`: unify body abbreviation to DFI throughout (term name + abbreviation field already use DFI)
- `isthmocele-repair-hysteroscopic`: ">5mm" -> ">=2.5-3mm" (Vitale 2023 PMC10416161 / Tulandi & Cohen 2019 mainstream consensus)
- `isthmocele-repair-laparoscopic`: "<5mm" -> "<3mm" (paired threshold)

## W2 -- 6 well-specified body edits + 1 new ref (shipped)

- `marquette-method`: rephrase FACTS framing (FACTS is a separate nonprofit; Marquette training delivered through Marquette University Institute for NFP)
- `billings-ovulation-method`: add ref-74 (Billings JJ 1981) alongside ref-85 (Urrutia 2018) -- closes "missing_citation"
- **NEW ref-86**: Doyle N et al, JAMA 2022 (PMID 36094567). RCT n=767, no live-birth improvement.
- `era`: add Doyle 2022 RCT caveat sentence + ESHRE/ASRM 2023 guideline note; cites ref-86
- `fcp`: replace FCCA-only framing with AAFCP-accredited training + AAFCP credentialing
- `art`: remove IUI from ART list; add CDC ARTSAA 1992 clarification (CDC excludes IUI; HFEA/ESHRE may include it)
- `nfpmc`: contextualize NFPMC as legacy designation (pre-2019); current credential is CrMSMC issued by AAFCP. SPVI Saint John Paul the Great Fellowship is a complementary, distinct one-year fellowship producing Senior Medical Consultants.

## W3 -- 3 framing/tone fixes (shipped)

- `achieving-related-pregnancy-rate` (ARPR): refine framing of foundational dataset attribution. The 1,876-couple / 17,130.5-couple-month composite originated in Hilgers and Stanford 1998 J Reprod Med as an avoiding-pregnancy use-effectiveness analysis; ARPR is a methodological adaptation applying the same life-table framework to the achieving-pregnancy direction.
- `rhri`: soften "has published peer-reviewed research linking" to "has championed clinical attention to" -- specific Vigil/RHRI pubs making this exact link were not located; the underlying PCOS-CVD/T2D linkage is well established in non-RHRI literature.
- `methylated-folate`: add one balance sentence acknowledging ACMG/ACOG position (do not recommend routine MTHFR testing in mainstream practice) while keeping RRM proactive-testing canon.

## W4 -- 13 log-only consensus_conflict (no edit, documented)

Per the glossary-review skill hard rule: "consensus_conflict is P2, never auto-fail. Perplexity reflects mainstream consensus, not RRM canon. When they conflict (excision-only endo, NaPro positioning, mainstream PCOS framing, IVF outcome stats, Hilgers protocols), log both verbatim under category consensus_conflict and let Brian arbitrate."

The following 13 items were logged as consensus_conflict and confirmed as **no glossary edit required** during review. Each entry already framed correctly per RRM canon, properly attributed to NaPro/center series, or invalidated by Perplexity false-negative.

| Term | Reason no edit |
|------|----------------|
| `lowr` (Laparoscopic Ovarian Wedge Resection) | NaPro 70% PR explicitly framed as "NaPro wedge resection" with ref-10 attribution. Internally consistent. |
| `tubal-ligation-reversal` | 88% under-30 ring/clip figure plausible from microsurgical center series. ref-32 Schubert series is consistent. |
| `autoimmune-thrombophilic` | RRM-vs-mainstream divergence already framed as "beyond APS, RRM evaluates". Accurate. |
| `chronic-endometritis` | Mitter 2021 HR 2.28 / 2.76 figures correctly cited (ref-51). Replication mixed elsewhere is enhancement-territory (P3). |
| `rpl` (Recurrent Pregnancy Loss) | RRM workup philosophy framed correctly; cross-linked to `autoimmune-thrombophilic`. |
| `afollicularism` (AF) | RRM canon authoritative on >1.4 cm threshold. Perplexity wrong on threshold (Hilgers Ch 20 confirms). |
| `hcg` | Perplexity false-negative on Quenby & Farquharson 1994 hCG RCT. rrm-cli D1 has the source. |
| `immature-follicle-syndrome` (IFS) | RRM canon authoritative on >=1.90 cm maturity definition. Perplexity wrong. |
| `time-to-pregnancy` (TTP) | ref-11 hoiobgyn URL: 403 to crawler UA but human-accessible. Bot protection, not broken; track as access_blocked. |
| `unexplained-infertility` | ref-1 iirrm.org URL: 403 (CF challenge wall) to bots; human-accessible. Same as TTP. |
| `window-of-implantation` (WOI) | "20-25% RIF displacement" reports a measurement, not a clinical-benefit claim. Acceptable as-is. |
| `migs` | RRM/NaPro mini-laparotomy inclusion is consistent with how RRM surgical practice categorizes fertility-sparing technique. Optional rephrase noted in review. |
| `reproductive-immunology` | RRM-distinct framing acceptable per Hard Rules ("RRM canon != mainstream consensus by design"). Treatment-modality sentence already dropped during P0/P1. |

## Glossary state after P2 close (2026-05-03)

| | Pre-P2 (2026-05-02 EOD) | Post-P2 (2026-05-03) | Delta |
|---|--------|-------|-------|
| `glossary_term` published | 193 | 193 | 0 |
| `glossary_reference` | 84 | **85** | +1 (Doyle 2022 JAMA RCT for ERA) |
| `glossary_abbreviation` | 61 | **70** | +9 (Part II abbr table inserts) |

## Open items (deferred to next review cycle or future passes)

- **P3 batch (19 enhancements)**: better-source opportunities, missing cross-refs, stronger Hilgers-fact opportunities. Not blocking.
- **Perplexity coverage top-up**: 74 of 194 terms still skipped Perplexity in original review (cost-saving when canon + curl agreed). Recommended before any "verified-glossary" public claim. ~$0.11 to close.
- **Phase 2 D1 schema**: optional `verified_at` / `verified_by` / `last_review_report` columns on the 3 glossary tables. Lets the next cycle skip clean terms (`WHERE verified_at < date('now','-90 day')`).
- **Annual cadence**: re-run `/glossary-review` Workflow A around 2027-05-02 (or sooner after any large content expansion).

## Live verification (post-deploy)

- [ ] glossary-p2-wave1 commits b284310 land on main via auto-merge
- [ ] Full Build & Deploy completes successfully
- [ ] curl rrmacademy.org/glossary/ shows new abbreviations + body changes
- [ ] No regressions on existing terms (spot-check ARPR, NFPMC, ART, FCP, ERA, billings, marquette)
- [ ] glossary.json fetches from D1 and includes new ref-86 in references[]
