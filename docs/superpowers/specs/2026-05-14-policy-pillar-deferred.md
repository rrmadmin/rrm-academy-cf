# Policy Pillar (Deferred)

**Version:** 0.1 (deferred sketch)
**Date:** 2026-05-14
**Owner:** Brian (RRM Academy)
**Status:** Deferred from `2026-05-14-getting-started-pillars-design.md` v1.3
**Scope:** rrm-academy-cf, future workstream

## 0. Why this spec exists

The 2-pillar suite spec (`2026-05-14-getting-started-pillars-design.md`) originally contained a third pillar at `/for-policymakers/`. Three `/arise --deep` passes (35 → 28 → 30 findings, not converging) revealed that the policy pillar introduced ~7 new state-machine primitives whose interactions generated their own gate-bypass and gate-semantics failure modes faster than they could be squashed. Per `arise-intel-2026-05-07.md`: "After any pass that introduces a new state-machine primitive, run --deep again." Squashing in place was creating new primitives, restarting the cycle.

Decision D41 of v1.3: defer policy pillar to this separate spec when scope warrants the additional complexity and the prerequisites are ready.

This document captures the deferred design surface so future work can resume from where v1.2 left off without re-deriving requirements from scratch.

## 1. What was deferred

### Audience
Federal and state legislators, congressional staff, HHS / HRSA / NIH / ORWH program officers, conservative and progressive women's-health caucuses, state-level women's-health advocacy professionals, healthcare policy researchers. New cold audience for the academy. Drives institutional credibility, foundation grants pipeline, and policy influence.

### URL + title
- URL: `/for-policymakers/`
- Title: `RRM For Policymakers: A Policy Brief`
- Eyebrow: `A Policy Brief`
- Byline: `RRM Academy` (institutional), not Naomi Whittaker

### Content scaffold (sketch from v1.2 §7.3)
12 sections including:
1. Key takeaways (5 bullets, briefable as slide)
2. What RRM is (shared block + policy-specific "additive not subtractive" second sentence)
3. Where RRM sits in reproductive-policy debates (gating concern section; addresses partisan-framing directly with non-lobbying language)
4. Public health case
5. Economic case
6. Where RRM fits in existing policy frameworks
7. Legislative precedent
8. Federal funding landscape and gaps
9. Where the current evidence base supports investigation (educational framing, NOT legislative direction)
10. Institutional partners
11. Resources for staffers (FAQ accordion, 8 entries)
12. References

### Must-cite facts (7)
- Fuldeore 2017 (US endometriosis prevalence and symptomatic burden), Chandra 2014 (US infertility / impaired-fecundity baseline), Boyle 2025, Stanford 2021, Stanford 2022 iNEST, Sánchez-Méndez 2025, Reeder 2026 (perinatal-outcome differential).

### CTA ladder (Phase 1 ship of policy pillar)
1. Primary: Request a briefing or policy brief preview, contact form posting to `/api/contact/submit.js` with `category=policy-brief-interest`
2. Secondary: Schedule a briefing, same form with `category=schedule-briefing`
3. Tertiary: Get policy updates, newsletter widget with `?subscribe_segment=policy` query string
4. Lateral: Convene with us, RRM Foundation partnership inquiry, same form, `category=foundation-partnership`
5. Bottom: See current research priorities, `/library/` filtered

### Policy-pillar-specific editorial rules (deferred)
- No partisan framing; MAHA mentioned at most once each in §6 and §8, alongside ≥2 non-MAHA peers
- No abortion content outside §3 (section-aware gate)
- No critique of named senators, agencies, ASRM, ACOG by name
- No naming individual practitioners (Hilgers, Boyle, Whittaker) in body copy as policy spokespersons
- No "Foundation does not lobby on X" statements
- No "secular" as editorial adjective for Foundation; use "501(c)(3) educational organization"
- No legislative-direction language

## 2. What was unresolved at deferral time

Open issues from `/arise --deep` pass 3 that would need to be resolved before a future build:

### Schema / DB
- **`policy_brief_waitlist` table**: schema sketch existed (v1.2 §7.3) with explicit CREATE TABLE block including `category` CHECK, `triaged_status` state-machine enum, partial UNIQUE index `(email, category) WHERE triaged_status != 'closed'`. Unresolved:
  - CHECK constraint case-sensitivity (lowercase coercion in submit.js)
  - Email whitespace trim before UNIQUE check
  - `organization_domain` XSS safety in admin queue render
  - State-machine transition enforcement (SQLite trigger or app-layer)
  - UPSERT semantics on duplicate-submit (ON CONFLICT DO UPDATE preferred over INSERT OR IGNORE)
  - Dual-write atomicity (`db.batch([contact_submission, policy_brief_waitlist])`)
  - Remote migration application gate (CI verifies remote D1 has table before deploy)

### Endpoint extensions
- **`CONTACT_CATEGORIES` enum extension**: add `policy-brief-interest`, `schedule-briefing`, `foundation-partnership` values. Synced via `scripts/check-persona-enum-sync.mjs` global CI gate; partial-update can block Phase 1/2 (current) deploys. Solution: single atomic commit including all 4 file edits (contact-categories.js, personas markdown, contact.astro, submit.js dual-write logic).
- **`/api/newsletter/subscribe.js` segment-allowlist extension**: accept `?subscribe_segment=policy` query string. Allowlist location undefined; widget UI surface undefined. Single-string vs array semantics undefined. Subscribe.js is in security-guard manifest; edit requires `npm run guard:update` + security review.
- **`/api/admin/policy-waitlist`** new admin endpoint: ADMIN_API_SECRET auth, returns un-triaged rows. New surface in guard manifest.
- **SES auto-ack template**: 48-hour SES auto-ack copy authoring + Foundation legal approval; SES template id, file location.

### Foundation legal review attestation
- **`docs/legal-reviews/policy-pillar-<date>.md`** in-repo attestation artifact with structured front-matter (`reviewer_name`, `reviewer_role`, `reviewed_at`, `pillar_url`, `pillar_commit_sha`, `cooi_declaration`).
- **`docs/legal-reviews/reviewer-roster.md`** canonical list of named reviewers. Schema unspecified (YAML / markdown-table / CSV ambiguous). Open question: who is on the roster? Foundation board chair (only if not Brian; Brian's relationship to Foundation board needs declaration). Retained counsel? Cost estimate?
- **`scripts/gates/validate-legal-attestation.mjs`**: CI gate checking file exists, front-matter parses, reviewer on roster, commit GPG-signed OR CODEOWNERS-approved by non-Brian account, `pillar_commit_sha` matches `git diff <sha> HEAD -- src/pages/for-policymakers/` whitespace-only.
- **Retraction/withdrawal mechanism**: reviewer-initiated retraction triggers `<date>-RETRACTED.md` commit; pillar enters audit-hold status (R1 remediation tree).
- **Merge strategy pinning**: rebase-and-merge for Phase 3 PR (squash discards `Reviewed-By:` trailers).
- **Independence test beyond "non-Brian GitHub account"**: spouse / business-partner / family pass v1.2's check; need `cooi_declaration` field with allowlist.

### Cross-project / cross-surface dependencies
- **rrm-foundation-site Organization JSON-LD assertion**: `https://rrm.foundation/` must emit Organization graph node with `taxID: "93-4594315"` before policy pillar deploys (so Academy can reference via `Article.publisher.sameAs`). Cross-repo coordination signal undefined.
- **Foundation co-brand link target verification**: every link from policy pillar to `rrm.foundation` resolves to mission/institutional pages, NOT `/about/people/` or any page naming individual officers. Helper script follows each href, greps target for "Naomi", "Whittaker", "Boyle", "Hilgers" names.

### Gate semantics
- **Section-aware abortion grep gate**: `grep -iPoE` for abortion synonyms returns matches only inside §3 body of /for-policymakers/. Helper `scripts/gates/policy-pillar-abortion-section.mjs` parses H2 boundaries. Max 3 matches in §3 body, 0 elsewhere.
- **Expanded abortion synonym list**: include Roe v Wade, Dobbs v Jackson, feticide, fetal personhood, heartbeat bill, post-abortive, abortive (adjective).
- **MAHA mention budget**: `grep -ciPoE '\bMAHA\b'` ≤ 2 per pillar; expansion "Make America Healthy Again" counts toward same budget; case-insensitive enforcement.
- **Foundation lobbying-denial grep**: `grep -iPoE '\b(does not|will not|abstains from)\s+(lobby|engage in (substantial )?(political|legislative) activity)\b'` returns 0; plus synonym coverage.

### Citation drift watch
- **Errata coverage for cited policy-research articles**: same `errata_count` + `last_errata_date` mechanism as 2-pillar spec (sketched in `getting-started-pillars-design.md` v1.3 Prerequisites).

### Scheduling
- **Phase 3 explicit Wk-by-Wk schedule**: v1.2 had Wks 7-10 with reviewer-engagement as serial dependency on Wks 5-6 recruitment. Recruitment timeline + R15 paid third-party fallback budget are unresolved.

### Discoverability
- **Spec's own risk register exposure**: R13 in v1.2 enumerated CF Pages build artifacts, satellite repo, Claude Code transcripts, GitHub Codespaces, org-internal code search, LSP caches, `.recovered-docs/`, Bing Webmaster Tools AI Search Queries CSVs. Repo-public sanitization workflow undefined.

## 3. Prerequisites before resuming this spec

Capture before any Phase 3 work starts. None of these are blockers for the 2-pillar suite (`2026-05-14-getting-started-pillars-design.md` v1.3) shipping.

- **Reviewer recruitment**: identify and engage 1+ non-Brian named reviewer with non-Brian GitHub account. Document on `docs/legal-reviews/reviewer-roster.md` (schema-pinned YAML front-matter).
- **Foundation governance clarification**: declare Brian's relationship to RRM Foundation board (member? officer? director?). If Brian is sole/dominant board influence, retained counsel engagement is a hard prerequisite.
- **rrm-foundation-site Organization JSON-LD**: ship the foundation-site's Organization graph node with `taxID` BEFORE policy pillar references it via `sameAs`.
- **`docs/legal-reviews/` directory**: create with `reviewer-roster.md` (schema-pinned YAML) and at least one trial attestation file.
- **`scripts/gates/validate-legal-attestation.mjs`**: implement + test against fixtures before Phase 3 starts.
- **Retraction protocol**: document `<date>-RETRACTED.md` workflow + R1 audit-hold integration.

## 4. Estimated complexity at resumption

Based on v1.2 state when deferred:
- Spec length: ~300 lines of net-new content (beyond what's already in v1.3 of the 2-pillar spec)
- New gates: ~8 (legal attestation, foundation Organization JSON-LD, abortion section-aware, MAHA budget, Foundation lobbying-denial, foundation co-brand link target, reviewer roster, retraction protocol)
- New decisions: ~12 (policy-specific bylines, CTAs, JSON-LD invariants, attestation artifact, reviewer constraints, abortion section design)
- New risks: ~5 (R3 501(c)(3) advocacy, R4 partisan / progressive alienation, R6 Naomi leak via policy JSON-LD, R7 PDF promise slip, R15 Foundation legal review slip)
- New invariants: ~5 (attestation artifact + reviewer roster + abortion section-aware + Foundation EIN graph + MAHA budget)

## 5. References

- `2026-05-14-getting-started-pillars-design.md` v1.3 (the 2-pillar spec that absorbed everything else)
- v1.2 of the 2-pillar spec contained the full policy pillar design; recovered from git history at commit ≤ 2026-05-14 if needed
- `arise-intel-2026-05-07.md` (memory) , the asymptotic-complexity observation that drove the trim
- `feedback-naomi-profile-updates-on-hold.md` (memory) , UPMC capture-only HARD RULE that constrains policy pillar byline + attribution
- `feedback-naomi-honorific-to-members.md` (memory) , honorific rule that applies to all pillar bylines
