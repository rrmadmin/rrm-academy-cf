/**
 * CF Pages Function middleware for RRM Library.
 * Handles:
 * 1. Old Wix URL redirects (slug-recordid → slug)
 * 2. Subdomain redirects (library.rrmacademy.org → rrmacademy.org/library)
 */

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 301 redirect: library.rrmacademy.org → rrmacademy.org/library
  if (url.hostname === 'library.rrmacademy.org') {
    return Response.redirect(
      `https://rrmacademy.org/library${url.pathname}`,
      301
    );
  }

  // Check for old Wix URL pattern: /library/{slug}-{recordId}
  // Record IDs are always rec + 14 alphanumeric chars
  const oldPattern = url.pathname.match(/^\/library\/(.+)-(rec[a-zA-Z0-9]{14})$/);
  if (oldPattern) {
    return Response.redirect(
      `https://rrmacademy.org/library/${oldPattern[1]}`,
      301
    );
  }

  // Continue to static assets
  return context.next();
}
