-- migrations/016-mcp-api-keys.sql
-- Per-user MCP API keys: lets RRM Academy account holders generate, label,
-- and revoke their own Bearer tokens for the rrm-mcp connector at
-- mcp.rrmacademy.org.
-- Run: npx wrangler d1 execute rrm-auth --remote --file=migrations/016-mcp-api-keys.sql
--
-- key_hash: SHA-256 (hex) of the plaintext token. Server-side lookup is hash-only;
-- plaintext is shown to the user once at create-time and never stored.
-- key_preview: first 12 chars of plaintext (e.g. "rrma_mcp_a1b") for the UI list.
-- last_used_at: best-effort fire-and-forget update on the rrm-mcp worker; not
-- guaranteed precise.
-- revoked_at: soft-revoke. Validation queries WHERE revoked_at IS NULL.
-- user_id: REFERENCES user(id) ON DELETE CASCADE — when an account is deleted,
-- their MCP keys go with it. Different from waitlist (which preserves email
-- signup) because keys without an owner cannot authenticate anyone.

CREATE TABLE IF NOT EXISTS mcp_api_key (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_preview TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_api_key_user ON mcp_api_key(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_api_key_hash_active ON mcp_api_key(key_hash) WHERE revoked_at IS NULL;
