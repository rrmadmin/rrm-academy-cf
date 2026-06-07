-- RRM Academy Schema — D1 database: rrm-auth
-- Generated from the live database on 2026-05-27 (faithful mirror).
-- This file is a DOCUMENTATION mirror + fresh-provision source; incremental changes apply via migrations/.
-- Regenerate with: wrangler d1 execute rrm-auth --remote --json --command \
--   "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY tbl_name"

-- ============================================================
-- affiliate_clicks
-- ============================================================
CREATE TABLE IF NOT EXISTS affiliate_clicks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, course_id TEXT NOT NULL, click_date TEXT NOT NULL DEFAULT (date('now')), clicked_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, course_id, click_date));
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_user ON affiliate_clicks(user_id, course_id);

-- ============================================================
-- ai_search_docs
-- ============================================================
-- DROPPED 2026-05-27 (retrieval Plan 3): legacy AutoRAG/AI-Search manifest replaced by retrieval_docs below.
-- The live table was COLLATE NOCASE; the new manifest is case-sensitive (binary). See rrm-library-worker migrations.

-- ============================================================
-- retrieval_docs (SSOT for what is indexed in Vectorize + AutoRAG)
-- Canonical copy of rrm-library-worker/migrations/2026-05-27-retrieval-docs.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS retrieval_docs (
  key TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,            -- article|post|faq|glossary|pillar|course
  content_hash TEXT NOT NULL,
  in_vectorize INTEGER NOT NULL,        -- 1 for all types
  in_autorag INTEGER NOT NULL,          -- 1 for all types EXCEPT course (0)
  vectorize_id TEXT,
  vectorize_hash TEXT,
  autorag_item_id TEXT,
  autorag_hash TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  quarantined_at TEXT,
  last_failure TEXT,
  full_slug TEXT,
  indexed_at TEXT,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retrieval_docs_source_type ON retrieval_docs(source_type);
CREATE INDEX IF NOT EXISTS idx_retrieval_docs_last_seen ON retrieval_docs(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_retrieval_docs_quarantined ON retrieval_docs(quarantined_at);

-- ============================================================
-- retrieval_state (reconcile snapshot, one row id='singleton')
-- Canonical copy of rrm-library-worker/migrations/2026-05-28-retrieval-state.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS retrieval_state (
  id TEXT PRIMARY KEY,                  -- always 'singleton'
  last_reconcile_at TEXT,
  last_converged_at TEXT,
  drift_by_index TEXT,                  -- JSON
  live_counts_by_type TEXT,             -- JSON
  last_failure TEXT,
  updated_at TEXT
);
INSERT OR IGNORE INTO retrieval_state (id) VALUES ('singleton');

-- ============================================================
-- ask_saved
-- ============================================================
CREATE TABLE IF NOT EXISTS ask_saved (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  question       TEXT NOT NULL,
  answer         TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ask_saved_user_created
  ON ask_saved(user_id, created_at DESC);

-- ============================================================
-- cancellation_request
-- ============================================================
CREATE TABLE IF NOT EXISTS cancellation_request (   id                          TEXT PRIMARY KEY,   user_id                     TEXT NOT NULL,   email                       TEXT NOT NULL COLLATE NOCASE,   source                      TEXT NOT NULL CHECK(source IN ('wix','stripe')),   source_subscription_id      TEXT NOT NULL,   reason                      TEXT CHECK(reason IS NULL OR length(reason) <= 2000),   requested_at                INTEGER NOT NULL,   resolved_at                 INTEGER,   resolved_by                 TEXT,   last_admin_notification_at  INTEGER );
CREATE INDEX IF NOT EXISTS idx_cancellation_request_email   ON cancellation_request(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cancellation_request_outstanding_uniq   ON cancellation_request(source_subscription_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cancellation_request_unresolved   ON cancellation_request(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cancellation_request_user   ON cancellation_request(user_id);

-- ============================================================
-- community_comment
-- ============================================================
CREATE TABLE IF NOT EXISTS community_comment (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES community_post(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES user(id),
    parent_id TEXT REFERENCES community_comment(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_community_comment_author ON community_comment(author_id);
CREATE INDEX IF NOT EXISTS idx_community_comment_post ON community_comment(post_id);

-- ============================================================
-- community_flag
-- ============================================================
CREATE TABLE IF NOT EXISTS community_flag (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'pending', resolved_by TEXT REFERENCES user(id), resolved_at TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, target_type, target_id));
CREATE INDEX IF NOT EXISTS idx_community_flag_status ON community_flag(status);
CREATE INDEX IF NOT EXISTS idx_community_flag_target ON community_flag(target_type, target_id);

-- ============================================================
-- community_post
-- ============================================================
CREATE TABLE IF NOT EXISTS community_post (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES user(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    pinned INTEGER DEFAULT 0,
    event_date TEXT,
    event_link TEXT,
    resource_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
, channel TEXT NOT NULL DEFAULT 'stuc', content TEXT, slug TEXT, og_image_url TEXT);
CREATE INDEX IF NOT EXISTS idx_community_post_author ON community_post(author_id);
CREATE INDEX IF NOT EXISTS idx_community_post_channel ON community_post(channel, created_at);
CREATE INDEX IF NOT EXISTS idx_community_post_pinned ON community_post(pinned, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_post_slug ON community_post(slug COLLATE NOCASE) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_community_post_type ON community_post(type);

-- ============================================================
-- community_reaction
-- ============================================================
CREATE TABLE IF NOT EXISTS community_reaction (
    user_id TEXT NOT NULL REFERENCES user(id),
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, target_type, target_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_community_reaction_target ON community_reaction(target_type, target_id);

-- ============================================================
-- contact
-- ============================================================
CREATE TABLE IF NOT EXISTS contact (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    ig_handle TEXT,
    region TEXT,
    source TEXT,
    landing_page TEXT,
    first_seen_at TEXT,
    total_spent REAL DEFAULT 0,
    total_donated REAL DEFAULT 0,
    accepts_marketing INTEGER DEFAULT 0,
    notes TEXT,
    user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    stripe_customer_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_first_seen ON contact(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_contact_source ON contact(source);
CREATE INDEX IF NOT EXISTS idx_contact_user ON contact(user_id);

-- ============================================================
-- contact_address
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_address (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    line1 TEXT,
    line2 TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_address_contact ON contact_address(contact_id);

-- ============================================================
-- contact_change_log
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL,
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    related_contact_id TEXT,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_changelog_action ON contact_change_log(action);
CREATE INDEX IF NOT EXISTS idx_changelog_contact ON contact_change_log(contact_id);

-- ============================================================
-- contact_tag
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_tag (
    contact_id TEXT NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(contact_id, tag)
);

-- ============================================================
-- course
-- ============================================================
CREATE TABLE IF NOT EXISTS "course" (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
    title TEXT NOT NULL,
    description TEXT,
    short_description TEXT,
    image_url TEXT,
    image_alt TEXT,
    price_cents INTEGER NOT NULL DEFAULT 0,
    stripe_price_id TEXT,
    is_free INTEGER NOT NULL DEFAULT 0,
    has_certificate INTEGER NOT NULL DEFAULT 0,
    certificate_quiz_step_id TEXT,
    self_paced INTEGER NOT NULL DEFAULT 1,
    access_type TEXT NOT NULL DEFAULT 'public' CHECK(access_type IN ('public', 'private', 'members')),
    coming_soon INTEGER NOT NULL DEFAULT 0,
    participants INTEGER NOT NULL DEFAULT 0,
    instructors_json TEXT,
    includes_json TEXT,
    included_in_json TEXT,
    settings_json TEXT,
    seo_json TEXT,
    faqs_json TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_course_sort ON course(sort_order);
CREATE INDEX IF NOT EXISTS idx_course_status ON course(status);

-- ============================================================
-- course_section
-- ============================================================
CREATE TABLE IF NOT EXISTS course_section (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_course_section_course ON course_section(course_id, sort_order);

-- ============================================================
-- course_step
-- ============================================================
CREATE TABLE IF NOT EXISTS course_step (
    id TEXT PRIMARY KEY,
    section_id TEXT NOT NULL REFERENCES course_section(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('video', 'article', 'quiz')),
    stream_uid TEXT,
    duration_seconds INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    attachments_json TEXT,
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published', 'archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_course_step_course ON course_step(course_id);
CREATE INDEX IF NOT EXISTS idx_course_step_section ON course_step(section_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_course_step_status ON course_step(status);

-- step_rendition: multi-format lesson content. Added by migrations/028-step-rendition.sql.
CREATE TABLE IF NOT EXISTS step_rendition (
  step_id TEXT NOT NULL REFERENCES course_step(id),
  format TEXT NOT NULL CHECK (format IN ('reading','flashcards','quiz','audio')),
  content_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  source TEXT,
  word_count INTEGER,
  duration_seconds INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (step_id, format)
);

-- ============================================================
-- course_waitlist
-- ============================================================
CREATE TABLE IF NOT EXISTS course_waitlist (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  unsubscribed_at TEXT,
  UNIQUE(course_id, email)
);
CREATE INDEX IF NOT EXISTS idx_course_waitlist_course_created ON course_waitlist(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_waitlist_email ON course_waitlist(email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_course_waitlist_user ON course_waitlist(user_id);

-- ============================================================
-- email_log
-- ============================================================
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  subject TEXT,
  detail TEXT,
  send_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_log_cat_created ON email_log(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_email ON email_log(email COLLATE NOCASE, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_event ON email_log(event);
CREATE INDEX IF NOT EXISTS idx_email_log_source_created ON email_log(source, created_at DESC);

-- ============================================================
-- email_verification
-- ============================================================
CREATE TABLE IF NOT EXISTS email_verification (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification(user_id);

-- ============================================================
-- enrollment
-- ============================================================
CREATE TABLE IF NOT EXISTS enrollment (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL,
    enrolled_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    stripe_payment_intent TEXT,
    certificate_issued_at TEXT, revoked_at TEXT,
    UNIQUE(user_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollment_course ON enrollment(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_stripe_pi ON enrollment(stripe_payment_intent) WHERE stripe_payment_intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enrollment_user ON enrollment(user_id);

-- ============================================================
-- fact_vote_dispute
-- ============================================================
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

-- ============================================================
-- faq
-- ============================================================
CREATE TABLE IF NOT EXISTS faq (
    id TEXT PRIMARY KEY,
    faq_code TEXT,
    slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
    question TEXT NOT NULL,
    basic_answer TEXT,
    schema_answer TEXT,
    published_answer TEXT,
    category TEXT NOT NULL,
    seo_title TEXT,
    seo_description TEXT,
    sort_order INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_faq_category ON faq(category);
CREATE INDEX IF NOT EXISTS idx_faq_status ON faq(status);

-- ============================================================
-- faq_library_ref
-- ============================================================
CREATE TABLE IF NOT EXISTS faq_library_ref (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faq_id TEXT NOT NULL REFERENCES faq(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL,
    label TEXT,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(faq_id, article_id)
);
CREATE INDEX IF NOT EXISTS idx_faq_library_ref_faq ON faq_library_ref(faq_id);

-- ============================================================
-- faq_resource
-- ============================================================
CREATE TABLE IF NOT EXISTS faq_resource (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faq_id TEXT NOT NULL REFERENCES faq(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(faq_id, url)
);
CREATE INDEX IF NOT EXISTS idx_faq_resource_faq ON faq_resource(faq_id);

-- ============================================================
-- glossary_abbreviation
-- ============================================================
CREATE TABLE IF NOT EXISTS glossary_abbreviation (
    abbreviation TEXT PRIMARY KEY COLLATE NOCASE,
    full_term TEXT NOT NULL,
    term_slug TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_glossary_abbreviation_sort ON glossary_abbreviation(sort_order);

-- ============================================================
-- glossary_definition_source
-- ============================================================
CREATE TABLE IF NOT EXISTS glossary_definition_source (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term_id TEXT NOT NULL REFERENCES glossary_term(id),
        -- Foreign key is DECORATIVE in D1 (PRAGMA foreign_keys not honored).
        -- If a parent glossary_term is deleted, child rows here will orphan.
        -- Glossary delete handlers MUST explicitly:
        --   db.batch([
        --     db.prepare("DELETE FROM glossary_definition_source WHERE term_id = ?").bind(termId),
        --     db.prepare("DELETE FROM glossary_term WHERE id = ?").bind(termId),
        --   ])
        -- BEFORE deleting the parent. See functions/api/admin/glossary/[id].js (TBD).
    source_key TEXT NOT NULL COLLATE NOCASE,
        -- 'mesh', 'icd10', 'icd11', 'snomed', 'nci', 'medlineplus',
        -- 'wikipedia', 'cleveland_clinic', 'mayo', 'journal',
        -- 'hilgers_textbook', 'boyle_archive', 'rrm_library', 'wikidata'
        -- COLLATE NOCASE: defense-in-depth so uppercase variants ('BOYLE_ARCHIVE')
        -- can't slip past the render-layer PRIVATE_SOURCE_KEYS filter; UNIQUE
        -- constraint and lookups all normalize case. Render template ALSO lowercases
        -- before lookup (belt + suspenders).
    source_label TEXT NOT NULL,
        -- Human-friendly label shown on page (e.g. "PubMed MeSH",
        -- "Hilgers, NaProTECHNOLOGY Ch. 32")
    source_url TEXT,
        -- Canonical link. NULL for internal sources without a public URL.
    code TEXT,
        -- e.g. 'D004716' (MeSH), 'N71' (ICD-10), 'C26739' (NCI), '78623009' (SNOMED)
    definition_text TEXT NOT NULL,
        -- Verbatim quote (is_verbatim=1) or paraphrased excerpt (is_verbatim=0)
    is_verbatim INTEGER NOT NULL DEFAULT 1 CHECK(is_verbatim IN (0, 1)),
        -- 1 = verbatim quote (public-domain or licensed sources)
        -- 0 = paraphrased / excerpt under fair use
        -- IMPORTANT: app writers MUST coerce JS bool to 0/1 before bind() --
        -- string "true"/"false" or unquoted JS bool can fail the CHECK at insert.
        -- Pattern: stmt.bind(..., isVerbatim ? 1 : 0).
    attribution TEXT,
        -- Attribution line displayed under the quote
        -- (e.g. "Source: National Library of Medicine. Public domain.")
    sort_order INTEGER NOT NULL DEFAULT 999,
        -- Default 999 = "unranked / append at end". Documented sort_order slots:
        -- 10 RRMA / 20 MeSH / 30 ICD-10 / 35 ICD-11 / 40 SNOMED / 50 NCI / 60 MedlinePlus
        -- 70 Wikipedia / 80 Cleveland-Mayo-journal / 90 Hilgers / 95 Boyle / 99 Internal.
        -- Ingest scripts MUST set sort_order explicitly per the source_key convention.
    status TEXT NOT NULL DEFAULT 'published'
        CHECK(status IN ('draft', 'published', 'archived')),
    visibility TEXT NOT NULL DEFAULT 'public'
        CHECK(visibility IN ('public', 'internal_only')),
        -- 'public' (default): renders publicly. 'internal_only': RRM-private corpora
        -- like the IIRRM/Boyle archive -- never exposed to public DOM. Render layer
        -- enforces this filter; ingest scripts must explicitly opt in to internal_only.
    fetched_at TEXT,
        -- When source content was retrieved (ISO 8601). For provenance.
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    -- IMPORTANT: ingest scripts MUST use ON CONFLICT(term_id, source_key) DO UPDATE
    -- and explicitly OMIT human-curated columns (attribution, is_verbatim, sort_order,
    -- status, visibility) from the SET clause. Otherwise admin edits will be silently
    -- overwritten on the next sync. The previous schema used ON CONFLICT REPLACE
    -- which deletes the entire conflicting row -- removed 2026-05-10 after /arise
    -- finding #7 flagged the data-loss class.
    --
    -- Canonical upsert form for ingest scripts:
    --   INSERT INTO glossary_definition_source
    --     (term_id, source_key, source_label, source_url, code, definition_text, fetched_at)
    --   VALUES (?, ?, ?, ?, ?, ?, ?)
    --   ON CONFLICT(term_id, source_key) DO UPDATE SET
    --     source_label   = excluded.source_label,
    --     source_url     = excluded.source_url,
    --     code           = excluded.code,
    --     definition_text = excluded.definition_text,
    --     fetched_at     = excluded.fetched_at,
    --     updated_at     = datetime('now');
    --   -- Note: attribution, is_verbatim, sort_order, status NOT in SET -- admin-managed.
    UNIQUE(term_id, source_key)
);
CREATE INDEX IF NOT EXISTS idx_glossary_def_source_key
    ON glossary_definition_source(source_key);
CREATE INDEX IF NOT EXISTS idx_glossary_def_source_status
    ON glossary_definition_source(status);
CREATE INDEX IF NOT EXISTS idx_glossary_def_source_term
    ON glossary_definition_source(term_id);
CREATE INDEX IF NOT EXISTS idx_glossary_def_source_term_sort
    ON glossary_definition_source(term_id, sort_order);

-- ============================================================
-- glossary_reference
-- ============================================================
CREATE TABLE IF NOT EXISTS glossary_reference (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_num INTEGER UNIQUE NOT NULL,
    anchor_text TEXT NOT NULL,
    url TEXT NOT NULL,
    publisher TEXT,
    journal TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_glossary_reference_num ON glossary_reference(ref_num);

-- ============================================================
-- glossary_term
-- ============================================================
CREATE TABLE IF NOT EXISTS glossary_term (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL,
    part TEXT NOT NULL CHECK(part IN ('I','II','III','IV','V','VI','VII','VIII')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    body_html TEXT NOT NULL,
    abbreviation TEXT,
    pillar_link TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
, youtube_video_id TEXT, youtube_published_at TEXT, short_views INTEGER DEFAULT 0, short_view_count_updated_at TEXT, short_status TEXT DEFAULT 'pending', short_priority_score REAL, short_thumbnail_url TEXT, short_notes TEXT, word_count INTEGER);
CREATE INDEX IF NOT EXISTS idx_glossary_term_abbr ON glossary_term(abbreviation) WHERE abbreviation IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_glossary_term_part ON glossary_term(part);
CREATE INDEX IF NOT EXISTS idx_glossary_term_sort ON glossary_term(part, sort_order);
CREATE INDEX IF NOT EXISTS idx_glossary_term_status ON glossary_term(status);
CREATE INDEX IF NOT EXISTS idx_glossary_term_word_count ON glossary_term(word_count);

-- ============================================================
-- lesson_comment
-- ============================================================
CREATE TABLE IF NOT EXISTS lesson_comment (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        course_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        content TEXT NOT NULL,
        parent_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
CREATE INDEX IF NOT EXISTS idx_comment_parent ON lesson_comment(parent_id);
CREATE INDEX IF NOT EXISTS idx_comment_step ON lesson_comment(course_id, step_id);
CREATE INDEX IF NOT EXISTS idx_comment_user ON lesson_comment(user_id);

-- ============================================================
-- mcp_api_key
-- ============================================================
CREATE TABLE IF NOT EXISTS mcp_api_key (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_preview TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_api_key_hash_active ON mcp_api_key(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mcp_api_key_user ON mcp_api_key(user_id);

-- ============================================================
-- moderation_action
-- ============================================================
CREATE TABLE IF NOT EXISTS moderation_action (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('claim','edit','dispute','application','intake','dsar')),
  item_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved','rejected','deferred','request_info','escalated','auto_rejected')),
  reason TEXT,
  taken_at TEXT NOT NULL
);

-- ============================================================
-- newsletter_event
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_event (
    id INTEGER PRIMARY KEY,
    send_id TEXT NOT NULL REFERENCES newsletter_send(id) ON DELETE CASCADE,
    subscriber_id TEXT NOT NULL REFERENCES newsletter_subscriber(id) ON DELETE CASCADE,
    event TEXT NOT NULL,               -- sent | delivered | opened | clicked | bounced | complained
    detail TEXT,                       -- click URL, bounce reason, etc.
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_event_dedup
  ON newsletter_event(send_id, subscriber_id, event);
CREATE INDEX IF NOT EXISTS idx_nl_event_send ON newsletter_event(send_id);
CREATE INDEX IF NOT EXISTS idx_nl_event_subscriber ON newsletter_event(subscriber_id);

-- ============================================================
-- newsletter_send
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_send (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    text_body TEXT,
    segment_filter TEXT,              -- JSON: null = all, or ["stuc","donor"]
    status TEXT NOT NULL DEFAULT 'draft',  -- draft | sending | sent | failed
    total_recipients INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    open_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,
    bounce_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    sent_at TEXT,
    commentary_slug TEXT              -- if triggered by RSS, link to the post
);
CREATE INDEX IF NOT EXISTS idx_nl_send_status ON newsletter_send(status);

-- ============================================================
-- newsletter_subscriber
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_subscriber (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'active',  -- active | unsubscribed | bounced | complained
    segments TEXT DEFAULT '[]',             -- JSON array: ["donor","student","stuc"]
    source TEXT DEFAULT 'website',          -- website | import | admin
    subscribed_at TEXT DEFAULT (datetime('now')),
    unsubscribed_at TEXT,
    bounce_count INTEGER DEFAULT 0,
    last_sent_at TEXT,
    last_opened_at TEXT,
    last_clicked_at TEXT,
    user_id TEXT REFERENCES user(id) ON DELETE SET NULL  -- optional link to site user
);
CREATE INDEX IF NOT EXISTS idx_nl_subscriber_status ON newsletter_subscriber(status);
CREATE INDEX IF NOT EXISTS idx_nl_subscriber_user ON newsletter_subscriber(user_id);

-- ============================================================
-- outreach_send_log
-- ============================================================
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

-- ============================================================
-- outreach_suppression
-- ============================================================
CREATE TABLE IF NOT EXISTS outreach_suppression (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribe','bounce','complaint','dsar','manual')),
  suppressed_at TEXT NOT NULL
);

-- ============================================================
-- partners
-- ============================================================
CREATE TABLE IF NOT EXISTS "partners" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  site_url TEXT NOT NULL,
  country TEXT NOT NULL,
  city TEXT,
  provider_name TEXT NOT NULL,
  provider_credential TEXT NOT NULL,
  provider_directory_id TEXT,
  blurb TEXT,
  affirmations TEXT NOT NULL,
  contact_email TEXT NOT NULL COLLATE NOCASE,
  tier TEXT NOT NULL DEFAULT 'friend' CHECK (tier IN ('friend','partner','accredited')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','awaiting_payment','active','grace','expired','cancelled','rejected','revoked'
  )),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  revoked_at TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  badge_token TEXT,
  tier_revision INTEGER DEFAULT 0,
  active_since TEXT,
  expires_at TEXT,
  stripe_session_id TEXT,
  stripe_session_expires_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_badge_token ON partners(badge_token) WHERE badge_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partners_contact_email ON partners(contact_email);
CREATE INDEX IF NOT EXISTS idx_partners_slug ON partners(slug);
CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status);
CREATE INDEX IF NOT EXISTS idx_partners_tier ON partners(tier);

-- ============================================================
-- password_reset
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
, purpose TEXT NOT NULL DEFAULT 'reset');
CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_user_purpose ON password_reset (user_id, purpose);

-- ============================================================
-- pdf_token
-- ============================================================
CREATE TABLE IF NOT EXISTS pdf_token (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT    NOT NULL UNIQUE,
  email      TEXT    NOT NULL,
  guide_slug TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_pdf_token_email_slug ON pdf_token(email, guide_slug);
CREATE INDEX IF NOT EXISTS idx_pdf_token_token ON pdf_token(token);

-- ============================================================
-- posts
-- ============================================================
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT 'Naomi Whittaker, MD',
  content_pillar TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT NOT NULL DEFAULT '',
  publish_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft', 'review', 'published', 'archived')),
  word_count INTEGER NOT NULL DEFAULT 0,
  seo_keywords TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_publish_date ON posts(publish_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);

-- ============================================================
-- provider
-- ============================================================
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
CREATE INDEX IF NOT EXISTS idx_provider_entity_type ON provider(entity_type);
CREATE INDEX IF NOT EXISTS idx_provider_listability ON provider(listability);
CREATE INDEX IF NOT EXISTS idx_provider_parent_id ON provider(parent_id);
CREATE INDEX IF NOT EXISTS idx_provider_partner_id ON provider(partner_id);
CREATE INDEX IF NOT EXISTS idx_provider_slug ON provider(slug);

-- ============================================================
-- provider_claim
-- ============================================================
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

-- ============================================================
-- provider_edit_request
-- ============================================================
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

-- ============================================================
-- provider_fact_vote
-- ============================================================
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
CREATE INDEX IF NOT EXISTS idx_vote_disputed ON provider_fact_vote(disputed);
CREATE INDEX IF NOT EXISTS idx_vote_provider_id ON provider_fact_vote(provider_id);

-- ============================================================
-- provider_intake_quarantine
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_intake_quarantine (
  id TEXT PRIMARY KEY,
  source_record_json TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('empty_lastname','placeholder_name','couple_split_pending','other')),
  quarantined_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('merged','discarded','manually_split'))
);

-- ============================================================
-- provider_intake_request
-- ============================================================
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

-- ============================================================
-- quiz_response
-- ============================================================
CREATE TABLE IF NOT EXISTS quiz_response (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, course_id TEXT NOT NULL, step_id TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, question_id TEXT NOT NULL, answer_value TEXT NOT NULL, is_correct INTEGER, submitted_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_quiz_response_step ON quiz_response(step_id);
CREATE INDEX IF NOT EXISTS idx_quiz_response_user_step ON quiz_response(user_id, course_id, step_id);

-- ============================================================
-- saved_article
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_article (user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, article_slug TEXT NOT NULL, article_data TEXT NOT NULL, saved_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(user_id, article_slug));
CREATE INDEX IF NOT EXISTS idx_saved_article_user ON saved_article(user_id);

-- ============================================================
-- saved_page
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_page (
  user_id   TEXT NOT NULL,
  url       TEXT NOT NULL,
  title     TEXT NOT NULL,
  type      TEXT NOT NULL,
  saved_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, url)
);
CREATE INDEX IF NOT EXISTS idx_saved_page_user ON saved_page(user_id, saved_at DESC);

-- ============================================================
-- session
-- ============================================================
CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expires ON session(expires_at);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);

-- ============================================================
-- step_progress
-- ============================================================
CREATE TABLE IF NOT EXISTS step_progress (
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    score INTEGER,
    last_position_seconds INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, course_id, step_id)
);

-- ============================================================
-- system_config
-- ============================================================
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- user
-- ============================================================
CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    email_verified INTEGER DEFAULT 0,
    hashed_password TEXT NOT NULL,
    name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    stripe_customer_id TEXT,
    role TEXT DEFAULT 'member'
, first_name TEXT, last_name TEXT, google_id TEXT, wix_member_id TEXT, blocked INTEGER DEFAULT 0, newsletter_opt_in INTEGER DEFAULT 0, newsletter_opted_in_at TEXT, avatar_url TEXT, community_email_opt_out INTEGER DEFAULT 0, signup_source TEXT);
CREATE INDEX IF NOT EXISTS idx_user_email ON user(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_nocase ON user(email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_user_google_id ON user(google_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_google_id_unique ON user(google_id) WHERE google_id IS NOT NULL AND google_id != '';
CREATE INDEX IF NOT EXISTS idx_user_stripe_customer ON user(stripe_customer_id);

-- ============================================================
-- user_label
-- ============================================================
CREATE TABLE IF NOT EXISTS user_label (
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, label)
);
CREATE INDEX IF NOT EXISTS idx_user_label_label ON user_label(label);

-- ============================================================
-- webhook_event
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_event (event_id TEXT PRIMARY KEY, processed_at INTEGER NOT NULL DEFAULT (unixepoch()), completed_at INTEGER);

-- ============================================================
-- wix_payment
-- ============================================================
CREATE TABLE IF NOT EXISTS wix_payment (
  wix_order_id         TEXT PRIMARY KEY,
  wix_order_number     TEXT NOT NULL,
  wix_subscription_id  TEXT,
  user_id              TEXT,
  contact_id           TEXT NOT NULL,
  email                TEXT NOT NULL COLLATE NOCASE,
  amount_cents         INTEGER NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'USD',
  paid_at              TEXT NOT NULL,
  payment_status       TEXT NOT NULL,
  receipt_id           TEXT,
  receipt_number       TEXT,
  product_name         TEXT NOT NULL,
  product_id           TEXT NOT NULL,
  is_donation          INTEGER NOT NULL DEFAULT 0,
  cycle_number         INTEGER,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wix_pay_email   ON wix_payment(email);
CREATE INDEX IF NOT EXISTS idx_wix_pay_paid_at ON wix_payment(paid_at);
CREATE INDEX IF NOT EXISTS idx_wix_pay_sub     ON wix_payment(wix_subscription_id);
CREATE INDEX IF NOT EXISTS idx_wix_pay_user    ON wix_payment(user_id);

-- ============================================================
-- wix_subscription
-- ============================================================
CREATE TABLE IF NOT EXISTS wix_subscription (
  wix_subscription_id  TEXT PRIMARY KEY,
  user_id              TEXT,
  contact_id           TEXT NOT NULL,
  email                TEXT NOT NULL COLLATE NOCASE,
  first_name           TEXT,
  last_name            TEXT,
  tier                 TEXT NOT NULL,
  amount_cents         INTEGER NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'USD',
  frequency            TEXT NOT NULL DEFAULT 'MONTH',
  status               TEXT NOT NULL,
  started_at           TEXT NOT NULL,
  last_order_at        TEXT NOT NULL,
  next_expected_at     TEXT,
  cycle_count          INTEGER NOT NULL DEFAULT 0,
  auto_renewal         INTEGER NOT NULL DEFAULT 1,
  product_id           TEXT NOT NULL,
  product_source       TEXT NOT NULL,
  updated_at           TEXT NOT NULL
, migration_status TEXT DEFAULT 'pending', migration_email_sent_at TEXT, stripe_subscription_id TEXT, migration_notes TEXT, cancel_requested_at INTEGER, cancel_reason TEXT   CHECK(cancel_reason IS NULL OR length(cancel_reason) <= 2000), migration_handoff_started_at INTEGER, admin_notified_at INTEGER, last_admin_notification_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_wix_sub_email  ON wix_subscription(email);
CREATE INDEX IF NOT EXISTS idx_wix_sub_migration ON wix_subscription(migration_status);
CREATE INDEX IF NOT EXISTS idx_wix_sub_status ON wix_subscription(status);
CREATE INDEX IF NOT EXISTS idx_wix_sub_user   ON wix_subscription(user_id);

-- ============================================================
-- wix_webhook_event
-- ============================================================
CREATE TABLE IF NOT EXISTS wix_webhook_event (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  entity_id    TEXT,
  received_at  TEXT NOT NULL,
  processed    INTEGER NOT NULL DEFAULT 0,
  status_code  INTEGER,
  detail       TEXT
);
CREATE INDEX IF NOT EXISTS idx_wix_webhook_received ON wix_webhook_event(received_at);

-- ##########################################################
-- Migration bookkeeping (wrangler-managed; listed for completeness)
-- ##########################################################

-- ============================================================
-- d1_migrations
-- ============================================================
CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================
-- migrations
-- ============================================================
CREATE TABLE IF NOT EXISTS migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
);
