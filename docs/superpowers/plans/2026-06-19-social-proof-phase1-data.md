# Social Proof Phase 1: Consent + Supporter Data (payments-guarded) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task that touches a file under `functions/api/` (especially `billing/` + `create-checkout.js`) MUST be implemented through the `coder` subagent per the rrm-academy-cf CLAUDE.md.

**Goal:** Build the data layer that lets opt-in donors become publicly-recognized supporters: capture consent + a name at Stripe checkout, persist a privacy-clean `supporter_recognition` row on the webhook, tombstone it on refund, and serve recent/founding supporters via `/api/fund-supporters`. No public UI (that is Phase 2).

**Architecture:** Stripe metadata is the single source of truth for the gift count and each gift's sequence position (`gift_seq`), so the thermometer, the supporter total, and founding scarcity cannot disagree and there is no `donor_gift` schema change or backfill. D1 `rrm-auth` holds only the consented display rows (`supporter_recognition`). The webhook persist is idempotent + non-fail-soft so a transient failure retries cleanly instead of silently dropping a consenting donor.

**Tech Stack:** Cloudflare Pages Functions + Stripe + D1 (`rrm-auth`, binding `DB`) + KV (`COMMUNITY_KV`) + `node --test` (unit, Node 25 runs `.mjs`/`.ts` natively).

**Spec:** `docs/superpowers/specs/2026-06-19-provider-directory-social-proof-recognition-design.md` (v2). This plan implements its Phase 1 (§4, §5, §6, §9, §12).

## Global Constraints

- **Payments-guard ritual (HARD).** `create-checkout.js`, `functions/api/billing/_webhook-checkout.js`, `functions/api/billing/_webhook-refund.js`, the new `functions/api/billing/_supporter-gift.js`, and the new `functions/api/fund-supporters.js` are payment-surface files. Each task that edits or adds one of them: implement via the `coder` subagent; run `npm run guard:update` to refresh `guard-manifest.json` AND commit the file + the regenerated manifest in the SAME commit; run `npm run gates:payment` (PG1-PG4) before the commit. PG2 forbids `err.message` reaching the client.
- **Privacy (HARD).** `supporter_recognition` and `/api/fund-supporters` expose only the server-derived first-name + last-initial + `gift_seq`. Never email, full name, amount, or `occurred_at`. The read endpoint uses an explicit column list, never `SELECT *`. Default anonymous: no row without `show_supporter='yes'`.
- **Single Stripe count source.** `gift_seq` (webhook) and `total_gifts` (read endpoint) derive from the same succeeded-not-fully-refunded campaign PaymentIntents that `functions/api/fund-progress.js` already queries. The read endpoint reads the `count` the thermometer uses (the `fund-progress:provider-directory` KV value) so the two cannot diverge.
- **Idempotent + non-fail-soft webhook persist.** The supporter insert uses `ON CONFLICT(source, source_id) DO NOTHING` and is NOT wrapped in a swallow-everything try/catch: a genuine failure propagates so the webhook envelope does not stamp `completed_at` and Stripe re-delivers (retry is safe because the insert is idempotent). This is the codebase-consistent realization of the spec's "atomic" intent (`recordDonorGift` is intentionally sequential/non-batchable, `_donor-gift.js:108-110`).
- **Migration applied by hand.** No runner exists. Apply `031` to `rrm-auth` `--remote` and verify the table exists BEFORE deploying the code that reads/writes it.
- **No em dashes** anywhere. Recipient is always the RRM Foundation 501(c)(3).
- **Escaping/moderation of `display_name` at render is Phase 2** (this plan stores a server-derived, sanitized string; Phase 2 owns the render-time HTML-escaping contract).
- Run on a `claude/*` branch off `origin/main`; commit only this plan's files.

## File Structure

| File | Responsibility | Status |
|------|----------------|--------|
| `migrations/031-supporter-recognition.sql` | The `supporter_recognition` table + indexes | Create |
| `functions/api/billing/_supporter-gift.js` | Pure helpers: `deriveDisplayName`, `readSupporterConsent`, `recordSupporterGift`, `removeSupporterGift` | Create (guarded surface) |
| `functions/api/create-checkout.js` | Add `billing_address_collection:'required'` + the `show_supporter` dropdown for the provider-directory payment session | Modify (GUARDED) |
| `functions/api/billing/_webhook-checkout.js` | After `recordDonorGift`, persist the supporter row (consent + name + `gift_seq`), non-fail-soft | Modify (GUARDED) |
| `functions/api/billing/_webhook-refund.js` | On a campaign refund, remove the supporter row | Modify (GUARDED) |
| `functions/api/fund-supporters.js` | GET endpoint: Stripe `total_gifts` + D1 consented names | Create (GUARDED surface) |
| `tests/unit/supporter-gift.test.mjs` | `deriveDisplayName` + `readSupporterConsent` pure-logic tests | Create |

---

### Task 1: Migration `031-supporter-recognition.sql`

**Files:**
- Create: `migrations/031-supporter-recognition.sql`

**Interfaces:**
- Produces the `supporter_recognition` table (D1 `rrm-auth`) consumed by Tasks 2, 4, 5, 6.

- [ ] **Step 1: Write the migration**

Create `migrations/031-supporter-recognition.sql` (mirror the `030` header ritual comment):

```sql
-- 031-supporter-recognition.sql
-- Public opt-in supporter recognition for campaign fundraisers (provider-directory).
-- Holds ONLY consented display rows: server-derived "First L." + gift_seq. No amounts,
-- no full names; email is private (dedup/contact link) and never returned by the read API.
-- Apply (by hand; no runner): 
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/031-supporter-recognition.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/031-supporter-recognition.sql
CREATE TABLE IF NOT EXISTS supporter_recognition (
  id TEXT PRIMARY KEY,
  campaign TEXT NOT NULL DEFAULT 'provider-directory',
  display_name TEXT NOT NULL,
  gift_seq INTEGER NOT NULL,
  email TEXT COLLATE NOCASE,
  source TEXT NOT NULL CHECK (source IN ('stripe')),
  source_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_supporter_recognition_campaign ON supporter_recognition(campaign);
CREATE INDEX IF NOT EXISTS idx_supporter_recognition_giftseq ON supporter_recognition(gift_seq);
CREATE INDEX IF NOT EXISTS idx_supporter_recognition_occurred ON supporter_recognition(occurred_at);
```

- [ ] **Step 2: Verify it parses + applies locally**

Run: `npx wrangler d1 execute rrm-auth --local --file=migrations/031-supporter-recognition.sql`
Expected: success; then `npx wrangler d1 execute rrm-auth --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='supporter_recognition'"` returns one row.

- [ ] **Step 3: Commit**

```bash
git add migrations/031-supporter-recognition.sql
git commit -m "feat(supporter): add supporter_recognition migration (031)"
```

(The `--remote` apply is an explicit deploy step in the execution-handoff section, run before the dependent code deploys.)

---

### Task 2: `_supporter-gift.js` helper + pure-logic tests

**Files:**
- Create: `functions/api/billing/_supporter-gift.js`
- Test: `tests/unit/supporter-gift.test.mjs`

**Interfaces:**
- Produces:
  - `deriveDisplayName(rawName: string): string | null` — pure; returns the public "First L." form, or `null` when there is no usable name (caller writes no row). Sanitizes (NFKC, strip bidi/zero-width + `< > & " '`, grapheme-cap 40) and rejects impersonation.
  - `readSupporterConsent(session): boolean` — reads the `show_supporter` dropdown by key.
  - `recordSupporterGift(db, gift): Promise<{recorded: boolean}>` — idempotent insert; `gift = { campaign, displayName, giftSeq, email, sourceId, occurredAt }`.
  - `removeSupporterGift(db, { source, sourceId }): Promise<void>` — refund/removal tombstone.
- Consumed by Tasks 4, 5.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/supporter-gift.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDisplayName, readSupporterConsent } from '../../functions/api/billing/_supporter-gift.js';

test('two-token name -> First L.', () => {
  assert.equal(deriveDisplayName('Sarah Martinez'), 'Sarah M.');
});
test('extra tokens use the last initial', () => {
  assert.equal(deriveDisplayName('Maria Del Carmen Ruiz'), 'Maria R.');
});
test('single token -> bare first name (no dangling initial)', () => {
  assert.equal(deriveDisplayName('Cher'), 'Cher');
});
test('empty / whitespace -> null (no row)', () => {
  assert.equal(deriveDisplayName('   '), null);
  assert.equal(deriveDisplayName(''), null);
  assert.equal(deriveDisplayName(null), null);
});
test('strips angle brackets and quotes (defense in depth)', () => {
  assert.equal(deriveDisplayName('<b>Sarah</b> Martinez'), 'bSarahb M.');
});
test('strips bidi-override + zero-width chars', () => {
  assert.equal(deriveDisplayName('Sarah‮Martinez'), 'SarahMartinez'); // collapses to one token after strip
});
test('caps to 40 graphemes', () => {
  const long = 'Alexandrina'.repeat(6) + ' Smith';
  assert.ok([...deriveDisplayName(long)].length <= 40);
});
test('rejects impersonation -> null', () => {
  assert.equal(deriveDisplayName('RRM Academy'), null);
  assert.equal(deriveDisplayName('Naomi Whittaker'), null);
  assert.equal(deriveDisplayName('Official RRM'), null);
});
test('readSupporterConsent reads the dropdown by key', () => {
  const yes = { custom_fields: [{ key: 'show_supporter', dropdown: { value: 'yes' } }] };
  const no = { custom_fields: [{ key: 'show_supporter', dropdown: { value: 'no' } }] };
  const absent = { custom_fields: [{ key: 'other', text: { value: 'x' } }] };
  assert.equal(readSupporterConsent(yes), true);
  assert.equal(readSupporterConsent(no), false);
  assert.equal(readSupporterConsent(absent), false);
  assert.equal(readSupporterConsent({}), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/supporter-gift.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the helper**

Create `functions/api/billing/_supporter-gift.js`:

```js
/**
 * Supporter recognition helpers (provider-directory social proof, Phase 1).
 * Spec: docs/superpowers/specs/2026-06-19-provider-directory-social-proof-recognition-design.md
 * Privacy: produces ONLY a server-derived "First L." public string; never stores full name/amount.
 */

const IMPERSONATION = /\b(rrm|academy|official|foundation|whittaker|naomi|boyle|hilgers|admin|staff|moderator)\b/i;
const STRIP_RE = /[‪-‮⁦-⁩​-‍﻿<>&"']/g; // bidi, zero-width, html-significant

/** Pure. Returns the public "First L." form or null (caller writes no row). */
export function deriveDisplayName(rawName) {
  if (typeof rawName !== 'string') return null;
  let n = rawName.normalize('NFKC').replace(STRIP_RE, '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (IMPERSONATION.test(n)) return null;
  const tokens = n.split(' ').filter(Boolean);
  let out = tokens.length >= 2 ? `${tokens[0]} ${tokens[tokens.length - 1][0]}.` : tokens[0];
  const chars = [...out];
  if (chars.length > 40) out = chars.slice(0, 40).join('');
  return out || null;
}

/** Reads the show_supporter dropdown by KEY (never by array index). */
export function readSupporterConsent(session) {
  const fields = (session && Array.isArray(session.custom_fields)) ? session.custom_fields : [];
  const f = fields.find((c) => c && c.key === 'show_supporter');
  return f?.dropdown?.value === 'yes';
}

/** Idempotent insert. Explicit columns. id is generated here (never NULL). */
export async function recordSupporterGift(db, gift) {
  const displayName = gift && typeof gift.displayName === 'string' ? gift.displayName : '';
  if (!displayName) return { recorded: false };
  if (!gift.sourceId || typeof gift.giftSeq !== 'number') return { recorded: false };
  const id = 'sr_' + crypto.randomUUID();
  await db.prepare(
    `INSERT INTO supporter_recognition
       (id, campaign, display_name, gift_seq, email, source, source_id, occurred_at)
     VALUES (?, ?, ?, ?, ?, 'stripe', ?, ?)
     ON CONFLICT(source, source_id) DO NOTHING`
  ).bind(
    id,
    gift.campaign || 'provider-directory',
    displayName,
    gift.giftSeq,
    (gift.email || '').toLowerCase().trim() || null,
    String(gift.sourceId),
    gift.occurredAt,
  ).run();
  return { recorded: true };
}

/** Refund / removal tombstone. */
export async function removeSupporterGift(db, { source, sourceId }) {
  if (!sourceId) return;
  await db.prepare(
    'DELETE FROM supporter_recognition WHERE source = ? AND source_id = ?'
  ).bind(source || 'stripe', String(sourceId)).run();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/supporter-gift.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 5: Commit (guarded surface)**

Implement via the `coder` agent; then:
```bash
npm run guard:update && npm run gates:payment
git add functions/api/billing/_supporter-gift.js tests/unit/supporter-gift.test.mjs guard-manifest.json
git commit -m "feat(supporter): _supporter-gift helper (derive/consent/record/remove) + unit tests"
```

---

### Task 3: `create-checkout.js` consent + name collection (GUARDED, coder agent)

**Files:**
- Modify: `functions/api/create-checkout.js` (the `mode:'payment'` branch)

**Interfaces:**
- Consumes: nothing new. Produces: provider-directory payment sessions that collect the name and a `show_supporter` consent dropdown.

- [ ] **Step 1: Add name collection + the consent dropdown (coder agent)**

In the `mode:'payment'` session params, gated on `campaign === 'provider-directory'`, add:

```js
if (campaign === 'provider-directory') {
  sessionParams.billing_address_collection = 'required';
  sessionParams.custom_fields = [{
    key: 'show_supporter',
    label: { type: 'custom', custom: 'Show my first name as a public supporter?' },
    type: 'dropdown',
    optional: true,
    dropdown: { options: [
      { label: 'Yes, show my first name', value: 'yes' },
      { label: 'Keep me anonymous', value: 'no' },
    ] },
  }];
}
```

The `coder` agent places this with the existing payment-branch params (after the `payment_intent_data`/metadata block), preserving everything else. `campaign` is already parsed/validated at the top of the handler.

- [ ] **Step 2: Verify gates + a shape check**

Run: `npm run gates:payment` (PG1-PG4 PASS). Confirm by reading the diff that the block is gated on `campaign === 'provider-directory'` and does not alter the generic `/donate/` path.

- [ ] **Step 3: Commit (guard ritual, one commit)**

```bash
npm run guard:update
git add functions/api/create-checkout.js guard-manifest.json
git commit -m "feat(checkout): collect name + show_supporter consent on provider-directory gifts"
```

---

### Task 4: `_webhook-checkout.js` supporter persist (GUARDED, coder agent)

**Files:**
- Modify: `functions/api/billing/_webhook-checkout.js` (inside `handleCheckoutCompleted`, after the `recordDonorGift` block)

**Interfaces:**
- Consumes: `readSupporterConsent`, `deriveDisplayName`, `recordSupporterGift` (Task 2); the Stripe client already in scope in the handler.
- Produces: a `supporter_recognition` row for consented provider-directory gifts.

- [ ] **Step 1: Add the persist block (coder agent), non-fail-soft**

After the existing `donor_gift` recording, for `session.mode === 'payment'` AND `session.metadata?.campaign === 'provider-directory'` AND `readSupporterConsent(session)`:
- derive `displayName = deriveDisplayName(session.customer_details?.name)`; if null, skip (anonymous).
- compute `giftSeq` = the count of succeeded, not-fully-refunded campaign PaymentIntents from Stripe (reuse the exact search `fund-progress.js` uses: `status:'succeeded' AND metadata['campaign']:'provider-directory'`), i.e. the gift's true sequence position over all gifts.
- call `await recordSupporterGift(db, { campaign:'provider-directory', displayName, giftSeq, email: session.customer_details?.email, sourceId: session.payment_intent || session.id, occurredAt: new Date((event.created || Math.floor(Date.now()/1000))*1000).toISOString() })`.

This block is NOT wrapped in a swallow-everything catch. Per the Global Constraints, a genuine failure propagates so the envelope retries; the insert is idempotent so retry is safe. (Do not return `err.message` to the client; PG2.)

The `coder` agent reads the live `handleCheckoutCompleted` to place this correctly relative to the donor_gift write and the existing return shape.

- [ ] **Step 2: Verify gates + a mock-env exercise**

Run: `npm run gates:payment` (PASS). The `coder` agent runs a mock-env exercise of `handleCheckoutCompleted` with (a) a consented provider-directory session (asserts one `supporter_recognition` row), (b) an unconsented one (asserts no row, gift still processed), (c) a non-campaign donation (asserts no row).

- [ ] **Step 3: Commit (guard ritual)**

```bash
npm run guard:update
git add functions/api/billing/_webhook-checkout.js guard-manifest.json
git commit -m "feat(supporter): persist consented provider-directory supporters on checkout (idempotent, non-fail-soft)"
```

---

### Task 5: `_webhook-refund.js` tombstone (GUARDED, coder agent)

**Files:**
- Modify: `functions/api/billing/_webhook-refund.js`

**Interfaces:**
- Consumes: `removeSupporterGift` (Task 2). Produces: removal of a supporter row when its gift is refunded.

- [ ] **Step 1: Add the tombstone (coder agent)**

In the `charge.refunded` handler, after the existing refund processing, call `await removeSupporterGift(db, { source: 'stripe', sourceId: <the refunded charge's payment_intent> })`. The `coder` agent resolves the payment_intent from the charge/refund event shape already used by the handler. Non-fail-soft is acceptable here (removal can retry; a missing row is a no-op DELETE).

- [ ] **Step 2: Verify gates**

Run: `npm run gates:payment` (PASS). Mock-env: a refund of a consented gift removes its `supporter_recognition` row; a refund of an anonymous/non-campaign gift is a clean no-op.

- [ ] **Step 3: Commit (guard ritual)**

```bash
npm run guard:update
git add functions/api/billing/_webhook-refund.js guard-manifest.json
git commit -m "feat(supporter): tombstone supporter row on refund"
```

---

### Task 6: `/api/fund-supporters` read endpoint (GUARDED surface, coder agent)

**Files:**
- Create: `functions/api/fund-supporters.js`
- Modify: `scripts/gates/validate-payment-pipeline.mjs` (add the new file to PAYMENT_FILES)

**Interfaces:**
- Produces: GET `/api/fund-supporters` returning `{ ok, total_gifts, consented_count, recent, founding, founding_cap, founding_left, founding_closed, anonymous_founders }`.

- [ ] **Step 1: Write the endpoint (coder agent)**

Create `functions/api/fund-supporters.js` mirroring `fund-progress.js`'s KV-cache + rate-limit ergonomics, but D1-backed for names, Stripe-sourced for the count, and always-200:

```js
import { json, optionsResponse, checkRateLimit } from './auth/_shared.js';

const CAMPAIGN = 'provider-directory';
const FOUNDING_CAP = 100;
const KV_KEY = `fund-supporters:${CAMPAIGN}`;
const KV_TTL = 60;
const EMPTY = {
  ok: true, total_gifts: 0, consented_count: 0, recent: [], founding: [],
  founding_cap: FOUNDING_CAP, founding_left: FOUNDING_CAP, founding_closed: false, anonymous_founders: 0,
};

export async function onRequestOptions() { return optionsResponse(); }
export async function onRequestHead(ctx) { return onRequestGet(ctx); }

export async function onRequestGet({ request, env, waitUntil }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await checkRateLimit(env, `fund-supporters:${ip}`, 30, 60)) {
    return json({ error: 'rate_limited' }, 429);
  }
  if (env.COMMUNITY_KV) {
    try { const c = await env.COMMUNITY_KV.get(KV_KEY); if (c) return json(JSON.parse(c)); } catch {}
  }
  try {
    // total_gifts: read the SAME count the thermometer uses (fund-progress KV), so they cannot diverge.
    let total = 0;
    if (env.COMMUNITY_KV) {
      try {
        const fp = await env.COMMUNITY_KV.get(`fund-progress:${CAMPAIGN}`);
        if (fp) { const p = JSON.parse(fp); if (typeof p.count === 'number') total = Math.max(0, p.count); }
      } catch {}
    }
    let recent = [], founding = [], consented = 0;
    if (env.DB) {
      const url = new URL(request.url);
      const limit = Math.min(12, Math.max(1, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
      const r = await env.DB.prepare(
        'SELECT display_name, gift_seq FROM supporter_recognition WHERE campaign = ? ORDER BY occurred_at DESC LIMIT ?'
      ).bind(CAMPAIGN, limit).all();
      recent = (r.results || []).map((x) => ({ displayName: x.display_name, seq: x.gift_seq }));
      const f = await env.DB.prepare(
        'SELECT display_name, gift_seq FROM supporter_recognition WHERE campaign = ? AND gift_seq <= ? ORDER BY gift_seq ASC'
      ).bind(CAMPAIGN, FOUNDING_CAP).all();
      founding = (f.results || []).map((x) => ({ displayName: x.display_name, seq: x.gift_seq }));
      const c = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM supporter_recognition WHERE campaign = ?'
      ).bind(CAMPAIGN).first();
      consented = c?.n || 0;
    }
    const founding_left = Math.max(0, FOUNDING_CAP - total);
    const result = {
      ok: true, total_gifts: total, consented_count: consented, recent, founding,
      founding_cap: FOUNDING_CAP, founding_left, founding_closed: founding_left === 0,
      anonymous_founders: Math.max(0, Math.min(total, FOUNDING_CAP) - founding.length),
    };
    if (env.COMMUNITY_KV) {
      waitUntil(env.COMMUNITY_KV.put(KV_KEY, JSON.stringify(result), { expirationTtl: KV_TTL }).catch(() => {}));
    }
    return json(result);
  } catch {
    return json(EMPTY);  // always-200, page always renders
  }
}
```

- [ ] **Step 2: Add to the payment-pipeline gate**

Add `'functions/api/fund-supporters.js'` to the `PAYMENT_FILES` array in `scripts/gates/validate-payment-pipeline.mjs`.

- [ ] **Step 3: Verify gates**

Run: `npm run gates:payment` (PASS, including the new file). The `coder` agent mock-exercises: empty DB returns the EMPTY-shaped 200; a seeded row appears in `recent`/`founding`; `limit` out-of-range clamps; no `SELECT *`; `email` never in the response.

- [ ] **Step 4: Commit (guard ritual)**

```bash
npm run guard:update
git add functions/api/fund-supporters.js scripts/gates/validate-payment-pipeline.mjs guard-manifest.json
git commit -m "feat(supporter): /api/fund-supporters read endpoint (Stripe count + D1 names, always-200)"
```

## Execution handoff (deploy + verify)

Because this is data-only and gated by a hand-applied migration, the deploy order matters:
1. Land all six tasks on the branch (each guarded commit carries its `guard-manifest.json` update).
2. Apply the migration to remote: `npx wrangler d1 execute rrm-auth --remote --file=migrations/031-supporter-recognition.sql`; verify `supporter_recognition` exists remotely.
3. Push the branch (auto-merge -> deploy). The webhook + endpoint code now has the table.
4. Post-deploy: a $5 canary gift with consent -> confirm one `supporter_recognition` row + `/api/fund-supporters` returns it; refund it -> confirm the row is removed. Then no public UI shows until Phase 2.

## Self-Review

- **Spec coverage (Phase 1, §4/§5/§6/§9):** consent dropdown + name collection (T3) ✓; `supporter_recognition` table (T1) ✓; consent-by-key + name derivation + `gift_seq` + idempotent non-fail-soft persist (T2+T4) ✓; refund tombstone (T2+T5) ✓; `/api/fund-supporters` Stripe-count + D1-names + always-200 + explicit projection + hardcoded campaign + limit cap (T6) ✓; privacy (no email/amount returned; default anonymous) ✓; guard ritual on every payment file ✓; migration-before-deploy ✓.
- **Placeholder scan:** the guarded-file *edits* (T3/T4/T5) are described as contracts for the coder agent to place against live code (the coder-agent rule requires it to read siblings), with the exact code blocks to insert; the new files (T1/T2/T6) carry complete code. No "TBD".
- **Type/name consistency:** `deriveDisplayName`/`readSupporterConsent`/`recordSupporterGift`/`removeSupporterGift` names match across T2/T4/T5; `gift_seq`/`source_id`/`campaign` column names match the T1 schema, the T2 insert, and the T6 projection; `FOUNDING_CAP=100` matches the spec.
