/**
 * Regression test for the dot-segment open redirect on /login and /next on
 * /signup.
 *
 * `?redirect=/.//evil.example` (also `/..//evil.example`, `/a/..//evil.example`,
 * `/%2e%2e//evil.example`, `/./\evil.example`) passed the old checks (same
 * origin, single leading slash) because the checks ran on the INPUT string
 * while the value actually used was the REBUILT `u.pathname + u.search +
 * u.hash`, and WHATWG URL parsing collapses dot segments so the rebuild came
 * out as `//evil.example` -- a protocol-relative URL that
 * `window.location.href` treats as cross-origin.
 *
 * These tests extract the real validation block out of the page source with
 * a regex and execute it in a `new Function` harness, so they exercise the
 * actual logic (not a reimplementation of it) and fail on the pre-fix
 * source.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ORIGIN = 'https://rrmacademy.org';

const OPEN_REDIRECT_VECTORS = [
  '/.//evil.example',
  '/..//evil.example',
  '/a/..//evil.example',
  '/%2e%2e//evil.example',
  '/./\\evil.example',
  '//evil.example',
  '/\\evil.example',
  'https://evil.example/',
  '/\t/evil.example',
  'javascript:alert(1)',
];

const KEEP_VECTORS = ['/account/', '/ask/?q=x', '/courses/abc/#part'];

function extractLoginValidator(source) {
  const match = source.match(
    /try \{\s*var u = new URL\(dest, window\.location\.origin\);[\s\S]*?\} catch \(e\) \{ dest = '\/account\/'; \}/
  );
  if (!match) throw new Error('login.astro redirect-validation block not found (source shape changed)');
  return match[0];
}

function runLoginValidator(source, dest) {
  const block = extractLoginValidator(source);
  const fn = new Function('dest', 'window', `${block}\nreturn dest;`);
  return fn(dest, { location: { origin: ORIGIN } });
}

function extractSignupValidator(source) {
  const match = source.match(
    /var nextParam = '';\s*try \{[\s\S]*?\} catch \(_\) \{\}/
  );
  if (!match) throw new Error('signup.astro next-param validation block not found (source shape changed)');
  return match[0];
}

function runSignupValidator(source, rawNext) {
  const block = extractSignupValidator(source);
  const fn = new Function('window', `${block}\nreturn nextParam;`);
  return fn({
    location: {
      origin: ORIGIN,
      search: '?next=' + encodeURIComponent(rawNext),
    },
  });
}

const login = readFileSync(new URL('../src/pages/login.astro', import.meta.url), 'utf8');
const signup = readFileSync(new URL('../src/pages/signup.astro', import.meta.url), 'utf8');

describe('login.astro post-login redirect rejects a rebuilt //host result', () => {
  for (const vector of OPEN_REDIRECT_VECTORS) {
    it(`falls back to /account/ for redirect=${JSON.stringify(vector)}`, () => {
      const result = runLoginValidator(login, vector);
      assert.equal(result, '/account/', `Expected /account/ fallback, got ${JSON.stringify(result)}`);
    });
  }

  for (const vector of KEEP_VECTORS) {
    it(`keeps a legitimate same-origin path ${JSON.stringify(vector)}`, () => {
      const result = runLoginValidator(login, vector);
      assert.equal(result, vector);
    });
  }
});

describe('signup.astro ?next= param rejects a rebuilt //host result', () => {
  for (const vector of OPEN_REDIRECT_VECTORS) {
    it(`leaves nextParam empty for next=${JSON.stringify(vector)}`, () => {
      const result = runSignupValidator(signup, vector);
      assert.equal(result, '', `Expected empty nextParam, got ${JSON.stringify(result)}`);
    });
  }

  for (const vector of KEEP_VECTORS) {
    it(`keeps a legitimate same-origin path ${JSON.stringify(vector)}`, () => {
      const result = runSignupValidator(signup, vector);
      assert.equal(result, vector);
    });
  }
});
