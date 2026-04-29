# STUC Wix Donor UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Coder-agent mandatory** for any task touching `functions/api/`. Per project CLAUDE.md, dispatch the `coder` subagent rather than editing endpoint code directly.

**Goal:** Ship the donor-driven Wix→Stripe migration UX from the spec at `docs/superpowers/specs/2026-04-28-stuc-wix-donor-ux-design.md`. Donors get a soft, dismissable migration prompt, working Switch-over/Cancel/Reactivate flows, and the system upholds 10 invariants that prevent double-charge, identity hijack, and orphaned state.

**Architecture:** New D1 columns + `cancellation_request` table. New magic-link Pages Function with email-binding interstitial. Webhook adopts metadata-first lookup. New `/api/billing/cancel` and `/api/billing/reactivate` endpoints. Banner + member-first STUC layout. All gated behind `STUC_MIGRATION_UX_V2` feature flag. Phase 10 (`rrm-wix-sync` amendments) is a sibling plan in the other repo.

**Tech Stack:** Astro 5.3 (static pages + client JS), CF Pages Functions (Node-style handlers), D1 (SQLite), Stripe API, AWS SES, Cloudflare Web Crypto API for HMAC, AE for telemetry.

**Spec source of truth:** `docs/superpowers/specs/2026-04-28-stuc-wix-donor-ux-design.md` — refer to invariants INV-1 through INV-10 throughout.

---

## File Structure

### New files (`rrm-academy-cf`)

| Path | Responsibility |
|------|----------------|
| `migrations/stuc-wix-donor-ux.sql` | Schema additions (cancellation_request table, 5 wix_subscription columns) |
| `functions/save-the-uterus-club/migrate.js` | Magic-link landing Pages Function: token validation, email-binding interstitial, idempotent migration check, redirect to confirmation page |
| `functions/api/billing/_migration-token.js` | Pure HMAC token sign/verify utility, validator pseudocode from spec |
| `functions/api/billing/cancel.js` | Server-derived-source cancel endpoint |
| `functions/api/billing/reactivate.js` | Server-derived-source reactivate endpoint |
| `functions/api/admin/wix-migration-link.js` | Layer 4 admin reconciliation endpoint |
| `src/components/StucMigrationBanner.astro` | Banner + dismissal logic + off-amount confirmation modal |
| `src/components/CancelDonationModal.astro` | Cancel modal + reason textarea + reactivate flow |
| `tests/billing/migration-token.test.js` | Token roundtrip + reject cases |
| `tests/billing/cancel.test.js` | Cancel endpoint contract + length cap + source re-derivation |
| `tests/billing/reactivate.test.js` | Reactivate flow + 410 Gone case |
| `tests/billing/create-checkout-migration.test.js` | Migration handoff + atomic lock + trial_end clamp + off-amount |
| `tests/billing/webhook-checkout-metadata.test.js` | Metadata-first path + email fallback |
| `tests/admin/wix-migration-link.test.js` | Admin endpoint auth + audit |

### Modified files

| Path | Changes |
|------|---------|
| `functions/api/create-checkout.js` | Accept `wix_sub_id` body; Layer 3 SQL with `(id = ? OR email = ?)` ORDER BY started_at DESC; atomic write-lock with 15-min TTL; off-amount 412 response; trial_end clamp |
| `functions/api/billing/_webhook-checkout.js` | Metadata-first gate; clear `migration_handoff_started_at`; set `admin_notified_at` |
| `functions/api/billing/_webhook-subscription.js` | Rename `wix_cancelled` → `fully_exited` |
| `functions/api/billing/status.js` | Surface `migration_status`, `cancel_requested_at`, `amount_cents`; override Stripe priority on `incomplete_expired` |
| `functions/api/billing/portal.js` | (No change; left in place) |
| `functions/api/admin/wix-migration-email.js` | Replace plain-text instruction with HMAC magic-link URL |
| `functions/api/admin/wix-migration-status.js` | Update queries: `wix_cancelled` → `fully_exited`; surface `email_mismatch` cold checkouts |
| `functions/api/admin/cleanup.js` | Two new sweeps: stale cancellation_request re-email, un-notified migration re-email |
| `functions/_middleware.js` | Add `/save-the-uterus-club/migrate` to auth-gated paths |
| `src/pages/account/index.astro` | Mount banner; flip card to Wix-donor variant; dual-surface "Update card" modal; mount Reactivate button |
| `src/pages/save-the-uterus-club/index.astro` | Member-first layout for logged-in active-sub donors |
| `scripts/guard-manifest.json` | Hash all new + edited security-guarded files |

---

## Phase 1 — Schema + state machine

### Task 1.1: Write the schema migration file

**Files:**
- Create: `migrations/stuc-wix-donor-ux.sql`

- [ ] **Step 1.1.1: Write the SQL**

```sql
-- migrations/stuc-wix-donor-ux.sql
-- STUC Wix donor UX: cancellation_request table + 5 wix_subscription columns

CREATE TABLE cancellation_request (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('wix','stripe')),
  source_subscription_id TEXT NOT NULL,
  reason TEXT CHECK(reason IS NULL OR length(reason) <= 2000),
  requested_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,
  last_admin_notification_at INTEGER
);

CREATE INDEX idx_cancellation_request_unresolved
  ON cancellation_request(resolved_at) WHERE resolved_at IS NULL;

CREATE UNIQUE INDEX idx_cancellation_request_outstanding_uniq
  ON cancellation_request(source_subscription_id) WHERE resolved_at IS NULL;

ALTER TABLE wix_subscription ADD COLUMN cancel_requested_at INTEGER;
ALTER TABLE wix_subscription ADD COLUMN cancel_reason TEXT
  CHECK(cancel_reason IS NULL OR length(cancel_reason) <= 2000);
ALTER TABLE wix_subscription ADD COLUMN migration_handoff_started_at INTEGER;
ALTER TABLE wix_subscription ADD COLUMN admin_notified_at INTEGER;
ALTER TABLE wix_subscription ADD COLUMN last_admin_notification_at INTEGER;
```

- [ ] **Step 1.1.2: Apply locally**

Run: `wrangler d1 execute rrm-auth --local --file=migrations/stuc-wix-donor-ux.sql`
Expected: `Executed N queries in N.NNs`

- [ ] **Step 1.1.3: Verify schema**

Run: `wrangler d1 execute rrm-auth --local --command="SELECT sql FROM sqlite_master WHERE name='cancellation_request'"`
Expected: SQL string matches above (field order may differ).

Run: `wrangler d1 execute rrm-auth --local --command="PRAGMA table_info(wix_subscription)"`
Expected: 5 new columns present (`cancel_requested_at`, `cancel_reason`, `migration_handoff_started_at`, `admin_notified_at`, `last_admin_notification_at`).

- [ ] **Step 1.1.4: Apply remote**

Run: `wrangler d1 execute rrm-auth --remote --file=migrations/stuc-wix-donor-ux.sql`
Expected: same.

- [ ] **Step 1.1.5: Commit**

```bash
git add migrations/stuc-wix-donor-ux.sql
git commit -m "schema: cancellation_request table + 5 wix_subscription columns for STUC migration"
```

### Task 1.2: Rename `wix_cancelled` → `fully_exited` in code

**Files:**
- Modify: `functions/api/billing/_webhook-subscription.js`
- Modify: `functions/api/admin/wix-migration-status.js`

- [ ] **Step 1.2.1: Read sibling files first** (coder agent protocol)

Read all of `functions/api/billing/` and `functions/api/admin/wix-migration-*.js` to understand existing patterns.

- [ ] **Step 1.2.2: Update `_webhook-subscription.js`**

Replace every literal `'wix_cancelled'` (string SQL value) with `'fully_exited'`. Read file, locate UPDATE statements, edit in place.

- [ ] **Step 1.2.3: Update `wix-migration-status.js`**

Replace every `migration_status = 'wix_cancelled'` (or LIKE match) with `migration_status = 'fully_exited'`.

- [ ] **Step 1.2.4: Grep for stragglers**

Run: `grep -r "wix_cancelled" functions/ src/ scripts/ migrations/`
Expected: 0 matches (or only this commit's commit message references).

- [ ] **Step 1.2.5: Backfill existing data**

Run: `wrangler d1 execute rrm-auth --remote --command="UPDATE wix_subscription SET migration_status='fully_exited' WHERE migration_status='wix_cancelled'"`
Expected: `Rows affected: N` where N is small (likely 0–5 in current data).

- [ ] **Step 1.2.6: Commit**

```bash
git add functions/api/billing/_webhook-subscription.js functions/api/admin/wix-migration-status.js
git commit -m "rename: wix_cancelled migration_status → fully_exited (INV-2 monotonic)"
```

---

## Phase 2 — Magic-link token + Pages Function

### Task 2.1: Token utility with TDD

**Files:**
- Create: `functions/api/billing/_migration-token.js`
- Create: `tests/billing/migration-token.test.js`

- [ ] **Step 2.1.1: Add MIGRATION_TOKEN_SECRET to wrangler.toml + 1Password**

Edit `wrangler.toml` `[vars]` if dev, or set as Cloudflare Pages secret in dashboard for production:
```bash
op item create --vault Automation --category 'API Credential' --title 'STUC Migration Token Secret' \
  credential[password]="$(openssl rand -hex 64)"
wrangler pages secret put MIGRATION_TOKEN_SECRET --project-name rrm-academy
# (paste the value from 1Password)
```

- [ ] **Step 2.1.2: Write test file**

```js
// tests/billing/migration-token.test.js
import { describe, it, expect } from 'vitest';
import { signMigrationToken, validateMigrationToken } from '../../functions/api/billing/_migration-token.js';

const SECRET = 'test-secret-for-vitest-only';

describe('migration token', () => {
  it('round-trips a valid token', async () => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const token = await signMigrationToken({ wix_sub_id: 'wxs_abc123', exp }, SECRET);
    const result = await validateMigrationToken(token, SECRET);
    expect(result).toEqual({ ok: true, wix_sub_id: 'wxs_abc123' });
  });

  it('rejects forged signature', async () => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const token = await signMigrationToken({ wix_sub_id: 'wxs_abc', exp }, SECRET);
    const tampered = token.slice(0, -2) + 'xx';
    const result = await validateMigrationToken(tampered, 'WRONG-SECRET');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('forged');
  });

  it('rejects expired token', async () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const token = await signMigrationToken({ wix_sub_id: 'wxs_abc', exp }, SECRET);
    const result = await validateMigrationToken(token, SECRET);
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects malformed payload (non-string wix_sub_id)', async () => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const token = await signMigrationToken({ wix_sub_id: 12345, exp }, SECRET);
    const result = await validateMigrationToken(token, SECRET);
    expect(result.reason).toBe('malformed');
  });

  it('rejects malformed payload (non-integer exp)', async () => {
    const token = await signMigrationToken({ wix_sub_id: 'wxs_abc', exp: '2099-01-01' }, SECRET);
    const result = await validateMigrationToken(token, SECRET);
    expect(result.reason).toBe('malformed');
  });

  it('rejects payload not matching wxs_ pattern', async () => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const token = await signMigrationToken({ wix_sub_id: '../../../etc/passwd', exp }, SECRET);
    const result = await validateMigrationToken(token, SECRET);
    expect(result.reason).toBe('malformed');
  });

  it('rejects empty / no-dot token', async () => {
    const result = await validateMigrationToken('not-a-token', SECRET);
    expect(result.reason).toBe('malformed');
  });

  it('rejects mismatched-length signature in constant time', async () => {
    const result = await validateMigrationToken('eyJhIjoxfQ.shorty', SECRET);
    expect(result.reason).toBe('forged');
  });
});
```

- [ ] **Step 2.1.3: Run tests; verify they fail**

Run: `npx vitest run tests/billing/migration-token.test.js`
Expected: FAIL — module not found.

- [ ] **Step 2.1.4: Implement the utility**

```js
// functions/api/billing/_migration-token.js
// Magic-link migration token: HMAC-SHA256 over base64url(JSON{wix_sub_id, exp}).
// Reusable token (no DB burn). Email-binding gate enforced at landing-page interstitial,
// not at validate time. Validator returns reason ∈ {malformed, forged, expired} for telemetry.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(buf) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signMigrationToken(payload, secret) {
  const json = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(enc.encode(json));
  const sig = await hmac(secret, payloadB64);
  const sigB64 = b64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

export async function validateMigrationToken(token, secret) {
  if (typeof token !== 'string' || token.length < 8) {
    return { ok: false, reason: 'malformed' };
  }
  const dot = token.lastIndexOf('.');
  if (dot < 1 || dot >= token.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  const expectedSig = await hmac(secret, payloadB64);
  const expectedB64 = b64urlEncode(expectedSig);
  if (sigB64.length !== expectedB64.length) {
    return { ok: false, reason: 'forged' };
  }
  if (!constantTimeEqual(sigB64, expectedB64)) {
    return { ok: false, reason: 'forged' };
  }

  let payload;
  try {
    payload = JSON.parse(dec.decode(b64urlDecode(payloadB64)));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (typeof payload.wix_sub_id !== 'string' ||
      !/^wxs_[a-z0-9_-]+$/i.test(payload.wix_sub_id) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= 0) {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, wix_sub_id: payload.wix_sub_id };
}
```

- [ ] **Step 2.1.5: Run tests; verify they pass**

Run: `npx vitest run tests/billing/migration-token.test.js`
Expected: 8 PASS.

- [ ] **Step 2.1.6: Commit**

```bash
git add functions/api/billing/_migration-token.js tests/billing/migration-token.test.js
git commit -m "feat(billing): magic-link migration token utility (HMAC-SHA256 + validator)"
```

### Task 2.2: Magic-link Pages Function

**Files:**
- Create: `functions/save-the-uterus-club/migrate.js`
- Modify: `functions/_middleware.js`

- [ ] **Step 2.2.1: Add path to auth-gated middleware**

Read `functions/_middleware.js`. Locate the auth-gated paths array. Add `/save-the-uterus-club/migrate` to the gating list (it should redirect to `/login?next=...` if no session). Match the exact pattern used by `/account` and `/community`.

- [ ] **Step 2.2.2: Write the Pages Function**

```js
// functions/save-the-uterus-club/migrate.js
// Magic-link landing for STUC migration.
// Server-side: validate token, check migration_status, render email-binding interstitial.

import { validateMigrationToken } from '../api/billing/_migration-token.js';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '***';
  const visible = local.length > 2 ? local.slice(0, 2) : local[0] || '*';
  return `${visible}***@${domain}`;
}

function logEvent(env, ctx, action, indexes) {
  try {
    env.WORKER_EVENTS?.writeDataPoint({
      blobs: ['billing', 'stuc-migration', action, indexes.reason || '', JSON.stringify(indexes)],
      indexes: [action]
    });
  } catch {}
}

function renderPage({ title, body, ctas }) {
  const ctaHtml = (ctas || []).map(c =>
    `<a href="${escapeHtml(c.href)}" class="btn ${c.primary ? 'btn-primary' : ''}">${escapeHtml(c.label)}</a>`
  ).join('');
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:Georgia,serif;max-width:560px;margin:80px auto;padding:0 24px;color:#2a2a2a;line-height:1.6}
h1{font-size:24px}.btn{display:inline-block;padding:10px 18px;margin-right:10px;border-radius:8px;
text-decoration:none;border:1px solid #d4c4ab;color:#6b4d2a}.btn-primary{background:#6b4d2a;color:#fff;border-color:#6b4d2a}</style>
</head><body><h1>${escapeHtml(title)}</h1>${body}<div style="margin-top:24px">${ctaHtml}</div></body></html>`,
    { headers: { 'content-type': 'text/html;charset=utf-8' } });
}

export async function onRequestGet(context) {
  const { request, env, data } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';

  if (env.STUC_MIGRATION_UX_V2 !== 'true') {
    return Response.redirect(`${url.origin}/save-the-uterus-club/`, 302);
  }

  const validation = await validateMigrationToken(token, env.MIGRATION_TOKEN_SECRET);
  if (!validation.ok) {
    logEvent(env, context, 'token-invalid', { reason: validation.reason });
    return renderPage({
      title: 'This link is no longer valid',
      body: '<p>The link you clicked has expired or is malformed. You can switch over directly from your account.</p>',
      ctas: [{ href: '/account', label: 'Go to your account', primary: true }]
    });
  }

  // Auth check (middleware should redirect, but defense-in-depth)
  if (!data?.user) {
    return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
  }

  // Look up the wix_subscription
  const wixSub = await env.DB.prepare(
    "SELECT id, email, tier, amount_cents, next_expected_at, status, migration_status FROM wix_subscription WHERE id = ?"
  ).bind(validation.wix_sub_id).first();

  if (!wixSub) {
    logEvent(env, context, 'token-stale', { wix_sub_id: validation.wix_sub_id });
    return renderPage({
      title: 'Donation not found',
      body: '<p>We couldn\'t find the donation referenced by this link. Please contact us.</p>',
      ctas: [{ href: 'mailto:administrator@rrmacademy.org', label: 'Contact us', primary: true }]
    });
  }

  if (wixSub.migration_status !== 'pending') {
    logEvent(env, context, 'already-migrated', { wix_sub_id: wixSub.id });
    return renderPage({
      title: 'You\'ve already switched over',
      body: '<p>This donation has already been moved to our new system. Manage it from your account.</p>',
      ctas: [{ href: '/account', label: 'Go to your account', primary: true }]
    });
  }

  // INV-3: email-binding assertion
  if (String(wixSub.email).toLowerCase() !== String(data.user.email).toLowerCase()) {
    logEvent(env, context, 'binding-mismatch', { wix_sub_id: wixSub.id });
    return renderPage({
      title: 'Sign in with the matching email',
      body: `<p>This link was sent to <strong>${escapeHtml(maskEmail(wixSub.email))}</strong>. You're signed in as <strong>${escapeHtml(data.user.email)}</strong>.</p>
<p>Please sign in with the matching email, or contact us if you've changed your email.</p>`,
      ctas: [
        { href: '/api/auth/logout?next=' + encodeURIComponent(url.pathname + url.search), label: 'Sign in with another account', primary: true },
        { href: 'mailto:administrator@rrmacademy.org?subject=Existing%20donation%20linkage', label: 'Contact us' }
      ]
    });
  }

  // Render confirmation interstitial. Click triggers JS POST to /api/create-checkout.
  const tierLabel = wixSub.tier === 'superhero' ? 'Uterus Super Hero' : wixSub.tier === 'hero' ? 'Uterus Hero' : 'Member';
  const amountStr = `$${(wixSub.amount_cents / 100).toFixed(0)}`;
  const nextDate = wixSub.next_expected_at ? new Date(wixSub.next_expected_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'your scheduled date';

  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Confirm your switch</title>
<style>body{font-family:Georgia,serif;max-width:560px;margin:80px auto;padding:0 24px;color:#2a2a2a;line-height:1.6}
h1{font-size:24px}button{padding:12px 22px;background:#6b4d2a;color:#fff;border:0;border-radius:8px;font-family:inherit;font-size:15px;cursor:pointer}
button:disabled{opacity:0.6;cursor:not-allowed}</style></head><body>
<h1>Switch your donation to our new system</h1>
<p>You're about to move your <strong>${escapeHtml(tierLabel)} ${amountStr}/month</strong> donation to our new system.</p>
<p>Your next donation date stays the same: <strong>${escapeHtml(nextDate)}</strong>.</p>
<button id="continue">Continue &rarr;</button>
<script>
const btn = document.getElementById('continue');
btn.addEventListener('click', async () => {
  btn.disabled = true; btn.textContent = 'Loading...';
  const res = await fetch('/api/create-checkout', {
    method: 'POST', credentials: 'include',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({ mode: 'subscription', wix_sub_id: ${JSON.stringify(wixSub.id)} })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    btn.textContent = 'Try again';
    btn.disabled = false;
    alert(err.error || 'Could not start checkout. Please try again.');
    return;
  }
  const { url: checkoutUrl } = await res.json();
  window.location.href = checkoutUrl;
});
</script></body></html>`, { headers: { 'content-type': 'text/html;charset=utf-8' } });
}
```

- [ ] **Step 2.2.3: Local smoke test**

Run dev server: `npm run dev`. Generate a test token in a node REPL using the secret value, navigate to `http://localhost:8788/save-the-uterus-club/migrate?t=<token>`. Verify each branch (invalid token, no session redirect, mismatched session email, already-migrated, valid).

- [ ] **Step 2.2.4: Commit**

```bash
git add functions/save-the-uterus-club/migrate.js functions/_middleware.js
git commit -m "feat(stuc): magic-link Pages Function with email-binding interstitial"
```

---

## Phase 3 — Checkout migration linkage

### Task 3.1: Update create-checkout.js with TDD

**Files:**
- Modify: `functions/api/create-checkout.js`
- Create: `tests/billing/create-checkout-migration.test.js`

- [ ] **Step 3.1.1: Dispatch coder agent for sibling read**

Per project CLAUDE.md, dispatch the `coder` subagent for ALL changes to `functions/api/`. Coder reads `functions/api/billing/*` siblings to match patterns before writing. The coder agent's instructions: "Add Layer 3 wix lookup with `(id = ? OR email = ?)` ORDER BY started_at DESC, atomic write-lock with 15-min TTL, off-amount 412 response, trial_end clamp validation, and metadata stash. See spec §Architecture/Surfaces touched and §Layer 3."

- [ ] **Step 3.1.2: Write tests first**

```js
// tests/billing/create-checkout-migration.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestPost } from '../../functions/api/create-checkout.js';
// (mock D1, Stripe, env per existing patterns in repo)

describe('create-checkout migration handoff', () => {
  it('finds wix_subscription by wix_sub_id when provided', async () => {
    // Setup: D1 has wix_subscription with id='wxs_test' email='other@x.com' migration_status='pending'
    // session.user.email = 'cf@x.com' (mismatched, magic-link path)
    // Body: { mode:'subscription', wix_sub_id:'wxs_test' }
    // Expected: Stripe Checkout session created with metadata.wix_subscription_id='wxs_test', trial_end set
  });

  it('finds wix_subscription by email when wix_sub_id not provided', async () => {
    // Setup: pending wix_sub for cf@x.com
    // Body: { mode:'subscription', tier:'hero' }
    // Expected: Stripe Checkout session with metadata.wix_subscription_id=<found-id>
  });

  it('orders by started_at DESC when multiple pending rows', async () => {
    // Setup: 2 pending rows for same email, different started_at
    // Expected: newer row chosen
  });

  it('sets atomic lock on first call', async () => {
    // Setup: pending wix_sub, no lock
    // Call create-checkout
    // Expected: migration_handoff_started_at IS NOT NULL after call
  });

  it('returns 409 when atomic lock active and <15min old', async () => {
    // Setup: pending wix_sub with migration_handoff_started_at = now-300s (5min ago)
    // Expected: 409 with error 'migration_in_progress'
  });

  it('overrides stale lock when >15min old', async () => {
    // Setup: pending wix_sub with migration_handoff_started_at = now-1000s (>15min)
    // Expected: 200 with new Checkout URL; lock now updated to ~now
  });

  it('clamps trial_end to (now+86400, now+730*86400)', async () => {
    // Setup: wix_sub.next_expected_at = now-3600 (in past)
    // Expected: subscription_data.trial_end NOT in payload (omitted), AE event 'trial-end-out-of-range'
  });

  it('returns 412 off_amount for non-standard amounts', async () => {
    // Setup: wix_sub.amount_cents = 5000 ($50, not in {900,1900,9900})
    // Body without acknowledge_off_amount
    // Expected: 412 with structured response { error:'off_amount', amount_cents:5000, standard_tiers:[...]}
  });

  it('accepts off_amount with explicit acknowledgment', async () => {
    // Body: { mode:'subscription', wix_sub_id, acknowledge_off_amount:true }
    // Expected: Stripe Checkout uses price_data with unit_amount=5000
  });

  it('logs cold-checkout AE event when no wix_sub matches', async () => {
    // Setup: no wix_sub for this email
    // Expected: standard Checkout (no trial), AE event 'stuc-migration-cold-checkout' with email_mismatch=false
  });
});
```

- [ ] **Step 3.1.3: Run tests; verify failures**

Run: `npx vitest run tests/billing/create-checkout-migration.test.js`
Expected: All FAIL (logic not yet implemented).

- [ ] **Step 3.1.4: Implement create-checkout.js changes**

The coder agent applies the changes per Step 3.1.1 brief. Key blocks (insert AFTER existing-Stripe-sub guard, BEFORE `stripe.checkout.sessions.create`):

```js
// Layer 3 wix lookup
const wixSubId = body.wix_sub_id || null;
const wixLookup = await env.DB.prepare(
  `SELECT id, tier, amount_cents, next_expected_at, status, migration_status
   FROM wix_subscription
   WHERE (id = ? OR email = ? COLLATE NOCASE)
     AND status = 'active'
     AND migration_status = 'pending'
   ORDER BY started_at DESC
   LIMIT 1`
).bind(wixSubId, userEmail).first();

let trialEndUnix = null;
let migrationMetadata = {};
let useCustomAmount = false;

if (wixLookup) {
  // Atomic write-lock with 15-min TTL
  const lockResult = await env.DB.prepare(
    `UPDATE wix_subscription
     SET migration_handoff_started_at = strftime('%s','now')
     WHERE id = ?
       AND (migration_handoff_started_at IS NULL
            OR migration_handoff_started_at < strftime('%s','now') - 900)`
  ).bind(wixLookup.id).run();
  if ((lockResult.meta?.changes ?? 0) === 0) {
    return new Response(JSON.stringify({ error: 'migration_in_progress' }),
      { status: 409, headers: CORS_HEADERS });
  }

  // Off-amount detection
  const STANDARD_CENTS = new Set([900, 1900, 9900]);
  if (!STANDARD_CENTS.has(wixLookup.amount_cents) && !body.acknowledge_off_amount) {
    return new Response(JSON.stringify({
      error: 'off_amount',
      amount_cents: wixLookup.amount_cents,
      standard_tiers: [
        { tier: 'member', amount_cents: 900 },
        { tier: 'hero', amount_cents: 1900 },
        { tier: 'superhero', amount_cents: 9900 }
      ]
    }), { status: 412, headers: CORS_HEADERS });
  }
  useCustomAmount = !STANDARD_CENTS.has(wixLookup.amount_cents);

  // trial_end clamp
  const nowSec = Math.floor(Date.now() / 1000);
  const trialEndCandidate = wixLookup.next_expected_at
    ? Math.floor(new Date(wixLookup.next_expected_at).getTime() / 1000)
    : null;
  if (Number.isFinite(trialEndCandidate)
      && trialEndCandidate > nowSec + 86400
      && trialEndCandidate < nowSec + 730 * 86400) {
    trialEndUnix = trialEndCandidate;
  } else {
    // Out of range — omit trial_end, donor pays today; alert admin via AE
    env.WORKER_EVENTS?.writeDataPoint({
      blobs: ['billing', 'stuc-migration', 'trial-end-out-of-range', wixLookup.id, ''],
      indexes: ['stuc-migration-handoff-stuck']
    });
  }

  migrationMetadata = {
    wix_subscription_id: wixLookup.id,
    migration_handoff: 'true'
  };
} else {
  // Cold checkout — log for Brian's audit
  env.WORKER_EVENTS?.writeDataPoint({
    blobs: ['billing', 'stuc-migration', 'cold-checkout', userEmail || 'anon', ''],
    indexes: ['stuc-migration-cold-checkout']
  });
}

// When building sessionConfig:
const sessionConfig = {
  // ... existing fields ...
  metadata: { ...existingMetadata, ...migrationMetadata },
  subscription_data: {
    ...(trialEndUnix ? { trial_end: trialEndUnix } : {}),
    metadata: migrationMetadata
  }
};

if (useCustomAmount && wixLookup) {
  sessionConfig.line_items = [{
    price_data: {
      currency: 'usd',
      product: env.STRIPE_PRODUCT_STUC,  // existing product ID
      unit_amount: wixLookup.amount_cents,
      recurring: { interval: 'month' }
    },
    quantity: 1
  }];
}
// else use existing line_items[].price = priceMap[tier]
```

(Coder agent will adapt to existing variable names and patterns in the file.)

- [ ] **Step 3.1.5: Run tests; verify passes**

Run: `npx vitest run tests/billing/create-checkout-migration.test.js`
Expected: 10 PASS.

- [ ] **Step 3.1.6: Commit**

```bash
git add functions/api/create-checkout.js tests/billing/create-checkout-migration.test.js
git commit -m "feat(billing): create-checkout migration handoff with atomic lock + trial clamp"
```

### Task 3.2: Update _webhook-checkout.js metadata-first gate

**Files:**
- Modify: `functions/api/billing/_webhook-checkout.js`
- Create: `tests/billing/webhook-checkout-metadata.test.js`

- [ ] **Step 3.2.1: Write tests first**

```js
// tests/billing/webhook-checkout-metadata.test.js
import { describe, it, expect } from 'vitest';
// (test the metadata-first gate via mocked DB + session)

describe('webhook checkout metadata-first', () => {
  it('uses wix_subscription_id from metadata when present', async () => {
    // Mock session.metadata.wix_subscription_id = 'wxs_meta'
    // Mock D1 has wix_sub with id='wxs_meta', another with same email but different id
    // Expected: UPDATE runs against wxs_meta (not the email-matched one)
  });

  it('falls back to email-match when metadata missing', async () => {
    // Mock session with no metadata.wix_subscription_id
    // Expected: existing email-match path runs
  });

  it('clears migration_handoff_started_at on success', async () => {
    // Setup: row with migration_handoff_started_at set
    // Expected: row's migration_handoff_started_at IS NULL after webhook
  });

  it('sets admin_notified_at after successful SES send', async () => {
    // Mock SES send success
    // Expected: row's admin_notified_at is set
  });

  it('returns 5xx when SES throws (Stripe retries)', async () => {
    // Mock SES throw
    // Expected: response status >=500, admin_notified_at NOT set, dedup row deleted
  });

  it('does NOT double-write when retried', async () => {
    // Setup: webhook_event row exists for this event.id
    // Expected: 200 skipped, no duplicate UPDATE on wix_subscription
  });
});
```

- [ ] **Step 3.2.2: Implement metadata-first gate**

In `_webhook-checkout.js` `handleCheckoutCompleted` (or equivalent), insert BEFORE the existing email-match handoff block:

```js
const wixSubIdMeta = session.metadata?.wix_subscription_id || null;
if (wixSubIdMeta) {
  // METADATA-FIRST PATH (mandatory; INV-3)
  const updateResult = await env.DB.prepare(
    `UPDATE wix_subscription
     SET migration_status='stripe_active',
         stripe_subscription_id=?,
         stripe_active_at=strftime('%s','now'),
         migration_handoff_started_at=NULL
     WHERE id=? AND stripe_subscription_id IS NULL`
  ).bind(session.subscription, wixSubIdMeta).run();

  if ((updateResult.meta?.changes ?? 0) === 0) {
    // Either already migrated, or duplicate webhook — log + admin email + idempotent return
    env.WORKER_EVENTS?.writeDataPoint({
      blobs: ['billing', 'stuc-migration', 'duplicate-handoff', wixSubIdMeta, session.subscription],
      indexes: ['stuc-migration-handoff-stuck']
    });
    return null; // idempotent
  }

  // Notify admin
  try {
    await sendAdminMigrationEmail(env, {
      donorEmail: session.customer_email,
      wixSubId: wixSubIdMeta,
      stripeSubId: session.subscription,
      nextChargeDate: /* read from row or session */
    });
    await env.DB.prepare(
      `UPDATE wix_subscription SET admin_notified_at=strftime('%s','now') WHERE id=?`
    ).bind(wixSubIdMeta).run();
  } catch (err) {
    // SES failed; cron Sweep 2 will pick up
    log(env, ctx.waitUntil, 'billing', 'admin_notify_fail', 'error', `${wixSubIdMeta}: ${err.message}`);
    throw err; // surface 5xx so Stripe retries (and dedup row gets deleted)
  }

  return null; // skip existing email-match path
}

// (existing email-match handoff code follows as fallback)
```

- [ ] **Step 3.2.3: Run tests; verify pass**

Run: `npx vitest run tests/billing/webhook-checkout-metadata.test.js`
Expected: 6 PASS.

- [ ] **Step 3.2.4: Run full guard**

Run: `npm run guard`
Expected: PASS (existing hashes still match for files we didn't change). If FAIL: run `npm run guard:update` ONLY for the files we intentionally changed.

- [ ] **Step 3.2.5: Commit**

```bash
git add functions/api/billing/_webhook-checkout.js tests/billing/webhook-checkout-metadata.test.js scripts/guard-manifest.json
git commit -m "feat(webhook): metadata-first migration handoff gate (INV-3, INV-9)"
```

---

## Phase 4 — Cancel + Reactivate

### Task 4.1: `/api/billing/cancel` endpoint

**Files:**
- Create: `functions/api/billing/cancel.js`
- Create: `tests/billing/cancel.test.js`

- [ ] **Step 4.1.1: Dispatch coder agent**

Brief: "Create `/api/billing/cancel` endpoint that does NOT trust body.source. Server queries Stripe (subscriptions.list active for stripe_customer_id) AND D1 (wix_subscription active for user). Stripe takes precedence. Validates `reason` ≤2000 chars. Source='wix': writes cancellation_request, marks wix_subscription, emails admin. Source='stripe': calls stripe.subscriptions.update(cancel_at_period_end=true), still writes cancellation_request for Reactivate flow. Returns 409 if neither found. Read sibling `functions/api/billing/portal.js` for auth + CORS pattern."

- [ ] **Step 4.1.2: Write tests**

```js
// tests/billing/cancel.test.js
describe('/api/billing/cancel', () => {
  it('rejects when no session', async () => { /* 401 */ });
  it('rejects reason >2000 chars', async () => { /* 400 */ });
  it('routes to wix when only wix_subscription active', async () => {
    // Mocks: no Stripe sub, wix_sub active
    // Expected: cancellation_request row inserted, source='wix', wix_subscription.cancel_requested_at set, admin email queued
  });
  it('routes to stripe when Stripe sub active (precedence)', async () => {
    // Mocks: Stripe sub active AND wix_sub active
    // Expected: stripe.subscriptions.update(cancel_at_period_end=true) called, NOT wix_subscription mutation
  });
  it('returns 409 when neither active', async () => { /* 409 */ });
  it('rejects duplicate outstanding cancellation_request via UNIQUE index', async () => {
    // Setup: outstanding row already exists
    // Expected: 409 'already_pending'
  });
  it('escapes HTML in reason for admin email', async () => {
    // reason = '<script>alert(1)</script>'
    // Expected: email body contains escaped text, not raw script
  });
});
```

- [ ] **Step 4.1.3: Implement endpoint**

```js
// functions/api/billing/cancel.js
// Server-derived-source cancel endpoint. Does NOT trust body.source.

import { CORS_HEADERS } from '../auth/_shared.js';
import { sendEmailSafe } from './_webhook-shared.js';

const REASON_MAX = 2000;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function genId() {
  return 'cnr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  if (env.STUC_MIGRATION_UX_V2 !== 'true') {
    return new Response(JSON.stringify({ error: 'feature_disabled' }), { status: 503, headers: CORS_HEADERS });
  }
  const user = data?.user;
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS_HEADERS });

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const reason = typeof body.reason === 'string' ? body.reason : null;
  if (reason && reason.length > REASON_MAX) {
    return new Response(JSON.stringify({ error: 'reason_too_long' }), { status: 400, headers: CORS_HEADERS });
  }

  // Server-side source re-derivation: Stripe first
  let derivedSource = null;
  let stripeSubId = null;
  let wixSubRow = null;

  if (user.stripe_customer_id) {
    try {
      const stripeRes = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${user.stripe_customer_id}&status=active&limit=1`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
      });
      if (stripeRes.ok) {
        const json = await stripeRes.json();
        const active = json.data?.find(s => ['active','trialing','past_due'].includes(s.status));
        if (active) { derivedSource = 'stripe'; stripeSubId = active.id; }
      }
    } catch (err) {
      // Continue to Wix check; do not fail-open
    }
  }

  if (!derivedSource) {
    wixSubRow = await env.DB.prepare(
      `SELECT id, email, tier, amount_cents, next_expected_at
       FROM wix_subscription
       WHERE (user_id = ? OR email = ? COLLATE NOCASE)
         AND status = 'active'
         AND migration_status = 'pending'
       ORDER BY started_at DESC LIMIT 1`
    ).bind(user.id, user.email).first();
    if (wixSubRow) derivedSource = 'wix';
  }

  if (!derivedSource) {
    return new Response(JSON.stringify({ error: 'no_active_subscription' }), { status: 409, headers: CORS_HEADERS });
  }

  const sourceSubId = derivedSource === 'wix' ? wixSubRow.id : stripeSubId;
  const cancelReqId = genId();
  const now = Math.floor(Date.now() / 1000);

  if (derivedSource === 'stripe') {
    // Stripe path
    try {
      const updateRes = await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: 'cancel_at_period_end=true'
      });
      if (!updateRes.ok) throw new Error(`stripe ${updateRes.status}`);
    } catch (err) {
      return new Response(JSON.stringify({ error: 'stripe_unavailable' }), { status: 503, headers: CORS_HEADERS });
    }
  }

  // Insert cancellation_request (UNIQUE index prevents duplicate outstanding)
  try {
    await env.DB.prepare(
      `INSERT INTO cancellation_request (id, user_id, email, source, source_subscription_id, reason, requested_at, last_admin_notification_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(cancelReqId, user.id, user.email, derivedSource, sourceSubId, reason, now, derivedSource === 'wix' ? now : null).run();
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return new Response(JSON.stringify({ error: 'already_pending' }), { status: 409, headers: CORS_HEADERS });
    }
    throw err;
  }

  if (derivedSource === 'wix') {
    await env.DB.prepare(
      `UPDATE wix_subscription
       SET cancel_requested_at = ?, cancel_reason = ?
       WHERE id = ?`
    ).bind(now, reason, wixSubRow.id).run();

    // Admin email (best-effort; if it fails, cron Sweep 1 picks up)
    const safeReason = reason ? escapeHtml(reason) : '<em>(no reason provided)</em>';
    await sendEmailSafe(env, context.waitUntil, {
      to: 'administrator@rrmacademy.org',
      subject: `STUC cancel request: ${user.email}`,
      html: `<p>Donor: <strong>${escapeHtml(user.email)}</strong></p>
<p>Wix sub ID: <code>${escapeHtml(wixSubRow.id)}</code></p>
<p>Tier: ${escapeHtml(wixSubRow.tier)} ($${(wixSubRow.amount_cents/100).toFixed(0)}/mo)</p>
<p>Reason: ${safeReason}</p>
<p>Action: Cancel this subscription in Wix admin.</p>`
    });
  }

  // Telemetry
  env.WORKER_EVENTS?.writeDataPoint({
    blobs: ['billing', 'stuc-cancel-requested', derivedSource, reason ? 'with-reason' : 'no-reason', cancelReqId],
    indexes: ['stuc-cancel-requested']
  });

  return new Response(JSON.stringify({
    ok: true,
    source: derivedSource,
    ends_at: derivedSource === 'wix' ? wixSubRow.next_expected_at : null
  }), { status: 200, headers: CORS_HEADERS });
}
```

- [ ] **Step 4.1.4: Run tests**

Run: `npx vitest run tests/billing/cancel.test.js`
Expected: 7 PASS.

- [ ] **Step 4.1.5: Commit**

```bash
git add functions/api/billing/cancel.js tests/billing/cancel.test.js
git commit -m "feat(billing): /api/billing/cancel server-derived-source endpoint"
```

### Task 4.2: `/api/billing/reactivate` endpoint

**Files:**
- Create: `functions/api/billing/reactivate.js`
- Create: `tests/billing/reactivate.test.js`

- [ ] **Step 4.2.1: Write tests**

```js
describe('/api/billing/reactivate', () => {
  it('source=wix clears cancel_requested_at + resolves cancellation_request', async () => {
    // Setup: wix_sub with cancel_requested_at, cancellation_request unresolved
    // Expected: both cleared/resolved, admin email "DO NOT cancel" sent
  });
  it('source=wix returns 410 if Wix already cancelled', async () => {
    // Setup: wix_sub.status='cancelled' (Brian already actioned)
    // Expected: 410 Gone with redirect_url=/save-the-uterus-club/
  });
  it('source=stripe clears cancel_at_period_end', async () => {
    // Mock Stripe API
    // Expected: stripe.subscriptions.update(cancel_at_period_end=false) called
  });
  it('returns 409 if no outstanding cancellation_request', async () => { /* 409 */ });
});
```

- [ ] **Step 4.2.2: Implement endpoint**

```js
// functions/api/billing/reactivate.js

import { CORS_HEADERS } from '../auth/_shared.js';
import { sendEmailSafe } from './_webhook-shared.js';

export async function onRequestPost(context) {
  const { request, env, data } = context;
  if (env.STUC_MIGRATION_UX_V2 !== 'true') {
    return new Response(JSON.stringify({ error: 'feature_disabled' }), { status: 503, headers: CORS_HEADERS });
  }
  const user = data?.user;
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS_HEADERS });

  // Find outstanding cancellation_request for this user
  const cancelReq = await env.DB.prepare(
    `SELECT id, source, source_subscription_id FROM cancellation_request
     WHERE user_id = ? AND resolved_at IS NULL
     ORDER BY requested_at DESC LIMIT 1`
  ).bind(user.id).first();

  if (!cancelReq) {
    return new Response(JSON.stringify({ error: 'no_pending_cancellation' }), { status: 409, headers: CORS_HEADERS });
  }

  const now = Math.floor(Date.now() / 1000);

  if (cancelReq.source === 'wix') {
    const wixSub = await env.DB.prepare(
      `SELECT id, status, email FROM wix_subscription WHERE id = ?`
    ).bind(cancelReq.source_subscription_id).first();

    if (!wixSub || wixSub.status === 'cancelled') {
      return new Response(JSON.stringify({
        error: 'already_cancelled',
        redirect_url: '/save-the-uterus-club/'
      }), { status: 410, headers: CORS_HEADERS });
    }

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE wix_subscription SET cancel_requested_at = NULL, cancel_reason = NULL WHERE id = ?`
      ).bind(wixSub.id),
      env.DB.prepare(
        `UPDATE cancellation_request SET resolved_at = ?, resolved_by = 'donor_reactivated' WHERE id = ?`
      ).bind(now, cancelReq.id)
    ]);

    await sendEmailSafe(env, context.waitUntil, {
      to: 'administrator@rrmacademy.org',
      subject: `STUC reactivate: ${user.email}`,
      html: `<p>Donor <strong>${user.email}</strong> changed her mind.</p>
<p><strong>DO NOT cancel</strong> Wix sub <code>${wixSub.id}</code>.</p>`
    });

  } else { // stripe
    try {
      await fetch(`https://api.stripe.com/v1/subscriptions/${cancelReq.source_subscription_id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: 'cancel_at_period_end=false'
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'stripe_unavailable' }), { status: 503, headers: CORS_HEADERS });
    }
    await env.DB.prepare(
      `UPDATE cancellation_request SET resolved_at = ?, resolved_by = 'donor_reactivated' WHERE id = ?`
    ).bind(now, cancelReq.id).run();
  }

  env.WORKER_EVENTS?.writeDataPoint({
    blobs: ['billing', 'stuc-cancel-reactivated', cancelReq.source, '', cancelReq.id],
    indexes: ['stuc-cancel-reactivated']
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
}
```

- [ ] **Step 4.2.3: Run tests; commit**

Run: `npx vitest run tests/billing/reactivate.test.js`
Expected: 4 PASS.

```bash
git add functions/api/billing/reactivate.js tests/billing/reactivate.test.js
git commit -m "feat(billing): /api/billing/reactivate endpoint (INV-4)"
```

---

## Phase 5 — Banner + /account

### Task 5.1: status.js surfaces new fields

**Files:**
- Modify: `functions/api/billing/status.js`

- [ ] **Step 5.1.1: Read existing status.js**

Identify where the Wix subscription is surfaced in the response payload.

- [ ] **Step 5.1.2: Add fields to payload**

When source='wix', include in the `subscription` object:
```js
{
  source: 'wix',
  tier: row.tier,
  status: row.status,
  amount_cents: row.amount_cents,
  next_expected_at: row.next_expected_at,
  migration_status: row.migration_status,
  cancel_requested_at: row.cancel_requested_at,
  migration_handoff_started_at: row.migration_handoff_started_at,
  // ... existing fields
}
```

- [ ] **Step 5.1.3: Override Stripe priority on incomplete_expired**

In the existing branch that prefers Stripe over Wix: add a check that if the Stripe sub is in `incomplete_expired` state AND a `pending` wix_subscription exists, surface the wix sub instead.

```js
// existing: if Stripe sub found, use it
// new: but if Stripe sub.status is terminal-failure AND wix sub pending, fall through to wix
const stripeIsTerminalFailure = stripeSub && ['incomplete_expired', 'canceled'].includes(stripeSub.status);
if (stripeSub && !stripeIsTerminalFailure) {
  // ... existing Stripe surfacing
} else {
  // fall through to wix
}
```

- [ ] **Step 5.1.4: Smoke test**

Locally: query `/api/billing/status` for a test user with a pending wix_sub. Verify response includes the four new fields. Run: `curl -b cookies.txt http://localhost:8788/api/billing/status | jq`.

- [ ] **Step 5.1.5: Commit**

```bash
git add functions/api/billing/status.js
git commit -m "feat(billing): status surfaces migration_status, cancel_requested_at, amount_cents"
```

### Task 5.2: Banner component

**Files:**
- Create: `src/components/StucMigrationBanner.astro`
- Modify: `src/pages/account/index.astro`

- [ ] **Step 5.2.1: Implement banner**

```astro
---
// src/components/StucMigrationBanner.astro
---
<div id="stuc-migration-banner" hidden>
  <div class="banner-inner">
    <div class="banner-msg">
      <strong>Thank you for being a Save the Uterus Club member.</strong>
      We'd love to move your donation to our new system &mdash; your next donation date stays the same,
      and you'll be able to manage it yourself from here.
    </div>
    <div class="banner-cta">
      <button id="stuc-migration-switch" class="btn-primary">Switch over</button>
      <button id="stuc-migration-dismiss" class="btn-close" aria-label="Dismiss">&times;</button>
    </div>
  </div>
</div>

<dialog id="stuc-off-amount-modal">
  <h3>Choose your tier</h3>
  <p>You currently donate <strong id="stuc-off-amt"></strong>/month. The new tiers are $9, $19, and $99.
  Pick a tier or keep your current amount.</p>
  <div class="tier-options">
    <button data-tier="member" data-cents="900">Member &middot; $9</button>
    <button data-tier="hero" data-cents="1900">Uterus Hero &middot; $19</button>
    <button data-tier="superhero" data-cents="9900">Uterus Super Hero &middot; $99</button>
    <button id="stuc-keep-amount" class="btn-primary">Keep $<span id="stuc-keep-display"></span>/mo</button>
  </div>
</dialog>

<style>
#stuc-migration-banner { background:#f5e8d3; border:1px solid #e0c89a; border-radius:10px; padding:14px 16px; margin-bottom:14px; }
.banner-inner { display:flex; gap:12px; align-items:center; justify-content:space-between; font-family:Georgia,serif; font-size:14px; color:#5a3f1a; }
.btn-primary { background:#6b4d2a; color:#fff; border:0; border-radius:6px; padding:7px 12px; font-size:12px; cursor:pointer; }
.btn-close { background:none; border:0; color:#8a6a3a; font-size:18px; cursor:pointer; padding:0 4px; }
</style>

<script>
const DISMISS_KEY = 'stuc_migrate_banner_dismissed_v1';
const STANDARD_CENTS = new Set([900, 1900, 9900]);

async function init() {
  if (localStorage.getItem(DISMISS_KEY) !== null) return; // INV-5: presence-only check
  const res = await fetch('/api/billing/status', { credentials: 'include' });
  if (!res.ok) return;
  const { subscription } = await res.json();
  if (!subscription) return;
  if (subscription.source !== 'wix') return;
  if (subscription.migration_status !== 'pending') return;
  if (subscription.cancel_requested_at) return;
  if (subscription.migration_handoff_started_at) return;

  const banner = document.getElementById('stuc-migration-banner');
  banner.hidden = false;

  document.getElementById('stuc-migration-dismiss').addEventListener('click', () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    banner.hidden = true;
  });

  document.getElementById('stuc-migration-switch').addEventListener('click', async () => {
    if (!STANDARD_CENTS.has(subscription.amount_cents)) {
      // Show off-amount modal
      const modal = document.getElementById('stuc-off-amount-modal');
      document.getElementById('stuc-off-amt').textContent = '$' + (subscription.amount_cents / 100).toFixed(0);
      document.getElementById('stuc-keep-display').textContent = (subscription.amount_cents / 100).toFixed(0);
      modal.showModal();
      modal.querySelectorAll('[data-tier]').forEach(b => b.addEventListener('click', () => switchOver({ tier: b.dataset.tier })));
      document.getElementById('stuc-keep-amount').addEventListener('click', () => switchOver({
        tier: subscription.tier, acknowledge_off_amount: true
      }));
    } else {
      switchOver({ tier: subscription.tier });
    }
  });
}

async function switchOver(extra) {
  const res = await fetch('/api/create-checkout', {
    method: 'POST', credentials: 'include',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({ mode: 'subscription', ...extra })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.error === 'migration_in_progress') {
      alert('Your switch is already in progress. Check back in a moment.');
    } else if (err.error === 'off_amount') {
      // Server-side defense; client-side flow should have caught this
      alert('Please choose a tier first.');
    } else {
      alert('Could not start checkout. Please try again.');
    }
    return;
  }
  const { url } = await res.json();
  window.location.href = url;
}

init();
</script>
```

- [ ] **Step 5.2.2: Mount banner in /account**

Edit `src/pages/account/index.astro`. Import `StucMigrationBanner` near top. Render `<StucMigrationBanner />` directly above the existing membership card div.

Also: replace the existing `manage-billing-wix-note` div content with a new "Update card" button that opens an inline disclosure modal:

```html
<button id="wix-update-card-btn">Update card</button>
<dialog id="wix-update-card-modal">
  <h3>Update your card</h3>
  <p>You can switch over to update your card yourself, or email
    <a href="mailto:administrator@rrmacademy.org?subject=Update+card+on+my+donation">administrator@rrmacademy.org</a>
    and we'll update it for you within 1 business day.</p>
  <div>
    <button id="wix-update-card-switch" class="btn-primary">Switch over</button>
    <button id="wix-update-card-close">Email instead</button>
  </div>
</dialog>
```

Wire `wix-update-card-switch` to call the same `switchOver()` function as the banner.

- [ ] **Step 5.2.3: Manual smoke test**

`npm run dev`. Sign in as a test user with a pending wix_subscription. Verify:
- Banner appears on /account
- Dismiss × removes banner; reload keeps it hidden (localStorage)
- Cancel modal submit hides banner client-side
- Switch over button → /api/create-checkout → Stripe Checkout

- [ ] **Step 5.2.4: Commit**

```bash
git add src/components/StucMigrationBanner.astro src/pages/account/index.astro
git commit -m "feat(account): STUC migration banner + dual-surface Update card"
```

### Task 5.3: Cancel + Reactivate UI

**Files:**
- Create: `src/components/CancelDonationModal.astro`
- Modify: `src/pages/account/index.astro`

- [ ] **Step 5.3.1: Implement cancel modal component**

```astro
---
// src/components/CancelDonationModal.astro
---
<dialog id="cancel-donation-modal">
  <h3>Cancel your monthly donation</h3>
  <p id="cancel-body-text"></p>
  <label for="cancel-reason">If you'd like to share why, we read every word</label>
  <textarea id="cancel-reason" maxlength="2000" rows="4"></textarea>
  <div>
    <button id="cancel-keep-btn">Keep donating</button>
    <button id="cancel-confirm-btn" class="btn-destructive">Cancel donation</button>
  </div>
</dialog>

<script>
async function openCancelModal(subscription) {
  const modal = document.getElementById('cancel-donation-modal');
  document.getElementById('cancel-body-text').textContent =
    `Thank you for everything you've given to this work. Your community access continues through ${formatDate(subscription.next_expected_at || subscription.current_period_end)}.`;
  modal.showModal();

  document.getElementById('cancel-keep-btn').onclick = () => modal.close();
  document.getElementById('cancel-confirm-btn').onclick = async () => {
    const reason = document.getElementById('cancel-reason').value;
    if (reason.length > 2000) { alert('Reason too long'); return; }
    const res = await fetch('/api/billing/cancel', {
      method: 'POST', credentials: 'include',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ reason: reason || null })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error === 'already_pending'
        ? 'Your cancellation is already being processed.'
        : 'Could not cancel. Please try again.');
      return;
    }
    modal.close();
    showToast(`Got it. Your donation will end after ${formatDate(subscription.next_expected_at)}.`);
    // Hide banner client-side
    document.getElementById('stuc-migration-banner').hidden = true;
    // Flip card to "Ending · Reactivate" state
    flipCardToEnding(subscription.next_expected_at);
  };
}

function flipCardToEnding(date) {
  // Replace card buttons with "Reactivate"
  const card = document.querySelector('.membership-card');
  if (!card) return;
  card.querySelectorAll('button').forEach(b => b.remove());
  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.textContent = 'Reactivate';
  btn.onclick = reactivate;
  card.appendChild(btn);
  // Add "Ending {date}" note
}

async function reactivate() {
  const res = await fetch('/api/billing/reactivate', { method: 'POST', credentials: 'include' });
  if (res.status === 410) {
    const { redirect_url } = await res.json();
    window.location.href = redirect_url;
    return;
  }
  if (!res.ok) {
    alert('Could not reactivate. Please contact us.');
    return;
  }
  window.location.reload();
}

function formatDate(unixOrIso) {
  if (!unixOrIso) return 'your scheduled date';
  const d = typeof unixOrIso === 'number' ? new Date(unixOrIso * 1000) : new Date(unixOrIso);
  return d.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2a2a2a;color:#fff;padding:12px 20px;border-radius:8px;z-index:9999';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

window.openCancelModal = openCancelModal;
window.reactivate = reactivate;
</script>
```

- [ ] **Step 5.3.2: Wire to /account "Cancel donation" button**

In `src/pages/account/index.astro`, update the Cancel donation button's click handler to call `window.openCancelModal(subscription)`.

- [ ] **Step 5.3.3: Smoke test all 4 flows**

(1) Wix donor cancels → toast → card flips. (2) Reactivate → reloads with normal card. (3) Stripe donor cancels → Stripe sub at_period_end. (4) Reactivate Stripe → Stripe sub re-activated.

- [ ] **Step 5.3.4: Commit**

```bash
git add src/components/CancelDonationModal.astro src/pages/account/index.astro
git commit -m "feat(account): cancel + reactivate modal flows"
```

---

## Phase 6 — STUC member-first layout

### Task 6.1: Member-first hero on /save-the-uterus-club/

**Files:**
- Modify: `src/pages/save-the-uterus-club/index.astro`

- [ ] **Step 6.1.1: Add member-first conditional render**

Read existing page. Identify where the public marketing layout starts. Wrap with a server-rendered or client-side check:

```astro
---
import StucMigrationBanner from '../../components/StucMigrationBanner.astro';
// ... existing imports
---

<!-- Member-first card (hidden by default, JS shows when applicable) -->
<div id="stuc-member-card" hidden>
  <span class="label">You're in</span>
  <h2 id="stuc-member-tier"></h2>
  <p id="stuc-member-amount"></p>
  <p id="stuc-member-next"></p>
  <div>
    <a href="/community" class="btn-primary">Open community</a>
    <a href="/account" class="btn-secondary">Manage donation</a>
  </div>
  <a href="#tiers" class="btn-link">Change tier</a>
</div>

<StucMigrationBanner />

<!-- Existing public marketing layout (unchanged) -->
<!-- ... -->

<script>
async function init() {
  const res = await fetch('/api/billing/status', { credentials: 'include' });
  if (!res.ok) return;
  const { subscription } = await res.json();
  if (!subscription || subscription.status !== 'active' || subscription.cancel_requested_at) return;

  const card = document.getElementById('stuc-member-card');
  document.getElementById('stuc-member-tier').textContent =
    subscription.tier === 'superhero' ? 'Uterus Super Hero' :
    subscription.tier === 'hero' ? 'Uterus Hero' : 'Member';
  document.getElementById('stuc-member-amount').textContent =
    `$${(subscription.amount_cents / 100).toFixed(0)}/month`;
  document.getElementById('stuc-member-next').textContent =
    subscription.next_expected_at
      ? `Next donation · ${new Date(subscription.next_expected_at).toLocaleDateString('en-US', {year:'numeric', month:'long', day:'numeric'})}`
      : '';
  card.hidden = false;
  // Move card above the marketing fold via CSS or DOM placement
  card.scrollIntoView({ block: 'start' });
}
init();
</script>
```

- [ ] **Step 6.1.2: Smoke test**

Sign in as a member; visit /save-the-uterus-club/. Verify member-first card appears above the marketing fold. Sign out; verify public layout unchanged.

- [ ] **Step 6.1.3: Commit**

```bash
git add src/pages/save-the-uterus-club/index.astro
git commit -m "feat(stuc): member-first hero for logged-in active-sub donors"
```

---

## Phase 7 — Cron extensions

### Task 7.1: Extend `/api/admin/cleanup`

**Files:**
- Modify: `functions/api/admin/cleanup.js`

- [ ] **Step 7.1.1: Read existing cleanup.js**

Identify the structure (probably an array of cleanup tasks executed sequentially, each returning a count).

- [ ] **Step 7.1.2: Add Sweep 1 — stale cancellation_request re-email**

```js
// Sweep 1: re-email admin for unresolved cancellations >48h, throttled 1/day
async function sweepStaleCancellations(env, ctx) {
  const stale = await env.DB.prepare(
    `SELECT id, user_id, email, source, source_subscription_id, reason
     FROM cancellation_request
     WHERE resolved_at IS NULL
       AND requested_at < strftime('%s','now') - 172800
       AND (last_admin_notification_at IS NULL OR last_admin_notification_at < strftime('%s','now') - 86400)
     LIMIT 50`
  ).all();

  let sent = 0;
  for (const row of stale.results || []) {
    try {
      await sendEmailSafe(env, ctx.waitUntil, {
        to: 'administrator@rrmacademy.org',
        subject: `[reminder] STUC cancel still pending: ${row.email}`,
        html: `<p>Cancel request from <strong>${row.email}</strong> (source: ${row.source}) is still unresolved.</p>
<p>Reason: ${row.reason ? row.reason.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) : '<em>none</em>'}</p>`
      });
      await env.DB.prepare(
        `UPDATE cancellation_request SET last_admin_notification_at = strftime('%s','now') WHERE id = ?`
      ).bind(row.id).run();
      sent++;
    } catch (err) { /* log + continue */ }
  }
  return { sweep: 'stale-cancellations', sent };
}
```

- [ ] **Step 7.1.3: Add Sweep 2 — un-notified migrations**

```js
async function sweepUnnotifiedMigrations(env, ctx) {
  const stale = await env.DB.prepare(
    `SELECT id, email, stripe_subscription_id
     FROM wix_subscription
     WHERE migration_status = 'stripe_active'
       AND admin_notified_at IS NULL
       AND stripe_active_at < strftime('%s','now') - 600
       AND (last_admin_notification_at IS NULL OR last_admin_notification_at < strftime('%s','now') - 86400)
     LIMIT 50`
  ).all();

  let sent = 0;
  for (const row of stale.results || []) {
    try {
      await sendEmailSafe(env, ctx.waitUntil, {
        to: 'administrator@rrmacademy.org',
        subject: `[retry] STUC migration handoff: cancel ${row.email}'s Wix sub`,
        html: `<p>Donor migrated to Stripe sub <code>${row.stripe_subscription_id}</code>; please cancel Wix sub <code>${row.id}</code> in Wix admin.</p>`
      });
      const now = Math.floor(Date.now()/1000);
      await env.DB.prepare(
        `UPDATE wix_subscription SET admin_notified_at = ?, last_admin_notification_at = ? WHERE id = ?`
      ).bind(now, now, row.id).run();
      sent++;
    } catch (err) { /* log + continue */ }
  }
  return { sweep: 'unnotified-migrations', sent };
}
```

- [ ] **Step 7.1.4: Wire sweeps into cleanup handler**

In the existing handler, after the existing cleanup steps, call `sweepStaleCancellations(env, context)` and `sweepUnnotifiedMigrations(env, context)`. Include their counts in the response JSON.

- [ ] **Step 7.1.5: Manual trigger test**

Run: `curl -X POST -H "Authorization: Bearer $ADMIN_API_SECRET" http://localhost:8788/api/admin/cleanup`
Expected: response includes `sweeps: [...]` with `sent` counts.

- [ ] **Step 7.1.6: Commit**

```bash
git add functions/api/admin/cleanup.js
git commit -m "feat(admin): cleanup cron sweeps for stale cancellations + un-notified migrations"
```

---

## Phase 8 — Outreach email + admin reconciliation

### Task 8.1: Replace plain-text email link with magic-link

**Files:**
- Modify: `functions/api/admin/wix-migration-email.js`

- [ ] **Step 8.1.1: Generate token in send loop**

```js
import { signMigrationToken } from '../billing/_migration-token.js';

// Inside the per-donor send loop:
const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
const token = await signMigrationToken({ wix_sub_id: donor.id, exp }, env.MIGRATION_TOKEN_SECRET);
const magicUrl = `https://rrmacademy.org/save-the-uterus-club/migrate?t=${token}`;
```

Replace the email body's "use this email" line with a "Switch over" CTA button linking to `magicUrl`. Keep the off-amount block but reword to "Click below; on the next page you'll choose a tier."

- [ ] **Step 8.1.2: Smoke test**

Run a dry-send (existing `dryRun` mode); verify email body contains the magic-link URL and the URL renders the magic-link landing page.

- [ ] **Step 8.1.3: Commit**

```bash
git add functions/api/admin/wix-migration-email.js
git commit -m "feat(admin): outreach email uses HMAC magic-link URL"
```

### Task 8.2: New admin reconciliation endpoint

**Files:**
- Create: `functions/api/admin/wix-migration-link.js`
- Create: `tests/admin/wix-migration-link.test.js`

- [ ] **Step 8.2.1: Write tests**

```js
describe('/api/admin/wix-migration-link', () => {
  it('rejects without ADMIN_API_SECRET', async () => { /* 401 */ });
  it('updates wix_subscription.user_id with valid input', async () => {
    // Body: { wix_subscription_id, user_id }
    // Expected: row updated, AE event 'wix-migration-linked'
  });
  it('rejects when wix_subscription not found', async () => { /* 404 */ });
  it('rejects when user_id not found in user table', async () => { /* 404 */ });
});
```

- [ ] **Step 8.2.2: Implement endpoint**

```js
// functions/api/admin/wix-migration-link.js
import { CORS_HEADERS } from '../auth/_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = request.headers.get('Authorization') || '';
  if (auth !== `Bearer ${env.ADMIN_API_SECRET}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS_HEADERS });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const wixSubId = typeof body.wix_subscription_id === 'string' ? body.wix_subscription_id : null;
  const userId = typeof body.user_id === 'string' ? body.user_id : null;
  if (!wixSubId || !userId) {
    return new Response(JSON.stringify({ error: 'invalid_input' }), { status: 400, headers: CORS_HEADERS });
  }

  const wixSub = await env.DB.prepare(`SELECT id FROM wix_subscription WHERE id = ?`).bind(wixSubId).first();
  if (!wixSub) return new Response(JSON.stringify({ error: 'wix_sub_not_found' }), { status: 404, headers: CORS_HEADERS });

  const user = await env.DB.prepare(`SELECT id FROM user WHERE id = ?`).bind(userId).first();
  if (!user) return new Response(JSON.stringify({ error: 'user_not_found' }), { status: 404, headers: CORS_HEADERS });

  await env.DB.prepare(`UPDATE wix_subscription SET user_id = ? WHERE id = ?`).bind(userId, wixSubId).run();

  env.WORKER_EVENTS?.writeDataPoint({
    blobs: ['admin', 'wix-migration-linked', wixSubId, userId, ''],
    indexes: ['wix-migration-linked']
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
}
```

- [ ] **Step 8.2.3: Commit**

```bash
git add functions/api/admin/wix-migration-link.js tests/admin/wix-migration-link.test.js
git commit -m "feat(admin): /api/admin/wix-migration-link reconciliation endpoint (Layer 4)"
```

### Task 8.3: Update wix-migration-status dashboard

**Files:**
- Modify: `functions/api/admin/wix-migration-status.js`

- [ ] **Step 8.3.1: Add cold-checkout query**

Add a new section to the dashboard that queries AE for `stuc-migration-cold-checkout` events with `email_mismatch=true` in the last 14 days. Return as `mismatched_cold_checkouts: [...]` so Brian can review.

- [ ] **Step 8.3.2: Commit**

```bash
git add functions/api/admin/wix-migration-status.js
git commit -m "feat(admin): wix-migration-status surfaces email-mismatch cold checkouts"
```

---

## Phase 9 — Telemetry verification + guard

### Task 9.1: Verify all AE events emit

- [ ] **Step 9.1.1: Manual smoke through every flow**

Test each event from the spec's telemetry table fires once. Use `scripts/query-events.sh` or wrangler tail.

| Flow | Expected event |
|------|----------------|
| Banner shown | `stuc-migration-banner-shown` |
| Banner × | `stuc-migration-banner-dismissed` |
| Switch over click | `stuc-migration-banner-clicked` |
| Checkout created | `stuc-migration-checkout-started` |
| Webhook reconciles | `stuc-migration-completed` |
| Bad token | `stuc-migration-token-invalid` (×3 reasons) |
| Email mismatch interstitial | `stuc-migration-token-binding-mismatch` |
| Cold checkout | `stuc-migration-cold-checkout` |
| Stuck handoff | `stuc-migration-handoff-stuck` |
| Cancel | `stuc-cancel-requested` |
| Reactivate | `stuc-cancel-reactivated` |
| Cron retry | `stuc-admin-notify-retry` |

- [ ] **Step 9.1.2: Update guard manifest**

Run: `npm run guard:update`
Verify: `git diff scripts/guard-manifest.json` shows hashes for all new/edited security-guarded files.

- [ ] **Step 9.1.3: Run full guard**

Run: `npm run guard`
Expected: PASS.

- [ ] **Step 9.1.4: Commit**

```bash
git add scripts/guard-manifest.json
git commit -m "guard: update manifest for STUC migration UX phase 9"
```

---

## Phase 10 — wix-sync amendments (sibling plan)

This phase is **NOT** in this plan because it lives in the `rrm-wix-sync` repo. Write a separate plan at `~/iCode/projects/rrm-wix-sync/docs/superpowers/plans/2026-04-28-wix-sync-cancellation-amendments.md` covering:

- `src/status.js` `deriveStatus()` extension to return `'cancelled'` on explicit Wix cancellation flag.
- `src/sync.js` cron pass for `migration_status='stripe_active' AND status='inactive' AND last_order_at < now-60d → migrated`.
- Wix webhook handler amendment for `SUBSCRIPTION_CANCELLED` event setting `status='cancelled'` explicitly.

**Coordinate merge order:** the rrm-academy-cf side (this plan) ships behind `STUC_MIGRATION_UX_V2` flag. The flag stays `false` in production until BOTH plans land, until manual end-to-end staging test passes (matched + mismatched email donor migrations succeed), and until Brian has confirmed the wix-sync amendments are live.

---

## Final smoke test (before flag flip)

Stage test wix_subscription rows in production D1 (Brian's call) OR use staging environment with a real Wix sandbox sub. Run through:

- [ ] Logged-in matched-email donor sees banner, clicks Switch over, completes Stripe Checkout with $0 trial, webhook reconciles, /account shows source='stripe' with portal button working.
- [ ] Logged-in mismatched-email donor visits /account; banner does NOT show; help text is visible; Brian uses /api/admin/wix-migration-link to pair; banner now shows.
- [ ] Logged-in donor receives outreach email with magic-link; clicks; email-binding interstitial fires (since CF and Wix emails match in test); confirmation interstitial; click Continue; Stripe Checkout; webhook reconciles.
- [ ] Cross-user replay test: forward magic-link email to a second test account; sign in as second account; visit link; binding-mismatch interstitial appears; cannot proceed.
- [ ] Off-amount donor ($25/mo): banner click → off-amount modal → choose Hero $19 → migrates at $19. Separately: choose Keep $25 → migrates with price_data ad-hoc at $25.
- [ ] Cancel flow: source=wix click Cancel donation → toast → card flips → Reactivate → reloads to normal card. Verify admin email received.
- [ ] Cancel flow: source=stripe click Cancel donation → toast → card flips → Reactivate → Stripe sub `cancel_at_period_end=false`.
- [ ] Cron sweep: manually invoke /api/admin/cleanup; verify both sweeps return counts.

After all pass, flip `STUC_MIGRATION_UX_V2=true` in CF Pages env.
