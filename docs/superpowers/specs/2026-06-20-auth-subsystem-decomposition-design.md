# rrm-academy-cf Auth Subsystem Decomposition — Design Spec

- **Date:** 2026-06-20
- **Status:** DRAFT, awaiting Brian review + brian-gate before any execution (production auth)
- **Project:** rrm-academy-cf (`functions/api/auth/` + `functions/_middleware.js`)
- **Owner:** Brian. Executes through the coder agent + security-guard ritual + `/arise --deep` per concern.
- **Pairs with:** the 2026-06-20 `/arise --deep` auth audit (16 net-new findings on top of 140 prior).

## 1. Why

The auth subsystem is the #1 bug cluster in the entire `/arise` history: ~113 combined run-appearances across 10 `functions/api/auth/*` files + `_middleware.js` (up from 63 a month ago). Today's deep audit, with the 140 prior findings excluded, still found 16 net-new issues. The reassuring half: zero new CRITICAL auth-bypass (113 runs exhausted that class). The actionable half: **every net-new finding is a sibling-divergence symptom** — the same cross-cutting concern is reimplemented per endpoint, and the implementations drift. Per-file squashing has plateaued; the fix is structural.

The net-new findings map cleanly onto three reused-but-reimplemented concerns:

| Concern | Today's findings | Symptom |
|---|---|---|
| Email canonicalization | H2, H3, LOW control-chars | signup stores one canonical form; login/forgot looked up another -> silent lockout; trailing-dot/control-char variants defeat the unique index |
| `password_reset` token lifecycle | H1, H5, reset/change scope divergence | `purpose` scoping inconsistent across change-password vs reset-password; upsert races email dead tokens; welcome-token survival |
| Session + cookie + validation | the `_shared.js` vs login/google-callback reimplementations | cookie attributes and session creation reimplemented per endpoint; revocation-on-credential-change handled unevenly |

Plus a fourth, smaller one: response-shape / `requireUser` (X1, the 404-vs-401 enumeration divergence).

## 2. Goal and non-goals

**Goal:** give each cross-cutting auth concern exactly ONE implementation that every endpoint calls, so sibling-divergence (the dominant bug class here) becomes structurally impossible, and add a lint ratchet that fails the build when an endpoint reimplements a centralized concern.

**Non-goals:**
- No behavior change for valid users. This is consolidation, not a feature. Each step must be a pure refactor with identical (or strictly-more-correct) observable behavior.
- Not a rewrite. The endpoints stay as thin handlers; only the shared logic moves.
- No new auth features (no passkeys, no new providers) in this work.

## 3. Target architecture

Introduce a small `functions/api/auth/_lib/` (or extend the existing `_shared.js`) with one module per concern. Endpoints become thin: parse, authorize, call a module, respond.

**T1 `_lib/email.js` — canonical email.**
- `canonicalizeEmail(raw): string` — the single transform used for BOTH storage and every lookup. Folds case, trims, NFC-normalizes, applies `cleanupEmail`'s structural rules, strips the trailing FQDN dot, and rejects control/zero-width codepoints. (Today's H2 fix already pulled the trailing-dot strip into `cleanupEmail`; this formalizes it as the one entry point.)
- `validateEmailForSignup(raw, env): {valid, email, reason}` — canonicalize + the heavier signup-only checks (disposable, MX, ELV). Returns the canonical email that gets stored.
- **Invariant:** the value stored at signup equals `canonicalizeEmail` applied at every lookup. Eliminates H2, H3, control-char, and the duplicate-account class.

**T2 `_lib/reset-tokens.js` — password_reset lifecycle.**
- `issueResetToken(db, userId, purpose, ttl): {token}` — single-writer upsert with a defined concurrency policy (resolves H5: the emailed token always equals the committed token).
- `consumeResetToken(db, tokenHash): {userId, purpose} | null` — single-use, expiry-checked, bound to one user.
- `revokeResetTokens(db, userId, scope): void` — one revocation policy. `scope='all'` for a deliberate password change (kills reset + welcome, fixing H1); the welcome-redemption path (prior #104) keeps its documented behavior, now expressed once.
- **Invariant:** one purpose-scoping policy, expressed once; change-password and reset-password cannot diverge again.

**T3 `_lib/session.js` (consolidate into `_shared.js`) — session + cookie.**
- `createSession`, `validateSession`, `renewSession`, `revokeSession`, `revokeAllSessions` — already partly in `_shared.js`; move the login.js / google-callback.js reimplementations onto these.
- `sessionCookie(token, expiresAt)` — the single cookie-attribute constructor (HttpOnly, Secure, SameSite=Lax, Path, Max-Age). Every login surface uses it.
- **Invariant:** identical cookie attributes everywhere; a credential change (password reset/change) always calls `revokeAllSessions`.

**T4 `_lib/respond.js` — auth response helpers.**
- `requireUser(db, session): {user} | Response(401)` — the uniform "deleted-user session is not authenticated" shape (fixes X1 across resend/change-password/profile).
- Standard `{ok:false, error}` envelope helpers so error shape cannot drift.

## 4. Invariants the decomposition enforces

1. Email stored == email looked up (one `canonicalizeEmail`).
2. One password-reset token policy (single-use, expiry, purpose scoping, revocation-on-credential-change).
3. Identical session cookie attributes on every login surface; credential change always revokes all sessions.
4. Uniform unauthenticated/error response shape (no enumeration via status/shape drift).
5. New endpoints cannot reimplement a centralized concern (lint ratchet, Section 6).

## 5. Migration plan (incremental, one concern per branch)

Each concern ships as its own `claude/` branch with its own `/arise --deep` + security-guard + brian-gate. Order chosen by risk and by what today's fixes already touched:

- **Step 1 (T1 email):** lowest risk, already half-done by today's H2/H3 fixes. Extract `canonicalizeEmail`, route every email path through it, fold in the deferred control-char LOW. Verify no stored-vs-lookup divergence remains.
- **Step 2 (T4 respond):** mechanical; extract `requireUser` + envelope helpers, fold the X1 follow-ups.
- **Step 3 (T2 tokens):** medium risk (the welcome/reset policy is subtle — see prior #101/#104). Centralize issue/consume/revoke; encode the one policy; re-verify the welcome-redemption path is preserved.
- **Step 4 (T3 session):** highest risk (touches every login surface). Move login.js + google-callback.js onto the shared session/cookie helpers last, once the others are proven.

Each step: thin the endpoints, do not change behavior, run `/arise --deep` on the changed files, `npm run guard:update`, security guard ALL CLEAR, ONE commit, brian-gate, push.

## 6. Lint ratchet (prevents regression to divergence)

Add a postbuild/CI lint that fails when an `functions/api/auth/*` endpoint:
- builds a session cookie inline instead of via `sessionCookie()`,
- looks up an email without `canonicalizeEmail()`,
- writes/deletes `password_reset` outside `_lib/reset-tokens.js`,
- returns a bare `404`/ad-hoc auth-error shape instead of the `respond` helpers.

Ratcheting allowlist for any endpoint not yet migrated, shrinking to zero as the steps land. (Mirrors the `lint-form-primitives` pattern.)

## 7. Testing

- TDD each `_lib/` module in isolation with fixtures (the modules are pure or db-injected, so unit-testable).
- Endpoints become thin enough to test by asserting they call the module + shape the response.
- Carry today's audit findings as regression fixtures (e.g. the `me@gmail.com.` store==lookup case; the welcome-token-survives-password-change case; the concurrent-rehash CAS case).
- SYNTHETIC data only; no real user data in tests.

## 8. Risks and gates

- Production auth: every step is `--deep`-before-commit (hotspot rule), through the coder agent (mandatory for `functions/api/`), under the security-guard ritual (hash-integrity manifest regen + ONE commit), with a brian-gate before execution.
- Ship from a clean worktree off origin/main (the main clone runs dirty/diverged), cherry-pick policy per `ship-from-dirty-clone-via-worktree`.
- T3 (session) is the one most likely to cause a regression; do it last, alone, with extra verification (cross-model `--deep` post-squash audit).

## 9. Open items

- Decide `_lib/` vs extending `_shared.js` (lean `_lib/` for testability; `_shared.js` is already large).
- Confirm the welcome/reset purpose policy with the actual prior #101/#104 history before T2.
- Separately verify whether prior #64 (google-callback standalone createSession) actually landed — today's audit suggests it may not have; fold into T3 if still live.

## Appendix: evidence

- 2026-06-20 `/arise --deep` auth audit: 16 net-new (5 HIGH, 7 MEDIUM, 4 LOW), 0 new CRITICAL, 140 prior excluded.
- Today's squash (branch `claude/arise-auth-fix`): fixed 10 of the 16 (5 HIGH + 5 MEDIUM); the 4 LOW + the two prior-overlap drops fold into T1/T2/T3.
- Hotspot history: `functions/api/auth/` = ~113 combined run-appearances, the #1 cluster (`hotspots.md`, refreshed 2026-06-20).
