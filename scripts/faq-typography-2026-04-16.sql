-- FAQ question typography fix, 2026-04-16.
-- F12: replace curly apostrophes (U+2019, U+2018) with straight apostrophe (U+0027).
-- F06: replace non-breaking hyphen (U+2011) with regular hyphen (U+002D).
-- `updated_at` is deliberately NOT set -- typography cleanup is not a content revision.
-- D1 wraps multi-statement files in a single transaction automatically; no BEGIN/COMMIT.

UPDATE faq
   SET question = REPLACE(REPLACE(question, CHAR(8217), CHAR(39)), CHAR(8216), CHAR(39))
 WHERE faq_code = 'F12';

UPDATE faq
   SET question = REPLACE(question, CHAR(8209), CHAR(45))
 WHERE faq_code = 'F06';
