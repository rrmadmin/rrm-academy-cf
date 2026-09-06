/**
 * WHAT A RED-TEAM TARGET IS: the three facts a case needs in order to be a
 * request rather than a sentence -- which hostnames the site answers on,
 * which identities can be minted or supplied for it, and which routes exist.
 *
 * THIS FILE IS THE ONLY SITE-SPECIFIC PART OF THE HARNESS. `cases.mjs` names
 * hosts, identities and routes by KEY; `run.mjs` resolves those keys through
 * this module. A second property would add its own target module beside this
 * one, its own case table, and reuse the runner unchanged.
 *
 * THE ROLE LADDER IS READ FROM `functions/api/auth/_shared.js`, NEVER
 * RETYPED. `roleAtLeast` is the thing under attack in the whole admin family,
 * so a copy of the ladder here would be a harness that passes against its own
 * copy while production drifts.
 */

import { roleAtLeast } from '../../functions/api/auth/_shared.js';

export const APEX = 'rrmacademy.org';
export const PREVIEW = 'rrm-academy.pages.dev';
export const LIBRARY_SUBDOMAIN = 'library.rrmacademy.org';

/** Every role the ladder admits, cheapest first, asserted against the ladder. */
export const ROLE_LADDER = Object.freeze(['member', 'mod', 'admin', 'superadmin']);
for (let i = 1; i < ROLE_LADDER.length; i += 1) {
  if (!roleAtLeast(ROLE_LADDER[i], ROLE_LADDER[i - 1])) {
    throw new Error(`redteam: the role ladder in targets.mjs disagrees with roleAtLeast (${ROLE_LADDER[i]} < ${ROLE_LADDER[i - 1]})`);
  }
}

/**
 * Ids that are well-formed, constant, and nobody's. They pass every shape
 * check the endpoints apply and match no row in any seeded database, so a
 * case can ask for "some post" or "some key" without committing a real
 * identifier to this repo and without naming a member if it is sent live.
 */
export const NOBODYS_POST_ID = 'post_redteam_absent_0000000000';
export const NOBODYS_COMMENT_ID = 'cmt_redteam_absent_0000000000';
export const NOBODYS_KEY_ID = 'mcpk_redteam_absent_000000000';
export const NOBODYS_TOKEN = 'a'.repeat(64);

/** The two seeded members, so a case can name "the other user's row". */
export const VICTIM_POST_ID = 'post_seed_victim';
export const ATTACKER_POST_ID = 'post_seed_attacker';
export const VICTIM_COMMENT_ID = 'cmt_seed_victim';
export const VICTIM_KEY_ID = 'mcpk_seed_victim';
export const ATTACKER_KEY_ID = 'mcpk_seed_attacker';

/** The seeded course and its first step, for the course-platform cases. */
export const SEEDED_COURSE_ID = 'redteam-course';
export const SEEDED_STEP_ID = 'redteam-step-1';

/** The seeded FAQ, for the admin-CRUD cases. */
export const SEEDED_FAQ_ID = 'faq_redteam_seed';

/**
 * The password every seeded account carries. Not a secret: it exists only
 * inside this harness's in-memory SQLite, and the login family needs BOTH a
 * credential that works and one that does not in order to prove the two
 * answers are indistinguishable.
 */
export const SEEDED_PASSWORD = 'Redteam-Corr3ct-Horse';
export const WRONG_PASSWORD = 'Redteam-Wr0ng-Horse-Nope';

/**
 * The identities a case may be sent as. `kind` is what the runner switches
 * on; everything else is that kind's own configuration.
 *
 *   none          no cookie at all
 *   session       a real session row, minted hashed exactly as createSession does
 *   raw-hash      the cookie set to the STORED (hashed) session id, which is
 *                 what an attacker holding a leaked `session` row would have.
 *                 validateSession's plaintext dual-read fallback made it work;
 *                 the fallback is gone (RRMA-RT-1) and this identity is now the
 *                 regression alarm on its return.
 *   forged        a well-formed session id that was never issued
 *   expired       a real row whose expires_at is in the past
 *   header-only   the auth-hint cookie (`rrm_auth=1`) and nothing else, which
 *                 is the cookie client JS can read and therefore can forge
 *   bearer        an Authorization: Bearer value, for the machine endpoints
 *
 * `member` is deliberately the rung that PASSES requireMember (verified email
 * plus an active wix_subscription row). `verified-nosub` is the rung that
 * does not, and it owns the membership-gate cases: a harness whose only
 * member identity was already refused by the gate would "prove" an endpoint
 * safe by never having reached it.
 */
export const IDENTITIES = Object.freeze({
  'none': { kind: 'none' },
  'member': { kind: 'session', user: 'member' },
  'other-member': { kind: 'session', user: 'other' },
  'verified-nosub': { kind: 'session', user: 'nosub' },
  'unverified': { kind: 'session', user: 'unverified' },
  'blocked': { kind: 'session', user: 'blocked' },
  'mod': { kind: 'session', user: 'mod' },
  'admin': { kind: 'session', user: 'admin' },
  'superadmin': { kind: 'session', user: 'superadmin' },
  'expired': { kind: 'expired', user: 'member' },
  'forged': { kind: 'forged' },
  'raw-hash': { kind: 'raw-hash', user: 'member' },
  'hint-only': { kind: 'hint-only' },
  'bearer-wrong': { kind: 'bearer', token: 'redteam-not-the-admin-secret' },
  'bearer-empty': { kind: 'bearer', token: '' },
});

/** The hostnames a case may be sent to. */
export const HOSTS = Object.freeze({
  apex: { hostname: APEX },
  preview: { hostname: PREVIEW },
  library: { hostname: LIBRARY_SUBDOMAIN },
});

/**
 * Every route this harness sends requests at.
 *
 *   auth: 'none'    public by design
 *   auth: 'session' a valid session is the floor
 *   auth: 'member'  session PLUS an active membership (requireMember)
 *   auth: 'staff'   mod or above
 *   auth: 'admin'   admin or above
 *   auth: 'bearer'  a shared machine secret, never a cookie
 *
 * `writes` marks a route that mutates D1, sends mail, or spends money. The
 * cost family enumerates over it rather than needing a case each, so a route
 * added here is automatically attacked by "an unauthenticated request costs
 * nothing" without anybody remembering to add it.
 */
export const ROUTES = Object.freeze([
  /* A PROBE, not a gated route: it answers 200 with `user: null` to an
     anonymous caller by design, so it belongs to the leak family (what does
     it say about nobody?) rather than to the "refused without a cookie"
     sweep, which it would fail for being correct. */
  { path: '/api/auth/session', method: 'GET', auth: 'probe', writes: false },
  { path: '/api/auth/profile', method: 'PATCH', auth: 'session', writes: true },
  { path: '/api/auth/login', method: 'POST', auth: 'none', writes: true },
  { path: '/api/auth/signup', method: 'POST', auth: 'none', writes: true },
  { path: '/api/auth/logout', method: 'POST', auth: 'none', writes: true },
  { path: '/api/auth/forgot-password', method: 'POST', auth: 'none', writes: true },
  { path: '/api/auth/reset-password', method: 'POST', auth: 'none', writes: true },
  { path: '/api/auth/change-password', method: 'POST', auth: 'session', writes: true },
  { path: '/api/auth/resend-verification', method: 'POST', auth: 'none', writes: true },
  { path: '/api/account/mcp-keys', method: 'GET', auth: 'session', writes: false },
  { path: '/api/account/mcp-keys', method: 'POST', auth: 'session', writes: true },
  { path: `/api/account/mcp-keys/${VICTIM_KEY_ID}`, method: 'DELETE', auth: 'session', writes: true },
  { path: '/api/saved', method: 'GET', auth: 'session', writes: false },
  { path: '/api/saved', method: 'POST', auth: 'session', writes: true },
  { path: '/api/ask/saved', method: 'GET', auth: 'session', writes: false },
  { path: '/api/billing/status', method: 'GET', auth: 'session', writes: false },
  { path: '/api/billing/portal', method: 'POST', auth: 'session', writes: true },
  /* Unauthenticated BY DESIGN (its own header says so): a fresh donor has no
     cookie on the thank-you redirect. It is an account-existence oracle keyed
     on a cs_ id, so the leak family attacks its ORACLE shape, not its gate. */
  { path: '/api/billing/checkout-account', method: 'GET', auth: 'none', writes: false },
  { path: '/api/community/status', method: 'GET', auth: 'none', writes: false },
  { path: '/api/community/posts', method: 'GET', auth: 'member', writes: false },
  { path: '/api/community/posts', method: 'POST', auth: 'member', writes: true },
  { path: '/api/community/posts', method: 'PATCH', auth: 'member', writes: true },
  { path: '/api/community/posts', method: 'DELETE', auth: 'member', writes: true },
  { path: '/api/community/comments', method: 'POST', auth: 'member', writes: true },
  { path: '/api/community/comments', method: 'DELETE', auth: 'member', writes: true },
  { path: '/api/community/reactions', method: 'POST', auth: 'member', writes: true },
  { path: '/api/community/flags', method: 'POST', auth: 'member', writes: true },
  { path: '/api/community/flags', method: 'GET', auth: 'staff', writes: false },
  { path: '/api/community/members', method: 'GET', auth: 'member', writes: false },
  /* MEMBER-only, not staff: it returns the CALLER's own memberships, sourced
     from the session. Classified by reading the module, not by its neighbours
     in the moderation cluster. */
  { path: '/api/community/memberships', method: 'GET', auth: 'member', writes: false },
  { path: '/api/community/ban', method: 'POST', auth: 'staff', writes: true },
  { path: '/api/community/unban', method: 'POST', auth: 'staff', writes: true },
  { path: '/api/community/upload', method: 'POST', auth: 'member', writes: true },
  { path: '/api/courses/enroll', method: 'POST', auth: 'session', writes: true },
  { path: '/api/courses/progress', method: 'GET', auth: 'session', writes: false },
  { path: '/api/courses/certificate', method: 'GET', auth: 'session', writes: false },
  { path: '/api/admin/faqs', method: 'GET', auth: 'admin', writes: false },
  { path: '/api/admin/faqs', method: 'POST', auth: 'admin', writes: true },
  { path: `/api/admin/faqs/${SEEDED_FAQ_ID}`, method: 'DELETE', auth: 'admin', writes: true },
  { path: '/api/admin/courses', method: 'GET', auth: 'admin', writes: false },
  { path: '/api/admin/courses', method: 'POST', auth: 'admin', writes: true },
  { path: '/api/admin/ecosystem', method: 'GET', auth: 'bearer', writes: false },
  { path: '/api/admin/cleanup', method: 'POST', auth: 'bearer', writes: true },
  { path: '/api/create-checkout', method: 'POST', auth: 'none', writes: true },
  { path: '/api/stripe-webhook', method: 'POST', auth: 'none', writes: true },
  { path: '/api/contact/submit', method: 'POST', auth: 'none', writes: true },
  { path: '/api/survey/submit', method: 'POST', auth: 'none', writes: true },
  { path: '/api/survey/request', method: 'POST', auth: 'none', writes: true },
  { path: '/api/survey/validate', method: 'GET', auth: 'none', writes: false },
  { path: '/api/quiz/request', method: 'POST', auth: 'none', writes: true },
  { path: '/api/endo-quiz/start', method: 'POST', auth: 'none', writes: false },
  { path: '/api/endo-quiz/request', method: 'POST', auth: 'none', writes: true },
  { path: '/api/newsletter/subscribe', method: 'POST', auth: 'none', writes: true },
  { path: '/api/events/register', method: 'POST', auth: 'none', writes: true },
  { path: '/api/partners/apply', method: 'POST', auth: 'none', writes: true },
  { path: '/api/pdf/request', method: 'POST', auth: 'none', writes: true },
]);

/** Session-gated member routes, for the families that enumerate them. */
export const SESSION_ROUTES = Object.freeze(
  ROUTES.filter((r) => r.auth === 'session' || r.auth === 'member')
);

/** Admin/staff routes, for "a member is refused" enumeration. */
export const PRIVILEGED_ROUTES = Object.freeze(
  ROUTES.filter((r) => r.auth === 'staff' || r.auth === 'admin')
);

/** The routes a public request can reach that write, spend, or send mail. */
export const PUBLIC_WRITE_ROUTES = Object.freeze(
  ROUTES.filter((r) => r.auth === 'none' && r.writes)
);

export const RRM_ACADEMY_TARGET = Object.freeze({
  name: 'rrm-academy-cf',
  liveBase: `https://${APEX}`,
  hosts: HOSTS,
  identities: IDENTITIES,
  routes: ROUTES,
  defaultHost: 'apex',
});
