# Email Observability System -- Design Spec

> Status: DESIGN APPROVED 2026-06-28 (build pending; no production changes yet). Author: Claude + Brian. Date: 2026-06-27.
> Framing (Brian, 2026-06-28): this is a CF-native equivalent of Sessy -- the capability Sessy provides (SES event observability + per-recipient/per-event drill-down), reimplemented on CF Pages + D1 + the SES SNS feed, reusing bounce.js. Not a code port. Per-event drill-down (who opened / who bounced / who clicked) is a first-class requirement, see 6a.
> Gate: every production step (SES config set, new endpoint, D1 DDL, dashboard, daemon) holds for Brian's explicit go-live. functions/api changes route through the `coder` agent. D1 DDL before deploy. SNS signature verification is mandatory (no unauthenticated event ingestion).

## 0. Problem (ground truth, 2026-06-27)

- `email_log` (rrm-auth) is a **send-only audit log**: 1,399 rows since 2026-03-29, **every one is event `send`** (1,393 transactional + 6 newsletter). Zero delivery/open/click/bounce/complaint rows exist in it.
- Engagement is captured **only** for manual broadcasts via the pixel path into `newsletter_event` (5 sent / 4 opened / 1 clicked total, one welcome backfill batch on 2026-06-21).
- The auto **welcome email** (`_signup-emails.js`) is fire-and-forget and **not pixel-tracked**, so its opens/clicks are invisible.
- `/admin/email` is **broken by frontend<->API contract drift**: the page (`src/pages/admin/email.astro`) sends `event_type`/`dir` and reads `e.recipient`/`e.timestamp`/`data.sent`/`d.totalPages`, but `functions/api/admin/email.js` expects `event`/`order` and returns `e.email`/`e.created_at`/`data.totals.sent`/`d.pages`. Stat cards, the Time/Event/Recipient columns, recipient drill-down, and pagination all render empty. Nobody noticed because nothing watches admin-page health.
- **No SES configuration set / event destination** wired for delivery/open/click. We DO have a verified SNS->CF->D1 path for bounce/complaint (`functions/api/newsletter/bounce.js`, full SNS RSA-signature verification). So this is *extend*, not *greenfield*.
- The real list size (never surfaced in the dashboard): **6,217 active / 176 unsubscribed**.

## 1. Principles

1. **Native Cloudflare/D1.** AWS is the sending muscle (SES) and nothing else. No new always-on host, no Rails (Sessy was evaluated and rejected on this basis). Borrow dashboard UX from Sessy/Listmonk as a reference, not their code.
2. **Reuse `bounce.js`.** Its SNS RSA-signature verification, SubscriptionConfirmation handling, and `webhook_event` dedup are the template for the new event endpoint. Consider extracting a shared module.
3. **Privacy-tiered capture.** Delivery / bounce / complaint / reject are deliverability and reputation signals, privacy-neutral, free (SES reports them with no tracking), and protect the sending account. Capture them in Phase 1. **Open/click tracking is different: it injects a per-recipient pixel and rewrites every link.** Brian approved who-opened/who-clicked drill-down (2026-06-28), so engagement tracking is IN; recommended scope is **newsletter broadcasts only**, with transactional mail (verification, password reset, survey links, receipts) staying pixel-free. Final scope pending Brian confirm (newsletter-only vs all mail).
4. **Fleet-monitored.** The subsystem reports health to `rrm-observatory`, consistent with the rest of the ecosystem.

## 2. Architecture

```
AWS SES (configuration set: rrm-email)
   | publishes events
   v
SNS topic (rrm-ses-events)
   | HTTPS subscription, SNS RSA signature
   v
POST /api/email/events   (CF Pages function; reuses bounce.js SNS verify + webhook_event dedup)
   | normalize
   v
D1 rrm-auth: email_event   (+ email_log.ses_message_id for correlation)
   |                                   |
   v                                   v
/admin/email dashboard (Astro)   rrm-observatory: email-deliverability daemon
```

## 3. SES configuration set (Phase 1 foundation)

- Create configuration set **`rrm-email`** with an SNS event destination on topic **`rrm-ses-events`**, event types: `send`, `delivery`, `bounce`, `complaint`, `reject`, `deliveryDelay`, `renderingFailure`. (`open`, `click` DEFERRED to Phase 5.)
- `functions/api/_ses.js`: pass `ConfigurationSetName: 'rrm-email'` on every SendEmail/SendRawEmail, capture the returned SES `MessageId`, and persist it.
- The SNS topic emits a one-time `SubscriptionConfirmation`; `/api/email/events` must auto-confirm it (bounce.js already does this for its topic).

## 4. D1 schema (rrm-auth)

```sql
-- correlation key on the existing send log
ALTER TABLE email_log ADD COLUMN ses_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_email_log_ses_msgid ON email_log(ses_message_id);

-- new unified SES event store
CREATE TABLE email_event (
  id              TEXT PRIMARY KEY,            -- our UUID
  ses_message_id  TEXT,                        -- correlate to email_log.ses_message_id
  event_type      TEXT NOT NULL,               -- send|delivery|bounce|complaint|reject|deliveryDelay|renderingFailure|open|click
  email           TEXT,
  category        TEXT,                         -- transactional|newsletter (from message tag)
  source          TEXT,                         -- our origin tag if carried as a message tag
  send_id         TEXT,                         -- our newsletter_send id when newsletter
  bounce_type     TEXT,                         -- Permanent|Transient (bounce only)
  feedback_type   TEXT,                         -- complaint feedback type / SES diagnostic class
  ts              TEXT NOT NULL,                -- SES event timestamp (ISO 8601)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  meta_json       TEXT                          -- trimmed raw event for forensics
);
CREATE INDEX idx_email_event_msgid   ON email_event(ses_message_id);
CREATE INDEX idx_email_event_type_ts ON email_event(event_type, ts);
CREATE INDEX idx_email_event_email   ON email_event(email COLLATE NOCASE);
CREATE INDEX idx_email_event_send    ON email_event(send_id);
```

Dedup: `webhook_event` `INSERT OR IGNORE` keyed on the SNS `MessageId`, mirroring `bounce.js` and `stripe-webhook.js`.

## 5. `/api/email/events` endpoint

- Reuse `bounce.js`: SNS `Type` allowlist (`SubscriptionConfirmation` auto-confirm, `Notification`), `TopicArn` match, full SNS RSA signature verification (SigVer 1/2), `webhook_event` dedup on `MessageId`.
- Parse the SES event JSON, normalize one or more `email_event` rows.
- Route `bounce`/`complaint` into the existing `newsletter_subscriber` status transitions. **DRY target:** fold `bounce.js`'s subscriber-status logic into a shared module so there is one path, not two.
- Gate with `SES_EVENTS_SECRET` query param (mirror `NEWSLETTER_BOUNCE_SECRET`).
- Best-effort, never throws to SNS in a way that triggers redelivery storms; dedup makes redelivery safe.

## 6. Dashboard rebuild (`/admin/email`)

Rebuild the page and its API to ONE contract (this also closes the drift bug permanently). Sections:

1. **List health.** active 6,217 / unsubscribed 176 / bounced / complained, plus 30/90d growth and churn from `newsletter_subscriber.created_at` and `unsubscribed_at`.
2. **Deliverability (reputation guardrail).** rolling 7/30d bounce% and complaint% vs SES thresholds (bounce 5%, complaint 0.1%), colored against thresholds, by day and by source. This is the early-warning that the morning digest and daemon also key on.
3. **Broadcast performance.** per `newsletter_send`: recipients, delivered, opened, clicked, bounced, complained + rates, from `email_event` (join on `send_id`) plus `newsletter_event`.
4. **Transactional send audit.** by source / category / day (what `email_log` holds), the existing stats view, fixed.
5. **Event log + recipient timeline.** working filterable table over `email_event` + `email_log`, with per-recipient drill-down.

### 6a. Drill-down / cohort views (first-class, Brian 2026-06-28)

Every metric on the dashboard is a link to its cohort, and every recipient opens to a full timeline. Powered directly by `email_event` (indexes `idx_email_event_type_ts`, `idx_email_event_email`, `idx_email_event_send`).

| Drill-down | Query | Tracking cost |
|------------|-------|---------------|
| Who **delivered** (broadcast X) | `SELECT email FROM email_event WHERE event_type='delivery' AND send_id=?` | free |
| Who **bounced** | `... event_type='bounce'` + `bounce_type` (hard/soft) + `feedback_type`; one-click suppress | free |
| Who **complained** | `... event_type='complaint'` | free |
| Who **opened** | `... event_type='open' AND send_id=?` | needs open tracking |
| Who **clicked** | `... event_type='click' AND send_id=?` (+ clicked link if target captured) | needs click tracking |
| **Recipient timeline** | `SELECT * FROM email_event WHERE email=? COLLATE NOCASE ORDER BY ts` -> sent -> delivered -> opened -> clicked -> bounced/complained across every send | mixed |

UI: a metric/cohort opens a filtered recipient list (email + ts + event detail + suppress action); a recipient opens a side-panel timeline. Cohort lists are CSV-exportable.

Build via the `coder` agent (functions/api) + `frontend-design` + `web-page-qa` (mobile 393x852 + desktop) before "done".

## 7. Observatory daemon: `email-deliverability` (rrm-observatory)

Add `src/daemons/wave?/email-deliverability.js` per the fleet manifest pattern. Reads a summary (either `email_event` directly via D1 binding, or a new `GET /api/email/stats` on rrm-academy-cf) plus SES `GetAccount` for sending-enabled / enforcement status. Checks (each carries an `action`):

- `bounce_rate_high` -- warn 3%, fail 5% (SES suspension line).
- `complaint_rate_high` -- warn 0.05%, fail 0.1%.
- `send_failure_spike` -- `email_log`/`email_event` failure events over baseline.
- `welcome_not_firing` -- new subscribers in last 24h but zero `newsletter/welcome` sends (catches a NEWSLETTER_SECRET regression or signup-email break).
- `list_churn_anomaly` -- unsub spike vs trailing baseline.

Digest-only soak first (`quarantineUntil` OMITTED). Telegram only after soak + human gate, per fleet protocol.

## 8. Admin dead-man's-switch: `admin-contract` probe

Independent of the email work; seeded from the contract-drift audit (`admin-contract-audit` workflow, 2026-06-27). A generic probe (observatory daemon OR a CF cron) that GETs each `/admin/*` data API with a service token and asserts: HTTP 200 + required top-level JSON keys present + data non-stale. Pages on a contract break. This is the thing that would have caught `/admin/email` the day it drifted.

## 9. Phasing

| Phase | Deliverable | Notes |
|-------|-------------|-------|
| 1 | SES config set + `email_event` + `/api/email/events` + `_ses.js` messageId capture | Deliverability events only (no open/click). The foundation. |
| 2 | `/admin/email` dashboard + API rebuild | Fixes the drift bug; adds list health, deliverability, broadcast performance. |
| 3 | `email-deliverability` observatory daemon | Digest-only soak. |
| 4 | `admin-contract` probe | Independent; seed from the audit. |
| 5 | open/click tracking (newsletter broadcasts) | APPROVED 2026-06-28 (enables who-opened/who-clicked drill-down). Pixel + link-rewrite on broadcast sends only; transactional stays pixel-free. Wire into the Phase 1 config set if scope confirmed newsletter-only. |

## 10. Non-negotiables / gates

- All production changes held for explicit go-live (Brian's mockup/publish gate).
- `functions/api/*` via the `coder` agent.
- D1 DDL applied before the code that reads it deploys.
- SNS signature verification mandatory on `/api/email/events`.
- No tracking pixels on transactional mail. Open/click is Phase 5, newsletter-only, opt-in.
- `web-page-qa` mobile + desktop before the dashboard is "done".
