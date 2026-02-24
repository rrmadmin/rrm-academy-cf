/**
 * CF Pages Function middleware for RRM Academy.
 * Handles:
 * 1. Subdomain redirects (library.rrmacademy.org → rrmacademy.org/library)
 * 2. Auth protection for /account/* routes (redirect to /login if no session)
 *
 * NOTE: Old library slug redirects are handled by the rrm-router Worker,
 * not here (avoids loading the 500KB redirect map on every request).
 */

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

  // Auth protection: /account/* requires a valid session
  // The page itself does a client-side check, but this middleware provides
  // a server-side redirect for direct navigation (no JS needed)
  if (url.pathname === '/account' || url.pathname.startsWith('/account/')) {
    if (!env.DB) {
      return new Response('Service Unavailable', { status: 503 });
    }
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
    const sessionId = match ? match[1] : null;

    if (!sessionId) {
      return Response.redirect(`https://rrmacademy.org/login?redirect=${encodeURIComponent(url.pathname)}`, 302);
    }

    // Validate session exists and hasn't expired
    const session = await env.DB.prepare('SELECT expires_at FROM session WHERE id = ?')
      .bind(sessionId).first();
    const now = Math.floor(Date.now() / 1000);
    if (!session || now >= session.expires_at) {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `https://rrmacademy.org/login?redirect=${encodeURIComponent(url.pathname)}`,
          'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        },
      });
    }
  }

  // Continue to static assets / functions
  return context.next();
}
