-- 031-supporter-recognition.sql
-- Public opt-in supporter recognition for campaign fundraisers (provider-directory).
-- Holds ONLY consented display rows: server-derived "First L." + gift_seq. No amounts,
-- no full names; email is private (dedup/contact link) and never returned by the read API.
-- Apply (by hand; no runner):
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/031-supporter-recognition.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/031-supporter-recognition.sql
CREATE TABLE IF NOT EXISTS supporter_recognition (
  id TEXT PRIMARY KEY,
  campaign TEXT NOT NULL DEFAULT 'provider-directory',
  display_name TEXT NOT NULL,
  gift_seq INTEGER NOT NULL,
  email TEXT COLLATE NOCASE,
  source TEXT NOT NULL CHECK (source IN ('stripe')),
  source_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_supporter_recognition_campaign ON supporter_recognition(campaign);
CREATE INDEX IF NOT EXISTS idx_supporter_recognition_giftseq ON supporter_recognition(gift_seq);
CREATE INDEX IF NOT EXISTS idx_supporter_recognition_occurred ON supporter_recognition(occurred_at);
