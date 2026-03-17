-- Unified email event log
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

CREATE INDEX IF NOT EXISTS idx_email_log_email ON email_log(email COLLATE NOCASE, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_cat_created ON email_log(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_source_created ON email_log(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_event ON email_log(event);

-- Fix newsletter open/click race conditions (dedup constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_event_dedup
  ON newsletter_event(send_id, subscriber_id, event);
