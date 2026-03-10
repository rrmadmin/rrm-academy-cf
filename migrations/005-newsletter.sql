-- migrations/005-newsletter.sql
-- Newsletter system tables (SES-based, replaces Buttondown)

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
