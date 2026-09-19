/**
 * Post-login redirect validation, shared by the login and signup pages.
 *
 * Safety comes from the origin and leading-slash checks, never from the
 * length: a value must resolve to this same origin AND start with a single
 * `/`, which rejects `//evil.example`, `/\evil` (the URL parser folds `\`
 * into `/`, so it parses as protocol-relative) and any absolute URL. The
 * length cap exists only to keep an absurd value out of a Location header.
 *
 * The cap is 4096 because the OAuth identity hop
 * (`/api/account/oauth-identity?areq=<signed blob>`) legitimately reaches
 * about 3.8 KB when a client registers a 2048-character redirect_uri and
 * sends a 512-character state. The previous 500 cap silently rewrote every
 * real OAuth sign-in to /account/ and killed the flow.
 *
 * The same function runs in the browser: `SAFE_REDIRECT_CLIENT_SRC` is the
 * function's own source, injected into the login and signup inline scripts as
 * `window.rrmSafeRedirect`, so page and test can never diverge.
 */

/** Maximum accepted redirect length, in characters. Pinned by test. */
export const REDIRECT_MAX_LEN = 4096;

/** Where an absent or rejected redirect lands. */
export const DEFAULT_REDIRECT = '/account/';

/**
 * @param {string} raw - the candidate redirect, normally a query parameter
 * @param {string} origin - the current origin, e.g. https://rrmacademy.org
 * @returns {string} a same-origin path+query+hash, or DEFAULT_REDIRECT
 */
export function safeRedirect(raw, origin) {
  var MAX = 4096;
  var FALLBACK = '/account/';
  var dest = raw || FALLBACK;
  try {
    var u = new URL(dest, origin);
    if (u.origin !== origin || dest.charAt(0) !== '/' || dest.length > MAX) dest = FALLBACK;
    else {
      dest = u.pathname + u.search + u.hash;
      if (dest.charAt(0) !== '/' || dest.charAt(1) === '/' || dest.charAt(1) === '\\') dest = FALLBACK;
    }
  } catch (e) {
    dest = FALLBACK;
  }
  if (dest.length > 1 && dest.charAt(dest.length - 1) !== '/' && dest.indexOf('?') === -1 && dest.indexOf('#') === -1) {
    dest += '/';
  }
  return dest;
}

/**
 * Browser copy of the validator, published under a fixed global name so a
 * minifier renaming the function identifier cannot break the call sites.
 */
export const SAFE_REDIRECT_CLIENT_SRC = `window.rrmSafeRedirect = ${safeRedirect.toString()};`;
