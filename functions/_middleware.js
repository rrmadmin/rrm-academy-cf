/**
 * CF Pages Function middleware for RRM Academy.
 * Handles:
 * 1. Old slug redirects (slug without record ID → slug with record ID)
 * 2. Subdomain redirects (library.rrmacademy.org → rrmacademy.org/library)
 * 3. Auth protection for /account/* routes (redirect to /login if no session)
 */

import slugRedirects from './_slug-redirects.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 301 redirect: library.rrmacademy.org → rrmacademy.org/library
  if (url.hostname === 'library.rrmacademy.org') {
    return Response.redirect(
      `https://rrmacademy.org/library${url.pathname}`,
      301
    );
  }

  // 301 redirect: old library slugs without record ID → new slugs with record ID
  // New slugs end with -rec[14 chars], old ones don't
  const libraryMatch = url.pathname.match(/^\/library\/([^/]+)\/?$/);
  if (libraryMatch) {
    const slug = libraryMatch[1];
    // Only redirect if slug does NOT already have a record ID suffix
    if (!/rec[a-z0-9]{14}$/.test(slug)) {
      const newSlug = slugRedirects[slug];
      if (newSlug) {
        return Response.redirect(
          `https://rrmacademy.org/library/${newSlug}`,
          301
        );
      }
    }
  }

  // Auth protection: /account/* requires a valid session
  // The page itself does a client-side check, but this middleware provides
  // a server-side redirect for direct navigation (no JS needed)
  if (url.pathname.startsWith('/account') && env.DB) {
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
      return Response.redirect(`https://rrmacademy.org/login?redirect=${encodeURIComponent(url.pathname)}`, 302);
    }
  }

  // Continue to static assets / functions
  return context.next();
}
