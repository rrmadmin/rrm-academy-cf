# Email Observability — Go-Live Runbook

> Built lights-off 2026-06-28 while Brian was remote. Branch `claude/email-observability-ph2` (worktree `~/iCode/.worktrees/email-observability-ph2`, off origin/main). **Nothing committed, nothing deployed, no D1 changes applied, live send path untouched.** This runbook is the path from here to live.

## What is built (held in the worktree, uncommitted for your review)
| File | What |
|------|------|
| `functions/api/email/events.js` | NEW SNS ingestion endpoint. Inert (503) until `SES_EVENTS_SECRET` is set. Reuses bounce.js RSA verification + dedup. arise 0, lint clean. |
| `functions/api/admin/email.js` | REWRITTEN dashboard API (5 views: summary/broadcasts/log/cohort/recipient). 52 empty-safe defaults. Fixes the contract-drift bug. |
| `src/pages/admin/email.astro` | REBUILT mature dashboard. web-page-qa pass at 393 + 1280. Zero key-drift vs the API. Drill-down drawers + CSV export. |
| `guard-manifest.json` | Updated (events.js added to the security guard). |
| `scripts/migrations/2026-06-28-email-event.sql` | HELD migration: `email_event` table + `email_log.ses_message_id`. |
| `scripts/ses/iam-setup-policy.json` | The IAM inline policy to grant for SES/SNS setup. |
| `docs/superpowers/specs/2026-06-27-...-design.md` + `docs/superpowers/plans/2026-06-28-...-execution.md` | Design spec + the binding API contract. |

## Go-live sequence (when you are back at your machine)
1. **Review + commit** the branch (manual commit per your rule), then push. `claude/*` auto-merges via CI.
2. **Apply the D1 migration** (DDL before the code that reads it deploys):
   `cd ~/iCode/projects/rrm-academy-cf && CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - Worker Deploy - account/credential') wrangler d1 execute rrm-auth --remote --file scripts/migrations/2026-06-28-email-event.sql`
3. **Provision the ingest secret:**
   `S=$(openssl rand -hex 32)` -> store at `op://Automation/SES Events Secret/credential` -> `wrangler pages secret put SES_EVENTS_SECRET --project-name rrm-academy` (paste `$S`).
4. **Grant IAM** — ✅ DONE 2026-06-28. Inline policy `ses-event-pipeline-setup` (full SES-family + SNS, all resources) attached to `rrm-ses-sender` (built via the IAM Visual editor; the JSON editor rejected all automated input). Broad/temporary — detachable once wiring is complete (runtime sending only needs the existing `ses:SendEmail`).
5. **SES wiring** — ✅ DONE 2026-06-28 (scripted from workstation CLI). Config set `rrm-email` + SNS topic `arn:aws:sns:us-east-1:690119402957:rrm-ses-events` + topic publish-policy (`ses.amazonaws.com`, condition `AWS:SourceAccount=690119402957`) + event destination `sns-events` matching `SEND, DELIVERY, BOUNCE, COMPLAINT, REJECT, DELIVERY_DELAY, RENDERING_FAILURE` (NO open/click — Phase 5). Verified via `aws sesv2 get-configuration-set-event-destinations --configuration-set-name rrm-email`. **The topic has NO subscriber yet** (the CF endpoint subscribes after deploy, step 7).
6. **Deploy** the branch (CI). The dashboard goes live at `/admin/email`; the ingest endpoint goes live (still inert until subscribed).
7. **Subscribe SNS -> the endpoint:** `aws sns subscribe --topic-arn <rrm-ses-events arn> --protocol https --notification-endpoint "https://rrmacademy.org/api/email/events?secret=$S"`. The endpoint auto-confirms (SSRF-guarded).
8. **Wire `_ses.js` (the ONE deferred live-send-path change):** attach `ConfigurationSetName: 'rrm-email'` on every SendEmail/SendRawEmail and capture the returned SES `MessageId` into `email_log.ses_message_id`. `_ses.js` is a guarded file -> run `npm run guard:update` after. Deploy.
9. **Verify:** send a test email -> SES events flow to `/api/email/events` -> `email_event` rows appear -> the dashboard's deliverability gauges + engagement KPIs + cohort drill-downs light up with real data.

## Follow-on phases
- **Phase 3:** `email-deliverability` observatory daemon (bounce/complaint-rate thresholds vs SES 5%/0.1% lines, welcome-not-firing, churn). Digest-only soak first.
- **Phase 4:** generic `admin-contract` probe (the dead-man's-switch). Audit found only `/admin/email` was drift-broken; this prevents a recurrence on any admin page.
- **Phase 5:** open/click tracking toggle (newsletter broadcasts only; pixel + link-rewrite; transactional stays pixel-free).

## Loose ends to commit separately (different repos/branches, already done, uncommitted)
- `projects/rrm-academy-cf/CLAUDE.md` Newsletter section (welcome-automation docs) — on branch `claude/survey-d1-docs` in the main clone.
- `rrm-academy-internal/ecosystem.json` (`signup_emails` block + email_types + sender purpose) — in the satellite repo.

## Known cosmetic (pre-existing, not introduced)
The admin-bar active-tab renders white-on-white (verbatim from `conversions.astro`, same on every admin page). Left as-is to match siblings. Optional separate cross-page fix.
