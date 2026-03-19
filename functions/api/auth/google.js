/**
 * GET /api/auth/google
 * Redirects to Google OAuth consent screen.
 * Optional ?redirect= param to return user to a specific page after login.
 */
import { googleAuthUrl, isSafeRedirect, SITE_URL } from './_shared.js';

export async function onRequestGet({ env, request }) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response(null, { status: 302, headers: { Location: `${SITE_URL}/login?error=oauth_unavailable` } });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get('redirect') || '/account/';
  const redirect = isSafeRedirect(raw) ? raw : '/account/';
  const redirectUri = `${SITE_URL}/api/auth/google-callback`;
  const authUrl = googleAuthUrl(env.GOOGLE_CLIENT_ID, redirectUri);

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${authUrl}&state=${encodeURIComponent(redirect)}`,
    },
  });
}
