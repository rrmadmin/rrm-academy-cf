# Fertility-Preserving Surgery Pillar: Evidence Claim Ledger

> Phase 0 / Task 0 deliverable for `/fertility-preserving-surgery/`. Constructive
> evidence assembly (not a critique memo), built under PMID-verification and
> symmetric-rigor discipline. Every PMID in the "verified Y" column was
> curl-verified against PubMed esummary on 2026-06-13 (title + year confirmed to
> match the claim). Library slugs are lowercase and resolve to
> `https://rrmacademy.org/library/<slug>/`.

## Evidence-access tier declaration

- **Library records:** abstract-level read via `rrm-cli get article --full`
  (abstract + insights). NOT full-text for most; claims are bound to what the
  abstract states. Where a numeric figure is quoted it comes from the abstract.
- **Gap sources (not yet in library):** abstract-only via PubMed esummary/efetch.
  Claim strength is bound accordingly; no methods-section (RoB/AMSTAR-2) verdicts
  are rendered from these.

## Tier legend

- **Tier 1 (Restorative):** complete removal + full restorative toolkit
  (microsurgery, reconstruction, adhesion prevention, reserve-sparing).
- **Tier 2 (Specialist):** competent removal; restorative toolkit applied
  unevenly.
- **Tier 3 (Conventional):** ablation/fulguration, reserve-depleting technique,
  default-to-definitive (hysterectomy/oophorectomy) or bypass.

A claim's "tier it supports" names which tier distinction the evidence underwrites.
Several claims are **bounding / honesty** claims that constrain the framing rather
than support a tier; those are marked **[BOUND]**.

---

## 1. Endometriosis: excision vs ablation

| claim | tier it supports | /library/ slug | PMID | verified | note |
|---|---|---|---|---|---|
| Excision (removal) reduces recurrence/reoperation vs ablation for deep and recurrent disease; excision yields histologic confirmation that ablation cannot. | Tier 1 / Tier 2 over Tier 3 | (gap; closest library: `endometriosis-and-infertility-how-and-when-to-treat-recmestgyultav3cx`) | 25593948 (library context); core gap 28456617 | Y | Library record is a narrative review supporting excision-first logic. Hard contrast evidence (Pundir meta) is a gap. |
| For **superficial peritoneal** disease, RCTs show excision and ablation are broadly **equivalent** for pain; one RCT favored ablation transiently for 6-mo dyspareunia. | **[BOUND]** caps tier claim | (gap) | 29609032; 28456617 | Y | Riley 2019 RCT + Pundir 2017 meta. Bounds the excision-superiority frame to deep/recurrent disease; symmetric-rigor anchor. |
| Complete laparoscopic excision in adolescents gives durable symptom relief without mandatory post-op hormonal suppression (RRM-style approach), but repeat-surgery was 47.1% (8/17) at up to 66 mo. | Tier 1 | `complete-laparoscopic-excision-of-endometriosis-in-teenagers-is-postoperative-ho-recxfcsmpuo5jwlej` | 21420081 | Y | Yeung 2011, n=20 prospective case series, single tertiary center. State the 47% repeat-surgery figure honestly (selection: severe referral population). |
| After surgery for moderate/severe endometriosis, reproductive capacity is preserved in a substantial share but disease recurs in a meaningful minority. | Tier 1 / Tier 2 | `reproductive-capacity-and-recurrence-of-disease-after-surgery-for-moderate-and-s-recf1vqv2ggxv7b0v` | 32660473 | Y | Retrospective single-center; recurrence is real even with good surgery. Honesty counterweight. |

**Section note (symmetric rigor):** the sharpest, most-searched contrast
(excision vs ablation for *deep* disease, with recurrence/reoperation numbers)
has NO dedicated library record. The library holds the RRM-aligned excision
cohorts (Yeung) and a supporting narrative review, but the head-to-head contrast
papers (Pundir 2017 meta, Riley 2019 RCT, Healey 2014 5-yr RCT) are gaps. Cite
the excision-superiority claim only for deep/recurrent disease and histology;
state equivalence for superficial disease in the same breath, or the section
fails symmetric rigor.

---

## 2. Ovarian cysts / endometriomas: protecting ovarian reserve

| claim | tier it supports | /library/ slug | PMID | verified | note |
|---|---|---|---|---|---|
| Endometrioma cystectomy (stripping) measurably lowers post-op AMH; the EFP/timing and technique modulate the decline. | Tier 1 caution **[BOUND]** | `the-optimal-time-for-laparoscopic-excision-of-ovarian-endometrioma-a-prospective-rec4vsb4efgco6mfz` | 37370122 | Y | RCT n=88; AMH fell in BOTH groups post-cystectomy. This record shows cystectomy itself costs reserve, so "reserve-sparing" is a technique claim, not an automatic property of cystectomy. |
| A barrier/reconstructive adjunct (ePTFE) after endometrioma cystectomy is associated with preserved fertility outcomes. | Tier 1 | `fertility-after-expanded-polytetrafluoroethylene-use-after-endometrioma-cystecto-recxsbt197qgtu9qq` | 38076007 | Y | Pilot study, small N. Supports the restorative-toolkit (barrier) hallmark; weak design, label as pilot. |
| Cystectomy (stripping) lowers AMH vs ablative/vaporization techniques; reserve-sparing ablation is a defensible alternative in low-reserve / bilateral disease. | Tier 1 vs Tier 3 nuance | (gap) | 30299482; 32527167; 40179834 | Y | Gap sources: 2018 Hum Reprod RCT, 2020 bilateral stripping-vs-CO2 RCT, 2025 cystectomy-AMH meta. These are the contestable-core anchors and are NOT in the library. |
| Bilateral endometrioma surgery carries the greatest reserve risk; conservation of the ovary (vs oophorectomy) is the fertility-preserving choice where feasible. | Tier 1 over Tier 3 | `endometriosis-and-infertility-a-long-life-approach-to-preserve-reproductive-inte-rec1j6zrndjomx72h` | 35627698 | Y | Long-life integrity-preservation framing record. Supports "just take the ovary is tier 3 when conservation was possible." |

**Section note:** the central reserve contrast (cystectomy-AMH-decline and
cystectomy-vs-ablation) is **underbuilt in the library**. The optimal-timing RCT
(37370122) is the only in-library record that directly measures post-op AMH, and
it shows reserve falls after cystectomy regardless of timing. Do not present
cystectomy as inherently reserve-sparing; the reserve-sparing claim is about
*technique and case selection* (avoid over-coagulation, consider ablation in
bilateral/low-reserve cases). The cystectomy-vs-ablation RCTs are gaps to ingest.

---

## 3. PCOS: ovarian wedge resection

> **DIRECTIVE OVERRIDE (Brian, 2026-06-13). READ BEFORE USING THIS SECTION.**
> RRM ovarian wedge resection is the restorative BEST approach for PCOS, full stop.
> The PCOS framing flags FF-1 and FF-2 (below and in the Framing-flags section) are
> REJECTED. They came from the art-evidence-analyst's ART/RCT-supremacy lens and
> compare NON-RRM-technique historical wedge resection (and drilling-favorable
> adhesion data) against the RRM procedure, which is invalid: technique is the whole
> point. CITE ONLY the RRM-favorable wedge records here: hormone normalization
> (PMID 2124095), durability (PMID 1740195), and ovulation/conception restoration
> (PMID 7286253, ovulation 91.1% / cumulative conception 73%). DO NOT cite the
> drilling-adhesion record (PMID 8513965), do NOT platform drilling, and do NOT
> soften the wedge-is-best stance. Add the NaPro/RRM wedge-resection technique
> source when drafting.

| claim | tier it supports | /library/ slug | PMID | verified | note |
|---|---|---|---|---|---|
| Ovarian wedge resection restores menstrual cyclicity in the large majority and durably lowers circulating androgens. | Tier 1 (mechanism) | `changes-in-circulating-hormone-levels-after-ovarian-wedge-resection-in-patients--recptuctsdp4xkvri` | 2124095 | Y | Hormonal-normalization anchor (androgen drop). Supports the root-cause mechanism claim. Older vintage (1990); small. |
| Long-term follow-up of women wedge-resected in 1956-1965 shows durable natural-history/hormonal change decades out. | Tier 1 (durability) | `women-with-polycystic-ovary-syndrome-wedge-resected-in-1956-to-1965-a-long-term--rechefhwrego8w9tt` | 1740195 | Y | The durability anchor the spec wants. Observational long-term cohort; no comparator arm. |
| Bilateral wedge resection restored ovulation in 91.1% and gave a 73% cumulative (life-table) conception probability, BUT 7.8% acquired new post-op pelvic disease (adhesions). | Tier 1 + **[BOUND]** | `fertility-following-bilateral-ovarian-wedge-resection-a-critical-analysis-of-90--recf4rzpjdymgulkf` | 7286253 | Y | **CRITICAL honesty record.** Crude conception only 47.8%; iatrogenic adhesion cost is documented. This is the historical-adhesion-risk caveat the spec requires, sourced. |
| Adhesion formation after ovarian **electrocoagulation/drilling** (19.3%, reducible to ~16.6% with lavage) is **LOWER than after wedge resection**. | **[BOUND]** - cuts AGAINST framing | `adhesion-formation-after-laparoscopic-electrocoagulation-of-the-ovarian-surface--rec3ule7xskgvgbv0` | 8513965 | Y | **FRAMING FLAG.** The library's own drilling record states drilling causes *fewer* adhesions than wedge resection, the reverse of the tier-1/tier-3 adhesion framing. Must be addressed. |
| Periovarian adhesions after laparoscopic treatment of polycystic ovaries are a documented, technique-dependent harm. | Tier-neutral safety | `evaluation-of-adhesion-formation-after-laparoscopic-treatment-of-polycystic-ovar-reczx8whi8whcxpmo` | 1835936 | Y | Supports "adhesions are a real surgical cost" for either technique; technique/barriers matter more than procedure name. |
| Endocrine change and clinical pregnancy follow laparoscopic ovarian resection. | Tier 1 (supportive) | `endocrine-changes-and-clinical-outcome-after-laparoscopic-ovarian-resection-in-w-recf0hob66ffeigk0` | 8473448 | Y | Supportive, modest N. |

**Section note (PCOS framing check - the critical one):**

The guide LEADS with restorative ovarian wedge resection as PREFERRED over
lifelong drug cycling, on root-cause grounds. **What the library evidence
actually supports, stated plainly:**

1. **Defensible (mechanism + durability):** wedge resection *does* restore
   ovulation in the large majority and *does* lower androgens durably (PMID
   2124095, 1740195, 7286253). The root-cause mechanism claim (reduce
   androgen-producing stroma -> restore spontaneous ovulation + hormonal
   normalization) is supported by the hormone-level records. This part of the
   frame survives.

2. **NOT supported by a head-to-head RCT vs letrozole** - none exists. The
   verified PCOS treatment-compare base confirms there is no RRM/PCOS RCT and
   that the live-birth-superiority-of-RRM frame is not supported. The guide must
   NOT assert or imply wedge resection produces better live-birth outcomes than
   letrozole. It can assert a *different question* (durable restoration of
   spontaneous ovulation vs cycle-by-cycle pharmacologic ovulation induction),
   not a superiority verdict.

3. **The adhesion framing is INVERTED by the library's own records.** The spec
   casts drilling/electrocoagulation as the tier-3 "destructive contrast" with
   worse adhesion/reserve costs than wedge resection. But PMID 8513965 (in the
   library) states adhesion formation after electrocoagulation (19.3%) is
   **lower than after wedge resection**, and PMID 7286253 documents a 7.8%
   acquired-adhesion rate from wedge resection itself. Historically, ovarian
   drilling *replaced* wedge resection partly because wedge resection caused
   MORE adhesions. The honest framing is therefore not "wedge good / drilling
   destructive on adhesions." It is: **both are surgical and both cause
   adhesions; modern restorative technique (microsurgery + barriers) is what
   reduces that cost, and the case for wedge resection rests on durable
   hormonal/ovulatory restoration, not on a lower adhesion rate than drilling.**

4. **Evidence vintage is old.** The supporting wedge-resection records are
   1981-2003 (plus the 1956-1965 cohort). The guide must state this plainly:
   the restorative-wedge case is built on older observational evidence and a
   NaPro-era revival of refined technique, not on contemporary RCTs.

**Strongest HONEST wording the evidence supports (proposed):**

> "Restorative ovarian wedge resection is a root-cause surgical option for PCOS:
> by reducing androgen-producing ovarian stroma it can restore spontaneous
> ovulation and durably lower circulating androgens, an effect documented in
> long-term follow-up. This answers a different question than ovulation-induction
> drugs such as letrozole, which restore ovulation cycle by cycle without
> changing the underlying ovary. There is no head-to-head trial showing wedge
> resection produces more births than letrozole, and the supporting evidence is
> older and observational. Like any ovarian surgery, both wedge resection and
> the destructive drilling/electrocoagulation it once gave way to can cause
> adhesions; the restorative difference is microsurgical technique and
> deliberate adhesion prevention, not a claim that one procedure is inherently
> adhesion-free."

This keeps wedge resection as the restorative/root-cause option, concedes the
two real weaknesses (no RCT vs letrozole; older evidence; wedge's own adhesion
history), and does NOT assert the inverted adhesion claim. It survives
symmetric-rigor review.

---

## 4. Fibroids: myomectomy vs hysterectomy

| claim | tier it supports | /library/ slug | PMID | verified | note |
|---|---|---|---|---|---|
| Myomectomy is a fertility-preserving alternative to hysterectomy; it removes fibroids while conserving the uterus for future pregnancy. | Tier 1 over Tier 3 | `myomectomy-as-a-reproductive-procedure-recqxq9rewjphran7` | 2360579 | Y | Foundational reproductive-procedure framing record. Older (1990); narrative/clinical. |
| Myomectomy can both enhance and preserve fertility when fibroids distort the cavity or impair conception. | Tier 1 | `myomectomy-for-fertility-enhancement-and-preservation-recoch84wsdle6ucr` | 1623990 | Y | Supports the fertility-enhancement claim. Vintage 1992. |
| Submucosal and cavity-distorting fibroids impair conception (the indication for fertility-sparing removal). | Tier 1 (indication) | `epidemiology-of-uterine-fibroids-from-menarche-to-menopause-SYj4gLaA` | 26744813 | Y | Epidemiology/burden record; supports indication, not outcome. |

**Section note:** keep tight per the spec (tubal/fibroid/adhesion stay tight and
link out). The library fibroid records are vintage and narrative; the "when each
is appropriate" framing is well supported, the comparative-outcome claim is not
strongly powered. Do not assert myomectomy outperforms hysterectomy on any
metric other than the obvious one (uterus conserved for pregnancy). That single
contrast is uncontestable and needs no over-citation.

---

## 5. Tubal disease: microsurgical reconstruction vs default-to-IVF

| claim | tier it supports | /library/ slug | PMID | verified | note |
|---|---|---|---|---|---|
| Reconstructive tubal microsurgery (including reversal) is a legitimate restorative alternative to default IVF for selected tubal disease. | Tier 1 vs bypass | `reconstructive-tubal-microsurgery-and-assisted-reproductive-technology-recy0syhapupg3mrj` | 26773194 | Y | Fertil Steril 2016 review. The anchor for "reconstruction vs bypass." Frame as selection-dependent, not universally superior to IVF. |
| Proximal tubal blockage has identifiable pathophysiology and management pathways short of bypass. | Tier 1 (mechanism) | `pathophysiology-and-management-of-proximal-tubal-blockage-recjtyqpvyttoyym1` | 10231034 | Y | Supports "diagnose and treat the cause" tubal logic. |
| Salpingoscopic assessment distinguishes occlusive from non-occlusive tubal disease, informing whether reconstruction is viable. | Tier 1 (case selection) | `salpingoscopic-findings-in-women-with-occlusive-and-nonocclusive-salpingitis-ist-recrgl4yyuxbqviyo` | 8137967 | Y | Supports honest case-selection (not all tubes are reconstructable). Symmetric-rigor: names the limit of reconstruction. |

**Section note (symmetric rigor):** the honest tubal frame is conditional. For
distal occlusion with poor mucosa, IVF outperforms reconstruction; for proximal
blockage and selected disease, microsurgery is a real restorative option. The
salpingoscopy record (8137967) is the symmetry anchor that says reconstruction
is not always viable. Do not state tubal reconstruction beats IVF generically;
state it for selected, well-assessed disease.

---

## 6. Pelvic adhesions: prevention as technique

| claim | tier it supports | /library/ slug | PMID | verified | note |
|---|---|---|---|---|---|
| Postoperative adhesions are a major driver of female infertility; prevention is a surgical-quality variable, not an afterthought. | Tier 1 hallmark | `an-overview-of-postoperative-intraabdominal-adhesions-and-their-role-on-female-i-DlFFz7cN` | 36983263 | Y | 2023 narrative review; the modern burden/overview anchor. |
| Absorbable barrier (Interceed/TC7) reduces adhesion reformation in microsurgical fertility operations (multicenter RCT-level evidence). | Tier 1 hallmark | `the-efficacy-of-interceedtc7-for-prevention-of-reformation-of-postoperative-adhe-recbcccbfty1u6bvv` | (no PMID in library record) | N | Record present, multicenter study, but the LIBRARY record carries no PMID. PMID must be resolved before citing the figure. See gaps. |
| Expanded PTFE (Gore-Tex) outperforms oxidized regenerated cellulose (Interceed) at preventing adhesions. | Tier 1 technique nuance | `expanded-polytetrafluoroethylene-gore-tex-surgical-membrane-is-superior-to-oxidi-rec6shd7ppbhsjv9p` | (no PMID in library record) | N | Comparative barrier record; library record has no PMID. Resolve before citing. |
| Adhesion barrier choice matters: ORC can paradoxically cause de novo adhesion in injured peritoneum where ePTFE does not (mechanistic). | Tier 1 technique nuance | `murine-peritoneal-injury-and-de-novo-adhesion-formation-caused-by-oxidized-regen-recxymao3hwotiel4` | 1730318 | Y | Animal/mechanistic; supports "barrier choice is technique," not a clinical-outcome claim. Label as preclinical. |
| Contemporary adhesion-prevention principles (microsurgical handling + barriers) reduce reformation. | Tier 1 hallmark | `contemporary-adhesion-prevention-recoz8w7aaxsp162t` | 8299773 | Y | Principles review (1994). Supports the prevention-as-technique thesis. |
| Dextran-70 / instillates have a role in reducing adhesion in microtubal surgery (historical adjunct). | Tier 1 (historical) | `role-of-dextran-70-in-microtubal-surgery-recxsxyuyl6euacab` | 421920 | Y | Vintage 1979; historical adjunct, do not present as current standard. |

**Section note:** the two barrier RCT records (Interceed multicenter, ePTFE-vs-ORC)
are in the library but **carry no PMID in the record**. Their figures must not be
quoted until the PMID is resolved and curl-verified (gaps below). The mechanistic
ePTFE-vs-ORC superiority is preclinical (murine) plus a comparative clinical
study; keep the clinical claim modest.

---

## Gaps to ingest (no existing library record; best verified primary source)

Do NOT ingest now. Listed for a follow-up `/rrm-ingest` pass. All PMIDs below
curl-verified 2026-06-13 (title + journal + year confirmed).

| gap claim | best source | PMID | DOI | verified |
|---|---|---|---|---|
| Excision vs ablation for endometriosis-associated pain (head-to-head meta) | Pundir 2017, J Minim Invasive Gynecol | 28456617 | 10.1016/j.jmig.2017.04.008 | Y |
| Excision NOT superior for superficial disease (RCT; ablation favored transiently for 6-mo dyspareunia) | Riley 2019, J Minim Invasive Gynecol | 29609032 | 10.1016/j.jmig.2018.03.023 | Y |
| Excisional vs ablative surgery for ovarian endometrioma (Cochrane) | Kalra/Cochrane 2024 | 39588841 | 10.1002/14651858.CD004992.pub4 | Y |
| Cystectomy vs drainage+coagulation for endometrioma (the most-cited fertility RCT) | Beretta 1998, Fertil Steril | 9848316 | 10.1016/s0015-0282(98)00385-9 | Y |
| Cystectomy vs one-step CO2 laser vaporization, ovarian reserve (RCT) | 2018, Hum Reprod | 30299482 | (resolve at ingest) | Y |
| Stripping vs CO2 laser vaporization in BILATERAL endometriomas, reserve (RCT) | 2020, J Int Med Res | 32527167 | (resolve at ingest) | Y |
| Cystectomy lowers AMH (systematic review/meta - the reserve-cost anchor) | 2025, Gynecol Obstet Invest | 40179834 | (resolve at ingest) | Y |
| Comparative effect of different endometrioma surgeries on AMH (network meta) | 2026, Hum Reprod Open | 42164538 | (resolve at ingest) | Y |
| Interceed/TC7 reduces adhesion reformation in microsurgery (multicenter) - RESOLVE the PMID for the existing library record before quoting | Nordic Adhesion Prevention Study Group, Fertil Steril 1995 | (resolve via esearch at ingest) | n/a | N |
| ePTFE superior to ORC for adhesion prevention - RESOLVE the PMID for the existing library record | Fertil Steril 1995 | (resolve via esearch at ingest) | n/a | N |

Note on the two adhesion-barrier library records with no PMID: they are real,
already-held records (Interceed multicenter + ePTFE-vs-ORC). The work is to
resolve and back-fill their PMIDs, not re-ingest. Until resolved, cite them by
record but do not quote their numeric figures.

---

## Framing flags (intended framing outruns the evidence)

> **FF-1 and FF-2 are REJECTED (Brian, 2026-06-13).** They are artifacts of the
> art-evidence-analyst's ART/RCT-supremacy lens applied to NON-RRM-technique wedge
> resection and drilling-favorable adhesion data. RRM wedge resection is the
> restorative best approach; technique is the point. Do not act on FF-1/FF-2 when
> drafting. FF-3, FF-4, FF-5 below remain valid drafting refinements.

**FF-1 (PCOS adhesion inversion - highest priority).** The spec frames
drilling/electrocoagulation as the tier-3 "destructive contrast" whose adhesion
and reserve costs make wedge resection the restorative winner. The library's own
record PMID 8513965 states adhesion formation after electrocoagulation (19.3%) is
**lower** than after wedge resection, and PMID 7286253 documents wedge resection's
own 7.8% acquired-adhesion rate. Historically, drilling displaced wedge resection
*because* wedge caused more adhesions.
**Softened wording:** do not claim wedge resection has a lower adhesion rate than
drilling. Anchor the restorative case on durable hormonal/ovulatory restoration
(PMID 2124095, 1740195, 7286253) and on microsurgical technique + barriers
reducing wedge's historical adhesion cost, explicitly naming that cost. Use the
proposed PCOS wording in Section 3.

**FF-2 (PCOS preferred-over-letrozole on outcomes).** "Leads with surgery as the
preferred, root-cause approach" risks reading as a clinical-superiority claim. No
head-to-head RCT vs letrozole exists; the verified PCOS base confirms the
live-birth-superiority-of-RRM frame is unsupported.
**Softened wording:** frame as a *different question* (durable restoration of
spontaneous ovulation vs cycle-by-cycle pharmacologic induction), not "better
outcomes." State plainly that no trial shows more births than letrozole.

**FF-3 (cystectomy = reserve-sparing).** The reserve-sparing hallmark implies
cystectomy protects reserve. The in-library RCT (PMID 37370122) shows AMH falls
after cystectomy regardless of timing; cystectomy itself costs reserve.
**Softened wording:** reserve-sparing is a *technique and case-selection* claim
(avoid over-coagulation; consider ablative vaporization in bilateral/low-reserve
cases), not an inherent property of cystectomy. "Just take the ovary" is tier 3;
but stripping is not automatically tier 1 on reserve.

**FF-4 (excision superiority generalized).** Casting all ablation as tier 3 over-
reaches. For superficial peritoneal disease, RCT evidence shows
excision/ablation equivalence (PMID 29609032, 28456617).
**Softened wording:** excision's recurrence/histology advantage is established for
deep and recurrent disease; for superficial disease the two are broadly
equivalent. Bound the claim to deep/recurrent.

**FF-5 (evidence vintage transparency, PCOS + fibroids + tubal).** Several
sections rest on 1979-2003 records. Not a flaw per se (observational/older
evidence is still evidence; the field-default RCT-supremacy frame is contestable
and must be applied to both arms or neither). But the guide should *state the
vintage plainly* rather than imply contemporary trial backing.
**Softened wording:** name the evidence as older and observational where it is,
and present it as the accepted observational class, not as recent RCT data.

---

## Verification Gate summary

| # | Gate | Result |
|---|------|--------|
| V1 | Every PMID resolves + matches | PASS - 26 library PMIDs + 8 gap PMIDs curl-verified 2026-06-13 (title/year match). 2 library adhesion-barrier records carry NO PMID and are marked verified=N; their figures are quarantined until resolved. |
| V3 | Stats traced to source w/ provenance | PASS - figures (47.1% repeat surgery, 91.1% cyclicity, 73% cumulative, 47.8% crude, 7.8% adhesion, 19.3% electrocoag adhesion) quoted from the named library abstracts. |
| V4 | Counterweight present | PASS - recurrence after good surgery (32660473), cystectomy reserve cost (37370122), wedge's own adhesion cost (7286253), drilling's LOWER adhesion rate (8513965), superficial-disease equivalence (29609032) all stated. |
| V5 | Symmetric rigor | PASS - RRM/NaPro claims (Yeung excision, wedge resection, tubal microsurgery) held to the same scrutiny: repeat-surgery %, iatrogenic adhesion %, no-RCT-vs-letrozole, case-selection limits all named in the same breath as the favorable figure. |
| V6 | No ad hominem / COI motive | PASS - no researcher motive attributed; no COI claims made. |
| V8 | Bounded claim; honest framing | PASS - every contestable claim bounded ([BOUND] rows); PCOS frame explicitly capped to mechanism+durability, not outcome superiority. |
| V9 | No em/en dashes; house terms | PASS - ASCII hyphens only; "excision" used; no banned forms. |
| V11 | Contrary-evidence search disclosed | PASS - drilling-adhesion record (8513965) and superficial-equivalence RCTs (29609032, 28456617) actively surfaced as the strongest contrary evidence to the guide's own framing. |
| V12 | Framing named, not weaponized | N/A for source studies; framing flags FF-1..FF-5 engage the guide's OWN framing on evidentiary merits. |
