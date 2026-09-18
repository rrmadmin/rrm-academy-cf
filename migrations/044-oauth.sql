-- 044-oauth.sql
-- OAuth 2.1 authorization server tables on rrm-auth. The authorization server
-- is the rrm-mcp Worker (mcp.rrmacademy.org); this repo owns the schema because
-- it owns rrm-auth. Apply BEFORE deploying the rrm-mcp code that reads them:
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/044-oauth.sql
--
-- Nothing here stores a bearer secret in the clear. Authorization codes and both
-- token types are stored as SHA-256 hex of the value handed to the client, the
-- same discipline mcp_api_key uses.
--
-- oauth_client.redirect_uris   JSON array of exact-match redirect URIs.
-- oauth_client.registration_json  the raw RFC 7591 body the host sent, kept so
--   docs/oauth-hosts.md can record per-host quirks from real data.
-- oauth_client.created_ip_hash  a KEYED hash (SHA-256 over the OAuth grant
--   secret and the address, not a plain hash of the address alone -- a plain
--   SHA-256 of an IPv4 address is reversible by brute force over the small
--   input space). The per-client registration rate limit counts rows by it.
--   The register code (a later task) computes the key.
-- oauth_code.grant_jti  the consent assertion id. UNIQUE, so one consent can
--   mint exactly one code even under a replayed decision POST.
-- oauth_token.code_hash  lineage: a refresh-token reuse revokes every token
--   descended from the same authorization code.
--
-- ON DELETE CASCADE on the client_id and user_id foreign keys documents the
-- same deletion behavior mcp_api_key follows (a deleted client or user takes
-- its OAuth rows with it), but D1 does not enforce foreign keys, so this is
-- documentation only, not an enforced guarantee. Deleting code must clean up
-- these rows explicitly, the same discipline schema.sql's header already
-- notes for every other FK-shaped reference in this database.

CREATE TABLE IF NOT EXISTS oauth_client (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  grant_types TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  scope TEXT NOT NULL DEFAULT 'public',
  registration_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_ip_hash TEXT,
  software_id TEXT,
  disabled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_oauth_client_ip ON oauth_client(created_ip_hash, created_at);

CREATE TABLE IF NOT EXISTS oauth_code (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  scope TEXT NOT NULL,
  grant_jti TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_token (
  token_hash TEXT PRIMARY KEY,
  token_type TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  code_hash TEXT,
  parent_hash TEXT,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_oauth_token_user ON oauth_token(user_id, token_type);
CREATE INDEX IF NOT EXISTS idx_oauth_token_lineage ON oauth_token(code_hash) WHERE code_hash IS NOT NULL;
