# Email Identity: Canonical Key vs Raw Deliverable — Design Spec

- **Date:** 2026-06-20
- **Status:** DRAFT, awaiting Brian review + brian-gate before any execution
- **Project:** rrm-academy-cf
- **Supersedes:** the per-subsystem "canonicalize the `email` column" approach in `2026-06-20-auth-subsystem-decomposition-design.md` (T1). That approach is sound for dedup but, as the T1-auth and T1-newsletter converge runs surfaced, it conflates two different things into one column and inherits a delivery-correctness tension. This spec is the durable fix.

## 1. The problem the converge runs surfaced

The auth/newsletter surfaces use a single `email` column as BOTH:
- the **identity / dedup / lookup key** (what `WHERE email = ?` and the `UNIQUE` index match on), and
- the **deliverable address** (what transactional + newsletter email is actually sent to).

The canonical normalizer (`cleanupEmail`) does structural rewrites: collapse `me..you@` to `me.you@`, strip a trailing FQDN dot, fix transpositions, strip zero-width/control codepoints. Those are correct for an identity key (they fold byte-variants of the same logical account). But they are **lossy for the deliverable address**: at strict (non-Gmail) providers, `me..you@domain` and `me.you@domain` can be different mailboxes. Gmail ignores dots; most providers do not guarantee that.

So a single `email` column forces a bad choice:
- **Canonicalize it** (good dedup, prevents duplicate accounts) -> the stored value may no longer be the address that actually receives mail at strict providers -> mis-delivery risk.
- **Leave it raw** (correct delivery) -> byte-variant duplicates and lookup misses (the H2 bug class).

Two concrete consequences already observed:
- **T1-auth (shipped today)** canonicalized `user.email` on write. This fixed the dedup/lookup divergence but means new signups' `user.email` is the canonical (dots-collapsed) form, not necessarily their typed deliverable. Low real-world impact (rare structural-variant inputs, mostly Gmail), but it is the same latent tension.
- **T1-newsletter** could only canonicalize the pure `subscribe.js` path cleanly; the multi-table handlers (pdf, waitlist) split the key across tables, and "fix it everywhere" runs into the deliverability problem on the send path.

## 2. Goal

Separate identity from deliverability with two columns wherever an email is stored:

| Column | Meaning | Used for |
|---|---|---|
| `email_canonical` | `canonicalizeEmail(email)` | the identity key: `UNIQUE` index, all `WHERE`/dedup/`ON CONFLICT` lookups, all cross-table joins |
| `email` | the raw, validated, deliverable address (NFC + trim + lowercase only; NO structural rewrite) | what transactional/newsletter mail is sent to |

Result: dedup and lookups become byte-variant-proof (key on `email_canonical`), and delivery uses the address the user actually typed (`email`). The canonical-vs-deliverable tension disappears because the two roles are no longer the same column.

## 3. Design

**Schema (per email-bearing table: `user`, `newsletter_subscriber`, `contact`, and any other that keys on email):**
- Add `email_canonical TEXT`.
- Move the uniqueness/identity constraint to `email_canonical`: `CREATE UNIQUE INDEX idx_<table>_email_canonical ON <table>(email_canonical)`.
- `email` keeps `NOT NULL` but its `UNIQUE`/`COLLATE NOCASE` identity role is retired (it is now the deliverable, not the key). Keep a non-unique index if needed for admin search.

**Write paths:** on every insert/update, set `email` = the validated raw deliverable (NFC + trim + lowercase, NO `cleanupEmail`), and `email_canonical = canonicalizeEmail(email)`. One helper enforces both.

**Lookup/dedup/join paths:** key on `email_canonical = canonicalizeEmail(input)`. Never look up by raw `email`.

**Send paths:** use `email` (raw deliverable). Never send to `email_canonical`.

**Token-keyed flows (unsubscribe, verify, reset, bounce):** continue to match the EXACT stored row the link/token was issued for; where they currently match on `email`, they match on the stored deliverable as today (the token already encodes it). The identity key is for dedup, not for token redemption.

This SUPERSEDES per-subsystem column-canonicalization: instead of rewriting each subsystem's `email` column (the lossy approach), add `email_canonical` once per table and switch lookups to it. The per-subsystem converge components become "switch this subsystem's lookups to `email_canonical`," which is internally consistent and has no deliverability tension.

## 4. Migration

Per table, in order user -> newsletter_subscriber -> contact (each its own converge component + migration):
1. DDL: add `email_canonical` (nullable initially).
2. Backfill: `email_canonical = canonicalizeEmail(email)` for existing rows (idempotent script, dry-run first, print collision stats).
3. Resolve backfill collisions: existing rows that canonicalize to the same key (true byte-variant duplicates). Decide the merge/keep rule per table (see open decisions). Until resolved, the `UNIQUE(email_canonical)` index cannot be added.
4. Add `UNIQUE(email_canonical)` once collisions are zero.
5. Switch write paths to populate both columns; switch lookup/dedup/join paths to `email_canonical`; confirm send paths use `email`.
6. Retire the `email` uniqueness role.

## 5. Retro-fix for the shipped auth H2 change

T1-auth canonicalized `user.email` on write. Under this design `user.email` should be the raw deliverable and `user.email_canonical` the key. Open question (Section 6): for rows written since H2 deployed, the raw form was overwritten with the canonical form and is not recoverable. Options: accept that those rows' `email` is the canonical form (delivers fine at Gmail; rare risk elsewhere) and only NEW writes preserve raw; or treat the H2 canonical value as both until a user re-verifies. This must be decided before the `user`-table migration.

## 6. Open decisions (for review + brian-gate)

1. **Uniqueness move:** confirm `UNIQUE` moves from `email` to `email_canonical`, and `email` becomes non-unique. (This is what makes byte-variant dedup correct while allowing raw delivery.)
2. **Backfill collision policy** per table: when two existing rows canonicalize to the same key, which wins / how to merge (esp. `user` — accounts, sessions, enrollments reference `user.id`, so a merge is non-trivial; likely keep-oldest + flag, never auto-delete).
3. **Auth H2 retro:** how to treat `user.email` rows written since H2 canonicalized them (raw form lost). See Section 5.
4. **Table scope:** definitely `user`, `newsletter_subscriber`, `contact`. Decide whether `course_waitlist`, `wix_subscription`, `pdf_token` get `email_canonical` or just switch their lookups to join via the canonical tables.
5. **Send-path audit:** confirm every transactional/newsletter send reads `email` (raw), not `email_canonical`, after the switch.

## 7. Risk and execution

- Schema change to core tables (`user`, `contact` are central; `user` is guarded-adjacent + referenced by sessions/enrollments/billing). Each table is its own converge component (DDL + backfill + switch), HELD for human deploy, brian-gated. NOT one big migration.
- D1 DDL caveat: SQLite cannot `ALTER` to add a `UNIQUE` to an existing column in place; adding a new column + a new unique index is the supported path (matches `idx_user_email_nocase` precedent).
- This is a SPEC (design), not a plan. On approval, each table's migration gets its own implementation plan (writing-plans) + converge run.

## 8. Relationship to the decomposition spec

`2026-06-20-auth-subsystem-decomposition-design.md` T1 ("one canonicalizeEmail, route every email path through it") stays valid as the NORMALIZER consolidation. What changes: the per-subsystem steps key lookups on `email_canonical` (this spec) rather than rewriting the `email` column. T1-auth (shipped) and T1-newsletter (HELD/merged) are the column-canonicalization form; they are forward-compatible (their canonical `email` value equals what `email_canonical` would hold) and get reconciled during each table's migration here. The remaining per-subsystem steps (T1-crm, T1-community, T1-billing, T1-admin) should be done in THIS design's form, not the column-rewrite form.
