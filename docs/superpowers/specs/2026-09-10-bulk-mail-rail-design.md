# Bulk mail rail on rrmacademy.com

**Status:** approved design, 2026-09-10 (Brian); arise deep pass squashed 2026-09-11
**Owner:** RRM Academy (rrm-academy-cf).
**Trigger:** the 2026-09-06 to 09-08 invite drip from `community@rrmacademy.org` (about 2,880 deliveries over three UTC days through the Gmail API) put a 0.55% user-reported spam day on rrmacademy.org in Google Postmaster Tools, above the 0.3% policy line, and flipped the domain's Compliance status to "Needs work". Everything sent as rrmacademy.org shares that verdict, transactional mail included.

## 1. Goal

Multi-thousand sends never touch rrmacademy.org's sender standing again. Bulk mail goes out from a separately owned domain on a hardened rail with caps, warm-up, complaint feedback and one-click unsubscribe. The apex Workspace identity is reserved for paying STUC members under a hard cap, on every machine.

Non-goals: choosing audiences (policy stays with Brian and Naomi), a marketing GUI, open or click tracking pixels, moving transactional mail (that is phase 4, its own spec).

## 2. Decisions taken (do not relitigate)

| Decision | Choice | Rejected |
|---|---|---|
| Priority | Isolation of the apex over Primary-tab placement, except paying STUC members | Primary-first with small waves only |
| Identity | `rrmacademy.com` (owned, zone on the RRM Cloudflare account `ecf2c5bc`, keeps its 301 to rrmacademy.org) | savetheuterus.org, rrm.academy, any rrmacademy.org subdomain (Google folds subdomain data into the apex compliance verdict) |
| Rail | Amazon SES, hardened, reusing the existing newsletter send path, subscriber table and bounce webhook | Hosted ESP (list duplicated outside D1, monthly fee); Cloudflare Email Service (transactional-only, 3,000 a month account-wide) |
| Unsubscribe on the bulk lane | RFC 8058 one-click headers plus a visible link and the postal address | Reply-based opt-out (that stays on the Warm lane only) |
| Warm lane audience | Paying STUC members only | Topic-scoped non-member cohorts (unreconciled with Naomi; see section 8) |

## 3. Lane map

| Lane | From | Rail | Audience | Cap | Tab |
|---|---|---|---|---|---|
| Warm | `"Dr. Naomi Whittaker" <community@rrmacademy.org>` (verified send-as on `virtualassistant@`) | Workspace via `gog` draft + `va-send.sh`, 50 s pacing | paying STUC members | 300 recipients per run, hard, on every machine | Primary |
| Bulk | `"Dr. Naomi Whittaker, RRM Academy" <newsletter@rrmacademy.com>` | SES, configuration set `rrm-bulk` | every other affirmative subscriber | ramp table, max 1,500 a day | Promotions, accepted |
| Transactional | `mail.rrmacademy.org` on Cloudflare Email Sending (lane `cf_rrm`); apex `@rrmacademy.org` addresses stay on SES (lane `ses_rrm`) | site Pages Functions | account holders | none | Primary |

Routing rule: a recipient is Warm when `wix_subscription.status = 'active'` for that email (COLLATE NOCASE) OR `contact_tag.tag = 'stuc:member'`; everything else is Bulk. There is no per-send override.

`wix_subscription.membership_state` (migration 034) is a lapse-reason code, not a status field -- it is NULL for every active member and only ever populated when a membership leaves active. `status` is the field migration 034 itself names as "the gating field other code depends on." The only membership check in production today is the `contact_tag.tag = 'stuc:member'` join (`scripts/femtech-ab-send.mjs`); `send.js` has no membership join at all. Adding the membership join to the newsletter audience query is a phase 1 task (§9).

The Warm lane's Reply-To is `administrator@rrmacademy.org`. The Bulk lane's Reply-To is also `administrator@rrmacademy.org`, a monitored inbox (memory: a Reply-To nobody reads made feedback invisible on the 2026-06-30 send).

## 4. The bulk domain

- **SES identity** for `rrmacademy.com` in the existing SES account and region (`AWS_SES_REGION`, default us-east-1). Easy DKIM (three CNAMEs), custom MAIL FROM `bounce.rrmacademy.com` (MX to SES feedback, SPF `include:amazonses.com`), so SPF and DKIM both align with the From domain.
- **DMARC** on rrmacademy.com: `p=none` with `rua` to the DMARC report mailbox during warm-up, moved to `p=quarantine` once two weeks of reports show only aligned traffic. The `/dmarc-report` skill reads them.
- **Google Postmaster Tools** registration for rrmacademy.com under administrator@ (TXT verification), alongside the existing rrmacademy.org one.
- **Feedback-ID** header on every bulk message: `Feedback-ID: <campaign>:<segment>:rrma:rrmacademy.com`, so Postmaster's Feedback Loop dashboard reports complaint rate per campaign.
- **Web face:** the zone keeps its redirect to rrmacademy.org. An unsubscribe page and the postal address resolve on rrmacademy.org; links in bulk mail may point at rrmacademy.org (link domain is not the sending identity).
- **Sender identities** on the domain: `newsletter@` only. No other mailbox exists on rrmacademy.com; it is a sending identity, not a Workspace domain.

## 5. Hardening the existing send path

The single entry for bulk is `POST /api/newsletter/send` in rrm-academy-cf. It gains:

**5.0 Lane admission (console-kit dependency).** The Bulk From address is `newsletter@rrmacademy.com`. As built today, `vendor/mail/lanes.js` refuses it twice over: `EXEMPTIONS['newsletter-blast'].from` is a closed list (`hello@rrmacademy.org`, `newsletter@mail.rrmacademy.org`) and `SES_SENDER_DOMAINS.rrma` only admits `rrmacademy.org`. `resolveLane()` throws `exemption-sender-not-allowed` on every send from the bulk domain. The mail package changes ONLY in `console-kit/kit/packages/mail`, never in this repo's `vendor/mail/`, so the fix is not a local patch:

1. In console-kit, add `newsletter@rrmacademy.com` to the `newsletter-blast` exemption's `from` list and add `rrmacademy.com` to `SES_SENDER_DOMAINS.rrma`.
2. Version bump, `node bin/console-kit hash`, `sync --apply` into rrm-academy-cf in its own PR, kit tests green.
3. This is phase 1 task zero (§9) -- nothing else in this build can go live before `resolveLane()` accepts the bulk From.

**Pre-mark hazard.** `send.js` writes `newsletter_event(event='sent')` before calling SES (see §5.5), by design, so a genuine SES failure mid-batch is preferred false-positive-sent over a double-send. A lane refusal is not that kind of failure: it is certain and total, not a per-recipient SES error, and it is wrong for it to mark even one recipient sent. The bulk path runs a `resolveLane()` preflight on the From address before touching a single recipient row; a refusal aborts the run with no `newsletter_event` rows written and no D1 writes at all.

**5.1 Policy module** (`functions/api/newsletter/_policy.js`, pure, unit-tested):

- Ramp table keyed on days since the domain's first send, read from D1 `mail_domain_state`:

  | Domain age | Daily cap |
  |---|---|
  | days 1 to 2 | 200 |
  | days 3 to 5 | 500 |
  | days 6 to 12 | 1,000 |
  | day 13 on | 1,500 |

  The daily cap is a ceiling, never a target. A send that would exceed the day's remaining allowance is truncated to it and the remainder is left for the next day, engaged recipients first.
- Per-run cap equals the day's remaining allowance. Pacing is 1 to 2 s between SES calls.
- **First-ever send.** `mail_domain_state` starts empty. A missing row means the domain has never sent, and the policy BLOCKS the run. The CLI flag `--first-send` creates the row with `first_send_at` set, in its own D1 write before any recipient is touched, and the same run then proceeds under the day 1 cap. This is a deliberate gate, not an omission: nothing should compute a "day since first send" against a row that does not exist yet.
- **Circuit breaker.** Before each batch the policy reads `email_event` and `email_log` for the trailing 24 h on the bulk campaign: complaints and hard bounces come from `email_event` (`event_type IN ('complaint','bounce')`, hard bounce is `bounce_type = 'Permanent'`), scoped to the campaign by `ses_message_id` join or by `category`/`source`; sends come from `email_log` rows whose `source` starts with `newsletter/bulk/<campaign>` (the bulk path writes `source = 'newsletter/bulk/<campaign>'`, `category = 'newsletter'`). `events.js` does not write `email_log`, and this spec does not ask it to -- see §5.2. `complained / sent >= 0.2%` or `bounced / sent >= 2%` pauses the run, writes a `send_paused` row with the reason, and alerts. The ratios are evaluated only once `sent >= 50` in the trailing 24 h; below that the breaker does not trip. This is deliberate fail-open on a tiny sample, not a gap -- the daily Postmaster reading in §7 is the backstop for the first hours of warm-up, when 50 sends have not yet gone out. A paused run resumes only by a human passing `--resume` after reading the reason. Google's line is 0.3%; the breaker trips first.
- **Log-write failure halts the run.** The bulk path increments a per-UTC-day counter (`mail_domain_state.sent_today`, keyed on `day`) in the same D1 batch as the `email_log` insert for each send. The daily cap is read from `mail_domain_state.sent_today`, not counted from `email_log` rows, because `insertEmailLog()` (`functions/api/_ses.js`) swallows D1 failures on purpose (a logging failure must never turn into a bounced SES send), and a cap that recounted `email_log` after SES already accepted could undercount and let a rerun exceed the ramp cap. If that D1 batch itself fails, the run PAUSES immediately with `send_paused` reason `log-write-failed`. Delivery outcome is never reclassified by a logging failure (see §5.5); a failed log write halts further sending instead.
- **Cohort ordering.** Recipients are ordered by engagement: `last_clicked_at`, then `last_opened_at`, then `last_sent_at`, then `subscribed_at` descending. Under this build, `last_clicked_at` and `last_opened_at` are never written -- `_template.js` removed the open pixel and click-link wrapping to keep newsletter mail out of Gmail's Promotions tab (see `renderEmail()`), so `functions/api/newsletter/open.js` and `click.js` have no live caller. The effective order during warm-up is therefore `last_sent_at` then `subscribed_at` descending, and "engaged" means recently-sent-to, with `source = 'website'` subscribers first. The two engagement columns stay in the ORDER BY for when tracking returns; warm-up days send only to the engaged head of that order.

**5.2 Complaint and bounce feed.** SES configuration set `rrm-bulk` publishes Bounce, Complaint and Delivery events to an SNS topic subscribed to the existing `functions/api/email/events.js` endpoint (self-described inert today, 503 while `SES_EVENTS_SECRET` is unset; it gets wired, signature-verified, and tested with a real event). `events.js` writes to `email_event`, one row per recipient per SES event type, not to `email_log` -- `email_log` is written by `bounce.js` and by the send path itself (`insertEmailLog()` in `functions/api/_ses.js`). This spec does not ask `events.js` to write `email_log`; §5.1's breaker reads `email_event` for complaints and bounces and `email_log` for sends, as described there. A complaint sets `newsletter_subscriber.status = 'complained'`; a hard bounce (`bounce_type = 'Permanent'`) sets `status = 'bounced'` and increments `bounce_count`, both inside the same `db.batch()` as the `email_event` insert. SES account-level suppression list stays on.

**5.3 Unsubscribe.** Every bulk message carries `List-Unsubscribe: <https://rrmacademy.org/api/newsletter/unsubscribe?t=...>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, a visible unsubscribe link, and the postal address. `newsletter/_tracking.js`'s `unsubscribeHeaders()` produces only the `https:` form today; appending the `mailto:` alternative to the same header is a phase 1 task (§9). The unsubscribe endpoint honors the request immediately (CAN-SPAM allows ten business days; we do not use them). Abort rule from the 2026-06-30 A/B: over 1% unsubscribes on a send means the approach was wrong; stop and rewrite, do not push through.

**5.4 CLI wrapper** (`scripts/bulk-send.mjs`): dry-run by default; prints audience size after exclusions, today's remaining cap, the cohort head it would send to, and the campaign key; requires `--send` to go live; refuses if the checkout is behind `origin/main`. It calls the endpoint; it never holds SES credentials.

**5.5 Exclusions, unchanged from the campaign-send doctrine:** `email_log` already-sent for this campaign key; `status IN ('unsubscribed','bounced','complained')`; STUC members (they get the Warm lane); hard-exclude list. Delivery outcome and logging outcome stay separate (a D1 flake never reclassifies a delivered message).

## 6. Governance across machines

- Only the Pages Function holds SES credentials. No script on any Mac gets an SES key.
- The Warm lane's drip (`scripts/workspace-drip-send.sh` on Brian's machines, and whatever Naomi's Claude builds next) goes through one shared wrapper, `tools/mail-cap/send-cap.sh`, vendored to both Macs, that counts the recipient file and refuses any run over 300 with a message naming the bulk rail. The DWD `gmail.send` key on Naomi's iMac is not removed; the cap is what changes.
- A run log per machine (`.run-log/mail-cap/`) records every refusal and every allowed run with its count.

## 7. Monitoring

- Observatory daemon `bulk-mail-health`: daily reading of SES complaint rate, bounce rate and sent count for `rrm-bulk`, plus the two Postmaster domains' spam-rate rows via the Postmaster Tools API (`gmailpostmastertools.googleapis.com`, read scope, administrator@). Red at complaint 0.2% or spam-rate 0.3% on any day; the morning digest names the campaign.
- `send_paused` rows page the same channel as the breaker.
- Weekly: DMARC aggregate for rrmacademy.com.

## 8. Audience policy, deliberately outside this build

The rail enforces consent state (`status`, exclusions, membership), not who is in scope for a given send. Two positions are open between Brian and Naomi: Brian's topic-scoped rule (a free endometriosis event may go to the endo-survey cohort) and Naomi's "free-event promos to STUC members only" (2026-09-08). Until reconciled, free-event promos go to STUC members only, which means Warm lane only. The 3,058 recipients the September drip never reached go through the Bulk lane after warm-up, engaged first, with Gianna's plain letter, or not at all; the first 2,880 produced 3 registrations.

## 9. Phases

1. **Rail.** Task zero: console-kit mail package exemption + domain admission for `newsletter@rrmacademy.com` (§5.0), synced into this repo and tested green before anything else in this phase starts. Then: SES identity + DNS on rrmacademy.com, Postmaster registration, `rrm-bulk` configuration set and SNS wiring, policy module with tests, CLI wrapper, shared `send-cap.sh` on both Macs, observatory daemon, the membership join in the newsletter audience query (§3), and the `mailto:` alternative in `unsubscribeHeaders` (§5.3).
2. **Warm-up.** Two to three weeks of real sends (not test copy) to engaged cohorts under the ramp table. Seed tests before the first one.
3. **Standing cadence.** Ramp complete; the 3,058 if wanted; DMARC to quarantine.
4. **Separate spec.** `mail.rrmacademy.org` transactional mail already rides Cloudflare Email Sending (lane `cf_rrm`, live since 2026-09-09); the remaining move is the apex `@rrmacademy.org` transactional addresses off SES (`ses_rrm`) onto Cloudflare Email Sending (3,000 a month included on Workers Paid, RRMA runs about 10 to 30 a day). Brian's standing intent is to end SES for transactional entirely; this build does not touch it.

## 10. Testing

- **Lane admission:** `resolveLane()` accepts the bulk From (`newsletter@rrmacademy.com`, entity `rrma`, exemption `newsletter-blast`) and rejects any other `rrmacademy.com` address (including a typo'd local part) with `exemption-sender-not-allowed`.
- **Policy unit tests** (`node:test`): ramp table by domain age, truncation to remaining allowance, cohort ordering, breaker thresholds at exactly 0.2% and 2%, the sub-50-sent fail-open case, and the `log-write-failed` pause on a simulated D1 batch failure. Mutation proof: re-introduce "breaker never trips" and "cap ignored" and watch the suite go red before restoring.
- **Membership routing:** a paid-member fixture (`wix_subscription.status = 'active'`) and a lapsed-member fixture (`status != 'active'`, `membership_state` set) both route correctly -- Warm and Bulk respectively.
- **Events endpoint:** signed SNS fixture for Complaint and Bounce, plus one live SES-generated complaint using the SES mailbox simulator (`complaint@simulator.amazonses.com`) and bounce (`bounce@simulator.amazonses.com`); assert `email_event` rows and `newsletter_subscriber.status`.
- **Unsubscribe round trip:** one-click POST and link GET both flip status and are honored on the next dry run.
- **Seed tests** (`/mail-seed-test`): Gmail personal, Gmail Workspace, Outlook.com and an M365 tenant before the first warm-up send; assert SPF, DKIM, DMARC pass and record the tab.
- **Cap wrapper:** a 301-line recipient file is refused on both Macs; a 300-line one passes; both outcomes appear in the run log.
- **Live proof of phase 1:** one warm-up send of 200 to the engaged head, SNS Delivery events observed for it, Postmaster shows the day for rrmacademy.com.

## 11. Sources for the constraints

Google, Email sender guidelines (support.google.com/mail/answer/81126); Google, Postmaster Tools dashboards (support.google.com/mail/answer/14668346: spam-rate definition, 7-day clearance, subdomain roll-up); Google Workspace sending limits (2,000 messages per user per day; spam senders may be permanently restricted); FTC CAN-SPAM compliance guide; Cloudflare Email Service limits and FAQ (transactional-only, 3,000 a month on Workers Paid, 50 recipients per message); memories `heather-invite-blast-2026-09-06`, `workspace-lane-for-community-updates`, `feedback-no-ses-for-rrmacademy-sends`, `campaign-content-approach-unsub-price`, `stuc-free-webinar-email-audience`.
