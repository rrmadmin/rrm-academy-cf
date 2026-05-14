# RRM Academy CF — Ecosystem `/arise --deep` Sweep

**Date:** 2026-05-14
**Method:** 4 parallel `/arise --deep` subagent sweeps, one per hot subsystem
**Total scope:** ~64 files / ~8,500 LOC
**Total findings (post self-verify drop):** 72
**Pattern fixes excluded:** PF-A through PF-J already shipped

## Severity rollup

| Tier | Count | Disposition |
|---|---:|---|
| CRITICAL | 7 | Squash this session |
| HIGH | 30 | Batch in waves by subsystem |
| MEDIUM | 26 | Triage; ship the cheap ones in cleanup wave |
| LOW | 9 | Defer / document |

---

## CRITICAL (7) — squash this session

### C-BILL-1 — Refund-revoke handler swallows D1 errors → permanent refund-drop
**`functions/api/stripe-webhook.js:153-156`** — On D1 throw inside the `charge.refunded` branch, the handler logs and continues. Dispatcher's 5xx-rollback at `:165` never fires (handler returns null, not a 5xx Response). Stripe sees 200 → no retry → `webhook_event` dedup row persists → user keeps course access after refund. PF-I only catches handler *throws*; log-and-continue bypasses both rollback paths.
**Fix:** Set `result = new Response(JSON.stringify({...}), {status: 500})` in the catch so dedup rollback fires.

### C-BILL-2 — Wix migration lock fakes success on D1 failure → double-billed donors
**`functions/api/create-checkout.js:256-258`** — Atomic write-lock around `migration_handoff_started_at` is the only race protection against two concurrent migrations creating two Stripe subs. On D1 throw, the code synthesizes `lockResult = { meta: { changes: 1 } }` and proceeds. Two concurrent requests both succeed → donor double-billed.
**Fix:** On D1 throw, return 503 `service_unavailable`; do not synthesize a fake lock.

### C-BILL-3 — `subscriptions.list({ limit: 10 })` + missing `cancel_at_period_end` check
**`functions/api/create-checkout.js:325-336`** — Active-subscription blocking check pages at 10 records and doesn't filter `cancel_at_period_end`. A donor with 11+ historical subs OR a cancellation-pending sub (`canceled` status but still has paid access) can re-subscribe and end up with overlapping active subs.
**Fix:** Raise list limit to 100; add `cancel_at_period_end && current_period_end > now` check.

### C-AUTH-1 — `resend-verification` rotates D1 code BEFORE SES send → user locked out on SES failure
**`functions/api/auth/resend-verification.js:48-53`** — DELETE-old + INSERT-new code runs in a batch, then `await sendEmail`. SES throw → DB now holds an undeliverable code, old valid code is gone. Within 1hr TTL there is no path to recovery.
**Fix:** Send email first; only commit DB rotation on send success. Or write to KV with short TTL and commit to D1 after SES returns ok.

### C-AUTH-2 — Login passwordless-account branch leaks Google-only / unprovisioned status via timing
**`functions/api/auth/login.js:60-100` vs `:107`** — Passwordless branch returns 401 without running PBKDF2 (~100ms). Every other 401 path runs `verifyPassword` (against real hash, dummy hash, or for blocked users). Timing attacker can enumerate Google-only emails by measuring response time. Dummy-hash path was specifically designed to close this oracle for the not-found case; passwordless reopens it.
**Fix:** `await verifyPassword(password, DUMMY_PASSWORD_HASH)` before the passwordless early return, OR move the passwordless branch below the verifyPassword call.

### C-AUTH-3 — `upgradeUnverifiedUser` SQL doesn't enforce `email_verified = 0`
**`functions/api/auth/google-callback.js:76-90`** — Function name promises the invariant ("upgradeUnverifiedUser") but the SELECT and UPDATE have no `WHERE ... AND email_verified = 0`. Today path 2 (`linkGoogleToVerifiedUser`) catches all verified users before path 3 runs, so the invariant holds via control flow. Future refactor that changes path 2 → wipes verified user's `hashed_password` and re-stamps `google_id` → account takeover via Google sign-in.
**Fix:** Add `AND email_verified = 0` to both the SELECT and the UPDATE WHERE clause.

### C-COMM-1 — `flags.js` POST has no rate limit → SES amplification + DoS
**`functions/api/community/flags.js:28-93`** — Logged-in member can iterate every post/comment id and POST flags. Dedup-check only blocks same `(user_id, target_type, target_id)` tuple. Each successful flag calls `notifyMods` which `await Promise.all`s `sendEmail` to every mod synchronously. Attacker flagging 5000 distinct items × 6 mods = 30,000 SES sends + mod-inbox flood. Worker subrequest cap blocks some but bill + inbox real.
**Fix:** `checkRateLimit(env, 'flag_post:' + user.id, 10, 3600)`. Move `notifyMods` into `waitUntil`.

---

## Cross-cutting structural pattern

**Webhook sub-handler swallow** — billing sweep's TRACER-B identified 4 handlers that catch their own D1 errors and return null instead of a 5xx Response: `charge.refunded` (C-BILL-1), `subscription_deleted` (H-BILL-7), `payment_failed` (H-BILL-5), `checkout.session.expired` migration-lock release (H-BILL-6). PF-I (try/catch around dispatcher) catches *throws* but not log-and-continue paths. **Class fix:** audit every `catch` in the 5 billing handlers; rethrow on D1-class errors so PF-I's dispatcher catch can roll back dedup, OR refactor each handler to return a 5xx Response on D1 failure rather than null.

---

## HIGH (30)

### Billing (12)
- **H-BILL-1** `create-checkout.js:200-210` — `wix_lookup` OR-branch can match `email = ''` on corrupt row
- **H-BILL-2** `_webhook-checkout.js:612-620` — ELV verification fires unconditionally even for logged-in users (cost burn)
- **H-BILL-3** `_webhook-checkout.js:62-66` — Course-checkout missing-user path returns 400 instead of 500; bypasses dedup rollback
- **H-BILL-4** `_webhook-checkout.js:679-715` — Account-create-then-link race: 3 concurrent webhooks can produce orphaned `stripe_customer_id`
- **H-BILL-5** `_webhook-invoice.js:22-46` — `payment_failed` SES throw is fire-and-forget; donor never learns card failed
- **H-BILL-6** `_webhook-checkout.js:580-592` — Migration lock release swallows D1 error (class pattern)
- **H-BILL-7** `_webhook-subscription.js:39-47` — `subscription_deleted` migration cancel-flag swallows D1 error (class pattern)
- **H-BILL-8** `courses/enroll.js:81-89` — Idempotent re-enroll path re-UPSERTs included-courses with `revoked_at = NULL`; admin-revoked included courses silently un-revoke
- **H-BILL-9** `billing/status.js:138-160` — Wix-fallback queries don't filter `migration_status`; migrated donors can surface as "cancelled" in welcome-back UI
- **H-BILL-10** `billing/portal.js:46-52` — Wix-lookup swallows ALL errors silently; SQL corruption masked as "no billing account"
- **H-BILL-11** `billing/checkout-account.js:55-60` — Replication-lag race: account exists but returns `accountExists: false`
- **H-BILL-12** `_webhook-checkout.js:401` — Migration admin email subject uses unescaped `donorEmail`; CRLF injection vector via SES if a Wix row email contains CR/LF

### Auth (5)
- **H-AUTH-1** `_shared.js:150-183` — `validateSession` auto-renew batch wraps a single UPDATE; needs `WHERE id = ? AND expires_at = ?` for idempotency vs concurrent renew
- **H-AUTH-2** `signup.js:159-180` — `email_verification` table has no `UNIQUE(user_id)`; SES failure leaves orphan rows; can accumulate
- **H-AUTH-3** `google-callback.js:30-54` — Email-change UPDATE doesn't rescue from UNIQUE collision on `idx_user_email_nocase`; returns generic "oauth_failed" instead of `email_conflict`
- **H-AUTH-4** `reset-password.js:56-62` — Missing `DELETE FROM password_reset WHERE user_id = ? AND purpose = 'reset'` in the batch; valid reset token persists after consume (sibling-divergence with `change-password.js:69`)
- **H-AUTH-5** `_middleware.js:213-217` — Auth-prefix protection isn't case-canonicalized; `/Account/`, `/Community/`, `/Ask/` may slip past

### Courses (5)
- **H-CRS-1** `admin/courses/[id].js:385-389` — DELETE doesn't check cross-course `includes_json` references; deleting `long-term-endo` while Masterclass includes it → phantom enrollment rows
- **H-CRS-2** `courses/progress.js:197` — Client-supplied `score` overwrites quiz score via `CASE WHEN ?5 IS NOT NULL THEN ?5`; should match quiz.js's `MAX(...)` (cert downgrade vector)
- **H-CRS-3** `admin/courses/[id]/attachments.js:108-133` — R2 PUT succeeds + D1 UPDATE fails = orphan R2 object; matches CLAUDE.md R4 known gap
- **H-CRS-4** `admin/courses/[id]/steps.js:121-125` — `attachments[].url` accepts `javascript:` scheme; stored XSS via admin path (defense-in-depth)
- **H-CRS-5** `admin/courses/[id].js:233-246` — Cert-quiz step pointer accepts non-`published` / non-`quiz` steps; cert silently degrades to "completion alone"

### Community + Search (8)
- **H-CS-1** `search/log.js:11-31` — In-memory `Map` rate limiter (PF-C sibling miss)
- **H-CS-2** `ask.js:240-317` — Rate-limit check-then-act race; concurrent requests bypass 20/day cap (LLM token leak)
- **H-CS-3** `community/posts.js:584-591` — DELETE batch order correct today but fragile (no test asserting it); needs comment + helper extraction
- **H-CS-4** `community/comments.js:284-286` — PATCH UPDATE missing `AND author_id = ?` in WHERE (defense-in-depth IDOR)
- **H-CS-5** `community/_email.js:71-73` — `notifyNewPost` `LIMIT 5000` silently caps roster; no log/alert at boundary
- **H-CS-6** `search/semantic.js:202` — Silent shape-drift on AI response; log says "AI returned no vector" without dumping shape
- **H-CS-7** `community/comments.js:232-239` — Reply cascade only one level deep; relies on JS-enforced invariant
- **H-CS-8** `community/upload.js:55-57` — R2 PUT has no timeout; stalled upload pins worker for 30s
- **H-CS-9** `community/posts.js:355-371` — Slug-collision retry loop up to 98 sequential D1 round-trips for hot titles

---

## MEDIUM (26) — batchable cleanup wave

Listing tags only; full witness/fix in raw sweep outputs.

**Billing (6):** M-BILL-1 unhandled `sendEmailSafe` reject in handoff-error catch · M-BILL-2 SQL block in admin email is copy-paste-trap · M-BILL-3 `customer_email` vs `customer_details.email` mismatch silent · M-BILL-4 charges + wix_payment list limit 50 silent truncation · M-BILL-5 `enroll.js:217` batch result only checks `results[0]` · M-BILL-6 admin enrollment notify gated behind SES creds; no out-of-band signal when SES is down

**Auth (6):** M-AUTH-1 `deriveSignupSource` body-vs-validated drift risk · M-AUTH-2 OAuth nonce 122-bit vs other tokens 256-bit (cosmetic) · M-AUTH-3 `createNewGoogleUser` retry doesn't disambiguate UNIQUE-on-email vs UNIQUE-on-google_id · M-AUTH-4 admin/cleanup batch failure rolls back all DELETEs · M-AUTH-5 Turnstile network error indistinguishable from rejection · M-AUTH-6 reset-password unbounded `DELETE FROM session WHERE user_id = ?` (intentional but flagged)

**Courses (7):** M-CRS-1 `coursesData` build-time JSON stale between admin write and rebuild · M-CRS-2 quiz `step_progress` UPSERT + `quiz_response` batch non-atomic across 2 round-trips · M-CRS-3 quiz `attempt` subquery race (concurrent submit gets same attempt #) · M-CRS-4 step DELETE TOCTOU between ref-check and DELETE · M-CRS-5 attachments DELETE: R2 deleted first then D1 UPDATE fails → broken link · M-CRS-6 `participants` accepts NaN/negative/Infinity · M-CRS-7 enroll.js outer try/catch masks structured 503s

**Community (7):** M-CS-1 `authorFrom` lacks RFC 5322 quoting on user-controlled name · M-CS-2 reactions toggle DELETE-then-INSERT race · M-CS-3 sync notifyReply fallback logs with httpStatus=0 (filter blindspot) · M-CS-4 posts PATCH allows slug on non-event posts (namespace squat) · M-CS-5 flags upsert wipes `resolved_by`/`resolved_at` (audit-trail destruction) · M-CS-6 Stripe rate-limit cascade in `requireMember` → community-wide 503 for new cohort · M-CS-7 `logAskQuery` sync-path D1 cascade

---

## LOW (9) — defer/document

Tags: L-AUTH-1 (cleanupEmail strips RFC 5321 quotes — verified safe), L-AUTH-2/3/4/5 (documentation findings), L-CRS-1 (sortOrder NaN/negative), L-CRS-2 (unbounded reorder array), L-CRS-3 (parentId non-string → 500), L-CRS-4 (DELETE refused even when all enrollments revoked), L-CS-1 (ask/saved.js duplicate-question rows), L-CS-2 (semantic.js dedup key URL trailing-slash), L-CS-3 (STUC label SQL emoji collation).

---

## INTEGRATION clean signals (auth subsystem)

The auth INTEGRATION hunter verified these invariants hold across the 16-file subsystem:
- **INT-1** COLLATE NOCASE coverage complete on every email WHERE
- **INT-2** `password_reset.purpose` scoping correct (reset / welcome never collide)
- **INT-3** Magic-link / verification token consumption is atomic via `DELETE ... RETURNING`
- **INT-4** Session cookie flags consistent (`HttpOnly; Secure; SameSite=Lax`) across every emission site
- **INT-5** All 9 auth endpoints use KV-backed `checkRateLimit` (PF-C migration verified clean)

---

## Recommended squash order

**Wave 1 (this session):** All 7 CRITs + the cross-cutting webhook-handler swallow pattern (closes 4 HIGHs simultaneously — H-BILL-5/6/7 + the structural class fix).

**Wave 2:** Remaining HIGHs by subsystem
- Billing: H-BILL-1/2/3/4/8/9/10/11/12 (9 fixes)
- Auth: H-AUTH-1/2/3/4/5 (5 fixes)
- Courses: H-CRS-1/2/3/4/5 (5 fixes)
- Community: H-CS-1 through H-CS-9 (9 fixes)

**Wave 3:** Medium tier cleanup pass (~26 findings, batchable by file)

**Defer:** LOW tier; document in `feedback-*` memory files where actionable.
