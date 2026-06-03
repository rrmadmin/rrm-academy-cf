/**
 * CF Pages Function middleware for RRM Academy.
 * Handles:
 * 1. Subdomain redirects (library.rrmacademy.org -> rrmacademy.org/library)
 * 2. Auth protection for /account/* and /community/* routes
 * 3. GA4 server-side page_view tracking (fire-and-forget via waitUntil)
 * 4. Arrivl AI bot analytics (fire-and-forget via waitUntil)
 *
 * NOTE: Old library slug redirects are handled by the rrm-router Worker,
 * not here (avoids loading the 500KB redirect map on every request).
 */
import { getSessionIdFromCookie, validateSession, sessionCookie, authHintCookie, clearAuthHintCookie, roleAtLeast } from './api/auth/_shared.js';
import { buildSourceParams, getClientId } from './api/_ga4-source.js';

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const ARRIVL_ENDPOINT = 'https://arrivl.ai/api/v1/intake/pageview';

const AI_BOTS = [
  { name: 'GPTBot',              pattern: 'gptbot' },
  { name: 'OAI-SearchBot',       pattern: 'oai-searchbot' },
  { name: 'ChatGPT-User',        pattern: 'chatgpt-user' },
  { name: 'ClaudeBot',           pattern: 'claudebot' },
  { name: 'Claude-User',         pattern: 'claude-user' },
  { name: 'Claude-SearchBot',    pattern: 'claude-searchbot' },
  { name: 'anthropic-ai',        pattern: 'anthropic-ai' },
  { name: 'PerplexityBot',       pattern: 'perplexitybot' },
  { name: 'Perplexity-User',     pattern: 'perplexity-user' },
  { name: 'Google-Extended',     pattern: 'google-extended' },
  { name: 'GoogleOther',         pattern: 'googleother' },
  { name: 'Applebot-Extended',   pattern: 'applebot-extended' },
  { name: 'Bytespider',          pattern: 'bytespider' },
  { name: 'CCBot',               pattern: 'ccbot' },
  { name: 'cohere-ai',           pattern: 'cohere-ai' },
  { name: 'FacebookBot',         pattern: 'facebookbot' },
  { name: 'Meta-ExternalAgent',  pattern: 'meta-externalagent' },
  { name: 'DuckAssistBot',       pattern: 'duckassistbot' },
  { name: 'YouBot',              pattern: 'youbot' },
  { name: 'MistralAI-User',      pattern: 'mistralai-user' },
  { name: 'Diffbot',             pattern: 'diffbot' },
  { name: 'PetalBot',            pattern: 'petalbot' },
];

function detectAiBot(userAgent) {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  for (const bot of AI_BOTS) {
    if (ua.includes(bot.pattern)) return bot.name;
  }
  return null;
}

const CSP_VALUE = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://challenges.cloudflare.com https://embed.cloudflarestream.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self' https://fp.rrmacademy.org https://challenges.cloudflare.com https://cloudflareinsights.com; frame-src https://challenges.cloudflare.com https://customer-99owhsi4yh33gohc.cloudflarestream.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests";

/**
 * Inject the standard 6 security headers onto any Response. Returns a new
 * Response so callers can use it as a drop-in wrapper around redirects,
 * early-return errors, and renewed-session responses. Clones headers so the
 * original response's Headers object is never mutated.
 */
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Signal', 'ai-train=yes, search=yes, ai-input=yes');
  if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', CSP_VALUE);
  }
  const ct = headers.get('content-type') || '';
  if (ct.startsWith('text/html')) {
    headers.append('Link', '</sitemap-index.xml>; rel="sitemap"; type="application/xml", </llms.txt>; rel="describedby"; type="text/plain", </openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json;version=3.1", </.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Fires a GA4 page_view hit via Measurement Protocol.
 * Called with ctx.waitUntil() so it never blocks the response.
 */
async function sendPageView(request, env) {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return;

  const url = new URL(request.url);
  if (url.hostname === 'library.rrmacademy.org') return;

  // Only fire for HTML page requests -- skip API routes and assets
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
    // Silent -- never let analytics failures affect the user
  }
}

/**
 * Fires an Arrivl pageview hit (AI bot analytics).
 * Called with ctx.waitUntil() so it never blocks the response.
 */
async function sendArrivlPageview(request, env) {
  if (!env.ARRIVL_WEBSITE_KEY) return;

  const url = new URL(request.url);
  if (url.hostname === 'library.rrmacademy.org') return;
  if (url.pathname.startsWith('/api/')) return;
  const accept = request.headers.get('Accept') || '';
  if (!accept.includes('text/html')) return;

  const xff = request.headers.get('x-forwarded-for') || '';
  const ip = xff.split(',')[0].trim() || request.headers.get('cf-connecting-ip') || '';

  const params = new URLSearchParams({
    url: request.url,
    userAgent: request.headers.get('User-Agent') || '',
    ref: request.headers.get('Referer') || '',
    ip,
    websiteKey: env.ARRIVL_WEBSITE_KEY,
  });

  try {
    await fetch(`${ARRIVL_ENDPOINT}?${params}`, { method: 'GET' });
  } catch {
    // Silent -- never let analytics failures affect the user
  }
}

/**
 * Fires an Analytics Engine data point when an AI bot crawls an HTML page.
 * Called with ctx.waitUntil() so it never blocks the response.
 */
async function sendAiBotEvent(request, env) {
  const ua = request.headers.get('User-Agent') || '';
  const botName = detectAiBot(ua);
  if (!botName) return;

  const url = new URL(request.url);
  if (url.hostname === 'library.rrmacademy.org') return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/cdn-cgi' || url.pathname.startsWith('/cdn-cgi/')) return;
  if (url.pathname === '/og' || url.pathname.startsWith('/og/')) return;
  const isHighSignalCrawl = (
    url.pathname === '/robots.txt' ||
    url.pathname === '/sitemap.xml' ||
    url.pathname.startsWith('/sitemap-')
  );
  if (!isHighSignalCrawl && /\.[a-z0-9]{1,10}$/i.test(url.pathname)) return;

  const lowerPath = url.pathname.toLowerCase();
  // Mirror the auth carve-out: the now-public STUC hub + Action Area pages should get
  // crawl analytics; the still-gated community sub-paths stay suppressed.
  const isPublicCommunityCrawl =
    lowerPath === '/community' ||
    lowerPath === '/community/' ||
    lowerPath === '/community/areas' ||
    lowerPath.startsWith('/community/areas/');
  if (
    lowerPath === '/account' || lowerPath.startsWith('/account/') ||
    ((lowerPath === '/community' || lowerPath.startsWith('/community/')) && !isPublicCommunityCrawl) ||
    lowerPath === '/ask' || lowerPath.startsWith('/ask/') ||
    lowerPath.startsWith('/save-the-uterus-club/migrate')
  ) return;

  try {
    env.EVENTS?.writeDataPoint({
      blobs: [
        'ai-bot',
        botName,
        url.pathname.slice(0, 256),
        request.cf?.country || 'XX',
        (request.headers.get('Referer') || '').slice(0, 1024),
      ],
      doubles: [1],
      indexes: [botName],
    });
  } catch {
    // Silent -- never let analytics failures affect the user
  }
}

function htmlRedirect(location) {
  const escaped = location.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${escaped}"></head><body><script>window.location.href=${JSON.stringify(location).replace(/</g, '\\u003c')}</script></body></html>`;
  return new Response(html, {
    status: 302,
    headers: { Location: location, 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

function htmlRedirectWithCookies(location, cookies) {
  const escaped = location.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${escaped}"></head><body><script>window.location.href=${JSON.stringify(location).replace(/</g, '\\u003c')}</script></body></html>`;
  const headers = new Headers({ Location: location, 'Content-Type': 'text/html;charset=UTF-8' });
  for (const cookie of cookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(html, { status: 302, headers });
}

const CASE_CANONICAL_PREFIXES = [
  '/library',
];

function shouldCanonicalize(pathname) {
  const lower = pathname.toLowerCase();
  return CASE_CANONICAL_PREFIXES.some(p => lower.startsWith(p)) && lower !== pathname;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Pre-fetch feature:search_v2 flag only for the routes that consume it.
  // Reading KV on every asset request (~30x per HTML pageview) is wasteful.
  // Fail-closed to 'off' on any error -- the flag must NEVER fail-open to v2.
  context.data = context.data || {};
  const flagNeedsFetch = url.pathname === '/api/ask' || url.pathname.startsWith('/api/ask/') || url.pathname === '/api/search/semantic';
  if (flagNeedsFetch && env.COMMUNITY_KV) {
    try {
      const flagVal = await env.COMMUNITY_KV.get('feature:search_v2');
      const valid = ['off', 'admin', 'all'];
      context.data.searchV2 = valid.includes(flagVal) ? flagVal : 'off';
    } catch {
      context.data.searchV2 = 'off';
    }
  } else {
    context.data.searchV2 = 'off';
  }

  // Block search engine indexing of CF Pages preview domains
  if (url.hostname.endsWith('.pages.dev')) {
    const response = await context.next();
    const headers = new Headers(response.headers);
    headers.set('X-Robots-Tag', 'noindex');
    return withSecurityHeaders(new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }));
  }

  // Fire GA4, Arrivl, and AI-bot analytics asynchronously -- does not block the response.
  context.waitUntil(
    Promise.all([
      sendPageView(request, env).catch(() => {}),
      sendArrivlPageview(request, env).catch(() => {}),
      sendAiBotEvent(request, env).catch(() => {}),
    ])
  );

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
    const target = `${url.origin}${url.pathname}/${url.search}`;
    const escaped = target.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    // Escape `<` to `<` in the JSON-encoded URL so a `</script>` substring
    // can't close the inline script tag (XSS sink; JSON.stringify escapes `"`
    // and `\` but NOT `<`).
    const html = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${escaped}"></head><body><script>window.location.href=${JSON.stringify(target).replace(/</g, '\\u003c')}</script></body></html>`;
    return withSecurityHeaders(new Response(html, {
      status: 301,
      headers: { Location: target, 'Content-Type': 'text/html;charset=UTF-8' },
    }));
  }

  // 301 redirect: library.rrmacademy.org -> rrmacademy.org/library
  if (url.hostname === 'library.rrmacademy.org') {
    const path = url.pathname.startsWith('/library') ? url.pathname : `/library${url.pathname}`;
    return withSecurityHeaders(Response.redirect(
      `https://rrmacademy.org${path}${url.search}`,
      301
    ));
  }

  // Redirect mixed-case URLs to lowercase for all canonical prefixes
  if (shouldCanonicalize(url.pathname)) {
    return withSecurityHeaders(Response.redirect(
      `${url.origin}${url.pathname.toLowerCase()}${url.search}`,
      301
    ));
  }

  const pathnameLower = url.pathname.toLowerCase();
  // STUC do-tank: the hub (/community) and Action Area pages (/community/areas/*) are a
  // public recruiting surface. Everything else under /community (events, members, post,
  // and any future sub-path) stays member-only — fail closed.
  const isPublicCommunity =
    pathnameLower === '/community' ||
    pathnameLower === '/community/' ||
    pathnameLower === '/community/areas' ||
    pathnameLower.startsWith('/community/areas/');
  const needsAuth =
    pathnameLower === '/account' || pathnameLower.startsWith('/account/') ||
    ((pathnameLower === '/community' || pathnameLower.startsWith('/community/')) && !isPublicCommunity) ||
    pathnameLower === '/ask' || pathnameLower.startsWith('/ask/') ||
    pathnameLower === '/save-the-uterus-club/migrate' || pathnameLower.startsWith('/save-the-uterus-club/migrate/');

  if (needsAuth) {
    if (!env.DB) {
      return withSecurityHeaders(new Response('Service Unavailable', { status: 503, headers: { 'Retry-After': '120' } }));
    }
    // Static assets under protected prefixes don't need session validation;
    // their parent HTML page already validated.
    const isStatic = /\.(?:js|mjs|css|png|jpg|jpeg|webp|svg|woff2?|ico|json|map|gif|avif)(?:\?|$)/i.test(url.pathname);
    if (isStatic) return context.next();
    const sessionId = getSessionIdFromCookie(request);

    // /ask converts unauth users into signups (conversion funnel).
    // Other protected routes send unauth users to /login.
    const isAsk = pathnameLower === '/ask' || pathnameLower.startsWith('/ask/');
    const redirectBase = isAsk ? '/signup/' : '/login/';
    const redirectParam = isAsk ? 'next' : 'redirect';
    const authRedirect = `https://rrmacademy.org${redirectBase}?${redirectParam}=${encodeURIComponent(url.pathname + url.search)}`;

    if (!sessionId) {
      return withSecurityHeaders(htmlRedirect(authRedirect));
    }

    const session = await validateSession(env.DB, sessionId);
    if (!session) {
      return withSecurityHeaders(htmlRedirectWithCookies(authRedirect, [
        'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        clearAuthHintCookie(),
      ]));
    }

    const response = await context.next();
    if (session.renewed) {
      const headers = new Headers(response.headers);
      headers.append('Set-Cookie', sessionCookie(session.id, session.expiresAt));
      headers.append('Set-Cookie', authHintCookie(session.expiresAt));
      return withSecurityHeaders(new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }));
    }
    return withSecurityHeaders(response);
  }

  // Admin pages: require session + superadmin role
  const isAdminPage = pathnameLower === '/admin' || pathnameLower.startsWith('/admin/');
  if (isAdminPage) {
    if (!env.DB) {
      return withSecurityHeaders(new Response('Service Unavailable', { status: 503, headers: { 'Retry-After': '120' } }));
    }
    // Static assets under admin prefixes don't need session validation.
    const isStaticAdmin = /\.(?:js|mjs|css|png|jpg|jpeg|webp|svg|woff2?|ico|json|map|gif|avif)(?:\?|$)/i.test(url.pathname);
    if (isStaticAdmin) return context.next();
    const sessionId = getSessionIdFromCookie(request);
    if (!sessionId) {
      return withSecurityHeaders(htmlRedirect(`https://rrmacademy.org/login/?redirect=${encodeURIComponent(url.pathname + url.search)}`));
    }

    const session = await validateSession(env.DB, sessionId);
    if (!session) {
      const adminLoginRedirect = `https://rrmacademy.org/login/?redirect=${encodeURIComponent(url.pathname + url.search)}`;
      return withSecurityHeaders(htmlRedirectWithCookies(adminLoginRedirect, [
        'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        clearAuthHintCookie(),
      ]));
    }

    // role is already returned by validateSession (via the JOIN on user).
    if (!roleAtLeast(session.role, 'superadmin')) {
      return withSecurityHeaders(new Response('Forbidden', { status: 403 }));
    }

    const response = await context.next();
    if (session.renewed) {
      const headers = new Headers(response.headers);
      headers.append('Set-Cookie', sessionCookie(session.id, session.expiresAt));
      headers.append('Set-Cookie', authHintCookie(session.expiresAt));
      return withSecurityHeaders(new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }));
    }
    return withSecurityHeaders(response);
  }

  // Auth-hint self-heal for general (non-protected) navigations.
  // The header + account UI read the JS-readable `rrm_auth=1` hint to know a session
  // exists without an API call. A session minted before the hint shipped (2026-05-18),
  // or one that otherwise lost the hint, carries a valid HttpOnly `session` cookie but
  // NO hint, so hasAuthHint() short-circuits to anonymous and the nav renders logged-out
  // despite a valid login. Fix: when a session cookie is present but the hint is missing,
  // validate once and (re)issue the hint (and refresh the session cookie if it renewed).
  // Anonymous visitors have no session cookie, so they skip the D1 read entirely — the
  // LCP fast-path that motivated the hint is preserved. Fail-open: any error falls through
  // to normal handling, never blocking a page. Fires at most once per affected user (the
  // issued hint makes subsequent loads skip this branch).
  if (
    env.DB &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/cdn-cgi/') &&
    !url.pathname.includes('.')
  ) {
    const sid = getSessionIdFromCookie(request);
    const hasHint = /(?:^|;\s*)rrm_auth=1/.test(request.headers.get('Cookie') || '');
    if (sid && !hasHint) {
      try {
        const session = await validateSession(env.DB, sid);
        if (session) {
          const response = await context.next();
          const headers = new Headers(response.headers);
          headers.append('Set-Cookie', authHintCookie(session.expiresAt));
          if (session.renewed) {
            headers.append('Set-Cookie', sessionCookie(session.id, session.expiresAt));
          }
          return withSecurityHeaders(new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          }));
        }
      } catch (e) {
        // fail-open: fall through to normal handling below
      }
    }
  }

  // Continue to static assets / functions, then inject security headers.
  // Security headers were previously in _headers /* catch-all, but that rule
  // corrupted CF Pages' internal 301 trailing-slash redirects into 200 with
  // empty body. Applying them here avoids that bug.
  let response;
  try {
    response = await context.next();
  } catch (err) {
    response = await (async () => {
      const errorHeaders = new Headers({
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex',
      });
      try {
        if (context.env?.ASSETS) {
          const asset = await context.env.ASSETS.fetch(new Request(new URL('/500.html', request.url)));
          if (asset.ok) {
            return new Response(asset.body, { status: 500, headers: errorHeaders });
          }
        }
      } catch {
        // fall through to inline fallback
      }
      const inlineHtml = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Something went wrong | RRM Academy</title><style>body{font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#faf9f7;color:#1a1a1a;text-align:center;padding:2rem}.box{max-width:480px}.code{font-size:5rem;font-weight:600;color:#c9b99a;line-height:1;margin-bottom:1rem}h1{font-size:1.5rem;margin:0 0 .75rem}p{color:#555;margin:0 0 1.5rem}a{color:#8b5e3c;font-weight:500}</style></head><body><div class="box"><div class="code">500</div><h1>Something went wrong on our end</h1><p>We hit an unexpected error. It is not you, it is us, and we are looking into it.</p><a href="/">Back to homepage</a></div></body></html>';
      return new Response(inlineHtml, { status: 500, headers: errorHeaders });
    })();
    return withSecurityHeaders(response);
  }
  return withSecurityHeaders(response);
}
