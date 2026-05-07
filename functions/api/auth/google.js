/**
 * GET /api/auth/google
 * Redirects to Google OAuth consent screen.
 * Optional ?redirect= param to return user to a specific page after login.
 *
 * CSRF protection: a random nonce is minted, stored as an HttpOnly cookie
 * scoped to the callback path, and embedded in the state parameter as
 * "<nonce>:<base64-redirect>". google-callback.js verifies nonce matches
 * before accepting the authorization code (RFC 6749 §10.12).
 */
import { googleAuthUrl, isSafeRedirect, SITE_URL } from './_shared.js';

export async function onRequestGet({ env, request }) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response(null, { status: 302, headers: { Location: `${SITE_URL}/login/?error=oauth_unavailable` } });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get('redirect') || '/account/';
  const redirect = isSafeRedirect(raw) ? raw : '/account/';
  const redirectUri = `${SITE_URL}/api/auth/google-callback`;
  const authUrl = googleAuthUrl(env.GOOGLE_CLIENT_ID, redirectUri);

  // Mint a single-use nonce to bind the state parameter to this browser session.
  const nonce = crypto.randomUUID();
  const redirectB64 = btoa(redirect);
  const state = `${nonce}:${redirectB64}`;

  const target = `${authUrl}&state=${encodeURIComponent(state)}`;
  const escapedTarget = target.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // CF Pages _headers can convert 302 → 200, so include an HTML fallback
  // that performs the redirect via meta refresh + JS even if the status is wrong.
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${escapedTarget}"></head><body><script>window.location.href=${JSON.stringify(target)}</script></body></html>`;

  return new Response(html, {
    status: 302,
    headers: {
      Location: target,
      'Content-Type': 'text/html;charset=UTF-8',
      'Set-Cookie': `oauth_state=${nonce}; Path=/api/auth/google-callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
