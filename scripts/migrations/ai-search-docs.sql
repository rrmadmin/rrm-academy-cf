-- Migration: ai_search_docs (Phase 1b of /ask v2 AI Search rebuild)
-- Plan: docs/plans/2026-04-20-ask-v2-ai-search-rebuild.md
-- Date: 2026-04-28
-- Database: rrm-auth (id 22742c9c-77fa-4344-abda-7e7e8b0da9de)
--
-- Purpose: persist key↔item_id↔content_hash mapping for the corpus loader.
-- The CF AI Search items.delete() API takes item_id, not key, so we MUST
-- store item_id at upload time to support reconcile/orphan cleanup later.
--
-- Apply: npx wrangler d1 execute rrm-auth --remote --file scripts/migrations/ai-search-docs.sql
-- Rollback: DROP TABLE IF EXISTS ai_search_docs; DROP INDEX IF EXISTS idx_ai_search_docs_source_type;
--
-- NOTE: Initial production deploy used `key TEXT PRIMARY KEY COLLATE NOCASE` (2026-04-28).
-- COLLATE NOCASE was removed because CF Search keys are case-sensitive; D1 should mirror.
-- An ALTER TABLE migration to drop COLLATE NOCASE is non-trivial in SQLite (requires table
-- rename + recreate). Defer until current keys are confirmed all-lowercase.

CREATE TABLE IF NOT EXISTS ai_search_docs (
  key TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_type TEXT NOT NULL,
  full_slug TEXT,
  indexed_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_search_docs_source_type ON ai_search_docs(source_type);
CREATE INDEX IF NOT EXISTS idx_ai_search_docs_last_seen_at ON ai_search_docs(last_seen_at);
