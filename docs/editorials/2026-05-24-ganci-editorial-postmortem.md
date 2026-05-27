# Post-Mortem: RRM Editorial — Response to Ganci et al. 2026

**Subject:** `/editorials/` entry `edit-001-ganci-response`, responding to Ganci D, Steeper M, Polyakov A, Sunkara SK, Wilkinson J, Lensen S. "The effectiveness and safety of restorative reproductive medicine (RRM) compared to assisted reproductive technology or medically unassisted conception: a systematic review." *Fertility and Sterility*, April 2026. DOI 10.1016/j.fertnstert.2026.03.039, PMID 41966348.
**Status:** Drafted, held pre-publication. Localhost + Google Doc working copy in sync as of 2026-05-24.
**Purpose:** Process retrospective + adversarial pre-publication red-team in one document.

---

# PART 1 — PROCESS RETROSPECTIVE

## 1.1 What was built
A `/editorials/` section on rrmacademy.org (separate `editorials` D1 table, `buildEditorial` schema, detail/index pages), and the first entry: a scholarly reply to the Ganci 2026 systematic review. The reply documents the seven RRM outcome studies the review set aside, then dismantles three of its framing moves (rejecting the one comparison study; an asymmetric cost/commercialization complaint; a psychological-harm claim imputed from ART data). Registry/external-control benchmarking is anchored with 14 verified citations and a four-federal-agency framing (NIH, CDC, HHS/HRSA, FDA).

## 1.2 What went wrong

**1. Citation hallucination was pervasive and would have been catastrophic if trusted.** Three separate AI sources fabricated identifiers that looked correct:
- **Perplexity (pplx):** 13 of 13 prose PMIDs for the registry-benchmarking citations were wrong. Every one resolved to an unrelated paper. Root cause: pplx's prose body is model-generated; only its grounded `search_results` URLs are real. The script's own docstring warns this explicitly. The error was reading the wrong part of the output.
- **Google Gemini ("Substantiating Clinical Benchmarking Methodologies"):** 2 of 3 pivotal new PMIDs fabricated (Brineura/CLN2 and Hernán target-trial both pointed at unrelated asthma/vitamin-D papers), and a third (Schold) carried a mismatched title + DOI on a correct PMID.
- **Earlier session, the Ganci DOI itself:** a pplx-supplied DOI resolved to a rudimentary-horn case report; the correct DOI was found only by CrossRef bibliographic search.
- **My own error:** I bucketed Ju et al. (PMID 30096003) as an NCDB benchmarking exemplar. The paper actually benchmarks against ACS-NSQIP, a different registry. Real PMID, wrong claim-mapping.

**2. Prior-session governance failure.** A previous session published the editorial before go-live approval, then "retracted" it via `is_retracted=1` / 410, leaving a mess (library record recMS3yuqr8rPcWMRNx7) that had to be cleaned up (set to archived, not deleted). This is the incident behind the standing mockup-gate hard rule.

**3. Lede churn.** The opening paragraph went through ~5 rewrite cycles, including one wholesale Gianna rewrite that was rejected outright ("much much worse"). Net-positive outcome, but the cost was high; the lesson is that the lede is line-edited collaboratively, never handed off.

**4. Voice drift toward concession.** An early draft framed the RCT-supremacy assumption as "a fair question," which concedes the reviewers' core premise. Caught and reversed to an offensive posture.

## 1.3 What went right

- **Verify-before-trust caught 100% of the hallucinations before anything shipped.** Not one fabricated identifier reached the published draft. Every citation in refs 11-24 was resolved directly against PubMed eutils + CrossRef by title, then re-confirmed.
- **Triangulation worked.** Two independent LLM reports plus my own check converged on the same real defect (Ju = ACS-NSQIP), which raised confidence it was a true finding and not a fourth hallucination — then I confirmed it against the literal abstract anyway.
- **The mockup-gate held.** Despite extensive technical edits, nothing was pushed live without approval.
- **Government framing got stronger and stayed honest.** SEER (NIH), SRTR (HHS/HRSA), CDC surveillance, FDA acceptance all confirmed against official `.gov` sources; NCDB correctly kept out of the federal bucket (it is ACS + American Cancer Society).

## 1.4 Lessons to systematize

1. **No LLM prose identifier is ever trusted.** Not pplx, not Gemini, not me. PMIDs/DOIs are resolved only against PubMed eutils + CrossRef by title/author, and each is re-resolved to confirm it returns the claimed paper. This is now a hard rule for editorial citations.
2. **Topic-driven search beats author-name trust.** Searching PubMed for the real exemplar of a practice ("single-institution series vs SEER") finds real papers; trusting an LLM's named author/title chases possibly-invented entities.
3. **Verify the claim-mapping, not just the identifier.** The Ju error had a correct PMID but the wrong comparator. A citation proof gate must confirm the paper supports the *specific* claim (which registry, which design), not merely that it exists.
4. **A reusable citation proof gate for editorials.** Before any editorial goes live: batch-resolve every PMID, assert title match, assert claim/bucket match, flag every unsourced quantitative claim. Candidate to fold into the existing G-IDENTITY / arise pre-commit chain.

---

# PART 2 — ARTICLE RED-TEAM

## 2.0 Overall assessment
The editorial is strong, well-sourced where it is sourced, and rhetorically disciplined. Its central move — that the review's verdict was determined by its inclusion criteria, not its evidence — is defensible **if and only if** the review actually concluded "no evidence of effectiveness/safety" rather than the softer "insufficient controlled evidence." That single question is the highest-leverage item below. The biggest concrete liabilities are the **unsourced IVF claims**, which are also the sharpest lines in the piece.

## 2.1 Strengths
- The three-frame structure is clean and each frame lands a real asymmetry.
- The registry/external-control defense is now over-built with verified, federal-agency-anchored citations. Hard to attack on that axis.
- The psychological-harm frame (Boivin 2011 is an ART meta-analysis, not RRM) is airtight: verified citation, accurate characterization.
- The voice is offensive without being shrill; the review is the object under scrutiny throughout.

## 2.2 Vulnerabilities — how a hostile ASRM-aligned reviewer attacks, ranked

**V1 (CRITICAL) — Does the review actually conclude "no evidence," or "insufficient controlled evidence"?**
The editorial's thesis sentence ("settled the question in its inclusion criteria, not in the evidence" / "concluded that no study establishes RRM's effectiveness or safety") is the whole argument. If the review's actual conclusion is hedged ("insufficient high-quality controlled evidence to determine"), a reviewer will say we attacked a strawman and that excluding uncontrolled studies from synthesis is routine methodology, not a rigged verdict. **Action:** pull the review's verbatim conclusion (the paper is ingested as recvRqG1WuoTvk8t9RaC) and make our characterization track its exact wording. This is the one finding that can sink the piece.

**V2 (CRITICAL) — The IVF-no-RCT claims are unsourced and are the sharpest lines in the lede.**
"No randomized trial has shown IVF improves live birth over no treatment for its main indications, and none has tested its long-term safety." This is rhetorically central and currently carries no citation. It is also the easiest "gotcha": a critic will point to the many IVF RCTs (protocols, ICSI, transfer number) and accuse us of misleading. The claim is defensible **only** in its narrow form (no RCT of IVF vs no-treatment/expectant management for core indications; no long-term offspring-safety RCT) and must be (a) stated that precisely and (b) sourced to review-level literature. **Action:** source before go-live or soften. Do not publish this sentence uncited.

**V3 (HIGH) — IVF cost figures are unsourced.**
"~USD 23,000/cycle, often exceeds USD 30,000," "tens of billions of dollars a year." All uncited. Frame 2's whole force depends on these numbers being right. **Action:** source to a defensible 2025-2026 figure (e.g., ASRM/industry market reports, peer-reviewed cost analyses) or hedge the magnitude.

**V4 (HIGH) — The seven RRM studies' statistics.**
Every percentage (live birth rates, prematurity 4.0% vs 11.8%, multiple-pregnancy 6.5% vs 14.4%, GBP 205,672 savings, etc.) is a falsifiable factual claim. If any single number is off versus the source paper, it becomes ammunition to discredit the whole piece. **Action:** spot-verify each stat against its library record / source PDF before go-live. These are refs 2-8.

**V5 (MEDIUM) — The registry analogy is methodological, not infrastructural.**
Both external reports flagged it: SEER/SRTR are audited federal registries; reproductive registries (SART/HFEA) are less standardized, and RRM single-center cohorts are not risk-adjusted against them the way oncology/transplant series are. A sophisticated critic argues the analogy proves the *method* is accepted but not that RRM has equivalent registry infrastructure. The current text is already careful ("well established... where a randomized trial is not feasible") but does not concede the infrastructure gap. **Action:** consider a one-clause acknowledgment to pre-empt; or leave as-is and rely on the FDA-acceptance framing, which is about method legitimacy.

**V6 (MEDIUM) — ICH E10's own caveat cuts both ways.**
ICH E10 (ref 22) calls external controls usable "only in unusual circumstances." Citing it as support invites the rebuttal that E10 *restricts* external controls. **Action:** do not over-lean on E10; the FDA real-world-data acceptance papers (refs 23, 24) and the Brineura precedent are stronger, less double-edged anchors.

**V7 (MEDIUM) — Boyle 2025's confounders.**
The editorial concedes the review's points (population heterogeneity, denominators, time at risk) are "real, and worth weighing," then says the fix is to quantify, not exclude. A critic says we never quantify them either. **Action:** acceptable as a rhetorical stance, but the body could note that Boyle 2025 itself addresses the limitations, if it does.

**V8 (LOW-MEDIUM) — The conflict-of-interest line risks reading as ad hominem.**
"Two of the six authors hold active ART clinical roles." Factual and disclosed, but a critic frames it as poisoning the well. **Action:** keep strictly factual (it already cites their COI statement); do not editorialize on motive.

**V9 (LOW) — Cost-asymmetry frame can be called whataboutism.**
Frame 2's point is that the review applied a commercialization concern to RRM but not to IVF. A critic says cost is irrelevant to efficacy. **Action:** the asymmetry point is legitimate (selective application of a stated concern); keep it framed as selective application, not as a cost argument per se.

## 2.3 Citation integrity status (current)
- **Verified this cycle (refs 11-24):** all 14 registry/external-control citations resolve to their claimed papers (PubMed/CrossRef).
- **Verified (existing):** Ganci ref 1 (41966348, DOI confirmed); Boivin ref 10 (21345903, BMJ 2011 d223); Peipert reply-exchange exists in F&S (PMIDs 41475701/41475699).
- **Not yet verified / unsourced:** the IVF cost figures (V3); the IVF-RCT-absence claims (V2); the seven RRM-study statistics (V4); the original Peipert 2025 editorial's exact citation (ref 9 page numbers).
- **Available, verified, not yet wired in:** Brineura/CLN2 (Schulz, NEJM 2018, PMID 29688815) as a concrete FDA external-control approval; Hernán & Robins target-trial emulation (AJE 2016, PMID 26994063).

## 2.4 Non-content go-live items
- `--remote` D1 migration for the `editorials` table (revert = `DROP TABLE editorials`).
- Push `claude/rrm-responds-impl`; library rebuild to drop archived recMS3yuqr8rPcWMRNx7; 301 the old library URL to `/editorials/`; cross-citation edge from the Ganci library record to the editorial.
- Phil Boyle co-byline + Naomi review. Note the hard rule: rrmacademy.org must not route patients to Naomi; byline credentials only.
- Schema: ScholarlyArticle + citation (ClaimReview deprecated, correctly avoided).

## 2.5 Pre-go-live checklist (must-fix before publish)
1. **V1:** reconcile the thesis wording with the review's verbatim conclusion.
2. **V2:** source or precisely narrow the IVF-no-RCT claims.
3. **V3:** source the IVF cost figures.
4. **V4:** spot-verify all seven studies' statistics against sources.
5. Decide on Brineura/Hernán additions (recommended: add Brineura as the concrete FDA example).
6. Phil + Naomi sign-off; finalize byline.
7. Then, and only then, the technical deploy choreography.

---

## Bottom line
Process: the work was saved by a discipline (verify-before-trust) that should now be a codified gate, because three separate AI tools produced confident, fabricated citations. Article: the piece is publishable-quality in structure and voice, but it must not go live until V1 (thesis-vs-actual-conclusion) and V2-V4 (the unsourced/­unverified factual claims) are closed. The strongest lines in the editorial are currently the least sourced.
