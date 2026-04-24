-- migrations/015-course-waitlist.sql
-- Course waitlist: captures email sign-ups for waitlisted affiliate courses.
-- Run: npx wrangler d1 execute rrm-auth --remote --file=migrations/015-course-waitlist.sql

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
CREATE INDEX IF NOT EXISTS idx_course_waitlist_user ON course_waitlist(user_id);
CREATE INDEX IF NOT EXISTS idx_course_waitlist_email ON course_waitlist(email COLLATE NOCASE);
