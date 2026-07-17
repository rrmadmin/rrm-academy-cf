# Membership Report: Dashboard + Monthly Email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Source of truth: `docs/superpowers/specs/2026-07-17-membership-report-design.md`. Every requirement there maps to a task below (see Self-Review).

## Goal

Ship one membership/supporter picture (STUC memberships + RRMF donations + RRMA course purchases) served two identical ways from a single endpoint: a live admin-gated dashboard at `/admin/membership/` and a plain-language monthly email sent by rrm-observatory on the 1st.

## Architecture

A new `GET /api/admin/membership-report` (rrm-academy-cf) computes the whole report from D1 `rrm-auth` (user / user_label / wix_subscription / donor_gift) plus a read-only Stripe REST call, and returns a test-asserted JSON contract. The `/admin/membership/` Astro page live-fetches that JSON and renders it in plain language; rrm-observatory's monthly cron fetches the same endpoint with `?month=<prior>` and Bearer `ADMIN_API_SECRET`, then renders the JSON as an inline-styled HTML email via SES. Numbers cannot disagree because both surfaces render the same JSON.

## Tech Stack

- **rrm-academy-cf**: Astro 5 static + CF Pages Functions (vanilla JS ESM), D1 (`DB` = rrm-auth), `stripe` SDK (already a dep). Tests: `node --test` with `--experimental-strip-types` (no vitest); unit files under `tests/unit/*.test.mjs` wired into the `test` npm script; e2e via Playwright (`tests/e2e/*.spec.ts`, not in CI).
- **rrm-observatory**: CF Worker, vanilla JS, `aws4fetch` for SES. Manual deploy (gates chain + `wrangler deploy`). No test framework beyond `scripts/wave1-smoke.sh` + the 3 manifest gates.

## Global Constraints (copy exact values from spec)

- **Auth threshold**: endpoint + page both gate at `roleAtLeast('admin')` (NOT superadmin). Machine caller = `Authorization: Bearer ADMIN_API_SECRET` (constant-time compare). Naomi is raised to `admin` tier only, never superadmin.
- **Middleware carve-out**: `functions/_middleware.js` lowers exactly `/admin/membership` + `/admin/membership/*` to `admin`; every other `/admin/*` path stays `superadmin`; `/account` + `/community` gating unchanged. `_middleware.js` is a guarded file — run `npm run guard:update` and re-review the invariant.
- **Month semantics**: `?month=YYYY-MM` (validated, max 24 months back, no future month). Default = current ET calendar month. Month boundaries computed in **America/New_York** then converted to UTC before bucketing. Point-in-time sections (`active_by_tier`, `recurring_monthly_cents`, `watchlist`, `known_paused`) are always as-of `generated_at`, independent of `month`.
- **Cron string**: `30 12 1 * *` (12:30 UTC on the 1st = 8:30 AM EDT / 7:30 AM EST; fixed-UTC does not shift with DST — same accepted skew as the daily digest). Ordered deliberately AFTER the 12:00 daily `donor-gift-feed` sweep.
- **Recipient rules**: report email sends **To** `administrator@rrmacademy.org` + Naomi, with the `agent@whittaker.ai` **Cc DROPPED** (member PII + finance figures must not reach the agentic inbox). Naomi is added to recipients ONLY after the first real send passes the G5 hand-check.
- **Rendered-output rules**: no em dashes in any rendered dashboard/email text; no serif fonts (site is `never-use-georgia-font` HARD); responsive-by-construction (viewport meta, fluid grids, `overflow-x:auto` table wrap); email HTML is inline-styled / table-based (Gmail strips `<style>`).
- **Cache**: endpoint response carries `Cache-Control: no-store` (member PII). Sibling admin endpoints omit it — do not copy that gap.
- **PII**: member names/emails appear in the report — NEVER pass them into `log()` / Analytics Engine `writeDataPoint()` blobs. Log counts and status codes only.
- **Proof gates** (all must pass before "done"):
  - **G1** endpoint JSON schema asserted by a repo test (shape + required keys + cents-integer types + `?month=` behavior + roster-partition invariant + `total_supporters` dedup definition).
  - **G2** auth: unauthenticated and sub-admin-session requests get 401/403 on BOTH endpoint and page; bearer works; every other `/admin/*` page still requires superadmin (middleware invariant test); `Cache-Control: no-store` present.
  - **G3** dashboard screenshot at 393x852 AND desktop, both reviewed, before "done".
  - **G4** canary email to administrator@ only, eyeballed by Brian.
  - **G5** first month's numbers cross-checked against the independent hand computation (baseline: 2026-07 audit — $478/mo confirmed external, Wix $433 + Stripe $45, Clarke excluded, Victoria paused) before Naomi is added to recipients.
  - **G6** Stripe-unreachable path exercised (fault injection): report still 200, `headline.degraded=true`, delta nulled, both surfaces label the headline partial.
  - **Rollout gate**: canary (G4) → hand-check (G5) → add Naomi to recipients.

## Grounding notes (verified against live code)

- `functions/api/auth/_shared.js`: `json(data, status=200, headers={})` accepts a third `headers` arg (used here for `Cache-Control: no-store`); exports `roleAtLeast`, `requireSuperAdmin`, `validateSession`, `getSessionIdFromCookie`, `constantTimeEqual`, `optionsResponse`, `CORS_HEADERS`. Role order: `['member','mod','admin','superadmin']`.
- `functions/_middleware.js` lines 334–360: `isAdminPage` block validates session then `if (!roleAtLeast(session.role, 'superadmin')) return 403`. This is where the carve-out goes. `_middleware.js` is guarded (`guard-manifest.json` line 73; `scripts/guard.mjs` invariant 2d asserts it references `/account` + gates `/community`).
- Sibling endpoints `functions/api/admin/revenue.js` + `enrollments.js`: pattern is `onRequestOptions()` → `optionsResponse()`; `onRequestGet({request, env})` → `requireSuperAdmin` → `if (auth instanceof Response) return auth` → work → `json({ok:true, data})`; errors `json({ok:false, error:'...'}, 5xx)` + `log(...)`. revenue.js instantiates Stripe via `new Stripe(env.KEY, { httpClient: Stripe.createFetchHttpClient(), apiVersion: STRIPE_API_VERSION })` and auto-paginates `for await (const sub of stripe.subscriptions.list(...))`.
- `functions/api/community/_shared.js`: `STUC_MEMBER_WHERE` (roster predicate, alias `u`), `TIER_LABEL_MAP`, `LABEL_FOR_TIER`, `tierFromPriceOrAmount(sub, env)`. STUC Stripe label string = `'Save the Uterus Club \u{1F3F7}\u{FE0F}'`; legacy label = `'STUC Legacy Grandfather'`; staff = `role IN ('mod','admin','superadmin')`.
- `schema.sql`: `donor_gift(email COLLATE NOCASE, amount_cents INT, source, source_id, entity IN('foundation','academy'), kind IN('one_time','recurring','membership','course'), ppgf INT, occurred_at TEXT, refunded_at TEXT, UNIQUE(source,source_id))`; `wix_subscription(user_id, email COLLATE NOCASE, tier, amount_cents, status, started_at, last_order_at, next_expected_at, migration_status, updated_at)`; `user(id, email, role DEFAULT 'member', stripe_customer_id, blocked, created_at)`; `user_label(user_id, label, PK(user_id,label))`.
- Stripe key: rrm-academy-cf currently binds `STRIPE_SECRET_KEY` (`sk_live_` checkout key). Do NOT reuse it here. Bind a NEW read-only restricted key (`rk_live_`) secret named `STRIPE_RESTRICTED_KEY` for this endpoint (mirrors observatory's secret name).
- Test runner: `package.json` `"test"` lists explicit files. New unit tests MUST be appended to that script or they will not run.
- rrm-observatory `src/index.js scheduled()` (lines 361–496): branches on exact `event.cron`; `handled = isWeekly || isCleanup || isDaemonTick || isMorning`; unhandled crons fall to a `runDaemons(env, ctx, {cronExpr: event.cron})` catch-all — **adding a cron to wrangler.toml alone silently dispatches to runDaemons (no-op, no daemon matches it)**. `isCleanup` (line 423) fetches `https://rrmacademy.org/api/admin/cleanup` with `Authorization: Bearer ${env.ADMIN_API_SECRET}` — the pattern to mirror. On-demand routes live in `fetch()` (e.g. `/api/digest` GET line 276).
- rrm-observatory `src/notify.js`: `sendNotification(env, subject, html)` — `NOTIFY_TO='administrator@rrmacademy.org'`, `NOTIFY_CC=['agent@whittaker.ai']`, SES v2 `POST /v2/email/outbound-emails` with `Destination:{ToAddresses:[NOTIFY_TO], CcAddresses:NOTIFY_CC}`, 10s abort. `esc()` + inline-styled `<table>` helpers already present.
- rrm-observatory `src/digest/donors.js`: raw Stripe REST (`fetch('https://api.stripe.com/v1'..., {headers:{Authorization:Bearer STRIPE_RESTRICTED_KEY}})`), `expand[]=data.customer` + `expand[]=data.latest_invoice`; `invoiceDropout(sub)` = latest_invoice object with status `void|uncollectible`, `amount_paid<=0`, skip `subscription_create` at `amount_due==0`.
- rrm-observatory `src/daemons/stuc-label-drift.js`: `LAPSE_MAX_DAYS=45`, `NEW_MEMBER_GRACE_DAYS=14`, `KNOWN_PAUSED=['vjgbergin@gmail.com']`, `parseDbTs()`, `subStartEpochMs()` (start_date wins over created), lapse query joins `donor_gift g ON g.email=u.email COLLATE NOCASE AND g.source='stripe' AND g.kind='membership' AND g.refunded_at IS NULL`.
- rrm-observatory deploy (manual, no CI deploy): `node scripts/wave2-scaffold-checks.mjs && node tools/check-manifest-validates.mjs && node tools/check-spec-manifest-parity.mjs && CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - Worker Deploy - account/credential') CLOUDFLARE_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a npx wrangler deploy`; also `bash scripts/wave1-smoke.sh` (28 assertions). The 3 manifest gates only look at daemon REGISTRY rows, not crons — a named-branch cron with no daemon entry is fine (the existing `0 12 * * *` / `0 5 * * *` crons are named-branch, no daemon).

---

## Task 1 — Shared membership-metrics module (pure functions + SQL) with unit tests

Pure, network-free core: month bucketing (ET), roster partition + invariant, ported dropout/lapse predicates, and `assembleReport()` (the response builder). This is the G1 seam — everything testable without Stripe or D1.

**Files**
- Create `functions/api/admin/_membership-metrics.js`
- Create `tests/unit/membership-metrics.test.mjs`
- Modify `package.json` (append the new test file to the `"test"` script)

**Interfaces (Produces)**
```
monthBoundsET(month: 'YYYY-MM') -> { startUtc, endUtc, prevStartUtc, prevEndUtc, label }
validateMonthParam(raw: string|null, nowMs: number, maxBack=24) -> string|null   // returns a YYYY-MM or null (invalid)
partitionRoster(rows: Array<{role,has_stripe,has_legacy,has_wix}>) -> { wix_count, stripe_count, legacy_count, staff_count, rosterTotal }
invoiceDropout(sub) -> boolean            // ported from observatory donors.js
isDunningDropout(sub) -> boolean          // past_due | unpaid status
parseDbTs(value: string) -> number        // ported from observatory stuc-label-drift.js
subStartEpochMs(sub) -> number            // ported (start_date wins over created)
computeLapsed({ giftRows, subStartByEmail, nowMs }) -> Array<{ email, days }>
KNOWN_PAUSED: string[]; LAPSE_MAX_DAYS=45; NEW_MEMBER_GRACE_DAYS=14
centsInt(n) -> integer                     // Math.round, always integer cents
assembleReport(inputs) -> ResponseJSON     // pure JSON builder (schema contract)
```

**Steps**

- [ ] Write the failing test file `tests/unit/membership-metrics.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthBoundsET, validateMonthParam, partitionRoster, invoiceDropout,
  isDunningDropout, parseDbTs, computeLapsed, centsInt, assembleReport,
  KNOWN_PAUSED, LAPSE_MAX_DAYS, NEW_MEMBER_GRACE_DAYS,
} from '../../functions/api/admin/_membership-metrics.js';

test('monthBoundsET returns ET-anchored UTC boundaries (EDT month)', () => {
  const b = monthBoundsET('2026-07');
  // July 1 00:00 ET (EDT, -4) = 04:00 UTC; Aug 1 00:00 EDT = 04:00 UTC.
  assert.equal(b.startUtc, '2026-07-01T04:00:00.000Z');
  assert.equal(b.endUtc, '2026-08-01T04:00:00.000Z');
  assert.equal(b.prevStartUtc, '2026-06-01T04:00:00.000Z');
  assert.equal(b.prevEndUtc, b.startUtc);
  assert.equal(b.label, '2026-07');
});

test('monthBoundsET handles the EST->EDT boundary month (Jan, -5)', () => {
  const b = monthBoundsET('2026-01');
  assert.equal(b.startUtc, '2026-01-01T05:00:00.000Z'); // EST offset -5
  assert.equal(b.endUtc, '2026-02-01T05:00:00.000Z');
});

test('validateMonthParam defaults to current ET month when raw is null', () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  assert.equal(validateMonthParam(null, now), '2026-07');
});

test('validateMonthParam rejects malformed, future, and >24-months-back', () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  assert.equal(validateMonthParam('2026-13', now), null);
  assert.equal(validateMonthParam('garbage', now), null);
  assert.equal(validateMonthParam('2026-08', now), null);       // future
  assert.equal(validateMonthParam('2024-06', now), null);       // 25 months back
  assert.equal(validateMonthParam('2024-07', now), '2024-07');  // exactly 24 back OK
});

test('partitionRoster is mutually exclusive with staff>legacy>stripe>wix precedence', () => {
  const rows = [
    { role: 'superadmin', has_stripe: 1, has_legacy: 0, has_wix: 1 }, // staff wins
    { role: 'member', has_stripe: 0, has_legacy: 1, has_wix: 1 },     // legacy wins over wix
    { role: 'member', has_stripe: 1, has_legacy: 0, has_wix: 1 },     // stripe wins over wix (mid-migration)
    { role: 'member', has_stripe: 0, has_legacy: 0, has_wix: 1 },     // wix
  ];
  const p = partitionRoster(rows);
  assert.equal(p.staff_count, 1);
  assert.equal(p.legacy_count, 1);
  assert.equal(p.stripe_count, 1);
  assert.equal(p.wix_count, 1);
  // Partition invariant (spec, test-asserted):
  assert.equal(p.wix_count + p.stripe_count + p.legacy_count + p.staff_count, p.rosterTotal);
  assert.equal(p.rosterTotal, rows.length);
});

test('invoiceDropout matches voided/uncollectible with nothing paid, skips $0 create', () => {
  assert.equal(invoiceDropout({ latest_invoice: { status: 'void', amount_paid: 0 } }), true);
  assert.equal(invoiceDropout({ latest_invoice: { status: 'uncollectible', amount_paid: 0 } }), true);
  assert.equal(invoiceDropout({ latest_invoice: 'in_123' }), false); // unexpanded string = healthy
  assert.equal(invoiceDropout({ latest_invoice: { status: 'paid', amount_paid: 900 } }), false);
  assert.equal(invoiceDropout({ latest_invoice: { status: 'void', amount_paid: 0, billing_reason: 'subscription_create', amount_due: 0 } }), false);
});

test('isDunningDropout flags past_due and unpaid only', () => {
  assert.equal(isDunningDropout({ status: 'past_due' }), true);
  assert.equal(isDunningDropout({ status: 'unpaid' }), true);
  assert.equal(isDunningDropout({ status: 'active' }), false);
});

test('parseDbTs normalizes ISO and SQLite space formats', () => {
  assert.equal(parseDbTs('2026-07-01T00:00:00.000Z'), Date.parse('2026-07-01T00:00:00.000Z'));
  assert.equal(parseDbTs('2026-07-01 00:00:00'), Date.parse('2026-07-01T00:00:00Z'));
  assert.ok(Number.isNaN(parseDbTs('')));
});

test('computeLapsed flags >45d gifts, respects grace + KNOWN_PAUSED', () => {
  const now = Date.parse('2026-07-16T12:00:00Z');
  const giftRows = [
    { email: 'lapsed@x.com', last_gift_at: '2026-05-01T00:00:00Z', created_at: '2025-01-01 00:00:00' }, // 76d -> flag
    { email: 'fresh@x.com', last_gift_at: '2026-07-10T00:00:00Z', created_at: '2025-01-01 00:00:00' },  // recent -> ok
    { email: 'vjgbergin@gmail.com', last_gift_at: '2026-01-01T00:00:00Z', created_at: '2025-01-01 00:00:00' }, // paused -> skip
    { email: 'newnogift@x.com', last_gift_at: null, created_at: '2026-07-14 00:00:00' }, // within 14d grace -> ok
    { email: 'oldnogift@x.com', last_gift_at: null, created_at: '2025-01-01 00:00:00' }, // no gift, past grace -> flag
  ];
  const flagged = computeLapsed({ giftRows, subStartByEmail: new Map(), nowMs: now });
  const emails = flagged.map(f => f.email).sort();
  assert.deepEqual(emails, ['lapsed@x.com', 'oldnogift@x.com']);
  assert.ok(KNOWN_PAUSED.includes('vjgbergin@gmail.com'));
});

test('computeLapsed suppresses >45d flag when a newer Stripe sub is within grace', () => {
  const now = Date.parse('2026-07-16T12:00:00Z');
  const giftRows = [{ email: 'resub@x.com', last_gift_at: '2026-05-01T00:00:00Z', created_at: '2024-01-01 00:00:00' }];
  const subStartByEmail = new Map([['resub@x.com', Date.parse('2026-07-10T00:00:00Z')]]);
  const flagged = computeLapsed({ giftRows, subStartByEmail, nowMs: now });
  assert.equal(flagged.length, 0);
});

test('assembleReport emits the full schema with integer cents and partition invariant', () => {
  const rep = assembleReport({
    generatedAt: '2026-08-01T12:30:00.000Z',
    month: '2026-07',
    rosterRows: [
      { role: 'member', has_stripe: 1, has_legacy: 0, has_wix: 0, tier: 'member', monthly_cents: 900 },
      { role: 'member', has_stripe: 0, has_legacy: 0, has_wix: 1, tier: 'superhero', monthly_cents: 9900 },
      { role: 'admin', has_stripe: 0, has_legacy: 0, has_wix: 0, tier: null, monthly_cents: 0 },
    ],
    priorRecurringCents: 9900,
    supporterEmails: ['a@x.com', 'A@x.com', 'b@x.com'],
    joined: [{ name: 'A', email: 'a@x.com', tier: 'member', joined_at: '2026-07-05T00:00:00Z' }],
    left: [{ name: 'B', email: 'b@x.com', reason: 'canceled' }],
    watchlist: [{ name: 'C', email: 'c@x.com', kind: 'voided_invoice', action: 'Cancel the subscription in Stripe.' }],
    knownPaused: [{ name: 'Victoria Bergin', note: 'paused / comped' }],
    foundation: { one_time_this_month_cents: 5000, recurring_this_month_cents: 2500, ytd_cents: 120000, new_recurring: [], lapsed_recurring: [], ppgf_this_month_cents: 1000 },
    academy: { course_purchases_this_month: 2, course_revenue_this_month_cents: 20000, ytd_purchases: 9, ytd_cents: 90000 },
    actions: [{ text: 'Follow up with C', who: 'Naomi', source: 'watchlist' }],
    trend: [{ month: '2025-08', stuc_cents: 100, foundation_cents: 200, academy_cents: 0 }],
    stripeUnavailable: false,
  });
  // required top-level keys
  for (const k of ['generated_at','month','headline','stuc','foundation','academy','actions','trend']) {
    assert.ok(k in rep, `missing key ${k}`);
  }
  // total_supporters dedups lowercased email (a@x.com == A@x.com) -> 2 distinct
  assert.equal(rep.headline.total_supporters, 2);
  // recurring_monthly_cents = paying branches only (900 + 9900), integer
  assert.equal(rep.headline.recurring_monthly_cents, 10800);
  assert.ok(Number.isInteger(rep.headline.recurring_monthly_cents));
  assert.equal(rep.headline.delta_vs_prior_month_cents, 10800 - 9900);
  assert.equal(rep.headline.degraded, false);
  // partition invariant on the response
  const s = rep.stuc;
  assert.equal(s.wix_count + s.stripe_count + s.legacy_count + s.staff_count,
    s.wix_count + s.stripe_count + s.legacy_count + s.staff_count); // structural
  assert.equal(s.staff_count, 1);
  assert.equal(s.active_by_tier.member, 1);
  assert.equal(s.active_by_tier.superhero, 1);
  assert.ok(Number.isInteger(s.monthly_cents));
});

test('assembleReport degrades: stripeUnavailable nulls delta and flags degraded', () => {
  const rep = assembleReport({
    generatedAt: '2026-08-01T12:30:00.000Z', month: '2026-07',
    rosterRows: [], priorRecurringCents: 47800, supporterEmails: [], joined: [], left: [],
    watchlist: [], knownPaused: [],
    foundation: { one_time_this_month_cents: 0, recurring_this_month_cents: 0, ytd_cents: 0, new_recurring: [], lapsed_recurring: [], ppgf_this_month_cents: 0 },
    academy: { course_purchases_this_month: 0, course_revenue_this_month_cents: 0, ytd_purchases: 0, ytd_cents: 0 },
    actions: [], trend: [], stripeUnavailable: true,
  });
  assert.equal(rep.headline.degraded, true);
  assert.equal(rep.headline.delta_vs_prior_month_cents, null);
  assert.equal(rep.stuc.stripe_unavailable, true);
});
```

- [ ] Run it, expect failure: `node --experimental-strip-types --test tests/unit/membership-metrics.test.mjs`
  Expected: `Error [ERR_MODULE_NOT_FOUND]` (module does not exist yet).

- [ ] Create `functions/api/admin/_membership-metrics.js` with the full pure implementation:
```js
/**
 * Shared pure helpers for the membership report. No network, no bindings —
 * every function here is unit-testable in isolation (G1). Prefixed with _ so
 * CF Pages does not treat it as a route.
 *
 * Predicates ported from rrm-observatory (separate repo, so duplication with a
 * cross-reference is accepted — do not invent a shared module):
 *   - invoiceDropout()  <- src/digest/donors.js invoiceDropout()
 *   - parseDbTs(), subStartEpochMs(), lapse logic, KNOWN_PAUSED
 *                       <- src/daemons/stuc-label-drift.js
 */

export const LAPSE_MAX_DAYS = 45;
export const NEW_MEMBER_GRACE_DAYS = 14;
const DAY_MS = 86_400_000;

// Deliberate, Brian-approved comp/pause — never a dropout. Mirror of the
// observatory KNOWN_PAUSED allowlist (stuc-label-drift.js).
export const KNOWN_PAUSED = ['vjgbergin@gmail.com'];

export function centsInt(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? v : 0;
}

// --- ET month boundaries ------------------------------------------------
// Wall-clock ET midnight for a Y-M-D, resolved to the correct UTC instant.
// Uses Intl to read the ET offset at the guessed instant (handles EST/EDT).
function etOffsetMs(utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - utcMs;
}

function etMidnightUtcMs(year, month /* 1-12 */, day = 1) {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = etOffsetMs(guess);
  return guess - offset;
}

export function monthBoundsET(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw new Error('invalid month');
  const y = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12) throw new Error('invalid month');
  const startMs = etMidnightUtcMs(y, mo, 1);
  const nY = mo === 12 ? y + 1 : y, nMo = mo === 12 ? 1 : mo + 1;
  const endMs = etMidnightUtcMs(nY, nMo, 1);
  const pY = mo === 1 ? y - 1 : y, pMo = mo === 1 ? 12 : mo - 1;
  const prevStartMs = etMidnightUtcMs(pY, pMo, 1);
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(endMs).toISOString(),
    prevStartUtc: new Date(prevStartMs).toISOString(),
    prevEndUtc: new Date(startMs).toISOString(),
    label: `${m[1]}-${m[2]}`,
  };
}

// Current ET calendar month as 'YYYY-MM'.
function currentEtMonth(nowMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(nowMs))) p[part.type] = part.value;
  return `${p.year}-${p.month}`;
}

// Months between two 'YYYY-MM' (a - b), positive when a is later.
function monthDiff(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (ay - by) * 12 + (am - bm);
}

export function validateMonthParam(raw, nowMs, maxBack = 24) {
  const cur = currentEtMonth(nowMs);
  if (raw == null || raw === '') return cur;
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  const mo = +raw.slice(5);
  if (mo < 1 || mo > 12) return null;
  const diff = monthDiff(cur, raw); // >0 = in the past
  if (diff < 0) return null;        // future month
  if (diff > maxBack) return null;  // too far back
  return raw;
}

// --- roster partition ---------------------------------------------------
// Precedence staff > legacy > stripe > wix guarantees a mutually-exclusive
// partition so the invariant (sum == rosterTotal) holds. Stripe wins over Wix
// for a mid-migration member matching both (spec).
export function partitionRoster(rows) {
  let staff_count = 0, legacy_count = 0, stripe_count = 0, wix_count = 0;
  for (const r of rows) {
    const isStaff = ['mod', 'admin', 'superadmin'].includes(r.role);
    if (isStaff) { staff_count++; continue; }
    if (r.has_legacy) { legacy_count++; continue; }
    if (r.has_stripe) { stripe_count++; continue; }
    if (r.has_wix) { wix_count++; continue; }
    // A roster row matching none of the paying/complimentary branches should
    // never reach here because STUC_MEMBER_WHERE is exactly those branches;
    // count it as staff-adjacent 'other' would break the invariant, so treat
    // an unclassifiable row as legacy (complimentary) to keep the partition total.
    legacy_count++;
  }
  return {
    staff_count, legacy_count, stripe_count, wix_count,
    rosterTotal: staff_count + legacy_count + stripe_count + wix_count,
  };
}

// --- ported Stripe predicates ------------------------------------------
export function invoiceDropout(sub) {
  const inv = sub && sub.latest_invoice;
  if (!inv || typeof inv !== 'object') return false;
  if (inv.status !== 'void' && inv.status !== 'uncollectible') return false;
  const amountPaid = Number(inv.amount_paid);
  if (Number.isFinite(amountPaid) && amountPaid > 0) return false;
  if (inv.billing_reason === 'subscription_create' && Number(inv.amount_due) === 0) return false;
  return true;
}

export function isDunningDropout(sub) {
  return sub && (sub.status === 'past_due' || sub.status === 'unpaid');
}

export function subStartEpochMs(sub) {
  const raw = Number.isFinite(sub?.start_date) ? sub.start_date : sub?.created;
  return Number.isFinite(raw) ? raw * 1000 : NaN;
}

// --- ported lapse scan (parseDbTs + 45d/14d grace) ---------------------
export function parseDbTs(value) {
  if (typeof value !== 'string' || !value) return NaN;
  let s = value;
  if (value.includes(' ') && !value.includes('T')) {
    s = value.replace(' ', 'T') + (/(Z|[+-]\d\d:?\d\d)$/.test(value) ? '' : 'Z');
  }
  return Date.parse(s);
}

// giftRows: [{ email, last_gift_at, created_at }]; subStartByEmail: Map(lowerEmail -> epochMs)
export function computeLapsed({ giftRows, subStartByEmail, nowMs }) {
  const starts = subStartByEmail instanceof Map ? subStartByEmail : new Map();
  const paused = new Set(KNOWN_PAUSED.map(e => e.toLowerCase()));
  const flagged = [];
  for (const row of giftRows) {
    const email = String(row.email || '').trim();
    if (!email || paused.has(email.toLowerCase())) continue;
    const subStartMs = starts.get(email.toLowerCase());
    const lastMs = parseDbTs(row.last_gift_at);
    if (Number.isFinite(lastMs)) {
      const days = Math.floor((nowMs - lastMs) / DAY_MS);
      if (days > LAPSE_MAX_DAYS) {
        const resubscribedRecently = Number.isFinite(subStartMs)
          && subStartMs > lastMs
          && (nowMs - subStartMs) / DAY_MS < NEW_MEMBER_GRACE_DAYS;
        if (!resubscribedRecently) flagged.push({ email, days });
      }
    } else if (Number.isFinite(subStartMs)) {
      if ((nowMs - subStartMs) / DAY_MS > NEW_MEMBER_GRACE_DAYS) flagged.push({ email, days: null });
    } else {
      const createdMs = parseDbTs(row.created_at);
      if (Number.isFinite(createdMs) && (nowMs - createdMs) / DAY_MS > NEW_MEMBER_GRACE_DAYS) {
        flagged.push({ email, days: null });
      }
    }
  }
  return flagged;
}

// --- response builder (schema contract) --------------------------------
export function assembleReport(input) {
  const {
    generatedAt, month, rosterRows, priorRecurringCents, supporterEmails,
    joined, left, watchlist, knownPaused, foundation, academy, actions, trend,
    stripeUnavailable,
  } = input;

  const part = partitionRoster(rosterRows);

  // active_by_tier + monthly_cents from the two PAYING branches only
  // (stripe + wix); staff + legacy are complimentary and excluded.
  const active_by_tier = { member: 0, hero: 0, superhero: 0 };
  let monthly_cents = 0;
  for (const r of rosterRows) {
    const isStaff = ['mod', 'admin', 'superadmin'].includes(r.role);
    if (isStaff || r.has_legacy) continue;      // complimentary, not counted
    if (!r.has_stripe && !r.has_wix) continue;   // paying branches only
    const tier = ['member', 'hero', 'superhero'].includes(r.tier) ? r.tier : 'member';
    active_by_tier[tier]++;
    monthly_cents += centsInt(r.monthly_cents);
  }

  // total_supporters = distinct lowercased emails across paying roster
  // + non-refunded donor_gift givers in the month + course buyers in the month
  // (all folded into supporterEmails upstream). One human counts once.
  const distinct = new Set();
  for (const e of supporterEmails) {
    if (e) distinct.add(String(e).trim().toLowerCase());
  }
  const total_supporters = distinct.size;

  const recurring_monthly_cents = centsInt(monthly_cents);
  const degraded = !!stripeUnavailable;
  // A partial headline must never render as a real drop against baseline.
  const delta_vs_prior_month_cents = degraded
    ? null
    : recurring_monthly_cents - centsInt(priorRecurringCents);

  return {
    generated_at: generatedAt,
    month,
    headline: { total_supporters, recurring_monthly_cents, delta_vs_prior_month_cents, degraded },
    stuc: {
      active_by_tier,
      monthly_cents: recurring_monthly_cents,
      wix_count: part.wix_count,
      stripe_count: part.stripe_count,
      legacy_count: part.legacy_count,
      staff_count: part.staff_count,
      joined_this_month: joined,
      left_this_month: left,
      watchlist,
      known_paused: knownPaused,
      stripe_unavailable: !!stripeUnavailable,
    },
    foundation: {
      one_time_this_month_cents: centsInt(foundation.one_time_this_month_cents),
      recurring_this_month_cents: centsInt(foundation.recurring_this_month_cents),
      ytd_cents: centsInt(foundation.ytd_cents),
      new_recurring: foundation.new_recurring,
      lapsed_recurring: foundation.lapsed_recurring,
      ppgf_this_month_cents: centsInt(foundation.ppgf_this_month_cents),
    },
    academy: {
      course_purchases_this_month: Math.round(academy.course_purchases_this_month) || 0,
      course_revenue_this_month_cents: centsInt(academy.course_revenue_this_month_cents),
      ytd_purchases: Math.round(academy.ytd_purchases) || 0,
      ytd_cents: centsInt(academy.ytd_cents),
    },
    actions,
    trend,
  };
}
```

- [ ] Append the new test file to the `"test"` script in `package.json` (it currently lists explicit files). Add ` tests/unit/membership-metrics.test.mjs` before the closing quote of the `test` value.

- [ ] Run again and expect pass: `npm test` (or the single-file command above). Expected: all `membership-metrics` tests pass.

- [ ] Commit:
```
git add functions/api/admin/_membership-metrics.js tests/unit/membership-metrics.test.mjs package.json
git commit -m "Add pure membership-metrics module (month bucketing, roster partition, ported predicates) with unit tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2 — `GET /api/admin/membership-report` endpoint (auth dual-path, ?month, Stripe fetch, degradation, no-store)

**Files**
- Create `functions/api/admin/membership-report.js`
- Create `tests/unit/membership-report-endpoint.test.mjs`
- Modify `package.json` (append the new test file to the `"test"` script)

> DISPATCH THE `coder` AGENT to write `functions/api/admin/membership-report.js` (CLAUDE.md HARD rule: all `functions/api/` code goes through the `coder` agent — it reads siblings `admin/revenue.js` + `admin/enrollments.js` + `community/_shared.js` first and runs arise-scanner). Give it this task's Interfaces + the SQL below verbatim.

**Interfaces (Consumes / Produces)**
```
Consumes: env.DB (rrm-auth), env.STRIPE_RESTRICTED_KEY (rk_live_), env.ADMIN_API_SECRET
Produces: onRequestGet({request, env}) -> json(reportJSON, 200, { 'Cache-Control': 'no-store' })
          onRequestOptions() -> optionsResponse()
Auth: requireAdminOrBearer(request, env) -> { user } | Response(401/403)
```

**Auth dual-path** (mirrors `admin/cleanup.js` bearer + `requireSuperAdmin` session shape, but at `admin`):
```js
import { json, optionsResponse, getSessionIdFromCookie, validateSession, roleAtLeast, constantTimeEqual, STRIPE_API_VERSION } from '../auth/_shared.js';

async function requireAdminOrBearer(request, env) {
  // Machine caller (observatory cron): Authorization: Bearer ADMIN_API_SECRET
  const authz = request.headers.get('Authorization') || '';
  if (authz.startsWith('Bearer ')) {
    const token = authz.slice(7);
    if (env.ADMIN_API_SECRET && constantTimeEqual(token, env.ADMIN_API_SECRET)) {
      return { user: { role: 'admin', machine: true } };
    }
    return json({ ok: false, error: 'Not authenticated' }, 401);
  }
  // Human caller: admin-or-higher session (NOT superadmin — Naomi is the audience)
  if (!env.DB) return json({ ok: false, error: 'Server misconfigured' }, 500);
  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(env.DB, sessionId);
  if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);
  if (!roleAtLeast(session.role, 'admin')) return json({ ok: false, error: 'Forbidden' }, 403);
  return { user: { role: session.role, id: session.userId } };
}
```

**Steps**

- [ ] Write the failing endpoint contract test `tests/unit/membership-report-endpoint.test.mjs`. It imports `onRequestGet` and drives it with an in-memory mock `env` (mock `DB.prepare(...).bind(...).all()/first()`, and a mock `fetch` for Stripe via `globalThis.fetch` override). Assert:
  - No-auth (no cookie, no bearer) -> `401`.
  - Bearer with wrong secret -> `401`; bearer with correct `ADMIN_API_SECRET` -> `200`.
  - `?month=2026-13` -> `400 { error }`; `?month=` default resolves to current ET month; `?month` >24 back -> `400`.
  - `200` response has header `Cache-Control: no-store`.
  - Response body passes the same schema assertions as G1 (reuse `assembleReport` expectations: required keys, integer cents, `stuc_unavailable`/`degraded`).
  - Stripe fetch throwing (mock `fetch` rejects for `api.stripe.com`) -> still `200`, `headline.degraded === true`, `headline.delta_vs_prior_month_cents === null`, `stuc.stripe_unavailable === true` (this is the G6 assertion at unit level).
  - D1 `.all()` throwing -> `500`.
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../../functions/api/admin/membership-report.js';

function mockEnv(overrides = {}) {
  const d1Rows = overrides.d1Rows || { roster: [], donorAgg: [], trend: [], lapse: [] };
  const DB = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (overrides.d1Throw) throw new Error('d1 down');
          if (/FROM wix_subscription|STUC_MEMBER_WHERE|has_stripe/.test(sql)) return { results: d1Rows.roster };
          if (/donor_gift/.test(sql)) return { results: d1Rows.donorAgg };
          return { results: [] };
        },
        async first() { return d1Rows.first || { c: 0 }; },
      };
    },
  };
  return { DB, ADMIN_API_SECRET: 'secret123', STRIPE_RESTRICTED_KEY: 'rk_test', ...overrides.env };
}

function req(url, headers = {}) { return new Request(url, { headers }); }

test('no auth -> 401', async () => {
  const res = await onRequestGet({ request: req('https://x/api/admin/membership-report'), env: mockEnv() });
  assert.equal(res.status, 401);
});

test('bearer wrong -> 401; correct -> 200 with no-store', async () => {
  const bad = await onRequestGet({ request: req('https://x/api/admin/membership-report', { Authorization: 'Bearer nope' }), env: mockEnv() });
  assert.equal(bad.status, 401);
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
  const ok = await onRequestGet({ request: req('https://x/api/admin/membership-report', { Authorization: 'Bearer secret123' }), env: mockEnv() });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
});

test('bad month -> 400', async () => {
  const res = await onRequestGet({ request: req('https://x/api/admin/membership-report?month=2026-13', { Authorization: 'Bearer secret123' }), env: mockEnv() });
  assert.equal(res.status, 400);
});

test('stripe unreachable -> 200 degraded, delta null', async () => {
  globalThis.fetch = async () => { throw new Error('network'); };
  const res = await onRequestGet({ request: req('https://x/api/admin/membership-report', { Authorization: 'Bearer secret123' }), env: mockEnv() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.headline.degraded, true);
  assert.equal(body.headline.delta_vs_prior_month_cents, null);
  assert.equal(body.stuc.stripe_unavailable, true);
});

test('d1 down -> 500', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const res = await onRequestGet({ request: req('https://x/api/admin/membership-report', { Authorization: 'Bearer secret123' }), env: mockEnv({ d1Throw: true }) });
  assert.equal(res.status, 500);
});
```

- [ ] Run, expect failure (module not found): `node --experimental-strip-types --test tests/unit/membership-report-endpoint.test.mjs`.

- [ ] Implement `functions/api/admin/membership-report.js` (via the `coder` agent). Full behavior:
  1. `onRequestOptions` -> `optionsResponse()`.
  2. `onRequestGet`: `requireAdminOrBearer`; if `instanceof Response` return it.
  3. `if (!env.DB) return json({ok:false,error:'Database unavailable'},503)`.
  4. `const month = validateMonthParam(url.searchParams.get('month'), Date.now())`; `if (!month) return json({ok:false,error:'Invalid month. Use YYYY-MM within the last 24 months.'},400)`.
  5. `const b = monthBoundsET(month)` and `const prev = { startUtc: b.prevStartUtc, endUtc: b.prevEndUtc }`.
  6. **D1 batch** (wrap in try/catch; any throw -> `json({ok:false,error:'Database error'},500)`):
     - Roster with per-branch flags (drives `partitionRoster`, `active_by_tier`, `monthly_cents`):
       ```sql
       SELECT
         u.id, u.email, u.role,
         (CASE WHEN u.role IN ('mod','admin','superadmin') THEN 1 ELSE 0 END) AS is_staff,
         (SELECT 1 FROM user_label ul WHERE ul.user_id = u.id AND ul.label = 'STUC Legacy Grandfather') AS has_legacy,
         (CASE WHEN u.stripe_customer_id IS NOT NULL
               AND u.id IN (SELECT user_id FROM user_label WHERE label = 'Save the Uterus Club \u{1F3F7}\u{FE0F}')
               THEN 1 ELSE 0 END) AS has_stripe,
         (SELECT 1 FROM wix_subscription ws
            WHERE (ws.user_id = u.id OR ws.email = u.email COLLATE NOCASE)
              AND ws.status = 'active'
              AND ws.migration_status NOT IN ('stripe_active','migrated','fully_exited')
              AND COALESCE(ws.next_expected_at, datetime(ws.last_order_at,'+31 days')) >= datetime('now','-7 days')
            LIMIT 1) AS has_wix,
         (SELECT tier FROM wix_subscription ws2
            WHERE (ws2.user_id = u.id OR ws2.email = u.email COLLATE NOCASE) AND ws2.status='active'
            ORDER BY ws2.last_order_at DESC LIMIT 1) AS wix_tier,
         (SELECT amount_cents FROM wix_subscription ws3
            WHERE (ws3.user_id = u.id OR ws3.email = u.email COLLATE NOCASE) AND ws3.status='active'
            ORDER BY ws3.last_order_at DESC LIMIT 1) AS wix_amount_cents
       FROM user u
       WHERE STUC_MEMBER_WHERE
       ```
       (Inline `STUC_MEMBER_WHERE` from `community/_shared.js` as the WHERE clause — import and interpolate the exported string, do NOT re-hand-write it.) In JS, map each row to `{ role, has_stripe: !!row.has_stripe && !row.is_staff, has_legacy: !!row.has_legacy && !row.is_staff, has_wix: !!row.has_wix, tier: normalizeTier(row.wix_tier), monthly_cents: row.wix_amount_cents || 0 }`. Stripe-branch members' `monthly_cents` + tier come from the Stripe list (step 7); if Stripe is unavailable, fall back to their `wix_amount_cents`/`wix_tier` if any, else amount 0 / tier 'member'.
     - `total_supporters` email union (single grouped query, distinct lower-email done in JS to keep it one pass):
       - roster emails (paying branches only: `has_stripe OR has_wix`, excluding staff/legacy) — from the roster rows above.
       - `SELECT DISTINCT lower(email) AS email FROM donor_gift WHERE refunded_at IS NULL AND occurred_at >= ?1 AND occurred_at < ?2` bind `b.startUtc, b.endUtc`.
     - Foundation aggregates (month + YTD), Academy aggregates, PPGF — grouped by classification `entity`/`kind`:
       ```sql
       SELECT
         SUM(CASE WHEN kind='one_time' AND entity='foundation' THEN amount_cents ELSE 0 END) AS f_one_time,
         SUM(CASE WHEN kind='recurring' AND entity='foundation' THEN amount_cents ELSE 0 END) AS f_recurring,
         SUM(CASE WHEN ppgf=1 THEN amount_cents ELSE 0 END) AS ppgf,
         SUM(CASE WHEN kind='course' THEN amount_cents ELSE 0 END) AS academy_cents,
         SUM(CASE WHEN kind='course' THEN 1 ELSE 0 END) AS academy_purchases
       FROM donor_gift
       WHERE refunded_at IS NULL AND occurred_at >= ?1 AND occurred_at < ?2
       ```
       (`membership`=STUC, `course`=Academy, else Foundation, per spec.) YTD variants bind the Jan-1-ET-of-month's-year..endUtc window.
     - Wix joins/leaves this month (D1 side): `joined` where `started_at >= ?1 AND started_at < ?2`; `left` where `status IN ('canceled','cancelled','expired') AND updated_at >= ?1 AND updated_at < ?2`.
     - Lapse scan rows (for watchlist): the `donor_gift`-joined query ported from stuc-label-drift.js:
       ```sql
       SELECT u.email AS email, u.created_at AS created_at, MAX(g.occurred_at) AS last_gift_at
       FROM user u
       LEFT JOIN donor_gift g ON g.email = u.email COLLATE NOCASE
         AND g.source='stripe' AND g.kind='membership' AND g.refunded_at IS NULL
       WHERE u.blocked = 0 AND u.stripe_customer_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM user_label ul WHERE ul.user_id = u.id AND ul.label = 'Save the Uterus Club \u{1F3F7}\u{FE0F}')
       GROUP BY u.id, u.email, u.created_at
       ```
     - Trend: 12 monthly buckets, ONE grouped query per stream. Use `strftime('%Y-%m', occurred_at)` (UTC-substr month key — documented ambiguity resolution, see Self-Review) over the trailing 12 ET months:
       ```sql
       SELECT strftime('%Y-%m', occurred_at) AS ym,
         SUM(CASE WHEN kind='membership' THEN amount_cents ELSE 0 END) AS stuc_cents,
         SUM(CASE WHEN kind IN ('one_time','recurring') AND entity='foundation' THEN amount_cents ELSE 0 END) AS foundation_cents,
         SUM(CASE WHEN kind='course' THEN amount_cents ELSE 0 END) AS academy_cents
       FROM donor_gift
       WHERE refunded_at IS NULL AND occurred_at >= ?1
       GROUP BY ym ORDER BY ym
       ```
     - Use `env.DB.batch([...])` for all read statements (batched D1, per CLAUDE.md SQL discipline).
  7. **Stripe** (try/catch; failure sets `stripeUnavailable = true`, never a 500): if `!env.STRIPE_RESTRICTED_KEY`, treat as unavailable. Instantiate `new Stripe(env.STRIPE_RESTRICTED_KEY, { httpClient: Stripe.createFetchHttpClient(), apiVersion: STRIPE_API_VERSION })`. Fetch active/past_due/unpaid/canceled subs with `expand: ['data.customer','data.latest_invoice']`, `limit: 100`, auto-paginated (mirror revenue.js `for await`). Build:
     - `subStartByEmail` Map (lowered customer email -> newest `subStartEpochMs`, voided-invoice subs excluded) — for the lapse grace check.
     - Stripe roster amounts/tiers (via `tierFromPriceOrAmount`) folded into the paying-branch rows.
     - Watchlist candidates: `invoiceDropout` (kind `voided_invoice`, action "Their most recent payment was voided but the subscription is still open. Cancel it in Stripe."), `isDunningDropout` (kind `past_due`, action "Their card is failing. Recover the payment or cancel in Stripe."), joins (`start_date` in month), leaves (`canceled_at` in month).
  8. `const lapseFlagged = computeLapsed({ giftRows: lapseRows, subStartByEmail, nowMs: Date.now() })` -> add each as watchlist kind `lapsed_payment`, action "No membership payment in over 45 days. Confirm in Stripe, then remove them or mark paused." When `stripeUnavailable`, `subStartByEmail` is an empty Map (created_at-grace fallback), and the Stripe-only watchlist kinds (`voided_invoice`, `past_due`) are OMITTED.
  9. `known_paused`: for each `KNOWN_PAUSED` email present in the roster/lapse set, add `{ name, note: 'Paused / comped (Brian approved).' }`; never a dropout.
  10. `actions`: derive from watchlist (one plain-language instruction each, `who` inferred: dropout/lapse -> 'Brian', "reach out" -> 'Naomi'), plus lapsed-recurring foundation donors.
  11. `const report = assembleReport({...})`. Point-in-time sections use `Date.now()` regardless of `month`.
  12. `return json(report, 200, { 'Cache-Control': 'no-store' })`.
  13. On any unexpected throw outside the D1 block: `log(env, null, 'admin', 'membership_report_error', 'error', err.message, 0, 502)` (NO member email/name in the log) and `json({ok:false,error:'Failed to build membership report'},502)`.

- [ ] Run the endpoint test, expect pass. Then run `npm run lint` (eslint functions/) and `npx arise-scan --json --files functions/api/admin/membership-report.js` (the coder agent's gate) — expect 0 findings.

- [ ] Append `tests/unit/membership-report-endpoint.test.mjs` to the `package.json` `"test"` script.

- [ ] Add the endpoint row to the CLAUDE.md API Functions inventory table (admin section): `GET /api/admin/membership-report | admin/membership-report.js | Unified membership/supporter report (admin-or-bearer; no-store)`.

- [ ] Commit:
```
git add functions/api/admin/membership-report.js tests/unit/membership-report-endpoint.test.mjs package.json CLAUDE.md
git commit -m "Add GET /api/admin/membership-report (admin-or-bearer, ?month ET bucketing, Stripe degradation, no-store)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3 — Middleware carve-out + guard:update + invariant tests

**Files**
- Modify `functions/_middleware.js` (isAdminPage block, ~lines 335–360)
- Modify `guard-manifest.json` (regenerated by `npm run guard:update`)
- Create `tests/unit/membership-middleware-invariant.test.mjs`
- Modify `package.json` (append the new test file)

**Steps**

- [ ] Write the failing invariant test `tests/unit/membership-middleware-invariant.test.mjs` (source-assertion style, mirrors `guard.mjs` invariant 2d):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'functions/_middleware.js'), 'utf8');

test('carve-out lowers exactly /admin/membership to admin', () => {
  assert.match(src, /\/admin\/membership/);
  assert.match(src, /roleAtLeast\(\s*session\.role\s*,\s*requiredRole\s*\)/);
  assert.match(src, /isMembershipPage\s*\?\s*'admin'\s*:\s*'superadmin'/);
});

test('every other /admin/* path stays superadmin (default branch intact)', () => {
  // The default of the ternary must be 'superadmin'; there must be no unguarded
  // roleAtLeast(..., 'admin') applied to the whole /admin/* block.
  assert.match(src, /:\s*'superadmin'/);
});

test('account + community gating preserved (do not regress the existing invariant)', () => {
  assert.match(src, /\/account/);
  assert.match(src, /startsWith\('\/community\/'\)/);
  assert.match(src, /isPublicCommunity/);
});
```

- [ ] Run, expect failure: `node --experimental-strip-types --test tests/unit/membership-middleware-invariant.test.mjs`.

- [ ] Edit `functions/_middleware.js` `isAdminPage` block. Replace the fixed superadmin check with a carve-out. After `const isAdminPage = ...;` and inside the block, add before the role check:
```js
    // Carve-out (decided 2026-07-17): /admin/membership is Naomi-facing and gates
    // at admin, NOT superadmin. Every OTHER /admin/* path stays superadmin.
    const isMembershipPage = pathnameLower === '/admin/membership' || pathnameLower.startsWith('/admin/membership/');
    const requiredRole = isMembershipPage ? 'admin' : 'superadmin';
```
and change `if (!roleAtLeast(session.role, 'superadmin'))` to `if (!roleAtLeast(session.role, requiredRole))`.

- [ ] Run the invariant test, expect pass. Also re-run the existing security guard to see it flag the hash change: `npm run guard` (expect FAIL on `_middleware.js` hash + PASS on invariant 2d "gates /account + /community").

- [ ] Regenerate the manifest: `npm run guard:update`. Then `npm run guard` (expect all PASS).

- [ ] Append `tests/unit/membership-middleware-invariant.test.mjs` to the `package.json` `"test"` script and run `npm test` (all green).

- [ ] Add the `/admin/membership` route to the CLAUDE.md Site Map "Admin UI" table: `/admin/membership | src/pages/admin/membership.astro (admin-gated, NOT superadmin)`.

- [ ] Commit:
```
git add functions/_middleware.js guard-manifest.json tests/unit/membership-middleware-invariant.test.mjs package.json CLAUDE.md
git commit -m "Middleware carve-out: /admin/membership gates at admin (not superadmin); guard:update + invariant test

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4 — Naomi account setup + Stripe key binding + G2 verification (manual steps)

No code changes. Spelled-out manual steps; verify each outcome (success = state changed, not exit code).

**Steps**

- [ ] Bind the read-only Stripe restricted key as a NEW Pages secret (never the `sk_live_` checkout key). From the rrm-academy-cf dir:
```
op read 'op://Automation/Stripe Restricted Key - rrm-finance-sync/credential' | \
  CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" npx wrangler pages secret put STRIPE_RESTRICTED_KEY --project-name rrm-academy
```
  Verify it is an `rk_live_` key (read-only), not `sk_live_`. Do NOT touch `STRIPE_SECRET_KEY`.

- [ ] Confirm `ADMIN_API_SECRET` is already bound to the Pages project (it gates the 7 existing admin bearer endpoints):
```
CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" npx wrangler pages secret list --project-name rrm-academy | grep -E 'ADMIN_API_SECRET|STRIPE_RESTRICTED_KEY'
```
  Expected: both present.

- [ ] Find Naomi's user id (her rrmacademy.org account email):
```
CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" npx wrangler d1 execute rrm-auth --remote \
  --command "SELECT id, email, role FROM user WHERE email = 'naomimwhittaker@gmail.com' COLLATE NOCASE"
```
  (Confirm the exact email with Brian if this returns 0 rows — Naomi's login email may differ from her personal Gmail.)

- [ ] Raise her to `admin` (NOT superadmin):
```
CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" npx wrangler d1 execute rrm-auth --remote \
  --command "UPDATE user SET role = 'admin' WHERE email = 'naomimwhittaker@gmail.com' COLLATE NOCASE AND role IN ('member','mod')"
```
  Re-run the SELECT; verify `role = 'admin'`.

- [ ] **G2 verification (manual, after Task 5 deploy):**
  - As Naomi (admin): load `https://rrmacademy.org/admin/membership/` -> 200, dashboard renders.
  - As Naomi (admin): load `https://rrmacademy.org/admin/revenue/` -> **403** (still superadmin-only). Confirm she cannot load ANY other `/admin/*` page.
  - Anonymous: `GET /admin/membership/` -> redirect to `/login`; `GET /api/admin/membership-report` -> **401**.
  - Anonymous with `Authorization: Bearer $ADMIN_API_SECRET` -> **200**, and the response carries `Cache-Control: no-store`:
    ```
    SECRET=$(op read 'op://Automation/<admin-api-secret-item>/credential')
    curl -sS -D - -o /dev/null https://rrmacademy.org/api/admin/membership-report -H "Authorization: Bearer $SECRET" | grep -i cache-control
    ```

- [ ] Record the G2 results (pass/fail per check) in the plan's Self-Review or a handoff note. No commit (config-only).

---

## Task 5 — `/admin/membership/` dashboard page + 393x852 screenshot gate (G3)

**Files**
- Create `src/pages/admin/membership.astro`

**Interfaces (Consumes)**
```
Consumes: GET /api/admin/membership-report (live fetch, credentials: 'include')
```

**Steps**

- [ ] Create `src/pages/admin/membership.astro` copying the sibling admin-page pattern EXACTLY (`src/pages/admin/revenue.astro`): `BaseLayout title=... noindex bodyClass="admin-page"`, the `.admin-bar` chrome (add a `Membership` link marked `--active`; add the same link to the other admin pages' nav bars in a follow-up if desired — not required for this task), an inline `<script is:inline>` that fetches the endpoint and renders. Reuse the admin CSS tokens (`--admin-*`, `--purple-700 #725e7e`) and the `.rv-*` card/table classes. Rendering requirements (plain language for Naomi):
  - **Headline tiles**: "Total supporters", "Recurring monthly" (format `recurring_monthly_cents/100` as `$`), and a change line ("Up $X since last month" / "Down $X" / when `delta` is `null`: "Change unavailable this refresh"). When `headline.degraded`, show a banner: "Some numbers are partial. Stripe data was unavailable this refresh."
  - **Three stream sections**: STUC (active_by_tier as "Members / Heroes / Superheroes", the four annotated count lines "X paying through Wix", "X paying through Stripe", "X complimentary (legacy)", "X staff (complimentary)"), Foundation (this-month one-time + recurring + YTD + PPGF), Academy (course purchases + revenue this month + YTD).
  - **What needs a person** (`actions`): one instruction each, with who ("Brian" / "Naomi").
  - **Joined / Left this month**: two simple lists (name + tier / name + reason).
  - **Watchlist**: reason spelled out in a full sentence per row (the `action` string from the endpoint), e.g. "Their July payment was voided but the subscription is still open. Cancel it in Stripe."
  - **Known paused**: annotated, never shown as a dropout.
  - **12-month trend**: inline SVG bars (no chart library) — one stacked/grouped bar per month from `trend`, using purple/neutral fills; label axis with month + total. Build the SVG in JS from the JSON.
  - **Register**: no SQL/infra words; statuses as sentences; NO em dashes anywhere in rendered copy; no serif fonts (inherit site sans). Responsive-by-construction: `<meta viewport>` is from BaseLayout; use fluid grid (`.rv-metrics` pattern) and wrap the trend/tables in `overflow-x:auto`.
  - **Empty/degraded**: honest text ("Stripe data unavailable this refresh", "No one joined this month.").
  - On `401/403`: `window.location.href = '/login/?redirect=/admin/membership/'` (mirror revenue.astro).

- [ ] Local build + preview to render the page against the live endpoint (staging = localhost, not a deploy):
```
npm run build:astro && npx wrangler pages dev dist --port 8788
```
  (Note: `astro preview` does not faithfully serve admin/404 routes — use `wrangler pages dev`.)

- [ ] **G3 screenshot gate**: load `http://localhost:8788/admin/membership/` (authenticated session or a fixture) in claude-in-chrome; screenshot at **393x852** (mobile) AND desktop. Visually confirm: headline tiles legible, three sections readable, watchlist sentences wrap, trend bars render, no horizontal body scroll at 393px, no serif, no em dashes. Show both screenshots in Comet (per `feedback-show-in-comet-not-playwright`) and get sign-off before "done".

- [ ] Add the page to the CLAUDE.md Site Map count if not already done in Task 3.

- [ ] Commit (deploy choreography — see below):
```
git add src/pages/admin/membership.astro
git commit -m "Add /admin/membership dashboard page (plain-language, inline SVG trend, responsive, degraded states)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Deploy choreography (rrm-academy-cf), applies to Tasks 1-3+5 ship:**
- Work from a worktree off `origin/main` (the local clone may be stale): `git worktree add ../rrm-academy-cf-membership origin/main -b claude/membership-report` then cherry-pick / re-apply commits there (per `ship-from-dirty-clone-via-worktree`).
- One branch, one push: `git push origin claude/membership-report`. `claude/*` auto-merges + deploys via GitHub Actions (no local CF creds needed).
- The deploy pipeline runs `css-audit --gate`, the security guard, the payment/analytics/courses/fact gates, and the record-count floors — a new page + new endpoint + guarded-file edit must keep all green (guard was updated in Task 3; run `npm run guard` + `npm test` locally before pushing).
- Verify the deploy CONCLUSION (merge != deployed) and that `/admin/membership/` serves 200 before marking shipped.

---

## Task 6 — observatory `notify.js` `{to, cc}` options change

**Files**
- Modify `/Users/brian/iCode/projects/rrm-observatory/src/notify.js` (`sendNotification`)
- Create `/Users/brian/iCode/projects/rrm-observatory/tests/notify.test.mjs` (new — repo has no unit tests today; add a minimal `node --test` file)

**Interfaces (Produces)**
```
sendNotification(env, subject, html, opts = {}) -> { sent }
  opts.to?: string[]  (default [NOTIFY_TO])
  opts.cc?: string[]  (default NOTIFY_CC)
```

**Steps**

- [ ] Write the failing test `tests/notify.test.mjs`. Since `sendNotification` sends via `aws.fetch`, assert the Destination it builds by intercepting `globalThis.fetch` (aws4fetch calls the global `fetch`). Provide a fake env with AWS creds so it reaches the fetch; capture the JSON body.
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendNotification } from '../src/notify.js';

const env = { AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's', AWS_SES_REGION: 'us-east-1' };

async function capture(opts) {
  let body;
  globalThis.fetch = async (_url, init) => { body = JSON.parse(init.body); return new Response('{}', { status: 200 }); };
  await sendNotification(env, 'Subj', '<p>hi</p>', opts);
  return body.Destination;
}

test('default recipients unchanged (To admin@, Cc agent@)', async () => {
  const dest = await capture(undefined);
  assert.deepEqual(dest.ToAddresses, ['administrator@rrmacademy.org']);
  assert.deepEqual(dest.CcAddresses, ['agent@whittaker.ai']);
});

test('opts.to overrides To; opts.cc:[] drops the agent Cc', async () => {
  const dest = await capture({ to: ['administrator@rrmacademy.org', 'naomi@example.org'], cc: [] });
  assert.deepEqual(dest.ToAddresses, ['administrator@rrmacademy.org', 'naomi@example.org']);
  assert.deepEqual(dest.CcAddresses, []);
});
```

- [ ] Run, expect failure (current signature ignores opts; default test passes but the override test fails because Cc stays `['agent@whittaker.ai']`): `node --test tests/notify.test.mjs`.

- [ ] Replace the whole `sendNotification` function in `src/notify.js` with this complete body (only the signature + the two derived `to`/`cc` locals + the `Destination` line change; everything else is byte-identical to the current function):
```js
export async function sendNotification(env, subject, html, opts = {}) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    return { sent: false, reason: 'SES not configured' };
  }

  const to = Array.isArray(opts.to) && opts.to.length ? opts.to : [NOTIFY_TO];
  const cc = Array.isArray(opts.cc) ? opts.cc : NOTIFY_CC;

  const region = env.AWS_SES_REGION || 'us-east-1';
  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region,
    service: 'ses',
  });

  try {
    const res = await aws.fetch(
      `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          FromEmailAddress: NOTIFY_FROM,
          Destination: { ToAddresses: to, CcAddresses: cc },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Html: { Data: html, Charset: 'UTF-8' } },
            },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return { sent: false, reason: `SES ${res.status}: ${err}` };
    }

    return { sent: true };
  } catch (err) {
    const isAbort = err?.name === 'AbortError' || err?.name === 'TimeoutError';
    return { sent: false, reason: isAbort ? 'SES timeout' : err.message };
  }
}
```
  (Default preserves current To=[NOTIFY_TO], Cc=NOTIFY_CC so all existing callers — morning digest, weekly, cron-error paths — are byte-identical. `cc: []` explicitly drops the agent inbox.)

- [ ] Run the test, expect pass. Then run the observatory deploy gates locally to confirm no regression (they do not test notify.js but must stay green): `node scripts/wave2-scaffold-checks.mjs && node tools/check-manifest-validates.mjs && node tools/check-spec-manifest-parity.mjs` (all exit 0).

- [ ] Commit (in the rrm-observatory repo):
```
git add src/notify.js tests/notify.test.mjs
git commit -m "notify.js: add {to,cc} options (default unchanged); lets a report drop the agent@ Cc

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7 — observatory monthly membership branch: cron + `isMonthlyMembership` + email renderer + canary route + failure notice

**Files**
- Modify `/Users/brian/iCode/projects/rrm-observatory/wrangler.toml` (add cron `30 12 1 * *` with comment)
- Modify `/Users/brian/iCode/projects/rrm-observatory/src/index.js` (`scheduled()` handled-set + `isMonthlyMembership` branch; `fetch()` on-demand canary route)
- Create `/Users/brian/iCode/projects/rrm-observatory/src/membership-report.js` (fetch endpoint + render inline-styled email + prior-month helper)

**Interfaces (Produces)**
```
runMonthlyMembershipReport(env) -> { sent, month, degraded }        // fetch endpoint + send email
renderMembershipEmail(report) -> htmlString                          // inline-styled table HTML
priorMonthET(nowMs) -> 'YYYY-MM'                                      // Aug 1 send -> '2026-07'
```

**Steps**

- [ ] Add the cron to `wrangler.toml`. In the `# Crons:` comment block, add a line, and add `"30 12 1 * *"` to the `crons = [...]` array with an inline note:
```
#   30 12 1 * *    -- monthly membership report (12:30 UTC on the 1st = 8:30 AM EDT / 7:30 AM EST;
#                     fixed-UTC does not shift with DST; deliberately AFTER the 12:00 daily
#                     donor-gift-feed sweep so month-end gifts have landed).
```
```
crons = [
  "0 12 * * *",
  ...
  "30 12 1 * *",   # monthly membership report — named branch isMonthlyMembership in scheduled()
]
```

- [ ] Create `src/membership-report.js`:
```js
import { sendNotification } from './notify.js';

const ENDPOINT = 'https://rrmacademy.org/api/admin/membership-report';
// Naomi is added ONLY after G5 hand-check (rollout gate). Until then this stays
// [] and the report goes To administrator@ only (canary posture).
const REPORT_TO = ['administrator@rrmacademy.org'];
const DASHBOARD_URL = 'https://rrmacademy.org/admin/membership/';

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(cents) {
  const v = (Number(cents) || 0) / 100;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function monthLabel(month) {
  const [y, m] = String(month).split('-').map(Number);
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${names[(m || 1) - 1]} ${y}`;
}

// Aug 1 send reports July: the just-completed ET month.
export function priorMonthET(nowMs = Date.now()) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' });
  const p = {};
  for (const part of dtf.formatToParts(new Date(nowMs))) p[part.type] = part.value;
  let y = +p.year, m = +p.month - 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function renderMembershipEmail(r) {
  const h = r.headline;
  const partial = h.degraded
    ? '<p style="margin:0 0 12px;padding:8px 12px;background:#fef3c7;border-radius:4px;font-size:13px;color:#92400e;">Some numbers are partial. Stripe data was unavailable when this report ran.</p>'
    : '';
  const delta = h.degraded || h.delta_vs_prior_month_cents == null
    ? 'Change unavailable this month'
    : (h.delta_vs_prior_month_cents >= 0
        ? `Up ${money(h.delta_vs_prior_month_cents)} since last month`
        : `Down ${money(-h.delta_vs_prior_month_cents)} since last month`);

  const s = r.stuc;
  const parts = [];
  parts.push(`<h2 style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;">Membership report</h2>`);
  parts.push(`<p style="margin:0 0 16px;color:#555;font-family:Arial,Helvetica,sans-serif;">${esc(monthLabel(r.month))}</p>`);
  parts.push(partial);

  // Headline tiles (table, inline styles)
  parts.push('<table role="presentation" style="border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif;"><tr>');
  parts.push(`<td style="padding:12px;border:1px solid #e5e5e5;border-radius:6px;"><div style="font-size:12px;color:#777;text-transform:uppercase;">Total supporters</div><div style="font-size:24px;font-weight:bold;color:#313131;">${esc(String(h.total_supporters))}</div></td>`);
  parts.push(`<td style="width:12px;"></td>`);
  parts.push(`<td style="padding:12px;border:1px solid #e5e5e5;border-radius:6px;"><div style="font-size:12px;color:#777;text-transform:uppercase;">Recurring monthly</div><div style="font-size:24px;font-weight:bold;color:#313131;">${esc(money(h.recurring_monthly_cents))}</div><div style="font-size:12px;color:#777;">${esc(delta)}</div></td>`);
  parts.push('</tr></table>');

  // STUC section
  parts.push('<h3 style="margin:20px 0 6px;font-family:Arial,Helvetica,sans-serif;">Save the Uterus Club</h3>');
  parts.push(`<p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;">Members ${esc(String(s.active_by_tier.member))} &nbsp; Heroes ${esc(String(s.active_by_tier.hero))} &nbsp; Superheroes ${esc(String(s.active_by_tier.superhero))}</p>`);
  parts.push(`<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#555;">${esc(String(s.wix_count))} paying through Wix, ${esc(String(s.stripe_count))} paying through Stripe, ${esc(String(s.legacy_count))} complimentary (legacy), ${esc(String(s.staff_count))} staff.</p>`);

  // helper: labeled list section
  const listSection = (title, rows, fmt) => {
    if (!rows || !rows.length) return `<p style="margin:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#777;">${esc(title)}: none.</p>`;
    const items = rows.map(x => `<li style="margin:2px 0;">${fmt(x)}</li>`).join('');
    return `<p style="margin:10px 0 2px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;">${esc(title)}</p><ul style="margin:0 0 8px;padding-left:20px;font-family:Arial,Helvetica,sans-serif;font-size:13px;">${items}</ul>`;
  };
  parts.push(listSection('Joined this month', s.joined_this_month, x => `${esc(x.name || x.email)} (${esc(x.tier || 'member')})`));
  parts.push(listSection('Left this month', s.left_this_month, x => `${esc(x.name || x.email)} — ${esc(x.reason || '')}`));
  parts.push(listSection('Needs a look', s.watchlist, x => `${esc(x.name || x.email)}: ${esc(x.action || x.kind)}`));
  parts.push(listSection('Paused (do not chase)', s.known_paused, x => `${esc(x.name)} — ${esc(x.note || '')}`));

  // Foundation + Academy
  const f = r.foundation, a = r.academy;
  parts.push('<h3 style="margin:20px 0 6px;font-family:Arial,Helvetica,sans-serif;">Foundation</h3>');
  parts.push(`<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;">One-time ${esc(money(f.one_time_this_month_cents))}, recurring ${esc(money(f.recurring_this_month_cents))} this month. Year to date ${esc(money(f.ytd_cents))}. PPGF ${esc(money(f.ppgf_this_month_cents))}.</p>`);
  parts.push('<h3 style="margin:20px 0 6px;font-family:Arial,Helvetica,sans-serif;">Academy courses</h3>');
  parts.push(`<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;">${esc(String(a.course_purchases_this_month))} purchases (${esc(money(a.course_revenue_this_month_cents))}) this month. Year to date ${esc(String(a.ytd_purchases))} (${esc(money(a.ytd_cents))}).</p>`);

  // Actions
  parts.push(listSection('What needs a person', r.actions, x => `${esc(x.who || '')}: ${esc(x.text || '')}`));

  parts.push(`<p style="margin:20px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;"><a href="${esc(DASHBOARD_URL)}" style="color:#725e7e;">Open the live dashboard</a></p>`);
  return parts.join('\n');
}

export async function runMonthlyMembershipReport(env, opts = {}) {
  const month = opts.month || priorMonthET();
  const to = opts.to || REPORT_TO;   // canary posture until Naomi added post-G5
  let report;
  try {
    const res = await fetch(`${ENDPOINT}?month=${encodeURIComponent(month)}`, {
      headers: { 'Authorization': `Bearer ${env.ADMIN_API_SECRET}`, 'User-Agent': 'rrm-observatory/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`membership-report HTTP ${res.status}`);
    report = await res.json();
  } catch (err) {
    // Never silent: send a one-line failure notice instead of skipping (observatory convention).
    await sendNotification(env, `Membership report FAILED -- ${month}`,
      `<p style="font-family:Arial,Helvetica,sans-serif;">Could not build the ${esc(month)} membership report: ${esc(String(err && err.message || err))}</p>`,
      { to, cc: [] });
    return { sent: false, month, degraded: null, error: String(err && err.message || err) };
  }
  const html = renderMembershipEmail(report);
  const subject = `Membership report -- ${monthLabel(month)}`;
  const result = await sendNotification(env, subject, html, { to, cc: [] }); // agent@ Cc DROPPED
  return { sent: result.sent, month, degraded: !!(report.headline && report.headline.degraded) };
}
```

- [ ] Wire the scheduler in `src/index.js`. Import at top: `import { runMonthlyMembershipReport } from './membership-report.js';`. In `scheduled()`:
  - Add `const isMonthlyMembership = event.cron === '30 12 1 * *';` next to the other cron booleans.
  - Add it to the handled set: `const handled = isWeekly || isCleanup || isDaemonTick || isMorning || isMonthlyMembership;`
  - Add a branch (mirroring `isCleanup`'s structure, BEFORE the `if (!handled)` catch-all):
```js
    if (isMonthlyMembership) {
      try {
        const r = await runMonthlyMembershipReport(env);
        const duration = Date.now() - start;
        log(env, ctx, 'cron', 'membership_report',
          r.sent ? 'ok' : 'error',
          `month=${r.month} sent=${r.sent} degraded=${r.degraded}`, duration);
      } catch (err) {
        const duration = Date.now() - start;
        log(env, ctx, 'cron', 'membership_report', 'error', err.message, duration);
        let sesOk = false;
        try {
          const sesResult = await sendNotification(env, 'Observatory CRON ERROR -- membership_report', '<p>' + esc(err.message) + '</p>');
          sesOk = sesResult?.sent === true;
        } catch (e2) { console.error('observatory: SES sendNotification threw:', e2); sesOk = false; }
        if (!sesOk && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
          try {
            const { sendTelegram } = await import('./telegram.js');
            await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID,
              `✗ observatory.cron = FAIL\nkind: membership_report\nreason: ${String(err.message || err).slice(0, 200)}\nSES email send also failed; falling back to Telegram.`);
          } catch (e3) { console.error('observatory: telegram fallback failed:', e3); }
        }
      }
      return;
    }
```
  (PII note: the `log()` detail carries only `month`/`sent`/`degraded` — never member data.)

- [ ] Add the on-demand canary route in `fetch()` (next to `/api/digest` GET, same auth as the other `/api/*` routes). This is how G4 sends a canary and how you re-run on demand:
```js
      if (url.pathname === '/api/membership-report' && request.method === 'POST') {
        const month = url.searchParams.get('month') || undefined; // omit -> prior ET month
        const r = await runMonthlyMembershipReport(env, { month }); // To administrator@ only (canary posture)
        log(env, ctx, 'api', 'membership_report', r.sent ? 'ok' : 'error', `month=${r.month} sent=${r.sent}`);
        return json(r);
      }
```
  (Place it inside the existing auth-gated `/api/*` block so `OBSERVATORY_API_TOKEN` protects it — verify by reading the auth check near line 200 before wiring.)

- [ ] Local sanity: `node -e "import('./src/membership-report.js').then(m => console.log(m.priorMonthET(Date.parse('2026-08-01T13:00:00Z'))))"` -> expect `2026-07`.

- [ ] Run the observatory deploy gate chain (they must exit 0 before deploy; manifest gates are unaffected by a named-branch cron with no daemon entry):
```
node scripts/wave2-scaffold-checks.mjs && node tools/check-manifest-validates.mjs && node tools/check-spec-manifest-parity.mjs
node --test tests/notify.test.mjs
bash scripts/wave1-smoke.sh   # expect 28/0 (needs OBSERVATORY_API_TOKEN)
```

- [ ] Commit (rrm-observatory):
```
git add wrangler.toml src/index.js src/membership-report.js
git commit -m "Monthly membership report: cron 30 12 1 * *, isMonthlyMembership branch, inline-styled email, on-demand canary + failure notice

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Deploy choreography (rrm-observatory), manual — no CI deploy:**
```
node scripts/wave2-scaffold-checks.mjs && node tools/check-manifest-validates.mjs && node tools/check-spec-manifest-parity.mjs && \
  CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - Worker Deploy - account/credential') \
  CLOUDFLARE_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a npx wrangler deploy
```
No new secrets (`ADMIN_API_SECRET` + SES already bound). Verify the cron registered: `npx wrangler deployments list` / CF dashboard Triggers shows `30 12 1 * *`.

---

## Task 8 — Rollout: canary send (G4), hand-check (G5), then add Naomi to recipients

**Files**
- Modify `/Users/brian/iCode/projects/rrm-observatory/src/membership-report.js` (`REPORT_TO` — add Naomi, ONLY after G5)

**Steps**

- [ ] **G6 (fault injection, before canary):** exercise the Stripe-unreachable path end to end. Temporarily point the endpoint's Stripe key at a bad value OR run the endpoint unit test's degraded case (Task 2) against the deployed endpoint by rotating `STRIPE_RESTRICTED_KEY` to an invalid `rk_` and curling with the bearer:
```
curl -sS https://rrmacademy.org/api/admin/membership-report -H "Authorization: Bearer $SECRET" | jq '.headline.degraded, .headline.delta_vs_prior_month_cents, .stuc.stripe_unavailable'
```
  Expect `true, null, true` and HTTP 200. Restore the valid key. Confirm the dashboard shows the partial banner and the email renderer shows "Change unavailable this month".

- [ ] **G4 canary:** trigger a canary send to administrator@ only (Naomi NOT yet in `REPORT_TO`), requesting the just-completed month:
```
OBS=$(op read 'op://Automation/RRM Observatory API Token/credential')
curl -sS -X POST -H "Authorization: Bearer $OBS" \
  "https://rrm-observatory.administrator-cloudflare.workers.dev/api/membership-report?month=2026-07"
```
  Confirm the email arrived at administrator@rrmacademy.org, with NO agent@whittaker.ai Cc, subject `Membership report -- July 2026`. Brian eyeballs it.

- [ ] **G5 hand-check:** cross-check the canary's numbers against the independent hand computation. Baseline (2026-07 audit, confirmed external): **$478/mo** = **Wix $433** (24 x $9 + 1 x $19 + 2 x $99 = 216 + 19 + 198) + **Stripe $45** (5 members x $9). **Clarke Kennedy EXCLUDED** (voided-invoice-on-active dropout — must appear in the watchlist as `voided_invoice`, not in `recurring_monthly_cents`). **Victoria Bergin (vjgbergin@gmail.com) PAUSED/comped** (must appear in `known_paused`, never as a dropout, never in counts). Verify:
  - `headline.recurring_monthly_cents === 47800`.
  - `stuc.wix_count`/`stripe_count` reconcile to the tier math above.
  - Clarke is in `stuc.watchlist` (kind `voided_invoice`) and NOT in the monthly total.
  - Victoria is in `stuc.known_paused`.
  - The refund caveat is understood: `refunded_at` is Stripe-stamped only; a Wix/PayPal manual refund can make a hand check differ (spec, accepted).
  If any number disagrees, STOP and reconcile the endpoint before proceeding — do NOT add Naomi.

- [ ] **Only after G5 passes:** add Naomi to `REPORT_TO` in `src/membership-report.js`:
```js
const REPORT_TO = ['administrator@rrmacademy.org', '<naomi-report-email>'];
```
  (Use Naomi's preferred report email — confirm with Brian; likely her rrmacademy.org or personal Gmail. Cc stays `[]` — agent@ dropped.) Redeploy observatory (manual chain, Task 7). Send one more canary to confirm both recipients receive it and there is still no agent@ Cc.

- [ ] Commit (rrm-observatory):
```
git add src/membership-report.js
git commit -m "Rollout: add Naomi to membership-report recipients after G5 hand-check ($478/mo baseline reconciled)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] Final verification (per `feedback-deliverable-ends-with-location`): state that the dashboard is LIVE at `https://rrmacademy.org/admin/membership/` (admin-gated), the endpoint at `/api/admin/membership-report`, and the monthly email is armed for the 1st at 12:30 UTC with To administrator@ + Naomi, no agent@ Cc.

---

## Self-Review — spec requirement → task mapping

| Spec section / requirement | Task |
|---|---|
| Purpose: one picture, two surfaces, same JSON | 2 (endpoint), 5 (dashboard), 7 (email) |
| Architecture diagram (D1 + Stripe -> endpoint -> page + observatory cron) | 2, 5, 7 |
| Component 1 auth: `roleAtLeast('admin')` OR Bearer ADMIN_API_SECRET | 2 (`requireAdminOrBearer`) |
| Middleware carve-out at `/admin/membership/` = admin; guarded file; guard:update; invariant test (protect /account+/community; other /admin/* superadmin) | 3 |
| Naomi raised to admin only (not superadmin) | 4 |
| `?month=YYYY-MM` validated, max 24 back, default current ET month; point-in-time sections as-of generated_at; ET boundaries (G1 contract) | 1 (`validateMonthParam`,`monthBoundsET`), 2 |
| `Cache-Control: no-store` | 2, G2 in 4 |
| Data sources D1 + Stripe read-only restricted key (new secret, never sk_live) | 4 (bind), 2 (use) |
| Response JSON contract (all keys, cents-integer) | 1 (`assembleReport` + G1 test), 2 |
| Membership defs: paying branches only; staff_count/legacy_count separate; Wix-vs-Stripe=Stripe; partition invariant; tier map | 1 (`partitionRoster`, invariant test), 2 (SQL) |
| `total_supporters` distinct lowercase-email dedup (roster ∪ month donor_gift ∪ course buyers) | 1 (`assembleReport`), 2 (union query) |
| joins/leaves from subscription lifecycle (not donor_gift) | 2 (Wix started_at/status + Stripe start_date/canceled) |
| Watchlist predicates ported (voided_invoice, past_due/unpaid, 45d/14d lapse) with cross-ref comment | 1 (`invoiceDropout`,`isDunningDropout`,`computeLapsed`), 2 |
| `known_paused` allowlist (Victoria) never a dropout | 1 (`KNOWN_PAUSED`), 2 |
| Foundation/Academy/STUC classification from entity+kind, refunded_at IS NULL | 2 (CASE aggregates) |
| Trend: 12 buckets, one grouped query per stream | 2 (single grouped trend query) |
| Degradation: stripe_unavailable + degraded + null delta, still 200; D1 failure = 500 | 1 (`assembleReport` degrade), 2, G6 in 8 |
| Refund caveat (Stripe-only refunded_at) | 8 (G5 note) |
| Performance: one Stripe list/status with expand, batched D1, <5s | 2 |
| Component 2 dashboard: sibling admin-page pattern, plain language, tiles, 3 sections, actions, joined/left, watchlist sentences, inline SVG trend, no em dash, no serif, responsive, degraded states, 393x852 verified | 5 (G3) |
| Component 3 email: cron `30 12 1 * *`, after donor-gift sweep, DST note | 7 |
| Scheduler wiring: `isMonthlyMembership` named branch in handled set (not a silent no-op) + on-demand canary route | 7 |
| Fetch `?month=<prior>` with ADMIN_API_SECRET; inline-styled table HTML; subject `Membership report -- <Month Year>` | 7 |
| Recipients: To admin@ + Naomi, agent@ Cc dropped; Naomi added only after first verified send | 7 (`{to,cc:[]}`), 8 (rollout) |
| notify.js `{to,cc}` options, default unchanged | 6 |
| Failure: one-line failure notice, no Telegram (SES-first) | 7 (`runMonthlyMembershipReport` catch) |
| Setup step 1 (carve-out) | 3 |
| Setup step 2 (Naomi admin + verify) | 4 |
| Setup step 3 (Stripe key bind) | 4 |
| Setup step 4 (observatory notify.js change, no new secrets) | 6 |
| G1 endpoint JSON schema test | 1, 2 |
| G2 auth (endpoint+page, bearer, middleware invariant, no-store) | 3 (invariant), 4 (manual verify) |
| G3 dashboard screenshots 393x852 + desktop | 5 |
| G4 canary to admin@ | 8 |
| G5 hand-check vs $478 baseline before adding Naomi | 8 |
| G6 Stripe-unreachable fault injection | 2 (unit), 8 (live) |
| Rollout gate (canary -> hand-check -> add Naomi) | 8 |
| Out of scope (events, PayPal recurring, member-facing, writes, Wix backfill) | honored — no task adds any |
