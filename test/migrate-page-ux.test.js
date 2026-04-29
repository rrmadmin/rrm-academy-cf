import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../functions/save-the-uterus-club/migrate/index.js', import.meta.url),
  'utf8'
);

describe('migrate.js UX regression suite (Phase 3.2 overhaul)', () => {
  it('no native alert() calls', () => {
    assert.ok(
      !source.includes('alert('),
      'migrate.js must not use native alert() -- all errors must use inline error region'
    );
  });

  it('no legacy palette colors (#6b4d2a, #d4c4ab) or old font', () => {
    assert.ok(
      !source.includes('#6b4d2a'),
      'Legacy button color #6b4d2a must not appear'
    );
    assert.ok(
      !source.includes('#d4c4ab'),
      'Legacy border color #d4c4ab must not appear'
    );
    assert.ok(
      !(/font-family:\s*Georgia,\s*serif/.test(source)),
      'Legacy font-family "Georgia,serif" body rule must not appear'
    );
  });

  it('RRM Foundation 501(c)(3) byline present in footer', () => {
    assert.ok(
      source.includes('RRM Foundation'),
      'Must contain "RRM Foundation"'
    );
    assert.ok(
      source.includes('501(c)(3)'),
      'Must contain "501(c)(3)"'
    );
    assert.ok(
      source.includes('EIN: 93-4594315'),
      'Must contain EIN: 93-4594315'
    );
  });

  it('brand-aligned design tokens present (accent color and Cormorant Garamond)', () => {
    assert.ok(
      source.includes('#725e7e') || source.includes('Cormorant Garamond'),
      'Must use brand accent color #725e7e or Cormorant Garamond font'
    );
    assert.ok(
      source.includes('Cormorant Garamond'),
      'Must use Cormorant Garamond for heading font'
    );
  });

  it('past-date detection branch present (nextDateStale)', () => {
    assert.ok(
      source.includes('nextDateStale'),
      'Must have nextDateStale variable for past-date detection'
    );
    assert.ok(
      /already passed/.test(source),
      'Must render "already passed" message when next_expected_at is stale'
    );
  });

  it('inline error region with aria-live present', () => {
    assert.ok(
      source.includes('role="alert"') || source.includes('aria-live'),
      'Must have an inline error region with role="alert" or aria-live'
    );
    assert.ok(
      source.includes('error-region') || source.includes('errorRegion'),
      'Must have an error region element'
    );
  });

  it('off-amount flow: detects 412, has acknowledge_off_amount re-POST', () => {
    assert.ok(
      source.includes('off_amount'),
      'Must handle off_amount error code'
    );
    assert.ok(
      source.includes('acknowledge_off_amount'),
      'Must include acknowledge_off_amount in re-POST payload'
    );
    assert.ok(
      /res\.status\s*===\s*412/.test(source),
      'Must check for HTTP 412 status to detect off_amount'
    );
  });

  it('expired-token CTA points to mailto, not account-only', () => {
    assert.ok(
      source.includes('mailto:administrator@rrmacademy.org?subject=New%20switch-over%20link%20please'),
      'Expired-token CTA must have mailto link for requesting a new link'
    );
    assert.ok(
      /one business day/.test(source),
      'Expired-token message must promise response within one business day'
    );
  });

  it('already-migrated copy includes double-charge reassurance', () => {
    assert.ok(
      /double.charged/.test(source),
      'already-migrated state must include double-charged reassurance'
    );
    assert.ok(
      /24 hours/.test(source),
      'already-migrated state must mention 24-hour cancellation window'
    );
  });
});
