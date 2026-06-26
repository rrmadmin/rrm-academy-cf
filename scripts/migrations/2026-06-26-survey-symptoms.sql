-- Endo-survey symptom store, migrated off Airtable to a dedicated D1 DB (rrm-survey-symptoms),
-- separate from the email/PII DB (rrm-survey) to preserve the pseudonymization split inside CF.
-- rec_id is the join key: survey_identities.airtable_record_id (in rrm-survey) == survey_symptoms.rec_id.
--   - migrated rows: rec_id = the Airtable Record ID (preserves the existing link)
--   - new rows:      rec_id = crypto.randomUUID() generated in submit.js
-- NO email / PII in this table by design.

CREATE TABLE IF NOT EXISTS survey_symptoms (
  rec_id          TEXT PRIMARY KEY,
  score_total     INTEGER NOT NULL,
  score_tier1     INTEGER NOT NULL,
  score_tier2     INTEGER NOT NULL,
  score_tier3     INTEGER NOT NULL,
  tier1_symptoms  TEXT NOT NULL DEFAULT '',
  tier2_symptoms  TEXT NOT NULL DEFAULT '',
  tier3_symptoms  TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'endo-survey-v1',
  user_origin     TEXT,
  viewport_width  INTEGER,
  device_type     TEXT,
  referrer        TEXT,
  submitted_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_survey_symptoms_submitted_at ON survey_symptoms(submitted_at);
CREATE INDEX IF NOT EXISTS idx_survey_symptoms_source ON survey_symptoms(source);
