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

test('recordSupporterGift rejects giftSeq=0 without writing (no #0 ghost)', async () => {
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
  assert.equal(result.recorded, false, 'should return recorded: false for giftSeq=0');
  assert.equal(calls.length, 0, 'db.prepare should not be called when giftSeq=0');
});

test('recordSupporterGift rejects negative giftSeq without writing', async () => {
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
  assert.equal(result.recorded, false, 'should return recorded: false for negative giftSeq');
  assert.equal(calls.length, 0, 'db.prepare should not be called when giftSeq is negative');
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
