/**
 * PAGES' OWN ROUTING, IN PROCESS. A hermetic case is a real Request handed to
 * the real exported handler, so the module under attack is
 * `functions/api/...` itself and not a copy of its logic.
 *
 * THE TABLE MIRRORS THE FILE TREE, because that is what Pages routes on:
 * `functions/api/account/mcp-keys/[id].js` answers
 * `/api/account/mcp-keys/<id>` with `params.id` filled in. A path this table
 * does not know is an ERROR rather than a 404, so a case naming a route that
 * has been renamed fails loudly instead of "passing" against nothing.
 *
 * METHOD DISPATCH IS PAGES' OWN RULE: `onRequest<Method>` when the module
 * exports one for this request's method, `onRequest` otherwise. That is what
 * makes the method-confusion cases real -- a DELETE at a route with no
 * DELETE handler reaches whatever `onRequest` the module has, which is where
 * the 405 either lives or does not.
 *
 * BOTH MIDDLEWARES RUN, in the order Pages runs them: the root
 * `functions/_middleware.js` first (security headers, the /admin 410, the
 * needsAuth page gate) and then `functions/api/admin/_middleware.js` for
 * `/api/admin/*` (best-effort session population). Without the second, every
 * admin case would be testing a route whose `context.data.user` is
 * permanently undefined, which is a 401 for the wrong reason.
 */

/* The functions/ graph imports build artifacts (`src/data/courses.json`,
   `ssot/guides.json`) with no import attribute, which esbuild accepts and Node
   ESM does not. `test/_json-module-hook.mjs` registers the resolve/load hooks
   that make the real modules importable and serves a deterministic fixture for
   the gitignored artifacts. It MUST be imported before any route module, so it
   sits above them here. */
import '../../../test/_json-module-hook.mjs';

import * as rootMiddleware from '../../../functions/_middleware.js';
import * as adminMiddleware from '../../../functions/api/admin/_middleware.js';

const MODULES = new Map();

async function moduleFor(specifier) {
  if (!MODULES.has(specifier)) MODULES.set(specifier, await import(specifier));
  return MODULES.get(specifier);
}

/** path pattern -> module specifier. `:name` matches a single path segment. */
const ROUTE_TABLE = [
  ['/api/auth/session', '../../../functions/api/auth/session.js'],
  ['/api/auth/profile', '../../../functions/api/auth/profile.js'],
  ['/api/auth/login', '../../../functions/api/auth/login.js'],
  ['/api/auth/signup', '../../../functions/api/auth/signup.js'],
  ['/api/auth/logout', '../../../functions/api/auth/logout.js'],
  ['/api/auth/forgot-password', '../../../functions/api/auth/forgot-password.js'],
  ['/api/auth/reset-password', '../../../functions/api/auth/reset-password.js'],
  ['/api/auth/change-password', '../../../functions/api/auth/change-password.js'],
  ['/api/auth/resend-verification', '../../../functions/api/auth/resend-verification.js'],
  ['/api/auth/verify-email', '../../../functions/api/auth/verify-email.js'],
  ['/api/account/mcp-keys', '../../../functions/api/account/mcp-keys/index.js'],
  ['/api/account/mcp-keys/:id', '../../../functions/api/account/mcp-keys/[id].js'],
  ['/api/saved', '../../../functions/api/saved.js'],
  ['/api/ask/saved', '../../../functions/api/ask/saved.js'],
  ['/api/billing/status', '../../../functions/api/billing/status.js'],
  ['/api/billing/portal', '../../../functions/api/billing/portal.js'],
  ['/api/billing/checkout-account', '../../../functions/api/billing/checkout-account.js'],
  ['/api/billing/supporter-badge', '../../../functions/api/billing/supporter-badge.js'],
  ['/api/community/status', '../../../functions/api/community/status.js'],
  ['/api/community/posts', '../../../functions/api/community/posts.js'],
  ['/api/community/comments', '../../../functions/api/community/comments.js'],
  ['/api/community/reactions', '../../../functions/api/community/reactions.js'],
  ['/api/community/flags', '../../../functions/api/community/flags.js'],
  ['/api/community/members', '../../../functions/api/community/members.js'],
  ['/api/community/memberships', '../../../functions/api/community/memberships.js'],
  ['/api/community/ban', '../../../functions/api/community/ban.js'],
  ['/api/community/unban', '../../../functions/api/community/unban.js'],
  ['/api/community/upload', '../../../functions/api/community/upload.js'],
  ['/api/community/notifications', '../../../functions/api/community/notifications.js'],
  ['/api/courses/enroll', '../../../functions/api/courses/enroll.js'],
  ['/api/courses/progress', '../../../functions/api/courses/progress.js'],
  ['/api/courses/certificate', '../../../functions/api/courses/certificate.js'],
  ['/api/admin/faqs', '../../../functions/api/admin/faqs/index.js'],
  ['/api/admin/faqs/:id', '../../../functions/api/admin/faqs/[id].js'],
  ['/api/admin/courses', '../../../functions/api/admin/courses/index.js'],
  ['/api/admin/ecosystem', '../../../functions/api/admin/ecosystem.js'],
  ['/api/admin/cleanup', '../../../functions/api/admin/cleanup.js'],
  ['/api/create-checkout', '../../../functions/api/create-checkout.js'],
  ['/api/stripe-webhook', '../../../functions/api/stripe-webhook.js'],
  ['/api/contact/submit', '../../../functions/api/contact/submit.js'],
  ['/api/survey/submit', '../../../functions/api/survey/submit.js'],
  ['/api/survey/request', '../../../functions/api/survey/request.js'],
  ['/api/survey/validate', '../../../functions/api/survey/validate.js'],
  ['/api/quiz/request', '../../../functions/api/quiz/request.js'],
  ['/api/endo-quiz/start', '../../../functions/api/endo-quiz/start.js'],
  ['/api/endo-quiz/request', '../../../functions/api/endo-quiz/request.js'],
  ['/api/newsletter/subscribe', '../../../functions/api/newsletter/subscribe.js'],
  ['/api/events/register', '../../../functions/api/events/register.js'],
  ['/api/partners/apply', '../../../functions/api/partners/apply.js'],
  ['/api/pdf/request', '../../../functions/api/pdf/request.js'],
  /* Not attacked by any case: this is the DELIBERATELY CACHEABLE half of the
     /api/* cache contract, and test/api-cache-headers.test.js needs to reach it
     to prove the middleware leaves a route's own Cache-Control alone. A path
     this table cannot reach is an error rather than a 404, so it has to be
     named here to be testable at all. */
  ['/api/survey/count', '../../../functions/api/survey/count.js'],
];

/** -> { specifier, params } or null. */
export function matchRoute(pathname) {
  for (const [pattern, specifier] of ROUTE_TABLE) {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');
    if (patternParts.length !== pathParts.length) continue;
    const params = {};
    let matched = true;
    for (let index = 0; index < patternParts.length; index += 1) {
      const expected = patternParts[index];
      if (expected.startsWith(':')) {
        if (!pathParts[index]) { matched = false; break; }
        params[expected.slice(1)] = decodeURIComponent(pathParts[index]);
      } else if (expected !== pathParts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { specifier, params };
  }
  return null;
}

/** The static shell `context.next()` answers with when no gate refuses. */
function shellResponse() {
  return new Response('<!doctype html><html lang="en"><head><title>RRM Academy</title></head><body></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

/**
 * One request, through the middleware chain and then the route.
 *
 * `waitUntil` is COLLECTED AND AWAITED rather than dropped. Half this
 * surface does its mail, its GA4 beacons and its Google Ads uploads through
 * it, and the cost family's assertion is precisely that those did not
 * happen: a promise nobody awaited would let a case pass by racing.
 */
export async function dispatch(request, env) {
  const url = new URL(request.url);
  const pending = [];
  const waitUntil = (promise) => pending.push(Promise.resolve(promise).catch(() => {}));

  const route = matchRoute(url.pathname);
  if (!route && url.pathname.startsWith('/api/')) {
    throw new Error(`redteam dispatch: no route table entry for ${url.pathname}`);
  }

  const runRoute = async () => {
    if (!route) return shellResponse();
    const module = await moduleFor(route.specifier);
    const named = `onRequest${request.method.charAt(0)}${request.method.slice(1).toLowerCase()}`;
    const handler = typeof module[named] === 'function' ? module[named] : module.onRequest;
    if (typeof handler !== 'function') {
      /* Pages answers 405 itself when a module exports no handler for the
         method. Modelling that here rather than throwing keeps the
         method-confusion cases honest about where the refusal comes from. */
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }
    const context = { request, env, params: route.params, waitUntil, next: async () => shellResponse(), data: {} };
    return handler(context);
  };

  const afterRoot = async () => {
    if (!url.pathname.startsWith('/api/admin/')) return runRoute();
    const context = { request, env, params: route?.params ?? {}, waitUntil, data: {}, next: null };
    context.next = async () => {
      if (!route) return shellResponse();
      const module = await moduleFor(route.specifier);
      const named = `onRequest${request.method.charAt(0)}${request.method.slice(1).toLowerCase()}`;
      const handler = typeof module[named] === 'function' ? module[named] : module.onRequest;
      if (typeof handler !== 'function') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { 'content-type': 'application/json' },
        });
      }
      return handler(context);
    };
    return adminMiddleware.onRequest(context);
  };

  const response = await rootMiddleware.onRequest({ request, env, next: afterRoot, waitUntil, data: {} });
  await Promise.all(pending);
  return response;
}

/** Every path the route table knows, for a case table that wants them all. */
export function knownPaths() {
  return ROUTE_TABLE.map(([pattern]) => pattern);
}
