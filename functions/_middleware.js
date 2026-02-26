/**
 * CF Pages Function middleware for RRM Academy.
 * Handles:
 * 1. Subdomain redirects (library.rrmacademy.org → rrmacademy.org/library)
 * 2. Auth protection for /account/* routes (redirect to /login if no session)
 *
 * NOTE: Old library slug redirects are handled by the rrm-router Worker,
 * not here (avoids loading the 500KB redirect map on every request).
 */
import { getSessionIdFromCookie, validateSession, sessionCookie } from './api/auth/_shared.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 301 redirect: library.rrmacademy.org → rrmacademy.org/library
  if (url.hostname === 'library.rrmacademy.org') {
    const path = url.pathname.startsWith('/library') ? url.pathname : `/library${url.pathname}`;
    return Response.redirect(
      `https://rrmacademy.org${path}${url.search}`,
      301
    );
  }

  const needsAuth =
    url.pathname === '/account' || url.pathname.startsWith('/account/') ||
    url.pathname === '/community' || url.pathname.startsWith('/community/');

  if (needsAuth) {
    if (!env.DB) {
      return new Response('Service Unavailable', { status: 503 });
    }
    const sessionId = getSessionIdFromCookie(request);

    if (!sessionId) {
      return Response.redirect(`https://rrmacademy.org/login/?redirect=${encodeURIComponent(url.pathname)}`, 302);
    }

    const session = await validateSession(env.DB, sessionId);
    if (!session) {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `https://rrmacademy.org/login/?redirect=${encodeURIComponent(url.pathname)}`,
          'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        },
      });
    }

    const response = await context.next();
    if (session.renewed) {
      const newResponse = new Response(response.body, response);
      newResponse.headers.append('Set-Cookie', sessionCookie(session.id, session.expiresAt));
      return newResponse;
    }
    return response;
  }

  // Continue to static assets / functions
  return context.next();
}
