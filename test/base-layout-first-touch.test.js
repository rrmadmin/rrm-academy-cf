/**
 * Extraction test for the rrm_ft first-touch cookie writer inside
 * src/layouts/BaseLayout.astro's GPC-guarded inline script (section 3.1 of
 * docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md).
 *
 * No test in this repo previously exercised a BaseLayout inline script.
 * This extracts the raw script text between the two <script is:inline>
 * markers that contain 'rrm_ft', wraps it in a fake document/location/
 * navigator, and runs it in a vm context -- the same node:vm approach
 * test/word-count-parity.test.js uses for a worker-repo function, adapted
 * to a DOM-shaped sandbox instead of a plain function extraction.
 *
 * Run: node --test test/base-layout-first-touch.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');

function extractInlineScript(marker) {
  const scripts = SOURCE.split('<script is:inline>').slice(1);
  const match = scripts.find((s) => s.includes(marker));
  if (!match) throw new Error(`no <script is:inline> block contains "${marker}"`);
  return match.slice(0, match.indexOf('</script>'));
}

const SCRIPT = extractInlineScript('rrm_ft');

/**
 * Builds a minimal fake DOM. `cookieStore` is a live array of "name=value"
 * strings; document.cookie getter joins them with '; ', matching the real
 * DOM, and the setter appends/overwrites by cookie name (ignoring
 * attributes after the first ';', which is what a real browser does too).
 */
function runScript({ search = '', referrer = '', pathname = '/', gpc = undefined, existingCookies = [], now = 1757030400000 } = {}) {
  const cookieStore = [...existingCookies];
  const sandbox = {
    console,
    Date: { now: () => now },
    Math,
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    navigator: { globalPrivacyControl: gpc },
    document: {
      referrer,
      get cookie() { return cookieStore.join('; '); },
      set cookie(raw) {
        const name = raw.slice(0, raw.indexOf('='));
        const idx = cookieStore.findIndex((c) => c.startsWith(name + '='));
        const bare = raw.split(';')[0];
        if (idx === -1) cookieStore.push(bare);
        else cookieStore[idx] = bare;
      },
    },
    location: { search, pathname, href: 'https://rrmacademy.org' + pathname + search },
  };
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox);
  return { cookieStore, sandbox };
}

function ftValue(cookieStore) {
  const row = cookieStore.find((c) => c.startsWith('rrm_ft='));
  return row ? decodeURIComponent(row.slice('rrm_ft='.length)) : null;
}

describe('BaseLayout inline script -- rrm_ft first-touch cookie', () => {
  it('is written once, from utm params', () => {
    const { cookieStore } = runScript({ search: '?utm_source=newsletter&utm_medium=email_automation&utm_campaign=fall' });
    const raw = cookieStore.find((c) => c.startsWith('rrm_ft='));
    assert.ok(raw, 'rrm_ft cookie was not written');
    assert.match(raw, /s=newsletter/);
    assert.match(raw, /m=email_automation/);
    assert.match(raw, /c=fall/);
  });

  it('a second visit with a new utm does not overwrite the existing cookie', () => {
    const { cookieStore } = runScript({
      search: '?utm_source=google&utm_medium=cpc&utm_campaign=new_push',
      existingCookies: ['rrm_ft=s%3Doriginal%26m%3Dorganic'],
    });
    const raw = cookieStore.find((c) => c.startsWith('rrm_ft='));
    assert.equal(decodeURIComponent(raw.slice('rrm_ft='.length)), 's=original&m=organic');
  });

  it('GPC true skips the write entirely', () => {
    const { cookieStore } = runScript({ search: '?utm_source=google&utm_medium=cpc', gpc: true });
    assert.equal(cookieStore.find((c) => c.startsWith('rrm_ft=')), undefined);
  });

  it('an email-shaped utm_term is written empty, not blocking the rest of the cookie', () => {
    const { cookieStore } = runScript({ search: '?utm_source=newsletter&utm_term=someone%40example.com' });
    const raw = decodeURIComponent(cookieStore.find((c) => c.startsWith('rrm_ft=')).slice('rrm_ft='.length));
    assert.ok(!raw.includes('t='), 'the t field must be omitted (screened empty), not carry the email');
    assert.match(raw, /s=newsletter/);
  });

  it('a bare 13-19 digit run utm_term is written empty, not blocking the rest of the cookie', () => {
    const { cookieStore } = runScript({ search: '?utm_source=newsletter&utm_term=4111111111111111' });
    const raw = decodeURIComponent(cookieStore.find((c) => c.startsWith('rrm_ft=')).slice('rrm_ft='.length));
    assert.ok(!raw.includes('t='), 'the t field must be omitted (screened empty), not carry the digit run');
    assert.match(raw, /s=newsletter/);
  });

  it('a click id over 512 chars aborts the whole cookie, not a truncated field', () => {
    // A plain-ASCII filler (e.g. 'A') never crosses 1KB here: the g field's
    // own 512-char cap plus the other short fields tops out well under the
    // limit, so the abort would never fire and the test would be vacuous.
    // '"' needs 3x expansion under encodeURIComponent (%22), which is what
    // pushes even the capped 512-char field over the 1KB total once encoded
    // -- exercising the abort-on-overflow path, not a per-field truncation.
    const longGclid = '"'.repeat(600);
    const { cookieStore } = runScript({ search: `?gclid=${longGclid}` });
    assert.equal(cookieStore.find((c) => c.startsWith('rrm_ft=')), undefined);
  });

  it('a cookie that would exceed 1KB total writes nothing', () => {
    // Same reasoning as above: plain 'x' fillers at the 100-char per-field
    // cap sum to ~940 encoded chars (under 1024), so they would not
    // actually exercise the abort path. '"' triples under encodeURIComponent
    // and reliably crosses the 1KB total across the five UTM fields plus a
    // maxed-out click id.
    const longUtm = '"'.repeat(100);
    const { cookieStore } = runScript({
      search: `?utm_source=${longUtm}&utm_medium=${longUtm}&utm_campaign=${longUtm}&utm_content=${longUtm}&utm_term=${longUtm}&gclid=${'g'.repeat(500)}`,
    });
    assert.equal(cookieStore.find((c) => c.startsWith('rrm_ft=')), undefined);
  });

  it('seeds g from a legacy gclid cookie on the first write when the URL carries no click id', () => {
    const { cookieStore } = runScript({
      search: '?utm_source=newsletter',
      existingCookies: ['gclid=EAIaIQlegacy123456'],
    });
    const raw = decodeURIComponent(cookieStore.find((c) => c.startsWith('rrm_ft=')).slice('rrm_ft='.length));
    assert.match(raw, /g=gEAIaIQlegacy123456/, 'g must carry the g-kind marker plus the legacy gclid value');
  });

  it('a click id in the URL forces medium cpc and beats a coexisting utm_medium', () => {
    const { cookieStore } = runScript({ search: '?utm_source=google&utm_medium=display&gclid=abc123456789' });
    const raw = decodeURIComponent(cookieStore.find((c) => c.startsWith('rrm_ft=')).slice('rrm_ft='.length));
    assert.match(raw, /m=cpc/);
  });

  it('a second ad click overwrites the 30-day gclid cookie while rrm_ft (first touch) stays unchanged', () => {
    // This script only writes rrm_ft; the 30-day gclid cookie write lives in
    // a separate script block in BaseLayout.astro (unchanged by this plan).
    // What this test pins is the OTHER half of the guarantee: running the
    // rrm_ft writer again, on a session that already has an rrm_ft cookie
    // from an earlier ad click, must not touch it even though a fresh
    // gclid is present in the URL and in the (separately maintained)
    // gclid cookie.
    const { cookieStore } = runScript({
      search: '?gclid=SECOND_CLICK_ID_67890',
      existingCookies: [
        'rrm_ft=' + encodeURIComponent('s=google&m=cpc&g=gFIRST_CLICK_ID_12345&d=1757030400'),
        'gclid=FIRST_CLICK_ID_12345',
      ],
    });
    const raw = decodeURIComponent(cookieStore.find((c) => c.startsWith('rrm_ft=')).slice('rrm_ft='.length));
    assert.match(raw, /g=gFIRST_CLICK_ID_12345/, 'rrm_ft keeps the FIRST click id, not the second');
  });
});
