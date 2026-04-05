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
    const sanitizedUrl = new URL(request.url);
    sanitizedUrl.searchParams.delete('token');
    sanitizedUrl.searchParams.delete('session_id');
    const payload = {
      client_id: clientId,
      events: [{
        name: 'page_view',
        params: {
          page_location: sanitizedUrl.href,
          page_referrer: request.headers.get('Referer') || '',
          engagement_time_msec: 1,
          ...sourceParams,
          ...(request.cf?.country && { geo_country: request.cf.country }),
          ...(request.cf?.regionCode && { geo_region: request.cf.regionCode }),
          ...(request.cf?.city && { geo_city: request.cf.city }),
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

  // Block search engine indexing of CF Pages preview domains
  if (url.hostname.endsWith('.pages.dev')) {
    const response = await context.next();
    const headers = new Headers(response.headers);
    headers.set('X-Robots-Tag', 'noindex');
    return new Response(response.body, { ...response, headers });
  }

  // Universal trailing-slash redirect for HTML pages.
  // CF Pages _headers /* rule corrupts ALL 3xx responses (static, _redirects,
  // AND function returns) into 200 with empty/mangled body. The only reliable
  // redirect is an HTML body with meta refresh + JS fallback.
  if (
    !url.pathname.endsWith('/') &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/cdn-cgi/') &&
    !url.pathname.includes('.')
  ) {
    context.waitUntil(sendPageView(request, env));
    const target = `${url.origin}${url.pathname}/${url.search}`;
    const escaped = target.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${escaped}"></head><body><script>window.location.href=${JSON.stringify(target)}</script></body></html>`;
    return new Response(html, {
      status: 301,
      headers: { Location: target, 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }

  // Fire GA4 page_view asynchronously — does not block the response.
  // Skip if this request is a redirect follow-up from our own trailing-slash redirect
  // (Referer would be same host with non-slash path) to avoid double-counting.
  {
    const referer = request.headers.get('Referer') || '';
    let isRedirectFollowUp = false;
    try {
      const refUrl = new URL(referer);
      if (refUrl.hostname === url.hostname && refUrl.pathname + '/' === url.pathname) {
        isRedirectFollowUp = true;
      }
    } catch {
      // ignore parse errors
    }
    if (!isRedirectFollowUp) {
      context.waitUntil(sendPageView(request, env));
    }
  }

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

  // Continue to static assets / functions, then inject security headers.
  // Security headers were previously in _headers /* catch-all, but that rule
  // corrupted CF Pages' internal 301 trailing-slash redirects into 200 with
  // empty body. Applying them here avoids that bug.
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://challenges.cloudflare.com https://embed.cloudflarestream.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com; frame-src https://challenges.cloudflare.com https://customer-99owhsi4yh33gohc.cloudflarestream.com; object-src 'none'; base-uri 'self'; form-action 'self'");
  }
  return new Response(response.body, { ...response, headers });
}
