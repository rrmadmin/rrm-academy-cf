-- rrm-analytics D1 -- search_log table
-- Captures every /api/ask, /api/search/semantic, and Pagefind query for
-- content-gap analysis. Stored plaintext (not hashed) for SQL LIKE queries.
-- Retention: 365 days, pruned by /api/admin/cleanup daily cron.

CREATE TABLE IF NOT EXISTS search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK(source IN ('ask', 'semantic', 'pagefind')),
  query TEXT NOT NULL,
  user_id TEXT,
  ip_hash TEXT,
  results_count INTEGER,
  duration_ms INTEGER,
  http_status INTEGER,
  user_agent_short TEXT,
  referer_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_search_log_created ON search_log(created_at);
CREATE INDEX IF NOT EXISTS idx_search_log_source_created ON search_log(source, created_at);
CREATE INDEX IF NOT EXISTS idx_search_log_zero ON search_log(source, created_at) WHERE results_count = 0;
CREATE INDEX IF NOT EXISTS idx_search_log_user ON search_log(user_id, created_at) WHERE user_id IS NOT NULL;
