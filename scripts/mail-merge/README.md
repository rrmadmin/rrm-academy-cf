# Lane A relationship mail-merge (Google Workspace)

Sends individual, personal-style emails from `community@rrmacademy.org` so member mail
lands in Gmail **Primary**, not Promotions. This is the send mechanism for **Lane A** in
`docs/email-sending-playbook.md`. Marketing blasts still use the SES newsletter (Lane B).

## One-time setup

1. Sign in to **Google Workspace as the Virtual Assistant account** (`virtualassistant@rrmacademy.org`) — it already has `community@rrmacademy.org` as a send-as alias.
   - If the alias is missing: Gmail -> Settings -> Accounts -> "Send mail as" -> add `community@rrmacademy.org` (a Workspace domain alias verifies instantly, no confirmation email). Set the display name to `Dr. Naomi Whittaker`.
2. Create a Google Sheet named e.g. **"STUC Mail Merge"** with a tab named **`Recipients`** and these header columns in row 1:

   | Email | FirstName | Status | Error |
   |-------|-----------|--------|-------|

   - `Email` and `Status` are required. `FirstName` feeds the `{{FirstName}}` merge. Leave `Status` blank for unsent rows; the script stamps a date when sent (so re-runs skip them). `Error` captures failures.
3. In that Sheet: **Extensions -> Apps Script**, delete the stub, paste `Code.gs` from this folder, **Save**.
4. Back in the Sheet, reload the tab. A **"RRM Mail Merge"** menu appears.
5. First run prompts an authorization (it sends mail as you). Approve it (Advanced -> Allow).

## Per-send usage

1. Fill the `Recipients` tab (the `/stuc-comms` skill can generate it from the STUC member list).
2. Edit the EDIT-PER-CAMPAIGN block at the top of `Code.gs`: `SUBJECT` and `buildBodyHtml()` (keep it personal — short paragraphs, plain text links, no styled button, no images, the add-to-contacts line, a postal-address + reply-to-unsubscribe footer).
3. **RRM Mail Merge -> Show send-as check** (confirm `community@` is available).
4. **RRM Mail Merge -> Send test to me** -> check it landed in your Primary tab and renders right.
5. **RRM Mail Merge -> Send to all pending.** Idempotent: already-sent rows (with a Status date) are skipped; failed rows stay blank and retry on the next run.

## Notes

- Sends one message per recipient (no shared To/CC/BCC) — required for the personal look.
- Workspace Apps Script send quota is ~1,500-2,000 recipients/day; STUC (~36) is trivial.
- Replies go to `community@` -> the Virtual Assistant inbox. Watch them; replies are a strong Primary signal.
- CAN-SPAM: cross-check the newsletter suppression list before importing recipients so you never re-mail an opt-out, and honor any "please stop" replies by hand.
