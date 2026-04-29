/**
 * Source-pattern regression tests for functions/api/admin/wix-migration-link.js
 * Layer 4 reconciliation endpoint.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../functions/api/admin/wix-migration-link.js', import.meta.url),
  'utf8'
);

describe('admin/wix-migration-link.js (Layer 4 reconciliation endpoint)', () => {
  it('exports onRequestPost + onRequestOptions', () => {
    assert.ok(/export\s+(async\s+)?function\s+onRequestPost/.test(source));
    assert.ok(/export\s+(function\s+|const\s+)onRequestOptions/.test(source));
  });

  it('requires ADMIN_API_SECRET via constant-time Bearer compare', () => {
    assert.ok(/env\.ADMIN_API_SECRET/.test(source));
    assert.ok(/Bearer\s+\$\{env\.ADMIN_API_SECRET\}|Bearer \${env\.ADMIN_API_SECRET}/.test(source));
    // Constant-time pattern (XOR loop matching wix-migration-email.js)
    assert.ok(/mismatch\s*\|=/.test(source) || /timingSafeEqual/.test(source));
  });

  it('returns 503 on missing env (DB / ADMIN_API_SECRET)', () => {
    assert.ok(/'service_unavailable'/.test(source));
    assert.ok(/503/.test(source));
  });

  it('validates wix_subscription_id format (wxs_ prefix)', () => {
    assert.ok(/\/\^wxs_\[a-z0-9_-\]\+\$\/i/.test(source) || /\/\^wxs_/.test(source));
  });

  it('handles already_linked / already_migrated / cancel_pending preconditions', () => {
    assert.ok(/'already_linked'/.test(source));
    assert.ok(/'already_migrated'/.test(source));
    assert.ok(/'cancel_pending'/.test(source));
    assert.ok(/409/.test(source));
  });

  it('supports dry_run mode (no writes)', () => {
    assert.ok(/dry_run/.test(source) || /dryRun/.test(source));
  });

  it('supports force override for already_linked', () => {
    assert.ok(/\bforce\b/.test(source));
  });

  it('emits admin-link AE event', () => {
    assert.ok(/'admin-link'/.test(source));
    assert.ok(/env\.EVENTS\?\.writeDataPoint|env\.EVENTS\.writeDataPoint/.test(source));
  });

  it('logs audit trail via log() helper', () => {
    assert.ok(/log\(env,\s*waitUntil,\s*'billing',\s*'admin_wix_link'/.test(source));
  });

  it('uses wix_subscription_id (not id) as PK column', () => {
    // Ensure the SQL uses the correct PK
    assert.ok(/WHERE\s+wix_subscription_id\s*=\s*\?/.test(source));
    assert.ok(!/wix_subscription[\s\S]{0,200}WHERE\s+id\s*=\s*\?/.test(source));
  });

  it('uses COLLATE NOCASE for email lookup on user table', () => {
    // user_email → user.id resolution must be case-insensitive
    if (/SELECT[\s\S]{0,80}FROM\s+user[\s\S]{0,80}WHERE\s+email/.test(source)) {
      assert.ok(/COLLATE\s+NOCASE/i.test(source), 'user.email lookup must use COLLATE NOCASE');
    }
  });

  it('records reason in migration_notes via SQL append (no string interpolation)', () => {
    // The UPDATE must use ? placeholders for reason, not ${reason}
    assert.ok(/migration_notes/.test(source));
    assert.ok(!/migration_notes[\s\S]{0,200}\$\{reason/.test(source));
  });
});
