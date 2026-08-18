-- 032-free-events.sql
-- Free-event mode for Save the Uterus Club events -- additive migration on rrm-auth (D1).
--
-- WHY
-- Some Save the Uterus Club calls are free public recruitment events. Today
-- /events/<slug> scrubs the joining credential for every non-member and shows a
-- "Join Save the Uterus Club to Watch" CTA. A free event instead lets an
-- anonymous visitor register with an email and receive the joining link BY EMAIL.
-- The page body stays scrubbed for everyone who is not a member: the only place
-- the link reaches a non-member is the message sent by /api/events/register.
--
-- ADDITIVE ONLY: one nullable-by-default column on community_post + one new table
-- + two indexes. Nothing is dropped. Existing event posts keep today's behavior
-- because is_free defaults to 0.
--
-- FK NOTE: D1 does NOT run PRAGMA foreign_keys = ON. The REFERENCES below is
-- DECORATIVE, exactly as in migrations/025. Referential integrity is enforced at
-- the app layer: /api/events/register resolves the post row before it writes, and
-- both readers join back to community_post.
--
-- ROLLBACK (autonomous): NEVER DROP COLUMN community_post.is_free (leave it at 0
-- and the feature self-disables -- every free-event branch is gated on is_free=1).
-- To disable fully: UPDATE community_post SET is_free = 0 WHERE type = 'event'.
--
-- Apply (by hand; no runner):
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/032-free-events.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/032-free-events.sql
--
-- NOTE: ALTER TABLE ... ADD COLUMN has no IF NOT EXISTS form in SQLite. Re-running
-- this file raises "duplicate column name: is_free" on the first statement; that
-- error is the idempotency signal, not a failure to investigate.

ALTER TABLE community_post ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS event_registration (
  id              TEXT PRIMARY KEY,
  post_id         TEXT NOT NULL REFERENCES community_post(id),
  email           TEXT NOT NULL COLLATE NOCASE,
  user_id         TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  link_sent_at    TEXT,
  reminder_sent_at TEXT,
  UNIQUE(post_id, email COLLATE NOCASE)
);

-- Registration lists are always read per event, newest or oldest first.
CREATE INDEX IF NOT EXISTS idx_event_registration_post_created ON event_registration(post_id, created_at);
-- The day-of reminder sweep selects on reminder_sent_at IS NULL within a post.
CREATE INDEX IF NOT EXISTS idx_event_registration_reminder ON event_registration(post_id, reminder_sent_at);
