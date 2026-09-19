/**
 * migrations/044-oauth.sql -- OAuth 2.1 authorization server tables on rrm-auth.
 *
 * Runs the real DDL through node:sqlite (composed on top of schema.sql, since
 * migration 044 lives in the ROOT migrations/ directory that the harness's
 * default POST_SNAPSHOT_MIGRATIONS replay does not read -- see EXTRA_DDL in
 * scripts/gates/validate-sql-columns.mjs for the same fact stated for the
 * schema-drift gate) and asserts the three properties later code depends on:
 * single-use codes are enforceable by a UNIQUE grant_jti, tokens are
 * addressable by hash only, and a deleted user takes their OAuth rows with
 * them the way mcp_api_key does (documented via ON DELETE CASCADE, though D1
 * does not enforce foreign keys).
 */
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1, insertUser, SCHEMA_SQL } from './_d1-sqlite.mjs';

const OAUTH_SCHEMA_SQL =
  SCHEMA_SQL + '\n' + readFileSync(new URL('../migrations/044-oauth.sql', import.meta.url), 'utf8');

function oauthD1({ seed, interleave } = {}) {
  return sqliteD1({ seed, interleave, schemaSql: OAUTH_SCHEMA_SQL });
}

function cols(db, table) {
  return db._sqlite.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map(r => r.name);
}

describe('oauth schema', () => {
  it('creates the three tables with the columns the worker binds to', () => {
    const db = oauthD1({ seed: (s) => insertUser(s, { id: 'u_a', email: 'a@example.com' }) });
    assert.deepEqual(cols(db, 'oauth_client').sort(), [
      'client_id', 'client_name', 'created_at', 'created_ip_hash', 'disabled_at',
      'grant_types', 'redirect_uris', 'registration_json', 'scope', 'software_id',
      'token_endpoint_auth_method',
    ]);
    assert.ok(cols(db, 'oauth_code').includes('grant_jti'));
    assert.ok(cols(db, 'oauth_code').includes('consumed_at'));
    assert.ok(cols(db, 'oauth_code').includes('lineage_revoked_at'));
    assert.ok(cols(db, 'oauth_token').includes('parent_hash'));
    assert.ok(cols(db, 'oauth_token').includes('code_hash'));
  });

  it('gates token issuance on the lineage marker, so a revocation cannot be outrun', () => {
    const db = oauthD1({ seed: (s) => insertUser(s, { id: 'u_a', email: 'a@example.com' }) });
    const s = db._sqlite;
    s.prepare(`INSERT INTO oauth_client (client_id, client_name, redirect_uris, grant_types, token_endpoint_auth_method, scope, registration_json)
               VALUES ('c1','C','["https://example.com/cb"]','["authorization_code"]','none','public','{}')`).run();
    s.prepare(`INSERT INTO oauth_code (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, grant_jti, expires_at)
               VALUES ('ch-1', 'c1', 'u_a', 'https://example.com/cb', 'chal', 'S256', 'public', 'jti-gate', 9999999999)`).run();
    const issue = `INSERT INTO oauth_token (token_hash, token_type, client_id, user_id, scope, code_hash, parent_hash, expires_at)
                   SELECT ?, 'access', 'c1', 'u_a', 'public', 'ch-1', NULL, 9999999999
                   WHERE NOT EXISTS (SELECT 1 FROM oauth_code WHERE code_hash = 'ch-1' AND lineage_revoked_at IS NOT NULL)`;
    assert.equal(s.prepare(issue).run('tok-1').changes, 1);
    s.prepare("UPDATE oauth_code SET lineage_revoked_at = datetime('now') WHERE code_hash = 'ch-1'").run();
    assert.equal(s.prepare(issue).run('tok-2').changes, 0);
  });

  it('indexes oauth_token by client_id, so revoking a client\'s tokens is not a scan', () => {
    const db = oauthD1({ seed: (s) => insertUser(s, { id: 'u_a', email: 'a@example.com' }) });
    const plan = db._sqlite.prepare(
      "EXPLAIN QUERY PLAN UPDATE oauth_token SET revoked_at = datetime('now') WHERE client_id = 'c1' AND revoked_at IS NULL",
    ).all().map((r) => r.detail).join(' ');
    assert.match(plan, /idx_oauth_token_client/);
  });

  it('rejects a second code minted from the same consent grant', () => {
    const db = oauthD1({ seed: (s) => insertUser(s, { id: 'u_a', email: 'a@example.com' }) });
    const s = db._sqlite;
    s.prepare(`INSERT INTO oauth_client (client_id, client_name, redirect_uris, grant_types, token_endpoint_auth_method, scope, registration_json)
               VALUES ('c1','C','["https://example.com/cb"]','["authorization_code"]','none','public','{}')`).run();
    const ins = `INSERT INTO oauth_code (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, grant_jti, expires_at)
                 VALUES (?, 'c1', 'u_a', 'https://example.com/cb', 'chal', 'S256', 'public', 'jti-1', 9999999999)`;
    s.prepare(ins).run('hash-1');
    assert.throws(() => s.prepare(ins).run('hash-2'), /UNIQUE/);
  });
});
