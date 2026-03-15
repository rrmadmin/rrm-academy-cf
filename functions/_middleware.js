/**
 * CF Pages Function middleware for RRM Academy.
 * Handles:
 * 1. Subdomain redirects (library.rrmacademy.org → rrmacademy.org/library)
 * 2. Auth protection for /account/* and /community/* routes
 * 3. GA4 server-side page_view tracking (fire-and-forget via waitUntil)
 *
 * NOTE: Old library slug redirects are handled by the rrm-router Worker,
 * not here (avoids loading the 500KB redirect map on every request).
 */
import { getSessionIdFromCookie, validateSession, sessionCookie, roleAtLeast } from './api/auth/_shared.js';
import { buildSourceParams, getClientId } from './api/_ga4-source.js';

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/**
 * Fires a GA4 page_view hit via Measurement Protocol.
 * Called with ctx.waitUntil() so it never blocks the response.
 */
async function sendPageView(request, env) {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return;

  const url = new URL(request.url);

  // Only fire for HTML page requests — skip API routes and assets
  if (url.pathname.startsWith('/api/')) return;
  const accept = request.headers.get('Accept') || '';
  if (!accept.includes('text/html')) return;

  // Skip known bots -- they inflate page_view counts and pollute source data
  if (request.headers.get('cf-verified-bot') === 'true') return;

  try {
    const clientId = await getClientId(request);
    const sourceParams = await buildSourceParams(request, clientId);
    const payload = {
      client_id: clientId,
      events: [{
        name: 'page_view',
        params: {
          page_location: request.url,
          page_referrer: request.headers.get('Referer') || '',
          engagement_time_msec: 1,
          ...sourceParams,
        },
      }],
    };

    await fetch(
      `${GA4_ENDPOINT}?measurement_id=${env.GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
  } catch {
    // Silent — never let analytics failures affect the user
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Fire GA4 page_view asynchronously — does not block the response
  context.waitUntil(sendPageView(request, env));

  // 301 redirect: library.rrmacademy.org → rrmacademy.org/library
  if (url.hostname === 'library.rrmacademy.org') {
    const path = url.pathname.startsWith('/library') ? url.pathname : `/library${url.pathname}`;
    return Response.redirect(
      `https://rrmacademy.org${path}${url.search}`,
      301
    );
  }

  // Redirect mixed-case library URLs to lowercase (fixes old saved bookmarks)
  if (url.pathname.toLowerCase().startsWith('/library') && url.pathname !== url.pathname.toLowerCase()) {
    return Response.redirect(
      `${url.origin}${url.pathname.toLowerCase()}${url.search}`,
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

  // Admin pages: require session + superadmin role
  const isAdminPage = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
  if (isAdminPage) {
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

    // Check role
    const user = await env.DB.prepare('SELECT role FROM user WHERE id = ?')
      .bind(session.userId).first();
    if (!user || !roleAtLeast(user.role, 'superadmin')) {
      return new Response('Forbidden', { status: 403 });
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
