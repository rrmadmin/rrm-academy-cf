import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toSnapshot } from '../../scripts/update-campaign-snapshot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const snap = JSON.parse(readFileSync(join(__dirname, '../../src/data/campaign-snapshot.json'), 'utf8'));

test('snapshot has a provider-directory entry with non-negative integer fields', () => {
  const pd = snap['provider-directory'];
  assert.ok(pd, 'provider-directory snapshot entry must exist');
  assert.ok(Number.isInteger(pd.raised_cents) && pd.raised_cents >= 0);
  assert.ok(Number.isInteger(pd.supporters) && pd.supporters >= 0);
});

test('toSnapshot clamps negatives and coerces non-numbers to 0', () => {
  assert.deepEqual(toSnapshot({ raised_cents: -5, supporters: 3 }), { raised_cents: 0, supporters: 3 });
  assert.deepEqual(toSnapshot({ raised_cents: 'x', supporters: null }), { raised_cents: 0, supporters: 0 });
  assert.deepEqual(toSnapshot({ raised_cents: 250000, supporters: 12 }), { raised_cents: 250000, supporters: 12 });
});
