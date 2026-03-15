-- Affiliate click tracking: records when logged-in users click through to partner course sites
-- click_date stores YYYY-MM-DD for daily dedup (D1 disallows expressions in UNIQUE constraints)
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  click_date TEXT NOT NULL DEFAULT (date('now')),
  clicked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, course_id, click_date)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_user ON affiliate_clicks(user_id, course_id);
