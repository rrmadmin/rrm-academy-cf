-- P2 Wave 1: 14 mechanical + factual fixes from glossary review 2026-05-02
-- Source: docs/glossary-review-2026-05-02.md (Brian "tier 3" batch)
-- Generated: 2026-05-04
-- Apply: npx wrangler d1 execute rrm-auth --remote --file=scripts/glossary-p2-wave1.sql

-- ============================================================
-- W1.1-9: Add 9 missing abbreviation rows (Part II terms with
--         term-level abbreviation set but no glossary_abbreviation row)
-- ============================================================
INSERT OR IGNORE INTO glossary_abbreviation (abbreviation, full_term, term_slug, sort_order) VALUES
  ('BIP',   'Base Infertile Pattern',                    'base-infertile-pattern',                  0),
  ('ESP',   'Essential Sameness Pattern',                'essential-sameness-pattern-yellow-stamps', 0),
  ('FABMs', 'Fertility Awareness-Based Methods',         'fabms',                                    0),
  ('MCS',   'Mucus Cycle Score',                         'mucus-cycle-score',                        0),
  ('POC',   'Point of Change',                           'point-of-change',                          0),
  ('PMB',   'Premenstrual Bleeding',                     'premenstrual-bleeding',                    0),
  ('STM',   'Sympto-Thermal Method',                     'sympto-thermal-method',                    0),
  ('TEB',   'Tail-End Brown Bleeding',                   'tail-end-brown-bleeding',                  0),
  ('VDRS',  'Vaginal Discharge Recording System',        'vdrs',                                     0);

-- ============================================================
-- W1.10: Adhesion Prevention -- "over a decade" -> "over 23 years"
--        per Hilgers 2010 J Gynecol Surg primary source
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      'mean adhesion score reduction from 33.3 to 6.0 over a decade with systematic barrier use',
      'mean adhesion score reduction from 33.3 to 6.0 over 23 years with systematic barrier use'
    ),
    updated_at = datetime('now')
WHERE slug = 'adhesion-prevention';

-- ============================================================
-- W1.11: Prematurity Prevention -- 12.7% -> 12.0%
--        Hilgers's actual cited comparator (Pope Paul VI Institute / NaPro source)
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      'compared with the U.S. national rate of 12.7% at the time of publication',
      'compared with a 12.0% rate in the comparison group'
    ),
    updated_at = datetime('now')
WHERE slug = 'prematurity-prevention-program';

-- ============================================================
-- W1.12: Sperm DNA Fragmentation -- unify body abbreviation to DFI
--        (term name and abbreviation field already use DFI; body uses SDF inconsistently)
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      REPLACE(
        body_html,
        'High SDF is associated',
        'A high DFI is associated'
      ),
      'making SDF testing',
      'making DFI testing'
    ),
    updated_at = datetime('now')
WHERE slug = 'sperm-dna-fragmentation';

-- ============================================================
-- W1.13: Isthmocele Repair (Hysteroscopic) -- >5mm -> >=2.5-3mm
--        Per Vitale 2023 PMC10416161 / Tulandi & Cohen 2019 mainstream consensus
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      'with a residual myometrial wall thickness &gt;5mm who do not desire future pregnancy',
      'with a residual myometrial wall thickness of at least 2.5 to 3 mm who do not desire future pregnancy'
    ),
    updated_at = datetime('now')
WHERE slug = 'isthmocele-repair-hysteroscopic';

-- ============================================================
-- W1.14: Isthmocele Repair (Laparoscopic) -- <5mm -> <3mm
--        Pairs with W1.13; same Vitale 2023 / Tulandi & Cohen 2019 threshold
-- ============================================================
UPDATE glossary_term
SET body_html = REPLACE(
      body_html,
      'when residual myometrial thickness is &lt;5mm',
      'when residual myometrial thickness is less than 3 mm'
    ),
    updated_at = datetime('now')
WHERE slug = 'isthmocele-repair-laparoscopic';

-- ============================================================
-- Verification queries (run after COMMIT):
-- SELECT abbreviation, full_term, term_slug FROM glossary_abbreviation
--   WHERE abbreviation IN ('BIP','ESP','FABMs','MCS','POC','PMB','STM','TEB','VDRS')
--   ORDER BY abbreviation;
-- SELECT slug, substr(body_html, 1, 600) FROM glossary_term
--   WHERE slug IN ('adhesion-prevention','prematurity-prevention-program',
--                  'sperm-dna-fragmentation','isthmocele-repair-hysteroscopic',
--                  'isthmocele-repair-laparoscopic')
--   ORDER BY slug;
