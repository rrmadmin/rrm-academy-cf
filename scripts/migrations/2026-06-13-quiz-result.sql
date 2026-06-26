-- 2026-06-13 quiz_result table for FABM method-match quiz results
--
-- Target database: rrm-survey (D1 binding SURVEY_DB)
--
-- Run ONCE before deploying functions/api/quiz/request.js:
--   npx wrangler d1 execute rrm-survey --remote \
--     --file=scripts/migrations/2026-06-13-quiz-result.sql

CREATE TABLE IF NOT EXISTS quiz_result (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  primary_method TEXT NOT NULL,
  alternate_method TEXT,
  answers TEXT,
  research_consent INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quiz_result_created ON quiz_result(created_at);
CREATE INDEX IF NOT EXISTS idx_quiz_result_consent ON quiz_result(research_consent);
