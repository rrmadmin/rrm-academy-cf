/**
 * Source-pattern regression tests for the metadata-first migration handoff gate (Phase 3.2).
 * Run with: node --test test/webhook-checkout-metadata.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
  'utf8'
);

describe('webhook-checkout metadata-first gate (Phase 3.2)', () => {
  it('reads wix_subscription_id from session metadata', () => {
    assert.ok(
      /session\.metadata\?\.wix_subscription_id/.test(source),
      'Must read wix_subscription_id from session.metadata'
    );
  });

  it('validates wix_sub_id format before SQL', () => {
    assert.ok(
      /\/\^wxs_\[a-z0-9_-\]\+\$\/i/.test(source),
      'Must regex-validate wix_subscription_id matches /^wxs_[a-z0-9_-]+$/i before binding to SQL'
    );
  });

  it('SQL uses wix_subscription_id (not id) as PK column', () => {
    assert.ok(
      !/wix_subscription[\s\S]{0,200}WHERE\s+id\s*=\s*\?/i.test(source),
      'No metadata-block SQL should use WHERE id = ? on wix_subscription'
    );
  });

  it('UPDATE filters by stripe_subscription_id IS NULL for idempotency', () => {
    assert.ok(
      /WHERE\s+wix_subscription_id\s*=\s*\?\s+AND\s+stripe_subscription_id\s+IS\s+NULL/i.test(source),
      'Metadata UPDATE must filter by stripe_subscription_id IS NULL'
    );
  });

  it('clears migration_handoff_started_at on success', () => {
    assert.ok(
      /migration_handoff_started_at\s*=\s*NULL/.test(source),
      'Metadata UPDATE must clear migration_handoff_started_at to release lock'
    );
  });

  it('sets admin_notified_at after successful SES send', () => {
    assert.ok(
      /admin_notified_at\s*=\s*strftime\('%s','now'\)/.test(source),
      'Must set admin_notified_at via strftime after sendEmailSafe success'
    );
  });

  it('uses sendEmailSafe with text field (not html)', () => {
    // The metadata path must call sendEmailSafe with a `text:` field, never `html:`
    const metaBlock = source.split('Existing email-match path runs only if')[0];
    assert.ok(
      !/sendEmailSafe[^{]*\{[^}]*\bhtml\s*:/.test(metaBlock),
      'sendEmailSafe must use text:, not html: (signature is { to, subject, text, source })'
    );
  });

  it('logs metadata path AE events with EVENTS binding', () => {
    assert.ok(
      /env\.EVENTS\?\.writeDataPoint|env\.EVENTS\.writeDataPoint/.test(source),
      'AE binding must be env.EVENTS (not WORKER_EVENTS)'
    );
    assert.ok(
      /'metadata-handoff-ok'/.test(source),
      'Must emit metadata-handoff-ok AE event on successful path'
    );
  });

  it('email-match path is gated by migrationHandled flag', () => {
    assert.ok(
      /\bmigrationHandled\b/.test(source),
      'Must use a migrationHandled flag to skip email-match when metadata path succeeded'
    );
    assert.ok(
      /if\s*\(\s*!migrationHandled\b/.test(source) || /!\s*migrationHandled\s*&&/.test(source),
      'Email-match block must be wrapped by if (!migrationHandled && ...)'
    );
  });

  it('does NOT use phantom stripe_active_at column', () => {
    assert.ok(
      !/stripe_active_at/.test(source),
      'stripe_active_at is not a real column -- do not write it (use updated_at instead)'
    );
  });

  it('does NOT use phantom sendAdminMigrationEmail helper', () => {
    assert.ok(
      !/sendAdminMigrationEmail\b/.test(source),
      'sendAdminMigrationEmail does not exist -- call sendEmailSafe directly'
    );
  });
});
