-- ask_answer: archive of what the /ask assistant actually said.
-- Database: rrm-analytics (same D1 as search_log). Phase 0a of
-- docs/plans/2026-09-01-rrm-ai-adversarial-review.md.
-- Applied remote 2026-09-01.
CREATE TABLE IF NOT EXISTS ask_answer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_log_id INTEGER,
  source TEXT NOT NULL,
  query TEXT NOT NULL,
  answer TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  fallback INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  prompt_hash TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  duration_ms INTEGER,
  user_id TEXT,
  ip_hash TEXT,
  eval_tag TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ask_answer_created ON ask_answer(created_at);
CREATE INDEX IF NOT EXISTS idx_ask_answer_source ON ask_answer(source);
CREATE INDEX IF NOT EXISTS idx_ask_answer_eval_tag ON ask_answer(eval_tag);
