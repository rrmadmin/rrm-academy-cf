-- Saved /Ask Q&A pairs.
-- The id is a 32-char hex token (generateId, 128 bits entropy) that doubles
-- as the share token in the URL /ask/s/<id>. Public share view returns the
-- record by id without exposing user_id; ownership enforced via user_id on
-- save/list/delete.
CREATE TABLE IF NOT EXISTS ask_saved (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  question       TEXT NOT NULL,
  answer         TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ask_saved_user_created
  ON ask_saved(user_id, created_at DESC);
