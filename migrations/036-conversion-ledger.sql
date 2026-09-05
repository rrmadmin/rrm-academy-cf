-- 036-conversion-ledger.sql
-- First-party conversion ledger (converge component C7) -- additive migration on rrm-auth (D1).
--
-- WHY
-- The site relays five GA4 events server-side through functions/api/_ga4.js
-- (page_view, sign_up, generate_lead, begin_checkout, purchase), but GA4 keeps
-- them keyed to a browser client_id only, lumps conversion subtypes together,
-- and cannot answer per-person funnel questions. This table is our own record
-- of the same events, written by the relay choke point (one additive INSERT
-- behind the CONVERSION_LEDGER flag, never blocking or reordering the GA4
-- send). The backoffice /funnel page (admin.rrmacademy.org) is the only
-- reader; every read there is audited (funnel.view).
--
-- PII CLASS (accepted by Brian at the C7 contract gate, 2026-08-25)
-- A per-person behavioral ledger: rows carry GA4's client_id (a random UUID,
-- never the fingerprint visitor id), session_id, and -- when the request
-- carried a logged-in session on a conversion event -- the rrm-auth user id.
-- No raw IP, no user agent, no email. Every free-text column written here
-- (entry_source, entry_category, utm_campaign, item, and the lead_source that
-- feeds `type`) is screened against _track-events.js's PII_VALUE_REGEX AT THE
-- LEDGER BOUNDARY, not only over the server-derived sourceParams: the ledger
-- reads caller-supplied params with the same precedence the GA4 payload does,
-- so a caller value would otherwise reach the row unscreened. A value that
-- matches is written NULL (or derives type 'other'). user_id is TEXT because
-- rrm-auth user.id is a TEXT 'usr_...' identifier.
--
-- IDEMPOTENCY (dedup_key)
-- The INSERT is INSERT OR IGNORE against a UNIQUE index on dedup_key. Callers
-- with a natural event identity supply one (the billing webhooks bind the
-- Stripe event.id); client-beacon and direct-caller events have none and bind
-- NULL, which SQLite's UNIQUE allows without limit -- that is the point, and
-- it is why the column is nullable rather than defaulted. stripe-webhook.js
-- already dedupes deliveries via the webhook_event table, so this key only
-- matters in the 5xx-retry window where a handler partially ran before
-- returning 500 and Stripe redelivered.
--
-- THE KEY IS QUALIFIED BY EVENT NAME: _ga4.js binds '<event>:<event_id>', not
-- the bare event id, capped as a whole to 128 chars. When this table landed,
-- exactly one ledger-writing GA4 send fired per checkout event, so a bare
-- Stripe event id mapped to at most one row. That stopped being true when
-- _webhook-checkout.js began relaying sign_up (method='checkout') for an
-- account the checkout had just created, alongside the purchase for what was
-- bought: two ledger events off ONE Stripe delivery, sharing one event.id.
-- Unqualified, the second INSERT would collide on this UNIQUE index and
-- INSERT OR IGNORE would drop it without a word -- a silent undercount of
-- whichever event lost the race, in the exact table built to stop
-- undercounting. Qualification keeps redelivery idempotent per event while
-- letting distinct events off one delivery coexist. The DDL is unchanged: the
-- column and its UNIQUE index were always right, only what the relay binds
-- into them needed to carry the event name.
--
-- RETENTION: 400 days. Documented purge (scheduling is signed C7 stub_debt):
--   DELETE FROM conversion_event WHERE ts < datetime('now', '-400 days');
--
-- TYPE derivation (written by _ga4.js, deterministic, fallback 'other'):
--   purchase / begin_checkout : items[0].item_name -> 'donation' | 'course'
--                               | 'stuc_<tier>' | 'other'
--   generate_lead             : params.lead_source verbatim | 'other'
--   cta_click                 : params.id verbatim (the "page.zone.intent"
--                               CTA id), screened for PII shape AND for the
--                               id's own regex shape, else 'other'. Added
--                               2026-09-05 (CTA map workstream). No new
--                               column: cta_click reuses the existing `type`
--                               TEXT column. Never carries a user_id, and
--                               never a value_cents (no call site sends
--                               `value` on this beacon) -- see _ga4.js
--                               LEDGER_USER_EVENTS.
--   sign_up                   : params.method ('email' | 'google' | 'checkout')
--                               | 'other'. 'checkout' is a Stripe-created
--                               account, kept separable from organic signups.
--   page_view                 : NULL
-- A PII-shaped item_name or lead_source derives 'other', never the raw value.
--
-- ADDITIVE ONLY: one new table + four indexes. Nothing else reads or writes
-- it in this repo. ROLLBACK (fail-closed, snapshot first):
--   wrangler d1 export rrm-auth --remote --table=conversion_event \
--     --output=migrations/backups/conversion_event-<utc-stamp>.sql
--   -- only if the export succeeded and is non-empty:
--   wrangler d1 execute rrm-auth --remote --command "DROP TABLE conversion_event"

CREATE TABLE IF NOT EXISTS conversion_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL,
  type TEXT,
  value_cents INTEGER,
  client_id TEXT,
  session_id TEXT,
  user_id TEXT,
  entry_source TEXT,
  entry_category TEXT,
  utm_campaign TEXT,
  item TEXT,
  dedup_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversion_event_event_ts ON conversion_event(event, ts);
CREATE INDEX IF NOT EXISTS idx_conversion_event_client_ts ON conversion_event(client_id, ts);
CREATE INDEX IF NOT EXISTS idx_conversion_event_user ON conversion_event(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversion_event_dedup ON conversion_event(dedup_key);
