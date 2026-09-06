# Red-team findings

The standing list. Every OPEN id here is carried by one or more cases in
`scripts/redteam/cases.mjs` as `known: '<id>'`, which means the run reports
them as KNOWN and stays green while the finding stays visible in every report
it prints. `test/redteam.test.js` fails when a known case starts passing, so a
fixed finding cannot leave a stale marker behind to hide the next regression
of the same case.

**A finding is not a case that was made to pass.** Nothing in the table has
had its expectation softened; each entry below is a real refusal this
deployment did not make, with the request and the answer it gave.

The dated run reports beside this file (`<date>-hermetic.md`,
`<date>-live.md`, `<date>-deps.md`) are the evidence; this file is the memory.

| Id | Status | One line | Cases |
|---|---|---|---:|
| RRMA-RT-1 | FIXED 2026-09-05 | the stored (hashed) session id worked as a cookie, so one row of the `session` table was a live login | 1 |
| RRMA-RT-2 | FIXED 2026-09-05 | signup answered a fresh address and an already-registered one with different KEY SETS, which is an account-enumeration oracle | 1 |
| RRMA-RT-3 | FIXED 2026-09-05 | `public/_headers` declared `/api/* Cache-Control: no-store` and never applied it to a single Function response | 1 |
| RRMA-RT-4 | FIXED 2026-09-06 | `/mcp` proxies the apex to a Worker, forwarding `Authorization` and stripping `Set-Cookie`, and has no test of its own anywhere in this repo | 0 |
| RRMA-RT-5 | FIXED 2026-09-06 | a route that set its own `no-store` escaped the `Vary: Cookie` half of the cache contract | 2 |
| RRMA-RT-DEPS | OPEN, accepted to 2026-10-06 | the production lockfile carried eight fixable HIGH advisories that no gate checked; seven are bumped, the eighth is astro's own pinned `sharp` | 0 |
| RRMA-RT-COVERAGE | FIXED 2026-09-06 | the harness attacked 44 of the 121 routes Pages serves, and nothing said so | 0 |

---

## RRMA-RT-1 -- fixed

`validateSession` hashed the cookie and looked the hash up, and then fell back
to matching the cookie VERBATIM against `session.id`. That dual-read was left
over from the plaintext-to-hashed migration, and it made the stored value its
own working cookie: anyone who could read one row of the `session` table held
a live session, so hashing at rest bought nothing against a database read.

Retired 2026-09-05 in `functions/api/auth/_shared.js`. The live table held 72
rows, all hashed, so the fallback had nothing left to serve and nobody was
logged out. The regression alarm is the `raw-hash` identity in
`scripts/redteam/targets.mjs`, which presents the STORED id as the cookie:
case `auth-stored-session-id-as-cookie` demands a 401 and passes.
`test/session-authorization-guards.test.js` pins the same thing at the helper.

## RRMA-RT-2 -- fixed

Signup was an enumeration oracle by response SHAPE. Both arms answered
`201 {ok: true, emailVerificationRequired: true}` -- the intended
non-enumerable design -- but the new-account arm alone added `resendPath`. One
key told an attacker whether an address already had an account, with no timing
measurement needed.

Fixed 2026-09-05 in `functions/api/auth/signup.js`: both arms emit the same
frozen body and the `Set-Cookie` shape matches too. Case
`leak-signup-known-vs-unknown-shape` runs the `enumeration` scenario, which
compares statuses and KEY SETS as well as bytes, so an arm that answers with a
different shape fails even when the bytes happen to line up.
`test/auth-signup.test.js` holds the same assertion at the module.

## RRMA-RT-3 -- fixed

`public/_headers` declared `/api/* Cache-Control: no-store` and never once
applied it to a Function response. `_headers` governs what Pages serves
ITSELF, so a HEAD on an API path (no module exports HEAD) carried the header
while a GET reached the Function and answered 200 with no cache directive at
all. Every authenticated endpoint was in that hole.

Fixed 2026-09-05: the contract now lives in `withApiCacheHeaders()` in
`functions/_middleware.js`, which runs in front of every request. Case
`headers-api-is-no-store` passes hermetically as well as live, which it could
not do while the header came from a file the process never reads. The
per-route sweep and its counterweight (a route that declares its own caching
keeps it) are the 57 assertions in `test/api-cache-headers.test.js`.

## RRMA-RT-4 -- fixed

`functions/mcp/index.js` is a transparent proxy from the apex to the MCP
Worker at `mcp.rrmacademy.org`. It forwards `Authorization`,
`mcp-session-id` and five other headers upstream, and strips `Set-Cookie` and
`Set-Cookie2` on the way back specifically to stop cookie smuggling onto the
apex domain.

Both of those are security decisions, and neither had a test anywhere in this
repo: `grep -rl 'functions/mcp' test/` found nothing. The red-team harness
exempts the route in `scripts/redteam/coverage.mjs` because the GATE it would
attack lives in the Worker, which is a different deployment and not this
repo's code -- but the header policy is this repo's code, and a rewrite that
dropped `set-cookie` from `STRIP_RESPONSE_HEADERS` would have shipped green.

Closed 2026-09-06 by `test/mcp-proxy.test.js` (PR #151), 22 unit tests over
the real exported handlers with a capturing `MCP_BACKEND` service-binding
stub, so every assertion reads the actual `Request` the module built. It pins
the credential forward byte for byte, the apex `Cookie` NOT reaching upstream,
each name on `STRIP_RESPONSE_HEADERS` individually (under odd casing, and on
an upstream 500 as well as a 200), the destination origin under seven steering
attempts and on the no-binding fallback path, method and body passthrough, and
the bounded 502 that echoes nothing from the upstream exception.

Mutation-proven both directions: removing `'set-cookie'` from the strip list
turns 5 tests red, removing `'authorization'` from the forward list turns 3
red.

The proxy module was not changed, and the route stays exempt in
`coverage.mjs`: this is a unit test beside the module, not a request-shaped
attack, so the exemption and the zero in the case column both still stand.

NOTED RESIDUAL, deliberately left unasserted. The strip list is cookie- and
hop-by-hop-focused, so other origin-scoped response headers from upstream
(`Clear-Site-Data`, `Strict-Transport-Security`, `Content-Security-Policy`)
still reach the apex response. The upstream is first-party and the worst of
those is a logout rather than a privilege, so pinning them in either direction
would freeze a decision nobody has made.

## RRMA-RT-5 -- fixed

The other half of RRMA-RT-3, found by the same route table growing.
`withApiCacheHeaders()` in `functions/_middleware.js` returned a response
untouched the moment it carried any `Cache-Control` of its own. That is right
for the deliberately cacheable routes -- `/api/survey/count` at a minute,
`/api/assets/*` immutable -- and wrong for the two that set `no-store`
THEMSELVES: `/api/newsletter/open` and `/api/auth/verify-email` reached
production with no `Vary` header at all.

`no-store` already forbids storage, so this is the belt rather than the
braces; what it removes is the case where a shared cache keyed BEFORE the
cookie holds one visitor's answer. The sweep in
`test/api-cache-headers.test.js` had asserted the pairing since RRMA-RT-3 and
could not see these two, because `targets.mjs` did not name them until the
coverage self-check made it name the whole surface. That is the finding under
the finding: the sweep was correct and blind.

Fixed at the same choke point. The middleware now returns early only when the
declared policy is NOT `no-store`; a self-declared `no-store` keeps its own
header and gains the `Vary`. Cases
`headers-self-declared-no-store-varies-newsletter-open` and
`headers-self-declared-no-store-varies-auth-verify-email` pin both, live as
well as hermetically.

## RRMA-RT-DEPS -- open, accepted to 2026-10-06

Until 2026-09-06 nothing in this repo looked at the production half of
`package-lock.json`. The first run of `scripts/redteam/deps.mjs` against
OSV.dev, EPSS and CISA KEV found eight BLOCKing advisories: HIGH severity with
a fix already published, which is the "we knew, a fix existed, we shipped
anyway" case.

Seven were cleared in the same commit by a patch/minor bump, no API change and
the full suite green: `js-yaml` 4.3.0 to 4.3.2, `nanoid` 3.3.11 to 3.3.18,
`postcss` 8.5.10 to 8.5.28, `svgo` 4.0.1 to 4.1.0, and the direct `sharp`
0.34.5 to 0.35.4.

The eighth is `GHSA-f88m-g3jw-g9cj`, `sharp` 0.34.5, and it survives the bump
because it is not this repo's copy: `astro@6.4.8` declares
`optionalDependencies: { sharp: "^0.34.0" }`, so npm keeps a nested 0.34.5
under `node_modules/astro` for Astro's image service even though the direct
dependency now resolves to 0.35.4. Clearing it needs an npm `overrides` entry
forcing a version outside Astro's own declared range on the image pipeline,
which is a build-behaviour change with deploy risk and does not belong in a
red-team PR. The real fix is an Astro bump that widens the range.

Accepted in `scripts/redteam/deps-accepted.json` until **2026-10-06**, with
that reason. On 2026-10-07 the gate BLOCKS again, which is the point of an
expiry: `test/deps.test.js` judges the same captured fixture at a date past
every acceptance and asserts it goes back to BLOCK.

## RRMA-RT-COVERAGE -- fixed

Not a defect in the site, a defect in the harness, and the reason the register
starts with it: the red-team run was green over 150 cases while attacking 44
of the 121 routes Pages serves from `functions/`.

The 77 it had never sent a request to were not the boring ones. They included
every machine lane (the newsletter sender and its ADMIN_API_SECRET bearer, the
deploy recorder, the SES event and bounce handlers, each gated only by a
shared secret and reachable by nobody's cookie), the paid course platform's
entitlement doors (`rendition`, `audio`, `assets/[[path]]`, `stream/token`),
six member-gated community writes, the build-token content readers that answer
with the whole corpus, and every public endpoint that takes a query and spends
an upstream call.

Fixed 2026-09-06. `scripts/redteam/coverage.mjs` reads the route surface off
the file tree, `test/redteam-coverage.test.js` fails when a handler has
neither a case nor a written exemption, and the case table grew from 150 to
286. Seven routes are exempt, each with the reason it is one. Proven able to
fail by adding a dummy handler under `functions/api/` and watching the test go
red, then deleting it.
