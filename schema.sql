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
    title TEXT NOT NULL,
    body TEXT,
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

-- Saved Articles (syncs localStorage for logged-in users)

CREATE TABLE IF NOT EXISTS saved_article (
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    article_slug TEXT NOT NULL,
    article_data TEXT NOT NULL,
    saved_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, article_slug)
);

CREATE INDEX IF NOT EXISTS idx_saved_article_user ON saved_article(user_id);
