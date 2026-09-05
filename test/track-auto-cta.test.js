/**
 * Extraction test for track-auto.ts's cta_click listener and the
 * LEGACY_CTA_RENAME_MAP transition bridge.
 *
 * Run: node --experimental-strip-types --test test/track-auto-cta.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../src/scripts/track-auto.ts', import.meta.url), 'utf8');

describe('track-auto.ts -- cta_click source shape', () => {
  it('reads [data-cta] before falling back to the legacy attribute', () => {
    assert.match(SOURCE, /closest\?\.\('\[data-cta\], \[data-track-cta\]'\)/);
  });

  it('data-cta wins when both attributes are present on one element', () => {
    assert.match(SOURCE, /const id = newId \|\| \(legacyId/);
  });

  it('a legacy id with no rename-table entry is dropped, not sent freeform', () => {
    assert.match(SOURCE, /LEGACY_CTA_RENAME_MAP\[legacyId\] : null/);
    assert.doesNotMatch(SOURCE, /LEGACY_CTA_RENAME_MAP\[legacyId\]\s*\|\|\s*legacyId/, 'must not fall back to the raw legacy id');
  });

  it('sends cta_zone and cta_intent derived from the composed id', () => {
    assert.match(SOURCE, /cta_zone: zone/);
    assert.match(SOURCE, /cta_intent: intent/);
  });

  it('never sends value or position on this event', () => {
    assert.doesNotMatch(SOURCE, /data-track-value/);
    assert.doesNotMatch(SOURCE, /data-track-position/);
  });

  it('every id renamed in Task 2 has a LEGACY_CTA_RENAME_MAP entry', () => {
    const renamed = [
      'account-mobile-nav', 'donate-mobile-nav', 'account-header', 'donate-header',
      'donate-footer', 'hero-start-learning', 'hero-endo-survey', 'hero-for-patients',
      'hero-for-clinicians', 'hero-donate', '500-home', '500-retry',
    ];
    for (const legacyId of renamed) {
      assert.match(SOURCE, new RegExp(`'${legacyId}':\\s*'`), `LEGACY_CTA_RENAME_MAP missing entry for "${legacyId}"`);
    }
  });

  it('REQUIRED_PARAMS for cta_click still requires only id and page', async () => {
    const { REQUIRED_PARAMS } = await import('../functions/api/_track-events.js');
    assert.deepEqual(REQUIRED_PARAMS.get('cta_click'), ['id', 'page']);
  });
});
