-- migrations/015-course-waitlist.sql
-- Course waitlist: captures email sign-ups for waitlisted affiliate courses.
-- Run: npx wrangler d1 execute rrm-auth --remote --file=migrations/015-course-waitlist.sql
--
-- user_id: REFERENCES user(id) ON DELETE SET NULL — matches sibling migrations
-- 002/003/005/006. D1 doesn't enforce FKs at runtime but the declaration
-- documents intent for account-deletion/GDPR flows (preserve email signup,
-- null out the user link).
--
-- unsubscribed_at: reserved for a future per-waitlist unsubscribe endpoint.
-- Until that exists, cohort-open sends must JOIN newsletter_subscriber.status
-- to honor CAN-SPAM opt-outs through the shared newsletter list.

CREATE TABLE IF NOT EXISTS course_waitlist (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  unsubscribed_at TEXT,
  UNIQUE(course_id, email)
);

CREATE INDEX IF NOT EXISTS idx_course_waitlist_course_created ON course_waitlist(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_waitlist_user ON course_waitlist(user_id);
CREATE INDEX IF NOT EXISTS idx_course_waitlist_email ON course_waitlist(email COLLATE NOCASE);
