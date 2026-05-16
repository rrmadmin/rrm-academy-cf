-- Migration 022e: add COLLATE NOCASE to provider.slug
-- Sibling tables (partners.slug, glossary_term.slug, faq.slug, course.slug) all use
-- COLLATE NOCASE; provider.slug was missed in 022. Future admin writes with mixed
-- case (Dr-Jane-Smith vs dr-jane-smith) would collide only via UNIQUE, not via
-- case-insensitive lookup -- inconsistent with the rest of the site.
--
-- Table-recreation pattern (D1 rejects raw BEGIN/COMMIT in --file= mode). Column
-- list copied verbatim from migrations/022-provider-directory.sql lines 12-52.

CREATE TABLE provider_new (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
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

INSERT INTO provider_new SELECT * FROM provider;

DROP TABLE provider;
ALTER TABLE provider_new RENAME TO provider;

-- Recreate the 5 indexes from 022
CREATE INDEX IF NOT EXISTS idx_provider_slug ON provider(slug);
CREATE INDEX IF NOT EXISTS idx_provider_listability ON provider(listability);
CREATE INDEX IF NOT EXISTS idx_provider_entity_type ON provider(entity_type);
CREATE INDEX IF NOT EXISTS idx_provider_parent_id ON provider(parent_id);
CREATE INDEX IF NOT EXISTS idx_provider_partner_id ON provider(partner_id);
