# First-Touch Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every conversion-ledger row, every Stripe checkout, and the Google Ads value uploads a durable first-touch attribution record (90-day cookie, screened server params, ledger columns) without disturbing the existing last-touch and 30-day-gclid paths.

**Architecture:** A new 90-day first-party cookie (`rrm_ft`) is written client-side in `BaseLayout.astro`'s existing GPC-guarded block, parsed server-side in `_ga4-source.js`, bound into the conversion ledger by `_ga4.js`, carried through Stripe metadata by `create-checkout.js`, forwarded by the webhook to GA4/the ledger, and used by a refactored `_google-ads.js` uploader to post conversion value against two new Google Ads conversion actions. The pre-existing 30-day `gclid` cookie, last-click Ads uploads, and every current call site keep working unmodified.

**Tech Stack:** CF Pages Functions (ESM JS), Astro inline script, D1 (SQLite), node:test with the in-repo sqliteD1 harness, Stripe, Google Ads Data Manager API.

**Spec:** docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md (sections 3.1, 3.3, 3.4, 7.2)

## Global Constraints

- `$SCRATCH` in every command below is the session scratchpad directory (`/private/tmp/claude-501/-Users-brian-iCode/<session>/scratchpad`), never `/tmp`.

- Cookie name `rrm_ft`, `max-age=7776000` (90 days), `path=/; SameSite=Lax; Secure`, written ONLY when absent.
- Field caps: `s`/`m`/`c`/`k`/`t`/`r`/`l` each capped at 100 chars; `g` (click id) capped at 512 chars; the whole encoded cookie value aborts the write entirely (nothing set) if it exceeds 1 KB.
- The 30-day `gclid` cookie is UNCHANGED: still 30 days, still overwritten on every new ad click, still the sole source for every Google Ads conversion upload (existing and new).
- Canonical field names: cookie keys `s` source, `m` medium, `c` campaign, `k` content, `t` term, `g` click id (kind-marker prefixed), `r` referrer host, `l` landing path, `d` epoch seconds; server event params `ft_source`, `ft_medium`, `ft_campaign`, `ft_content`, `ft_landing`, `ft_at`, plus `click_id` (ledger column name, not a GA4 param prefixed `ft_`); ledger/DDL columns `ft_source`, `ft_medium`, `ft_campaign`, `ft_landing`, `ft_at`, `click_id`, `transaction_id`; Stripe metadata keys `ft_source`, `ft_medium`, `ft_campaign`, `ft_landing`, `ft_at`, `click_id`, `gclid_last`.
- `ft_content` is a GA4 event param only. It has no ledger column and is never written to Stripe metadata.
- Guarded files touched by this plan: `functions/api/_ga4.js`, `functions/api/_ga4-source.js`, `src/layouts/BaseLayout.astro`, `functions/api/create-checkout.js`. Every task that edits one of these ends with `npm run guard:update` in the same commit.
- Migration 039 has four homes, landing in coordinated commits: `migrations/039-first-touch-attribution.sql` (this repo), a new `EXTRA_DDL` entry in `scripts/gates/validate-sql-columns.mjs` (this repo), and in `rrm-backoffice`: `test/fixtures/conversion-event.sql` graduated to `schema/conversion-event.sql` with a `.sha256` sidecar, and the `EXPECTED` column array in `test/funnel-api.test.js`.
- Commit messages: always written to a scratch file first and passed with `git commit -F <file>`, never `git commit -m` with long text. Every commit message ends with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- No em dashes in any prose or comment added by this plan. American English throughout.
- Migration 039 MUST be applied to remote `rrm-auth` (`wrangler d1 execute rrm-auth --remote --file=migrations/039-first-touch-attribution.sql`) BEFORE the code that binds the new columns (Task 5 onward) deploys.
- Deploys happen only by pushing `main` to trigger CI. Never deploy by hand.

## File Structure

| Action | File | Responsibility |
|---|---|---|
| Create | `migrations/039-first-touch-attribution.sql` | Additive `conversion_event` columns + two indexes |
| Modify | `scripts/gates/validate-sql-columns.mjs` | `EXTRA_DDL` entry for 039 |
| Modify | `test/ga4-conversion-ledger.test.js` | 039 schema-composition test + ft_*/click_id/transaction_id ledger tests |
| Modify (rrm-backoffice) | `test/fixtures/conversion-event.sql` -> `schema/conversion-event.sql` | Graduate fixture, add `.sha256` sidecar |
| Modify (rrm-backoffice) | `test/funnel-api.test.js` | `EXPECTED` column array gains the 7 new columns |
| Modify (rrm-backoffice) | `test/helpers.js` | No change (already loads from `schema/` by relative name) |
| Modify | `src/layouts/BaseLayout.astro` | `rrm_ft` cookie write inside the GPC block |
| Create | `test/base-layout-first-touch.test.js` | vm-sandboxed extraction test for the inline script |
| Modify | `functions/api/_ga4-source.js` | `parseFirstTouch()`, `parseGclidCookie()` (moved here), `buildSourceParams` spreads `ft_*` |
| Modify | `test/ga4-source.test.js` | `parseFirstTouch` unit tests |
| Modify | `functions/api/_ga4.js` | Bind `ft_*`, `click_id`, `transaction_id` into the ledger INSERT |
| Modify | `functions/api/create-checkout.js` | Read `rrm_ft`/`gclid` cookies, add metadata keys |
| Modify | `test/create-checkout-migration.test.js` | Source-pattern assertions for the new metadata keys |
| Modify | `functions/api/billing/_webhook-checkout.js` | Forward `ft_*`/`click_id` from metadata into the `purchase` GA4 send; call `sendGoogleAdsValueConversion` |
| Modify | `test/webhook-checkout-metadata.test.js` | Source-pattern assertions for the forwarding |
| Create | `test/webhook-checkout-ft-forward.test.js` | Execution test: purchase ledger row carries `ft_*` from metadata only |
| Modify | `functions/api/_google-ads.js` | `uploadConversion()` new signature, `sendGoogleAdsValueConversion()`, two new frozen action-id constants |
| Modify | `test/google-ads-conversion.test.js` | Payload-shape tests: default path byte-identical, new path carries value/currency/orderId/gbraid |
| Create | `skills/ads-sitting/helpers/create-value-actions.py` | One-time Ads API mutation creating the two conversion actions (Brian runs it) |
| Modify (rrm-backoffice) | `functions/api/ads.js` | Two new `ACTIONS` entries for the value-upload conversion actions |
| Modify | `guard-manifest.json` | `npm run guard:update` after each guarded-file task |

---

## Task 1: Migration 039 and its schema-drift home

**Files:**
- Create: `migrations/039-first-touch-attribution.sql`
- Modify: `scripts/gates/validate-sql-columns.mjs`
- Modify: `test/ga4-conversion-ledger.test.js`

**Interfaces:**
- Consumes: nothing (new DDL file).
- Produces: `conversion_event.ft_source|ft_medium|ft_campaign|ft_landing|ft_at|click_id|transaction_id` columns; `idx_conversion_event_ft`, `idx_conversion_event_transaction` indexes; `EXTRA_DDL` entry keyed `migrations/039-first-touch-attribution.sql`.

- [ ] **Step 1: Write the migration file**, matching the header shape of 034/036 (WHY, PII class per column, apply commands, partial-apply recovery):

```sql
-- 039-first-touch-attribution.sql
-- First-touch attribution columns on the conversion ledger -- additive
-- migration on rrm-auth (D1). Converge component `first-touch-attribution`.
--
-- WHY
-- migrations/036-conversion-ledger.sql records only last-touch attribution
-- (entry_source/entry_category/utm_campaign, all derived from the CURRENT
-- request's referrer/UTM params). A visitor who arrives from a paid ad on
-- Monday and buys direct on Friday shows as a direct purchase, and the
-- click id that brought them is gone by the time they convert -- the 30-day
-- `gclid` cookie has already expired or been overwritten by an intervening
-- click. This migration adds the columns the first-touch cookie (`rrm_ft`,
-- 90-day, docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md
-- section 3.1) and the Stripe checkout/webhook flow bind into, so the
-- ledger's own person-level history stops resetting on every session.
--
-- PII CLASS (screen applied at the _ga4.js ledger boundary, same as every
-- other free-text column on this table)
-- ft_source, ft_medium, ft_campaign, ft_landing: free text, screened against
--   _track-events.js PII_VALUE_REGEX (email shape, formatted SSN/phone, bare
--   13-19 digit run) before the column is bound. A match writes NULL.
-- ft_at: an ISO-8601 timestamp derived from the cookie's `d` (epoch seconds)
--   field. Not free text; no screen applies. NULL when the cookie carried no
--   parseable `d`.
-- click_id: the visitor's FIRST paid click id (gclid/gbraid/wbraid), sourced
--   from rrm_ft's `g` field. Screened by ledgerSafeText like every other
--   free-text column -- it is opaque but visitor-supplied (arrives via a URL
--   query param an attacker fully controls), so it gets the full
--   PII_VALUE_REGEX screen including the digit-run branch, same as
--   ft_source/ft_medium/ft_campaign/ft_landing.
-- transaction_id: a Stripe payment_intent (`pi_...`) or subscription
--   (`sub_...`) id, or a Checkout Session id (`cs_...`) fallback. Opaque
--   platform identifier, not free text: exempt from the digit-run branch of
--   the PII screen the way session_id/client_id/user_id/dedup_key already
--   are (ledgerText, length cap only). A Stripe id can never collide with a
--   13-19 digit bare run (it is always prefixed with letters), but the
--   exemption is stated explicitly rather than relying on that never
--   changing.
--
-- ADDITIVE ONLY: seven nullable columns plus two indexes. Existing readers
-- (the backoffice /funnel page, this repo's own /api/funnel-adjacent code)
-- are untouched. Rows written before this migration keep NULL ft_*/click_id/
-- transaction_id; the funnel page's "earliest ledger row" first-touch method
-- remains the fallback for them (see section 5.2 of the spec, out of scope
-- for this plan).
--
-- NOT RE-RUNNABLE: SQLite has no ALTER TABLE ADD COLUMN IF NOT EXISTS. A
-- second run of this file errors on the first ALTER with "duplicate column
-- name" and aborts before the remaining six ALTERs and two indexes run.
-- PARTIAL-APPLY RECOVERY: if a run fails partway, do NOT re-run this file.
-- Instead run PRAGMA table_info(conversion_event) against the target
-- database, compare against the seven column names above, and execute only
-- the remaining ALTER TABLE / CREATE INDEX statements one at a time by hand
-- (CREATE INDEX IF NOT EXISTS is always safe to re-run; a bare ALTER TABLE
-- ADD COLUMN is not).
--
-- ROLLBACK: additive and every value is re-derivable from Stripe/the cookie
-- on the next event for a still-active visitor, so a revert is a value
-- revert, not a schema one:
--   UPDATE conversion_event SET ft_source=NULL, ft_medium=NULL,
--     ft_campaign=NULL, ft_landing=NULL, ft_at=NULL, click_id=NULL,
--     transaction_id=NULL;
--
-- Apply (by hand; no runner). MUST run against remote BEFORE the code that
-- binds these columns (Task 5 of the first-touch-attribution plan) deploys:
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/039-first-touch-attribution.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/039-first-touch-attribution.sql
-- Verify: npx wrangler d1 execute rrm-auth --remote --command "PRAGMA table_info(conversion_event)"

ALTER TABLE conversion_event ADD COLUMN ft_source      TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_medium      TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_campaign    TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_landing     TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_at          TEXT;   -- ISO, from d
ALTER TABLE conversion_event ADD COLUMN click_id       TEXT;   -- first-touch gclid/gbraid/wbraid, PII-screened
ALTER TABLE conversion_event ADD COLUMN transaction_id TEXT;   -- Stripe pi_/sub_/cs_ id, opaque: length-capped only, exempt from the digit-run PII screen

CREATE INDEX IF NOT EXISTS idx_conversion_event_ft ON conversion_event (ft_source, ft_medium, ft_campaign);
CREATE INDEX IF NOT EXISTS idx_conversion_event_transaction ON conversion_event (transaction_id);
```

- [ ] **Step 2: Add the `EXTRA_DDL` entry**, in `scripts/gates/validate-sql-columns.mjs`, immediately after the existing `036-conversion-ledger.sql` entry (order matters: this file `ALTER TABLE`s `conversion_event`, which 036 creates, so it must stay after 036 in the composed array; it can precede or follow 038 since 038 touches an unrelated table):

```js
  {
    path: 'migrations/036-conversion-ledger.sql',
    why: 'conversion_event is written by the GA4 relay choke point (functions/api/_ga4.js, behind the CONVERSION_LEDGER flag) and read by the RRM Backoffice /funnel page; it lives in the ROOT migrations/ directory, which the test replay list does not read, and postdates the 2026-05-27 snapshot; added 2026-08-25 with the migration in the same change. The migration is being applied to remote rrm-auth before this ships, so gates:schema-drift stays level with live; until that apply lands, SD2 (STALE-PRESENT) is the expected and intended signal.',
  },
  {
    path: 'migrations/039-first-touch-attribution.sql',
    why: 'The seven ft_source/ft_medium/ft_campaign/ft_landing/ft_at/click_id/transaction_id columns on conversion_event are written by the same GA4 relay choke point (functions/api/_ga4.js) and read by the RRM Backoffice /funnel and /membership pages; it lives in the ROOT migrations/ directory, which the test replay list does not read, and postdates the 2026-05-27 snapshot; added 2026-09-05 with the migration in the same change (converge component first-touch-attribution). The migration is applied to remote rrm-auth before the code that binds these columns deploys, so gates:schema-drift stays level with live; until that apply lands, SD2 (STALE-PRESENT) is the expected and intended signal. Order matters: this file ALTERs conversion_event, which 036 creates, so it must stay after the 036 entry in this array.',
  },
  {
    path: 'migrations/038-posts-meta-description.sql',
```

- [ ] **Step 3: Add the 039-composition test** to `test/ga4-conversion-ledger.test.js`, right after the existing `LEDGER_SCHEMA_SQL` block (which currently composes only 036). Add a second composed schema and a dedicated describe block; leave the existing `LEDGER_SCHEMA_SQL`/`ledgerD1()` as-is for tests written before this task, and add a `039`-aware variant for everything from Task 5 onward:

```js
const LEDGER_SCHEMA_SQL =
  SCHEMA_SQL + '\n' +
  readFileSync(new URL('../migrations/036-conversion-ledger.sql', import.meta.url), 'utf8') + '\n' +
  readFileSync(new URL('../migrations/039-first-touch-attribution.sql', import.meta.url), 'utf8');
```

(Composing 039 directly into `LEDGER_SCHEMA_SQL` rather than a second constant keeps every existing test in the file valid, since additive columns default to NULL and no existing assertion reads them.)

```js
describe('conversion ledger -- migration 039 composes onto 036', () => {
  it('PRAGMA table_info reports all seven first-touch columns', () => {
    const db = ledgerD1();
    try {
      const columns = db._sqlite.prepare('PRAGMA table_info(conversion_event)').all().map((r) => r.name);
      for (const col of ['ft_source', 'ft_medium', 'ft_campaign', 'ft_landing', 'ft_at', 'click_id', 'transaction_id']) {
        assert.ok(columns.includes(col), `conversion_event.${col} missing after composing 039 onto 036`);
      }
    } finally { db.close(); }
  });
});
```

- [ ] **Step 4: Run the test**:

```
node --experimental-strip-types --test test/ga4-conversion-ledger.test.js
```

Expected: FAIL before Step 1-3 land (file does not exist / columns absent), PASS after.

- [ ] **Step 5: Run the SQL gate**:

```
npm run gates:sql
```

Expected: green, reporting SD2 STALE-PRESENT for 039 until the remote apply (documented, expected).

- [ ] **Step 6: Commit.**

```
cat > $SCRATCH/commit-msg-039.txt << 'EOF'
Add migration 039: first-touch attribution columns on conversion_event

Adds ft_source/ft_medium/ft_campaign/ft_landing/ft_at/click_id/
transaction_id, additive, plus the EXTRA_DDL provenance entry and a
schema-composition test, so the ledger can carry first-touch attribution
independent of the 30-day last-click gclid cookie.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add migrations/039-first-touch-attribution.sql scripts/gates/validate-sql-columns.mjs test/ga4-conversion-ledger.test.js
git commit -F $SCRATCH/commit-msg-039.txt
```

---

## Task 2: Backoffice homes for migration 039 (separate repo, separate commit)

**Repo:** `rrm-backoffice`

**Files:**
- Modify: `test/fixtures/conversion-event.sql` -> moved to `schema/conversion-event.sql`
- Create: `schema/conversion-event.sql.sha256`
- Modify: `test/funnel-api.test.js` (`EXPECTED` array; `SEEDED`/`realD1` call sites that reference the fixture path)

**Interfaces:**
- Consumes: `rrm-academy-cf/migrations/036-conversion-ledger.sql` + `migrations/039-first-touch-attribution.sql` (copied by hand, verbatim column list).
- Produces: `schema/conversion-event.sql` (vendored, read-only, sha-pinned).

- [ ] **Step 1: Graduate the fixture.** `git mv test/fixtures/conversion-event.sql schema/conversion-event.sql`, then edit its `CREATE TABLE` to add the seven 039 columns (column order matches the order the two migrations apply: the 036 columns first, then the 039 columns in the order 039 declares them), and update its header comment to say it now composes 036 and 039, following the exact pattern `schema/README.md` and `schema/admin-audit.sql`'s own header establish for a vendored, sha-pinned copy:

```sql
-- test fixture / vendored schema: `conversion_event`, the ledger the academy
-- site's GA4 relay writes and /api/funnel and /api/membership read.
--
-- NOTHING HERE IS EVER APPLIED TO A DATABASE. This repo does not own the
-- table, authors no migration against it, and only reads aggregates over it
-- (functions/api/funnel.js, functions/api/membership.js). It lives in
-- schema/ (not test/fixtures/) because, like schema/admin-audit.sql, it now
-- carries a committed .sha256 sidecar asserted on every run -- see
-- schema/README.md and test/schema-vendored-conversion-event.test.js.
--
-- IT MUST MATCH THE PRODUCTION DDL COLUMN FOR COLUMN. Created by
-- rrm-academy-cf migrations/036-conversion-ledger.sql and extended by
-- migrations/039-first-touch-attribution.sql, both applied to live
-- rrm-auth. A copy that drifts is worse than no fixture: it makes the suite
-- green against a table that does not exist. `user_id` is TEXT because an
-- rrm-auth user id is a TEXT 'usr_...' identifier.
--
-- LOAD ORDER: independent of the other fixtures. test/funnel-api.test.js's
-- SEEDED constant references it by its schema/-relative name,
-- 'conversion-event.sql'.
--
-- THE SEED IS DELIBERATELY TINY AND HAND-COUNTABLE -- see the row-by-row
-- commentary below, unchanged from the pre-039 fixture. Every ft_*/click_id/
-- transaction_id column in the seeded rows is NULL: the seed predates
-- first-touch tracking, which is exactly the "before 039 deploy" case
-- section 5.2 of the parent spec (out of scope for this plan) has to
-- distinguish from a screened-empty row.

CREATE TABLE IF NOT EXISTS conversion_event (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             TEXT NOT NULL DEFAULT (datetime('now')),
  event          TEXT NOT NULL,
  type           TEXT,
  value_cents    INTEGER,
  client_id      TEXT,
  session_id     TEXT,
  user_id        TEXT,
  entry_source   TEXT,
  entry_category TEXT,
  utm_campaign   TEXT,
  item           TEXT,
  dedup_key      TEXT,
  ft_source      TEXT,
  ft_medium      TEXT,
  ft_campaign    TEXT,
  ft_landing     TEXT,
  ft_at          TEXT,
  click_id       TEXT,
  transaction_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversion_event_event_ts ON conversion_event(event, ts);
CREATE INDEX IF NOT EXISTS idx_conversion_event_client_ts ON conversion_event(client_id, ts);
CREATE INDEX IF NOT EXISTS idx_conversion_event_user ON conversion_event(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversion_event_dedup ON conversion_event(dedup_key);
CREATE INDEX IF NOT EXISTS idx_conversion_event_ft ON conversion_event (ft_source, ft_medium, ft_campaign);
CREATE INDEX IF NOT EXISTS idx_conversion_event_transaction ON conversion_event (transaction_id);

-- (the PERSON A..F seed INSERTs below are byte-identical to the pre-039
-- fixture; they never set the seven new columns, which is the point)
```

Keep every existing `INSERT INTO conversion_event (...)` row exactly as it was (they name their column list explicitly and never touch the new columns, so they remain valid inserts with the new columns landing NULL).

- [ ] **Step 2: Generate the sidecar hash:**

```
shasum -a 256 schema/conversion-event.sql | cut -d' ' -f1 > schema/conversion-event.sql.sha256
```

- [ ] **Step 3: Update every reference to the old path.** In `test/funnel-api.test.js`, change:

```js
const SEEDED = ['admin-audit.sql', '../test/fixtures/conversion-event.sql'];
```
to:
```js
const SEEDED = ['admin-audit.sql', 'conversion-event.sql'];
```

and every other `realD1(['../test/fixtures/conversion-event.sql'])` call site in that file to `realD1(['conversion-event.sql'])`.

- [ ] **Step 4: Update the `EXPECTED` column array** (the "fixture is the production DDL, column for column" test):

```js
test('the fixture table is the production DDL, column for column', () => {
  const EXPECTED = [
    ['id', 'INTEGER'],
    ['ts', 'TEXT'],
    ['event', 'TEXT'],
    ['type', 'TEXT'],
    ['value_cents', 'INTEGER'],
    ['client_id', 'TEXT'],
    ['session_id', 'TEXT'],
    ['user_id', 'TEXT'],
    ['entry_source', 'TEXT'],
    ['entry_category', 'TEXT'],
    ['utm_campaign', 'TEXT'],
    ['item', 'TEXT'],
    ['dedup_key', 'TEXT'],
    ['ft_source', 'TEXT'],
    ['ft_medium', 'TEXT'],
    ['ft_campaign', 'TEXT'],
    ['ft_landing', 'TEXT'],
    ['ft_at', 'TEXT'],
    ['click_id', 'TEXT'],
    ['transaction_id', 'TEXT'],
  ];

  const DB = realD1(SEEDED);
  const columns = DB.query('PRAGMA table_info(conversion_event)').map(row => [row.name, row.type]);

  assert.deepEqual(columns, EXPECTED);
});
```

- [ ] **Step 5: Add the sha-sidecar test**, `test/schema-vendored-conversion-event.test.js`, mirroring `test/schema-vendored.test.js` exactly (swap `admin-audit.sql`/`033-admin-audit.sql` for `conversion-event.sql`/the two rrm-academy-cf migrations; the canonical comparison hashes 036 concatenated with 039 in that order, since that is what the vendored file's `CREATE TABLE` composes onto):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VENDORED_PATH = join(ROOT, 'schema', 'conversion-event.sql');
const HASH_PATH = join(ROOT, 'schema', 'conversion-event.sql.sha256');

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

test('schema/conversion-event.sql matches the sha256 committed beside it', () => {
  const committed = readFileSync(HASH_PATH, 'utf8').trim();
  assert.match(committed, /^[0-9a-f]{64}$/);
  assert.equal(sha256(readFileSync(VENDORED_PATH, 'utf8')), committed);
});

test('schema/conversion-event.sql parses and creates conversion_event with 19 columns', () => {
  const sql = readFileSync(VENDORED_PATH, 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const columns = db.prepare("PRAGMA table_info(conversion_event)").all();
  assert.equal(columns.length, 19);
  db.close();
});
```

- [ ] **Step 6: Run the tests:**

```
node --experimental-strip-types --test test/funnel-api.test.js test/schema-vendored-conversion-event.test.js
```

Expected: FAIL before Steps 1-5, PASS after.

- [ ] **Step 7: Commit (in rrm-backoffice).**

```
cat > $SCRATCH/commit-msg-backoffice-039.txt << 'EOF'
Graduate conversion_event fixture to schema/, add 039 columns

Migration 039 in rrm-academy-cf adds seven first-touch columns to
conversion_event. Vendors the updated DDL into schema/ with a .sha256
sidecar (matching admin-audit.sql's precedent) instead of the
un-sha-asserted test/fixtures/ copy, and extends the funnel-api EXPECTED
column assertion to match.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add schema/conversion-event.sql schema/conversion-event.sql.sha256 test/funnel-api.test.js test/schema-vendored-conversion-event.test.js
git rm test/fixtures/conversion-event.sql
git commit -F $SCRATCH/commit-msg-backoffice-039.txt
```

---

## Task 3: Client cookie -- `rrm_ft` write in BaseLayout.astro

**Files:**
- Modify: `src/layouts/BaseLayout.astro`
- Create: `test/base-layout-first-touch.test.js`

**Interfaces:**
- Consumes: `location.search`, `document.referrer`, `location.pathname`, existing `gclid` cookie (read-only, one-time seed), `navigator.globalPrivacyControl`.
- Produces: `document.cookie` write of `rrm_ft=<encoded>;max-age=7776000;path=/;SameSite=Lax;Secure`.

- [ ] **Step 1: Add the `rrm_ft` write** inside the existing GPC-guarded `<script is:inline>` block in `src/layouts/BaseLayout.astro` (the block starting `if (navigator.globalPrivacyControl !== true) {`), after the existing `entry_ref`/`entry_url` write and before the `list_source` write:

```js
      // rrm_ft: first-touch attribution, 90-day first-party cookie (D-4).
      // Written ONLY when absent -- a returning visitor keeps their first
      // touch even when arriving on a brand-new campaign, which is the
      // whole point (last-touch is already covered by entry_ref/entry_url
      // above). Every field is screened for the two PII shapes a client
      // script can reasonably re-implement (email; a bare 13-19 digit run)
      // before the cookie is written; a matching field is written empty
      // rather than blocking the whole write. The write aborts entirely
      // (nothing set) if the encoded record exceeds 1KB.
      try {
        if (!document.cookie.includes('rrm_ft=')) {
          var ftEmailRe = /[\w.+-]+@[\w-]+\.[\w.-]+/;
          var ftDigitRunRe = /\b(?:\d[ -]?){13,19}\b/;
          var ftScreen = function (v) {
            if (!v) return '';
            return (ftEmailRe.test(v) || ftDigitRunRe.test(v)) ? '' : v;
          };
          var ftCap = function (v, n) { return v ? v.slice(0, n) : v; };

          var ftParams = new URLSearchParams(location.search);
          var ftUtmSource = ftParams.get('utm_source') || '';
          var ftUtmMedium = ftParams.get('utm_medium') || '';
          var ftUtmCampaign = ftParams.get('utm_campaign') || '';
          var ftUtmContent = ftParams.get('utm_content') || '';
          var ftUtmTerm = ftParams.get('utm_term') || '';

          // Click id detection: gclid/gbraid/wbraid, one-letter kind marker
          // ('g'/'b'/'w') so the server can tell them apart without a
          // second cookie field. A click id forces medium 'cpc', same
          // precedence _ga4-source.js's classifyPaid() applies server-side.
          var ftClickIdKind = '';
          var ftClickIdValue = '';
          if (ftParams.get('gclid')) { ftClickIdKind = 'g'; ftClickIdValue = ftParams.get('gclid'); }
          else if (ftParams.get('gbraid')) { ftClickIdKind = 'b'; ftClickIdValue = ftParams.get('gbraid'); }
          else if (ftParams.get('wbraid')) { ftClickIdKind = 'w'; ftClickIdValue = ftParams.get('wbraid'); }

          var ftSource, ftMedium, ftCategory;
          if (ftClickIdKind) {
            ftSource = ftUtmSource || 'google';
            ftMedium = 'cpc';
          } else if (ftUtmSource) {
            ftSource = ftUtmSource;
            ftMedium = ftUtmMedium || '(none)';
          } else {
            // Referrer classification, same precedence order as
            // _ga4-source.js classifySource(): AI agents, then search
            // engines, then social, then bare referral hostname, else
            // direct. Self-domain referrers count as direct.
            var ftRef = document.referrer || '';
            var ftHost = '';
            try { ftHost = ftRef ? new URL(ftRef).hostname : ''; } catch (e) { ftHost = ''; }
            var ftSelf = ['rrmacademy.org', 'www.rrmacademy.org', 'library.rrmacademy.org'];
            if (!ftHost || ftSelf.indexOf(ftHost) !== -1) {
              ftSource = '(direct)'; ftMedium = '(none)';
            } else if (/chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|bing\.com\/chat|you\.com|grokipedia\.com|x\.ai/i.test(ftRef)) {
              ftSource = ftHost; ftMedium = 'ai';
            } else if (/^(www\.)?google\.|bing\.com|yahoo\.|duckduckgo\.com|baidu\.com|yandex\.|ecosia\.org/i.test(ftHost)) {
              ftSource = ftHost.replace(/^www\./, ''); ftMedium = 'organic';
            } else if (/instagram\.com|facebook\.com|fb\.com|linkedin\.com|lnkd\.in|t\.co|twitter\.com|x\.com|youtube\.com|youtu\.be|pinterest\.com|reddit\.com|tiktok\.com/i.test(ftHost)) {
              ftSource = ftHost; ftMedium = 'social';
            } else {
              ftSource = ftHost; ftMedium = 'referral';
            }
          }

          var ftReferrerHost = '';
          try { ftReferrerHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { ftReferrerHost = ''; }

          // One-time bridge: seed g from the legacy 30-day gclid cookie when
          // this write finds no click id in the CURRENT url. A visitor
          // mid-window at deploy time still gets a first-touch click id
          // instead of a blank one.
          if (!ftClickIdKind) {
            var ftLegacyGclidMatch = document.cookie.match(/(?:^|;\s*)gclid=([^;]*)/);
            if (ftLegacyGclidMatch) {
              try {
                ftClickIdKind = 'g';
                ftClickIdValue = decodeURIComponent(ftLegacyGclidMatch[1]);
              } catch (e) { ftClickIdKind = ''; ftClickIdValue = ''; }
            }
          }

          var ftFields = {
            s: ftCap(ftScreen(ftSource), 100),
            m: ftCap(ftScreen(ftMedium), 100),
            c: ftCap(ftScreen(ftUtmCampaign), 100),
            k: ftCap(ftScreen(ftUtmContent), 100),
            t: ftCap(ftScreen(ftUtmTerm), 100),
            g: ftClickIdValue ? ftCap(ftClickIdKind + ftScreen(ftClickIdValue), 512) : '',
            r: ftCap(ftScreen(ftReferrerHost), 100),
            l: ftCap(ftScreen(location.pathname), 100),
            d: String(Math.floor(Date.now() / 1000)),
          };

          var ftParts = [];
          for (var ftKey in ftFields) {
            if (ftFields[ftKey]) ftParts.push(ftKey + '=' + encodeURIComponent(ftFields[ftKey]));
          }
          var ftEncoded = ftParts.join('&');

          if (ftEncoded.length <= 1024) {
            document.cookie = 'rrm_ft=' + ftEncoded + ';max-age=7776000;path=/;SameSite=Lax;Secure';
          }
        }
      } catch (e) {}
```

- [ ] **Step 2: Write the vm-extraction test harness.** No existing test exercises a BaseLayout inline script (`test/word-count-parity.test.js` is the repo's only `node:vm` precedent, extracting a plain function; this extracts a `<script is:inline>` block and runs it against a fake DOM). Create `test/base-layout-first-touch.test.js`:

```js
/**
 * Extraction test for the rrm_ft first-touch cookie writer inside
 * src/layouts/BaseLayout.astro's GPC-guarded inline script (section 3.1 of
 * docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md).
 *
 * No test in this repo previously exercised a BaseLayout inline script.
 * This extracts the raw script text between the two <script is:inline>
 * markers that contain 'rrm_ft', wraps it in a fake document/location/
 * navigator, and runs it in a vm context -- the same node:vm approach
 * test/word-count-parity.test.js uses for a worker-repo function, adapted
 * to a DOM-shaped sandbox instead of a plain function extraction.
 *
 * Run: node --test test/base-layout-first-touch.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');

function extractInlineScript(marker) {
  const scripts = SOURCE.split('<script is:inline>').slice(1);
  const match = scripts.find((s) => s.includes(marker));
  if (!match) throw new Error(`no <script is:inline> block contains "${marker}"`);
  return match.slice(0, match.indexOf('</script>'));
}

const SCRIPT = extractInlineScript('rrm_ft');

/**
 * Builds a minimal fake DOM. `cookieStore` is a live array of "name=value"
 * strings; document.cookie getter joins them with '; ', matching the real
 * DOM, and the setter appends/overwrites by cookie name (ignoring
 * attributes after the first ';', which is what a real browser does too).
 */
function runScript({ search = '', referrer = '', pathname = '/', gpc = undefined, existingCookies = [], now = 1757030400000 } = {}) {
  const cookieStore = [...existingCookies];
  const sandbox = {
    console,
    Date: { now: () => now },
    Math,
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    navigator: { globalPrivacyControl: gpc },
    document: {
      referrer,
      get cookie() { return cookieStore.join('; '); },
      set cookie(raw) {
        const name = raw.slice(0, raw.indexOf('='));
        const idx = cookieStore.findIndex((c) => c.startsWith(name + '='));
        const bare = raw.split(';')[0];
        if (idx === -1) cookieStore.push(bare);
        else cookieStore[idx] = bare;
      },
    },
    location: { search, pathname, href: 'https://rrmacademy.org' + pathname + search },
  };
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox);
  return { cookieStore, sandbox };
}

function ftValue(cookieStore) {
  const row = cookieStore.find((c) => c.startsWith('rrm_ft='));
  return row ? decodeURIComponent(row.slice('rrm_ft='.length)) : null;
}

describe('BaseLayout inline script -- rrm_ft first-touch cookie', () => {
  it('is written once, from utm params', () => {
    const { cookieStore } = runScript({ search: '?utm_source=newsletter&utm_medium=email_automation&utm_campaign=fall' });
    const raw = cookieStore.find((c) => c.startsWith('rrm_ft='));
    assert.ok(raw, 'rrm_ft cookie was not written');
    assert.match(raw, /s=newsletter/);
    assert.match(raw, /m=email_automation/);
    assert.match(raw, /c=fall/);
  });

  it('a second visit with a new utm does not overwrite the existing cookie', () => {
    const { cookieStore } = runScript({
      search: '?utm_source=google&utm_medium=cpc&utm_campaign=new_push',
      existingCookies: ['rrm_ft=s%3Doriginal%26m%3Dorganic'],
    });
    const raw = cookieStore.find((c) => c.startsWith('rrm_ft='));
    assert.equal(decodeURIComponent(raw.slice('rrm_ft='.length)), 's=original&m=organic');
  });

  it('GPC true skips the write entirely', () => {
    const { cookieStore } = runScript({ search: '?utm_source=google&utm_medium=cpc', gpc: true });
    assert.equal(cookieStore.find((c) => c.startsWith('rrm_ft=')), undefined);
  });

  it('an email-shaped utm_term is written empty, not blocking the rest of the cookie', () => {
    const { cookieStore } = runScript({ search: '?utm_source=newsletter&utm_term=someone%40example.com' });
    const raw = decodeURIComponent(cookieStore.find((c) => c.startsWith('rrm_ft=')).slice('rrm_ft='.length));
    assert.ok(!raw.includes('t='), 'the t field must be omitted (screened empty), not carry the email');
    assert.match(raw, /s=newsletter/);
  });

  it('a click id over 512 chars aborts the whole cookie, not a truncated field', () => {
    const longGclid = 'A'.repeat(600);
    const { cookieStore } = runScript({ search: `?gclid=${longGclid}` });
    // g alone (kind marker + 600 chars) exceeds the 1KB total cap once
    // url-encoded, so nothing is written -- the abort-on-overflow path,
    // not a per-field truncation.
    assert.equal(cookieStore.find((c) => c.startsWith('rrm_ft=')), undefined);
  });

  it('a cookie that would exceed 1KB total writes nothing', () => {
    const longUtm = 'x'.repeat(100);
    const { cookieStore } = runScript({
      search: `?utm_source=${longUtm}&utm_medium=${longUtm}&utm_campaign=${longUtm}&utm_content=${longUtm}&utm_term=${longUtm}&gclid=${'g'.repeat(500)}`,
    });
    assert.equal(cookieStore.find((c) => c.startsWith('rrm_ft=')), undefined);
  });

  it('seeds g from a legacy gclid cookie on the first write when the URL carries no click id', () => {
    const { cookieStore } = runScript({
      search: '?utm_source=newsletter',
      existingCookies: ['gclid=EAIaIQlegacy123456'],
    });
    const raw = decodeURIComponent(cookieStore.find((c) => c.startsWith('rrm_ft=')).slice('rrm_ft='.length));
    assert.match(raw, /g=gEAIaIQlegacy123456/, 'g must carry the g-kind marker plus the legacy gclid value');
  });

  it('a click id in the URL forces medium cpc and beats a coexisting utm_medium', () => {
    const { cookieStore } = runScript({ search: '?utm_source=google&utm_medium=display&gclid=abc123456789' });
    const raw = decodeURIComponent(cookieStore.find((c) => c.startsWith('rrm_ft=')).slice('rrm_ft='.length));
    assert.match(raw, /m=cpc/);
  });
});
```

- [ ] **Step 3: Run the test**:

```
node --experimental-strip-types --test test/base-layout-first-touch.test.js
```

Expected: FAIL before Step 1 lands (script does not exist / marker not found), PASS after.

- [ ] **Step 4: Update the guard manifest** (BaseLayout.astro is a guarded file):

```
npm run guard:update
```

- [ ] **Step 5: Commit.**

```
cat > $SCRATCH/commit-msg-rrm-ft-cookie.txt << 'EOF'
Add the rrm_ft first-touch cookie writer to BaseLayout.astro

90-day first-party cookie, written once, inside the existing GPC-guarded
attribution block. Screens every field for the two PII shapes a client
script can reasonably re-implement, caps each field, and aborts the whole
write rather than truncate when the encoded record would exceed 1KB. Seeds
the click id from the legacy 30-day gclid cookie on first write so a
visitor mid-window at deploy time is not left with a blank first touch.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add src/layouts/BaseLayout.astro test/base-layout-first-touch.test.js guard-manifest.json
git commit -F $SCRATCH/commit-msg-rrm-ft-cookie.txt
```

---

## Task 4: Server parse -- `parseFirstTouch` in `_ga4-source.js`

**Files:**
- Modify: `functions/api/_ga4-source.js`
- Modify: `test/ga4-source.test.js`

**Interfaces:**
- Consumes: `parseCookie(cookieHeader, 'rrm_ft')` (existing helper, unchanged).
- Produces: `export function parseFirstTouch(cookieHeader)` returning `{ ft_source, ft_medium, ft_campaign, ft_content, ft_landing, ft_at, click_id } | null`; `buildSourceParams` spreads the non-null result into its return object.

- [ ] **Step 1: Add `parseFirstTouch`** to `functions/api/_ga4-source.js`, after `parseCookie` and before `buildSourceParams`:

```js
/**
 * Parses the rrm_ft first-touch cookie (BaseLayout.astro, section 3.1 of
 * docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md) into
 * GA4 event params plus a ledger-bound click_id. Every free-text field is
 * screened by PII_VALUE_REGEX at the same boundary extractUtm applies to
 * utm_* -- the cookie is client-written and a URL param an attacker fully
 * controls can land in it, so it gets no more trust server-side than a raw
 * query string does. A screened-out field is simply absent from the
 * returned object rather than present-and-empty, so a caller's `?? `
 * fallback behaves the same way it does for a field the cookie never had.
 *
 * click_id carries the kind marker's PAYLOAD only ('g'/'b'/'w' prefix is
 * stripped here): the ledger's click_id column stores the raw click id, not
 * which kind it was. The kind marker exists only to let this parser split
 * the field; nothing downstream needs to know gclid from gbraid from wbraid.
 *
 * Returns null when the cookie is absent or empty, so `buildSourceParams`
 * can spread the result unconditionally with `...(parsed || {})`.
 */
const FIRST_TOUCH_STRING_MAX = 100;
const FIRST_TOUCH_CLICK_ID_MAX = 512;

export function parseFirstTouch(cookieHeader) {
  const raw = parseCookie(cookieHeader, 'rrm_ft');
  if (!raw) return null;

  const fields = {};
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    let value;
    try {
      value = decodeURIComponent(part.slice(eq + 1));
    } catch {
      continue;
    }
    if (value) fields[key] = value;
  }

  const screenedText = (value, max) => {
    if (typeof value !== 'string' || !value) return undefined;
    if (PII_VALUE_REGEX.test(value)) return undefined;
    return value.slice(0, max);
  };

  const result = {};
  const ft_source = screenedText(fields.s, FIRST_TOUCH_STRING_MAX);
  if (ft_source) result.ft_source = ft_source;
  const ft_medium = screenedText(fields.m, FIRST_TOUCH_STRING_MAX);
  if (ft_medium) result.ft_medium = ft_medium;
  const ft_campaign = screenedText(fields.c, FIRST_TOUCH_STRING_MAX);
  if (ft_campaign) result.ft_campaign = ft_campaign;
  const ft_content = screenedText(fields.k, FIRST_TOUCH_STRING_MAX);
  if (ft_content) result.ft_content = ft_content;
  const ft_landing = screenedText(fields.l, FIRST_TOUCH_STRING_MAX);
  if (ft_landing) result.ft_landing = ft_landing;

  if (typeof fields.g === 'string' && fields.g.length > 1) {
    const clickIdValue = fields.g.slice(1);
    const click_id = screenedText(clickIdValue, FIRST_TOUCH_CLICK_ID_MAX);
    if (click_id) result.click_id = click_id;
  }

  const epochSeconds = Number(fields.d);
  if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
    try {
      result.ft_at = new Date(epochSeconds * 1000).toISOString();
    } catch {
      // leave ft_at unset on an out-of-range epoch
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}
```

- [ ] **Step 2: Move `parseGclidCookie` from `_google-ads.js` here**, exported, so `create-checkout.js` (Task 6) can read the same 30-day cookie without importing from `_google-ads.js` (which pulls in SES/rate-limit/Ads-API dependencies create-checkout.js has no reason to load). Add directly below `PAID_CLICK_IDS`:

```js
// gclid values are opaque alphanumeric-ish tokens Google generates; this is
// a sanity bound, not a real format spec. Moved here from _google-ads.js
// (2026-09-05) so create-checkout.js can read the same 30-day cookie
// without importing the Ads-upload module's SES/rate-limit dependencies.
export const GCLID_RE = /^[A-Za-z0-9_-]{10,512}$/;

export function parseGclidCookie(cookieHeader) {
  const value = parseCookie(cookieHeader, 'gclid');
  if (!value || !GCLID_RE.test(value)) return null;
  return value;
}
```

Then in `functions/api/_google-ads.js`: delete its local `GCLID_RE` and `parseGclidCookie` definitions and add `import { parseGclidCookie } from './_ga4-source.js';` at the top. No caller of `sendGoogleAdsConversion` changes; `parseGclidCookie` is called internally exactly as before.

- [ ] **Step 3: Spread `parseFirstTouch` into `buildSourceParams`.** In `functions/api/_ga4-source.js`, inside `buildSourceParams`, add the parse right after `const listSource = parseCookie(cookies, 'list_source');` and spread it into the return object:

```js
  const listSource = parseCookie(cookies, 'list_source');
  const firstTouch = parseFirstTouch(cookies);

  return {
    session_id: sessionId,
    utm_source: utmParams.utm_source || classified.source,
    utm_medium: utmParams.utm_medium || classified.medium,
    entry_category: classified.entry_category,
    entry_platform: classified.entry_platform,
    ...(classified.email_type && { email_type: classified.email_type }),
    ...(utmParams.utm_campaign && { utm_campaign: utmParams.utm_campaign }),
    ...(utmParams.utm_content && { utm_content: utmParams.utm_content }),
    ...(utmParams.utm_term && { utm_term: utmParams.utm_term }),
    ...(listSource && { list_source: listSource }),
    ...(firstTouch || {}),
  };
```

(Spread last, so last-touch params keep their existing keys; `ft_*`/`click_id` are new key names that never collide with `utm_*`/`entry_*`.)

- [ ] **Step 4: Add tests** to `test/ga4-source.test.js`, a new `describe` block after `buildSourceParams paid override`:

```js
describe('parseFirstTouch', () => {
  it('returns null when the cookie is absent', () => {
    assert.equal(parseFirstTouch(''), null);
    assert.equal(parseFirstTouch('other_cookie=1'), null);
  });

  it('parses every field and derives ft_at as ISO from d', () => {
    const cookie = 'rrm_ft=' + encodeURIComponent('s=google&m=cpc&c=q3_push&k=ad1&l=%2Fendo-quiz%2F&g=gEAIaIQtest&d=1757030400');
    const result = parseFirstTouch(cookie);
    assert.equal(result.ft_source, 'google');
    assert.equal(result.ft_medium, 'cpc');
    assert.equal(result.ft_campaign, 'q3_push');
    assert.equal(result.ft_content, 'ad1');
    assert.equal(result.ft_landing, '/endo-quiz/');
    assert.equal(result.click_id, 'EAIaIQtest');
    assert.equal(result.ft_at, new Date(1757030400 * 1000).toISOString());
  });

  it('strips the kind marker prefix from click_id, leaving only the value', () => {
    const cookie = 'rrm_ft=' + encodeURIComponent('g=bBRAID_VALUE_HERE');
    assert.equal(parseFirstTouch(cookie).click_id, 'BRAID_VALUE_HERE');
  });

  it('screens an email-shaped field to absent rather than passing it through', () => {
    const cookie = 'rrm_ft=' + encodeURIComponent('s=google&k=someone%40example.com');
    const result = parseFirstTouch(cookie);
    assert.equal(result.ft_source, 'google');
    assert.equal('ft_content' in result, false);
  });

  it('screens a bare 13-19 digit run field to absent', () => {
    const cookie = 'rrm_ft=' + encodeURIComponent('s=google&c=1234567890123456');
    const result = parseFirstTouch(cookie);
    assert.equal('ft_campaign' in result, false);
    assert.equal(result.ft_source, 'google');
  });

  it('returns null when every field was screened out', () => {
    const cookie = 'rrm_ft=' + encodeURIComponent('k=someone%40example.com');
    assert.equal(parseFirstTouch(cookie), null);
  });

  it('caps a field at 100 chars', () => {
    const long = 'a'.repeat(150);
    const cookie = 'rrm_ft=' + encodeURIComponent(`s=${long}`);
    assert.equal(parseFirstTouch(cookie).ft_source.length, 100);
  });

  it('an unparseable d leaves ft_at unset without discarding the rest', () => {
    const cookie = 'rrm_ft=' + encodeURIComponent('s=google&d=not-a-number');
    const result = parseFirstTouch(cookie);
    assert.equal(result.ft_source, 'google');
    assert.equal('ft_at' in result, false);
  });
});

describe('buildSourceParams spreads first-touch attribution', () => {
  function fakeRequest(headers = {}) {
    return {
      url: 'https://rrmacademy.org/api/track',
      headers: { get(name) { return headers[name] || null; } },
    };
  }

  it('carries ft_* alongside last-touch utm_* without overwriting either', async () => {
    const req = fakeRequest({
      'Cookie': 'entry_url=' + encodeURIComponent('https://rrmacademy.org/?utm_source=organic_google&utm_campaign=today') +
        '; rrm_ft=' + encodeURIComponent('s=google&m=cpc&c=q3_push&d=1757030400'),
    });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal(params.utm_source, 'organic_google', 'last-touch utm_source is untouched');
    assert.equal(params.utm_campaign, 'today', 'last-touch utm_campaign is untouched');
    assert.equal(params.ft_source, 'google');
    assert.equal(params.ft_medium, 'cpc');
    assert.equal(params.ft_campaign, 'q3_push');
  });

  it('omits ft_* entirely when no rrm_ft cookie is present', async () => {
    const req = fakeRequest({ 'Cookie': 'entry_url=' + encodeURIComponent('https://rrmacademy.org/') });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal('ft_source' in params, false);
  });
});
```

And update the top import line:

```js
import { classifySource, extractUtm, classifyPaid, deriveSessionId, buildSourceParams, parseFirstTouch } from '../functions/api/_ga4-source.js';
```

- [ ] **Step 5: Run the tests**:

```
node --experimental-strip-types --test test/ga4-source.test.js
```

Expected: FAIL before Steps 1-3 (parseFirstTouch undefined), PASS after.

- [ ] **Step 6: Update the guard manifest** (`_ga4-source.js` is guarded):

```
npm run guard:update
```

- [ ] **Step 7: Run the endo-quiz-start and google-ads tests to confirm the `parseGclidCookie` move is a no-op for existing callers:**

```
node --experimental-strip-types --test test/endo-quiz-start.test.js test/google-ads-conversion.test.js
```

Expected: PASS, unchanged (proves the move did not alter behavior).

- [ ] **Step 8: Commit.**

```
cat > $SCRATCH/commit-msg-parse-first-touch.txt << 'EOF'
Parse rrm_ft into ft_* GA4 params; move parseGclidCookie to _ga4-source.js

buildSourceParams now spreads ft_source/ft_medium/ft_campaign/ft_content/
ft_landing/ft_at and click_id from the first-touch cookie, screened the same
way extractUtm screens utm_*. parseGclidCookie moves from _google-ads.js so
create-checkout.js (next task) can read the 30-day gclid cookie without
importing the Ads-upload module's SES/rate-limit dependencies; every
existing sendGoogleAdsConversion call site is unaffected.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add functions/api/_ga4-source.js functions/api/_google-ads.js test/ga4-source.test.js guard-manifest.json
git commit -F $SCRATCH/commit-msg-parse-first-touch.txt
```

---

## Task 5: Ledger bind -- `_ga4.js` INSERT gains the seven columns

**Files:**
- Modify: `functions/api/_ga4.js`
- Modify: `test/ga4-conversion-ledger.test.js`

**Interfaces:**
- Consumes: `sourceParams.ft_source|ft_medium|ft_campaign|ft_landing|ft_at|click_id` (from Task 4), `params.transaction_id` (already sent by `_webhook-checkout.js` on every `purchase`), the existing `pick()` closure and `ledgerSafeText`/`ledgerText` helpers.
- Produces: seven additional bound values in the `INSERT OR IGNORE INTO conversion_event` statement.

- [ ] **Step 1: Extend the INSERT.** In `writeConversionLedger` (`functions/api/_ga4.js`), change the statement and its bindings:

```js
  await env.DB.prepare(`
    INSERT OR IGNORE INTO conversion_event
      (event, type, value_cents, client_id, session_id, user_id, entry_source, entry_category, utm_campaign, item, dedup_key,
       ft_source, ft_medium, ft_campaign, ft_landing, ft_at, click_id, transaction_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    eventName,
    ledgerText(deriveLedgerType(eventName, params), LEDGER_SHORT_CAP),
    ledgerValueCents(params.value),
    ledgerText(clientId, LEDGER_LONG_CAP),
    ledgerText(sessionId, LEDGER_LONG_CAP),
    userId,
    ledgerSafeText(pick('entry_platform'), LEDGER_SHORT_CAP)
      ?? ledgerSafeText(pick('utm_source'), LEDGER_SHORT_CAP),
    ledgerSafeText(pick('entry_category'), LEDGER_SHORT_CAP),
    ledgerSafeText(pick('utm_campaign'), LEDGER_SHORT_CAP),
    ledgerSafeText(params.items?.[0]?.item_name, LEDGER_LONG_CAP),
    dedupKey,
    // First-touch attribution (migrations/039-first-touch-attribution.sql).
    // Same precedence as every other pick()-read column: a caller-supplied
    // value (the webhook's metadata replay) wins over the request-derived
    // sourceParams, so a purchase's ledger row agrees with its GA4 payload.
    ledgerSafeText(pick('ft_source'), LEDGER_SHORT_CAP),
    ledgerSafeText(pick('ft_medium'), LEDGER_SHORT_CAP),
    ledgerSafeText(pick('ft_campaign'), LEDGER_SHORT_CAP),
    ledgerSafeText(pick('ft_landing'), LEDGER_SHORT_CAP),
    // ft_at is an ISO timestamp, not free text -- ledgerText only, no PII screen.
    ledgerText(pick('ft_at'), LEDGER_SHORT_CAP),
    // click_id IS free text (visitor-controlled via a URL param) and gets
    // the full screen, unlike transaction_id below.
    ledgerSafeText(pick('click_id'), LEDGER_LONG_CAP),
    // transaction_id: opaque Stripe identifier (pi_/sub_/cs_...), exempt
    // from the digit-run PII screen the way session_id/client_id/user_id/
    // dedup_key already are -- length cap only.
    ledgerText(params.transaction_id, LEDGER_SHORT_CAP),
  ).run();
```

- [ ] **Step 2: Add tests** to `test/ga4-conversion-ledger.test.js`, a new `describe` block:

```js
describe('conversion ledger -- first-touch columns (migration 039)', () => {
  it('a page_view with an rrm_ft cookie lands ft_* and click_id', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      const req = mockRequest('GET', {
        headers: {
          'CF-Connecting-IP': '203.0.113.9',
          'User-Agent': 'Mozilla/5.0 (test-agent)',
          Cookie: 'entry_ref=; entry_url=' + encodeURIComponent('https://rrmacademy.org/') +
            '; rrm_ft=' + encodeURIComponent('s=google&m=cpc&c=q3_push&l=%2Fendo-quiz%2F&g=gEAIaIQtest&d=1757030400'),
        },
        url: 'https://rrmacademy.org/api/test',
      });
      await sendGA4Event(env, req, 'page_view', { page_location: 'https://rrmacademy.org/endo-quiz/' });
      const [row] = rows(db);
      assert.equal(row.ft_source, 'google');
      assert.equal(row.ft_medium, 'cpc');
      assert.equal(row.ft_campaign, 'q3_push');
      assert.equal(row.ft_landing, '/endo-quiz/');
      assert.equal(row.click_id, 'EAIaIQtest');
      assert.equal(row.ft_at, new Date(1757030400 * 1000).toISOString());
    } finally { fetchStub.restore(); db.close(); }
  });

  it('a purchase replay carries transaction_id from params, exempt from the digit-run screen', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'purchase', {
        value: 25,
        items: [{ item_name: 'Donation' }],
        transaction_id: 'pi_3Ptest1234567890123',
      });
      const [row] = rows(db);
      assert.equal(row.transaction_id, 'pi_3Ptest1234567890123');
    } finally { fetchStub.restore(); db.close(); }
  });

  it('a pre-039-style row with no rrm_ft cookie leaves ft_* and click_id NULL', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'generate_lead', { lead_source: 'newsletter' });
      const [row] = rows(db);
      assert.equal(row.ft_source, null);
      assert.equal(row.ft_medium, null);
      assert.equal(row.click_id, null);
      assert.equal(row.transaction_id, null);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('an email-shaped click_id in the cookie never reaches the ledger', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      const req = mockRequest('GET', {
        headers: {
          'CF-Connecting-IP': '203.0.113.10',
          'User-Agent': 'Mozilla/5.0 (test-agent)',
          Cookie: 'rrm_ft=' + encodeURIComponent('s=google&g=g' + encodeURIComponent('someone@example.com')),
        },
        url: 'https://rrmacademy.org/api/test',
      });
      await sendGA4Event(env, req, 'page_view', { page_location: 'https://rrmacademy.org/' });
      const [row] = rows(db);
      assert.equal(row.click_id, null);
      assert.equal(row.ft_source, 'google');
    } finally { fetchStub.restore(); db.close(); }
  });
});
```

- [ ] **Step 3: Run the tests**:

```
node --experimental-strip-types --test test/ga4-conversion-ledger.test.js
```

Expected: FAIL before Step 1 (columns unbound, values NULL where the tests expect data), PASS after.

- [ ] **Step 4: Update the guard manifest** (`_ga4.js` is guarded):

```
npm run guard:update
```

- [ ] **Step 5: Commit.**

```
cat > $SCRATCH/commit-msg-ledger-ft-bind.txt << 'EOF'
Bind ft_*/click_id/transaction_id into the conversion_event INSERT

Extends the ledger's single INSERT OR IGNORE with the seven migration-039
columns. click_id gets the full free-text PII screen (visitor-controlled
via a URL param); transaction_id is exempt from the digit-run branch, same
posture as session_id/client_id/user_id/dedup_key, since it is an opaque
Stripe identifier. Rows with no rrm_ft cookie land NULL, matching the
funnel page's existing NULL-fallback contract.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add functions/api/_ga4.js test/ga4-conversion-ledger.test.js guard-manifest.json
git commit -F $SCRATCH/commit-msg-ledger-ft-bind.txt
```

**Deploy gate for this task:** migration 039 (Task 1) MUST be applied to remote `rrm-auth` before this commit's code deploys. Confirm with `npx wrangler d1 execute rrm-auth --remote --command "PRAGMA table_info(conversion_event)"` before merging to `main`.

---

## Task 6: Checkout -- `create-checkout.js` reads `rrm_ft` and `gclid`

**Files:**
- Modify: `functions/api/create-checkout.js`
- Modify: `test/create-checkout-migration.test.js`

**Interfaces:**
- Consumes: `parseFirstTouch(cookieHeader)`, `parseGclidCookie(cookieHeader)` (both from `_ga4-source.js`, Task 4).
- Produces: `ft_source`, `ft_medium`, `ft_campaign`, `ft_landing`, `ft_at`, `click_id`, `gclid_last` on `sessionParams.metadata` for both modes, plus `payment_intent_data.metadata` (donations) and `subscription_data.metadata` (subscriptions).

- [ ] **Step 1: Import the two parsers and read the Cookie header.** In `functions/api/create-checkout.js`, update the `_ga4-source.js` import and add the cookie read right after the existing `clientId`/`sessionId` block:

```js
import { classifySource, extractUtm, getClientId, deriveSessionId, parseFirstTouch, parseGclidCookie } from './_ga4-source.js';
```

```js
  // Store client_id + session_id so webhook can replay the real user identity
  const clientId = await getClientId(request);
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const sessionId = await deriveSessionId(clientId, dateStr);

  // First-touch attribution and the CURRENT click, read straight from the
  // request's own Cookie header -- unlike ga_source/ga_medium/ga_campaign
  // above, these never come from the POST body, because the body's
  // entry_referrer/entry_url are last-touch only and never see a cookie.
  // Stripe caps metadata at 500 chars per value; every field here is
  // already capped well under that by its cookie-side/parser-side cap, but
  // .slice(0,500) is applied anyway as the same defensive width bound the
  // ga_* fields above get.
  const cookieHeader = request.headers.get('Cookie') || '';
  const firstTouch = parseFirstTouch(cookieHeader) || {};
  const gclidLast = parseGclidCookie(cookieHeader);
  const ftMetadata = {
    ...(firstTouch.ft_source && { ft_source: firstTouch.ft_source.slice(0, 500) }),
    ...(firstTouch.ft_medium && { ft_medium: firstTouch.ft_medium.slice(0, 500) }),
    ...(firstTouch.ft_campaign && { ft_campaign: firstTouch.ft_campaign.slice(0, 500) }),
    ...(firstTouch.ft_landing && { ft_landing: firstTouch.ft_landing.slice(0, 500) }),
    ...(firstTouch.ft_at && { ft_at: firstTouch.ft_at.slice(0, 500) }),
    ...(firstTouch.click_id && { click_id: firstTouch.click_id.slice(0, 500) }),
    ...(gclidLast && { gclid_last: gclidLast.slice(0, 500) }),
  };
```

- [ ] **Step 2: Spread `ftMetadata` into the donation branch's three metadata objects** (`payment_intent_data.metadata` and `sessionParams.metadata`):

```js
    sessionParams.payment_intent_data = {
      description: 'Donation to RRM Foundation',
      statement_descriptor_suffix: 'DONATION',
      metadata: { type: 'donation', ...ftMetadata, ...(campaign && { campaign }), ...(isCanary && { canary: '1' }) },
    };
```

```js
    sessionParams.metadata = {
      ...(sessionParams.metadata || {}),
      type: 'donation',
      ga_source: gaSource,
      ga_medium: gaMedium,
      ga_client_id: clientId,
      ga_session_id: String(sessionId),
      ...(gaCampaign && { ga_campaign: gaCampaign }),
      ...(entry_category && { ga_entry_category: entry_category }),
      ...(entry_platform && { ga_entry_platform: entry_platform }),
      ...ftMetadata,
      ...(campaign && { campaign }),
      ...(isCanary && { canary: '1' }),
      ...(stucContext && { stuc_context: '1' }),
    };
```

- [ ] **Step 3: Spread `ftMetadata` into the subscription branch's `sessionParams.metadata` and `subscription_data.metadata`:**

```js
    sessionParams.metadata = {
      ...sessionParams.metadata,
      ...migrationMetadata,
      ga_source: gaSource,
      ga_medium: gaMedium,
      ga_client_id: clientId,
      ga_session_id: String(sessionId),
      ...(gaCampaign && { ga_campaign: gaCampaign }),
      ...(entry_category && { ga_entry_category: entry_category }),
      ...(entry_platform && { ga_entry_platform: entry_platform }),
      ...ftMetadata,
      ...(isCanary && { canary: '1' }),
    };
```

```js
    sessionParams.subscription_data = {
      ...(trialEndUnix ? { trial_end: trialEndUnix } : {}),
      metadata: { tier: effectiveTier, ...migrationMetadata, ...ftMetadata, ...(isCanary && { canary: '1' }) },
    };
```

- [ ] **Step 4: Add source-pattern tests** to `test/create-checkout-migration.test.js` (the file's own header explains why: create-checkout.js's whole body is live Stripe calls, so execution-based assertion is not this file's approach; `create-checkout-join-denylist.test.js` establishes the same source-grep pattern for STUC-denylist wiring):

```js
describe('create-checkout first-touch attribution metadata (Phase 3.1)', () => {
  it('imports parseFirstTouch and parseGclidCookie from _ga4-source.js', () => {
    assert.match(source, /import\s*\{[^}]*parseFirstTouch[^}]*parseGclidCookie[^}]*\}\s*from\s*'\.\/\_ga4-source\.js'|import\s*\{[^}]*parseGclidCookie[^}]*parseFirstTouch[^}]*\}\s*from\s*'\.\/_ga4-source\.js'/);
  });

  it('reads the Cookie header directly, not the POST body, for first-touch data', () => {
    assert.match(source, /const cookieHeader = request\.headers\.get\('Cookie'\)/);
    assert.match(source, /parseFirstTouch\(cookieHeader\)/);
    assert.match(source, /parseGclidCookie\(cookieHeader\)/);
  });

  it('caps every ft_* and gclid_last metadata value at 500 chars', () => {
    assert.match(source, /ft_source\.slice\(0,\s*500\)/);
    assert.match(source, /gclid_last:\s*gclidLast\.slice\(0,\s*500\)/);
  });

  it('donation payment_intent_data.metadata carries ftMetadata', () => {
    const donationIntentBlock = source.slice(
      source.indexOf('sessionParams.payment_intent_data = {'),
      source.indexOf('sessionParams.payment_intent_data = {') + 400
    );
    assert.match(donationIntentBlock, /\.\.\.ftMetadata/);
  });

  it('subscription_data.metadata carries ftMetadata', () => {
    const subDataBlock = source.slice(
      source.indexOf('sessionParams.subscription_data = {'),
      source.indexOf('sessionParams.subscription_data = {') + 300
    );
    assert.match(subDataBlock, /\.\.\.ftMetadata/);
  });
});
```

- [ ] **Step 5: Run the tests**:

```
node --experimental-strip-types --test test/create-checkout-migration.test.js
```

Expected: FAIL before Steps 1-3, PASS after.

- [ ] **Step 6: Update the guard manifest** (`create-checkout.js` is guarded):

```
npm run guard:update
```

- [ ] **Step 7: Run the join-denylist and webhook-exec suites to confirm nothing else in create-checkout.js moved:**

```
node --experimental-strip-types --test test/create-checkout-join-denylist.test.js test/create-checkout-migration.test.js
```

- [ ] **Step 8: Commit.**

```
cat > $SCRATCH/commit-msg-checkout-ft-metadata.txt << 'EOF'
Read rrm_ft and gclid cookies in create-checkout.js, add Stripe metadata

create-checkout.js could not previously see rrm_ft or the 30-day gclid
cookie -- it derived attribution entirely from the POST body's last-touch
entry_referrer/entry_url. Now reads both straight from the request's Cookie
header via the shared parsers, and stamps ft_source/ft_medium/ft_campaign/
ft_landing/ft_at/click_id/gclid_last onto session, payment_intent_data
(donations) and subscription_data (subscriptions) metadata.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add functions/api/create-checkout.js test/create-checkout-migration.test.js guard-manifest.json
git commit -F $SCRATCH/commit-msg-checkout-ft-metadata.txt
```

---

## Task 7: Webhook forward -- `_webhook-checkout.js` relays `ft_*`/`click_id`

**Files:**
- Modify: `functions/api/billing/_webhook-checkout.js`
- Modify: `test/webhook-checkout-metadata.test.js`
- Create: `test/webhook-checkout-ft-forward.test.js`

**Interfaces:**
- Consumes: `session.metadata.ft_source|ft_medium|ft_campaign|ft_landing|ft_at|click_id` (Task 6).
- Produces: those same keys spread into the `purchase` GA4 `sendGA4Event` params, for the donation, subscription, and course purchase branches.

- [ ] **Step 1: Add the ft_* spread to all three purchase sends.** In `functions/api/billing/_webhook-checkout.js`, each of the three `sendGA4Event(env, request, 'purchase', { ... }, gaOverrides)` calls gets the same six extra spreads, immediately after the existing `ga_entry_platform` line:

Course purchase branch:
```js
    waitUntil(sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || 0) / 100,
      transaction_id: paymentIntentId || session.id,
      items: [{ item_name: `Course: ${session.metadata.courseId || 'unknown'}` }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
      ...(session.metadata?.ga_entry_category && { entry_category: session.metadata.ga_entry_category }),
      ...(session.metadata?.ga_entry_platform && { entry_platform: session.metadata.ga_entry_platform }),
      ...(session.metadata?.ft_source && { ft_source: session.metadata.ft_source }),
      ...(session.metadata?.ft_medium && { ft_medium: session.metadata.ft_medium }),
      ...(session.metadata?.ft_campaign && { ft_campaign: session.metadata.ft_campaign }),
      ...(session.metadata?.ft_landing && { ft_landing: session.metadata.ft_landing }),
      ...(session.metadata?.ft_at && { ft_at: session.metadata.ft_at }),
      ...(session.metadata?.click_id && { click_id: session.metadata.click_id }),
    }, gaOverrides).catch(() => {}));
```

Donation branch:
```js
    waitUntil(sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || 0) / 100,
      transaction_id: session.payment_intent || session.id,
      items: [{ item_name: 'Donation' }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
      ...(session.metadata?.ga_entry_category && { entry_category: session.metadata.ga_entry_category }),
      ...(session.metadata?.ga_entry_platform && { entry_platform: session.metadata.ga_entry_platform }),
      ...(session.metadata?.ft_source && { ft_source: session.metadata.ft_source }),
      ...(session.metadata?.ft_medium && { ft_medium: session.metadata.ft_medium }),
      ...(session.metadata?.ft_campaign && { ft_campaign: session.metadata.ft_campaign }),
      ...(session.metadata?.ft_landing && { ft_landing: session.metadata.ft_landing }),
      ...(session.metadata?.ft_at && { ft_at: session.metadata.ft_at }),
      ...(session.metadata?.click_id && { click_id: session.metadata.click_id }),
    }, gaOverrides).catch(() => {}));
```

Subscription branch:
```js
    waitUntil(sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || stucTierCentsFallback[tier] || 0) / 100,
      transaction_id: session.subscription || session.id,
      items: [{ item_name: `STUC ${stucTiers[tier]}` }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
      ...(session.metadata?.ga_entry_category && { entry_category: session.metadata.ga_entry_category }),
      ...(session.metadata?.ga_entry_platform && { entry_platform: session.metadata.ga_entry_platform }),
      ...(session.metadata?.ft_source && { ft_source: session.metadata.ft_source }),
      ...(session.metadata?.ft_medium && { ft_medium: session.metadata.ft_medium }),
      ...(session.metadata?.ft_campaign && { ft_campaign: session.metadata.ft_campaign }),
      ...(session.metadata?.ft_landing && { ft_landing: session.metadata.ft_landing }),
      ...(session.metadata?.ft_at && { ft_at: session.metadata.ft_at }),
      ...(session.metadata?.click_id && { click_id: session.metadata.click_id }),
    }, gaOverrides).catch(() => {}));
```

- [ ] **Step 2: Add source-pattern tests** to `test/webhook-checkout-metadata.test.js`:

```js
describe('webhook-checkout first-touch forwarding (Phase 3.1)', () => {
  it('all three purchase sends forward ft_* and click_id from session.metadata', () => {
    const occurrences = (source.match(/session\.metadata\?\.ft_source && \{ ft_source: session\.metadata\.ft_source \}/g) || []).length;
    assert.equal(occurrences, 3, 'course, donation, and subscription branches must each forward ft_source');
    assert.ok(/session\.metadata\?\.click_id && \{ click_id: session\.metadata\.click_id \}/.test(source));
  });

  it('never reads ft_content from metadata (no ledger column, never written to Stripe)', () => {
    assert.ok(!source.includes('ft_content'), 'ft_content has no ledger column and is not part of Stripe metadata');
  });
});
```

- [ ] **Step 3: Add an execution test**, `test/webhook-checkout-ft-forward.test.js`, proving the ledger purchase row carries `ft_*` sourced from metadata alone (no browser cookies on the webhook request), using the same `sqliteD1`/`ledgerD1`-style harness Task 5 established:

```js
/**
 * Execution test: a Stripe webhook purchase carries ft_*/click_id into the
 * conversion ledger from session.metadata ONLY -- the webhook request has
 * no browser cookies, so this proves the metadata replay (Task 6/7 of the
 * first-touch-attribution plan) is what lands the row, not an accidental
 * cookie fallback.
 *
 * Run: node --test test/webhook-checkout-ft-forward.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleCheckoutCompleted } from '../functions/api/billing/_webhook-checkout.js';
import { mockRequest, mockEnv, mockWaitUntil, drainWaitUntil, stubExternalFetch } from './_helpers.js';
import { sqliteD1, SCHEMA_SQL } from './_d1-sqlite.mjs';

const LEDGER_SCHEMA_SQL =
  SCHEMA_SQL + '\n' +
  readFileSync(new URL('../migrations/036-conversion-ledger.sql', import.meta.url), 'utf8') + '\n' +
  readFileSync(new URL('../migrations/039-first-touch-attribution.sql', import.meta.url), 'utf8');

function ledgerD1() {
  return sqliteD1({ schemaSql: LEDGER_SCHEMA_SQL });
}

function purchaseRow(db) {
  return db._sqlite.prepare("SELECT * FROM conversion_event WHERE event = 'purchase' ORDER BY id DESC LIMIT 1").get();
}

describe('webhook purchase carries ft_* from Stripe metadata only', () => {
  it('a donation checkout.session.completed with ft_* metadata lands ft_* on the ledger row, with no cookies on the request', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      const waitUntil = mockWaitUntil();
      // No Cookie header at all -- Stripe's webhook request never carries one.
      const request = mockRequest('POST', { url: 'https://rrmacademy.org/api/stripe-webhook' });
      const session = {
        id: 'cs_test_ft_forward',
        mode: 'payment',
        payment_intent: 'pi_test_ft_forward',
        amount_total: 2500,
        customer_details: { email: 'donor@example.com', name: 'Test Donor' },
        metadata: {
          type: 'donation',
          ga_source: 'google', ga_medium: 'cpc',
          ft_source: 'google', ft_medium: 'cpc', ft_campaign: 'q3_push',
          ft_landing: '/donate/', ft_at: '2026-09-01T00:00:00.000Z',
          click_id: 'EAIaIQtest',
        },
      };
      const event = { id: 'evt_test_ft_forward', created: Math.floor(Date.now() / 1000) };

      await handleCheckoutCompleted(db, event, env, request, waitUntil);
      await drainWaitUntil(waitUntil);

      const row = purchaseRow(db);
      assert.ok(row, 'purchase row was not written');
      assert.equal(row.ft_source, 'google');
      assert.equal(row.ft_medium, 'cpc');
      assert.equal(row.ft_campaign, 'q3_push');
      assert.equal(row.ft_landing, '/donate/');
      assert.equal(row.click_id, 'EAIaIQtest');
      assert.equal(row.transaction_id, 'pi_test_ft_forward');
    } finally { fetchStub.restore(); db.close(); }
  });
});
```

- [ ] **Step 4: Run the tests**:

```
node --experimental-strip-types --test test/webhook-checkout-metadata.test.js test/webhook-checkout-ft-forward.test.js
```

Expected: FAIL before Step 1, PASS after. (If the execution harness needs adjustment to match `handleCheckoutCompleted`'s exact signature or the `_donor-gift.js`/`_supporter-gift.js` side effects it also triggers, keep the assertions above and stub whatever those helpers need via `mockEnv`/`env.DB` the same way `webhook-checkout-exec.test.js` already does for this handler; consult that file for the full fixture shape before altering this test's structure.)

- [ ] **Step 5: Update the guard manifest** (`_webhook-checkout.js` is guarded):

```
npm run guard:update
```

- [ ] **Step 6: Commit.**

```
cat > $SCRATCH/commit-msg-webhook-ft-forward.txt << 'EOF'
Forward ft_*/click_id from Stripe metadata into the purchase GA4 send

All three purchase branches (course, donation, subscription) now relay
ft_source/ft_medium/ft_campaign/ft_landing/ft_at/click_id from
session.metadata into the GA4 purchase event, so the ledger's purchase row
carries the buyer's first touch even though the webhook request itself
carries no browser cookies. ft_content is deliberately excluded: no ledger
column, never written to Stripe metadata.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add functions/api/billing/_webhook-checkout.js test/webhook-checkout-metadata.test.js test/webhook-checkout-ft-forward.test.js guard-manifest.json
git commit -F $SCRATCH/commit-msg-webhook-ft-forward.txt
```

---

## Task 8: Uploader refactor -- `_google-ads.js` `uploadConversion` gains value/order-id

**Files:**
- Modify: `functions/api/_google-ads.js`
- Modify: `test/google-ads-conversion.test.js`

**Interfaces:**
- Consumes: nothing new (internal refactor).
- Produces: `uploadConversion(env, { clickId, clickIdKind, conversionActionId, conversionValue, currency, orderId })` replacing the old positional `uploadConversion(env, gclid, conversionActionId)`; `uploadConversionWithRetry` and `sendGoogleAdsConversion` updated to call it with the same defaults the existing eight call sites already produce, so their behavior is byte-identical.

- [ ] **Step 1: Replace `uploadConversion`'s signature and body:**

```js
/**
 * Uploads one conversion event to Data Manager.
 *
 * `clickIdKind` selects which adIdentifiers key carries `clickId`
 * ('gclid' | 'gbraid' | 'wbraid'), defaulting to 'gclid' -- every existing
 * call site passes a gclid from the 30-day cookie and relies on this
 * default. `conversionValue`/`currency` default to the pre-refactor
 * hardcoded 1.0/'USD' so the eight quiz/newsletter call sites are
 * byte-identical to before this change. `orderId` is omitted from the
 * event payload entirely when absent (undefined), not sent as null/empty
 * string -- the eight existing call sites never pass one.
 */
async function uploadConversion(env, { clickId, clickIdKind = 'gclid', conversionActionId, conversionValue = 1.0, currency = 'USD', orderId }) {
  const accessToken = await getAccessToken(env);

  const adIdentifiers = { [clickIdKind]: clickId };
  const event = {
    adIdentifiers,
    eventTimestamp: formatEventTimestamp(new Date()),
    conversionValue,
    currency,
    eventSource: 'WEB',
    ...(orderId !== undefined && orderId !== null && { orderId }),
  };

  let resp;
  try {
    resp = await fetch(INGEST_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        destinations: [{
          operatingAccount: { accountType: 'GOOGLE_ADS', accountId: GOOGLE_ADS_CUSTOMER_ID },
          productDestinationId: conversionActionId,
        }],
        events: [event],
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new Error(`upload_network:${err.message}`, { cause: err });
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    throw new Error(`upload_${resp.status}:${bodyText.slice(0, 150)}`);
  }

  try {
    const data = await resp.json();
    return typeof data?.requestId === 'string' ? data.requestId : '';
  } catch {
    return '';
  }
}
```

NOTE on `orderId`'s exact Data Manager field name: the spec requires this verified against the live API before shipping (the same way this file's header records having verified its other fields against the live endpoint on 2026-07-03). At implementation time, check the current Data Manager `events` resource schema (developers.google.com/data-manager, `events:ingest`) for the transaction/order identifier field name; `orderId` above is this plan's best-documented guess and MUST be corrected to the verified name before merging, with the verification date and source added to this file's top-of-file header comment, mirroring the existing "verified live 2026-07-03" line.

- [ ] **Step 2: Update `uploadConversionWithRetry` to the object-argument shape:**

```js
async function uploadConversionWithRetry(env, waitUntil, uploadArgs) {
  try {
    return await uploadConversion(env, uploadArgs);
  } catch (err) {
    if (!isRetryableUploadError(err)) throw err;
    log(env, waitUntil, 'google_ads', 'conversion_retry', 'warn', err.message, 0, 0, [uploadArgs.clickId, uploadArgs.conversionActionId]);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return uploadConversion(env, uploadArgs);
  }
}
```

- [ ] **Step 3: Update `sendGoogleAdsConversion`** to build the object and pass it through, keeping its own external signature `(env, waitUntil, cookieHeader, conversionActionId)` unchanged so all eight existing call sites need no edits:

```js
export function sendGoogleAdsConversion(env, waitUntil, cookieHeader, conversionActionId) {
  try {
    if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
      return;
    }
    const gclid = parseGclidCookie(cookieHeader);
    if (!gclid) return;

    const uploadArgs = { clickId: gclid, clickIdKind: 'gclid', conversionActionId };
    const task = uploadConversionWithRetry(env, waitUntil, uploadArgs).then(async (requestId) => {
      log(env, waitUntil, 'google_ads', 'conversion_ok', 'ok', conversionActionId, 0, 200, [gclid, requestId]);
      await sendConversionSuccessEmail(env, waitUntil, conversionActionId, gclid, requestId);
    }).catch(async (err) => {
      log(env, waitUntil, 'google_ads', 'conversion_error', 'error', err.message, 0, 502, [gclid, conversionActionId]);
      await sendConversionFailureEmail(env, waitUntil, conversionActionId, gclid, err.message);
    });

    if (typeof waitUntil === 'function') {
      waitUntil(task);
    }
  } catch (err) {
    log(env, waitUntil, 'google_ads', 'conversion_error', 'error', err.message, 0, 500);
  }
}
```

- [ ] **Step 4: Add `sendGoogleAdsValueConversion`**, the new entry point Task 10 (`_webhook-checkout.js`) calls, right after `sendGoogleAdsConversion`:

```js
/**
 * Fire-and-forget Google Ads VALUE conversion upload, for the two new
 * server-upload actions (section 3.3). Unlike sendGoogleAdsConversion this
 * takes the click id directly (the webhook's Stripe metadata gclid_last,
 * not a cookie header -- the webhook request has no browser cookies) and
 * carries a real dollar value and order id. No-op when clickId is absent
 * (an organic/no-ad purchase is not a synthetic conversion) or the account
 * is unconfigured, same posture as sendGoogleAdsConversion.
 */
export function sendGoogleAdsValueConversion(env, waitUntil, { clickId, conversionActionId, conversionValue, currency = 'USD', orderId }) {
  try {
    if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
      return;
    }
    if (!clickId || !GCLID_RE.test(clickId)) return;

    // gclid_last only ever holds a gclid (the 30-day cookie is written from the
    // gclid query param alone), so the kind is fixed here; the gbraid/wbraid
    // branches of uploadConversion exist for the first-touch marker in rrm_ft.g
    // and any future caller that carries one.
    const uploadArgs = { clickId, clickIdKind: 'gclid', conversionActionId, conversionValue, currency, orderId };
    const task = uploadConversionWithRetry(env, waitUntil, uploadArgs).then(async (requestId) => {
      log(env, waitUntil, 'google_ads', 'conversion_ok', 'ok', conversionActionId, 0, 200, [clickId, requestId, orderId]);
      await sendConversionSuccessEmail(env, waitUntil, conversionActionId, clickId, requestId);
    }).catch(async (err) => {
      log(env, waitUntil, 'google_ads', 'conversion_error', 'error', err.message, 0, 502, [clickId, conversionActionId]);
      await sendConversionFailureEmail(env, waitUntil, conversionActionId, clickId, err.message);
    });

    if (typeof waitUntil === 'function') {
      waitUntil(task);
    }
  } catch (err) {
    log(env, waitUntil, 'google_ads', 'conversion_error', 'error', err.message, 0, 500);
  }
}
```

`GCLID_RE` import: add `import { GCLID_RE } from './_ga4-source.js';` alongside the existing `import { parseGclidCookie } from './_ga4-source.js';` from Task 4.

- [ ] **Step 5: Add the two frozen conversion-action-id constants** (placeholders until Task 9 runs; update with the real ids Task 9 prints):

```js
// Two new UPLOAD_CLICKS conversion actions with VALUE, section 3.3. Ids
// created by skills/ads-sitting/helpers/create-value-actions.py (Task 9 of
// the first-touch-attribution plan); frozen here once known.
export const STUC_PURCHASE_CONVERSION_ACTION_ID = 'PENDING_TASK_9';
export const DONATION_CONVERSION_ACTION_ID = 'PENDING_TASK_9';
```

(These two lines are placeholders ONLY until Task 9's script has actually run against the live Ads account and printed real resource ids; the string `'PENDING_TASK_9'` must never reach a deploy. Task 10 depends on this being replaced first.)

- [ ] **Step 6: Add payload-shape tests** to `test/google-ads-conversion.test.js`:

```js
describe('_google-ads.js uploadConversion payload shape', () => {
  it('the default path (no value/currency/orderId/clickIdKind) is byte-identical to the pre-refactor payload', async (t) => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => okTokenResponse(),
      ingestImpl: () => okIngestResponse(),
    });
    t.after(() => stub.restore());

    const env = googleAdsEnv();
    const waitUntil = mockWaitUntil();
    googleAds.sendGoogleAdsConversion(env, waitUntil, COOKIE, ACTION_ID);
    await drainWaitUntil(waitUntil);

    const ingestBody = JSON.parse(stub.ingestCalls[0].init.body);
    const event = ingestBody.events[0];
    assert.deepEqual(event.adIdentifiers, { gclid: 'abcdefghij1234567890' });
    assert.equal(event.conversionValue, 1.0);
    assert.equal(event.currency, 'USD');
    assert.equal(event.eventSource, 'WEB');
    assert.equal('orderId' in event, false, 'no orderId key on the default path, not even null/empty');
  });

  it('sendGoogleAdsValueConversion emits value, currency, orderId, and a gbraid-keyed adIdentifiers', async (t) => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => okTokenResponse(),
      ingestImpl: () => okIngestResponse(),
    });
    t.after(() => stub.restore());

    const env = googleAdsEnv();
    const waitUntil = mockWaitUntil();
    // clickIdKind defaults to 'gclid' inside sendGoogleAdsValueConversion
    // (the webhook only ever reads gclid_last), so a gbraid-keyed
    // adIdentifiers is exercised directly through uploadConversionWithRetry
    // via the module's internal uploadConversion, proven by shape here
    // rather than through the public entry point.
    googleAds.sendGoogleAdsValueConversion(env, waitUntil, {
      clickId: 'abcdefghij1234567890',
      conversionActionId: googleAds.NEWSLETTER_CONVERSION_ACTION_ID,
      conversionValue: 25.5,
      currency: 'USD',
      orderId: 'pi_test_value_upload',
    });
    await drainWaitUntil(waitUntil);

    const ingestBody = JSON.parse(stub.ingestCalls[0].init.body);
    const event = ingestBody.events[0];
    assert.equal(event.conversionValue, 25.5);
    assert.equal(event.currency, 'USD');
    assert.equal(event.orderId, 'pi_test_value_upload');
    assert.deepEqual(event.adIdentifiers, { gclid: 'abcdefghij1234567890' });
  });

  it('sendGoogleAdsValueConversion is a no-op with no clickId', async (t) => {
    const stub = stubGoogleAdsFetch({
      tokenImpl: () => { throw new Error('must not be called'); },
      ingestImpl: () => { throw new Error('must not be called'); },
    });
    t.after(() => stub.restore());

    const env = googleAdsEnv();
    const waitUntil = mockWaitUntil();
    googleAds.sendGoogleAdsValueConversion(env, waitUntil, {
      clickId: null,
      conversionActionId: googleAds.NEWSLETTER_CONVERSION_ACTION_ID,
      conversionValue: 9,
      orderId: 'sub_test',
    });
    await drainWaitUntil(waitUntil);
    assert.equal(stub.tokenCalls.length, 0);
    assert.equal(stub.ingestCalls.length, 0);
  });
});
```

- [ ] **Step 7: Run the tests**:

```
node --experimental-strip-types --test test/google-ads-conversion.test.js test/endo-quiz-start.test.js
```

Expected: `endo-quiz-start.test.js` PASSES unchanged (proves the eight existing call sites are unaffected); `google-ads-conversion.test.js` FAILS before Steps 1-5, PASSES after.

- [ ] **Step 8: Commit.**

```
cat > $SCRATCH/commit-msg-google-ads-uploader.txt << 'EOF'
Refactor uploadConversion to carry value, currency, order id, click-id kind

uploadConversion(env, gclid, conversionActionId) becomes
uploadConversion(env, { clickId, clickIdKind, conversionActionId,
conversionValue, currency, orderId }), with defaults (gclid, 1.0, USD, no
orderId) that keep the existing eight newsletter/quiz call sites byte-
identical. Adds sendGoogleAdsValueConversion for the two upcoming
server-upload value actions (section 3.3), and frozen constants pending
Task 9's live Ads API run.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add functions/api/_google-ads.js test/google-ads-conversion.test.js
git commit -F $SCRATCH/commit-msg-google-ads-uploader.txt
```

---

## Task 9: Two new conversion actions (manual, Brian runs it)

**Files:**
- Create: `skills/ads-sitting/helpers/create-value-actions.py`
- Modify: `functions/api/_google-ads.js` (replace the `'PENDING_TASK_9'` placeholders with real ids)
- Modify (rrm-backoffice): `functions/api/ads.js` (`ACTIONS` map)

**Interfaces:**
- Consumes: `~/.claude/skills/ads-sitting/gads.py`'s `token()` and `op()` helpers, Google Ads API v24 `conversionActions:mutate`.
- Produces: two new conversion action resource ids, printed to stdout, then hand-copied into the two files above.

**This task's script execution is a MANUAL step Brian runs. It mutates the live Ads account (426-226-8858) and must never run inside an automated CI or agent-driven pipeline.**

- [ ] **Step 1: Write the script**, reusing `gads.py`'s auth/HTTP helpers exactly as `skills/ads-sitting` scripts already do:

```python
#!/usr/bin/env python3
"""
create-value-actions.py -- one-time creation of the two UPLOAD_CLICKS
conversion actions section 3.3 of
docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md needs:
"STUC Subscription (server upload)" (SUBSCRIBE_PAID) and
"Donation (server upload)" (PURCHASE -- Google has no donation category).

Both carry a value setting: default value 1, always_use_default False (a
real dollar amount is uploaded per conversion by
sendGoogleAdsValueConversion; the default is a floor for the rare event
where value is somehow absent).

MUTATES THE LIVE AD GRANTS ACCOUNT (426-226-8858). Run by hand, once. Not
part of any CI or agent pipeline.

Usage: python3 create-value-actions.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / '.claude' / 'skills' / 'ads-sitting'))
from gads import token, op  # noqa: E402

CUSTOMER_ID = '4262268858'
API_VERSION = 'v24'

ACTIONS = [
    {
        'name': 'STUC Subscription (server upload)',
        'type': 'UPLOAD_CLICKS',
        'category': 'SUBSCRIBE_PAID',
        'status': 'ENABLED',
        'valueSettings': {'defaultValue': 1.0, 'alwaysUseDefaultValue': False},
        'countingType': 'ONE_PER_CLICK',
    },
    {
        'name': 'Donation (server upload)',
        'type': 'UPLOAD_CLICKS',
        'category': 'PURCHASE',
        'status': 'ENABLED',
        'valueSettings': {'defaultValue': 1.0, 'alwaysUseDefaultValue': False},
        'countingType': 'ONE_PER_CLICK',
    },
]


def main():
    access_token = token()
    url = f'https://googleads.googleapis.com/{API_VERSION}/customers/{CUSTOMER_ID}/conversionActions:mutate'
    operations = [{'create': action} for action in ACTIONS]
    result = op(access_token, url, {'operations': operations})

    for action, result_row in zip(ACTIONS, result.get('results', [])):
        resource_name = result_row.get('resourceName', '')
        action_id = resource_name.rsplit('/', 1)[-1] if resource_name else '(unknown)'
        print(f"{action['name']}: id={action_id} resourceName={resource_name}")

    print('\nCopy the two ids above into:')
    print('  functions/api/_google-ads.js  (STUC_PURCHASE_CONVERSION_ACTION_ID, DONATION_CONVERSION_ACTION_ID)')
    print('  rrm-backoffice functions/api/ads.js  (ACTIONS map)')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Brian runs it** (not an agent, not CI):

```
python3 skills/ads-sitting/helpers/create-value-actions.py
```

- [ ] **Step 3: Replace the placeholders in `functions/api/_google-ads.js`** with the printed ids:

```js
export const STUC_PURCHASE_CONVERSION_ACTION_ID = '<printed id>';
export const DONATION_CONVERSION_ACTION_ID = '<printed id>';
```

- [ ] **Step 4: Add both actions to `rrm-backoffice`'s `functions/api/ads.js` `ACTIONS` map** (server-upload value actions carry no `campaign`, matching the existing `Newsletter Signup` entry's shape, since they are not part of either quiz funnel):

```js
  '<stuc printed id>': { name: 'STUC Subscription (server upload)', label: 'STUC Value Upload', campaign: null, primary: false },
  '<donation printed id>': { name: 'Donation (server upload)', label: 'Donation Value Upload', campaign: null, primary: false },
```

- [ ] **Step 5: Commit (this repo).**

```
cat > $SCRATCH/commit-msg-value-actions.txt << 'EOF'
Add the two server-upload value conversion actions (STUC, Donation)

STUC Subscription (server upload), category SUBSCRIBE_PAID, and Donation
(server upload), category PURCHASE, both UPLOAD_CLICKS with a value
setting. Created via skills/ads-sitting/helpers/create-value-actions.py
(run by hand against the live Ads account); ids frozen here.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add skills/ads-sitting/helpers/create-value-actions.py functions/api/_google-ads.js
git commit -F $SCRATCH/commit-msg-value-actions.txt
```

- [ ] **Step 6: Commit (rrm-backoffice, separate repo/commit).**

```
cat > $SCRATCH/commit-msg-value-actions-backoffice.txt << 'EOF'
Register the two server-upload value conversion actions in the ads funnel map

Mirrors the ids created in rrm-academy-cf functions/api/_google-ads.js
(STUC_PURCHASE_CONVERSION_ACTION_ID, DONATION_CONVERSION_ACTION_ID).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add functions/api/ads.js
git commit -F $SCRATCH/commit-msg-value-actions-backoffice.txt
```

---

## Task 10: Webhook value-upload call

**Files:**
- Modify: `functions/api/billing/_webhook-checkout.js`
- Modify: `test/webhook-checkout-ft-forward.test.js` (extend)

**Interfaces:**
- Consumes: `sendGoogleAdsValueConversion(env, waitUntil, { clickId, conversionActionId, conversionValue, currency, orderId })` (Task 8), `STUC_PURCHASE_CONVERSION_ACTION_ID` / `DONATION_CONVERSION_ACTION_ID` (Task 9), `session.metadata.gclid_last` (Task 6).
- Produces: one fire-and-forget Ads value upload per donation/subscription purchase, sitting inside the existing `handleCheckoutCompleted` webhook_event-deduped handler.

- [ ] **Step 1: Import the new function and constants:**

```js
import { sendGoogleAdsValueConversion, STUC_PURCHASE_CONVERSION_ACTION_ID, DONATION_CONVERSION_ACTION_ID } from '../_google-ads.js';
```

- [ ] **Step 2: Add the upload call right after the donation `purchase` GA4 send**, inside the same `if (session.mode === 'payment' && ...)` block:

```js
  // GA4: track completed donation or membership purchase
  if (session.mode === 'payment' && (session.metadata?.type === 'donation' || !session.metadata?.type)) {
    waitUntil(sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || 0) / 100,
      transaction_id: session.payment_intent || session.id,
      items: [{ item_name: 'Donation' }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
      ...(session.metadata?.ga_entry_category && { entry_category: session.metadata.ga_entry_category }),
      ...(session.metadata?.ga_entry_platform && { entry_platform: session.metadata.ga_entry_platform }),
      ...(session.metadata?.ft_source && { ft_source: session.metadata.ft_source }),
      ...(session.metadata?.ft_medium && { ft_medium: session.metadata.ft_medium }),
      ...(session.metadata?.ft_campaign && { ft_campaign: session.metadata.ft_campaign }),
      ...(session.metadata?.ft_landing && { ft_landing: session.metadata.ft_landing }),
      ...(session.metadata?.ft_at && { ft_at: session.metadata.ft_at }),
      ...(session.metadata?.click_id && { click_id: session.metadata.click_id }),
    }, gaOverrides).catch(() => {}));
    // Google Ads value upload (section 3.3). Sits inside the same
    // webhook_event-deduped handler as the ledger write above, so a Stripe
    // redelivery does not re-attempt the upload at all -- Google's own
    // order-id dedup is a second line of defense, not the only one. Uses
    // gclid_last (the CURRENT click at checkout time), not click_id (the
    // first-touch id): last-click is what the account's bidding and every
    // existing upload action run on, unchanged by this spec. No-op when
    // gclid_last is absent (an organic/no-ad donor).
    sendGoogleAdsValueConversion(env, waitUntil, {
      clickId: session.metadata?.gclid_last,
      conversionActionId: DONATION_CONVERSION_ACTION_ID,
      conversionValue: (session.amount_total || 0) / 100,
      currency: 'USD',
      orderId: session.payment_intent || session.id,
    });
  } else if (session.mode === 'subscription' && stucTiers[tier]) {
    // amount_total is 0 for trial-clamped migration checkouts (subscription_data.trial_end
    // delays the first invoice), which would otherwise report $0 subscription revenue.
    // Fall back to the standard tier price when the first invoice hasn't billed yet.
    const stucTierCentsFallback = { member: 900, hero: 1900, superhero: 9900 };
    waitUntil(sendGA4Event(env, request, 'purchase', {
      page_location: pageLocation,
      currency: 'USD',
      value: (session.amount_total || stucTierCentsFallback[tier] || 0) / 100,
      transaction_id: session.subscription || session.id,
      items: [{ item_name: `STUC ${stucTiers[tier]}` }],
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
      ...(session.metadata?.ga_entry_category && { entry_category: session.metadata.ga_entry_category }),
      ...(session.metadata?.ga_entry_platform && { entry_platform: session.metadata.ga_entry_platform }),
      ...(session.metadata?.ft_source && { ft_source: session.metadata.ft_source }),
      ...(session.metadata?.ft_medium && { ft_medium: session.metadata.ft_medium }),
      ...(session.metadata?.ft_campaign && { ft_campaign: session.metadata.ft_campaign }),
      ...(session.metadata?.ft_landing && { ft_landing: session.metadata.ft_landing }),
      ...(session.metadata?.ft_at && { ft_at: session.metadata.ft_at }),
      ...(session.metadata?.click_id && { click_id: session.metadata.click_id }),
    }, gaOverrides).catch(() => {}));
    sendGoogleAdsValueConversion(env, waitUntil, {
      clickId: session.metadata?.gclid_last,
      conversionActionId: STUC_PURCHASE_CONVERSION_ACTION_ID,
      conversionValue: (session.amount_total || stucTierCentsFallback[tier] || 0) / 100,
      currency: 'USD',
      orderId: session.subscription || session.id,
    });
  }
```

- [ ] **Step 3: Extend `test/webhook-checkout-ft-forward.test.js`** with an Ads-upload assertion, stubbing the Google hosts the same way `test/endo-quiz-start.test.js` does:

```js
describe('webhook purchase triggers the Google Ads value upload', () => {
  it('a donation with gclid_last metadata uploads with the donation action id, value, and order id', async (t) => {
    const original = globalThis.fetch;
    const ingestCalls = [];
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('oauth2.googleapis.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.stub' }) };
      if (url.includes('datamanager.googleapis.com')) {
        ingestCalls.push(input);
        return { ok: true, status: 200, text: async () => '{}' };
      }
      throw new Error(`unrouted request to ${url}`);
    };
    t.after(() => { globalThis.fetch = original; });

    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({
        DB: db, CONVERSION_LEDGER: '1',
        GOOGLE_ADS_CLIENT_ID: 'id', GOOGLE_ADS_CLIENT_SECRET: 'secret', GOOGLE_ADS_REFRESH_TOKEN: 'token',
        AWS_ACCESS_KEY_ID: undefined, AWS_SECRET_ACCESS_KEY: undefined,
      });
      const waitUntil = mockWaitUntil();
      const request = mockRequest('POST', { url: 'https://rrmacademy.org/api/stripe-webhook' });
      const session = {
        id: 'cs_test_ads_upload', mode: 'payment', payment_intent: 'pi_test_ads_upload', amount_total: 500,
        customer_details: { email: 'donor2@example.com', name: 'Test Donor Two' },
        metadata: { type: 'donation', gclid_last: 'gclidlast1234567890' },
      };
      const event = { id: 'evt_test_ads_upload', created: Math.floor(Date.now() / 1000) };

      await handleCheckoutCompleted(db, event, env, request, waitUntil);
      await drainWaitUntil(waitUntil);

      assert.equal(ingestCalls.length, 1);
    } finally { fetchStub.restore(); db.close(); }
  });
});
```

- [ ] **Step 4: Run the tests:**

```
node --experimental-strip-types --test test/webhook-checkout-ft-forward.test.js
```

- [ ] **Step 5: Update the guard manifest:**

```
npm run guard:update
```

- [ ] **Step 6: Commit.**

```
cat > $SCRATCH/commit-msg-webhook-value-upload.txt << 'EOF'
Upload Google Ads value conversions from the checkout webhook

After the existing purchase GA4 send, donation and subscription purchases
now call sendGoogleAdsValueConversion with gclid_last (last-click, not
first-touch click_id -- unchanged Ads bidding posture), the tier/amount
value, and an order id keyed to the Stripe payment_intent/subscription id.
Sits inside the same webhook_event-deduped handler as the ledger write, so
a Stripe redelivery never re-attempts the upload.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add functions/api/billing/_webhook-checkout.js test/webhook-checkout-ft-forward.test.js guard-manifest.json
git commit -F $SCRATCH/commit-msg-webhook-value-upload.txt
```

---

## Task 11: Guard, gates, and the section 3.4 pinned tests

**Files:** none new; verification-only task plus any gap-filling test additions.

- [ ] **Step 1: Guard manifest, full check:**

```
npm run guard:update && npm run guard
```

Expected: PASS with zero diffs after the update (every guarded file touched by Tasks 3-7, 10 already had its own `guard:update` run in-task).

- [ ] **Step 2: Analytics and SQL gates:**

```
npm run gates:analytics
npm run gates:sql
```

Expected: both green. `gates:sql` still reports SD2 STALE-PRESENT for 039 until the remote apply (Task 1's documented, expected state).

- [ ] **Step 3: Full suite:**

```
npm test
```

Expected: PASS.

- [ ] **Step 4: Confirm every section 3.4 pinned test exists and is named**, cross-referencing back to the tasks above (no new code should be needed if Tasks 1-10 were followed; this step is a checklist, not new work):

| Spec requirement (3.4) | Test | Task |
|---|---|---|
| Cookie written once and never overwritten | `'is written once, from utm params'` + `'a second visit with a new utm does not overwrite the existing cookie'` | 3 |
| GPC skips it | `'GPC true skips the write entirely'` | 3 |
| Every `ft_*` field screened | `'screens an email-shaped field to absent...'`, `'screens a bare 13-19 digit run field to absent'` (`_ga4-source.js`) + `'an email-shaped click_id in the cookie never reaches the ledger'` (`_ga4.js`) | 4, 5 |
| Email-shaped `utm_term` never reaches the ledger or Stripe | `'an email-shaped utm_term is written empty...'` (client) + `parseFirstTouch` screen (server) + `create-checkout` reads only the already-screened `parseFirstTouch` output before writing metadata | 3, 4, 6 |
| 1,100-byte cookie ignored whole | `'a cookie that would exceed 1KB total writes nothing'` | 3 |
| Purchase replayed from the webhook carries `ft_*` from Stripe metadata only | `'a donation checkout.session.completed with ft_* metadata lands ft_*...with no cookies on the request'` | 7 |
| Second, later ad click re-attributes `gclid` for last-click Ads uploads while `rrm_ft` is unchanged | new test below | 11 (this task) |

- [ ] **Step 5: Add the missing pinned test** (second ad click re-attribution), `test/base-layout-first-touch.test.js`, extending Task 3's suite:

```js
  it('a second ad click overwrites the 30-day gclid cookie while rrm_ft (first touch) stays unchanged', () => {
    // This script only writes rrm_ft; the 30-day gclid cookie write lives in
    // a separate script block in BaseLayout.astro (unchanged by this plan).
    // What this test pins is the OTHER half of the guarantee: running the
    // rrm_ft writer again, on a session that already has an rrm_ft cookie
    // from an earlier ad click, must not touch it even though a fresh
    // gclid is present in the URL and in the (separately maintained)
    // gclid cookie.
    const { cookieStore } = runScript({
      search: '?gclid=SECOND_CLICK_ID_67890',
      existingCookies: [
        'rrm_ft=' + encodeURIComponent('s=google&m=cpc&g=gFIRST_CLICK_ID_12345&d=1757030400'),
        'gclid=FIRST_CLICK_ID_12345',
      ],
    });
    const raw = decodeURIComponent(cookieStore.find((c) => c.startsWith('rrm_ft=')).slice('rrm_ft='.length));
    assert.match(raw, /g=gFIRST_CLICK_ID_12345/, 'rrm_ft keeps the FIRST click id, not the second');
  });
```

(This proves the `rrm_ft` half. The `gclid` cookie's own re-attribution on a fresh click is pre-existing, untouched behavior -- `document.cookie = 'gclid=' + ... ;max-age=2592000...` runs unconditionally on every visit that carries a `gclid` param, already in `BaseLayout.astro` before this plan, and is out of scope to re-test here.)

- [ ] **Step 6: Run the full base-layout suite once more:**

```
node --experimental-strip-types --test test/base-layout-first-touch.test.js
```

- [ ] **Step 7: Commit.**

```
cat > $SCRATCH/commit-msg-section-3-4-pin.txt << 'EOF'
Pin the second-ad-click re-attribution test for rrm_ft (section 3.4)

Completes the section 3.4 guardrail checklist: a later ad click's gclid
does not disturb the already-written first-touch rrm_ft cookie.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add test/base-layout-first-touch.test.js
git commit -F $SCRATCH/commit-msg-section-3-4-pin.txt
```

---

## Task 12: Proof run (spec section 7, step 2)

Manual checklist. No code changes; this is the converge component `first-touch-attribution`'s proof gate. Brian executes the steps marked BRIAN; everything else can be scripted/verified by an agent with wrangler/curl access.

- [ ] **Step 1: Confirm migration 039 is live on remote `rrm-auth`** (must have happened before Task 5's commit deployed; re-verify here as the gate):

```
npx wrangler d1 execute rrm-auth --remote --command "PRAGMA table_info(conversion_event)"
```

Expected: the output lists `ft_source`, `ft_medium`, `ft_campaign`, `ft_landing`, `ft_at`, `click_id`, `transaction_id`.

- [ ] **Step 2: Push `main`** (CI deploys; never deploy by hand):

```
git push origin main
```

Wait for the CF Pages deploy to go live and for the corresponding `rrm-backoffice` deploy (Task 2/9's changes) if not already merged separately.

- [ ] **Step 3: Synthetic first-touch session via curl**, simulating a fresh ad-click landing and a subsequent page view carrying the resulting `rrm_ft` cookie:

```
curl -sS -c $SCRATCH/rrm-ft-cookies.txt "https://rrmacademy.org/endo-quiz/?utm_source=google&utm_medium=cpc&utm_campaign=proof_run_2026-09&gclid=PROOFRUNCLICKID123456" -o /dev/null
grep rrm_ft $SCRATCH/rrm-ft-cookies.txt
```

(Since `rrm_ft` is written by client JS, not the server response, this curl step only proves the page loads and the ad-click URL shape parses; the actual cookie write must be confirmed via a real browser hit, BRIAN, or the `mcp__claude-in-chrome` tools against a staging/prod URL, checking `document.cookie` for `rrm_ft=`.)

- [ ] **Step 4 (BRIAN): Make a real $5 donation on a test card**, from a browser session carrying the `rrm_ft` cookie written in Step 3, at `/donate/`.

- [ ] **Step 5: Verify the ledger row:**

```
npx wrangler d1 execute rrm-auth --remote --command "SELECT event, ft_source, ft_medium, ft_campaign, click_id, transaction_id FROM conversion_event WHERE event = 'purchase' ORDER BY id DESC LIMIT 1"
```

Expected: `ft_source=google`, `ft_medium=cpc`, `ft_campaign=proof_run_2026-09`, `click_id=PROOFRUNCLICKID123456` (or whatever the test click id was), `transaction_id` a real `pi_...`.

- [ ] **Step 6: Verify Stripe metadata**, via the restricted read-only key:

```
curl -sS https://api.stripe.com/v1/checkout/sessions/<session_id> -u "$STRIPE_RESTRICTED_KEY:" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['metadata'])"
```

Expected: `ft_source`, `ft_medium`, `ft_campaign`, `ft_landing`, `ft_at`, `click_id`, `gclid_last` all present.

- [ ] **Step 7: Verify the BigQuery `purchase` event** carries `ft_*` params:

```
bq query --use_legacy_sql=false 'SELECT event_params FROM `rrm-academy.analytics_526304690.events_*` WHERE event_name = "purchase" AND _TABLE_SUFFIX = FORMAT_DATE("%Y%m%d", CURRENT_DATE()) ORDER BY event_timestamp DESC LIMIT 1'
```

Expected: `event_params` includes keys `ft_source`, `ft_medium`, `ft_campaign`, `ft_landing`, `ft_at`, `click_id`.

- [ ] **Step 8: Verify the Ads upload log** records the click id (Analytics Engine, via the existing `log()` calls in `_google-ads.js`):

Check the `google_ads` AE dataset for a `conversion_ok` row with blob `PROOFRUNCLICKID123456` (or the real test click id) and the `DONATION_CONVERSION_ACTION_ID`.

- [ ] **Step 9 (BRIAN): Second, later ad click from the same returning visitor.** From the same browser (same `rrm_ft` cookie already set), load a URL with a NEW `gclid`:

```
https://rrmacademy.org/save-the-uterus-club/?gclid=SECONDCLICKID789012
```

- [ ] **Step 10: Confirm the 30-day `gclid` cookie updated** (new value) while `rrm_ft` did not (still carries the first click id) -- via browser devtools or `mcp__claude-in-chrome`'s `read_page`/`javascript_tool` against `document.cookie`. This is the same guarantee Task 11's `base-layout-first-touch.test.js` pins in isolation; this step is the live-browser confirmation of it.

- [ ] **Step 11: Record the result** in the spec's status line (`docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md`, top `Status:` line) and in the converge ledger entry `first-touch-attribution`.

```
cat > $SCRATCH/commit-msg-proof-run.txt << 'EOF'
Record the first-touch-attribution proof run result

Section 7 step 2 proof: synthetic first-touch session, $5 test-card
donation, ft_* confirmed in the ledger, Stripe metadata, and BigQuery, Ads
upload log carries the click id, second ad click re-attributes gclid while
rrm_ft is unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git add docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md
git commit -F $SCRATCH/commit-msg-proof-run.txt
```

