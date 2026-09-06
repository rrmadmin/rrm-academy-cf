/**
 * THE CASE TABLE. Every entry is a REAL REQUEST with an expected refusal.
 *
 * A case is a sentence an operator can read: this identity, at this host, with
 * this method, path and body, must get this answer. `run.mjs` turns it into a
 * Request and compares. NOTHING here is a unit test of a helper; the smallest
 * thing this file knows about is an HTTP round trip through the real
 * middleware chain into the real route module.
 *
 * A FAIL IS A FINDING. When a case fails, the answer is to fix the code or to
 * adjudicate the failure with `known: 'RRMA-RT-n'` plus a written note. It is
 * never to loosen the expectation. A `known` case that starts PASSING also
 * fails the suite, because a stale marker would hide the next regression of
 * the same case behind a green KNOWN.
 *
 * WHY THESE SIX FAMILIES. This surface takes PII (accounts, the endo quiz and
 * survey, contact forms, community posts) and money (Stripe checkout,
 * donations, membership). The families are the six ways those two things get
 * taken: someone who is not you (auth), a payment that did not happen
 * (money), a write that should have been refused (pii), an answer that says
 * too much (leak), a browser that trusts the wrong origin (headers), and a
 * bill for work nobody authorised (cost).
 */

import {
  ROUTES, SESSION_ROUTES, PRIVILEGED_ROUTES, PUBLIC_WRITE_ROUTES,
  VICTIM_POST_ID, VICTIM_COMMENT_ID, VICTIM_KEY_ID, ATTACKER_KEY_ID,
  NOBODYS_POST_ID, NOBODYS_KEY_ID, NOBODYS_TOKEN,
} from './targets.mjs';
import { bodyFor } from './fakes/bodies.mjs';
import { VICTIM_EMAIL, ABSENT_EMAIL, SUPERADMIN_EMAIL } from './fakes/env.mjs';

export const FAMILIES = Object.freeze({
  auth: 'session forgery, expiry, role escalation and IDOR across every gated route',
  money: 'checkout tampering, webhook signatures, replay, and membership without payment',
  pii: 'the writes that carry a person: quiz, survey, contact, community, and the pseudonymisation split',
  leak: 'what a refusal says: stacks, secrets, binding names, member data, and user enumeration',
  headers: 'the browser-facing contract: CSP, HSTS, nosniff, CORS, no-store, and the gone/preview surfaces',
  cost: 'what an unauthenticated or malformed request is allowed to spend',
});

/** The fragments that must never appear in ANY response body, ever. */
export const STACK_MARKERS = Object.freeze([
  'at async ', 'at Object.', '.js:1', 'SQLITE_', 'D1_ERROR', 'no such column',
  'no such table', 'UNIQUE constraint failed', 'node:internal',
]);

/** Binding and secret-variable names that must never be echoed to a client. */
export const BINDING_NAMES = Object.freeze([
  'SURVEY_SYMPTOMS_DB', 'COMMUNITY_KV', 'STRIPE_WEBHOOK_SECRET', 'ADMIN_API_SECRET',
  'AWS_SECRET_ACCESS_KEY', 'CF_TURNSTILE_SECRET', 'R2_ASSETS',
]);

const cases = [];
const add = (kase) => { cases.push(kase); return kase; };

/** A short, stable id fragment from a route, so generated ids read as paths. */
const slugOf = (route) => `${route.method.toLowerCase()}-${route.path.replace(/^\/api\//, '').replace(/[^a-z0-9]+/gi, '-')}`;

const jsonHeaders = { 'content-type': 'application/json' };

// ===========================================================================
// auth -- who you are, and what that entitles you to
// ===========================================================================

/**
 * EVERY GATED ROUTE, WITH NO COOKIE AT ALL.
 *
 * Generated rather than hand-listed on purpose: a route added to
 * `targets.mjs` is attacked by this sweep without anyone remembering to write
 * a case for it, which is the failure mode a hand-list has. Each request
 * carries a body that WOULD SUCCEED if the caller were authorised (see
 * fakes/bodies.mjs), so a 400 for a parsing reason cannot masquerade as a
 * refusal.
 */
const METHOD_RISK = { DELETE: 4, POST: 3, PATCH: 2, PUT: 2, GET: 1 };
const riskiestPerPath = new Map();
for (const route of [...SESSION_ROUTES, ...PRIVILEGED_ROUTES]) {
  const held = riskiestPerPath.get(route.path);
  if (!held || (METHOD_RISK[route.method] ?? 0) > (METHOD_RISK[held.method] ?? 0)) riskiestPerPath.set(route.path, route);
}
for (const route of riskiestPerPath.values()) {
  add({
    id: `auth-anon-${slugOf(route)}`,
    family: 'auth',
    description: `${route.method} ${route.path} with no session cookie is refused`,
    as: 'none',
    host: 'apex',
    method: route.method,
    path: route.path,
    headers: jsonHeaders,
    body: bodyFor(route.path, route.method),
    expect: {
      status: 401,
      mustNotContain: [VICTIM_EMAIL, ...STACK_MARKERS],
    },
    live: {
      /* Live, the same request reaches the same function: this surface has no
         edge auth in front of it, so the JSON refusal is what a real attacker
         sees and the status assertion still holds. The PII assertion is kept;
         the stack-marker list is not, because a live 500 would be a finding of
         its own rather than this case's business. */
      expect: { status: 401, mustNotContain: [VICTIM_EMAIL] },
    },
  });
}

/** A cookie that is well-formed and was never issued. */
for (const path of ['/api/saved', '/api/admin/faqs']) {
  add({
    id: `auth-forged-${path.replace(/^\/api\//, '').replace(/[^a-z0-9]+/gi, '-')}`,
    family: 'auth',
    description: `a forged session cookie at ${path} authenticates nobody`,
    as: 'forged',
    host: 'apex',
    method: 'GET',
    path,
    expect: { status: 401, mustNotContain: [VICTIM_EMAIL, ...STACK_MARKERS] },
    live: { expect: { status: 401 } },
  });
}

/** A cookie whose row exists and whose expiry has passed. */
for (const path of ['/api/community/posts']) {
  add({
    id: `auth-expired-${path.replace(/^\/api\//, '').replace(/[^a-z0-9]+/gi, '-')}`,
    family: 'auth',
    description: `an expired session row at ${path} is not honoured`,
    as: 'expired',
    host: 'apex',
    method: 'GET',
    path,
    expect: { status: 401, mustNotContain: [VICTIM_EMAIL] },
    live: { skip: 'an expired session row can only be planted in the database this harness seeds' },
  });
}

/** The auth-hint cookie is JS-readable, therefore forgeable, therefore not auth. */
for (const path of ['/api/admin/faqs']) {
  add({
    id: `auth-hint-only-${path.replace(/^\/api\//, '').replace(/[^a-z0-9]+/gi, '-')}`,
    family: 'auth',
    description: `rrm_auth=1 with no session cookie at ${path} is not a credential`,
    as: 'hint-only',
    host: 'apex',
    method: 'GET',
    path,
    expect: { status: 401 },
    live: { expect: { status: 401 } },
  });
}

/** A blocked account's live session must stop working everywhere. */
for (const path of ['/api/community/posts']) {
  add({
    id: `auth-blocked-${path.replace(/^\/api\//, '').replace(/[^a-z0-9]+/gi, '-')}`,
    family: 'auth',
    description: `a blocked user's valid session at ${path} is refused`,
    as: 'blocked',
    host: 'apex',
    method: 'GET',
    path,
    expect: { status: [401, 403] },
    live: { skip: 'needs a seeded blocked account with a live session' },
  });
}

/**
 * THE STORED SESSION ID, PRESENTED AS THE COOKIE.
 *
 * `validateSession` hashes the cookie and looks it up, then falls back to
 * matching the cookie VERBATIM against `session.id` -- a dual-read left over
 * from the plaintext-to-hashed migration. Anyone holding a row from the
 * `session` table therefore holds a working cookie, because the stored value
 * IS the accepted value on the fallback path. The hashing buys nothing
 * against a database read while that fallback is live. This case measures it
 * rather than asserting a preference.
 */
add({
  id: 'auth-stored-session-id-as-cookie',
  family: 'auth',
  description: 'the stored (hashed) session id, used as the cookie, does not authenticate',
  as: 'raw-hash',
  host: 'apex',
  method: 'GET',
  path: '/api/billing/status',
  expect: { status: 401 },
  known: 'RRMA-RT-1',
  knownNote:
    'FINDING. The stored session id authenticates: validateSession hashes the cookie, misses, then re-queries `WHERE s.id = ?` with the cookie VERBATIM (the plaintext dual-read left over from the hashed-session migration). Anyone who can read one row of the `session` table therefore holds a working cookie, so hashing at rest currently buys nothing against a database read. The fix is to retire the fallback (every plaintext row minted before the migration has long since passed the 30-day SESSION_DURATION_MS, so there is nothing left for it to serve); until then this case stays KNOWN so a regression after the fix is still caught.',
  live: { skip: 'requires a stored session id, which only a database read would give' },
});

/** A member is not staff, and a member is not an admin. */
const privilegedByPath = new Map();
for (const route of PRIVILEGED_ROUTES) if (!privilegedByPath.has(route.path)) privilegedByPath.set(route.path, route);
for (const route of [...privilegedByPath.values()].slice(0, 4)) {
  add({
    id: `auth-member-at-${slugOf(route)}`,
    family: 'auth',
    description: `a paying member is refused at ${route.method} ${route.path}`,
    as: 'member',
    host: 'apex',
    method: route.method,
    path: route.path,
    headers: jsonHeaders,
    body: bodyFor(route.path, route.method),
    expect: { status: 403, mustNotContain: [SUPERADMIN_EMAIL] },
    live: { skip: 'needs a real member session' },
  });
}

/** A moderator is not an admin. */
for (const route of [...privilegedByPath.values()].filter((r) => r.auth === 'admin').slice(0, 1)) {
  add({
    id: `auth-mod-at-${slugOf(route)}`,
    family: 'auth',
    description: `a moderator is refused at the admin route ${route.method} ${route.path}`,
    as: 'mod',
    host: 'apex',
    method: route.method,
    path: route.path,
    headers: jsonHeaders,
    body: bodyFor(route.path, route.method),
    expect: { status: [401, 403] },
    live: { skip: 'needs a real moderator session' },
  });
}

/** A wrong Bearer token is not the admin secret, and neither is an empty one. */
for (const [as, path] of [['bearer-wrong', '/api/admin/ecosystem'], ['bearer-empty', '/api/admin/cleanup']]) {
  {
    add({
      id: `auth-${as}-${path.replace(/^\/api\/admin\//, '')}`,
      family: 'auth',
      description: `${path} refuses a ${as === 'bearer-empty' ? 'blank' : 'wrong'} Bearer token`,
      as,
      host: 'apex',
      method: path.endsWith('cleanup') ? 'POST' : 'GET',
      path,
      headers: jsonHeaders,
      body: path.endsWith('cleanup') ? '{}' : undefined,
      expect: { status: 401, mustNotContain: ['ecosystem', 'gz:'] },
      live: { expect: { status: 401 } },
    });
  }
}

/** A member session is not a substitute for the machine Bearer token. */
add({
  id: 'auth-superadmin-session-at-machine-endpoint',
  family: 'auth',
  description: 'a superadmin session cookie does not open the Bearer-only ecosystem endpoint',
  as: 'superadmin',
  host: 'apex',
  method: 'GET',
  path: '/api/admin/ecosystem',
  expect: { status: 401 },
  live: { skip: 'needs a real superadmin session' },
});

// --- IDOR: another person's row, named directly --------------------------

add({
  id: 'auth-idor-delete-other-users-api-key',
  family: 'auth',
  description: "one member cannot revoke another member's MCP API key",
  as: 'other-member',
  host: 'apex',
  method: 'DELETE',
  path: `/api/account/mcp-keys/${VICTIM_KEY_ID}`,
  expect: { status: 404, mustNotContain: [VICTIM_EMAIL] },
  live: { skip: 'needs two real member sessions' },
});

add({
  id: 'auth-idor-delete-own-api-key-still-works',
  family: 'auth',
  description: 'the same request against the attacker\'s OWN key succeeds, so the 404 above is ownership and not breakage',
  as: 'other-member',
  host: 'apex',
  method: 'DELETE',
  path: `/api/account/mcp-keys/${ATTACKER_KEY_ID}`,
  expect: { status: 200, bodyIncludes: { ok: true } },
  live: { skip: 'a live run never revokes a real key' },
});

add({
  id: 'auth-idor-edit-other-users-post',
  family: 'auth',
  description: "one member cannot edit another member's community post",
  as: 'other-member',
  host: 'apex',
  method: 'PATCH',
  path: '/api/community/posts',
  headers: jsonHeaders,
  body: JSON.stringify({ postId: VICTIM_POST_ID, title: 'Redteam takeover', body: 'Rewritten by somebody else entirely.' }),
  expect: { status: 403 },
  live: { skip: 'needs two real member sessions' },
});

add({
  id: 'auth-idor-delete-other-users-post',
  family: 'auth',
  description: "one member cannot delete another member's community post",
  as: 'other-member',
  host: 'apex',
  method: 'DELETE',
  path: '/api/community/posts',
  headers: jsonHeaders,
  body: JSON.stringify({ postId: VICTIM_POST_ID }),
  expect: { status: 403 },
  live: { skip: 'needs two real member sessions' },
});

add({
  id: 'auth-idor-delete-other-users-comment',
  family: 'auth',
  description: "one member cannot delete another member's comment",
  as: 'other-member',
  host: 'apex',
  method: 'DELETE',
  path: '/api/community/comments',
  headers: jsonHeaders,
  body: JSON.stringify({ commentId: VICTIM_COMMENT_ID }),
  expect: { status: 403 },
  live: { skip: 'needs two real member sessions' },
});

add({
  id: 'auth-idor-pin-requires-moderator',
  family: 'auth',
  description: 'a member cannot pin their own post by sending pinned:true',
  as: 'member',
  host: 'apex',
  method: 'PATCH',
  path: '/api/community/posts',
  headers: jsonHeaders,
  body: JSON.stringify({ postId: VICTIM_POST_ID, pinned: true }),
  expect: { status: 403 },
  live: { skip: 'needs a real member session' },
});

add({
  id: 'auth-idor-absent-post-is-404-not-500',
  family: 'auth',
  description: 'a post id that names nothing is a clean 404, not a stack',
  as: 'member',
  host: 'apex',
  method: 'DELETE',
  path: '/api/community/posts',
  headers: jsonHeaders,
  body: JSON.stringify({ postId: NOBODYS_POST_ID }),
  expect: { status: 404, mustNotContain: STACK_MARKERS },
  live: { skip: 'needs a real member session' },
});

add({
  id: 'auth-idor-absent-api-key-is-404',
  family: 'auth',
  description: 'an API key id that names nothing is a clean 404',
  as: 'member',
  host: 'apex',
  method: 'DELETE',
  path: `/api/account/mcp-keys/${NOBODYS_KEY_ID}`,
  expect: { status: 404, mustNotContain: STACK_MARKERS },
  live: { skip: 'needs a real member session' },
});

// --- membership gate: a session is not a subscription --------------------

for (const route of ROUTES.filter((r) => r.auth === 'member').slice(0, 2)) {
  add({
    id: `auth-nosub-${slugOf(route)}`,
    family: 'auth',
    description: `a verified account with no membership is refused at ${route.method} ${route.path}`,
    as: 'verified-nosub',
    host: 'apex',
    method: route.method,
    path: route.path,
    headers: jsonHeaders,
    body: bodyFor(route.path, route.method),
    expect: { status: 403 },
    live: { skip: 'needs a real non-member session' },
  });
}

add({
  id: 'auth-unverified-cannot-post',
  family: 'auth',
  description: 'an unverified email address cannot write to the community',
  as: 'unverified',
  host: 'apex',
  method: 'POST',
  path: '/api/community/posts',
  headers: jsonHeaders,
  body: bodyFor('/api/community/posts', 'POST'),
  expect: { status: 403 },
  live: { skip: 'needs a real unverified session' },
});

// --- credential flows -----------------------------------------------------

add({
  id: 'auth-login-rate-limited',
  family: 'auth',
  description: 'six wrong-password logins from one IP: the sixth is refused by the limiter, not by the password check',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/login',
  headers: jsonHeaders,
  body: JSON.stringify({ email: VICTIM_EMAIL, password: 'Redteam-Wr0ng-Horse-Nope', turnstileToken: 'redteam-token' }),
  scenario: 'rate-limit',
  rateLimit: { count: 6, expectFinal: 429 },
  live: { skip: 'a live run never spends a real login-rate-limit budget for a real address' },
});

add({
  id: 'auth-login-unknown-and-known-are-indistinguishable',
  family: 'auth',
  description: 'a login for an address that exists and one that does not answer identically',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/login',
  scenario: 'enumeration',
  pair: {
    known: { email: VICTIM_EMAIL, password: 'Redteam-Wr0ng-Horse-Nope', turnstileToken: 'redteam-token' },
    unknown: { email: ABSENT_EMAIL, password: 'Redteam-Wr0ng-Horse-Nope', turnstileToken: 'redteam-token' },
  },
  live: { skip: 'a live pair would consume the login limiter for a real address' },
});

add({
  id: 'auth-reset-token-forged-is-refused',
  family: 'auth',
  description: 'a password-reset token that was never issued cannot set a password',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/reset-password',
  headers: jsonHeaders,
  body: JSON.stringify({ token: NOBODYS_TOKEN, password: 'Redteam-N3w-Horse-Battery' }),
  expect: { status: 400, mustNotContain: [VICTIM_EMAIL, ...STACK_MARKERS] },
  live: { expect: { status: [400, 429] } },
});

add({
  id: 'auth-reset-token-short-is-refused',
  family: 'auth',
  description: 'a one-character reset token is refused without touching the database for a match',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/reset-password',
  headers: jsonHeaders,
  body: JSON.stringify({ token: 'a', password: 'Redteam-N3w-Horse-Battery' }),
  expect: { status: 400 },
  live: { expect: { status: [400, 429] } },
});

add({
  id: 'auth-reset-token-replay-consumes-once',
  family: 'auth',
  description: 'a real reset token works once; the replay of the same token is refused',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/reset-password',
  scenario: 'reset-replay',
  live: { skip: 'a live run never redeems a real reset token' },
});

add({
  id: 'auth-session-fixation-login-mints-a-new-cookie',
  family: 'auth',
  description: 'logging in while presenting an attacker-chosen session cookie issues a different session id',
  as: 'forged',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/login',
  scenario: 'session-fixation',
  live: { skip: 'a live run never logs in as a real account' },
});

add({
  id: 'auth-signup-oversized-name-refused',
  family: 'auth',
  description: 'a 20,000-character name is refused rather than stored',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/signup',
  headers: jsonHeaders,
  body: JSON.stringify({ email: 'redteam-oversize@redteam.example', password: 'Redteam-Corr3ct-Horse', firstName: 'R'.repeat(20000), lastName: 'X', turnstileToken: 'redteam-token' }),
  expect: { status: 400 },
  live: { expect: { status: [400, 403, 429] } },
});

add({
  id: 'auth-signup-malformed-email-refused',
  family: 'auth',
  description: 'an address with no domain is refused at signup',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/signup',
  headers: jsonHeaders,
  body: JSON.stringify({ email: 'not-an-address', password: 'Redteam-Corr3ct-Horse', firstName: 'Redteam', lastName: 'Sample', turnstileToken: 'redteam-token' }),
  expect: { status: 400 },
  live: { expect: { status: [400, 403, 429] } },
});

/**
 * THE ASSERTION IS THE ROW COUNT, NOT THE STATUS.
 *
 * Signing up as VICTIM@... when victim@... exists answers 201 on purpose:
 * refusing would make signup a user-enumeration oracle, and this endpoint is
 * deliberately built not to be one. So the guarantee worth holding is not
 * "the request is refused", it is "no second account exists afterwards" --
 * which is decided by `idx_user_email_nocase`, a real unique index in the
 * schema this harness loads, and is invisible to any test that only reads
 * the status line.
 */
add({
  id: 'auth-signup-duplicate-in-different-case-creates-no-second-account',
  family: 'auth',
  description: 'signing up as VICTIM@... when victim@... exists creates no second account and reveals nothing',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/signup',
  scenario: 'signup-duplicate',
  live: { skip: 'a live run never attempts a signup against a real address' },
});

add({
  id: 'auth-signup-array-body-refused',
  family: 'auth',
  description: 'a JSON array where an object is expected is refused, not indexed',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/signup',
  headers: jsonHeaders,
  body: JSON.stringify([{ email: 'redteam-array@redteam.example' }]),
  expect: { status: 400 },
  live: { expect: { status: [400, 403, 429] } },
});

add({
  id: 'auth-change-password-needs-current-password',
  family: 'auth',
  description: 'a session alone cannot change a password without the current one',
  as: 'member',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/change-password',
  headers: jsonHeaders,
  body: JSON.stringify({ currentPassword: 'Redteam-Wr0ng-Horse-Nope', newPassword: 'Redteam-N3w-Horse-Battery' }),
  expect: { status: [400, 401, 403] },
  live: { skip: 'a live run never changes a real password' },
});

// ===========================================================================
// money -- a payment that did not happen
// ===========================================================================

add({
  id: 'money-webhook-missing-signature',
  family: 'money',
  description: 'a webhook with no stripe-signature header is refused',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/stripe-webhook',
  headers: jsonHeaders,
  body: JSON.stringify({ id: 'evt_redteam_nosig', type: 'checkout.session.completed', data: { object: {} } }),
  expect: { status: 400, mustNotContain: STACK_MARKERS },
  live: { expect: { status: 400 } },
});

add({
  id: 'money-webhook-garbage-signature',
  family: 'money',
  description: 'a webhook with a made-up signature header is refused',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/stripe-webhook',
  headers: { ...jsonHeaders, 'stripe-signature': 't=1,v1=deadbeef' },
  body: JSON.stringify({ id: 'evt_redteam_badsig', type: 'checkout.session.completed', data: { object: {} } }),
  expect: { status: 400, mustNotContain: STACK_MARKERS },
  live: { expect: { status: 400 } },
});

add({
  id: 'money-webhook-signature-over-a-different-payload',
  family: 'money',
  description: 'a signature that is valid for another body does not validate this one',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/stripe-webhook',
  scenario: 'webhook-swapped-payload',
  live: { skip: 'a live run never sends a webhook event to production' },
});

add({
  id: 'money-webhook-stale-timestamp',
  family: 'money',
  description: 'a correctly signed event timestamped an hour ago is outside the tolerance and refused',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/stripe-webhook',
  scenario: 'webhook-stale-timestamp',
  live: { skip: 'a live run never sends a webhook event to production' },
});

add({
  id: 'money-webhook-unknown-event-type-is-acknowledged',
  family: 'money',
  description: 'a signed event of a type nobody handles answers 2xx, so Stripe stops retrying it',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/stripe-webhook',
  scenario: 'webhook-unknown-type',
  live: { skip: 'a live run never sends a webhook event to production' },
});

add({
  id: 'money-webhook-replay-writes-once',
  family: 'money',
  description: 'the same signed event delivered twice is processed once and acknowledged twice',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/stripe-webhook',
  scenario: 'webhook-replay',
  live: { skip: 'a live run never sends a webhook event to production' },
});

add({
  id: 'money-webhook-bad-signature-costs-nothing',
  family: 'money',
  description: 'a webhook that fails signature verification writes no row and sends no mail',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/stripe-webhook',
  headers: { ...jsonHeaders, 'stripe-signature': 't=1,v1=deadbeef' },
  body: JSON.stringify({ id: 'evt_redteam_cost', type: 'checkout.session.completed', data: { object: { customer_email: VICTIM_EMAIL } } }),
  expect: { status: 400, spends: { ses: 0, stripe: 0, dbWrites: 0 } },
  live: { skip: 'spend assertions are only observable in process' },
});

/** Amounts the donation path must not accept. */
const BAD_AMOUNTS = [
  ['negative', -5000],
  ['zero', 0],
  ['below-minimum', 1],
  ['absurd', 99999999999],
];
for (const [label, amount] of BAD_AMOUNTS) {
  add({
    id: `money-checkout-amount-${label}`,
    family: 'money',
    description: `a one-off donation of ${JSON.stringify(amount)} is refused before Stripe is called`,
    as: 'none',
    host: 'apex',
    method: 'POST',
    path: '/api/create-checkout',
    headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.7' },
    body: JSON.stringify({ mode: 'payment', amount }),
    expect: { status: 400, spends: { stripe: 0 }, mustNotContain: STACK_MARKERS },
    live: { expect: { status: [400, 429] } },
  });
}

add({
  id: 'money-checkout-unknown-tier',
  family: 'money',
  description: 'a membership tier nobody sells is refused',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/create-checkout',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.8' },
  body: JSON.stringify({ mode: 'subscription', tier: 'redteam-free-forever' }),
  expect: { status: 400, spends: { stripe: 0 } },
  live: { expect: { status: [400, 429] } },
});

add({
  id: 'money-checkout-injected-price-id-ignored',
  family: 'money',
  description: 'a Stripe price id supplied in the body does not become the price that is charged',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/create-checkout',
  scenario: 'checkout-price-injection',
  live: { skip: 'a live run never creates a real checkout session' },
});

add({
  id: 'money-checkout-injected-currency-ignored',
  family: 'money',
  description: 'a currency supplied in the body does not reach Stripe',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/create-checkout',
  scenario: 'checkout-currency-injection',
  live: { skip: 'a live run never creates a real checkout session' },
});

add({
  id: 'money-checkout-invalid-mode',
  family: 'money',
  description: 'a checkout mode that is neither payment nor subscription is refused first',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/create-checkout',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.10' },
  body: JSON.stringify({ mode: 'setup', amount: 2500 }),
  expect: { status: 400, spends: { stripe: 0 } },
  live: { expect: { status: [400, 429] } },
});

add({
  id: 'money-checkout-rate-limited',
  family: 'money',
  description: 'six checkout attempts from one IP: the sixth is refused before Stripe is called',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/create-checkout',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.11' },
  body: JSON.stringify({ mode: 'payment', amount: 2500 }),
  scenario: 'rate-limit',
  rateLimit: { count: 6, expectFinal: 429 },
  live: { skip: 'a live run never spends a real checkout-rate-limit budget' },
});

add({
  id: 'money-membership-without-payment',
  family: 'money',
  description: 'a verified account with no subscription cannot read the members-only roster',
  as: 'verified-nosub',
  host: 'apex',
  method: 'GET',
  path: '/api/community/members',
  expect: { status: 403, mustNotContain: [VICTIM_EMAIL] },
  live: { skip: 'needs a real non-member session' },
});

add({
  id: 'money-portal-without-a-customer',
  family: 'money',
  description: 'a member with no Stripe customer cannot open a billing portal session',
  as: 'member',
  host: 'apex',
  method: 'POST',
  path: '/api/billing/portal',
  headers: jsonHeaders,
  body: '{}',
  expect: { status: [400, 403, 404], mustNotContain: STACK_MARKERS },
  live: { skip: 'needs a real member session' },
});

add({
  id: 'money-supporter-badge-malformed-session-id',
  family: 'money',
  description: 'a badge lookup with a session id that is not a cs_ id is refused before Stripe',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/billing/supporter-badge',
  query: '?session_id=%27%20OR%201%3D1--',
  headers: { 'CF-Connecting-IP': '203.0.113.12' },
  expect: { status: 400, spends: { stripe: 0 } },
  live: { expect: { status: [400, 429] } },
});

add({
  id: 'money-checkout-account-oracle-shape',
  family: 'money',
  description: 'the account-existence oracle refuses a malformed session id without calling Stripe',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/billing/checkout-account',
  query: '?session_id=redteam-not-a-cs-id',
  headers: { 'CF-Connecting-IP': '203.0.113.13' },
  expect: { status: 400, spends: { stripe: 0 } },
  live: { expect: { status: [400, 429] } },
});

// ===========================================================================
// pii -- the writes that carry a person
// ===========================================================================

add({
  id: 'pii-survey-unknown-token',
  family: 'pii',
  description: 'a survey submission quoting a token nobody issued stores nothing',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/survey/submit',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.20' },
  body: bodyFor('/api/survey/submit', 'POST'),
  expect: { status: 404, spends: { dbWrites: 0, ses: 0 } },
  live: { expect: { status: [404, 429] } },
});

add({
  id: 'pii-survey-token-oversized',
  family: 'pii',
  description: 'a 4 KB survey token is refused on shape before any KV read',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/survey/submit',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.21' },
  body: JSON.stringify({ token: 'T'.repeat(4096), symptoms: { tier1: [], tier2: [], tier3: [] }, score: { total: 0, tier1: 0, tier2: 0, tier3: 0 } }),
  expect: { status: 400, spends: { dbWrites: 0 } },
  live: { expect: { status: [400, 429] } },
});

add({
  id: 'pii-survey-too-many-symptoms',
  family: 'pii',
  description: 'a tier carrying 500 symptoms is refused by the item cap',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/survey/submit',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.22' },
  body: JSON.stringify({ token: 'redteam-survey-token', symptoms: { tier1: new Array(500).fill('pain'), tier2: [], tier3: [] }, score: { total: 1, tier1: 1, tier2: 0, tier3: 0 } }),
  expect: { status: 400, spends: { dbWrites: 0 } },
  live: { expect: { status: [400, 429] } },
});

add({
  id: 'pii-survey-symptom-string-too-long',
  family: 'pii',
  description: 'a single 10,000-character symptom is refused by the length cap',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/survey/submit',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.23' },
  body: JSON.stringify({ token: 'redteam-survey-token', symptoms: { tier1: ['x'.repeat(10000)], tier2: [], tier3: [] }, score: { total: 1, tier1: 1, tier2: 0, tier3: 0 } }),
  expect: { status: 400, spends: { dbWrites: 0 } },
  live: { expect: { status: [400, 429] } },
});

add({
  id: 'pii-survey-score-out-of-range',
  family: 'pii',
  description: 'a score of one million is refused by the range check',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/survey/submit',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.24' },
  body: JSON.stringify({ token: 'redteam-survey-token', symptoms: { tier1: ['pain'], tier2: [], tier3: [] }, score: { total: 1000000, tier1: 0, tier2: 0, tier3: 0 } }),
  expect: { status: 400, spends: { dbWrites: 0 } },
  live: { expect: { status: [400, 429] } },
});

add({
  id: 'pii-survey-symptoms-not-arrays',
  family: 'pii',
  description: 'symptoms sent as strings rather than arrays are refused, not coerced',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/survey/submit',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.25' },
  body: JSON.stringify({ token: 'redteam-survey-token', symptoms: { tier1: 'pain', tier2: 'more', tier3: 'worse' }, score: { total: 1, tier1: 1, tier2: 0, tier3: 0 } }),
  expect: { status: 400, spends: { dbWrites: 0 } },
  live: { expect: { status: [400, 429] } },
});

add({
  id: 'pii-survey-not-json',
  family: 'pii',
  description: 'a form-encoded survey submission is refused rather than parsed loosely',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/survey/submit',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.26' },
  body: 'token=redteam-survey-token&score=5',
  expect: { status: 400, spends: { dbWrites: 0 } },
  live: { expect: { status: [400, 429] } },
});

add({
  id: 'pii-survey-token-replayed',
  family: 'pii',
  description: 'a valid survey token submits once; the replay is refused and writes no second row',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/survey/submit',
  scenario: 'survey-replay',
  live: { skip: 'a live run never submits a real survey' },
});

add({
  id: 'pii-pseudonymisation-split-holds',
  family: 'pii',
  description: 'a real survey submission writes symptoms to one database and the address to the other, and the symptom store never sees the address',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/survey/submit',
  scenario: 'pseudonymisation',
  live: { skip: 'a live run never submits a real survey' },
});

add({
  id: 'pii-survey-script-in-free-text-is-stored-verbatim-not-executed',
  family: 'pii',
  description: 'a script tag in a symptom value is stored as text and never echoed into a response body',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/survey/submit',
  scenario: 'survey-script-payload',
  live: { skip: 'a live run never submits a real survey' },
});

add({
  id: 'pii-contact-honeypot-sends-no-mail',
  family: 'pii',
  description: 'a filled honeypot field answers 200 to the bot and sends nothing',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/contact/submit',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.30' },
  body: JSON.stringify({ website: 'https://redteam.example', name: 'Redteam Bot', email: 'bot@redteam.example', message: 'Buy my product, this is a long enough message.' }),
  expect: { status: 200, spends: { ses: 0 } },
  live: { skip: 'a live run never posts a contact form' },
});

add({
  id: 'pii-contact-oversized-message',
  family: 'pii',
  description: 'a 50,000-character contact message is refused and no mail leaves',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/contact/submit',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.31' },
  body: JSON.stringify({ name: 'Redteam Sender', email: 'redteam@redteam.example', message: 'M'.repeat(50000), turnstileToken: 'redteam-token' }),
  expect: { status: 400, spends: { ses: 0 } },
  live: { expect: { status: [400, 403, 429] } },
});

add({
  id: 'pii-contact-short-message',
  family: 'pii',
  description: 'a two-character contact message is refused by the minimum-length check',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/contact/submit',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.32' },
  body: JSON.stringify({ name: 'Redteam Sender', email: 'redteam@redteam.example', message: 'hi', turnstileToken: 'redteam-token' }),
  expect: { status: 400, spends: { ses: 0 } },
  live: { expect: { status: [400, 403, 429] } },
});

add({
  id: 'pii-contact-malformed-email',
  family: 'pii',
  description: 'a contact form with no address domain is refused before the mailer',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/contact/submit',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.33' },
  body: JSON.stringify({ name: 'Redteam Sender', email: 'redteam-at-nowhere', message: 'A message that is comfortably long enough to pass.', turnstileToken: 'redteam-token' }),
  expect: { status: 400, spends: { ses: 0 } },
  live: { expect: { status: [400, 403, 429] } },
});

add({
  id: 'pii-contact-name-is-not-an-injection-vector',
  family: 'pii',
  description: 'a name carrying CRLF and a forged header line does not become a header in the notification mail',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/contact/submit',
  scenario: 'contact-header-injection',
  live: { skip: 'a live run never posts a contact form' },
});

add({
  id: 'pii-contact-not-json',
  family: 'pii',
  description: 'a contact submission that is not JSON is refused',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/contact/submit',
  headers: { 'content-type': 'text/plain', 'CF-Connecting-IP': '203.0.113.34' },
  body: 'name=Redteam&message=hello',
  expect: { status: 400, spends: { ses: 0 } },
  live: { expect: { status: [400, 403, 429] } },
});

for (const [path, ip, label] of [
  ['/api/newsletter/subscribe', '203.0.113.40', 'newsletter'],
  ['/api/events/register', '203.0.113.41', 'event registration'],
  ['/api/pdf/request', '203.0.113.43', 'guide download'],
  ['/api/survey/request', '203.0.113.46', 'survey invitation'],
]) {
  add({
    id: `pii-malformed-email-${label.replace(/\s+/g, '-')}`,
    family: 'pii',
    description: `a ${label} for an address with no domain is refused and mails nobody`,
    as: 'none',
    host: 'apex',
    method: 'POST',
    path,
    headers: { ...jsonHeaders, 'CF-Connecting-IP': ip },
    body: JSON.stringify({ ...JSON.parse(bodyFor(path, 'POST')), email: 'redteam-at-nowhere' }),
    expect: { status: [400, 403], spends: { ses: 0 } },
    live: { expect: { status: [400, 403, 429] } },
  });
}

add({
  id: 'pii-survey-validate-missing-token',
  family: 'pii',
  description: 'the token-validation probe with no token is refused rather than answering about nothing',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/survey/validate',
  expect: { status: 400, mustNotContain: [VICTIM_EMAIL, ...STACK_MARKERS] },
  live: { expect: { status: 400 } },
});

add({
  id: 'pii-survey-validate-does-not-return-the-address',
  family: 'pii',
  description: 'a token probe for a token that DOES exist never answers with the address behind it',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/survey/validate',
  scenario: 'survey-validate-no-address',
  live: { skip: 'a live run has no seeded token to probe' },
});

add({
  id: 'pii-community-post-oversized-title',
  family: 'pii',
  description: 'a 5,000-character post title is refused rather than truncated into the database',
  as: 'member',
  host: 'apex',
  method: 'POST',
  path: '/api/community/posts',
  headers: jsonHeaders,
  body: JSON.stringify({ type: 'discussion', title: 'T'.repeat(5000), body: 'A body that is long enough to be a real post.' }),
  expect: { status: 400 },
  live: { skip: 'a live run never posts to the real community' },
});

add({
  id: 'pii-community-post-type-escalation',
  family: 'pii',
  description: 'a member cannot create a staff-only announcement by naming the type',
  as: 'member',
  host: 'apex',
  method: 'POST',
  path: '/api/community/posts',
  headers: jsonHeaders,
  body: JSON.stringify({ type: 'announcement', title: 'Redteam announcement', body: 'Pretending to be staff, at length.' }),
  expect: { status: 403 },
  live: { skip: 'a live run never posts to the real community' },
});

// ===========================================================================
// leak -- what a refusal says
// ===========================================================================

/** Secrets and binding names, on the refusals most likely to carry them. */
for (const [id, method, path, as, body] of [
  ['leak-webhook-bad-signature', 'POST', '/api/stripe-webhook', 'none', JSON.stringify({ id: 'evt_leak', type: 'checkout.session.completed', data: { object: {} } })],
  ['leak-checkout-bad-amount', 'POST', '/api/create-checkout', 'none', JSON.stringify({ mode: 'payment', amount: -1 })],
  ['leak-admin-wrong-bearer', 'GET', '/api/admin/ecosystem', 'bearer-wrong', undefined],
  ['leak-billing-status-anon', 'GET', '/api/billing/status', 'none', undefined],
  ['leak-community-posts-anon', 'GET', '/api/community/posts', 'none', undefined],
  ['leak-saved-anon', 'GET', '/api/saved', 'none', undefined],
]) {
  add({
    id,
    family: 'leak',
    description: `${method} ${path} refuses without naming a secret, a binding or a stack frame`,
    as,
    host: 'apex',
    method,
    path,
    headers: { ...jsonHeaders, 'stripe-signature': 't=1,v1=deadbeef', 'CF-Connecting-IP': '203.0.113.50' },
    body,
    expect: { mustNotContain: [...STACK_MARKERS, ...BINDING_NAMES], secretsAbsent: true },
    live: { expect: { mustNotContain: [...STACK_MARKERS, ...BINDING_NAMES] } },
  });
}

add({
  id: 'leak-internal-error-carries-no-stack',
  family: 'leak',
  description: 'a route whose database throws answers a generic 500 rather than the engine error',
  as: 'member',
  host: 'apex',
  method: 'GET',
  path: '/api/saved',
  scenario: 'db-throws',
  live: { skip: 'a live run never breaks a production binding' },
});

add({
  id: 'leak-login-known-vs-unknown-identical',
  family: 'leak',
  description: 'the login refusal for an address that exists is byte-identical to one that does not',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/login',
  scenario: 'enumeration',
  pair: {
    known: { email: VICTIM_EMAIL, password: 'Redteam-Wr0ng-Horse-Nope', turnstileToken: 'redteam-token' },
    unknown: { email: ABSENT_EMAIL, password: 'Redteam-Wr0ng-Horse-Nope', turnstileToken: 'redteam-token' },
  },
  live: { skip: 'a live pair would consume the login limiter for a real address' },
});

add({
  id: 'leak-forgot-password-known-vs-unknown-identical',
  family: 'leak',
  description: 'the password-reset response does not reveal whether the address has an account',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/forgot-password',
  scenario: 'enumeration',
  pair: {
    known: { email: VICTIM_EMAIL, turnstileToken: 'redteam-token' },
    unknown: { email: ABSENT_EMAIL, turnstileToken: 'redteam-token' },
  },
  live: { skip: 'a live pair would send a real reset mail to a real address' },
});

add({
  id: 'leak-signup-known-vs-unknown-shape',
  family: 'leak',
  description: 'signup for an existing address and a fresh one differ only in the way the product requires',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/auth/signup',
  scenario: 'enumeration',
  pair: {
    known: { email: VICTIM_EMAIL, password: 'Redteam-Corr3ct-Horse', firstName: 'Redteam', lastName: 'Sample', turnstileToken: 'redteam-token' },
    unknown: { email: 'redteam-fresh@redteam.example', password: 'Redteam-Corr3ct-Horse', firstName: 'Redteam', lastName: 'Sample', turnstileToken: 'redteam-token' },
  },
  known: 'RRMA-RT-2',
  knownNote:
    'FINDING. Signup is a user-enumeration oracle by RESPONSE SHAPE. Both answers are 201 and both say {ok:true, emailVerificationRequired:true}, which is clearly the intended non-enumerable design -- but the NEW-account arm (signup.js:277) adds `resendPath: "/api/auth/resend-verification"` and the EXISTING-account arms (signup.js:174, 179) do not. The presence of that one key tells an attacker whether an address already has an account, at 201 either way, with no timing measurement needed. The fix is to emit the same key set on both arms.',
  live: { skip: 'a live pair would create a real account' },
});

add({
  id: 'leak-members-roster-not-public',
  family: 'leak',
  description: 'the member roster is not readable without a membership, and the refusal carries no address',
  as: 'verified-nosub',
  host: 'apex',
  method: 'GET',
  path: '/api/community/members',
  expect: { status: 403, mustNotContain: [VICTIM_EMAIL], secretsAbsent: true },
  live: { skip: 'needs a real non-member session' },
});

add({
  id: 'leak-community-posts-anon-carries-no-post-body',
  family: 'leak',
  description: 'the unauthenticated community refusal contains no seeded post content',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/community/posts',
  expect: { status: 401, mustNotContain: ['Seeded body for the IDOR cases', VICTIM_POST_ID] },
  live: { expect: { status: 401 } },
});

add({
  id: 'leak-session-probe-anonymous-is-empty',
  family: 'leak',
  description: 'the session probe answers anonymous without naming any account',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/auth/session',
  expect: { status: 200, bodyIncludes: { ok: true, user: null }, mustNotContain: [VICTIM_EMAIL] },
  live: { expect: { status: 200, bodyIncludes: { ok: true, user: null } } },
});

add({
  id: 'leak-community-status-anonymous-is-empty',
  family: 'leak',
  description: 'the community status probe answers anonymous without naming any account',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/community/status',
  expect: { status: 200, bodyIncludes: { access: 'anonymous' }, mustNotContain: [VICTIM_EMAIL] },
  live: { expect: { status: 200, bodyIncludes: { access: 'anonymous' } } },
});

add({
  id: 'leak-admin-410-page-names-no-route',
  family: 'leak',
  description: 'the retired /admin surface answers 410 and lists none of the endpoints behind it',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/admin/members',
  expect: { status: 410, mustNotContain: ['/api/admin/', 'ADMIN_API_SECRET'] },
  /* Live, the rrm-router Worker sits in front and normalises the missing
     trailing slash for some user agents before Pages is reached: the same
     path answers 410 to curl's default UA and 301 to
     /admin/members/ to this harness's. Either way no admin content is
     served, and the destination's own 410 is held by
     headers-admin-surface-is-gone, which requests the slashed form. The
     claim this case makes -- an /admin path never serves admin content and
     never names a route behind it -- is unchanged. */
  live: { expect: { status: [301, 410], mustNotContain: ['/api/admin/', 'ADMIN_API_SECRET'] } },
});

add({
  id: 'leak-sql-shaped-input-is-not-executed',
  family: 'leak',
  description: 'a post id shaped like a SQL fragment is a 404, not an engine error',
  as: 'member',
  host: 'apex',
  method: 'DELETE',
  path: '/api/community/posts',
  headers: jsonHeaders,
  body: JSON.stringify({ postId: "' OR 1=1 --" }),
  expect: { status: 404, mustNotContain: STACK_MARKERS },
  live: { skip: 'needs a real member session' },
});

add({
  id: 'leak-sql-shaped-key-id-is-not-executed',
  family: 'leak',
  description: 'an API key id shaped like a SQL fragment is a 404, not an engine error',
  as: 'member',
  host: 'apex',
  method: 'DELETE',
  path: "/api/account/mcp-keys/'%20OR%201%3D1--",
  expect: { status: [400, 404], mustNotContain: STACK_MARKERS },
  live: { skip: 'needs a real member session' },
});

// ===========================================================================
// headers -- the browser-facing contract
// ===========================================================================

const SECURITY_HEADERS = [
  ['strict-transport-security', /max-age=\d{7,}/],
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'SAMEORIGIN'],
  ['content-security-policy', /default-src 'self'/],
];
for (const [header, matcher] of SECURITY_HEADERS) {
  add({
    id: `headers-${header}`,
    family: 'headers',
    description: `${header} is present on an API response`,
    as: 'none',
    host: 'apex',
    method: 'GET',
    path: '/api/community/status',
    expect: { status: 200, headerMatches: { [header]: matcher } },
    live: { expect: { status: 200, headerMatches: { [header]: matcher } } },
  });
}

add({
  id: 'headers-cors-does-not-echo-a-foreign-origin',
  family: 'headers',
  description: 'a request from an attacker origin is answered with the apex origin, never its own',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/community/status',
  headers: { Origin: 'https://redteam-attacker.example' },
  expect: {
    status: 200,
    headerMatches: { 'access-control-allow-origin': 'https://rrmacademy.org' },
    mustNotContain: ['redteam-attacker.example'],
  },
  live: { expect: { status: 200, headerMatches: { 'access-control-allow-origin': 'https://rrmacademy.org' } } },
});

add({
  id: 'headers-cors-preflight-does-not-echo-a-foreign-origin',
  family: 'headers',
  description: 'an OPTIONS preflight from an attacker origin is answered with the apex origin',
  as: 'none',
  host: 'apex',
  method: 'OPTIONS',
  path: '/api/community/posts',
  headers: { Origin: 'https://redteam-attacker.example', 'Access-Control-Request-Method': 'POST' },
  expect: { status: 204, headerMatches: { 'access-control-allow-origin': 'https://rrmacademy.org' } },
  live: { expect: { status: 204, headerMatches: { 'access-control-allow-origin': 'https://rrmacademy.org' } } },
});

add({
  id: 'headers-credentialed-cors-is-not-wildcarded',
  family: 'headers',
  description: 'the credentialed CORS contract never pairs Allow-Credentials with a wildcard origin',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/community/status',
  headers: { Origin: 'https://redteam-attacker.example' },
  expect: { status: 200, headerAbsentValue: { 'access-control-allow-origin': '*' } },
  live: { expect: { status: 200, headerAbsentValue: { 'access-control-allow-origin': '*' } } },
});

add({
  id: 'headers-api-is-no-store',
  family: 'headers',
  description: 'an API response carries Cache-Control: no-store, so a shared cache never holds member data',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/community/status',
  hermetic: { skip: 'no-store for /api/* comes from public/_headers, a platform layer that is not in this process' },
  known: 'RRMA-RT-3',
  knownNote:
    'FINDING, found by the live run and confirmed by hand. `public/_headers` declares `/api/* Cache-Control: no-store`, but a GET that REACHES A PAGES FUNCTION answers 200 with no Cache-Control header at all. `_headers` applies to responses Pages serves itself and not to Function responses: `curl -I` (HEAD, which no API module exports, so Pages answers its own 404) returns `cache-control: no-store`, while `curl -X GET` on the same path returns 200 with the header absent. The declared control has therefore never applied to the endpoints it was written for, including the authenticated ones (/api/billing/status, /api/community/members, /api/auth/session). The fix belongs in withSecurityHeaders() in functions/_middleware.js, which is already where this repo moved the other security headers for exactly this reason -- its own comment records that the _headers catch-all corrupted Function responses.',
  live: { expect: { status: 200, headerMatches: { 'cache-control': /no-store/ } } },
});

add({
  id: 'headers-preview-host-is-noindex',
  family: 'headers',
  description: 'the pages.dev preview host adds X-Robots-Tag: noindex',
  as: 'none',
  host: 'preview',
  method: 'GET',
  path: '/api/community/status',
  expect: { status: 200, headerMatches: { 'x-robots-tag': 'noindex' } },
  live: { skip: 'the live run targets the apex, which must NOT carry noindex' },
});

add({
  id: 'headers-apex-is-not-noindex',
  family: 'headers',
  description: 'the apex does not carry the preview noindex header',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/community/status',
  expect: { status: 200, headerAbsent: ['x-robots-tag'] },
  live: { expect: { status: 200, headerAbsent: ['x-robots-tag'] } },
});

add({
  id: 'headers-admin-surface-is-gone',
  family: 'headers',
  description: 'every /admin path answers 410 with security headers intact',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/admin/',
  expect: { status: 410, headerMatches: { 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex' } },
  live: { expect: { status: 410 } },
});

add({
  id: 'headers-api-is-not-trailing-slash-redirected',
  family: 'headers',
  description: 'an API path is answered, not 301-ed into a trailing-slash form that would drop a body',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/community/status',
  expect: { status: 200 },
  live: { expect: { status: 200 } },
});

add({
  id: 'headers-library-subdomain-redirects-to-the-subfolder',
  family: 'headers',
  description: 'the retired library subdomain 301s into the apex subfolder rather than serving anything',
  as: 'none',
  host: 'library',
  method: 'GET',
  path: '/some-article/',
  expect: { status: 301, headerMatches: { location: /^https:\/\/rrmacademy\.org\/library\// } },
  live: { skip: 'the live run targets the apex; the subdomain is a DNS-level concern' },
});

add({
  id: 'headers-error-response-keeps-security-headers',
  family: 'headers',
  description: 'a 401 still carries the security headers, so a refusal is not a hole in the contract',
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/saved',
  expect: { status: 401, headerMatches: { 'x-content-type-options': 'nosniff', 'strict-transport-security': /max-age=\d{7,}/ } },
  live: { expect: { status: 401, headerMatches: { 'x-content-type-options': 'nosniff' } } },
});

add({
  id: 'headers-csp-has-no-unsafe-eval',
  family: 'headers',
  description: "the CSP does not permit 'unsafe-eval'",
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/community/status',
  expect: { status: 200, headerAbsentSubstring: { 'content-security-policy': "'unsafe-eval'" } },
  live: { expect: { status: 200, headerAbsentSubstring: { 'content-security-policy': "'unsafe-eval'" } } },
});

add({
  id: 'headers-csp-object-src-is-none',
  family: 'headers',
  description: "the CSP pins object-src to 'none'",
  as: 'none',
  host: 'apex',
  method: 'GET',
  path: '/api/community/status',
  expect: { status: 200, headerMatches: { 'content-security-policy': /object-src 'none'/ } },
  live: { expect: { status: 200, headerMatches: { 'content-security-policy': /object-src 'none'/ } } },
});

// ===========================================================================
// cost -- what an unauthorised request may spend
// ===========================================================================

/**
 * EVERY PUBLIC WRITE ROUTE, WITH A BODY THAT CANNOT SUCCEED.
 *
 * The assertion is not the status. It is that the request cost nothing: no
 * row written in any of the four databases, no mail handed to SES, no call to
 * Stripe, no Workers AI inference. A route that validates late spends money
 * on garbage, and only a counting fake can say so.
 */
/* The public writes that cost real money or carry a real person, rather than
   every public write: the cheap ones are already covered by the pii family's
   own spend assertions, and a sweep is only worth its runtime where the spend
   is. */
const COSTLY_PUBLIC = new Set([
  '/api/create-checkout', '/api/stripe-webhook', '/api/contact/submit',
  '/api/survey/submit', '/api/survey/request', '/api/quiz/request',
  '/api/endo-quiz/request', '/api/newsletter/subscribe',
]);
for (const route of PUBLIC_WRITE_ROUTES.filter((r) => COSTLY_PUBLIC.has(r.path))) {
  add({
    id: `cost-garbage-${slugOf(route)}`,
    family: 'cost',
    description: `a malformed ${route.path} request spends nothing`,
    as: 'none',
    host: 'apex',
    method: route.method,
    path: route.path,
    headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.60' },
    body: JSON.stringify({ redteam: 'not a valid payload for anything' }),
    expect: { spends: { ses: 0, stripe: 0, ai: 0, r2Put: 0 } },
    live: { skip: 'spend assertions are only observable in process' },
  });
}

/** An unauthenticated read of a gated route must not write either. */
for (const route of [...SESSION_ROUTES, ...PRIVILEGED_ROUTES].filter((r) => r.writes).slice(0, 3)) {
  add({
    id: `cost-anon-write-attempt-${slugOf(route)}`,
    family: 'cost',
    description: `an unauthenticated ${route.method} ${route.path} writes no row and sends no mail`,
    as: 'none',
    host: 'apex',
    method: route.method,
    path: route.path,
    headers: jsonHeaders,
    body: bodyFor(route.path, route.method),
    expect: { status: 401, spends: { dbWrites: 0, ses: 0, stripe: 0, r2Put: 0 } },
    live: { skip: 'spend assertions are only observable in process' },
  });
}

add({
  id: 'cost-forged-session-writes-nothing',
  family: 'cost',
  description: 'a forged cookie at a write route costs one session lookup and nothing else',
  as: 'forged',
  host: 'apex',
  method: 'POST',
  path: '/api/community/posts',
  headers: jsonHeaders,
  body: bodyFor('/api/community/posts', 'POST'),
  expect: { status: 401, spends: { dbWrites: 0, ses: 0, r2Put: 0 } },
  live: { skip: 'spend assertions are only observable in process' },
});

add({
  id: 'cost-upload-refused-before-r2',
  family: 'cost',
  description: 'an unauthenticated upload never reaches the asset bucket',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/community/upload',
  headers: jsonHeaders,
  body: '{}',
  expect: { status: 401, spends: { r2Put: 0 } },
  live: { skip: 'spend assertions are only observable in process' },
});

add({
  id: 'cost-anon-checkout-does-not-reach-stripe',
  family: 'cost',
  description: 'a checkout with an unusable amount never calls Stripe',
  as: 'none',
  host: 'apex',
  method: 'POST',
  path: '/api/create-checkout',
  headers: { ...jsonHeaders, 'CF-Connecting-IP': '203.0.113.61' },
  body: JSON.stringify({ mode: 'payment', amount: -1 }),
  expect: { status: 400, spends: { stripe: 0 } },
  live: { skip: 'spend assertions are only observable in process' },
});

export const CASES = Object.freeze(cases);

/** Case counts per family, for the report header and the suite's own check. */
export function countByFamily(results = CASES) {
  const counts = {};
  for (const item of results) counts[item.family] = (counts[item.family] ?? 0) + 1;
  return counts;
}
