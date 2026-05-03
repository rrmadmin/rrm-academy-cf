-- P2 Wave 3: 3 framing/tone fixes (ARPR + RHRI + MTHFR)
-- Source: docs/glossary-review-2026-05-02.md (Brian "tier 3" batch)
-- Generated: 2026-05-04
-- Apply: npx wrangler d1 execute rrm-auth --remote --file=scripts/glossary-p2-wave3.sql

-- ============================================================
-- W3.1: ARPR -- refine framing of foundational dataset attribution
-- (clarify the 1,876-couple / 17,130.5-couple-month dataset originated in
--  Hilgers & Stanford 1998 J Reprod Med as an avoiding-pregnancy use-
--  effectiveness cohort, with ARPR being a methodological adaptation
--  applied to the same cohort/framework in later achieving-conception
--  analyses.)
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      'calculated using Hilgers'' life-table adaptation of the Tietze-Lewit framework.</strong> The foundational dataset includes a five-study composite of 1,876 couples across 17,130.5 couple-months.<sup><a href="#ref-78">78</a></sup><sup><a href="#ref-83">83</a></sup></p>',
      'calculated using Hilgers'' life-table adaptation of the Tietze-Lewit framework.</strong> The foundational dataset, a five-study composite of 1,876 couples across 17,130.5 couple-months, originated in Hilgers and Stanford''s 1998 J Reprod Med use-effectiveness analysis of CrMS for avoiding pregnancy.<sup><a href="#ref-78">78</a></sup> ARPR is a methodological adaptation that applies the same life-table framework to the achieving-pregnancy direction in subsequent Hilgers analyses.<sup><a href="#ref-83">83</a></sup></p>'
    ),
    updated_at = datetime('now')
WHERE slug = 'achieving-related-pregnancy-rate';

-- ============================================================
-- W3.2: RHRI -- soften "has published peer-reviewed research linking"
-- (specific RHRI/Vigil pubs making this exact link not located; PCOS-CVD/T2D
--  linkage is well established in non-RHRI literature)
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      'RHRI has published peer-reviewed research linking chronic anovulation to long-term health risks including cardiovascular disease and Type 2 diabetes',
      'RHRI has championed clinical attention to chronic anovulation as a marker for long-term health risks including cardiovascular disease and Type 2 diabetes'
    ),
    updated_at = datetime('now')
WHERE slug = 'rhri';

-- ============================================================
-- W3.3: MTHFR -- add ACMG/ACOG balance sentence
-- (RRM framing kept; one sentence acknowledging mainstream position
--  satisfies consensus_conflict transparency)
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      'RRM protocols specify L-methylfolate preconceptionally for women with known MTHFR variants, recurrent miscarriage, or elevated homocysteine. That means skipping the conversion step entirely and delivering the active form directly.',
      'RRM protocols specify L-methylfolate preconceptionally for women with known MTHFR variants, recurrent miscarriage, or elevated homocysteine. That means skipping the conversion step entirely and delivering the active form directly. ACMG and ACOG do not recommend routine MTHFR testing in mainstream practice; RRM follows a more proactive testing posture when homocysteine is elevated or recurrent pregnancy loss is present.'
    ),
    updated_at = datetime('now')
WHERE slug = 'methylated-folate';

-- ============================================================
-- Verification queries:
-- SELECT slug, substr(body_html, 1, 1500) FROM glossary_term
--   WHERE slug IN ('achieving-related-pregnancy-rate','rhri','methylated-folate')
--   ORDER BY slug;
