# RRM transactional mail: SES to Cloudflare Email Sending, 2026-09-09

RRM Academy transactional mail moved from Amazon SES to Cloudflare Email
Sending on 2026-09-09. This file is the evidence for the switch, not the deploy
note: real sends, from production, read back out of the recipient mailbox.

## What changed

`vendor/mail` went to 1.5.0 by `console-kit sync`, and the lane rule in it is
where the rail decision lives. An `rrma` sender on `@mail.rrmacademy.org`, the
subdomain onboarded to Cloudflare Email Sending on the RRM account, now
resolves to lane `cf_rrm`; an `@rrmacademy.org` apex sender still resolves to
`ses_rrm`. Every transactional sender in this repo was already on the mail
subdomain, so no call site changed. The adapter `functions/api/_ses.js` gained
one key, `fallback: 'ses'` in its `deps`, which is the only way back to SES at
runtime and only on a Cloudflare 5xx or no answer at all.

Two Pages secrets were added to the `rrm-academy` project on the production AND
preview environments: `EMAIL_SEND_ACCOUNT_ID` and `EMAIL_SEND_TOKEN` (the
domain-scoped token `CF - Email Sending - rrmacademy-mail` in 1Password
Automation).

## Senders that stay on SES

The lane follows the sending subdomain, so an apex `@rrmacademy.org` address is
still an SES send. In this repo those are:

| caller | from | why it stays |
|---|---|---|
| `functions/api/community/_email.js` (STUC event mail, club broadcasts, `STUC_BROADCAST_SENDER`) | `community@rrmacademy.org` | apex sender; STUC member mail is the Workspace lane's own traffic and the `stuc-overdue-outreach` exemption is bound to this address |
| `functions/api/_mail-lanes.js` Workspace identities (`surveys@rrmacademy.org`, `receipts@rrmacademy.org`, `community@rrmacademy.org`) | apex | these are Gmail send-as identities on the Workspace rail, never handed to `_ses.js` |
| the newsletter blast (`newsletter/send.js`, `send-first-email.js`, `_signup-emails.js`) | `newsletter@mail.rrmacademy.org` | on the mail subdomain, but claims the `newsletter-blast` exemption, which resolves `ses_rrm` by rule |

Everything else (auth, billing receipts, contact, survey, quiz, pdf, courses,
partners, the Google Ads alert, the community flag alert) is on
`@mail.rrmacademy.org` and moved to `cf_rrm` with the sync.

## Inbox placement, Gmail

Recipient `administrator+test@rrmacademy.org` (Google Workspace). Each row is a
real send through an existing production endpoint, matched to its `email_log`
row and then to the message as Gmail actually filed it.

| # | message | endpoint | lane | from | DKIM as | Gmail tab | message id |
|---|---|---|---|---|---|---|---|
| 1 | survey magic link | `POST /api/survey/request` (preview deploy) | `cf_rrm` | `survey@mail.rrmacademy.org` | `dkim=pass header.i=@mail.rrmacademy.org` (s=cf-bounce) | Primary (`CATEGORY_PERSONAL`), Inbox | `<iLo3UfarHznZFaqHVu8QFPnWLk131Kuv3gN8@mail.rrmacademy.org>` |
| 2 | survey magic link | `POST /api/survey/request` (production) | `cf_rrm` | `survey@mail.rrmacademy.org` | `dkim=pass header.i=@mail.rrmacademy.org` (s=cf-bounce) | Primary (`CATEGORY_PERSONAL`), Inbox | `<47rzmju0XhMPnNH32oO5DSiwQBMO0W8SCxcj@mail.rrmacademy.org>` |
| 3 | password reset | `/forgot-password/` form (production) | `cf_rrm` | `accounts@mail.rrmacademy.org` | `dkim=pass header.i=@mail.rrmacademy.org` (s=cf-bounce) | Primary (`CATEGORY_PERSONAL`), Inbox, marked Important | `<OIvJl0ScNRi418IlQhMfLgEEDjAvoLXATOwH@mail.rrmacademy.org>` |
| 4 | guide PDF download link | `/rrm-care-team/` form (production) | `cf_rrm` | `info@mail.rrmacademy.org` | `dkim=pass header.i=@mail.rrmacademy.org` (s=cf-bounce) | Updates (`CATEGORY_UPDATES`), Inbox, marked Important | `<g6eBo2Wpkvg0JyFye8Ehlok1HWOVALJGKxa5@mail.rrmacademy.org>` |
| B | survey magic link, SES baseline | `POST /api/survey/request` (production, 42 minutes before row 2) | `ses_rrm` | `survey@mail.rrmacademy.org` | `dkim=pass header.i=@mail.rrmacademy.org` plus `dkim=pass header.i=@amazonses.com` | Updates (`CATEGORY_UPDATES`), Inbox | `<010001a086ea7ea5-2d275e07-42c8-4965-96af-3ad03f3d7931-000000@email.amazonses.com>` |

Every Cloudflare send carries two DKIM signatures, the service's own
`@cloudflare-smtp.net` and the domain's `@mail.rrmacademy.org`, with
`spf=pass` from `bounces@cf-bounce.mail.rrmacademy.org`. The domain-aligned
signature is the one that matters and it passes.

### What the comparison does and does not show

Row B is the only true like for like: the same message type, to the same
mailbox, on the same day, 42 minutes apart. It went to Updates on SES and to
Primary on Cloudflare. That is one observation, not a law: Gmail's tab
assignment is per recipient and it learns, so read it as "the new rail is not
being filed worse", not as "the new rail wins Primary".

Rows 3 and 4 have no SES counterpart to this mailbox at all: `email_log` holds
no prior `auth/forgot-password` or `pdf/request` send to
`administrator+test@`, so their tab is recorded without a baseline. Row 4
landing in Updates while row 3 landed in Primary is the expected shape, a
download link with an unsubscribe footer against a personal account action.

Yesterday's SES volume, for the record: 17 `survey/request`, 1
`contact/confirm`, 1 `contact/notify`, all with `lane` recorded as the old
literal `ses`.

### The Outlook and M365 leg was not run, on purpose

There is no way to send a `cf_rrm` message to an M365 mailbox through an
existing endpoint in this repo. `functions/api/_mail-lanes.js` sniffs the
recipient's MX and routes anything on Microsoft 365 to the Google Workspace
lane before `_ses.js` is ever called, which is the whole point of that file.
The estate's readable M365 mailboxes are all on that path, and the one
NeoFertility address that is not, `beacon@neofertility.ie`, is a live patient
correspondence inbox that automation never writes to. Sending a bare REST
message from the rail would have proved something about Cloudflare rather than
about this repo, so it was not done. If M365 placement is wanted later, the
honest test is to disable the Workspace lane for one recipient, not to bypass
the adapter.

## What has not been removed

The SES fallback and the `AWS_*` Pages secrets stay. `email_log.lane` and the
Analytics Engine rows get watched for a week; a fallback is visible as two AE
rows, the failed `cf_rrm` leg and then an `ses_rrm` leg whose detail is
prefixed `fell-back-from=cf_rrm`, and as one `email_log` row carrying
`fell_back_from`. When the week is clean, drop `fallback` from the adapter's
deps, remove the `AWS_*` secrets, and take SES off the `rrm-ses-sender` IAM
key. The Foundation follows the same path once `mail.rrm.foundation` is
onboarded to its own account.
