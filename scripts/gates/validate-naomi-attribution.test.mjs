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

// Spec D49 (2026-05-14 patch): canonical glossary-style author-byline
// wrapper with nested <div> children must be allowlisted as a single unit.
// Previously the non-greedy regex stopped at the first </div> (the inner
// author-avatar-stack close), leaving the author-byline__text has-reviewer
// child with "Whittaker, MIGS, NFPMC" content exposed to the body grep.

test('D49: canonical author-byline wrapper (RRMA author + Whittaker reviewer) allowlisted', () => {
  const html = `<html><body>
    <div class="author-byline">
      <div class="author-avatar-stack">
        <img src="/apple-touch-icon.png" alt="" />
        <img src="/images/authors/naomi-whittaker.webp" alt="" />
      </div>
      <div class="author-byline__text has-reviewer">
        <span class="byline-author">By <strong>RRM Academy</strong></span>
        <span class="byline-reviewer">Reviewed by <strong><a href="/commentary/rrm-spotlight-naomi-whittaker-md/">Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI</a></strong></span>
      </div>
    </div>
    <article><h2>What is RRM?</h2><p>RRM diagnoses and treats the underlying causes of infertility.</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, true, r.error);
});

test('D49: canonical author-byline wrapper still fails if body contains Whittaker', () => {
  const html = `<html><body>
    <div class="author-byline">
      <div class="author-avatar-stack">
        <img src="/apple-touch-icon.png" alt="" />
      </div>
      <div class="author-byline__text has-reviewer">
        <span class="byline-author">By <strong>RRM Academy</strong></span>
        <span class="byline-reviewer">Reviewed by <strong>Dr. Naomi Whittaker, MD</strong></span>
      </div>
    </div>
    <article><p>As Dr. Whittaker has shown in her work...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Whittaker/);
});

test('D49: canonical author-byline wrapper still catches Whitaker (one-t) typo in body', () => {
  const html = `<html><body>
    <div class="author-byline">
      <div class="author-byline__text has-reviewer">
        <span class="byline-author">By <strong>RRM Academy</strong></span>
        <span class="byline-reviewer">Reviewed by <strong>Dr. Naomi Whittaker, MD, MIGS, NFPMC</strong></span>
      </div>
    </div>
    <article><p>As Dr. Whitaker noted in 2023...</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Whitaker/);
});

test('D49: two byline blocks (author-byline + legacy byline) both stripped', () => {
  const html = `<html><body>
    <div class="author-byline">
      <div class="author-byline__text has-reviewer">
        <span class="byline-author">By <strong>RRM Academy</strong></span>
        <span class="byline-reviewer">Reviewed by Dr. Naomi Whittaker, MD, MIGS</span>
      </div>
    </div>
    <div class="byline">Some other byline with Naomi name</div>
    <article><p>Clean body content here.</p></article>
  </body></html>`;
  const r = checkNaomiAttribution(html, { pillar: 'getting-started' });
  assert.equal(r.ok, true, r.error);
});
