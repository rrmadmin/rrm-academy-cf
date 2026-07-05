import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDisplayName, readSupporterConsent, recordSupporterGift } from '../../functions/api/billing/_supporter-gift.js';

test('two-token name -> First L.', () => {
  assert.equal(deriveDisplayName('Sarah Martinez'), 'Sarah M.');
});
test('extra tokens use the last initial', () => {
  assert.equal(deriveDisplayName('Maria Del Carmen Ruiz'), 'Maria R.');
});
test('single token -> bare first name (no dangling initial)', () => {
  assert.equal(deriveDisplayName('Cher'), 'Cher');
});
test('empty / whitespace -> null (no row)', () => {
  assert.equal(deriveDisplayName('   '), null);
  assert.equal(deriveDisplayName(''), null);
  assert.equal(deriveDisplayName(null), null);
});
test('strips angle brackets and quotes (defense in depth)', () => {
  assert.equal(deriveDisplayName('<b>Sarah</b> Martinez'), 'bSarahb M.');
});
test('strips bidi-override + zero-width chars', () => {
  assert.equal(deriveDisplayName('Sarah‮Martinez'), 'SarahMartinez'); // collapses to one token after strip
});
test('caps to 40 graphemes', () => {
  const long = 'Alexandrina'.repeat(6) + ' Smith';
  assert.ok([...deriveDisplayName(long)].length <= 40);
});
test('rejects impersonation -> null', () => {
  assert.equal(deriveDisplayName('RRM Academy'), null);
  assert.equal(deriveDisplayName('Naomi Whittaker'), null);
  assert.equal(deriveDisplayName('Official RRM'), null);
});
test('readSupporterConsent reads the dropdown by key', () => {
  const yes = { custom_fields: [{ key: 'show_supporter', dropdown: { value: 'yes' } }] };
  const no = { custom_fields: [{ key: 'show_supporter', dropdown: { value: 'no' } }] };
  const absent = { custom_fields: [{ key: 'other', text: { value: 'x' } }] };
  assert.equal(readSupporterConsent(yes), true);
  assert.equal(readSupporterConsent(no), false);
  assert.equal(readSupporterConsent(absent), false);
  assert.equal(readSupporterConsent({}), false);
});

// Intentional 0-sentinel fail-soft (commit 63217f9d, 2026-07-02): an invalid/unavailable
// giftSeq must not drop a consented recognition row — it's written with gift_seq=0 for
// later backfill, and consumers exclude the sentinel (fund-supporters.js founding query
// filters gift_seq >= 1; supporter-badge.js returns seq: null when gift_seq < 1).
test('recordSupporterGift writes a 0-sentinel row when giftSeq=0 (fail-soft, no dropped consent)', async () => {
  const calls = [];
  const mockDb = {
    prepare: () => ({
      bind: (...args) => {
        calls.push(args);
        return { run: async () => {} };
      },
    }),
  };
  const result = await recordSupporterGift(mockDb, {
    displayName: 'Sarah M.',
    giftSeq: 0,
    sourceId: 'pi_test_123',
    campaign: 'provider-directory',
    email: 'sarah@example.com',
    occurredAt: new Date().toISOString(),
  });
  assert.equal(result.recorded, true, 'fail-soft: row still recorded with 0 sentinel');
  assert.equal(calls.length, 1, 'db.prepare should be called exactly once');
  assert.equal(calls[0][3], 0, 'gift_seq bound as the 0 sentinel');
});

test('recordSupporterGift coerces negative giftSeq to the 0 sentinel and still writes', async () => {
  const calls = [];
  const mockDb = {
    prepare: () => ({
      bind: (...args) => {
        calls.push(args);
        return { run: async () => {} };
      },
    }),
  };
  const result = await recordSupporterGift(mockDb, {
    displayName: 'Jane D.',
    giftSeq: -1,
    sourceId: 'pi_test_456',
    campaign: 'provider-directory',
    email: 'jane@example.com',
    occurredAt: new Date().toISOString(),
  });
  assert.equal(result.recorded, true, 'fail-soft: row still recorded with 0 sentinel');
  assert.equal(calls.length, 1, 'db.prepare should be called exactly once');
  assert.equal(calls[0][3], 0, 'negative giftSeq coerced to the 0 sentinel');
});

test('recordSupporterGift accepts giftSeq=1 and writes the row', async () => {
  const calls = [];
  const mockDb = {
    prepare: () => ({
      bind: (...args) => {
        calls.push(args);
        return { run: async () => {} };
      },
    }),
  };
  const result = await recordSupporterGift(mockDb, {
    displayName: 'Alice B.',
    giftSeq: 1,
    sourceId: 'pi_test_789',
    campaign: 'provider-directory',
    email: 'alice@example.com',
    occurredAt: new Date().toISOString(),
  });
  assert.equal(result.recorded, true, 'should return recorded: true for giftSeq=1');
  assert.equal(calls.length, 1, 'db.prepare should be called exactly once');
});
