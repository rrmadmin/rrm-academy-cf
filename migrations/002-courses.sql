-- Phase 8: Courses & Enrollment Schema
-- Applied to D1 database: rrm-auth
-- Run: wrangler d1 execute rrm-auth --file=migrations/002-courses.sql

-- One row per user-course enrollment.
-- Free courses create a row on enroll; paid courses create a row on Stripe webhook.
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

-- One row per user-step. Created on first interaction, upserted on each save.
-- course_id in PK for explicit scoping even though step IDs are globally unique.
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

-- Find all courses for a user (account dashboard, "my courses")
CREATE INDEX IF NOT EXISTS idx_enrollment_user ON enrollment(user_id);

-- Find all students in a course (admin, student count)
CREATE INDEX IF NOT EXISTS idx_enrollment_course ON enrollment(course_id);
