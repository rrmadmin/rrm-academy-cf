/**
 * ROUTE COVERAGE, READ OFF THE FILE TREE RATHER THAN OFF A LIST.
 *
 * The case table and `targets.mjs` are both hand-written, so the one thing
 * neither can tell you is what they FORGOT. Pages routes on the file tree:
 * every non-underscore module under `functions/` is a live door on
 * rrmacademy.org whether or not this harness has ever knocked on it. This
 * module enumerates those doors from disk, so a handler added tomorrow shows
 * up here on its first commit.
 *
 * THE ASSERTION LIVES IN `test/redteam-coverage.test.js`: every derived route
 * either has at least one case aimed at it, or names itself in OUT_OF_SCOPE
 * with a written reason. There is no third answer, and "nobody got round to
 * it" is not a reason -- an exemption is a decision somebody made and can be
 * argued with, while a silent gap is a door nobody knows is open.
 *
 * WHY EXEMPTIONS ARE ALLOWED AT ALL. Some of this surface takes no input
 * beyond a path (the OG renderer, the health probe) or is a static document
 * (the MCP manifest). Attacking those with the six families would add runtime
 * and no evidence. The rule the list is kept to: an exemption is legitimate
 * only when the route takes NO user input that reaches a database, a bill, a
 * mailbox or another person's data. Anything that takes a query string, a
 * body, a cookie or a token is in scope, and the reason column has to say
 * something truer than "read-only".
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const FUNCTIONS_ROOT = join(import.meta.dirname, '..', '..', 'functions');

/**
 * Pages' own file-tree rules, in the order they matter:
 *   `_anything.js`      not a route at all (helpers, middleware)
 *   `index.js`          the directory itself
 *   `[id].js`           one segment, named -- rendered here as `:id`
 *   `[[path]].js`       the rest of the path -- rendered here as `*`
 */
function routeForFile(relativePath) {
  const withoutExtension = relativePath.replace(/\.js$/, '');
  const parts = withoutExtension.split('/');
  if (parts.some((part) => part.startsWith('_'))) return null;
  if (parts[parts.length - 1] === 'index') parts.pop();
  const rendered = parts.map((part) => {
    if (/^\[\[.+\]\]$/.test(part)) return '*';
    if (/^\[.+\]$/.test(part)) return `:${part.slice(1, -1)}`;
    return part;
  });
  return `/${rendered.join('/')}`;
}

function walk(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (entry.endsWith('.js')) found.push(full);
  }
  return found;
}

/** Every route Pages serves from `functions/`, sorted, as `:param` patterns. */
export function handlerRoutes() {
  return walk(FUNCTIONS_ROOT)
    .map((full) => routeForFile(relative(FUNCTIONS_ROOT, full)))
    .filter(Boolean)
    .sort();
}

/**
 * Does a concrete request path (what a case carries) hit a derived route
 * pattern? `:name` eats one segment, `*` eats the rest, everything else is
 * literal.
 */
export function pathMatchesRoute(requestPath, routePattern) {
  const patternParts = routePattern.split('/');
  const pathParts = requestPath.split('/');
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    if (expected === '*') return pathParts.length > index;
    if (pathParts[index] === undefined) return false;
    if (expected.startsWith(':')) continue;
    if (expected !== pathParts[index]) return false;
  }
  return patternParts.length === pathParts.length;
}

/**
 * THE EXEMPTIONS, each with the reason it is one.
 *
 * Read the rule in this file's header before adding a line. Two shapes recur
 * and both are legitimate:
 *   - the route takes no attacker-controlled input at all, so there is no
 *     request an attacker could send that differs from the one a browser
 *     sends;
 *   - the route is a build-time or admin surface whose gate is already the
 *     subject of a case at a sibling route sharing the identical gate, and
 *     the exemption says which.
 *
 * "Not important" and "low traffic" are not reasons. A route that writes,
 * mails, bills, or answers differently to different people belongs in
 * `targets.mjs`, not here.
 */
export const OUT_OF_SCOPE = Object.freeze({
  '/health':
    'a fixed liveness probe: a constant object, no bindings touched, no input of any kind read from the request.',
  '/api':
    'the API index. A committed list of endpoint names, returned identically to everyone, with no binding and no request input.',
  '/.well-known/mcp':
    'the MCP discovery manifest, a static document. It names the MCP server; it is not the server, and it reads nothing from the request.',
  '/mcp':
    'a transparent proxy to the mcp.rrmacademy.org Worker. It holds no gate of its own -- every credential check and every refusal lives in that Worker, which is a different deployment and not this repo\'s code. What it DOES decide -- which headers cross, and that set-cookie never comes back -- has no test in this repo at all, which is a gap worth closing and is recorded as RRMA-RT-4 in docs/redteam/FINDINGS.md.',
  '/api/ask/sandbox':
    'a canned constant for client integration testing: no auth, no rate limit, no database, no inference. The response is the same object whatever is sent.',
  '/api/survey/count':
    'three aggregate counts, two of them committed constants. It reads no request input and returns the same numbers to everyone; its cache contract is pinned by test/api-cache-headers.test.js, which is the only thing about it an attacker could move.',
  '/og/*':
    'the social-card renderer. Its input is a path segment naming already-public content, its output is a PNG, and it writes nothing, mails nothing and bills nothing. A 404 here reveals only that a public slug is not a public slug.',
});
