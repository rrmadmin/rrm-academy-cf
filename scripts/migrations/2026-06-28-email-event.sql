-- Email Observability: SES event store + correlation key
-- DB: rrm-auth   | Spec: docs/superpowers/specs/2026-06-27-email-observability-system-design.md
-- STATUS: DRAFT / HELD. Do NOT apply until Brian gives deploy go.
-- Apply (remote): wrangler d1 execute rrm-auth --remote --file scripts/migrations/2026-06-28-email-event.sql

-- 1. Correlation key on the existing send-audit log so SES events can join back to a send.
--    email_log today stores only our own send_id; SES events key on the SES MessageId.
ALTER TABLE email_log ADD COLUMN ses_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_email_log_ses_msgid ON email_log(ses_message_id);

-- 2. Unified SES event store. One row per SES event (delivery, bounce, complaint, open, click, ...).
--    Powers the dashboard metrics AND the per-event / per-recipient drill-downs (spec 6a).
CREATE TABLE IF NOT EXISTS email_event (
  id              TEXT PRIMARY KEY,            -- our UUID
  ses_message_id  TEXT,                        -- correlate to email_log.ses_message_id
  event_type      TEXT NOT NULL,               -- send|delivery|bounce|complaint|reject|deliveryDelay|renderingFailure|open|click
  email           TEXT,                        -- recipient
  category        TEXT,                         -- transactional|newsletter (from message tag)
  source          TEXT,                         -- our origin tag if carried as a message tag
  send_id         TEXT,                         -- our newsletter_send id when newsletter (cohort key)
  bounce_type     TEXT,                         -- Permanent|Transient (bounce only)
  feedback_type   TEXT,                         -- complaint feedback type / SES diagnostic class
  link_url        TEXT,                         -- clicked target (click events, if click tracking on)
  ts              TEXT NOT NULL,               -- SES event timestamp (ISO 8601)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  meta_json       TEXT                         -- trimmed raw event for forensics
);

-- Drill-down indexes (spec 6a):
CREATE INDEX IF NOT EXISTS idx_email_event_msgid   ON email_event(ses_message_id);
CREATE INDEX IF NOT EXISTS idx_email_event_type_ts ON email_event(event_type, ts);   -- "who opened/bounced", time series
CREATE INDEX IF NOT EXISTS idx_email_event_email   ON email_event(email COLLATE NOCASE); -- recipient timeline
CREATE INDEX IF NOT EXISTS idx_email_event_send    ON email_event(send_id);            -- per-broadcast cohort

-- Dedup of SNS redelivery is handled in /api/email/events via webhook_event INSERT OR IGNORE
-- keyed on the SNS MessageId (mirrors bounce.js + stripe-webhook.js); no schema change needed here.
