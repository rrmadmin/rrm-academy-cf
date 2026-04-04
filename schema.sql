-- RRM Academy Schema (Phases 6 + 8 + member migration)
-- Applied to D1 database: rrm-auth

CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    email_verified INTEGER DEFAULT 0,
    hashed_password TEXT NOT NULL,
    name TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    stripe_customer_id TEXT,
    role TEXT DEFAULT 'member',
    google_id TEXT,
    wix_member_id TEXT,
    blocked INTEGER DEFAULT 0,
    avatar_url TEXT,
    newsletter_opt_in INTEGER DEFAULT 0,
    newsletter_opted_in_at TEXT
);

CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verification (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);
CREATE INDEX IF NOT EXISTS idx_session_expires ON session(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_email ON user(email);
CREATE INDEX IF NOT EXISTS idx_user_google_id ON user(google_id);
CREATE INDEX IF NOT EXISTS idx_user_stripe_customer ON user(stripe_customer_id);

-- Labels system (informational metadata, not access control)

CREATE TABLE IF NOT EXISTS user_label (
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, label)
);

CREATE INDEX IF NOT EXISTS idx_user_label_label ON user_label(label);

-- Phase 8: Courses & Enrollment

CREATE TABLE IF NOT EXISTS enrollment (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL,
    enrolled_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    stripe_payment_intent TEXT,
    certificate_issued_at TEXT,
    revoked_at TEXT,
    UNIQUE(user_id, course_id)
);

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

CREATE INDEX IF NOT EXISTS idx_enrollment_user ON enrollment(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_course ON enrollment(course_id);

-- Quiz & questionnaire response history (one row per question per attempt)
CREATE TABLE IF NOT EXISTS quiz_response (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    question_id TEXT NOT NULL,
    answer_value TEXT NOT NULL,
    is_correct INTEGER,
    submitted_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quiz_response_user_step ON quiz_response(user_id, course_id, step_id);
CREATE INDEX IF NOT EXISTS idx_quiz_response_step ON quiz_response(step_id);

-- Phase 8: Lesson Comments

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

CREATE INDEX IF NOT EXISTS idx_comment_step ON lesson_comment(course_id, step_id);
CREATE INDEX IF NOT EXISTS idx_comment_user ON lesson_comment(user_id);
CREATE INDEX IF NOT EXISTS idx_comment_parent ON lesson_comment(parent_id);

-- Phase 8: Community (Save the Uterus Club)

CREATE TABLE IF NOT EXISTS community_post (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES user(id),
    type TEXT NOT NULL,
    content TEXT,
    pinned INTEGER DEFAULT 0,
    event_date TEXT,
    event_link TEXT,
    resource_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    channel TEXT NOT NULL DEFAULT 'stuc'
);

CREATE TABLE IF NOT EXISTS community_comment (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES community_post(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES user(id),
    parent_id TEXT REFERENCES community_comment(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS community_reaction (
    user_id TEXT NOT NULL REFERENCES user(id),
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, target_type, target_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_community_post_type ON community_post(type);
CREATE INDEX IF NOT EXISTS idx_community_post_pinned ON community_post(pinned, created_at);
CREATE INDEX IF NOT EXISTS idx_community_post_channel ON community_post(channel, created_at);
CREATE INDEX IF NOT EXISTS idx_community_comment_post ON community_comment(post_id);
CREATE INDEX IF NOT EXISTS idx_community_reaction_target ON community_reaction(target_type, target_id);

-- Webhook Event Deduplication (prevents duplicate processing on Stripe retries)

CREATE TABLE IF NOT EXISTS webhook_event (
    event_id TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Saved Articles (syncs localStorage for logged-in users)

CREATE TABLE IF NOT EXISTS saved_article (
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    article_slug TEXT NOT NULL,
    article_data TEXT NOT NULL,
    saved_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, article_slug)
);

CREATE INDEX IF NOT EXISTS idx_saved_article_user ON saved_article(user_id);

-- Community Flags (reporting/flagging)

CREATE TABLE IF NOT EXISTS community_flag (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id),
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_by TEXT REFERENCES user(id),
    resolved_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_community_flag_status ON community_flag(status);
CREATE INDEX IF NOT EXISTS idx_community_flag_target ON community_flag(target_type, target_id);

-- Newsletter System (SES-based)

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
-- Note: email column already has implicit unique index from UNIQUE constraint

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

CREATE TABLE IF NOT EXISTS newsletter_event (
    id INTEGER PRIMARY KEY,
    send_id TEXT NOT NULL REFERENCES newsletter_send(id) ON DELETE CASCADE,
    subscriber_id TEXT NOT NULL REFERENCES newsletter_subscriber(id) ON DELETE CASCADE,
    event TEXT NOT NULL,               -- sent | delivered | opened | clicked | bounced | complained
    detail TEXT,                       -- click URL, bounce reason, etc.
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_nl_event_send ON newsletter_event(send_id);
CREATE INDEX IF NOT EXISTS idx_nl_event_subscriber ON newsletter_event(subscriber_id);

-- Contact CRM (unified contact record across all historical sources)

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

CREATE INDEX IF NOT EXISTS idx_contact_user ON contact(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_source ON contact(source);
CREATE INDEX IF NOT EXISTS idx_contact_first_seen ON contact(first_seen_at);

CREATE TABLE IF NOT EXISTS contact_tag (
    contact_id TEXT NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(contact_id, tag)
);

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

-- PDF Token Gate (migration 008)

CREATE TABLE IF NOT EXISTS pdf_token (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    guide_slug TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_pdf_token_token ON pdf_token(token);
CREATE INDEX IF NOT EXISTS idx_pdf_token_email_slug ON pdf_token(email, guide_slug);

-- Practitioner Directory (migration 009)

CREATE TABLE IF NOT EXISTS practitioner (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    credentials TEXT,
    specialty TEXT,
    certification_code TEXT,
    certification_name TEXT,
    is_fellow INTEGER DEFAULT 0,
    is_collaborating INTEGER DEFAULT 0,
    city TEXT,
    state TEXT,
    country TEXT DEFAULT 'USA',
    phone TEXT,
    email TEXT,
    website TEXT,
    practice_name TEXT,
    source TEXT NOT NULL,
    source_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_practitioner_state ON practitioner(state);
CREATE INDEX IF NOT EXISTS idx_practitioner_country ON practitioner(country);
CREATE INDEX IF NOT EXISTS idx_practitioner_source ON practitioner(source);
CREATE INDEX IF NOT EXISTS idx_practitioner_certification ON practitioner(certification_code);

-- FAQ Content (Phase 1 of publish path D1 migration)

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

CREATE INDEX IF NOT EXISTS idx_faq_status ON faq(status);
CREATE INDEX IF NOT EXISTS idx_faq_category ON faq(category);

CREATE TABLE IF NOT EXISTS faq_library_ref (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faq_id TEXT NOT NULL REFERENCES faq(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL,
    label TEXT,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(faq_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_faq_library_ref_faq ON faq_library_ref(faq_id);

CREATE TABLE IF NOT EXISTS faq_resource (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faq_id TEXT NOT NULL REFERENCES faq(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(faq_id, url)
);

CREATE INDEX IF NOT EXISTS idx_faq_resource_faq ON faq_resource(faq_id);

-- System configuration (ecosystem map, future config)

CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);
