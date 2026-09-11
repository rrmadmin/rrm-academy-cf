# Bulk mail rail on rrmacademy.com

**Status:** approved design, 2026-09-10 (Brian). Implementation plan follows via writing-plans.
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
| Transactional | `mail.rrmacademy.org` on SES today | site Pages Functions | account holders | none | Primary |

Routing rule: `membership_state = paid STUC` selects Warm; anything else selects Bulk. There is no per-send override.

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
- **Circuit breaker.** Before each batch the policy reads `email_log` for the trailing 24 h on the bulk lane: `complained / sent >= 0.2%` or `bounced / sent >= 2%` pauses the run, writes a `send_paused` row with the reason, and alerts. A paused run resumes only by a human passing `--resume` after reading the reason. Google's line is 0.3%; the breaker trips first.
- **Cohort ordering.** Recipients are ordered by engagement: `last_clicked_at`, then `last_opened_at`, then `last_sent_at`, then `subscribed_at` descending. Warm-up days send only to the engaged head of that order.

**5.2 Complaint and bounce feed.** SES configuration set `rrm-bulk` publishes Bounce, Complaint and Delivery events to an SNS topic subscribed to the existing `functions/api/email/events.js` endpoint (self-described inert today; it gets wired, signature-verified, and tested with a real event). A complaint sets `newsletter_subscriber.status = 'complained'` and writes `email_log(event='complained')`; a hard bounce sets `bounced` and increments `bounce_count`. SES account-level suppression list stays on.

**5.3 Unsubscribe.** Every bulk message carries `List-Unsubscribe: <https://rrmacademy.org/api/newsletter/unsubscribe?t=...>, <mailto:...>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (already produced by `newsletter/_tracking.js`), a visible unsubscribe link, and the postal address. The unsubscribe endpoint honors the request immediately (CAN-SPAM allows ten business days; we do not use them). Abort rule from the 2026-06-30 A/B: over 1% unsubscribes on a send means the approach was wrong; stop and rewrite, do not push through.

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

1. **Rail.** SES identity + DNS on rrmacademy.com, Postmaster registration, `rrm-bulk` configuration set and SNS wiring, policy module with tests, CLI wrapper, shared `send-cap.sh` on both Macs, observatory daemon.
2. **Warm-up.** Two to three weeks of real sends (not test copy) to engaged cohorts under the ramp table. Seed tests before the first one.
3. **Standing cadence.** Ramp complete; the 3,058 if wanted; DMARC to quarantine.
4. **Separate spec.** Transactional mail to Cloudflare Email Service from the rrmacademy.org apex (3,000 a month included on Workers Paid, RRMA runs about 10 to 30 a day); retire `mail.rrmacademy.org` and SES transactional. Brian's standing intent is to end SES for transactional; this build does not touch it.

## 10. Testing

- **Policy unit tests** (`node:test`): ramp table by domain age, truncation to remaining allowance, cohort ordering, breaker thresholds at exactly 0.2% and 2%. Mutation proof: re-introduce "breaker never trips" and "cap ignored" and watch the suite go red before restoring.
- **Events endpoint:** signed SNS fixture for Complaint and Bounce, plus one live SES-generated complaint using the SES mailbox simulator (`complaint@simulator.amazonses.com`) and bounce (`bounce@simulator.amazonses.com`); assert `newsletter_subscriber.status` and `email_log` rows.
- **Unsubscribe round trip:** one-click POST and link GET both flip status and are honored on the next dry run.
- **Seed tests** (`/mail-seed-test`): Gmail personal, Gmail Workspace, Outlook.com and an M365 tenant before the first warm-up send; assert SPF, DKIM, DMARC pass and record the tab.
- **Cap wrapper:** a 301-line recipient file is refused on both Macs; a 300-line one passes; both outcomes appear in the run log.
- **Live proof of phase 1:** one warm-up send of 200 to the engaged head, SNS Delivery events observed for it, Postmaster shows the day for rrmacademy.com.

## 11. Sources for the constraints

Google, Email sender guidelines (support.google.com/mail/answer/81126); Google, Postmaster Tools dashboards (support.google.com/mail/answer/14668346: spam-rate definition, 7-day clearance, subdomain roll-up); Google Workspace sending limits (2,000 messages per user per day; spam senders may be permanently restricted); FTC CAN-SPAM compliance guide; Cloudflare Email Service limits and FAQ (transactional-only, 3,000 a month on Workers Paid, 50 recipients per message); memories `heather-invite-blast-2026-09-06`, `workspace-lane-for-community-updates`, `feedback-no-ses-for-rrmacademy-sends`, `campaign-content-approach-unsub-price`, `stuc-free-webinar-email-audience`.
