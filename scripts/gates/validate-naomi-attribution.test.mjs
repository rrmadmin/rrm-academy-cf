import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNaomiAttribution } from './validate-naomi-attribution.mjs';

test('patient pillar: byline area contains Naomi, body does not - pass', () => {
  const html = `<html><body>
    <div class="byline">Dr. Naomi Whittaker, MD</div>
    <article><h2>Section</h2><p>RRM is...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, true);
});

test('patient pillar: Naomi in body fails', () => {
  const html = `<html><body>
    <div class="byline">Dr. Naomi Whittaker, MD</div>
    <article><p>Dr. Whittaker has discussed...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, false);
  assert.match(r.error, /body prose contains Naomi attribution/);
});

test('patient pillar: Whitaker (one t) typo in body fails', () => {
  const html = `<html><body>
    <div class="byline">Dr. Naomi Whittaker, MD</div>
    <article><p>As Dr. Whitaker noted...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Whitaker/);
});

test('patient pillar: MIGS in body fails', () => {
  const html = `<html><body>
    <div class="byline">Dr. Naomi Whittaker, MD, MIGS</div>
    <article><p>Per MIGS guidelines...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, false);
});

test('patient pillar: ORCID in body fails', () => {
  const html = `<html><body>
    <div class="byline">Dr. Whittaker</div>
    <article><p>See 0000-0003-3706-3112 for...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, false);
});

test('provider pillar: same rules apply', () => {
  const html = `<html><body>
    <div class="byline">Dr. Naomi Whittaker</div>
    <article><p>Dr. Whittaker recommends...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'for-providers' });
  assert.equal(r.ok, false);
});
