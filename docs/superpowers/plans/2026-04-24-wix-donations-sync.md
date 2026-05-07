# Wix Donations Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror Wix recurring + one-off donation data into Cloudflare D1 so `/account` can show membership + donation history for Wix donors (fixes Victoria Bergin case and all future Wix donors).

**Architecture:** New Worker (`rrm-wix-sync`) is **webhook-driven**: Wix pushes signed events (order paid, subscription canceled, etc.) to `POST /webhook`, which verifies RS256 signature against the Wix public key and upserts into two D1 tables (`wix_subscription`, `wix_payment`) in the existing `rrm-auth` database. A **6-hour safety-net cron** runs a reconciliation poll to catch any missed events. Existing `/api/billing/status.js` and `community/_shared.js` are extended to read the new tables. Rollout is staged: sync worker deployed first, backfill + webhook registration done, data verified overnight, then read-side changes deployed the next day.

**Tech Stack:** Cloudflare Workers (sync + existing Pages Functions), D1 (rrm-auth), Wix eCom Orders REST API + Wix App webhook signing (RS256 JWT), WebCrypto for signature verification (no external deps), Vitest for Worker unit tests, wrangler for deploys.

**Companion spec:** [`docs/superpowers/specs/2026-04-24-wix-donations-sync-design.md`](../specs/2026-04-24-wix-donations-sync-design.md)

**Fishing-trip reports (reference only):** `/tmp/wix-fishing-report.md`, `/tmp/airtable-wix-ledger-report.md`

---

## Phase 1: Sync worker + schema (Day 1)

No read-side changes yet. Goal: data lands in D1, nothing downstream breaks.

### Task 1: Scaffold `rrm-wix-sync` Worker project

**Files:**
- Create: `~/iCode/projects/rrm-wix-sync/package.json`
- Create: `~/iCode/projects/rrm-wix-sync/wrangler.toml`
- Create: `~/iCode/projects/rrm-wix-sync/.gitignore`
- Create: `~/iCode/projects/rrm-wix-sync/.dev.vars.example`
- Create: `~/iCode/projects/rrm-wix-sync/README.md`
- Create: `~/iCode/projects/rrm-wix-sync/CLAUDE.md`
- Create: `~/iCode/projects/rrm-wix-sync/src/index.js` (empty stub)

- [ ] **Step 1: Create project directory and initialize git**

```bash
mkdir -p ~/iCode/projects/rrm-wix-sync/src ~/iCode/projects/rrm-wix-sync/tests
cd ~/iCode/projects/rrm-wix-sync
git init
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "rrm-wix-sync",
  "version": "0.1.0",
  "private": true,
  "description": "Syncs Wix eCom donation data into Cloudflare D1 (rrm-auth) for rrmacademy.org /account page",
  "main": "src/index.js",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "wrangler": "^4.62.0"
  }
}
```

- [ ] **Step 3: Write `wrangler.toml`**

```toml
name = "rrm-wix-sync"
main = "src/index.js"
compatibility_date = "2026-04-24"
compatibility_flags = ["nodejs_compat"]

workers_dev = true

[vars]
WIX_SITE_ID = "e15fd723-0b26-4e85-8ab3-e7b8d119089e"
WIX_ACCOUNT_ID = "1b8b3c82-5d0d-46fb-91a1-87fec8863664"
STUC_PRODUCT_ID = "f62015ec-5618-4508-9846-eadeb2a454d0"
LEGACY_STUC_PRICING_PLAN_ID = "0b5b8754-c649-4c10-b648-025499f3b175"

[[d1_databases]]
binding = "DB"
database_name = "rrm-auth"
database_id = "REPLACE_WITH_D1_ID_FROM_RRM_ACADEMY_CF_WRANGLER_TOML"

[[analytics_engine_datasets]]
binding = "AE"
dataset = "worker-events"

[triggers]
crons = ["0 */6 * * *"]
```

The `database_id` will be filled in Step 6 of this task.

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
.dev.vars
.wrangler/
dist/
.DS_Store
```

- [ ] **Step 5: Write `.dev.vars.example`**

```
# Copy to .dev.vars for local dev (never commit)
# Get from: op read 'op://Automation/<redacted>/credential'
WIX_IST_TOKEN=
# Any random string; must match the value used when calling POST /sync
ADMIN_API_SECRET=
# Wix App public key (PEM). Used to verify signed webhook JWTs.
# Source: op item get 346mczoiqhbppe4x2sxsopbot4 --vault Automation --fields 'Public Key' --reveal
WIX_WEBHOOK_PUBLIC_KEY=
```

- [ ] **Step 6: Copy D1 database_id from rrm-academy-cf**

```bash
grep -A2 'rrm-auth' ~/iCode/projects/rrm-academy-cf/wrangler.toml | grep database_id
```

Copy the UUID value and replace `REPLACE_WITH_D1_ID_FROM_RRM_ACADEMY_CF_WRANGLER_TOML` in `wrangler.toml`.

- [ ] **Step 7: Write `README.md`**

```markdown
# rrm-wix-sync

Cloudflare Worker that syncs Wix donation data into D1 (rrm-auth) tables `wix_subscription` and `wix_payment`.

## What it does

- **Cron (every 6h):** Pulls new/updated eCom Orders from Wix, upserts into D1, derives subscription status.
- **HTTP `POST /sync`:** On-demand sync. Requires `?token=ADMIN_API_SECRET`. Accepts `?full=true` to bypass the incremental watermark (use for backfill).
- **HTTP `GET /health`:** Returns `{ ok, last_sync_at, active_subs, total_payments }`.

## Why

rrmacademy.org /account page pulls from Stripe only. Wix donors (the Save the Uterus Club) were invisible. This worker mirrors the data so downstream reads work.

## Deploy

```bash
wrangler secret put WIX_IST_TOKEN  # paste from op read 'op://Automation/<redacted>/credential'
wrangler secret put ADMIN_API_SECRET  # generate random
wrangler deploy
```

## One-time backfill

```bash
curl -X POST "https://rrm-wix-sync.administrator-cloudflare.workers.dev/sync?token=<ADMIN_API_SECRET>&full=true"
```

## Schema

See `schema.sql`. Applied to the existing `rrm-auth` D1 database — NOT a new database.

## Related

- Spec: `~/iCode/projects/rrm-academy-cf/docs/superpowers/specs/2026-04-24-wix-donations-sync-design.md`
- Plan: `~/iCode/projects/rrm-academy-cf/docs/superpowers/plans/2026-04-24-wix-donations-sync.md`
- Fishing reports: `/tmp/wix-fishing-report.md`
```

- [ ] **Step 8: Write `CLAUDE.md`**

```markdown
# rrm-wix-sync — Claude Reference

Worker that polls Wix eCom Orders → D1 (rrm-auth). Replaces the stub `rrm-finance-sync` for donation-account linkage.

## Quick Reference

- **Stack:** CF Worker + D1 + Wix eCom REST API
- **Cron:** every 6h (`0 */6 * * *`)
- **D1:** shares `rrm-auth` database with rrm-academy-cf
- **Tables owned:** `wix_subscription`, `wix_payment` (plus watermark row in `system_config`)
- **Secret source:** 1Password `Automation/wix.api.academy` (IST token)

## Coding rules

- `Authorization: <token>` goes bare (no `Bearer` prefix) — Wix IST token quirk.
- Every Wix API fetch MUST be wrapped in try/catch, return 503 on failure, log to AE.
- COLLATE NOCASE on every email comparison in SQL.
- Use `db.batch()` for multi-statement writes.
- No `INSERT OR REPLACE`; use `INSERT ... ON CONFLICT(pk) DO UPDATE`.
- Read sibling patterns from `~/iCode/projects/rrm-academy-cf/functions/api/` before modifying shared SQL patterns.

## Testing

Vitest unit tests for pure functions (tier derivation, status derivation, order→payment mapping). Wix client is mocked. Integration tests run against a local D1 fixture.
```

- [ ] **Step 9: Write empty `src/index.js` stub**

```javascript
export default {
  async fetch(request, env, ctx) {
    return new Response('not-implemented', { status: 501 });
  },
  async scheduled(event, env, ctx) {
    // implemented in task 7
  },
};
```

- [ ] **Step 10: Install dependencies**

```bash
cd ~/iCode/projects/rrm-wix-sync && npm install
```

Expected: `node_modules/` populated, `package-lock.json` created.

- [ ] **Step 11: Commit**

```bash
cd ~/iCode/projects/rrm-wix-sync
git add .
git commit -m "scaffold: rrm-wix-sync worker project"
```

---

### Task 2: D1 schema migration

**Files:**
- Create: `~/iCode/projects/rrm-wix-sync/schema.sql`

- [ ] **Step 1: Write schema file**

```sql
-- rrm-wix-sync schema
-- Applied to the existing rrm-auth D1 database (shared with rrm-academy-cf)
-- Idempotent: uses IF NOT EXISTS everywhere

CREATE TABLE IF NOT EXISTS wix_subscription (
  wix_subscription_id  TEXT PRIMARY KEY,
  user_id              TEXT,
  contact_id           TEXT NOT NULL,
  email                TEXT NOT NULL COLLATE NOCASE,
  first_name           TEXT,
  last_name            TEXT,
  tier                 TEXT NOT NULL,
  amount_cents         INTEGER NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'USD',
  frequency            TEXT NOT NULL DEFAULT 'MONTH',
  status               TEXT NOT NULL,
  started_at           TEXT NOT NULL,
  last_order_at        TEXT NOT NULL,
  next_expected_at     TEXT,
  cycle_count          INTEGER NOT NULL DEFAULT 0,
  auto_renewal         INTEGER NOT NULL DEFAULT 1,
  product_id           TEXT NOT NULL,
  product_source       TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wix_sub_email  ON wix_subscription(email);
CREATE INDEX IF NOT EXISTS idx_wix_sub_user   ON wix_subscription(user_id);
CREATE INDEX IF NOT EXISTS idx_wix_sub_status ON wix_subscription(status);

CREATE TABLE IF NOT EXISTS wix_payment (
  wix_order_id         TEXT PRIMARY KEY,
  wix_order_number     TEXT NOT NULL,
  wix_subscription_id  TEXT,
  user_id              TEXT,
  contact_id           TEXT NOT NULL,
  email                TEXT NOT NULL COLLATE NOCASE,
  amount_cents         INTEGER NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'USD',
  paid_at              TEXT NOT NULL,
  payment_status       TEXT NOT NULL,
  receipt_id           TEXT,
  receipt_number       TEXT,
  product_name         TEXT NOT NULL,
  product_id           TEXT NOT NULL,
  is_donation          INTEGER NOT NULL DEFAULT 0,
  cycle_number         INTEGER,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wix_pay_email   ON wix_payment(email);
CREATE INDEX IF NOT EXISTS idx_wix_pay_user    ON wix_payment(user_id);
CREATE INDEX IF NOT EXISTS idx_wix_pay_sub     ON wix_payment(wix_subscription_id);
CREATE INDEX IF NOT EXISTS idx_wix_pay_paid_at ON wix_payment(paid_at);

-- Watermark row in existing system_config table. If system_config doesn't exist yet, create it.
CREATE TABLE IF NOT EXISTS system_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Webhook event dedup. Wix may re-deliver an event on transient 5xx; this table prevents double-processing.
CREATE TABLE IF NOT EXISTS wix_webhook_event (
  event_id     TEXT PRIMARY KEY,           -- JWT jti or iat+eventType hash
  event_type   TEXT NOT NULL,              -- e.g. 'wix.ecom.v1.order_updated'
  entity_id    TEXT,                       -- order id or subscription id
  received_at  TEXT NOT NULL,
  processed    INTEGER NOT NULL DEFAULT 0, -- 0 = received, 1 = processed successfully
  status_code  INTEGER,                    -- HTTP status we returned (for debugging replays)
  detail       TEXT                        -- short error reason if processed=0
);
CREATE INDEX IF NOT EXISTS idx_wix_webhook_received ON wix_webhook_event(received_at);
```

- [ ] **Step 2: Verify schema applies cleanly to a local test DB**

```bash
cd ~/iCode/projects/rrm-wix-sync
sqlite3 /tmp/wix-sync-test.db < schema.sql
sqlite3 /tmp/wix-sync-test.db '.schema wix_subscription'
sqlite3 /tmp/wix-sync-test.db '.schema wix_payment'
sqlite3 /tmp/wix-sync-test.db '.indexes'
rm /tmp/wix-sync-test.db
```

Expected: both tables print, 7 indexes listed.

- [ ] **Step 3: Commit**

```bash
git add schema.sql
git commit -m "schema: wix_subscription + wix_payment tables"
```

---

### Task 3: Wix API client

**Files:**
- Create: `~/iCode/projects/rrm-wix-sync/src/wix-client.js`
- Create: `~/iCode/projects/rrm-wix-sync/tests/wix-client.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/wix-client.test.js
import { describe, it, expect, vi } from 'vitest';
import { createWixClient } from '../src/wix-client.js';

describe('createWixClient', () => {
  it('sends bare Authorization header (no Bearer)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ orders: [] }), { status: 200 }));
    const client = createWixClient({
      token: 'IST.abc',
      siteId: 'site-123',
      fetch: mockFetch,
    });
    await client.searchOrders({ limit: 10 });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://www.wixapis.com/ecom/v1/orders/search');
    expect(opts.headers['Authorization']).toBe('IST.abc');
    expect(opts.headers['wix-site-id']).toBe('site-123');
    expect(opts.method).toBe('POST');
  });

  it('throws WixApiError on non-2xx', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{"message":"bad"}', { status: 500 }));
    const client = createWixClient({ token: 't', siteId: 's', fetch: mockFetch });
    await expect(client.searchOrders({ limit: 10 })).rejects.toThrow(/wix_api_error/);
  });

  it('paginates via cursor', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        orders: [{ id: 'o1' }],
        metadata: { cursors: { next: 'cursor-abc' } },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        orders: [{ id: 'o2' }],
        metadata: { cursors: {} },
      }), { status: 200 }));
    const client = createWixClient({ token: 't', siteId: 's', fetch: mockFetch });
    const all = [];
    for await (const order of client.iterateOrders({})) all.push(order);
    expect(all.map(o => o.id)).toEqual(['o1', 'o2']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/iCode/projects/rrm-wix-sync && npx vitest run tests/wix-client.test.js
```

Expected: FAIL — cannot resolve `../src/wix-client.js`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/wix-client.js

const WIX_BASE = 'https://www.wixapis.com';

export class WixApiError extends Error {
  constructor(message, status, body) {
    super(`wix_api_error: ${message}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.token   - IST bearer token (bare, no "Bearer " prefix)
 * @param {string} opts.siteId  - Wix site ID
 * @param {typeof fetch} [opts.fetch] - Injected fetch for testing
 */
export function createWixClient({ token, siteId, fetch: fetchImpl = fetch }) {
  if (!token) throw new Error('wix_client_missing_token');
  if (!siteId) throw new Error('wix_client_missing_site_id');

  async function request(path, init = {}) {
    const headers = {
      'Authorization': token,
      'wix-site-id': siteId,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    };
    let res;
    try {
      res = await fetchImpl(`${WIX_BASE}${path}`, { ...init, headers });
    } catch (err) {
      throw new WixApiError(`network: ${err.message}`, 0, null);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new WixApiError(`${path} ${res.status}`, res.status, text.slice(0, 500));
    }
    return text ? JSON.parse(text) : {};
  }

  async function searchOrders({ limit = 100, cursor, filter } = {}) {
    const body = { search: { cursorPaging: { limit } } };
    if (cursor) body.search.cursorPaging.cursor = cursor;
    if (filter) body.search.filter = filter;
    return request('/ecom/v1/orders/search', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async function* iterateOrders(opts = {}) {
    let cursor;
    while (true) {
      const page = await searchOrders({ ...opts, cursor });
      const orders = page.orders || [];
      for (const o of orders) yield o;
      cursor = page.metadata?.cursors?.next;
      if (!cursor || orders.length === 0) break;
    }
  }

  async function queryContact(email) {
    const body = { query: { filter: { 'info.emails.email': email } } };
    return request('/contacts/v4/contacts/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async function queryPricingPlanOrders(planId) {
    const qs = new URLSearchParams({ 'paging.limit': '100', planIds: planId }).toString();
    return request(`/pricing-plans/v2/orders?${qs}`, { method: 'GET' });
  }

  return { searchOrders, iterateOrders, queryContact, queryPricingPlanOrders };
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd ~/iCode/projects/rrm-wix-sync && npx vitest run tests/wix-client.test.js
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/wix-client.js tests/wix-client.test.js
git commit -m "feat: Wix API client with cursor pagination + tests"
```

---

### Task 4: Tier derivation

**Files:**
- Create: `~/iCode/projects/rrm-wix-sync/src/tier.js`
- Create: `~/iCode/projects/rrm-wix-sync/tests/tier.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/tier.test.js
import { describe, it, expect } from 'vitest';
import { deriveTier } from '../src/tier.js';

describe('deriveTier', () => {
  it('reads tier from contact labels when present', () => {
    const labels = ['custom.uterus-super-hero', 'custom.donor'];
    expect(deriveTier({ labelKeys: labels, amountCents: 900 })).toBe('superhero');
  });

  it('prefers most-privileged label when multiple present', () => {
    const labels = ['custom.uterus-club-member', 'custom.uterus-hero'];
    expect(deriveTier({ labelKeys: labels, amountCents: 900 })).toBe('hero');
  });

  it('falls back to amount when no labels match', () => {
    expect(deriveTier({ labelKeys: [], amountCents: 9900 })).toBe('superhero');
    expect(deriveTier({ labelKeys: [], amountCents: 1900 })).toBe('hero');
    expect(deriveTier({ labelKeys: [], amountCents: 900 })).toBe('member');
    expect(deriveTier({ labelKeys: [], amountCents: 500 })).toBe('member');
  });

  it('handles missing labelKeys array', () => {
    expect(deriveTier({ amountCents: 900 })).toBe('member');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/tier.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/tier.js

const LABEL_TO_TIER = {
  'custom.uterus-super-hero': 'superhero',
  'custom.uterus-hero': 'hero',
  'custom.uterus-club-member': 'member',
};
const TIER_RANK = { member: 1, hero: 2, superhero: 3 };

export function deriveTier({ labelKeys = [], amountCents = 0 }) {
  let best = null;
  for (const key of (labelKeys || [])) {
    const t = LABEL_TO_TIER[key];
    if (t && (!best || TIER_RANK[t] > TIER_RANK[best])) best = t;
  }
  if (best) return best;
  if (amountCents >= 9900) return 'superhero';
  if (amountCents >= 1900) return 'hero';
  return 'member';
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run tests/tier.test.js
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/tier.js tests/tier.test.js
git commit -m "feat: tier derivation from Wix contact labels with amount fallback"
```

---

### Task 5: Status derivation

**Files:**
- Create: `~/iCode/projects/rrm-wix-sync/src/status.js`
- Create: `~/iCode/projects/rrm-wix-sync/tests/status.test.js`

The `autoRenewal` field is unreliable (always `true` even after cancel). Status is derived from cadence: active if last order is within frequency × grace-factor, else inactive.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/status.test.js
import { describe, it, expect } from 'vitest';
import { deriveStatus, nextExpectedAt } from '../src/status.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-04-24T00:00:00Z');

describe('deriveStatus', () => {
  it('active when last order is within 35 days (monthly)', () => {
    const lastOrder = new Date(now.getTime() - 20 * DAY).toISOString();
    expect(deriveStatus({ lastOrderAt: lastOrder, frequency: 'MONTH', now })).toBe('active');
  });

  it('inactive when last order is more than 35 days ago', () => {
    const lastOrder = new Date(now.getTime() - 40 * DAY).toISOString();
    expect(deriveStatus({ lastOrderAt: lastOrder, frequency: 'MONTH', now })).toBe('inactive');
  });

  it('active on boundary (exactly 35 days minus 1ms)', () => {
    const lastOrder = new Date(now.getTime() - 35 * DAY + 1).toISOString();
    expect(deriveStatus({ lastOrderAt: lastOrder, frequency: 'MONTH', now })).toBe('active');
  });

  it('weekly frequency uses 10-day grace', () => {
    const lastOrderFresh = new Date(now.getTime() - 9 * DAY).toISOString();
    const lastOrderStale = new Date(now.getTime() - 11 * DAY).toISOString();
    expect(deriveStatus({ lastOrderAt: lastOrderFresh, frequency: 'WEEK', now })).toBe('active');
    expect(deriveStatus({ lastOrderAt: lastOrderStale, frequency: 'WEEK', now })).toBe('inactive');
  });
});

describe('nextExpectedAt', () => {
  it('monthly adds 30 days', () => {
    const got = nextExpectedAt('2026-04-01T00:00:00Z', 'MONTH');
    expect(got).toBe('2026-05-01T00:00:00.000Z');
  });
  it('weekly adds 7 days', () => {
    const got = nextExpectedAt('2026-04-01T00:00:00Z', 'WEEK');
    expect(got).toBe('2026-04-08T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/status.test.js
```

Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/status.js

const DAY_MS = 24 * 60 * 60 * 1000;

// grace periods are last-order-to-now cutoffs before we call a sub inactive
const GRACE_DAYS = {
  MONTH: 35,   // 30-day cadence + 5-day grace
  WEEK: 10,    // 7-day cadence + 3-day grace
  YEAR: 400,   // 365-day cadence + 35-day grace
};

const CADENCE_DAYS = {
  MONTH: 30,
  WEEK: 7,
  YEAR: 365,
};

export function deriveStatus({ lastOrderAt, frequency = 'MONTH', now = new Date() }) {
  if (!lastOrderAt) return 'inactive';
  const cutoff = GRACE_DAYS[frequency] ?? GRACE_DAYS.MONTH;
  const last = new Date(lastOrderAt).getTime();
  const ref = now.getTime();
  return (ref - last) < cutoff * DAY_MS ? 'active' : 'inactive';
}

export function nextExpectedAt(lastOrderAt, frequency = 'MONTH') {
  if (!lastOrderAt) return null;
  const days = CADENCE_DAYS[frequency] ?? 30;
  return new Date(new Date(lastOrderAt).getTime() + days * DAY_MS).toISOString();
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run tests/status.test.js
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/status.js tests/status.test.js
git commit -m "feat: status + next-expected-at derivation from cadence"
```

---

### Task 5.5: Shared utility helpers

**Files:**
- Create: `~/iCode/projects/rrm-wix-sync/src/utils.js`
- Create: `~/iCode/projects/rrm-wix-sync/tests/utils.test.js`

Centralize helpers used by both `sync.js` and `webhook.js` so a bug fix in one place applies everywhere (honors the /arise "fix one, grep all" rule).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/utils.test.js
import { describe, it, expect } from 'vitest';
import { toCents, extractReceipt } from '../src/utils.js';

describe('toCents', () => {
  it('converts dollar string to integer cents', () => {
    expect(toCents('9')).toBe(900);
    expect(toCents('9.00')).toBe(900);
    expect(toCents('19.99')).toBe(1999);
    expect(toCents('125.5')).toBe(12550);
  });
  it('returns 0 for invalid input', () => {
    expect(toCents('abc')).toBe(0);
    expect(toCents('')).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
  });
});

describe('extractReceipt', () => {
  it('pulls receiptId + displayNumber from RECEIPT_CREATED', () => {
    const order = { activities: [
      { type: 'ORDER_PAID' },
      { type: 'RECEIPT_CREATED', receiptCreated: { wixReceipt: { receiptId: 'rid-1', displayNumber: '987317' } } },
    ]};
    expect(extractReceipt(order)).toEqual({ receipt_id: 'rid-1', receipt_number: '987317' });
  });
  it('falls back to RECEIPT_SENT if RECEIPT_CREATED missing', () => {
    const order = { activities: [
      { type: 'RECEIPT_SENT', receiptSent: { wixReceipt: { receiptId: 'rid-2', displayNumber: '111222' } } },
    ]};
    expect(extractReceipt(order)).toEqual({ receipt_id: 'rid-2', receipt_number: '111222' });
  });
  it('returns nulls when no receipt activities', () => {
    expect(extractReceipt({ activities: [] })).toEqual({ receipt_id: null, receipt_number: null });
    expect(extractReceipt({})).toEqual({ receipt_id: null, receipt_number: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/utils.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```javascript
// src/utils.js

export function toCents(amountStr) {
  const n = parseFloat(amountStr);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function extractReceipt(order) {
  const acts = order?.activities || [];
  for (const a of acts) {
    if (a.type === 'RECEIPT_CREATED' || a.type === 'RECEIPT_SENT') {
      const r = a.receiptCreated?.wixReceipt || a.receiptSent?.wixReceipt;
      if (r) return { receipt_id: r.receiptId || null, receipt_number: r.displayNumber || null };
    }
  }
  return { receipt_id: null, receipt_number: null };
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run tests/utils.test.js
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/utils.js tests/utils.test.js
git commit -m "feat: shared utils — toCents + extractReceipt"
```

---

### Task 6: Sync orchestration

**Files:**
- Create: `~/iCode/projects/rrm-wix-sync/src/sync.js`
- Create: `~/iCode/projects/rrm-wix-sync/tests/sync.test.js`

The sync function:
1. Iterates Wix orders (incremental via watermark, or full)
2. Upserts each into `wix_payment`
3. Groups by subscription id; for each group, computes aggregated fields and upserts `wix_subscription`
4. Separately queries legacy Pricing Plans orders (1 user)
5. Resolves tier via contact labels (1 contact query per unique contactId)
6. Links rows to user_id by email match

- [ ] **Step 1: Write the failing test**

```javascript
// tests/sync.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { runSync } from '../src/sync.js';

// Minimal in-memory D1 stand-in
function makeFakeDb() {
  const tables = { wix_payment: [], wix_subscription: [], user: [], system_config: [] };
  return {
    tables,
    prepare(sql) {
      return {
        sql,
        _binds: [],
        bind(...args) { this._binds = args; return this; },
        async run() {
          // minimal parse: support INSERT OR REPLACE / ON CONFLICT upserts + UPDATE for linking
          if (/INSERT INTO wix_payment/.test(sql)) {
            const row = mapBindsToPayment(this._binds);
            const i = tables.wix_payment.findIndex(r => r.wix_order_id === row.wix_order_id);
            if (i >= 0) tables.wix_payment[i] = row; else tables.wix_payment.push(row);
          } else if (/INSERT INTO wix_subscription/.test(sql)) {
            const row = mapBindsToSubscription(this._binds);
            const i = tables.wix_subscription.findIndex(r => r.wix_subscription_id === row.wix_subscription_id);
            if (i >= 0) tables.wix_subscription[i] = row; else tables.wix_subscription.push(row);
          } else if (/UPDATE wix_subscription SET user_id/.test(sql)) {
            for (const row of tables.wix_subscription) {
              const user = tables.user.find(u => u.email.toLowerCase() === row.email.toLowerCase());
              if (user) row.user_id = user.id;
            }
          } else if (/UPDATE wix_payment SET user_id/.test(sql)) {
            for (const row of tables.wix_payment) {
              const user = tables.user.find(u => u.email.toLowerCase() === row.email.toLowerCase());
              if (user) row.user_id = user.id;
            }
          } else if (/INSERT INTO system_config/.test(sql)) {
            const [key, value, updated_at] = this._binds;
            const i = tables.system_config.findIndex(r => r.key === key);
            if (i >= 0) tables.system_config[i] = { key, value, updated_at };
            else tables.system_config.push({ key, value, updated_at });
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          if (/FROM system_config WHERE key/.test(sql)) {
            const [key] = this._binds;
            return tables.system_config.find(r => r.key === key) || null;
          }
          return null;
        },
        async all() { return { results: [] }; },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); return []; },
  };
}

function mapBindsToPayment(b) {
  return {
    wix_order_id: b[0], wix_order_number: b[1], wix_subscription_id: b[2],
    contact_id: b[3], email: b[4], amount_cents: b[5], currency: b[6],
    paid_at: b[7], payment_status: b[8], receipt_id: b[9], receipt_number: b[10],
    product_name: b[11], product_id: b[12], is_donation: b[13], cycle_number: b[14],
    updated_at: b[15], user_id: null,
  };
}
function mapBindsToSubscription(b) {
  return {
    wix_subscription_id: b[0], contact_id: b[1], email: b[2], first_name: b[3],
    last_name: b[4], tier: b[5], amount_cents: b[6], currency: b[7],
    frequency: b[8], status: b[9], started_at: b[10], last_order_at: b[11],
    next_expected_at: b[12], cycle_count: b[13], auto_renewal: b[14],
    product_id: b[15], product_source: b[16], updated_at: b[17], user_id: null,
  };
}

function makeFakeWixClient(orders, contactLabels = {}) {
  return {
    async *iterateOrders() { for (const o of orders) yield o; },
    async queryContact(email) {
      return { contacts: [{ info: { labelKeys: { items: contactLabels[email] || [] } } }] };
    },
    async queryPricingPlanOrders() { return { orders: [] }; },
  };
}

const victoriaOrder = (cycle, date) => ({
  id: `order-${cycle}`,
  number: String(10000 + cycle),
  createdDate: date,
  purchasedDate: date,
  paymentStatus: 'PAID',
  currency: 'USD',
  buyerInfo: { contactId: 'contact-victoria', email: 'vjgbergin@gmail.com' },
  billingInfo: { contactDetails: { firstName: 'Victoria', lastName: 'Bergin' } },
  priceSummary: { total: { amount: '9' } },
  lineItems: [{
    productName: { original: 'Save the Uterus Club Membership' },
    catalogReference: {
      catalogItemId: 'f62015ec-5618-4508-9846-eadeb2a454d0',
      options: { amount: 9.0, frequency: 'MONTH' },
    },
    itemType: { custom: 'DONATION' },
    price: { amount: '9' },
    subscriptionInfo: {
      id: 'sub-victoria',
      cycleNumber: cycle,
      subscriptionSettings: { frequency: 'MONTH', interval: 1, autoRenewal: true },
    },
  }],
  activities: [],
});

describe('runSync', () => {
  let db;
  beforeEach(() => {
    db = makeFakeDb();
    db.tables.user.push({ id: 'user-vb', email: 'vjgbergin@gmail.com' });
  });

  it('upserts payment + derives subscription from grouped orders', async () => {
    const orders = [
      victoriaOrder(1, '2025-09-23T00:00:00Z'),
      victoriaOrder(8, '2026-04-23T00:00:00Z'),
    ];
    const wix = makeFakeWixClient(orders, {
      'vjgbergin@gmail.com': ['custom.uterus-club-member'],
    });

    const res = await runSync({ db, wix, now: new Date('2026-04-24T00:00:00Z') });

    expect(res.ordersUpserted).toBe(2);
    expect(res.subsUpserted).toBe(1);
    expect(db.tables.wix_payment).toHaveLength(2);

    const sub = db.tables.wix_subscription[0];
    expect(sub.wix_subscription_id).toBe('sub-victoria');
    expect(sub.email).toBe('vjgbergin@gmail.com');
    expect(sub.tier).toBe('member');
    expect(sub.amount_cents).toBe(900);
    expect(sub.cycle_count).toBe(8);
    expect(sub.started_at).toBe('2025-09-23T00:00:00Z');
    expect(sub.last_order_at).toBe('2026-04-23T00:00:00Z');
    expect(sub.status).toBe('active');
    expect(sub.user_id).toBe('user-vb');
  });

  it('marks sub inactive when last order is stale', async () => {
    const orders = [victoriaOrder(1, '2026-01-01T00:00:00Z')]; // 113 days ago
    const wix = makeFakeWixClient(orders);
    await runSync({ db, wix, now: new Date('2026-04-24T00:00:00Z') });
    expect(db.tables.wix_subscription[0].status).toBe('inactive');
  });

  it('handles one-off donations (no subscriptionInfo)', async () => {
    const oneOff = {
      id: 'order-one-off',
      number: '10003',
      createdDate: '2024-12-31T00:00:00Z',
      purchasedDate: '2024-12-31T00:00:00Z',
      paymentStatus: 'PAID',
      currency: 'USD',
      buyerInfo: { contactId: 'contact-x', email: 'x@example.com' },
      billingInfo: { contactDetails: { firstName: 'X', lastName: 'Y' } },
      priceSummary: { total: { amount: '125' } },
      lineItems: [{
        productName: { original: 'For true healing' },
        catalogReference: { catalogItemId: 'ace73f61', options: { amount: 125, frequency: 'ONE_TIME' } },
        itemType: { custom: 'DONATION' },
        price: { amount: '125' },
      }],
      activities: [],
    };
    const wix = makeFakeWixClient([oneOff]);
    const res = await runSync({ db, wix, now: new Date('2026-04-24T00:00:00Z') });
    expect(res.ordersUpserted).toBe(1);
    expect(res.subsUpserted).toBe(0);
    expect(db.tables.wix_payment[0].wix_subscription_id).toBeNull();
    expect(db.tables.wix_payment[0].is_donation).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/sync.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```javascript
// src/sync.js
import { deriveTier } from './tier.js';
import { deriveStatus, nextExpectedAt } from './status.js';
import { toCents, extractReceipt } from './utils.js';

function mapOrderToPayment(order, nowIso) {
  const line = order.lineItems?.[0] || {};
  const sub = line.subscriptionInfo;
  const receipt = extractReceipt(order);
  const isDonation = line.itemType?.custom === 'DONATION' ? 1 : 0;
  const paidAt = order.purchasedDate || order.createdDate;
  return {
    wix_order_id: order.id,
    wix_order_number: String(order.number || ''),
    wix_subscription_id: sub?.id || null,
    contact_id: order.buyerInfo?.contactId || '',
    email: order.buyerInfo?.email || '',
    amount_cents: toCents(order.priceSummary?.total?.amount),
    currency: order.currency || 'USD',
    paid_at: paidAt,
    payment_status: order.paymentStatus || 'UNKNOWN',
    receipt_id: receipt.receipt_id,
    receipt_number: receipt.receipt_number,
    product_name: line.productName?.original || '',
    product_id: line.catalogReference?.catalogItemId || '',
    is_donation: isDonation,
    cycle_number: sub?.cycleNumber ?? null,
    updated_at: nowIso,
  };
}

async function upsertPayment(db, p) {
  return db.prepare(`
    INSERT INTO wix_payment (
      wix_order_id, wix_order_number, wix_subscription_id, contact_id, email,
      amount_cents, currency, paid_at, payment_status, receipt_id, receipt_number,
      product_name, product_id, is_donation, cycle_number, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wix_order_id) DO UPDATE SET
      wix_order_number = excluded.wix_order_number,
      wix_subscription_id = excluded.wix_subscription_id,
      contact_id = excluded.contact_id,
      email = excluded.email,
      amount_cents = excluded.amount_cents,
      currency = excluded.currency,
      paid_at = excluded.paid_at,
      payment_status = excluded.payment_status,
      receipt_id = excluded.receipt_id,
      receipt_number = excluded.receipt_number,
      product_name = excluded.product_name,
      product_id = excluded.product_id,
      is_donation = excluded.is_donation,
      cycle_number = excluded.cycle_number,
      updated_at = excluded.updated_at
  `).bind(
    p.wix_order_id, p.wix_order_number, p.wix_subscription_id, p.contact_id, p.email,
    p.amount_cents, p.currency, p.paid_at, p.payment_status, p.receipt_id, p.receipt_number,
    p.product_name, p.product_id, p.is_donation, p.cycle_number, p.updated_at
  ).run();
}

async function upsertSubscription(db, s) {
  return db.prepare(`
    INSERT INTO wix_subscription (
      wix_subscription_id, contact_id, email, first_name, last_name, tier,
      amount_cents, currency, frequency, status, started_at, last_order_at,
      next_expected_at, cycle_count, auto_renewal, product_id, product_source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wix_subscription_id) DO UPDATE SET
      contact_id = excluded.contact_id,
      email = excluded.email,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      tier = excluded.tier,
      amount_cents = excluded.amount_cents,
      currency = excluded.currency,
      frequency = excluded.frequency,
      status = excluded.status,
      started_at = excluded.started_at,
      last_order_at = excluded.last_order_at,
      next_expected_at = excluded.next_expected_at,
      cycle_count = excluded.cycle_count,
      auto_renewal = excluded.auto_renewal,
      product_id = excluded.product_id,
      product_source = excluded.product_source,
      updated_at = excluded.updated_at
  `).bind(
    s.wix_subscription_id, s.contact_id, s.email, s.first_name, s.last_name, s.tier,
    s.amount_cents, s.currency, s.frequency, s.status, s.started_at, s.last_order_at,
    s.next_expected_at, s.cycle_count, s.auto_renewal, s.product_id, s.product_source, s.updated_at
  ).run();
}

async function linkUserIds(db) {
  await db.prepare(`
    UPDATE wix_subscription SET user_id = (
      SELECT id FROM user WHERE email = wix_subscription.email COLLATE NOCASE
    ) WHERE user_id IS NULL
  `).run();
  await db.prepare(`
    UPDATE wix_payment SET user_id = (
      SELECT id FROM user WHERE email = wix_payment.email COLLATE NOCASE
    ) WHERE user_id IS NULL
  `).run();
}

async function fetchLabelCache(wix, contactIds, orders) {
  // cache by email (labels come from contact-by-email query)
  const byEmail = new Map();
  const emails = new Set();
  for (const o of orders) {
    const e = o.buyerInfo?.email;
    if (e) emails.add(e);
  }
  for (const email of emails) {
    try {
      const res = await wix.queryContact(email);
      const labels = res.contacts?.[0]?.info?.labelKeys?.items || [];
      byEmail.set(email, labels);
    } catch {
      byEmail.set(email, []);
    }
  }
  return byEmail;
}

export async function runSync({ db, wix, now = new Date(), full = false }) {
  const nowIso = now.toISOString();
  const watermark = full ? null : await readWatermark(db);

  // 1. Collect all orders (with watermark filter if incremental)
  const orders = [];
  for await (const o of wix.iterateOrders(watermark ? { filter: { createdDate: { $gte: watermark } } } : {})) {
    orders.push(o);
  }

  // 2. Build label cache per unique email (one contact query each)
  const labelsByEmail = await fetchLabelCache(wix, null, orders);

  // 3. Upsert payments
  let ordersUpserted = 0;
  for (const o of orders) {
    const p = mapOrderToPayment(o, nowIso);
    if (!p.wix_order_id) continue;
    await upsertPayment(db, p);
    ordersUpserted++;
  }

  // 4. Group by subscription id, aggregate, upsert subscription rows
  const bySubId = new Map();
  for (const o of orders) {
    const sub = o.lineItems?.[0]?.subscriptionInfo;
    if (!sub?.id) continue;
    const list = bySubId.get(sub.id) || [];
    list.push(o);
    bySubId.set(sub.id, list);
  }

  let subsUpserted = 0;
  for (const [subId, group] of bySubId) {
    group.sort((a, b) => new Date(a.purchasedDate || a.createdDate) - new Date(b.purchasedDate || b.createdDate));
    const first = group[0];
    const last = group[group.length - 1];
    const line = last.lineItems[0];
    const subInfo = line.subscriptionInfo;
    const email = last.buyerInfo?.email || '';
    const labels = labelsByEmail.get(email) || [];
    const amountCents = toCents(last.priceSummary?.total?.amount);
    const tier = deriveTier({ labelKeys: labels, amountCents });
    const frequency = subInfo.subscriptionSettings?.frequency || 'MONTH';
    const lastOrderAt = last.purchasedDate || last.createdDate;
    const status = deriveStatus({ lastOrderAt, frequency, now });

    await upsertSubscription(db, {
      wix_subscription_id: subId,
      contact_id: last.buyerInfo?.contactId || '',
      email,
      first_name: last.billingInfo?.contactDetails?.firstName || null,
      last_name: last.billingInfo?.contactDetails?.lastName || null,
      tier,
      amount_cents: amountCents,
      currency: last.currency || 'USD',
      frequency,
      status,
      started_at: first.purchasedDate || first.createdDate,
      last_order_at: lastOrderAt,
      next_expected_at: nextExpectedAt(lastOrderAt, frequency),
      cycle_count: Math.max(...group.map(g => g.lineItems[0].subscriptionInfo?.cycleNumber ?? 0)),
      auto_renewal: subInfo.subscriptionSettings?.autoRenewal ? 1 : 0,
      product_id: line.catalogReference?.catalogItemId || '',
      product_source: 'stores',
      updated_at: nowIso,
    });
    subsUpserted++;
  }

  // 5. Legacy Pricing Plans — handle separately
  try {
    const pp = await wix.queryPricingPlanOrders('0b5b8754-c649-4c10-b648-025499f3b175');
    for (const o of (pp.orders || [])) {
      const status = (o.status === 'ACTIVE') ? 'active' : 'inactive';
      const email = o.buyer?.email || '';
      const labels = labelsByEmail.get(email) || [];
      const amountCents = toCents(o.pricing?.subtotal?.amount || '0');
      await upsertSubscription(db, {
        wix_subscription_id: `pp-${o.id}`,
        contact_id: o.buyer?.contactId || '',
        email,
        first_name: null,
        last_name: null,
        tier: deriveTier({ labelKeys: labels, amountCents }),
        amount_cents: amountCents,
        currency: o.currency || 'USD',
        frequency: 'MONTH',
        status,
        started_at: o.startDate || nowIso,
        last_order_at: o.cycles?.[o.cycles.length - 1]?.startedAt || o.startDate || nowIso,
        next_expected_at: o.endDate || null,
        cycle_count: o.cycles?.length || 0,
        auto_renewal: 1,
        product_id: o.planId || '',
        product_source: 'pricing-plans',
        updated_at: nowIso,
      });
      subsUpserted++;
    }
  } catch {
    // legacy endpoint optional; don't fail the whole sync
  }

  // 6. Link user_ids by email
  await linkUserIds(db);

  // 7. Advance watermark
  if (orders.length > 0) {
    const newest = orders.reduce((m, o) => {
      const d = o.createdDate;
      return (!m || d > m) ? d : m;
    }, null);
    await writeWatermark(db, newest, nowIso);
  }

  return { ordersSeen: orders.length, ordersUpserted, subsUpserted };
}

async function readWatermark(db) {
  const row = await db.prepare(
    `SELECT value FROM system_config WHERE key = 'wix_sync_watermark' LIMIT 1`
  ).first();
  return row?.value || null;
}

async function writeWatermark(db, watermark, nowIso) {
  await db.prepare(`
    INSERT INTO system_config (key, value, updated_at)
    VALUES ('wix_sync_watermark', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(watermark, nowIso).run();
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run tests/sync.test.js
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/sync.js tests/sync.test.js
git commit -m "feat: sync orchestration — orders → payments → subscriptions + user linking"
```

---

### Task 6b: Webhook signature verifier

**Files:**
- Create: `~/iCode/projects/rrm-wix-sync/src/webhook-verify.js`
- Create: `~/iCode/projects/rrm-wix-sync/tests/webhook-verify.test.js`

Wix sends webhooks as RS256-signed JWTs. We verify against the Wix App public key (PEM in env). Uses WebCrypto — no external crypto libraries. Rejects expired tokens and bad signatures.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/webhook-verify.test.js
import { describe, it, expect, vi } from 'vitest';
import { verifyWixWebhook } from '../src/webhook-verify.js';

// Generate a test keypair + signed JWT for each test
async function generateKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function exportSpkiPem(publicKey) {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
  const lines = b64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

async function signToken(privateKey, payload) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const encHeader = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

describe('verifyWixWebhook', () => {
  it('verifies a valid RS256 JWT', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const pem = await exportSpkiPem(publicKey);
    const payload = { iat: Math.floor(Date.now() / 1000), data: { order: 'o1' } };
    const jwt = await signToken(privateKey, payload);
    const result = await verifyWixWebhook(jwt, pem);
    expect(result.valid).toBe(true);
    expect(result.payload.data.order).toBe('o1');
  });

  it('rejects tampered signature', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const pem = await exportSpkiPem(publicKey);
    const jwt = await signToken(privateKey, { iat: 0 });
    const [h, p] = jwt.split('.');
    const tampered = `${h}.${p}.AAAA`;
    const result = await verifyWixWebhook(tampered, pem);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature/);
  });

  it('rejects malformed JWT (not 3 parts)', async () => {
    const result = await verifyWixWebhook('not.ajwt', 'pem');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/format/);
  });

  it('rejects when alg is not RS256', async () => {
    const headerBad = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ iat: 0 })));
    const jwt = `${headerBad}.${payload}.sig`;
    const result = await verifyWixWebhook(jwt, '-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/alg/);
  });

  it('rejects stale events (iat older than 5 minutes)', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const pem = await exportSpkiPem(publicKey);
    const oldIat = Math.floor(Date.now() / 1000) - 400;
    const jwt = await signToken(privateKey, { iat: oldIat, data: {} });
    const result = await verifyWixWebhook(jwt, pem, { maxAgeSec: 300 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/stale/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/iCode/projects/rrm-wix-sync && npx vitest run tests/webhook-verify.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```javascript
// src/webhook-verify.js

function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - str.length % 4) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pemToBinary(pem) {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Verify a Wix webhook JWT signed RS256 against a PEM-formatted public key.
 * @returns {Promise<{valid: boolean, payload?: object, reason?: string}>}
 */
export async function verifyWixWebhook(jwt, publicKeyPem, { maxAgeSec = 300 } = {}) {
  if (typeof jwt !== 'string') return { valid: false, reason: 'format: not-string' };
  const parts = jwt.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'format: not-three-parts' };

  const [encHeader, encPayload, encSig] = parts;
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(encHeader)));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(encPayload)));
  } catch (err) {
    return { valid: false, reason: `format: ${err.message}` };
  }

  if (header.alg !== 'RS256') return { valid: false, reason: `alg: expected RS256, got ${header.alg}` };

  let key;
  try {
    key = await crypto.subtle.importKey(
      'spki',
      pemToBinary(publicKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch (err) {
    return { valid: false, reason: `key: ${err.message}` };
  }

  const signingInput = new TextEncoder().encode(`${encHeader}.${encPayload}`);
  const sig = b64urlDecode(encSig);
  let ok;
  try {
    ok = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, sig, signingInput);
  } catch (err) {
    return { valid: false, reason: `signature: ${err.message}` };
  }
  if (!ok) return { valid: false, reason: 'signature: mismatch' };

  if (payload.iat && maxAgeSec > 0) {
    const age = Math.floor(Date.now() / 1000) - payload.iat;
    if (age > maxAgeSec) return { valid: false, reason: `stale: age=${age}s` };
  }

  return { valid: true, payload };
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run tests/webhook-verify.test.js
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/webhook-verify.js tests/webhook-verify.test.js
git commit -m "feat: RS256 JWT verifier for Wix webhooks (WebCrypto, no deps)"
```

---

### Task 6c: Webhook handler

**Files:**
- Create: `~/iCode/projects/rrm-wix-sync/src/webhook.js`
- Create: `~/iCode/projects/rrm-wix-sync/tests/webhook.test.js`

The handler:
1. Reads raw body, extracts JWT (Wix posts JWT as the body directly — confirm on first real delivery)
2. Verifies signature
3. Dedup: check `wix_webhook_event` table by event id
4. Routes event type → handler (order created/updated/paid, subscription canceled, etc.)
5. For order events: fetch full order via Wix API and upsert (reuse Task 6 sync logic for a single order)
6. Records event as processed

- [ ] **Step 1: Write the failing test**

```javascript
// tests/webhook.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWebhook } from '../src/webhook.js';

function makeFakeDb() {
  const events = [];
  const payments = [];
  return {
    events, payments,
    prepare(sql) {
      return {
        sql,
        _binds: [],
        bind(...args) { this._binds = args; return this; },
        async run() {
          if (/INSERT INTO wix_webhook_event/.test(sql)) {
            events.push({
              event_id: this._binds[0], event_type: this._binds[1],
              entity_id: this._binds[2], received_at: this._binds[3],
              processed: this._binds[4], status_code: this._binds[5], detail: this._binds[6],
            });
          } else if (/UPDATE wix_webhook_event SET processed/.test(sql)) {
            const ev = events.find(e => e.event_id === this._binds[3]);
            if (ev) { ev.processed = this._binds[0]; ev.status_code = this._binds[1]; ev.detail = this._binds[2]; }
          } else if (/INSERT INTO wix_payment/.test(sql)) {
            payments.push({ wix_order_id: this._binds[0], email: this._binds[4] });
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          if (/FROM wix_webhook_event WHERE event_id/.test(sql)) {
            const [id] = this._binds;
            return events.find(e => e.event_id === id) || null;
          }
          return null;
        },
      };
    },
    async batch(stmts) { for (const s of stmts) await s.run(); return []; },
  };
}

const mockVerify = (valid, payload, reason) => vi.fn().mockResolvedValue({ valid, payload, reason });

describe('handleWebhook', () => {
  let db;
  beforeEach(() => { db = makeFakeDb(); });

  it('rejects invalid signature with 401', async () => {
    const res = await handleWebhook({
      body: 'jwt.string.here',
      db,
      publicKey: 'pem',
      wix: null,
      verify: mockVerify(false, null, 'signature: mismatch'),
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/signature/);
  });

  it('dedupes repeat event by jti', async () => {
    const verify = mockVerify(true, {
      jti: 'event-abc', iat: Math.floor(Date.now()/1000),
      data: { eventType: 'wix.ecom.v1.order_updated', entityId: 'order-1', payload: {} },
    });
    db.events.push({ event_id: 'event-abc', processed: 1, event_type: 'x', received_at: 'now', status_code: 200 });

    const res = await handleWebhook({
      body: 'jwt', db, publicKey: 'pem', wix: null, verify,
    });
    expect(res.status).toBe(200);
    expect(res.body.deduped).toBe(true);
    expect(db.payments).toHaveLength(0);
  });

  it('processes order_updated by fetching full order and upserting', async () => {
    const order = {
      id: 'order-42', number: '10099', createdDate: '2026-04-24T00:00:00Z',
      purchasedDate: '2026-04-24T00:00:00Z', paymentStatus: 'PAID', currency: 'USD',
      buyerInfo: { contactId: 'c1', email: 'vjgbergin@gmail.com' },
      billingInfo: { contactDetails: { firstName: 'V', lastName: 'B' } },
      priceSummary: { total: { amount: '9' } },
      lineItems: [{
        productName: { original: 'STUC' },
        catalogReference: { catalogItemId: 'prod', options: { amount: 9, frequency: 'MONTH' } },
        itemType: { custom: 'DONATION' },
        price: { amount: '9' },
        subscriptionInfo: { id: 'sub-1', cycleNumber: 3, subscriptionSettings: { frequency: 'MONTH', autoRenewal: true } },
      }],
      activities: [],
    };
    const wix = {
      getOrder: vi.fn().mockResolvedValue(order),
      queryContact: vi.fn().mockResolvedValue({ contacts: [{ info: { labelKeys: { items: [] } } }] }),
    };
    const verify = mockVerify(true, {
      jti: 'event-42', iat: Math.floor(Date.now()/1000),
      data: { eventType: 'wix.ecom.v1.order_updated', entityId: 'order-42', payload: {} },
    });

    const res = await handleWebhook({ body: 'jwt', db, publicKey: 'pem', wix, verify });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(true);
    expect(wix.getOrder).toHaveBeenCalledWith('order-42');
    expect(db.payments).toHaveLength(1);
    expect(db.payments[0].wix_order_id).toBe('order-42');

    const ev = db.events.find(e => e.event_id === 'event-42');
    expect(ev.processed).toBe(1);
  });

  it('returns 500 on handler error and records unprocessed event', async () => {
    const wix = {
      getOrder: vi.fn().mockRejectedValue(new Error('wix down')),
      queryContact: vi.fn(),
    };
    const verify = mockVerify(true, {
      jti: 'event-err', iat: Math.floor(Date.now()/1000),
      data: { eventType: 'wix.ecom.v1.order_updated', entityId: 'order-X', payload: {} },
    });

    const res = await handleWebhook({ body: 'jwt', db, publicKey: 'pem', wix, verify });
    expect(res.status).toBe(500);
    const ev = db.events.find(e => e.event_id === 'event-err');
    expect(ev.processed).toBe(0);
    expect(ev.detail).toMatch(/wix down/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/webhook.test.js
```

Expected: FAIL.

- [ ] **Step 3: Extend wix-client.js with getOrder helper**

Add this to `src/wix-client.js` (inside `createWixClient`, before the return):

```javascript
  async function getOrder(orderId) {
    return request(`/ecom/v1/orders/${orderId}`, { method: 'GET' });
  }
```

Add `getOrder` to the returned object:

```javascript
  return { searchOrders, iterateOrders, queryContact, queryPricingPlanOrders, getOrder };
```

- [ ] **Step 4: Write webhook handler implementation**

```javascript
// src/webhook.js
import { verifyWixWebhook } from './webhook-verify.js';
import { deriveTier } from './tier.js';
import { deriveStatus, nextExpectedAt } from './status.js';
import { toCents, extractReceipt } from './utils.js';

async function upsertOrderAndSub(db, wix, order, nowIso) {
  const line = order.lineItems?.[0] || {};
  const sub = line.subscriptionInfo;
  const receipt = extractReceipt(order);
  const email = order.buyerInfo?.email || '';
  const paidAt = order.purchasedDate || order.createdDate;
  const amountCents = toCents(order.priceSummary?.total?.amount);

  // Upsert payment
  await db.prepare(`
    INSERT INTO wix_payment (
      wix_order_id, wix_order_number, wix_subscription_id, contact_id, email,
      amount_cents, currency, paid_at, payment_status, receipt_id, receipt_number,
      product_name, product_id, is_donation, cycle_number, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wix_order_id) DO UPDATE SET
      wix_order_number = excluded.wix_order_number,
      wix_subscription_id = excluded.wix_subscription_id,
      contact_id = excluded.contact_id,
      email = excluded.email,
      amount_cents = excluded.amount_cents,
      currency = excluded.currency,
      paid_at = excluded.paid_at,
      payment_status = excluded.payment_status,
      receipt_id = excluded.receipt_id,
      receipt_number = excluded.receipt_number,
      product_name = excluded.product_name,
      product_id = excluded.product_id,
      is_donation = excluded.is_donation,
      cycle_number = excluded.cycle_number,
      updated_at = excluded.updated_at
  `).bind(
    order.id,
    String(order.number || ''),
    sub?.id || null,
    order.buyerInfo?.contactId || '',
    email,
    amountCents,
    order.currency || 'USD',
    paidAt,
    order.paymentStatus || 'UNKNOWN',
    receipt.receipt_id,
    receipt.receipt_number,
    line.productName?.original || '',
    line.catalogReference?.catalogItemId || '',
    line.itemType?.custom === 'DONATION' ? 1 : 0,
    sub?.cycleNumber ?? null,
    nowIso
  ).run();

  // If there's a subscription, re-derive the sub row
  if (sub?.id) {
    // Fetch tier via contact labels (one API call)
    let labels = [];
    try {
      const cr = await wix.queryContact(email);
      labels = cr.contacts?.[0]?.info?.labelKeys?.items || [];
    } catch {}

    const tier = deriveTier({ labelKeys: labels, amountCents });
    const frequency = sub.subscriptionSettings?.frequency || 'MONTH';

    // Look up existing sub row for started_at + cycle_count (don't lose history)
    const existing = await db.prepare(
      `SELECT started_at, cycle_count FROM wix_subscription WHERE wix_subscription_id = ? LIMIT 1`
    ).bind(sub.id).first();

    const startedAt = existing?.started_at || paidAt;
    const cycleCount = Math.max(existing?.cycle_count || 0, sub.cycleNumber ?? 0);
    const status = deriveStatus({ lastOrderAt: paidAt, frequency, now: new Date(nowIso) });

    await db.prepare(`
      INSERT INTO wix_subscription (
        wix_subscription_id, contact_id, email, first_name, last_name, tier,
        amount_cents, currency, frequency, status, started_at, last_order_at,
        next_expected_at, cycle_count, auto_renewal, product_id, product_source, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(wix_subscription_id) DO UPDATE SET
        contact_id = excluded.contact_id,
        email = excluded.email,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        tier = excluded.tier,
        amount_cents = excluded.amount_cents,
        currency = excluded.currency,
        frequency = excluded.frequency,
        status = excluded.status,
        last_order_at = excluded.last_order_at,
        next_expected_at = excluded.next_expected_at,
        cycle_count = excluded.cycle_count,
        auto_renewal = excluded.auto_renewal,
        updated_at = excluded.updated_at
    `).bind(
      sub.id,
      order.buyerInfo?.contactId || '',
      email,
      order.billingInfo?.contactDetails?.firstName || null,
      order.billingInfo?.contactDetails?.lastName || null,
      tier,
      amountCents,
      order.currency || 'USD',
      frequency,
      status,
      startedAt,
      paidAt,
      nextExpectedAt(paidAt, frequency),
      cycleCount,
      sub.subscriptionSettings?.autoRenewal ? 1 : 0,
      line.catalogReference?.catalogItemId || '',
      'stores',
      nowIso
    ).run();
  }

  // Link user_id by email
  await db.prepare(
    `UPDATE wix_payment SET user_id = (SELECT id FROM user WHERE email = wix_payment.email COLLATE NOCASE) WHERE wix_order_id = ? AND user_id IS NULL`
  ).bind(order.id).run();
  if (sub?.id) {
    await db.prepare(
      `UPDATE wix_subscription SET user_id = (SELECT id FROM user WHERE email = wix_subscription.email COLLATE NOCASE) WHERE wix_subscription_id = ? AND user_id IS NULL`
    ).bind(sub.id).run();
  }
}

/**
 * @param {object} args
 * @param {string} args.body - raw request body (JWT string)
 * @param {D1Database} args.db
 * @param {string} args.publicKey - PEM
 * @param {object} args.wix - Wix client (with getOrder, queryContact)
 * @param {Function} [args.verify] - verify fn, for testing
 * @returns {Promise<{status: number, body: object}>}
 */
export async function handleWebhook({ body, db, publicKey, wix, verify = verifyWixWebhook }) {
  const nowIso = new Date().toISOString();
  const jwt = (body || '').trim();

  const result = await verify(jwt, publicKey);
  if (!result.valid) {
    return { status: 401, body: { ok: false, error: `invalid_signature: ${result.reason}` } };
  }
  const p = result.payload || {};
  const eventId = p.jti || `${p.iat || 0}-${p.data?.eventType || 'x'}-${p.data?.entityId || 'x'}`;
  const eventType = p.data?.eventType || 'unknown';
  const entityId = p.data?.entityId || null;

  // Dedup
  const existing = await db.prepare(
    `SELECT processed FROM wix_webhook_event WHERE event_id = ? LIMIT 1`
  ).bind(eventId).first();
  if (existing && existing.processed === 1) {
    return { status: 200, body: { ok: true, deduped: true, eventId } };
  }

  // Record receipt (processed=0)
  await db.prepare(`
    INSERT INTO wix_webhook_event (event_id, event_type, entity_id, received_at, processed, status_code, detail)
    VALUES (?, ?, ?, ?, 0, NULL, NULL)
    ON CONFLICT(event_id) DO UPDATE SET received_at = excluded.received_at
  `).bind(eventId, eventType, entityId, nowIso).run();

  try {
    // Only handle order-related events; ignore everything else for now
    if (/order_/.test(eventType) && entityId) {
      const order = await wix.getOrder(entityId);
      if (order?.id) await upsertOrderAndSub(db, wix, order, nowIso);
    }
    // Other event types fall through and are recorded as processed=1 with no side effect

    await db.prepare(
      `UPDATE wix_webhook_event SET processed = ?, status_code = ?, detail = ? WHERE event_id = ?`
    ).bind(1, 200, null, eventId).run();
    return { status: 200, body: { ok: true, processed: true, eventId, eventType } };
  } catch (err) {
    await db.prepare(
      `UPDATE wix_webhook_event SET processed = ?, status_code = ?, detail = ? WHERE event_id = ?`
    ).bind(0, 500, String(err.message || err).slice(0, 500), eventId).run();
    return { status: 500, body: { ok: false, error: 'handler_failed', eventId } };
  }
}
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
npx vitest run tests/webhook.test.js
```

Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add src/webhook.js tests/webhook.test.js src/wix-client.js
git commit -m "feat: webhook handler with dedup + signed-order processing"
```

---

### Task 7: Worker entry (cron + HTTP triggers)

**Files:**
- Modify: `~/iCode/projects/rrm-wix-sync/src/index.js`

- [ ] **Step 1: Replace stub with real implementation**

```javascript
// src/index.js
import { createWixClient } from './wix-client.js';
import { runSync } from './sync.js';
import { handleWebhook } from './webhook.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function logEvent(env, action, status, detail, counts = {}, durationMs = 0) {
  try {
    env.AE?.writeDataPoint({
      blobs: ['rrm-wix-sync', 'sync', action, status, detail || ''],
      doubles: [durationMs, counts.ordersUpserted || 0, counts.subsUpserted || 0],
      indexes: [action],
    });
  } catch {
    // AE writes are best-effort
  }
}

async function doSync(env, { full = false } = {}) {
  if (!env.WIX_IST_TOKEN) {
    return { ok: false, status: 503, error: 'wix_token_missing' };
  }
  const wix = createWixClient({
    token: env.WIX_IST_TOKEN,
    siteId: env.WIX_SITE_ID,
  });
  const started = Date.now();
  try {
    const res = await runSync({ db: env.DB, wix, full });
    const durationMs = Date.now() - started;
    logEvent(env, 'sync', 'success', full ? 'full' : 'incremental', res, durationMs);
    return { ok: true, ...res, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    logEvent(env, 'sync', 'error', err.message, {}, durationMs);
    return { ok: false, status: 503, error: 'sync_failed', detail: err.message, durationMs };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      try {
        const [wm, subs, pays] = await Promise.all([
          env.DB.prepare(`SELECT value, updated_at FROM system_config WHERE key = 'wix_sync_watermark' LIMIT 1`).first(),
          env.DB.prepare(`SELECT COUNT(*) AS n FROM wix_subscription WHERE status = 'active'`).first(),
          env.DB.prepare(`SELECT COUNT(*) AS n FROM wix_payment`).first(),
        ]);
        return json({
          ok: true,
          last_sync_at: wm?.updated_at || null,
          watermark: wm?.value || null,
          active_subs: subs?.n || 0,
          total_payments: pays?.n || 0,
        });
      } catch (err) {
        return json({ ok: false, error: 'health_check_failed', detail: err.message }, 503);
      }
    }

    if (url.pathname === '/sync' && request.method === 'POST') {
      const token = url.searchParams.get('token');
      if (!env.ADMIN_API_SECRET || token !== env.ADMIN_API_SECRET) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      const full = url.searchParams.get('full') === 'true';
      const result = await doSync(env, { full });
      return json(result, result.ok ? 200 : (result.status || 500));
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (!env.WIX_WEBHOOK_PUBLIC_KEY) {
        return json({ ok: false, error: 'webhook_not_configured' }, 503);
      }
      if (!env.WIX_IST_TOKEN) {
        return json({ ok: false, error: 'wix_token_missing' }, 503);
      }
      const body = await request.text();
      const wix = createWixClient({ token: env.WIX_IST_TOKEN, siteId: env.WIX_SITE_ID });
      const started = Date.now();
      try {
        const res = await handleWebhook({ body, db: env.DB, publicKey: env.WIX_WEBHOOK_PUBLIC_KEY, wix });
        logEvent(env, 'webhook', res.status === 200 ? 'success' : 'error', res.body.eventType || res.body.error || '', {}, Date.now() - started);
        return json(res.body, res.status);
      } catch (err) {
        logEvent(env, 'webhook', 'error', err.message, {}, Date.now() - started);
        return json({ ok: false, error: 'webhook_handler_crashed' }, 500);
      }
    }

    return json({ ok: false, error: 'not_found' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(doSync(env, { full: false }));
  },
};
```

- [ ] **Step 2: Smoke-test build**

```bash
cd ~/iCode/projects/rrm-wix-sync && npx wrangler deploy --dry-run --outdir=dist
```

Expected: `dist/index.js` produced, no errors.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: all tests (from Tasks 3-6) pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat: worker entry — cron + /sync HTTP + /health"
```

---

### Phase 1 rollback reference (valid from Task 8 onward — first remote mutation)

If anything between Task 8 and Task 10 goes wrong, revert with:

```bash
# 1. Unpublish worker (safe: no inbound webhooks will hit a nonexistent worker, they'll 404 and Wix will give up retry)
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
cd ~/iCode/projects/rrm-wix-sync
npx wrangler delete rrm-wix-sync

# 2. Drop D1 tables (safe until Phase 2 deploys — nothing in production reads them yet)
cd ~/iCode/projects/rrm-academy-cf
npx wrangler d1 execute rrm-auth --remote --command "DROP TABLE IF EXISTS wix_subscription; DROP TABLE IF EXISTS wix_payment; DROP TABLE IF EXISTS wix_webhook_event"
# Note: system_config is shared; do NOT drop. Only remove our row:
npx wrangler d1 execute rrm-auth --remote --command "DELETE FROM system_config WHERE key = 'wix_sync_watermark'"
```

This block is safe to run any time before Task 11 (the first /api/billing/status.js edit) lands on main. After Phase 2 deploys, see the Appendix rollback section — dropping the tables would break `/api/billing/status.js`.

---

### Task 8: Apply D1 schema to remote rrm-auth

**Files:** (none modified; applies migration)

- [ ] **Step 1: Dry-run the migration against a local copy**

```bash
cd ~/iCode/projects/rrm-academy-cf
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
npx wrangler d1 execute rrm-auth --local --file=../rrm-wix-sync/schema.sql
npx wrangler d1 execute rrm-auth --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('wix_subscription','wix_payment','system_config','wix_webhook_event')"
```

Expected: 4 tables listed.

- [ ] **Step 2: Apply to remote**

```bash
cd ~/iCode/projects/rrm-academy-cf
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
npx wrangler d1 execute rrm-auth --remote --file=../rrm-wix-sync/schema.sql
```

Expected: "Executed N commands" with no errors. Indexes created.

- [ ] **Step 3: Verify remote schema**

```bash
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
npx wrangler d1 execute rrm-auth --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('wix_subscription','wix_payment','system_config','wix_webhook_event')"
npx wrangler d1 execute rrm-auth --remote --command "SELECT COUNT(*) FROM wix_subscription"
npx wrangler d1 execute rrm-auth --remote --command "SELECT COUNT(*) FROM wix_payment"
```

Expected: 4 table names listed; both counts = 0.

- [ ] **Step 4: Commit note (no file change, but tag the step)**

No code to commit. Note in plan execution log that schema was applied to remote rrm-auth at `<timestamp>`.

---

### Task 9: Deploy sync worker with secrets

- [ ] **Step 1: Set Wix IST token secret**

```bash
cd ~/iCode/projects/rrm-wix-sync
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
op read 'op://Automation/<redacted>/credential' | npx wrangler secret put WIX_IST_TOKEN
```

Expected: "Successfully deposited secret WIX_IST_TOKEN on rrm-wix-sync".

- [ ] **Step 2: Generate and set ADMIN_API_SECRET**

```bash
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
openssl rand -hex 32 | tee /tmp/rrm-wix-sync-admin-secret.txt | npx wrangler secret put ADMIN_API_SECRET
```

Expected: "Successfully deposited". Keep `/tmp/rrm-wix-sync-admin-secret.txt` for Task 10.

Also save the secret to 1Password:
```bash
op item create --vault Automation --category "API Credential" \
  --title "rrm-wix-sync Admin Secret" \
  "credential[password]=$(cat /tmp/rrm-wix-sync-admin-secret.txt)" \
  "notes=ADMIN_API_SECRET for POST /sync on rrm-wix-sync worker"
```

- [ ] **Step 3: Set Wix webhook public key secret**

```bash
cd ~/iCode/projects/rrm-wix-sync
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')

op item get 346mczoiqhbppe4x2sxsopbot4 --vault Automation --reveal --format json \
  | python3 -c "
import json, sys
item = json.load(sys.stdin)
for f in item.get('fields', []):
    if 'Public Key' in (f.get('label') or ''):
        sys.stdout.write(f.get('value', ''))
        break
" \
  | npx wrangler secret put WIX_WEBHOOK_PUBLIC_KEY
```

Expected: "Successfully deposited secret WIX_WEBHOOK_PUBLIC_KEY". If the python extractor returns empty, inspect the 1Password item manually — the field label may have been renamed. Do NOT use awk-based extraction (it truncates the trailing `-----END PUBLIC KEY-----` line and produces an unparseable PEM).

- [ ] **Step 4: Deploy the worker**

```bash
cd ~/iCode/projects/rrm-wix-sync
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
npx wrangler deploy
```

Expected: "Deployed rrm-wix-sync triggers: schedule: 0 */6 * * *". Worker URL printed (e.g. `https://rrm-wix-sync.administrator-cloudflare.workers.dev`).

- [ ] **Step 5: [BRIAN-MANUAL, non-blocking] Register the webhook URL in the Wix Developer Console**

> **Lights-off note:** This step requires a browser and a human login to Wix. The autonomous execution agent MUST skip this step, log it as a pending human task in the execution summary, and proceed to Step 6. The 6-hour fallback cron covers all data needs until Brian completes this step — zero donor-UX degradation in the interim, only missing the real-time seconds-level latency benefit.

When Brian is ready, the steps are:

The `Wix API - RRM Finance Sync` app already exists (app id `50242798-fa4f-43a6-96cd-787f490d2b87`). Open:

```
https://manage.wix.com/apps/50242798-fa4f-43a6-96cd-787f490d2b87/home
```

Navigate to **Webhooks** in the left sidebar. Register these event subscriptions, all pointing to `https://rrm-wix-sync.administrator-cloudflare.workers.dev/webhook`:

- `wix.ecom.v1.order_updated` (Order > OrderUpdated)
- `wix.ecom.v1.order_payment_status_updated` (Order > OrderPaymentStatusUpdated)

Save each subscription. Wix may send a test "ping" event — the handler's signature check will accept it (valid JWT) and record it as an event type not matching `/order_/`, which is fine.

- [ ] **Step 6: Smoke test /health**

```bash
curl -s https://rrm-wix-sync.administrator-cloudflare.workers.dev/health | python3 -m json.tool
```

Expected: `{ "ok": true, "last_sync_at": null, "watermark": null, "active_subs": 0, "total_payments": 0 }`.

- [ ] **Step 7: Commit any wrangler.toml updates**

```bash
cd ~/iCode/projects/rrm-wix-sync
git add wrangler.toml
git diff --cached --quiet || git commit -m "chore: record deploy config"
```

---

### Task 10: Run full backfill, verify Victoria

- [ ] **Step 1: Run backfill**

```bash
TOKEN=$(cat /tmp/rrm-wix-sync-admin-secret.txt)
curl -X POST "https://rrm-wix-sync.administrator-cloudflare.workers.dev/sync?token=$TOKEN&full=true" | python3 -m json.tool
```

Expected (approximate):
```json
{ "ok": true, "ordersSeen": 333, "ordersUpserted": 333, "subsUpserted": 52, "durationMs": 45000 }
```

The 52 counts 51 Stores subs + 1 Pricing Plans legacy sub. `durationMs` may be 30-120s for first run.

- [ ] **Step 2: Verify Victoria appears in both tables**

```bash
cd ~/iCode/projects/rrm-academy-cf
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
npx wrangler d1 execute rrm-auth --remote --command "SELECT wix_subscription_id, email, tier, status, cycle_count, amount_cents, last_order_at, user_id FROM wix_subscription WHERE email = 'vjgbergin@gmail.com' COLLATE NOCASE"
npx wrangler d1 execute rrm-auth --remote --command "SELECT COUNT(*) AS payment_count FROM wix_payment WHERE email = 'vjgbergin@gmail.com' COLLATE NOCASE"
```

Expected:
- Subscription row: `tier='member'`, `status='active'`, `cycle_count=8`, `amount_cents=900`, `user_id` populated (non-null).
- Payment count: 8.

- [ ] **Step 3: Spot-check counts**

```bash
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
npx wrangler d1 execute rrm-auth --remote --command "SELECT status, COUNT(*) FROM wix_subscription GROUP BY status"
npx wrangler d1 execute rrm-auth --remote --command "SELECT product_source, COUNT(*) FROM wix_subscription GROUP BY product_source"
npx wrangler d1 execute rrm-auth --remote --command "SELECT tier, COUNT(*) FROM wix_subscription GROUP BY tier"
```

Expected (from fishing report): ~30 active / ~22 inactive, ~51 stores / 1 pricing-plans, mostly member tier (277 orders × 92% were $9/mo → most unique subs are member tier).

- [ ] **Step 4: Check user-link hit rate**

```bash
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
npx wrangler d1 execute rrm-auth --remote --command "SELECT CASE WHEN user_id IS NULL THEN 'unlinked' ELSE 'linked' END AS state, COUNT(*) FROM wix_subscription GROUP BY state"
```

Record the numbers. Expected: most active subs linked; some inactive/old subs may be unlinked if donors never made an rrmacademy.org account.

- [ ] **Step 5: Verify double-run idempotency**

```bash
TOKEN=$(cat /tmp/rrm-wix-sync-admin-secret.txt)
curl -X POST "https://rrm-wix-sync.administrator-cloudflare.workers.dev/sync?token=$TOKEN&full=true" | python3 -m json.tool
```

Run count check from Step 3 again. Expected: row counts unchanged; only `updated_at` timestamps changed.

- [ ] **Step 6: [OPTIONAL, NON-BLOCKING] Verify webhook receives a real event**

Only run this step AFTER Brian has completed the Task 9 Step 5 manual registration. If Brian has not yet done so, skip this step and proceed — the 6h cron covers data needs.

```bash
cd ~/iCode/projects/rrm-academy-cf
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
npx wrangler d1 execute rrm-auth --remote --command "SELECT event_id, event_type, entity_id, received_at, processed, status_code FROM wix_webhook_event ORDER BY received_at DESC LIMIT 5"
```

Expected (after Brian registers + a Wix event occurs): at least one row with `processed = 1` and `status_code = 200`.

If no events arrive after registration + 10 minutes of natural Wix activity:
- Check the worker's CF logs: `CLOUDFLARE_API_TOKEN=... npx wrangler tail rrm-wix-sync --format=pretty`
- Reopen the Wix dev console URL and confirm the subscription saved
- Confirm the URL matches the deployed worker URL exactly (no trailing slash mismatch)

- [ ] **Step 7: Hand off to Brian for overnight verification**

Do NOT proceed to Phase 2 in the same session. Report to Brian:

> Backfill complete. Stats: X orders, Y subscriptions, Z user-linked. Victoria verified (sub id `3d554b38...`, tier=member, status=active, 8 payments, linked to user_id ...). Watermark set to 2026-04-23T...Z. Read-side changes (Phase 2) blocked on your overnight verification — look at the numbers above and give green light before I modify billing/status.js.

**End of Phase 1.** Phase 2 begins only after Brian confirms the data looks right.

---

## Phase 2: Read-side integration (Day 2+, after Brian verification)

### Task 11: Extend `/api/billing/status.js` (via coder agent)

**Files:**
- Modify: `~/iCode/projects/rrm-academy-cf/functions/api/billing/status.js`

- [ ] **Step 1: Dispatch coder agent with scoped task**

Use the Agent tool with `subagent_type: "coder"` and this prompt:

```
Task: Extend functions/api/billing/status.js to surface Wix subscription + payment data when Stripe is empty or in addition to Stripe data.

Context:
- rrm-wix-sync worker populates two D1 tables in the existing rrm-auth database: wix_subscription and wix_payment. Schema is in ~/iCode/projects/rrm-wix-sync/schema.sql. Both tables use COLLATE NOCASE on email and have user_id columns (nullable, populated via email match).
- Current behavior: billing/status.js returns subscription=null and empty donations[] if the user has no Stripe customer id. Victoria has no Stripe customer — she donated via Wix. Fix that.
- The `donation` and `payment` shapes consumed by /account are defined in the current file (see mapCharge). Preserve those shapes exactly; add an optional `source` field to each item ('stripe' | 'wix') and an optional `receiptNumber` on donations that lack a receiptUrl.

Required changes:
1. AFTER the existing Stripe block (after subscription/donations/payments are built), query D1 for the user's Wix subscription + payments:
   - wix_subscription: match user_id = session.userId OR email COLLATE NOCASE; take the newest row with status='active'. If found and no Stripe subscription was surfaced, surface this one as `subscription = { tier, status: 'active', currentPeriodEnd: <unix from next_expected_at>, cancelAtPeriodEnd: false, source: 'wix', amount: amount_cents }`.
   - wix_payment: match same way, payment_status='PAID', order by paid_at desc, LIMIT 50. Map each to `{ amount: amount_cents, date: <unix from paid_at>, receiptUrl: null, receiptNumber: receipt_number, source: 'wix' }`.
2. Merge donations: `donations = [...stripeDonations, ...wixDonations].sort((a,b) => b.date - a.date)`. Add `source: 'stripe'` to the existing stripe donations/payments for symmetry.
3. Wrap all D1 queries in try/catch. Log via existing log() on failure. If D1 errors, fall back to Stripe-only response (never let Wix errors break Stripe users).

Sibling patterns to match:
- Error logging: use the existing `log(env, waitUntil, 'billing', 'status_error', 'error', err.message, 0, 503)` pattern.
- Response shape: preserve `{ ok: true, subscription, donations, payments }`. The new source/receiptNumber fields are additive.
- No err.message in response bodies (redact to generic message).
- COLLATE NOCASE on every email comparison.
- Use a single db.batch() when running both Wix queries in parallel (or Promise.all with two prepared statements).

Do not touch any other file. Run arise-scanner on the changed file before committing.

Guard file: this is a guarded file. After modifying, run `npm run guard:update` in the rrm-academy-cf directory to update guard-manifest.json.

Commit message: "feat(billing): surface Wix subscription + donations on /account"
```

- [ ] **Step 2: Review coder agent's output**

Read the diff. Confirm:
- Stripe-only code path is unchanged (no regression).
- New Wix queries are wrapped in try/catch.
- COLLATE NOCASE present on email compares.
- No err.message leaks.
- `source` field added to donations + subscription.
- Guard manifest updated.

- [ ] **Step 3: Run arise-scanner**

```bash
cd ~/iCode/projects/rrm-academy-cf
arise-scan --json --files functions/api/billing/status.js | python3 -m json.tool
```

Expected: zero HIGH or CRITICAL findings.

- [ ] **Step 4: Confirm the commit landed**

```bash
git log -1 --stat functions/api/billing/status.js
```

---

### Task 12: Extend `community/_shared.js requireMember` (via coder agent)

**Files:**
- Modify: `~/iCode/projects/rrm-academy-cf/functions/api/community/_shared.js`

- [ ] **Step 1: Dispatch coder agent**

Use Agent tool with `subagent_type: "coder"`:

```
Task: Add an active-Wix-subscription bypass to requireMember() in functions/api/community/_shared.js, placed between the existing "Grandfathered Wix STUC members — label-based bypass" and the Stripe subscription check.

Context:
- rrm-wix-sync populates wix_subscription in D1 rrm-auth. Match on (user_id = ? OR email = ? COLLATE NOCASE) AND status='active'.
- Existing label bypass uses 'Save the Uterus Club 🏷️'. Keep it. The new Wix check is a second grandfather path for donors whose label was never seeded but who have an active sub.
- tier should come from the wix_subscription.tier column (values: 'member' | 'hero' | 'superhero' — same as Stripe price mapping).

Required change — insert immediately before the "Members need an active subscription" comment:

```js
// Active Wix subscribers (new grandfather path, covers donors missing the legacy label)
try {
  const wixSub = await db.prepare(
    "SELECT tier FROM wix_subscription WHERE (user_id = ? OR email = ? COLLATE NOCASE) AND status = 'active' LIMIT 1"
  ).bind(user.id, user.email).first();
  if (wixSub) {
    return { user, tier: wixSub.tier || 'member', session };
  }
} catch (err) {
  // Wix lookup must not block community access for Stripe members
  console.error('requireMember wix lookup failed:', err.message);
}
```

Sibling patterns:
- Existing file uses plain console.error on D1 errors (see Stripe catch). Match.
- No err.message to client.
- `_shared.js` is NOT a route handler (starts with _), so no arise-scanner rules on CORS/auth applied.

Do not modify other logic. Do not remove the label bypass.

Guard file: this is guarded. After modifying, run `npm run guard:update`.

Commit message: "feat(community): active Wix sub as requireMember grandfather path"
```

- [ ] **Step 2: Verify the diff**

```bash
cd ~/iCode/projects/rrm-academy-cf
git diff HEAD~1 functions/api/community/_shared.js
```

Confirm:
- Label bypass still present.
- New block is between label bypass and Stripe check.
- try/catch around D1 call.
- `return { user, tier, session }` format matches siblings.

- [ ] **Step 3: Run arise-scanner**

```bash
arise-scan --json --files functions/api/community/_shared.js | python3 -m json.tool
```

Expected: zero HIGH or CRITICAL findings.

---

### Task 13: Update `/account` UI for Wix-source subscriptions

**Files:**
- Modify: `~/iCode/projects/rrm-academy-cf/src/pages/account/index.astro`

- [ ] **Step 1: Update loadBilling() to branch on subscription.source**

Locate the `loadBilling()` function:

```bash
grep -n 'function loadBilling()' src/pages/account/index.astro
```

Within that function, find the `if (hasSub)` block:

```bash
grep -n '^[[:space:]]*if (hasSub)' src/pages/account/index.astro
```

Replace that entire block (from `if (hasSub) {` through its matching closing `}`) with:

```javascript
            if (hasSub) {
              var sub = data.subscription;
              billingTier.textContent = sub.tier;
              billingStatus.textContent = sub.status.charAt(0).toUpperCase() + sub.status.slice(1);
              if (sub.currentPeriodEnd) {
                billingDate.textContent = new Date(sub.currentPeriodEnd * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
              } else {
                billingDate.textContent = '--';
              }
              if (sub.cancelAtPeriodEnd) cancelNotice.hidden = false;

              // Wix-source subs route Manage Billing to a mailto helper, not Stripe portal
              var manageBtn = document.getElementById('manage-billing-btn');
              var manageNote = document.getElementById('manage-billing-wix-note');
              if (sub.source === 'wix') {
                if (manageBtn) manageBtn.hidden = true;
                if (manageNote) manageNote.hidden = false;
              } else {
                if (manageBtn) manageBtn.hidden = false;
                if (manageNote) manageNote.hidden = true;
              }

              billingActive.hidden = false;
            }
```

- [ ] **Step 2: Add the Wix note block to the billing-active container**

Locate the billing-active block:

```bash
grep -n 'id="billing-active"' src/pages/account/index.astro
grep -n 'id="manage-billing-btn"' src/pages/account/index.astro
```

Add this inside the `#billing-active` block, immediately after the `#manage-billing-btn` element:

```html
              <div id="manage-billing-wix-note" hidden class="billing-wix-note">
                <p>Your recurring donation is processed through our legacy platform. To update your card, change your amount, or cancel, email <a href="mailto:support@rrmacademy.org">support@rrmacademy.org</a> — we'll respond within 1 business day.</p>
              </div>
```

- [ ] **Step 3: Add CSS for the note (inside the existing `<style>` block)**

Locate the existing `.billing-cancel-notice` rule and append the new rules immediately after it:

```bash
grep -n '\.billing-cancel-notice' src/pages/account/index.astro
```

```css
  .billing-wix-note {
    margin-top: var(--space-4);
    padding: var(--space-4);
    background: var(--bg-muted);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    color: var(--text-secondary);
  }
  .billing-wix-note p { margin: 0; }
  .billing-wix-note a { color: var(--accent); text-decoration: underline; }
```

Use the actual token names from `docs/design/design-system.json` — if any of `--bg-muted`, `--accent`, or `--radius-sm` don't exist verbatim, substitute with the closest existing token rather than hardcoding a color.

- [ ] **Step 4: Update renderHistoryList to show receipt numbers**

Locate `renderHistoryList`:

```bash
grep -n 'function renderHistoryList' src/pages/account/index.astro
grep -n 'receiptUrl' src/pages/account/index.astro
```

Find where each history row currently renders `receiptUrl` as a link. Replace that block with a combined block that prefers `receiptNumber` (Wix, plain text) over `receiptUrl` (Stripe, link):

```javascript
        if (item.receiptNumber) {
          var receiptSpan = document.createElement('span');
          receiptSpan.className = 'history-receipt';
          receiptSpan.textContent = 'Receipt #' + item.receiptNumber;
          row.appendChild(receiptSpan);
        } else if (item.receiptUrl) {
          var link = document.createElement('a');
          link.href = item.receiptUrl;
          link.textContent = 'Receipt';
          link.target = '_blank';
          link.rel = 'noopener';
          row.appendChild(link);
        }
```

Replace the existing receiptUrl-only rendering with the combined block above. (Read the actual current code and match the replacement to the existing structure. If the current file renders receiptUrl differently, adapt.)

- [ ] **Step 5: Build and preview locally**

```bash
cd ~/iCode/projects/rrm-academy-cf
npm run build
```

Expected: Astro build succeeds. Check for warnings about `src/pages/account/index.astro`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/account/index.astro
git commit -m "feat(account): show Wix-source subscription with mailto manage + receipt numbers"
```

---

### Task 14: Update guard manifest

**Files:**
- Modify: `~/iCode/projects/rrm-academy-cf/guard-manifest.json`

- [ ] **Step 1: Regenerate manifest hashes**

```bash
cd ~/iCode/projects/rrm-academy-cf
npm run guard:update
```

Expected: updated hashes for `functions/api/billing/status.js` and `functions/api/community/_shared.js`.

- [ ] **Step 2: Verify guard check passes**

```bash
npm run guard
```

Expected: "✓ All guarded files match manifest".

- [ ] **Step 3: Commit**

```bash
git add guard-manifest.json
git commit -m "chore: update guard hashes after billing + community changes"
```

---

### Task 15: Deploy rrm-academy-cf

- [ ] **Step 1: Push to main (triggers GitHub Actions → CF Pages deploy)**

```bash
cd ~/iCode/projects/rrm-academy-cf
git push origin main
```

- [ ] **Step 2: Watch CI**

```bash
gh run watch --exit-status
```

Expected: CI passes (type check, guard check, build, deploy). Should take ~4-6 minutes.

- [ ] **Step 3: Smoke-test /account endpoint response shape**

Using a browser session cookie in a test account, or via the GraphQL/REST shape check:

```bash
# Pseudocode — actual test requires a valid session cookie
curl -s "https://rrmacademy.org/api/billing/status" -H "Cookie: session=..." | python3 -m json.tool
```

For Brian's test: log in as himself (a Stripe donor), confirm the response is unchanged (subscription, donations, payments all populate as before). Then log in as Victoria (or have her try and report), confirm subscription.source = 'wix' and 8 donation rows appear.

---

### Task 16: Post-deploy verification + message Victoria

- [ ] **Step 1: Verify Stripe-only users unaffected**

Log in as a Stripe-only member (any staff account). Confirm /account billing section renders identically to pre-deploy: tier, status, next donation date, Manage Billing button (not the Wix mailto note).

- [ ] **Step 2: Verify Victoria's account (or have her check)**

Either:
- (a) Use admin tooling to impersonate her account and confirm /account shows: Member tier, Active status, next donation ~2026-05-23, 8 donation rows, mailto note instead of Manage Billing button.
- (b) Message Victoria on Instagram: "Hi Victoria — just fixed the issue on your account. Can you log in again at rrmacademy.org and let me know if you see your membership + donation history? Thanks for the patience."

- [ ] **Step 3: Confirm Analytics Engine events**

```bash
bash ~/iCode/projects/rrm-academy-cf/scripts/query-events.sh --dataset=worker-events --worker=rrm-wix-sync --limit=10
```

Expected: at least one `sync` event logged (from the scheduled cron or the backfill).

- [ ] **Step 4: Monitor for 48h**

Check the worker's scheduled runs twice-daily for 2 days. Confirm:
- No 500s in CF Pages logs on /api/billing/status
- No new /arise findings on the modified files
- Sync worker health endpoint remains green

- [ ] **Step 5: Update memory**

Append a one-liner to `~/.claude/projects/-Users-brian-iCode/memory/MEMORY.md` under Projects:
- `[wix-donations-sync.md](wix-donations-sync.md) -- rrm-wix-sync worker LIVE YYYY-MM-DD. Mirrors Wix eCom orders into D1 (wix_subscription/wix_payment). /account + community/_shared.js both read Wix data.`

Create `~/.claude/projects/-Users-brian-iCode/memory/wix-donations-sync.md` with full details per the MEMORY.md file convention.

---

## Appendix: Rollback plan

If Phase 2 causes issues after deploy:

**Option A (fast):** Revert the single commit that modified `billing/status.js` and push. The sync worker + D1 tables remain in place (no harm done since nothing else reads them yet).

```bash
cd ~/iCode/projects/rrm-academy-cf
git revert <commit-sha-for-task-11>
git push origin main
```

**Option B (pause the sync worker):**

```bash
cd ~/iCode/projects/rrm-wix-sync
# Edit wrangler.toml, remove or comment the [triggers] block
git add wrangler.toml
git commit -m "chore: pause wix sync cron"
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/<redacted>/credential')
npx wrangler deploy
```

This stops the 6-hour cron but leaves the `/webhook` endpoint live. To also disable webhooks, unregister the subscriptions in the Wix Developer Console (URL in Task 9 Step 5). Pending events will NACK (500 responses) and Wix will retry for a window, then give up — no data loss from the CF side since nothing persists between retries beyond the `wix_webhook_event` log.

**Option C (nuclear — drop tables):**

D1 tables can be dropped manually with `wrangler d1 execute rrm-auth --remote --command "DROP TABLE wix_subscription; DROP TABLE wix_payment; DROP TABLE wix_webhook_event"`. Only do this after all read-side code is reverted, otherwise `/api/billing/status.js` queries will throw.
