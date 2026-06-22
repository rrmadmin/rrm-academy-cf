import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toSnapshot } from '../../scripts/update-campaign-snapshot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const snap = JSON.parse(readFileSync(join(__dirname, '../../src/data/campaign-snapshot.json'), 'utf8'));

test('snapshot has a provider-directory entry with valid social-proof fields', () => {
  const pd = snap['provider-directory'];
  assert.ok(pd, 'provider-directory snapshot entry must exist');
  assert.ok(Number.isInteger(pd.raised_cents) && pd.raised_cents >= 0);
  assert.ok(Number.isInteger(pd.supporters) && pd.supporters >= 0);
  assert.ok(Number.isInteger(pd.total_gifts) && pd.total_gifts >= 0);
  assert.ok(Number.isInteger(pd.founding_left) && pd.founding_left >= 0);
  assert.equal(typeof pd.founding_closed, 'boolean');
  assert.ok(Array.isArray(pd.recent));
});

test('toSnapshot clamps negatives/non-numbers; no supporters arg => empty founding/recent', () => {
  assert.deepEqual(toSnapshot({ raised_cents: -5, supporters: 3 }),
    { raised_cents: 0, supporters: 3, recent: [], total_gifts: 0, founding_left: 100, founding_closed: false });
  assert.deepEqual(toSnapshot({ raised_cents: 'x', supporters: null }),
    { raised_cents: 0, supporters: 0, recent: [], total_gifts: 0, founding_left: 100, founding_closed: false });
  assert.deepEqual(toSnapshot({ raised_cents: 250000, supporters: 12 }),
    { raised_cents: 250000, supporters: 12, recent: [], total_gifts: 0, founding_left: 100, founding_closed: false });
});

test('toSnapshot merges supporters: caps recent to 8, drops junk rows, passes founding fields', () => {
  const supporters = {
    total_gifts: 14,
    founding_cap: 100,
    founding_left: 86,
    founding_closed: false,
    recent: [
      { displayName: 'Sarah M.', seq: 14 },
      { displayName: '   ', seq: 13 },
      { displayName: 'Cher', seq: 12 },
      ...Array.from({ length: 10 }, (_, i) => ({ displayName: `P${i}`, seq: i })),
    ],
  };
  const out = toSnapshot({ raised_cents: 700000, supporters: 14 }, supporters);
  assert.equal(out.total_gifts, 14);
  assert.equal(out.founding_left, 86);
  assert.equal(out.founding_closed, false);
  assert.ok(out.recent.length <= 8, 'recent capped to 8');
  assert.equal(out.recent[0].displayName, 'Sarah M.');
  assert.ok(out.recent.every((r) => typeof r.displayName === 'string' && r.displayName.trim()),
    'no empty/whitespace display names survive');
});

test('toSnapshot: founding_closed passes through; founding_left defaults to cap when absent', () => {
  const out = toSnapshot({ raised_cents: 0, supporters: 0 }, { founding_closed: true });
  assert.equal(out.founding_closed, true);
  assert.equal(out.founding_left, 100);
});
