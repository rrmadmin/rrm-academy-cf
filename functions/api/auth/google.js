/**
 * GET /api/auth/google
 * Redirects to Google OAuth consent screen.
 * Optional ?redirect= param to return user to a specific page after login.
 */
import { googleAuthUrl } from './_shared.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const redirect = url.searchParams.get('redirect') || '/account/';
  const redirectUri = `${url.origin}/api/auth/google-callback`;
  const authUrl = googleAuthUrl(env.GOOGLE_CLIENT_ID, redirectUri);

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${authUrl}&state=${encodeURIComponent(redirect)}`,
    },
  });
}
