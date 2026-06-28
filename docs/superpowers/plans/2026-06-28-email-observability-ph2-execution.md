# Email Observability Ph2 — Execution Plan + API Contract (SSOT)

> Design spec: `docs/superpowers/specs/2026-06-27-email-observability-system-design.md`. This doc is the BINDING contract: the dashboard page and its API MUST both implement the shapes below verbatim. The bug being fixed is frontend<->API drift, so the contract is the single source of truth for both sides.

## Autonomy contract (lights-off; Brian remote, on phone)
- **Branch:** `claude/email-observability-ph2` (worktree at `~/iCode/.worktrees/email-observability-ph2`, based on `origin/main`).
- **Revert:** `git worktree remove --force ~/iCode/.worktrees/email-observability-ph2 && git branch -D claude/email-observability-ph2`. No D1 changes (migration is HELD, never applied), so revert is branch-delete only.
- **Scope (this phase, nothing else):** 4 files — `functions/api/email/events.js` (new), `functions/api/admin/email.js` (rewrite), `src/pages/admin/email.astro` (rebuild), plus the held migration already carried in. The mockup reference is `/private/tmp/claude-501/-Users-brian-iCode/d6288433-9d22-4f26-9d91-d874a4088a14/scratchpad/email-dashboard-mockup.html`.
- **Abort authority:** STOP and surface (write findings to a scratchpad file, do not proceed) if (a) arise-scanner returns ANY `data-loss/*` finding on a touched file after 2 revision passes, or (b) the coder agent is unconverged after 3 iterations.
- **Deploy authority:** NONE. Nothing deploys. No D1 DDL applied. Held for Brian's explicit go-live.
- **Untouched:** `functions/api/_ses.js` (live send path) is NOT modified this phase — config-set attach + message-id capture are deferred to the SES-wiring phase when Brian can authorize AWS.

## Numeric done-gates
1. `0` arise-scanner `data-loss/*` findings on the 3 touched files.
2. `GET /api/admin/email?view=log` handler returns `{ ok:true, data:{ events:[...], total, page, pages } }` — verified by reading the handler + a local `wrangler pages dev` smoke if feasible.
3. The page reads EXACTLY the keys the API returns (no drift) — verified by a key-by-key cross-check of the rebuilt page against this contract.
4. `web-page-qa` overflow probe `pass:true` at 393x852 AND 1280x900, with all dashboard panels rendered and `0` JS console errors.
5. `npm run lint` clean on `functions/`; `npm run guard:update` run after `events.js` is written (add the new SNS webhook to the guard manifest).

## SES_EVENTS_SECRET provisioning (deferred wiring; named now)
Generate `openssl rand -hex 32`; store at `op://Automation/SES Events Secret/credential`; bind via `wrangler pages secret put SES_EVENTS_SECRET --project-name rrm-academy` before Phase-2 SNS subscription. The endpoint reads `env.SES_EVENTS_SECRET`; if unset, it 503s (inert), which is correct until wired.

---

## API CONTRACT — `GET /api/admin/email` (superadmin session auth; empty-safe everywhere)

All views return `{ ok:true, data:{...} }` on success, `{ ok:false, error }` on failure. `email_event` is EMPTY until the SES feed connects, so every email_event-derived number MUST default to 0 / `[]`, never null/undefined, never throw.

### `?view=summary` (default) — powers the KPI row + volume chart + deliverability gauges
```
data: {
  period: { from, to, days },
  list: { active, unsubscribed, bounced, complained, total, unsub_rate },        // from newsletter_subscriber
  sends: {
    total, transactional, newsletter,                                            // from email_log in range
    by_day: [ { day:'YYYY-MM-DD', transactional:int, newsletter:int } ],
    by_source: [ { source, n } ]                                                  // top 12
  },
  deliverability: {                                                              // from email_event, empty-safe
    delivered, bounced, complained, rejected,
    bounce_rate, complaint_rate,                                                 // floats, 0 when no data
    by_day: [ { day, delivered, bounced, complained } ]
  },
  engagement: { opened, clicked, open_rate, click_rate, tracked }               // newsletter_event + email_event; tracked=bool
}
```

### `?view=broadcasts` — per newsletter_send row
```
data: { broadcasts: [ {
  id, subject, sent_at, status, total_recipients,
  sent, delivered, opened, clicked, bounced, complained,                        // counts (email_event by send_id + newsletter_event), empty-safe
  open_rate, click_rate                                                         // floats
} ] }
```

### `?view=log&event=&category=&source=&email=&from=&to=&sort=&order=&page=&limit=` — unified event log
Union of `email_log` (send/failed) + `email_event` (delivery/open/click/bounce/complaint), newest first.
```
data: {
  events: [ { id, event, email, category, source, subject, detail, send_id, created_at } ],
  total, page, pages
}
```
- `event` filter allowlist: `send,failed,delivery,bounce,complaint,open,click,reject`.
- `sort` allowlist: `created_at,event,email,category,source`. `order`: `asc|desc`. `limit` 1-200 (default 50).
- `email` is prefix match COLLATE NOCASE.

### `?view=cohort&type=&send_id=&from=&to=&page=&limit=` — DRILL-DOWN (spec 6a)
`type` in `delivery|bounce|complaint|open|click`. Lists recipients for that event type (optionally scoped to a broadcast `send_id`).
```
data: {
  cohort: type, send_id: (string|null), count,
  recipients: [ { email, ts, bounce_type, feedback_type, link_url, detail } ],  // bounce_type/feedback_type/link_url null unless relevant
  page, pages
}
```

### `?view=recipient&email=` — per-recipient timeline
```
data: {
  recipient, 
  events: [ { id, event, category, source, subject, detail, send_id, created_at } ],  // union email_log + email_event for this email, newest first
  summary: { total_sent, delivered, opens, clicks, bounces, complained:bool, first_seen, last_activity }
}
```

Validation: all params allowlisted; LIKE special chars escaped; numeric ids regex-checked; date range defaults to last 28d.

---

## API CONTRACT — `POST /api/email/events` (NEW; SNS ingestion; INERT until subscribed)
- Reuse `functions/api/newsletter/bounce.js` SNS handling verbatim where possible: `Type` allowlist (`SubscriptionConfirmation` -> auto-confirm via GET to SubscribeURL; `Notification` -> process; `UnsubscribeConfirmation` -> log), `TopicArn` allowlist match, FULL SNS RSA signature verification (SigVer 1 SHA-1 / SigVer 2 SHA-256, SigningCertURL host pinned to `sns.*.amazonaws.com`), `webhook_event` `INSERT OR IGNORE` dedup keyed on SNS `MessageId`.
- Gate on `env.SES_EVENTS_SECRET` query param (constant-time compare); 503 if env unset (inert).
- Parse the SES event message (`eventType`: Delivery|Bounce|Complaint|Reject|Send|Open|Click|DeliveryDelay|RenderingFailure), normalize to `email_event` row(s): one row per recipient. Map `mail.messageId` -> `ses_message_id`; `mail.tags` -> category/source/send_id if present; bounce `bounceType`/`bouncedRecipients[].diagnosticCode`; complaint `complaintFeedbackType`; click `click.link` -> link_url. `ts` = the event timestamp.
- Route Bounce(Permanent)/Complaint into the SAME `newsletter_subscriber` status logic `bounce.js` uses (extract a shared helper if clean; otherwise mirror the exact UPDATE guards — never overwrite `unsubscribed`/`complained`).
- Best-effort: never throw to SNS in a way that triggers redelivery storms; dedup makes redelivery safe.

## Build routing
- `events.js` + `admin/email.js`: **coder agent** (mandatory per CLAUDE.md). First line of work: `mkdir -p functions/api/email/` (done). After `events.js`: `npm run guard:update`.
- `email.astro`: **frontend-design** agent, wired to the contract above + the mockup path. Then `web-page-qa`.
- Failure path: arise `data-loss/*` after 2 passes OR coder unconverged after 3 iterations -> STOP, write findings to `~/iCode/.worktrees/email-observability-ph2/.ABORT-findings.md`, surface to Brian.
