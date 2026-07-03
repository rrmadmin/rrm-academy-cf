-- 2026-07-02 quiz_event table + quiz_result.rules_version column for FABM quiz v2 beacon tracking
--
-- Target database: rrm-survey (D1 binding SURVEY_DB)
--
-- Run ONCE before deploying this branch (functions/api/quiz/event.js,
-- functions/api/quiz/request.js rules_version support):
--   npx wrangler d1 execute rrm-survey --remote \
--     --file=scripts/migrations/2026-07-02-quiz-events-and-rules-version.sql

CREATE TABLE IF NOT EXISTS quiz_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT NOT NULL,
  event TEXT NOT NULL,
  qid TEXT,
  rules_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quiz_event_event_created ON quiz_event(event, created_at);
CREATE INDEX IF NOT EXISTS idx_quiz_event_sid ON quiz_event(sid);

ALTER TABLE quiz_result ADD COLUMN rules_version TEXT;
