-- 028: step_rendition: multi-format lesson content (reading / flashcards / quiz / audio).
-- Spec: docs/superpowers/specs/2026-06-06-honen-style-courses-upgrade-design.md section 3.1.
--
-- FK is DECORATIVE in D1 (PRAGMA foreign_keys is not run). Cleanup is explicit
-- in the admin step/course DELETE handlers (see steps/[stepId].js + [id].js).
-- No secondary index: the (step_id, format) PK prefix covers both hot paths
-- (per-course published-format lookup uses step_id IN (...); runtime reads are
-- exact (step_id, format) point reads). status is never a leading filter alone.
-- Timestamps are set by endpoint code via datetime('now') in SQL, matching the
-- course_step admin endpoints.
CREATE TABLE IF NOT EXISTS step_rendition (
  step_id TEXT NOT NULL REFERENCES course_step(id),
  format TEXT NOT NULL CHECK (format IN ('reading','flashcards','quiz','audio')),
  content_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  source TEXT,
  word_count INTEGER,
  duration_seconds INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (step_id, format)
);
