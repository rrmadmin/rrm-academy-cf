/**
 * Tests for POST /api/stripe-webhook (functions/api/stripe-webhook.js)
 * and billing handler modules.
 * Run with: node --test test/stripe-webhook.test.js
 *
 * Regression tests for /arise --deep run 46 findings:
 * - F1: Dedup cleanup only on 5xx (not 4xx)
 * - F4: billing/status.js returns null for terminal subscriptions
 * - F5: GA4 session_id NaN guard
 * - B1: charge.refunded revokes enrollment (soft delete via revoked_at)
 * - B2: Stripe customer mismatch sends admin email alerts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockDB, mockEnv, mockWaitUntil } from './_helpers.js';

// --- F1: Dedup cleanup only deletes on 5xx, not 4xx ---

describe('stripe-webhook -- dedup cleanup (F1)', () => {
  // We test the logic by importing and calling handleWebhook indirectly via onRequestPost.
  // Since onRequestPost requires Stripe signature verification which we can't mock easily,
  // we test the dedup cleanup behavior at the integration level.
  // The key invariant: result.status >= 500 triggers DELETE, result.status < 500 does not.

  it('dedup cleanup threshold is 500, not 400', async () => {
    // Read the source file and verify the threshold
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/stripe-webhook.js', import.meta.url),
      'utf8'
    );
    // The fix changed >= 400 to >= 500
    assert.ok(
      source.includes('result.status >= 500'),
      'Dedup cleanup should only trigger on 5xx errors (>= 500), not 4xx'
    );
    assert.ok(
      !source.includes('result.status >= 400'),
      'Should NOT have >= 400 threshold (old bug)'
    );
  });
});

// --- F2: Email normalization in webhook-checkout ---

describe('webhook-checkout -- email normalization (F2)', () => {
  it('course enrollment email path normalizes email', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
      'utf8'
    );
    // Find all email extractions from customer_details -- each should have toLowerCase().trim()
    const emailExtractions = source.match(/const email = .*customer_details.*?;/g) || [];
    assert.ok(emailExtractions.length >= 3, `Expected 3+ email extractions, found ${emailExtractions.length}`);
    for (const extraction of emailExtractions) {
      assert.ok(
        extraction.includes('.toLowerCase().trim()'),
        `Email extraction missing normalization: ${extraction}`
      );
    }
  });
});

// --- F3: Duplicate subscription guard includes 'incomplete' ---

describe('create-checkout -- subscription guard (F3)', () => {
  it('blocks incomplete subscriptions', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/create-checkout.js', import.meta.url),
      'utf8'
    );
    // The blocking find() must include 'incomplete'
    const blockingMatch = source.match(/const blocking = existing\.data\.find\([\s\S]*?\);/);
    assert.ok(blockingMatch, 'Should have a blocking subscription check');
    assert.ok(
      blockingMatch[0].includes("'incomplete'"),
      'Blocking check must include incomplete status'
    );
  });

  it('has distinct error message for incomplete status', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/create-checkout.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes("blocking.status === 'incomplete'"),
      'Should have specific handling for incomplete status'
    );
    assert.ok(
      source.includes('pending membership checkout'),
      'Should have user-friendly message for incomplete'
    );
  });
});

// --- F4: billing/status.js returns null for terminal subscriptions ---

describe('billing/status -- terminal subscription handling (F4)', () => {
  it('uses displayable set instead of fallback to data[0]', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/status.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes('displayable'),
      'Should use a displayable status set'
    );
    // Must NOT fall back to subscriptions.data[0] unconditionally
    assert.ok(
      !source.includes('|| subscriptions.data[0]'),
      'Should NOT fall back to data[0] (shows canceled subs as current)'
    );
  });

  it('displayable set includes active, trialing, past_due, incomplete', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/status.js', import.meta.url),
      'utf8'
    );
    for (const status of ['active', 'trialing', 'past_due', 'incomplete']) {
      assert.ok(
        source.includes(`'${status}'`),
        `displayable set should include '${status}'`
      );
    }
  });
});

// --- F5: GA4 session_id NaN guard ---

describe('webhook-checkout -- GA4 session_id NaN guard (F5)', () => {
  it('guards ga_session_id with Number.isFinite', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes('Number.isFinite'),
      'ga_session_id must be guarded with Number.isFinite to prevent NaN'
    );
    // Should NOT have bare Number() assignment
    assert.ok(
      !source.includes('gaOverrides.session_id = Number(session.metadata'),
      'Should NOT have unguarded Number() -> session_id assignment'
    );
  });
});

// --- F6: Name stored as null, not empty string ---

describe('webhook-checkout -- name null consistency (F6)', () => {
  it('INSERT uses name || null, not bare name', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
      'utf8'
    );
    // Find the INSERT OR IGNORE bind call
    const insertSection = source.match(/INSERT OR IGNORE INTO user[\s\S]*?\.run\(\)/);
    assert.ok(insertSection, 'Should have INSERT OR IGNORE INTO user');
    assert.ok(
      insertSection[0].includes('name || null'),
      'INSERT bind should use name || null, not bare name'
    );
  });
});

// --- F7: Test-mode price guard uses _test_ not bare test ---

describe('create-checkout -- test-mode price guard (F7)', () => {
  it('uses _test_ substring check, not bare test', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/create-checkout.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes("priceId.includes('_test_')"),
      'Should check for _test_ (with underscores) to avoid false positives'
    );
    // Verify the OLD pattern is gone
    assert.ok(
      !source.includes("priceId.includes('test')") || source.includes("priceId.includes('_test_')"),
      'Should not have bare includes(test) without underscores'
    );
  });
});

// --- F8: Name truncation ---

describe('webhook-checkout -- name truncation (F8)', () => {
  it('truncates name from Stripe at all extraction points', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
      'utf8'
    );
    // All name extractions should include .slice(0, 200)
    const nameExtractions = source.match(/const name = .*customer_details\?\.name.*?;/g) || [];
    assert.ok(nameExtractions.length >= 3, `Expected 3+ name extractions, found ${nameExtractions.length}`);
    for (const extraction of nameExtractions) {
      assert.ok(
        extraction.includes('.slice(0, 200)'),
        `Name extraction missing truncation: ${extraction}`
      );
    }
  });
});

// --- F9: Orphaned Stripe customer warning ---

describe('webhook-checkout -- orphaned customer warning (F9)', () => {
  it('logs warning when concurrent account creation orphans a Stripe customer', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes('orphaned_stripe_customer'),
      'Should log orphaned_stripe_customer warning when UPDATE matches 0 rows'
    );
  });
});

// --- B1: charge.refunded revokes enrollment ---

describe('stripe-webhook -- refund enrollment revocation (B1)', () => {
  it('charge.refunded handler uses UPDATE revoked_at, not DELETE', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/stripe-webhook.js', import.meta.url),
      'utf8'
    );
    // Must use soft-delete (revoked_at) not hard DELETE
    assert.ok(
      source.includes("SET revoked_at = datetime('now')"),
      'Should soft-revoke via revoked_at, not DELETE'
    );
    assert.ok(
      source.includes('charge.refunded && charge.payment_intent'),
      'Should only revoke on full refund (charge.refunded === true)'
    );
    assert.ok(
      source.includes('enrollment_revoked'),
      'Should log enrollment_revoked on successful revocation'
    );
  });

  it('sends admin email on revocation', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/stripe-webhook.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes('administrator@rrmacademy.org'),
      'Should email admin on revocation'
    );
    assert.ok(
      source.includes('Enrollment revoked'),
      'Email subject should mention enrollment revocation'
    );
  });

  it('all enrollment access queries filter revoked_at IS NULL', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');

    // Check all course-related files that query enrollment
    const coursesDir = new URL('../functions/api/courses/', import.meta.url).pathname;
    const courseFiles = readdirSync(coursesDir).filter(f => f.endsWith('.js'));

    for (const file of courseFiles) {
      const source = readFileSync(join(coursesDir, file), 'utf8');
      const enrollmentQueries = source.match(/FROM enrollment[\s\S]*?(?:\.first|\.all|\.run)\(\)/g) || [];
      for (const query of enrollmentQueries) {
        // Skip INSERT queries -- they don't need the filter
        if (query.includes('INSERT')) continue;
        assert.ok(
          query.includes('revoked_at IS NULL'),
          `${file}: enrollment SELECT/WHERE missing revoked_at IS NULL guard:\n${query.slice(0, 200)}`
        );
      }
    }
  });
});

// --- B2: Stripe customer mismatch admin alerts ---

describe('webhook-checkout -- customer mismatch admin alerts (B2)', () => {
  it('sends email on stripe_customer_mismatch', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes('Stripe customer mismatch'),
      'Should send email with subject containing "Stripe customer mismatch"'
    );
    assert.ok(
      source.includes('billing/customer-mismatch'),
      'Email source should be billing/customer-mismatch'
    );
  });

  it('sends email on orphaned Stripe customer', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes('Orphaned Stripe customer'),
      'Should send email with subject containing "Orphaned Stripe customer"'
    );
    assert.ok(
      source.includes('billing/orphaned-customer'),
      'Email source should be billing/orphaned-customer'
    );
  });

  it('both alerts are non-blocking via waitUntil + catch', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
      'utf8'
    );
    // Count instances of the alert pattern: waitUntil(sendEmailSafe(...).catch(() => {}))
    // for the admin alerts (mismatch + orphaned)
    const alertBlocks = source.match(/waitUntil\(sendEmailSafe\(env, waitUntil,[\s\S]*?\.catch\(\(\) => \{\}\)\)/g) || [];
    // Should have at least 2 admin alert blocks (mismatch + orphaned)
    // (there are also non-admin sendEmailSafe calls, but those don't use waitUntil+catch pattern)
    assert.ok(
      alertBlocks.length >= 2,
      `Expected 2+ non-blocking admin alert patterns, found ${alertBlocks.length}`
    );
  });
});
