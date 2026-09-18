/**
 * Regression tests for the magic-link token preservation bug.
 *
 * Two stacked bugs were stripping ?t=<HMAC> from /save-the-uterus-club/migrate
 * on the auth round-trip:
 *
 * 1. _middleware.js built authRedirect with encodeURIComponent(url.pathname)
 *    instead of url.pathname + url.search. Same bug existed in the isAdminPage branch.
 *
 * 2. src/pages/login.astro validated the redirect param with a path-only regex
 *    that rejected ? and =, falling back to /account/ silently.
 *
 * The login page's validation now lives in src/lib/safe-redirect.js, which the
 * page injects into its inline script, so the checks below read both files.
 *
 * These tests are static source-level checks that detect the exact patterns that
 * caused the regression, so they will catch any future reintroduction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const middleware = readFileSync(
  new URL('../functions/_middleware.js', import.meta.url),
  'utf8'
);

const loginPage = readFileSync(
  new URL('../src/pages/login.astro', import.meta.url),
  'utf8'
);

const validator = readFileSync(
  new URL('../src/lib/safe-redirect.js', import.meta.url),
  'utf8'
);

/** The page plus the validator it loads: the whole redirect path the browser runs. */
const login = loginPage + validator;

describe('middleware preserves URL search on auth redirect (fix UX bug)', () => {
  it('encodeURIComponent calls include url.search alongside pathname', () => {
    const matches = middleware.match(/encodeURIComponent\(url\.pathname[^)]*\)/g) || [];
    assert.ok(matches.length > 0, 'Expected at least one encodeURIComponent(url.pathname...) call');
    for (const m of matches) {
      assert.ok(
        m.includes('url.search'),
        `Auth redirect must preserve url.search to keep magic-link tokens. Found: ${m}`
      );
    }
  });

  it('no bare encodeURIComponent(url.pathname) without url.search exists anywhere in middleware', () => {
    const bareMatches = middleware.match(/encodeURIComponent\(\s*url\.pathname\s*\)/g) || [];
    assert.equal(
      bareMatches.length,
      0,
      `Found ${bareMatches.length} bare encodeURIComponent(url.pathname) call(s) that drop the query string: ${bareMatches.join(', ')}`
    );
  });
});

describe('login.astro redirect validation allows query strings', () => {
  it('does NOT use a path-only regex that rejects ?', () => {
    assert.ok(
      !/\/\^\\\/\[a-zA-Z0-9\\-_\\\/\]\*\$\//.test(login),
      'Path-only regex /^\\/[a-zA-Z0-9\\-_\\/]*$/ rejects URL search strings (?t=); use structural validation instead'
    );
  });

  it('does NOT contain the exact broken regex literal', () => {
    assert.ok(
      !login.includes('/^/[a-zA-Z0-9\\-_\\/]*$/') && !login.includes('/^\\/[a-zA-Z0-9\\-_\\/]*$/'),
      'login.astro still contains the path-only regex that strips ?t= from migration redirects'
    );
  });

  it('uses a structural check that allows query strings', () => {
    assert.ok(
      login.includes("charAt(0) !== '/'") || login.includes("charAt(0) === '/'"),
      'login.astro should use structural redirect validation (charAt check) not a path-only regex'
    );
  });

  it('loads the shared validator rather than a page-local copy', () => {
    assert.ok(
      loginPage.includes("import { SAFE_REDIRECT_CLIENT_SRC } from '../lib/safe-redirect.js';"),
      'login.astro must import the shared validator so the page and its tests cannot diverge'
    );
    assert.ok(
      loginPage.includes('window.rrmSafeRedirect('),
      'login.astro must call the shared validator for the post-login destination'
    );
  });
});
