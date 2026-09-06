/**
 * CF Pages Function middleware for RRM Academy.
 * Handles:
 * 1. Subdomain redirects (library.rrmacademy.org -> rrmacademy.org/library)
 * 2. Auth protection for /account/* and /community/* routes
 * 3. Arrivl AI bot analytics (fire-and-forget via waitUntil)
 *
 * NOTE: GA4 page_view is now fired client-side by ga-session.ts via /api/track.
 * The server shadow (sendPageView) has been removed to prevent double-counting.
 *
 * NOTE: Old library slug redirects are handled by the rrm-router Worker,
 * not here (avoids loading the 500KB redirect map on every request).
 */
import { getSessionIdFromCookie, validateSession, sessionCookie, authHintCookie, clearAuthHintCookie } from './api/auth/_shared.js';

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

const CSP_VALUE = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://challenges.cloudflare.com https://embed.cloudflarestream.com https://static.cloudflareinsights.com https://*.clarity.ms; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self' https://fp.rrmacademy.org https://challenges.cloudflare.com https://cloudflareinsights.com https://*.clarity.ms https://c.bing.com; frame-src https://challenges.cloudflare.com https://customer-99owhsi4yh33gohc.cloudflarestream.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests";

/**
 * Inject the standard 6 security headers onto any Response. Returns a new
 * Response so callers can use it as a drop-in wrapper around redirects,
 * early-return errors, and renewed-session responses. Clones headers so the
 * original response's Headers object is never mutated.
 */
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=(), interest-cohort=()');
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
 * THE /api/* CACHE CONTRACT, APPLIED WHERE IT CAN ACTUALLY APPLY.
 *
 * `public/_headers` has declared `/api/* Cache-Control: no-store` for as long
 * as there have been API routes, and it has never once reached one. `_headers`
 * applies to responses PAGES ITSELF serves, not to Function responses: a HEAD
 * on /api/community/status (no module exports HEAD, so Pages answers its own
 * 404) came back with `cache-control: no-store`, while a GET on the same path
 * came back 200 with the header absent entirely. Every authenticated endpoint
 * on the site -- /api/billing/status, /api/community/members, /api/auth/session
 * -- was therefore answering with no cache directive at all, which leaves a
 * shared cache free to hold one member's data and hand it to the next person
 * (red-team finding RRMA-RT-3). It belongs here for the same reason the six
 * security headers below moved here: this is the one place a Function response
 * passes through.
 *
 * A ROUTE THAT ALREADY DECLARED A POLICY KEEPS IT, exactly as the CSP arm in
 * withSecurityHeaders does. Several /api routes are deliberately cacheable and
 * clobbering them would be a real regression, not a hardening: /api/assets/*
 * serves R2 images `public, max-age=31536000, immutable`, /api/articles is the
 * public build feed at an hour, /api/survey/count at a minute. no-store is the
 * DEFAULT for an API response, not an override of a decision someone made.
 *
 * `Vary: Cookie` rides along on the same arm and only on that arm. A response
 * that opted into public caching has said it does not depend on the session,
 * and adding Vary there would quietly destroy the cacheability it asked for.
 */
function withApiCacheHeaders(response, pathname) {
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return response;
  if (response.headers.has('Cache-Control')) return response;

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  const vary = headers.get('Vary');
  const alreadyVaries = (vary || '').split(',').some((token) => token.trim().toLowerCase() === 'cookie');
  if (!alreadyVaries) headers.set('Vary', vary ? `${vary}, Cookie` : 'Cookie');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Fires an Arrivl pageview hit (AI bot analytics).
 * Called with ctx.waitUntil() so it never blocks the response.
 */
/**
 * Paths whose URLs never egress to Arrivl: the auth-gated set needsAuth
 * protects (account, gated community, ask, STUC migrate) plus login/signup,
 * whose ?redirect= query carries the visitor's intended destination. Applied
 * to the request URL AND to a same-origin Referer, because a suppressed page
 * is the referrer of the very next click and would otherwise leak one hop
 * later. Named distinctly from needsAuth's own locals on purpose: the guard
 * script pins those by regex.
 */
function arrivlSuppressedPath(pathname) {
  const p = String(pathname || '').toLowerCase();
  const publicCommunityCrawl =
    p === '/community' ||
    p === '/community/' ||
    p === '/community/areas' ||
    p.startsWith('/community/areas/');
  return (
    p === '/account' || p.startsWith('/account/') ||
    ((p === '/community' || p.startsWith('/community/')) && !publicCommunityCrawl) ||
    p === '/ask' || p.startsWith('/ask/') ||
    p.startsWith('/save-the-uterus-club/migrate') ||
    p === '/login' || p.startsWith('/login/') ||
    p === '/signup' || p.startsWith('/signup/')
  );
}

/**
 * The Referer as Arrivl may see it: empty when it is a same-origin (or
 * preview-origin) URL whose path is suppressed above -- forwarding it
 * verbatim would re-leak exactly what the URL gate withheld. An unparsable
 * Referer is withheld too; a cross-origin one passes through untouched.
 */
function arrivlSafeReferer(request) {
  const raw = request.headers.get('Referer') || '';
  if (!raw) return '';
  try {
    const ref = new URL(raw);
    const sameSite = ref.hostname.endsWith('rrmacademy.org') || ref.hostname.endsWith('.pages.dev');
    if (sameSite && arrivlSuppressedPath(ref.pathname)) return '';
    return raw;
  } catch {
    return '';
  }
}

async function sendArrivlPageview(request, env) {
  if (!env.ARRIVL_WEBSITE_KEY) return;

  // AI-bot analytics means AI BOTS: human pageviews (URL, UA, referer, IP)
  // have no business reaching arrivl.ai. The gate and the gated-path
  // suppression below mirror sendAiBotEvent, which always had both; this
  // function shipped without either (found in the 2026-08-25 adversarial
  // review, alongside the login-redirect leak it transitively closes -- an
  // unauthenticated /login/?redirect=<protected-url> pageview no longer
  // egresses at all unless a listed AI bot fetched it).
  const ua = request.headers.get('User-Agent') || '';
  if (!detectAiBot(ua)) return;

  const url = new URL(request.url);
  if (url.hostname === 'library.rrmacademy.org') return;
  if (url.pathname.startsWith('/api/')) return;
  if (arrivlSuppressedPath(url.pathname)) return;
  const accept = request.headers.get('Accept') || '';
  if (!accept.includes('text/html')) return;

  const xff = request.headers.get('x-forwarded-for') || '';
  const ip = xff.split(',')[0].trim() || request.headers.get('cf-connecting-ip') || '';

  const params = new URLSearchParams({
    url: request.url,
    userAgent: request.headers.get('User-Agent') || '',
    ref: arrivlSafeReferer(request),
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

async function render500Page(context, request) {
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

/**
 * The exported entry wraps the real handler so the CF Pages preview-domain
 * noindex applies to EVERY response shape without an early return. The old
 * shape (an if-pages.dev branch that ran context.next() and RETURNED near the
 * top) silently disabled every block below it -- and because rrm-router
 * proxies apex traffic to the rrm-academy.pages.dev origin, "below it" meant
 * the needsAuth page gates, the trailing-slash redirect, and the auth-hint
 * self-heal never ran for REAL production requests (found live 2026-08-25:
 * anonymous /ask/ served the full page). Now every request, apex or preview,
 * runs the same middleware; preview responses just gain the noindex header at
 * the tail. The router keeps stripping that header for apex traffic, exactly
 * as before.
 */
export async function onRequest(context) {
  const entryUrl = new URL(context.request.url);
  const isPreviewHost = entryUrl.hostname.endsWith('.pages.dev');
  let response;
  try {
    response = await handleRequest(context);
  } catch {
    // The deleted preview branch carried this exact net for context.next();
    // it now covers every throw out of the whole handler, on every host, so
    // an unexpected failure renders the branded 500 with security headers
    // instead of the platform's raw error page.
    response = withSecurityHeaders(await render500Page(context, context.request));
  }
  // Applied at the outermost wrap, on the entry URL, so it covers every branch
  // handleRequest can take -- including the ones that return before
  // context.next() ever runs and the 500 net above.
  response = withApiCacheHeaders(response, entryUrl.pathname);
  if (!isPreviewHost) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleRequest(context) {
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

  // The old admin is OFFLINE (Brian, 2026-08-21; shipped 2026-08-25). The
  // pages were deleted and admin.rrmacademy.org (the backoffice) is the only
  // admin, so every /admin path answers 410 Gone before Pages would 404 it.
  // Sits ABOVE the pages.dev preview branch AND the trailing-slash
  // redirect on purpose: the rrm-router proxies apex traffic to the
  // rrm-academy.pages.dev origin, so the middleware sees a pages.dev
  // hostname for REAL production requests (the router even strips the
  // preview noindex header on the way back) and any block below the
  // preview early-return never runs for them. /admin without the slash
  // also answers 410 directly instead of a 301 hop a scanner or browser
  // would cache toward a route that is itself permanently gone. Deliberately
  // does NOT match /api/admin/* (pathname starts with /api/), where the kept
  // machine endpoints (cleanup, seo OAuth callback, courses, faqs, ecosystem)
  // still serve behind their own auth. The data models of the deleted pages
  // live in docs/reference/old-admin/. X-Robots-Tag mirrors this file's
  // header-level noindex convention for tools that never parse the body.
  const adminPathLower = url.pathname.toLowerCase();
  const isAdminPage = adminPathLower === '/admin' || adminPathLower.startsWith('/admin/');
  if (isAdminPage) {
    return withSecurityHeaders(new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Admin moved</title></head>'
      + '<body style="font-family:system-ui,sans-serif;padding:3rem;"><p>This admin moved to '
      + '<a href="https://admin.rrmacademy.org">admin.rrmacademy.org</a>.</p></body></html>',
      { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' } }
    ));
  }


  // Fire Arrivl and AI-bot analytics asynchronously -- does not block the response.
  // GA4 page_view is now fired client-side by ga-session.ts via /api/track.
  context.waitUntil(
    Promise.all([
      sendArrivlPageview(request, env).catch(() => {}),
      sendAiBotEvent(request, env).catch(() => {}),
    ])
  );

  // Universal trailing-slash redirect for HTML pages.
  // CF Pages _headers /* rule corrupts ALL 3xx responses (static, _redirects,
  // AND function returns) into 200 with empty/mangled body. The only reliable
  // redirect is an HTML body with meta refresh + JS fallback.
  // GET-only with /mcp and /404 excluded, mirroring rrm-router's
  // needsTrailingSlash(): a 301 on a write method turns it into a GET and
  // drops the body (POST /events/register would break); /mcp is a Function
  // with no /mcp/ form; and /404 is the ONE flat .html in the build, so
  // Pages 308s /404/ back to /404 and slashing it here made an infinite
  // redirect loop that turned the router's catch-all (which fetches /404
  // for every unknown URL) into a site-wide 502 (found live 2026-08-25,
  // hours after the unmasking). These hazards were masked while the old
  // preview branch swallowed apex traffic ahead of this block.
  if (
    request.method === 'GET' &&
    !url.pathname.endsWith('/') &&
    url.pathname !== '/api' &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/cdn-cgi/') &&
    url.pathname !== '/health' &&
    url.pathname !== '/mcp' &&
    url.pathname !== '/404' &&
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
  // GET-only, like the trailing-slash block above: a 301 turns a write method
  // into a GET and drops the body, and both redirects run for 100% of apex
  // traffic since the 2026-08-25 preview-branch unmasking.
  if (request.method === 'GET' && url.hostname === 'library.rrmacademy.org') {
    const path = url.pathname.startsWith('/library') ? url.pathname : `/library${url.pathname}`;
    return withSecurityHeaders(Response.redirect(
      `https://rrmacademy.org${path}${url.search}`,
      301
    ));
  }

  // Redirect mixed-case URLs to lowercase for all canonical prefixes
  if (request.method === 'GET' && shouldCanonicalize(url.pathname)) {
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

    let session;
    try {
      session = await validateSession(env.DB, sessionId);
    } catch {
      return withSecurityHeaders(new Response('Service Unavailable', { status: 503, headers: { 'Retry-After': '120' } }));
    }
    if (!session) {
      return withSecurityHeaders(htmlRedirectWithCookies(authRedirect, [
        'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        clearAuthHintCookie(),
      ]));
    }

    let response;
    try {
      response = await context.next();
    } catch {
      return withSecurityHeaders(new Response('Service Unavailable', { status: 503, headers: { 'Retry-After': '120' } }));
    }
    if (session.renewed) {
      const headers = new Headers(response.headers);
      headers.append('Set-Cookie', sessionCookie(session.cookieId, session.expiresAt));
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
      let healedSession = null;
      try {
        healedSession = await validateSession(env.DB, sid);
      } catch (_e) {
        // fail-open: fall through to normal handling below
      }
      if (healedSession) {
        let response;
        try {
          response = await context.next();
        } catch {
          return withSecurityHeaders(await render500Page(context, request));
        }
        const headers = new Headers(response.headers);
        headers.append('Set-Cookie', authHintCookie(healedSession.expiresAt));
        if (healedSession.renewed) {
          headers.append('Set-Cookie', sessionCookie(healedSession.cookieId, healedSession.expiresAt));
        }
        return withSecurityHeaders(new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }));
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
  } catch {
    return withSecurityHeaders(await render500Page(context, request));
  }
  return withSecurityHeaders(response);
}
