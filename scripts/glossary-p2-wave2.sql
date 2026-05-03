-- P2 Wave 2: 5 well-specified body edits + 1 new ref
-- Source: docs/glossary-review-2026-05-02.md (Brian "tier 3" batch)
-- Generated: 2026-05-04
-- Apply: npx wrangler d1 execute rrm-auth --remote --file=scripts/glossary-p2-wave2.sql

-- ============================================================
-- W2.1: Marquette Method -- correct FACTS organizational framing
-- (FACTS is a separate nonprofit, not the clinical-training arm of Marquette)
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      'Marquette is also used clinically through the FACTS (Fertility Appreciation Collaborative to Teach the Science) training program; see <a href="#marquette-protocol">Marquette Method Clinical Protocol</a> for the medical-management arm.',
      'Marquette user training is delivered through the Marquette University Institute for Natural Family Planning. The method is also taught to physicians through FACTS (Fertility Appreciation Collaborative to Teach the Science), a separate nonprofit covering multiple FABMs; see <a href="#marquette-protocol">Marquette Method Clinical Protocol</a> for the medical-management arm.'
    ),
    updated_at = datetime('now')
WHERE slug = 'marquette-method';

-- ============================================================
-- W2.2: Billings Ovulation Method -- add ref-74 (Billings JJ 1981) alongside ref-85 (Urrutia 2018)
-- (closes "missing_citation" issue; review issue evidence pre-dated P0/P1 ref-85 add)
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      '<sup><a href=''#ref-85''>85</a></sup>',
      '<sup><a href=''#ref-85''>85</a></sup><sup><a href=''#ref-74''>74</a></sup>'
    ),
    updated_at = datetime('now')
WHERE slug = 'billings-ovulation-method';

-- ============================================================
-- W2.3: New ref-86 -- Doyle 2022 JAMA RCT (ERA caveat anchor)
-- PMID 36094567, DOI 10.1001/jama.2022.16352
-- ============================================================
INSERT OR IGNORE INTO glossary_reference (ref_num, anchor_text, journal, publisher, url) VALUES
  (86,
   'Doyle N, Jahandideh S, Hill MJ, Widra EA, Levy M, Devine K. Effect of Timing by Endometrial Receptivity Testing vs Standard Timing of Frozen Embryo Transfer on Live Birth in Patients Undergoing In Vitro Fertilization: A Randomized Clinical Trial. JAMA. 2022;328(11):1100-1109.',
   'JAMA',
   'American Medical Association',
   'https://pubmed.ncbi.nlm.nih.gov/36094567/');

-- ============================================================
-- W2.4: ERA -- add Doyle 2022 RCT caveat + cite ref-86
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      'particularly in recurrent implantation failure patients.<sup><a href="#ref-23">23</a></sup><sup><a href="#ref-24">24</a></sup><sup><a href="#ref-25">25</a></sup></p>',
      'particularly in recurrent implantation failure patients.<sup><a href="#ref-23">23</a></sup><sup><a href="#ref-24">24</a></sup><sup><a href="#ref-25">25</a></sup> However, randomized controlled trial evidence is conflicting: the Doyle 2022 RCT (n=767, JAMA) found no live-birth improvement with ERA-guided transfer, and ESHRE 2023 and ASRM 2023 guidelines do not recommend routine ERA use outside research settings or exceptional RIF cases.<sup><a href="#ref-86">86</a></sup></p>'
    ),
    updated_at = datetime('now')
WHERE slug = 'era';

-- ============================================================
-- W2.5: FCP -- replace FertilityCare Centers of America-only framing
-- with AAFCP-accredited training + AAFCP-credentialed structure
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      'The FCP role is defined and credentialed through the FertilityCare Centers of America training program.',
      'FCPs are trained through AAFCP-accredited programs (such as those run by FertilityCare Centers of America and other accredited providers) and credentialed by the American Academy of FertilityCare Professionals (AAFCP).'
    ),
    updated_at = datetime('now')
WHERE slug = 'fcp';

-- ============================================================
-- W2.6: ART -- remove IUI from ART list + add CDC ARTSAA clarification
-- (CDC's official ART surveillance excludes IUI because only sperm is handled)
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      'This includes in vitro fertilization (IVF), intracytoplasmic sperm injection (ICSI), intrauterine insemination (IUI), donor egg and donor sperm cycles, embryo transfer, and gestational surrogacy. Insurance documents, fertility clinic literature, and public health data all use ART as the standard classification.',
      'This includes in vitro fertilization (IVF), intracytoplasmic sperm injection (ICSI), donor egg and donor sperm cycles, embryo transfer, and gestational surrogacy. CDC''s official ART surveillance under the Fertility Clinic Success Rate and Certification Act of 1992 (ARTSAA) excludes intrauterine insemination (IUI) because only sperm is handled outside the body; HFEA and ESHRE use broader definitions that may include IUI. Insurance documents, fertility clinic literature, and public health data all use ART as the standard classification.'
    ),
    updated_at = datetime('now')
WHERE slug = 'art';

-- ============================================================
-- W2.7: NFPMC -- contextualize legacy designation + clarify training routes
-- (NFPMC = pre-2019 designation; current credential is CrMSMC issued by AAFCP.
--  SPVI Saint John Paul the Great Fellowship is a complementary, distinct
--  one-year fellowship producing Senior Medical Consultants.)
-- Brian's audience uses NFPMC colloquially because Naomi holds it -- retain
-- term but contextualize per glossary review suggested fix.
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      '<p>A <strong>NaProTechnology Medical Consultant (NFPMC)</strong> is a physician (MD or DO) who has completed formal postgraduate training in NaProTechnology through an accredited program. Training routes include the fellowship at the Pope Paul VI Institute for the Study of Human Reproduction and the AAFCP Medical Consultant program. The credential is distinct from standard OBGYN or reproductive endocrinology training and requires specific coursework in Creighton Model charting interpretation, NaPro diagnostic protocols, and NaPro surgical technique.</p>',
      '<p>A <strong>NaProTechnology Medical Consultant (NFPMC)</strong> is a physician (MD or DO) who has completed formal postgraduate training in NaProTechnology. "NFPMC" is the legacy designation for physicians who completed the Creighton Model System (CrMS) Medical Consultant program prior to 2019. The American Academy of FertilityCare Professionals (AAFCP) now issues this credential as CrMSMC (Creighton Model System Medical Consultant); the two are functionally synonymous in patient-facing usage. A complementary credential is awarded through the Saint John Paul the Great Fellowship at the Pope Paul VI Institute for the Study of Human Reproduction, a one-year postgraduate fellowship that includes NaPro surgical training and produces Senior Medical Consultants. The credential is distinct from standard OBGYN or reproductive endocrinology training and requires specific coursework in Creighton Model charting interpretation, NaPro diagnostic protocols, and NaPro surgical technique.</p>'
    ),
    updated_at = datetime('now')
WHERE slug = 'nfpmc';

-- ============================================================
-- Verification queries (run after apply):
-- SELECT slug, substr(body_html, 1, 1500) FROM glossary_term
--   WHERE slug IN ('marquette-method','billings-ovulation-method','era','fcp','art','nfpmc')
--   ORDER BY slug;
-- SELECT ref_num, anchor_text FROM glossary_reference WHERE ref_num = 86;
