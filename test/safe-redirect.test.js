/**
 * Tests for the shared post-login redirect validator.
 * Run with: node --test test/safe-redirect.test.js
 *
 * The login and signup pages both run this exact function in the browser
 * (injected as window.rrmSafeRedirect from SAFE_REDIRECT_CLIENT_SRC), so what
 * passes here is what passes there.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeRedirect, REDIRECT_MAX_LEN, DEFAULT_REDIRECT, SAFE_REDIRECT_CLIENT_SRC } from '../src/lib/safe-redirect.js';

const ORIGIN = 'https://rrmacademy.org';

/** A realistic OAuth identity hop: 2048-char redirect_uri plus 512-char state inside a signed blob. */
function oauthIdentityRedirect(areqLen = 3700) {
  return `/api/account/oauth-identity?areq=${'A'.repeat(areqLen)}`;
}

describe('safeRedirect', () => {
  it('keeps a long OAuth identity hop with query characters intact', () => {
    const dest = oauthIdentityRedirect();
    assert.ok(dest.length > 3700 && dest.length < REDIRECT_MAX_LEN);
    assert.equal(safeRedirect(dest, ORIGIN), dest);
  });

  it('keeps a redirect carrying ? & = % and . characters verbatim', () => {
    const dest = '/api/account/oauth-identity?areq=a.b-c_d%2Fe&x=1&y=2';
    assert.equal(safeRedirect(dest, ORIGIN), dest);
  });

  it('rejects a protocol-relative host', () => {
    assert.equal(safeRedirect('//evil.example', ORIGIN), DEFAULT_REDIRECT);
    assert.equal(safeRedirect('//evil.example/path?x=1', ORIGIN), DEFAULT_REDIRECT);
  });

  it('rejects an absolute foreign URL', () => {
    assert.equal(safeRedirect('https://evil.example', ORIGIN), DEFAULT_REDIRECT);
    assert.equal(safeRedirect('http://evil.example/x', ORIGIN), DEFAULT_REDIRECT);
  });

  it('rejects a backslash-folded protocol-relative host', () => {
    assert.equal(safeRedirect('/\\evil', ORIGIN), DEFAULT_REDIRECT);
    assert.equal(safeRedirect('/\\evil.example/path', ORIGIN), DEFAULT_REDIRECT);
  });

  it('rejects a dot-segment collapse into a protocol-relative host', () => {
    assert.equal(safeRedirect('/.//evil.example', ORIGIN), DEFAULT_REDIRECT);
    assert.equal(safeRedirect('/..//evil.example', ORIGIN), DEFAULT_REDIRECT);
    assert.equal(safeRedirect('/a/..//evil.example', ORIGIN), DEFAULT_REDIRECT);
    assert.equal(safeRedirect('/%2e%2e//evil.example', ORIGIN), DEFAULT_REDIRECT);
    assert.equal(safeRedirect('/./\\evil.example', ORIGIN), DEFAULT_REDIRECT);
    assert.equal(safeRedirect('/.//evil.example?x=1#y', ORIGIN), DEFAULT_REDIRECT);
  });

  it('keeps an encoded dot-segment because the collapse never reaches the browser-decoded path', () => {
    assert.equal(safeRedirect('/%2e/%2fevil.example', ORIGIN), '/%2fevil.example/');
  });

  it('rejects an absolute same-origin URL because it does not start with a slash', () => {
    assert.equal(safeRedirect(`${ORIGIN}/account/`, ORIGIN), DEFAULT_REDIRECT);
  });

  it('accepts exactly the cap and rejects one character over it', () => {
    const atCap = '/a'.padEnd(REDIRECT_MAX_LEN, 'b');
    assert.equal(atCap.length, REDIRECT_MAX_LEN);
    assert.equal(safeRedirect(atCap, ORIGIN), atCap + '/');

    const overCap = '/a'.padEnd(REDIRECT_MAX_LEN + 1, 'b');
    assert.equal(overCap.length, REDIRECT_MAX_LEN + 1);
    assert.equal(safeRedirect(overCap, ORIGIN), DEFAULT_REDIRECT);
  });

  it('rejects an over-cap OAuth identity hop rather than truncating it', () => {
    assert.equal(safeRedirect(oauthIdentityRedirect(REDIRECT_MAX_LEN), ORIGIN), DEFAULT_REDIRECT);
  });

  it('falls back on an empty or absent value', () => {
    assert.equal(safeRedirect('', ORIGIN), DEFAULT_REDIRECT);
    assert.equal(safeRedirect(null, ORIGIN), DEFAULT_REDIRECT);
    assert.equal(safeRedirect(undefined, ORIGIN), DEFAULT_REDIRECT);
  });

  it('appends a trailing slash only when there is no query or hash', () => {
    assert.equal(safeRedirect('/courses', ORIGIN), '/courses/');
    assert.equal(safeRedirect('/courses/', ORIGIN), '/courses/');
    assert.equal(safeRedirect('/search?q=endo', ORIGIN), '/search?q=endo');
    assert.equal(safeRedirect('/page#top', ORIGIN), '/page#top');
  });
});

describe('SAFE_REDIRECT_CLIENT_SRC', () => {
  it('publishes the same function under a fixed global name', () => {
    assert.match(SAFE_REDIRECT_CLIENT_SRC, /^window\.rrmSafeRedirect = function/);
    const scope = { window: {} };
    new Function('window', SAFE_REDIRECT_CLIENT_SRC)(scope.window);
    assert.equal(typeof scope.window.rrmSafeRedirect, 'function');
    assert.equal(scope.window.rrmSafeRedirect(oauthIdentityRedirect(), ORIGIN), oauthIdentityRedirect());
    assert.equal(scope.window.rrmSafeRedirect('//evil.example', ORIGIN), DEFAULT_REDIRECT);
  });

  it('signup sets the Google button redirect for any validated non-default next, not only /ask', () => {
    const src = readFileSync(new URL('../src/pages/signup.astro', import.meta.url), 'utf8');
    const setterMatch = src.match(/if \(nextParam\) \{\s*\n\s*if \(googleBtn\) googleBtn\.setAttribute\('href', '\/api\/auth\/google\?redirect=' \+ encodeURIComponent\(nextParam\)\);\s*\n\s*\}/);
    assert.ok(setterMatch, 'expected an unconditional if (nextParam) block setting the Google button href');
    const askBlockStart = src.indexOf("nextParam === '/ask'");
    assert.ok(askBlockStart > setterMatch.index, 'the unconditional setter must run before the /ask-specific messaging block');
  });

  it('is the validator the login and signup pages actually load', () => {
    for (const page of ['src/pages/login.astro', 'src/pages/signup.astro']) {
      const src = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
      assert.ok(src.includes("import { SAFE_REDIRECT_CLIENT_SRC } from '../lib/safe-redirect.js';"), `${page} imports the validator`);
      assert.ok(src.includes('<script is:inline set:html={SAFE_REDIRECT_CLIENT_SRC}></script>'), `${page} injects the validator`);
      assert.ok(src.includes('window.rrmSafeRedirect('), `${page} calls the validator`);
      assert.ok(!/length > 500/.test(src), `${page} carries no stale 500 character cap`);
    }
  });
});
