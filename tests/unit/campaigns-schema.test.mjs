import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const campaigns = JSON.parse(
  readFileSync(join(__dirname, '../../src/data/campaigns.json'), 'utf8')
);

test('campaigns.json is a non-empty array', () => {
  assert.ok(Array.isArray(campaigns));
  assert.ok(campaigns.length > 0);
});

test('every campaign has required fields with valid types', () => {
  for (const c of campaigns) {
    assert.equal(typeof c.id, 'string');
    assert.match(c.campaign_key, /^[a-z0-9-]+$/);
    assert.ok(c.campaign_key.length <= 64);
    assert.equal(typeof c.goal_cents, 'number');
    assert.ok(c.goal_cents > 0, `goal_cents must be positive for ${c.id}`);
    assert.equal(typeof c.cta_href, 'string');
    assert.ok(c.cta_href.length > 0);
    assert.equal(typeof c.headline, 'string');
    assert.ok(c.headline.length > 0);
  }
});

test('provider-directory campaign exists with canonical goal + cta', () => {
  const pd = campaigns.find((c) => c.id === 'provider-directory');
  assert.ok(pd, 'provider-directory campaign must exist');
  assert.equal(pd.goal_cents, 1000000);
  assert.equal(pd.cta_href, '/providers/#give');
  assert.equal(pd.campaign_key, 'provider-directory');
});

test('no campaign copy uses launch-commitment language (spec §6)', () => {
  const banned = /\b(is coming|will launch|launches once|coming soon)\b/i;
  for (const c of campaigns) {
    for (const field of ['eyebrow', 'headline', 'one_liner', 'cta_label']) {
      assert.ok(!banned.test(c[field] || ''), `${c.id}.${field} uses banned launch language`);
    }
  }
});
