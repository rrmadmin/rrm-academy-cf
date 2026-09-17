-- Records the research-consent decision on the identity half of the endo-survey
-- pseudonymization split (D1 rrm-survey, binding SURVEY_DB).
--
-- WHY: functions/api/endo-quiz/request.js writes a survey_identities row for
-- EVERY submission but writes the research record (survey_symptoms, D1
-- rrm-survey-symptoms) only when researchConsent is explicitly true or 1
-- (consent made optional 2026-09-17, PR #175). With no consent column, a
-- consented address was distinguishable only by joining rec_id across two
-- databases: survey_identities.airtable_record_id == survey_symptoms.rec_id.
-- This column makes the split readable in the identity store itself.
--
-- DEFAULT 1 IS A BACKFILL, NOT A PREFERENCE: every row written before
-- 2026-09-17 came from a path that REQUIRED consent -- endo-survey-v1
-- (functions/api/survey/submit.js) and the pre-#173 endo-quiz, both of which
-- refused the submission without it. So 1 is the true historical value for all
-- existing rows, and the endo-quiz INSERT binds the column explicitly from
-- then on. 0/1 integer, never the strings 'true'/'false' (CLAUDE.md SQL rules).

ALTER TABLE survey_identities ADD COLUMN research_consent INTEGER NOT NULL DEFAULT 1;
