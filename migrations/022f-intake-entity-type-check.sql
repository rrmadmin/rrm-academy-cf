-- Migration 022f: add CHECK constraint to provider_intake_request.entity_type
-- Migration 022 put a 9-value CHECK on provider.entity_type but
-- provider_intake_request.entity_type at line 172 was bare TEXT NOT NULL. An
-- intake row can carry garbage entity_type; when an admin promotes it to a
-- provider row the INSERT crashes on the provider CHECK with a generic
-- constraint-violation message, hard to debug.
--
-- Table-recreation pattern. D1 rejects raw BEGIN/COMMIT in --file= mode.
-- Column list copied verbatim from migrations/022-provider-directory.sql lines 161-184.

CREATE TABLE provider_intake_request_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  submitter_email TEXT NOT NULL,
  name TEXT NOT NULL,
  credentials TEXT,
  primary_practice TEXT,
  website TEXT,
  npi TEXT,
  state TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'individual_person','solo_practice','group_practice','medical_center',
    'hospital_or_health_system','university_clinic','training_institution',
    'fertilitycare_center','educational_org'
  )),
  languages_json TEXT,
  methods_json TEXT,
  description TEXT CHECK (length(description) <= 1000),
  status TEXT NOT NULL CHECK (status IN ('pending','in_review','published','rejected','archived')),
  resulting_provider_id TEXT,
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  reject_reason TEXT,
  notes TEXT,
  UNIQUE (user_id, name, website)
);

INSERT INTO provider_intake_request_new SELECT * FROM provider_intake_request;

DROP TABLE provider_intake_request;
ALTER TABLE provider_intake_request_new RENAME TO provider_intake_request;

-- Recreate the 2 indexes from 022
CREATE INDEX IF NOT EXISTS idx_intake_status ON provider_intake_request(status);
CREATE INDEX IF NOT EXISTS idx_intake_user_id ON provider_intake_request(user_id);
