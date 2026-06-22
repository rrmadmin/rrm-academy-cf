# RRM Academy Email Sending Playbook

SSOT for how RRM Academy sends email so the right messages land in the right place.
Authored 2026-06-21 after member-course announcements kept landing in Gmail Promotions.
Verified via a grounded multi-agent analysis of the live pipeline + Perplexity cross-check.

## TL;DR — two lanes, one rule

| | Lane A: Relationship | Lane B: Broadcast |
|---|---|---|
| **Use for** | Warm, member-facing, low volume: STUC course drops, member notices, personal notes from Naomi | Large lists, public newsletter, campaigns |
| **From** | `"Dr. Naomi Whittaker" <community@rrmacademy.org>` (Workspace) | `"Naomi Whittaker" <newsletter@mail.rrmacademy.org>` (SES) |
| **Sent via** | Google Workspace mail-merge (see below) | `POST /api/newsletter/send` (SES) |
| **Style** | Personal: short paragraphs, plain text links, no tracking, no button | Marketing template (button, list, footer) |
| **Gmail tab** | Primary (the goal) | Promotions (acceptable for marketing) |

**The rule:** warm + small + relationship -> Lane A. cold / large / marketing -> Lane B.
**The bug we fixed:** warm member mail was going down Lane B, which is built to look like marketing, so Gmail filed it under Promotions every time.

## Why this works (verified, not folklore)

Gmail's Primary-vs-Promotions decision is driven by **sender identity + per-recipient engagement**, not by the words in the email. Authentication (SPF / DKIM / DMARC) is correctly configured on both `rrmacademy.org` and `mail.rrmacademy.org` and is **not** the lever.

The SES newsletter path fingerprints every message as bulk marketing:
- **Identity:** `newsletter@` local-part + the `mail.` send-only subdomain, which has *learned* bulk reputation at Gmail because it carries all SES traffic.
- **`Precedence: bulk`** header, hardcoded in `functions/api/_ses.js` (`sendRawEmail`). Only two callers use this path (`newsletter/send.js`, `admin/wix-migration-email.js`); all transactional mail uses `sendEmail()` (Simple API) and never sets it.
- **Tracking:** an open pixel + every link rewritten through `/api/newsletter/click` redirects (`_template.js`), plus the SES `rrm-newsletter` configuration set.
- **Content:** styled CTA button + multi-item list + legal/postal/unsubscribe footer = marketing visual grammar.

### What actually moves the tab (ranked)
1. **Sender identity.** A normal Workspace send from `community@rrmacademy.org` sheds the bulk identity. (Not because "Workspace wins" — because it avoids the bulk fingerprint and reputation.)
2. **Per-recipient engagement (the durable override).** If a member adds the sender to **Contacts** and **drags the first email Promotions -> Primary** ("apply to future? yes"), Gmail keeps that sender in Primary for them permanently. At ~36 members you can just ask. This is stronger than any sending-side tweak.
3. **Drop `Precedence: bulk`** for relationship sends.
4. **Personal content** (text link not button, prose not lists) — real but secondary.
5. **Drop tracking** (pixel + link redirects) — minor on its own.

### Placebo (do NOT bother)
Raising DMARC `pct`, BIMI, renaming the config set, moving the pixel to a first-party host while keeping tracking, or **stripping `List-Unsubscribe`** (keep it — removing it has downside and does not move the tab).

### Caveats
- Verification can't use Gmail Postmaster Tools (you're far below its ~100-200/day display threshold). Test by sending to two or three personal Gmail accounts and eyeballing the tab.
- Tab placement is partly per-recipient and learned; results will be uneven until members engage.
- Confirm the SES `rrm-newsletter` config set's open/click tracking state in the AWS console if quantifying Lane B.

## Lane A recipe (the relationship email)

- **From:** `"Dr. Naomi Whittaker" <community@rrmacademy.org>`. `community@` is a Workspace alias on `virtualassistant@rrmacademy.org` (siblings: `contentmarketing@`, `seo-team@`). It is the established Save the Uterus Club broadcast identity. Replies land in the Virtual Assistant inbox — monitor them (replies are a strong Primary signal).
- **Voice:** the STUC member register (full "Save the Uterus Club", casual, "Dr. Whittaker"). No em dashes, no emojis unless asked.
- **Format:** 2-3 short paragraphs. Name one or two things in prose, link the rest. **Plain inline text links** (`you can browse the member courses here`), never a styled CTA button. No tracking pixel, no link-redirect wrapping.
- **First-send ask:** one friendly line — "add this address to your contacts so these reach your main inbox."
- **CAN-SPAM:** one quiet line with the postal address + "reply and I'll take you off the list." Cross-check the newsletter suppression tags before sending so you never re-mail an opt-out.
- **Subject:** lowercase, first-person, no brackets / emoji / promo words ("a few new recordings I wanted to share"), not "New courses now available".

## How Lane A is sent: Google Workspace mail-merge

Lane A does not go through any RRM Worker. It is sent from `community@` via a Workspace mail-merge (Apps Script bound to a recipients Sheet). See `scripts/mail-merge/` and the `/stuc-comms` skill. The script sends **one individual message per recipient** (no shared To/CC/BCC), with `community@` as the From via Workspace send-as. Authorize it once in the Virtual Assistant account.

## Lane B (the existing SES newsletter)

Unchanged. For genuine marketing / large lists. Keep `List-Unsubscribe`. Promotions placement is expected and fine. Driven by `functions/api/newsletter/send.js`.

## Optional: code-side relationship lane

A `relationship: true` path can be threaded through `send.js -> renderEmail -> sendRawEmail` that drops `Precedence: bulk` (gated in `_ses.js`, default `bulk:true` preserved for existing callers), the tracking pixel + link wrapping (`_template.js`), and the SES config set, and sets a human From. This automates Lane-style sends but still rides SES reputation, so it is inferior to Workspace for Primary placement and is **not the default**. Build it only if member sends must be programmatic. `send.js` and `_ses.js` are security-guarded: any edit needs `npm run guard:update` + the single-commit security ritual.

## STUC course-release flow (end to end)

1. **Build** the course from the recording — `/recording-to-course` (upload -> manifest -> clip -> wire D1 -> cover -> draft).
2. **Publish** — gated on explicit go-live.
3. **Announce:**
   - **Group post** to the Save the Uterus Club community feed, from Naomi (community posts API).
   - **Member email** via **Lane A** (this playbook), sent from `community@` by mail-merge.

## References
- Memory: `email-sending-lanes-primary-vs-promotions`, `feedback-stuc-member-voice`, `feedback-email-sending-rrmacademy`.
- Analysis: grounded multi-lens workflow + Perplexity Sonar cross-check, 2026-06-21.
