-- Migration 022: Provider Directory schema
-- PRD v1.3 §10, §11 Phase 0
-- Idempotency: CREATE TABLE IF NOT EXISTS; ALTER ADD COLUMN guarded by
--              try/catch at apply time (SQLite has no IF NOT EXISTS for ADD COLUMN);
--              CHECK rebuild only runs if existing CHECK doesn't match expected;
--              DROP TABLE practitioner runs LAST (most destructive step).
-- Recovery on partial failure: restore via migrations/backups/practitioner-pre-drop-*.sql
--                              and re-run this file.
-- Note: no BEGIN/COMMIT wrapper -- wrangler d1 execute --file rejects raw transactions.

-- 1. provider (core record)
CREATE TABLE IF NOT EXISTS provider (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'individual_person','solo_practice','group_practice','medical_center',
    'hospital_or_health_system','university_clinic','training_institution',
    'fertilitycare_center','educational_org'
  )),
  parent_id TEXT,
  name TEXT NOT NULL,
  credentials TEXT,
  bio TEXT,
  photo_url TEXT,
  primary_email TEXT,
  primary_phone TEXT,
  website_url TEXT,
  address_json TEXT,
  latitude REAL,
  longitude REAL,
  npi TEXT,
  methods_json TEXT,
  languages_json TEXT,
  telehealth TEXT DEFAULT 'unknown' CHECK (telehealth IN ('yes','no','unknown','likely_capable')),
  telehealth_states_licensed_json TEXT,
  telehealth_states_attested_json TEXT,
  telehealth_states_negative_json TEXT,
  accepting_new_patients TEXT DEFAULT 'unknown' CHECK (accepting_new_patients IN ('yes','no','unknown')),
  listability TEXT NOT NULL CHECK (listability IN ('full','basic','minimal','unlisted')),
  relevance TEXT NOT NULL,
  verification_tier TEXT,
  badges_json TEXT,
  partner_id TEXT,
  claimed_by_user_id TEXT,
  claimed_at TEXT,
  verified_contact INTEGER DEFAULT 0,
  do_not_contact INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_verified_by_provider_at TEXT,
  source_records_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_provider_slug ON provider(slug);
CREATE INDEX IF NOT EXISTS idx_provider_listability ON provider(listability);
CREATE INDEX IF NOT EXISTS idx_provider_entity_type ON provider(entity_type);
CREATE INDEX IF NOT EXISTS idx_provider_parent_id ON provider(parent_id);
CREATE INDEX IF NOT EXISTS idx_provider_partner_id ON provider(partner_id);

-- 2. provider_claim
CREATE TABLE IF NOT EXISTS provider_claim (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  email_domain_match INTEGER DEFAULT 0,
  npi_match INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending','email_verified','approved','rejected')),
  submitted_at TEXT NOT NULL,
  email_verified_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  reject_reason TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_claim_provider_id ON provider_claim(provider_id);
CREATE INDEX IF NOT EXISTS idx_claim_status ON provider_claim(status);

-- 3. provider_fact_vote
CREATE TABLE IF NOT EXISTS provider_fact_vote (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  question_code TEXT NOT NULL CHECK (question_code IN (
    'telehealth','telehealth_states','methods_practiced','languages',
    'accepting_new_patients','rrm_aligned'
  )),
  value TEXT NOT NULL,
  voted_at TEXT NOT NULL,
  disputed INTEGER DEFAULT 0,
  UNIQUE(provider_id, user_id, question_code)
);
CREATE INDEX IF NOT EXISTS idx_vote_provider_id ON provider_fact_vote(provider_id);
CREATE INDEX IF NOT EXISTS idx_vote_disputed ON provider_fact_vote(disputed);

-- 4. fact_vote_dispute
CREATE TABLE IF NOT EXISTS fact_vote_dispute (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  question_code TEXT NOT NULL,
  disputed_by_user_id TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','upheld','rejected')),
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT
);

-- 5. outreach_send_log
CREATE TABLE IF NOT EXISTS outreach_send_log (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  email TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('bulk','1to1')),
  ses_message_id TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  opened_at TEXT,
  clicked_at TEXT,
  bounced_at TEXT,
  complained_at TEXT,
  unsubscribed_at TEXT,
  attempt_count INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  UNIQUE (campaign_id, provider_id)
);

-- 6. outreach_suppression
CREATE TABLE IF NOT EXISTS outreach_suppression (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribe','bounce','complaint','dsar','manual')),
  suppressed_at TEXT NOT NULL
);

-- 7. provider_edit_request
CREATE TABLE IF NOT EXISTS provider_edit_request (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  submitted_by_user_id TEXT,
  changes_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  applied_at TEXT,
  notes TEXT
);

-- 8. moderation_action
CREATE TABLE IF NOT EXISTS moderation_action (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('claim','edit','dispute','application','intake','dsar')),
  item_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved','rejected','deferred','request_info','escalated','auto_rejected')),
  reason TEXT,
  taken_at TEXT NOT NULL
);

-- 9. provider_intake_request
CREATE TABLE IF NOT EXISTS provider_intake_request (
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
  entity_type TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_intake_status ON provider_intake_request(status);
CREATE INDEX IF NOT EXISTS idx_intake_user_id ON provider_intake_request(user_id);

-- 10. provider_intake_quarantine
CREATE TABLE IF NOT EXISTS provider_intake_quarantine (
  id TEXT PRIMARY KEY,
  source_record_json TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('empty_lastname','placeholder_name','couple_split_pending','other')),
  quarantined_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('merged','discarded','manually_split'))
);
