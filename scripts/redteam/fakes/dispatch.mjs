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
  /* THE SECOND HALF OF THE TREE, added when the coverage self-check
     (scripts/redteam/coverage.mjs) was written and said out loud that 77 of
     the 121 routes Pages serves had never been knocked on. Everything below
     is a door the site really answers on; the ones still absent are named in
     that module's OUT_OF_SCOPE with a reason. */
  ['/api/faqs', '../../../functions/api/faqs.js'],
  ['/api/courses', '../../../functions/api/courses.js'],
  ['/api/glossary/terms', '../../../functions/api/glossary/terms.js'],
  ['/api/blog/posts', '../../../functions/api/blog/posts.js'],
  ['/api/partners', '../../../functions/api/partners/index.js'],
  ['/api/articles', '../../../functions/api/articles.js'],
  ['/api/articles/bulk', '../../../functions/api/articles/bulk.js'],
  ['/api/bulk', '../../../functions/api/bulk.js'],
  ['/api/newsletter/send', '../../../functions/api/newsletter/send.js'],
  ['/api/newsletter/send-first-email', '../../../functions/api/newsletter/send-first-email.js'],
  ['/api/newsletter/rss-check', '../../../functions/api/newsletter/rss-check.js'],
  ['/api/newsletter/bounce', '../../../functions/api/newsletter/bounce.js'],
  ['/api/newsletter/unsubscribe', '../../../functions/api/newsletter/unsubscribe.js'],
  ['/api/newsletter/click', '../../../functions/api/newsletter/click.js'],
  ['/api/newsletter/open', '../../../functions/api/newsletter/open.js'],
  ['/api/events/remind', '../../../functions/api/events/remind.js'],
  ['/api/email/events', '../../../functions/api/email/events.js'],
  ['/api/library/deploy-record', '../../../functions/api/library/deploy-record.js'],
  ['/api/admin/seo', '../../../functions/api/admin/seo.js'],
  ['/api/admin/courses/:id', '../../../functions/api/admin/courses/[id].js'],
  ['/api/admin/courses/:id/attachments', '../../../functions/api/admin/courses/[id]/attachments.js'],
  ['/api/admin/courses/:id/sections', '../../../functions/api/admin/courses/[id]/sections.js'],
  ['/api/admin/courses/:id/sections/:sectionId', '../../../functions/api/admin/courses/[id]/sections/[sectionId].js'],
  ['/api/admin/courses/:id/steps', '../../../functions/api/admin/courses/[id]/steps.js'],
  ['/api/admin/courses/:id/steps/:stepId', '../../../functions/api/admin/courses/[id]/steps/[stepId].js'],
  ['/api/admin/courses/:id/steps/:stepId/renditions', '../../../functions/api/admin/courses/[id]/steps/[stepId]/renditions.js'],
  ['/api/admin/faqs/:id/resources', '../../../functions/api/admin/faqs/[id]/resources.js'],
  ['/api/admin/faqs/:id/library-refs', '../../../functions/api/admin/faqs/[id]/library-refs.js'],
  ['/api/courses/quiz', '../../../functions/api/courses/quiz.js'],
  ['/api/courses/comments', '../../../functions/api/courses/comments.js'],
  ['/api/courses/rendition', '../../../functions/api/courses/rendition.js'],
  ['/api/courses/audio', '../../../functions/api/courses/audio.js'],
  ['/api/courses/waitlist', '../../../functions/api/courses/waitlist.js'],
  ['/api/courses/affiliate-click', '../../../functions/api/courses/affiliate-click.js'],
  ['/api/stream/token', '../../../functions/api/stream/token.js'],
  ['/api/assets/*', '../../../functions/api/assets/[[path]].js'],
  ['/api/community/areas', '../../../functions/api/community/areas.js'],
  ['/api/community/areas/join', '../../../functions/api/community/areas/join.js'],
  ['/api/community/areas/leave', '../../../functions/api/community/areas/leave.js'],
  ['/api/community/areas/volunteer', '../../../functions/api/community/areas/volunteer.js'],
  ['/api/community/projects', '../../../functions/api/community/projects.js'],
  ['/api/community/projects/join', '../../../functions/api/community/projects/join.js'],
  ['/api/community/projects/leave', '../../../functions/api/community/projects/leave.js'],
  ['/api/community/impact', '../../../functions/api/community/impact.js'],
  ['/api/community/unfurl', '../../../functions/api/community/unfurl.js'],
  ['/api/ask', '../../../functions/api/ask.js'],
  ['/api/ask/sandbox', '../../../functions/api/ask/sandbox.js'],
  ['/api/ask/shared/:id', '../../../functions/api/ask/shared/[id].js'],
  ['/api/search/semantic', '../../../functions/api/search/semantic.js'],
  ['/api/search/log', '../../../functions/api/search/log.js'],
  ['/api/track', '../../../functions/api/track.js'],
  ['/api/quiz/start', '../../../functions/api/quiz/start.js'],
  ['/api/quiz/results', '../../../functions/api/quiz/results.js'],
  ['/api/quiz/event', '../../../functions/api/quiz/event.js'],
  ['/api/endo-quiz/results', '../../../functions/api/endo-quiz/results.js'],
  ['/api/endo-quiz/download', '../../../functions/api/endo-quiz/download.js'],
  ['/api/survey/event', '../../../functions/api/survey/event.js'],
  ['/api/pdf/redeem', '../../../functions/api/pdf/redeem.js'],
  ['/api/fund-progress', '../../../functions/api/fund-progress.js'],
  ['/api/fund-supporters', '../../../functions/api/fund-supporters.js'],
  ['/api/billing/supporter-badge', '../../../functions/api/billing/supporter-badge.js'],
  ['/api/auth/google', '../../../functions/api/auth/google.js'],
  ['/api/auth/google-callback', '../../../functions/api/auth/google-callback.js'],
  ['/events/:slug', '../../../functions/events/[slug].js'],
  ['/ask/s/:token', '../../../functions/ask/s/[token].js'],
  ['/save-the-uterus-club/migrate', '../../../functions/save-the-uterus-club/migrate.js'],
];

/** -> { specifier, params } or null. */
export function matchRoute(pathname) {
  for (const [pattern, specifier] of ROUTE_TABLE) {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');
    /* `*` is Pages' `[[path]]` catch-all: it swallows the rest of the path and
       hands it to the module as a `path` param array, which is exactly what
       `functions/api/assets/[[path]].js` reads. Matching it on segment count
       would make every asset case unreachable. */
    if (patternParts[patternParts.length - 1] === '*') {
      const prefix = patternParts.slice(0, -1);
      if (pathParts.length <= prefix.length) continue;
      if (prefix.every((part, index) => part === pathParts[index])) {
        return { specifier, params: { path: pathParts.slice(prefix.length) } };
      }
      continue;
    }
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
