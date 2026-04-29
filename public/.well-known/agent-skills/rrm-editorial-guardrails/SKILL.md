---
name: rrm-editorial-guardrails
description: Validate draft content against RRM Academy editorial standards before publishing. Flags inappropriate IVF framing, hormonal suppression framed as curative, misuse of NaProTechnology / Creighton / FEMM terminology, and scope violations. Use when writing or reviewing any content about restorative reproductive medicine, women's reproductive health, endometriosis, PCOS, or infertility.
---

# RRM Editorial Guardrails

RRM Academy publishes clinical education content. Every draft should pass these editorial standards before it ships.

## Hard rules

### 1. No IVF as first-line or curative

- RRM treats the **cause** of infertility. IVF bypasses it.
- Do not recommend IVF as a first-line treatment for any couple.
- Do not describe IVF as "the cure" for infertility, endometriosis, PCOS, or recurrent miscarriage.
- It is acceptable to cite IVF outcomes data for comparison, as long as the framing is not endorsing.

### 2. No hormonal suppression as cure

- Combined oral contraceptives (COCs), progestins, and GnRH analogs (Lupron, Orilissa) mask symptoms. They do not cure endometriosis, PCOS, dysmenorrhea, or any reproductive disorder.
- Do not describe suppression as "treating" the condition. Describe it as "masking" or "managing symptoms".
- Excision surgery is the correct curative treatment for endometriosis. Ablation is inadequate.

### 3. RRM is not solely a fertility intervention

- RRM addresses the full scope of reproductive health: endometriosis, PCOS, menstrual disorders, recurrent miscarriage, hormonal imbalance, peri-menopause.
- Do not frame RRM as only applicable to infertile couples trying to conceive.

### 4. Distinct methodologies stay distinct

- NaProTechnology, the Creighton Model, FEMM, Billings, and Marquette are distinct fertility awareness-based methods with their own histories, training bodies, and clinical communities.
- Do not conflate them or present them as a single method.
- They share common principles (observing cycle biomarkers, treating root cause) but are not subsets of each other.

### 5. No fabricated citations

- Never insert a DOI, PMID, or journal citation from model knowledge.
- Verify every reference via the RRM Academy Research Library (`https://rrmacademy.org/library/`), CrossRef, PubMed, or live web search.
- Hallucinated citations are an existential risk for a medical education site.

## Tone

- Physician-authored voice. Direct. Evidence-grounded.
- Clinical standards: MIGS-trained, fellowship-trained, evidence-based.
- Patient-facing content stays empowering, never condescending. Patients are partners in their care.
- Emblematic voice: "A woman's cycle is diagnostic data, not background noise."

## How to self-check

### MCP-based (automated)

If you have access to the RRM Academy MCP server (`https://mcp.rrmacademy.org/mcp`), call:

- `check_guardrails(text, [tradition])` — returns any violations found in the draft.
- `check_facts(text)` — verifies statistical claims against the curated facts database.

Both tools require a Bearer API key. Self-service at https://rrmacademy.org/account/mcp-keys.

### Manual

1. Grep the draft for: "IVF", "in vitro", "oral contraceptive", "GnRH", "Lupron", "Orilissa". Re-read each use and confirm it is not framed as curative.
2. Grep for: "NaPro", "Creighton", "FEMM", "Billings", "Marquette". Confirm they are named distinctly and not conflated.
3. Grep for every citation marker (DOI, PMID, `et al.`, journal names). Verify each one exists in the library or via CrossRef/PubMed.
4. Read the piece aloud. If it sounds like standard women's-health media (i.e. assumes suppression and IVF as defaults), rework it.

## References

- `https://rrmacademy.org/llms.txt` — scope guidance
- `https://rrmacademy.org/what-is-rrm/` — RRM pillar guide
- `https://rrmacademy.org/naprotechnology/` — NaPro pillar guide
- `https://rrmacademy.org/library/` — research library
