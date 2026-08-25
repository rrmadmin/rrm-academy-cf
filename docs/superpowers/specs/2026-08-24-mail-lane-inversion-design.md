# Mail Lane Inversion: Workspace-First, SES Demoted to Fallback

> **Component:** `mail-lane-inversion`
> **Repo:** `/Users/brian/iCode/projects/rrm-academy-cf`
> **Date:** 2026-08-24
> **Status:** DESIGN, not built. No production change proposed by this document.
> **Author:** Claude, from Brian's decision of 2026-08-24 (memory `feedback-no-ses-for-rrmacademy-sends`).
> **Terminal target:** HELD per stage. Every stage that touches routing holds for Brian's explicit go. Nothing in this spec auto-deploys.
> **Builds on:** `docs/superpowers/specs/2026-06-27-email-observability-system-design.md` (email_log, lanes, the SES event feed), `docs/email-sending-playbook.md` (the two-lane SSOT), `functions/api/_mail-lanes.js` (the dual-lane router shipped 2026-08-03).

---

## 1. Problem and measured evidence

### 1.1 The rule

Brian, 2026-08-24, recorded HARD in memory `feedback-no-ses-for-rrmacademy-sends`: do not send RRM Academy mail via AWS SES, "generally not either" beyond STUC event reminders, and "I'd almost rather disable SES for RRM Academy entirely."

The reason is not reputation theory, it is a measured experiment. `docs/email-sending-playbook.md:22` records the 2026-07-11 test: identical copy, same recipient, same direct-delivery Gmail mailbox. From SES it landed in Promotions even with `List-Unsubscribe` stripped and plain personal prose. From a Google Workspace apex identity it landed in Primary. `docs/email-sending-playbook.md:30-38` ranks the levers and puts SPF, DKIM, DMARC pct and BIMI in the placebo column. The lane decides the tab, not the content.

### 1.2 Why the rule cannot be applied by switching SES off

Last 30 days: 488 sends on the SES lane, 5 on the Workspace lane. SES carries roughly 99 percent of RRM Academy mail, including `auth/reset-password`, `auth/login`, `auth/signup`, `billing/*`, `contact/*` and `survey/request`. Disabling SES today breaks password resets and purchase receipts before it improves any placement.

### 1.3 Why the router does not already solve it

`functions/api/_mail-lanes.js:252` `sendTransactionalEmail` is signature-compatible with `sendEmail`, and 20 call sites already use it. It reaches the Workspace lane only when three gates all pass:

| Gate | Line | Behavior on miss |
|---|---|---|
| All three Workspace secrets present | `_mail-lanes.js:255-258` | straight to SES |
| `to` is not an array | `_mail-lanes.js:260-262` | straight to SES |
| `isM365Recipient(to)` is true | `_mail-lanes.js:264-267` | straight to SES |

Gate three is the blocker. It is a DoH MX lookup for a target ending `.mail.protection.outlook.com` (`_mail-lanes.js:16`, 1500 ms timeout at `:17`, 1 hour / 500 entry cache at `:22-24`), and it fails toward false. Every `gmail.com` recipient, which is the bulk of the member base, goes SES by construction. The router was built for a Microsoft 365 deliverability problem, not for the Promotions problem.

### 1.4 Why the default cannot simply be flipped today

`WORKSPACE_FROM_MAP` at `_mail-lanes.js:107-109` contains exactly one entry:

```
accounts: 'RRM Academy <receipts@rrmacademy.org>'
```

`WORKSPACE_FROM_DEFAULT` at `_mail-lanes.js:96` is `'RRM Academy <surveys@rrmacademy.org>'`. `workspaceFromFor` (`_mail-lanes.js:127-133`) returns the map value on a `hasOwnProperty` hit and the default otherwise. `sendViaWorkspace` (`_mail-lanes.js:190`) never passes the caller's `from` through: line 192 replaces it, and line 198 writes the replacement as the only `From` header. The caller's `from` survives only as a lookup key.

The application uses ten distinct sender local-parts. Flipping the lane default today therefore produces exactly two outcomes and no error:

**A. Rewritten to `receipts@rrmacademy.org`** (local-part `accounts` hits the map): all nine auth call sites and all fifteen `sendEmailSafe` callers. Password reset (`auth/forgot-password.js:104`), sign-in security alert (`auth/login.js:110`), password changed (`auth/reset-password.js:121`, `auth/change-password.js:100`), email address changed (`auth/google-callback.js:285`) would all arrive from a receipts identity. A password reset from `receipts@` reads as phishing. This is the highest-severity item in the whole set.

**B. Rewritten to `surveys@rrmacademy.org`** (no map entry): everything else. Most damaging is `"Dr. Naomi Whittaker" <community@rrmacademy.org>` collapsing to `RRM Academy <surveys@rrmacademy.org>` at `events/register.js:226`, `events/remind.js:126` and `community/_email.js:261`. Both the display name and the address are lost. That identity is the documented Lane A relationship sender (`docs/email-sending-playbook.md:12`, `:47`), the exact reason `community/_email.js:74-77` moved those sends to the apex, and it carries the free-event Google Meet joining credential.

**C. Correct by accident.** `survey/request.js:126` passes local-part `survey` (singular), misses the map, and lands on the `surveys@` (plural) default. It looks right. `test/mail-lanes.test.js:208` pins the fallback, not a mapping. Rename the default and it breaks silently.

### 1.5 The silence is the real defect

There is no log line, no alert, and no `email_log` column recording the rewritten `From`. `insertEmailLog` (`functions/api/_ses.js:9-27`) writes `event, email, category, source, subject, detail, send_id, ses_message_id, lane`. The schema is `schema.sql:290-300` plus `scripts/migrations/2026-06-28-email-event.sql:22` (`ses_message_id`) and `scripts/migrations/2026-08-03-email-log-lane.sql:15` (`lane`). A wrong sender identity is indistinguishable from a right one after the fact. Any flip performed before that is fixed is unauditable.

### 1.6 Volume fits, with headroom

Measured daily volume is 7 to 48 sends, typically 10 to 27. The documented Workspace ceiling is roughly 2000 messages per rolling 24 hours (`tools/fall-cohort-send/lib/config.py:231`; `scripts/mail-merge/README.md:32` restates the same figure). The self-imposed operating cap is 1200 per rolling 24 hours with a 500 per-run cap (`config.py:235`, `:240`, `:243`), enforced as a refusal, never a truncation. Largest proven single-day Workspace run: 94 sends, zero failures, 2026-08-24 evening ET (`~/iCode/.run-log/stuc-aug24-livenow.run.log`, `~/iCode/.run-log/va-send.jsonl`). Transactional volume fits inside Workspace with roughly 40x headroom. The newsletter does not (section 7.1).

### 1.7 The decision this spec implements

Invert the default. Workspace-first for all single-recipient transactional mail. SES demoted to error-fallback and to the bulk newsletter lane. Not deletion.

---

## 2. Scope, non-goals, deny-list

### 2.1 In scope

1. A total, explicit sender-identity registry keyed by a caller-declared identity key, replacing local-part guessing.
2. Registration of the missing Gmail send-as identities on `virtualassistant@rrmacademy.org`.
3. Recording the emitted `From` identity in `email_log`, and making an unmapped identity a loud, alerting, SES-routed failure instead of a silent rewrite.
4. A per-identity, secret-flippable lane default so the inversion lands incrementally and reverses without a deploy.
5. Proof gates that are falsifiable: seed-tested Primary placement per identity, and an assertion that no send reaches `WORKSPACE_FROM_DEFAULT` unintentionally.

### 2.2 Explicit NON-GOALS

**Deleting AWS SES is a non-goal.** SES remains configured, credentialed, and reachable. It is the error-fallback for every Workspace failure (`_mail-lanes.js:285-298`), and it remains the sole transport for the bulk newsletter lane.

**Retiring the `mail.rrmacademy.org` subdomain is a non-goal.** The subdomain identity, its Easy DKIM CNAMEs, its custom MAIL FROM `bounce.mail.rrmacademy.org` (`CLAUDE.md:400`), the SES configuration set, and the `@mail.rrmacademy.org` Message-ID domain hardcoded at `_ses.js:124` all stay exactly as they are. No DNS record is removed by any stage of this plan. The subdomain is the newsletter's home and the fallback's home.

Also out of scope:

- Any change to the bulk newsletter lane (`newsletter/send.js:333`, `admin/wix-migration-email.js:157`, the `sendRawEmail` path and its hardcoded `Precedence: bulk` at `_ses.js:132`).
- The DMARC `p=none` to `p=quarantine` move (`docs/plans/backlog.md:138`) and the legacy Wix SPF include cleanup (`docs/plans/backlog.md:297`). Both are pre-existing open items, both are touched by nothing here.
- Open and click tracking, pixels, and link redirectors. The Workspace lane emits none today (`_mail-lanes.js:197-215` writes no tracking headers and no configuration set) and must continue to emit none.
- Any second sending mailbox, service account, or OAuth client.

### 2.3 Deny-list (enforced at the conformance gate)

These paths must be untouched by any commit in this component:

```
functions/api/newsletter/send.js
functions/api/newsletter/_mail.js
functions/api/newsletter/_signup-emails.js
functions/api/newsletter/send-first-email.js
functions/api/newsletter/bounce.js
functions/api/admin/wix-migration-email.js
functions/api/email/events.js
functions/api/_ses.js  (sendRawEmail and sendEmail bodies; insertEmailLog signature may gain one field, see Stage 0)
scripts/gates/validate-email-trickle.mjs
```

### 2.4 Risk surface (for the Phase 0.1 acceptance)

- **New endpoints:** one, optional and Stage 3 only. `POST /api/admin/mail-seed` behind the existing admin auth, sends one seed message per identity to a fixed operator-owned recipient list. It is deleted at the end of Stage 3 or kept behind the admin gate, Brian's call (section 8, Q6).
- **Data collected or returned:** one new `email_log` column, `from_identity`, holding a sender identity string we author. No new PII. Recipient address is already logged.
- **Egress destinations:** unchanged set. `oauth2.googleapis.com` (`_mail-lanes.js:89`), `gmail.googleapis.com` (`_mail-lanes.js:90`), the SES regional endpoint, `cloudflare-dns.com` for the MX probe (which this component removes from the hot path), and `api.telegram.org` for the failure alert.
- **IAM and privilege:** no new tokens. The three existing Pages secrets `GOG_CLIENT_ID`, `GOG_CLIENT_SECRET`, `VA_GMAIL_REFRESH_TOKEN` (verified present on Pages project `rrm-academy`, account `ecf2c5bc8b5ebd634bcb587b3890910a`). Send-as registration uses the existing domain-wide-delegation service account `rrm-calendar-automation@rrm-academy.iam.gserviceaccount.com` with the already-granted `gmail.settings.sharing` scope (`skills/gmail/SKILL.md:40-52`).
- **New dependencies:** none.

---

## 3. Sender identity inventory

Send-as status verified live 2026-08-24 via `gog -a virtualassistant@rrmacademy.org --gmail-no-send -j gmail sendas list`. Registered and `accepted` today: `virtualassistant@` (primary), `community@`, `hello@`, `surveys@`, `receipts@`. Everything else in the target column needs registration.

The apex column is the crux. The Workspace lane can only ever emit an apex identity, because a send-as must be an address the VA mailbox owns. Routing a `@mail.rrmacademy.org` sender through Workspace is always a domain change, never merely a local-part change.

| # | Current `From` | Call sites | Class | Target Workspace send-as | Send-as today | Apex move needed | Stage |
|---|---|---|---|---|---|---|---|
| 1 | `RRM Academy <accounts@mail.rrmacademy.org>` | `auth/login.js:110`, `auth/forgot-password.js:104`, `auth/signup.js:154`, `auth/signup.js:237`, `auth/resend-verification.js:80`, `auth/google-callback.js:138`, `auth/google-callback.js:285`, `auth/reset-password.js:121`, `auth/change-password.js:100` | security notice | `RRM Academy <accounts@rrmacademy.org>` | **missing, register** | **YES** | 4b |
| 2 | `RRM Academy <accounts@mail.rrmacademy.org>` | `billing/_webhook-shared.js:34` via `_webhook-checkout.js:237,320,380,404,1014`, `_webhook-subscription.js:378`, `_webhook-invoice.js:37` | user receipt | `RRM Academy <receipts@rrmacademy.org>` | accepted | **YES** | 4c |
| 3 | `RRM Academy <accounts@mail.rrmacademy.org>` | `_webhook-checkout.js:489,676,693,717,934,977`, `_webhook-subscription.js:224`, `_webhook-refund.js:32` (all to `administrator@`) | internal ops | held, candidate `RRM Academy Alerts <alerts@rrmacademy.org>` | missing | held (Q3) | 5 |
| 4 | `RRM Academy <accounts@mail.rrmacademy.org>` | `courses/_notify-admin.js:25` (direct SES) | internal ops | same as row 3 | missing | held (Q3) | 5 |
| 5 | `RRM Academy <hello@mail.rrmacademy.org>` | `auth/signup.js:53` | welcome | `RRM Academy <hello@rrmacademy.org>` | accepted | **YES** | 4a |
| 6 | `RRM Academy <contact@mail.rrmacademy.org>` | `contact/submit.js:121` (confirmation) | relationship | `RRM Academy <contact@rrmacademy.org>` | **missing, register** | **YES** | 4a |
| 7 | `RRM Academy <contact@mail.rrmacademy.org>` | `contact/submit.js:94` (admin notify, direct SES, reply-to is the submitter) | internal ops | held, see row 3 | missing | held (Q3) | 5 |
| 8 | `RRM Academy <info@mail.rrmacademy.org>` | `pdf/request.js:114`, `quiz/request.js:201`, `endo-quiz/request.js:167` | guide delivery | `RRM Academy <info@rrmacademy.org>` | **missing, register** | **YES** | 4a |
| 9 | `RRM Academy <survey@mail.rrmacademy.org>` | `survey/request.js:126` | survey invite | `RRM Academy <surveys@rrmacademy.org>` | accepted | **YES** | 4a |
| 10 | `"Dr. Naomi Whittaker" <community@rrmacademy.org>` | `community/_email.js:90` (`STUC_BROADCAST_SENDER`), `:131`, `:261`; `events/_email.js:27` (`REGISTER_FROM`), `events/register.js:226`, `events/remind.js:126` | STUC relationship | identical, unchanged | accepted | no, already apex | 4d |
| 11 | `"Brian Whittaker" <brian@rrmacademy.org>` | `community/_email.js:80` | community reply | held, candidate: collapse to `"Brian Whittaker" <community@rrmacademy.org>` | missing, ownership blocker | no, already apex | held (Q4) |
| 12 | `"Dr. Naomi Whittaker" <naomi@rrmacademy.org>` | `community/_email.js:82` | community reply | held, candidate: collapse to row 10 | missing, ownership blocker | no, already apex | held (Q4) |
| 13 | `"<Author name>" <community@rrmacademy.org>` | `community/_email.js:92-98` fallback, used at `:261` and `:392` | community reply | identical address, display name preserved | accepted (address) | no | 4d |
| 14 | `RRM Academy Alerts <alerts@mail.rrmacademy.org>` | `_google-ads.js:79` used at `:236`,`:274` (no `log` key, writes no `email_log` row), `survey/submit.js:173`, `endo-quiz/request.js:147`, `community/flags.js:285` | internal alert | held, candidate `RRM Academy Alerts <alerts@rrmacademy.org>` | missing | held (Q3) | 5 |
| 15 | `RRM Academy <administrator@mail.rrmacademy.org>` | `partners/_emails.js:10` used at `:87`,`:137`,`:188`,`:238` | partner relationship | held, candidate new `partners@rrmacademy.org` | missing, ownership blocker on `administrator@` | held (Q5) | 5 |
| 16 | `"RRM Academy Events" <community@rrmacademy.org>` | `community/_email.js:335` (share link to `naomimwhittaker@gmail.com`) | internal | identical | accepted | no | 5 |
| 17 | `"Naomi Whittaker" <newsletter@mail.rrmacademy.org>` | `newsletter/send.js:333`, `send-first-email.js:74`, `_signup-emails.js:25` and `:83`, `admin/wix-migration-email.js:157` | bulk newsletter | **none. stays on SES permanently** | n/a | **NO, by design** | never |

Registration blockers worth naming now. Rows 11, 12 and 15 target addresses that are or may be separate Workspace users rather than aliases the VA mailbox can own. A directory alias cannot be attached to a mailbox when the address belongs to another user, and `sendAs.create` does not create the directory alias (`skills/gmail/SKILL.md:52`, the one manual Admin console step Brian performs). Those three rows are held, not scheduled.

---

## 4. Design

### 4.1 Caller-declared identity keys, not local-part guessing

The map mechanism is structurally insufficient, independent of how many keys it has. Rows 1, 2, 3 and 4 of section 3 all pass the identical string `RRM Academy <accounts@mail.rrmacademy.org>` (`billing/_webhook-shared.js:34` hardcodes it for all fifteen billing callers) and require three different target identities. No function of the local-part can separate a password reset from a purchase receipt from an internal ops alert.

Add an explicit `identity` option to `sendTransactionalEmail`:

```js
// functions/api/_mail-identities.js  (new, single source of truth)
export const WORKSPACE_IDENTITIES = {
  auth:      'RRM Academy <accounts@rrmacademy.org>',
  receipts:  'RRM Academy <receipts@rrmacademy.org>',
  welcome:   'RRM Academy <hello@rrmacademy.org>',
  contact:   'RRM Academy <contact@rrmacademy.org>',
  guides:    'RRM Academy <info@rrmacademy.org>',
  surveys:   'RRM Academy <surveys@rrmacademy.org>',
  community: '"Dr. Naomi Whittaker" <community@rrmacademy.org>',
  // community_author is resolved dynamically, address fixed to community@,
  // display name supplied by the caller and sanitized as today
  // (community/_email.js:92-98).
};
```

Resolution becomes total and loud:

1. `opts.identity` present and in the registry: use it.
2. `opts.identity` present and not in the registry: **do not send on the Workspace lane.** Write `email_log` with `event='lane_identity_unmapped'`, `detail=<the key>`, push a Telegram alert, and route the send to SES with its original `from` intact.
3. `opts.identity` absent: same as case 2, with `detail='missing-identity-key'`.

The existing `parseFromLocalPart` and `workspaceFromFor` (`_mail-lanes.js:117-133`) stay in place for one release as the legacy path for any call site not yet stamped, but every legacy resolution also writes `event='lane_identity_legacy'`. `WORKSPACE_FROM_DEFAULT` (`_mail-lanes.js:96`) stops being a fallback and becomes only the value of the `surveys` registry key. After Stage 4 the legacy path is removed and its absence is asserted by a CI gate.

This is the mechanism that satisfies proof gate 5.2: the silent mislabel becomes an alerting, logged, SES-routed refusal.

### 4.2 Routing predicate

`isM365Recipient` (`_mail-lanes.js:264-267`) stops being the routing decision. It is retained as a diagnostic only, or removed. Removing it from the hot path removes a 1500 ms DoH round trip per send and an availability dependency whose failure mode is "silently take the worse lane."

The new predicate, evaluated in order at `_mail-lanes.js:252`:

1. Workspace secrets absent (`:255-258`): SES. **Unchanged and non-negotiable.** Deploying the module ahead of the secrets stays a no-op.
2. `Array.isArray(to)` (`:260-262`): SES. **Unchanged and non-negotiable.** `sendViaWorkspace` at `_mail-lanes.js:195` takes `to[0]` only, so an array on the Workspace lane silently drops recipients. No current caller passes an array, which makes this dead code today, and it must stay dead code that works.
3. Identity unresolvable (section 4.1): SES, loudly.
4. Identity's key is not in `WORKSPACE_LANE_IDENTITIES` (a comma-separated Pages secret, the incremental flip control): SES, quietly, as designed.
5. Otherwise: Workspace, with SES as the exception fallback (`:285-298`, unchanged).

Step 4 is the reversal lever. Rolling one identity class back is a `wrangler pages secret put` and no deploy.

### 4.3 Observability

New `email_log` column, following the `lane` precedent (`scripts/migrations/2026-08-03-email-log-lane.sql:15`):

```sql
-- scripts/migrations/2026-08-25-email-log-from-identity.sql
ALTER TABLE email_log ADD COLUMN from_identity TEXT;
```

Both lanes write it. Workspace writes the resolved registry value it actually emitted at `_mail-lanes.js:198`. SES writes the caller's `from` verbatim. `insertEmailLog` (`_ses.js:9-27`) gains the field. `schema.sql:290-300`, `scripts/gates/sql-columns-live-tables.sql` and `scripts/gates/validate-schema-drift.mjs` are updated in the same commit, and `test/schema-migration-replay.test.mjs` must replay green.

New `event` values: `lane_identity_unmapped`, `lane_identity_legacy`. Both are alertable.

Alert channel: Telegram, via the Pages secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` already present on the project. Rationale is the standing rule in memory `mail-components-logging-observation`: a mail component's failure alert must not travel over the rail that is failing. This is the deliberate exception to the general preference for email alerts (section 8, Q7).

### 4.4 What does not change

- `sendViaWorkspace` emits no `Precedence: bulk`, no configuration set, no tracking pixel and no link rewriting (`_mail-lanes.js:197-215`). That is a placement asset and stays.
- `replyTo` continues to pass through unchanged (`_mail-lanes.js:203`), so `administrator@rrmacademy.org` remains the reply target where set (`community/_email.js:264`, `:398`, `events/_email.js:28`).
- Trickle pacing for broadcasts stays enforced by `scripts/gates/validate-email-trickle.mjs` against `community/_email.js:24-38` (`BROADCAST_BATCH_SIZE` 5, `BROADCAST_BATCH_DELAY_MS` 1800).

---

## 5. Staged plan, with rollback and proof gate per stage

Ordering law for this component: **identities are registered and the registry is populated and proven before any default moves.** Stages 0 through 3 change no routing at all.

### Stage 0: Observability first (no routing change)

**Do:** add the `from_identity` column and write it on both lanes. Add the `lane_identity_unmapped` and `lane_identity_legacy` events and the Telegram alert path. Deploy. Let it run at least 72 hours on the current routing.

**Proof gate:**
- Migration applied remote, and `test/schema-migration-replay.test.mjs` plus `scripts/gates/validate-schema-drift.mjs` both green.
- `SELECT lane, from_identity, COUNT(*) FROM email_log WHERE created_at > <deploy> GROUP BY 1,2` returns a non-empty result whose `from_identity` values match the section 3 inventory for the sources observed. A NULL `from_identity` on any row written after the deploy is a failure.
- **Falsifiability check** (per the `falsifiable-check` doctrine): run a staging send with a deliberately bogus identity key and confirm `lane_identity_unmapped` is written and the Telegram alert fires. A gate that has never been seen to fail is not a gate.

**Rollback:** revert the code commit. The column is additive and stays; nothing reads it if the code is gone.

### Stage 1: Register the missing send-as identities (Workspace only, zero code)

**Do:** for each of `accounts@`, `contact@`, `info@` on the apex: Brian adds the directory alias in Admin console (Users, the VA user, Add alternate emails, Save), then the SA path creates the send-as, per `skills/gmail/SKILL.md:40-52`:

```
TOK=$(DWD_SUBJECT=virtualassistant@rrmacademy.org \
      DWD_SCOPES=https://www.googleapis.com/auth/gmail.settings.sharing \
      python3 ~/iCode/scripts/google-auth/impersonate-token.py)
curl --noproxy '*' -sS -X POST \
  "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"sendAsEmail":"accounts@rrmacademy.org","displayName":"RRM Academy","treatAsAlias":true}'
```

This is exactly how `surveys@` and `receipts@` were created on 2026-08-03 with zero browser steps. `gmail.settings.sharing` covers alias CRUD only; a write to the primary send-as would need `gmail.settings.basic` (`skills/gmail/SKILL.md:54`), which this stage never does.

**Proof gate:**
- `gog -a virtualassistant@rrmacademy.org --gmail-no-send -j gmail sendas list` shows every registry address with `verificationStatus` of `accepted` and `treatAsAlias: true`.
- A conformance script asserts set equality between the live sendAs list and `WORKSPACE_IDENTITIES` values. Set inequality in either direction fails.

**Rollback:** `DELETE /gmail/v1/users/me/settings/sendAs/<addr>`, then Brian removes the directory alias. No code, no deploy, no user-visible effect.

### Stage 2: Identity keys at every call site (no routing change)

**Do:** create `functions/api/_mail-identities.js`. Stamp `identity:` on all 20 `sendTransactionalEmail` call sites. `billing/_webhook-shared.js:30-43` gains an `identity` parameter so its fifteen callers can declare `receipts` versus internal ops rather than inheriting one hardcoded `from` (`:34`). `community/_email.js` declares `community` for `STUC_BROADCAST_SENDER` (`:90`) and `community_author` for the `authorFrom` path (`:92-98`). Routing still gated by `WORKSPACE_LANE_IDENTITIES`, which is unset, so behavior is byte-identical.

**Proof gate:**
- New CI gate `scripts/gates/validate-mail-identities.mjs`: every `sendTransactionalEmail(` call in `functions/` carries an `identity:` key; every key used exists in the registry; every registry value is a live accepted send-as (fed from the Stage 1 conformance output, pinned as a checked-in fixture so CI does not require a live Google call).
- Behavior-asserting unit tests in `test/mail-lanes.test.js`: one per registry key asserting the emitted `From` header, plus a test asserting an unknown key routes to SES and writes `lane_identity_unmapped`, plus a test asserting a missing key does the same. The existing pin at `test/mail-lanes.test.js:208` is rewritten: `survey/request.js` is now an explicit `surveys` key, not an accidental fallback.
- `SELECT COUNT(*) FROM email_log WHERE event='lane_identity_legacy' AND created_at > <deploy>` returns 0 after 72 hours.
- Mutation proof: delete one `identity:` key in a scratch branch and confirm the CI gate fails.

**Rollback:** revert the commit. Routing was never touched.

### Stage 3: Seed test each identity for Primary placement (no production routing change)

**Do:** with `WORKSPACE_LANE_IDENTITIES` still unset in production, drive one seed send per registry key over the Workspace lane, either through a temporary admin-gated `POST /api/admin/mail-seed` or by replaying the same body through the proven CLI lane (`gog gmail drafts create --from <identity>` then `bash ~/.claude/skills/gmail/scripts/va-send.sh <draftId>`). Seed recipients: at minimum a `gmail.com` personal account, a Workspace account, and an `outlook.com` account. Use the real production body of each identity's most representative message, not lorem copy, because copy affects nothing but a reviewer's confidence.

**Proof gate (this is the hard one):**
- For every registry identity, a screenshot of the received message in a `gmail.com` inbox showing the **Primary** tab. Promotions on any identity blocks that identity's flip. This is the whole point of the component and it is not inferable from a 200 response.
- For every identity, the received message shows `signed-by: rrmacademy.org` and the intended display name. Display name preservation on the Workspace lane must be proven per identity, not assumed, especially for row 13 where the display name is per-send and the send-as registration carries its own.
- Delivery claims follow the `mail-delivery-proof` ladder: name the rung. Admin console Reporting, Email Log Search is the authoritative per-recipient trace; its ingestion lags a fresh send by minutes and results paginate ten rows ascending, so a just-sent message is on the last page. Status `2/2 Delivered` is the strongest claim available from our side. Inbox versus spam on a system we do not control is not provable, and the report says so.
- No tracking pixel is used for proof, ever.

**Rollback:** nothing to roll back. Delete or gate the seed endpoint.

### Stage 4: Flip the default, one identity class at a time

Flip by editing the `WORKSPACE_LANE_IDENTITIES` Pages secret. No deploy per flip. Minimum 72 hours of clean telemetry between sub-stages.

- **4a. Low blast radius first:** `surveys`, `guides`, `contact`, `welcome`. Rows 5, 6, 8, 9. These are one-way informational sends whose misdelivery costs a resend.
- **4b. Auth:** `auth`. Row 1, nine call sites. Highest placement value (a password reset in Promotions is a support ticket) and highest identity risk. Requires 4a clean.
- **4c. Billing receipts:** `receipts`. Row 2, seven user-facing callers. Money-adjacent, so it flips alone and is watched against Stripe's own receipt trail.
- **4d. STUC and events:** `community`, `community_author`. Rows 10 and 13. Last because these carry the free-event Google Meet joining credential (`events/register.js:226`, `events/remind.js:126`) and because this identity is the one the whole playbook is built around. It is also the identity with the least to gain, since the app already declares `community@` as its `From`; the gain here is that the declared identity finally becomes the emitted one over a lane that reaches Primary.

**Proof gate per sub-stage:**
- `SELECT source, lane, from_identity, COUNT(*) FROM email_log WHERE created_at > <flip> GROUP BY 1,2,3` shows the flipped sources on `lane='workspace'` with the intended `from_identity`, and no other source moved.
- `SELECT COUNT(*) FROM email_log WHERE event IN ('lane_identity_unmapped','lane_identity_legacy') AND created_at > <flip>` returns **0**.
- `SELECT COUNT(*) FROM email_log WHERE event='lane_fallback' AND created_at > <flip>` is 0, or every row is individually explained. A nonzero rate here means the Workspace lane is throwing and SES is silently absorbing it, which is the failure mode this whole design must not hide.
- For 4b and 4c specifically: one live end-to-end run per class performed by a human against a real account (request a password reset, complete a test purchase) with the received message screenshotted in Primary.
- Daily Workspace send count from `email_log` stays under 600, which is half the self-imposed 1200 cap.

**Rollback per sub-stage:** remove the identity key from `WORKSPACE_LANE_IDENTITIES` and confirm within one send that the source returns to `lane='ses'`. Roughly 60 seconds, no deploy, no code. This is why the flip control is a secret and not a constant.

### Stage 5: Demote SES, decide the internal lane, remove the legacy path

**Do:** remove `workspaceFromFor`'s fallback behavior and the `lane_identity_legacy` path entirely. `WORKSPACE_FROM_DEFAULT` ceases to exist as a fallback and survives only as the `surveys` registry value. Resolve rows 3, 4, 7, 14, 15, 16 per Brian's answers to Q3 and Q5. Wire `_google-ads.js:236` and `:274` to pass a `log` object so those two alert sends stop being invisible to every audit.

**Proof gate:**
- Static assertion in CI: the string `WORKSPACE_FROM_DEFAULT` appears in exactly one place, as a registry value, and no code path returns it on a lookup miss. Mutation proof: reintroduce a fallback in a scratch branch and confirm the gate fails.
- 30 day comparison: SES `category='transactional'` send count down from 488 to the fallback-only floor. Target is under 20, and every remaining SES transactional row is explainable by its `source` (internal ops, or a fallback with a matching `lane_fallback` row).
- Every `sendEmail` and `sendTransactionalEmail` call site in `functions/` writes an `email_log` row. Zero un-logged senders.

**Rollback:** revert the commit. Stage 4's secret control is untouched and still reverses routing independently.

### Stage 6: Standing guards

**Do:** add to the weekly observatory digest a lane-conformance section: sends by lane and `from_identity`, any `lane_identity_unmapped` or `lane_fallback` rows, the rolling 24 hour Workspace count against the 1200 cap, and a live `sendas list` versus registry diff. Add a `drift-monitor` check that fails when a registry identity loses `accepted` status.

**Proof gate:** the digest section renders with real numbers for a full week, and a deliberately removed send-as (immediately restored) produces the drift alert.

**Rollback:** disable the digest section. Monitoring only.

---

## 6. Proof gates, consolidated

Two gates are mandatory at every stage that changes anything.

**G1. Primary placement, per identity, evidenced.** Not a 200 response, not an absent bounce. A screenshot of the message in a `gmail.com` Primary tab, plus an Admin console Email Log Search trace at `2/2 Delivered`. One per registry identity, refreshed whenever an identity's address or display name changes. Placement on a system we do not control is stated at the rung we can actually prove and no higher.

**G2. No unintentional fallback, made loud.** Three layers, each independently falsifiable:

1. **Compile time:** CI gate asserts every `sendTransactionalEmail` call carries an `identity` key, every key is in the registry, and no code path returns `WORKSPACE_FROM_DEFAULT` on a lookup miss. Proven by mutation.
2. **Run time:** an unresolvable identity never sends on the Workspace lane. It writes `lane_identity_unmapped` to `email_log`, pushes a Telegram alert, and routes to SES with the caller's original `from` intact. Proven by a staging send with a bogus key.
3. **After the fact:** `email_log.from_identity` records what was actually emitted, so a wrong identity is queryable rather than invisible. Proven by querying a known send and matching the header we sent.

The success condition for the component as a whole is a seven day window with `lane='workspace'` on 100 percent of flipped sources, zero `lane_identity_unmapped`, zero unexplained `lane_fallback`, and a per-identity Primary screenshot set. The falsifiable e2e artifact is that query output plus the screenshot set plus the mutation-proof transcripts.

---

## 7. Risks

### 7.1 Workspace daily cap versus a bulk burst

The newsletter list is roughly 6,217 active subscribers (`docs/superpowers/specs/2026-06-27-email-observability-system-design.md`, section 0). The Workspace ceiling is roughly 2,000 per rolling 24 hours (`tools/fall-cohort-send/lib/config.py:231`) and the house operating cap is 1,200 (`config.py:235`). A 6,217 recipient send does not fit, cannot be made to fit by pacing inside a day, and attempting it does not merely delay mail: past the cap Google starts bouncing, which burns deliverability for the entire mailbox including every transactional identity this design just moved onto it.

**Therefore the newsletter stays on SES permanently.** Row 17 of section 3. This is not a deferral, it is the design. Lane B in `docs/email-sending-playbook.md:17` is unchanged: cold, large, marketing goes SES from `newsletter@mail.rrmacademy.org`, Promotions expected and acceptable, one-click `List-Unsubscribe` retained.

The residual risk is a future bulk send that is neither newsletter nor transactional, for example a 5,000 row STUC broadcast. `community/_email.js:261` already fans out over a roster capped at 5,000 (`:115`) while labelling itself `category='transactional'`. At the current roster it is fine. At 1,200 it is a cap breach that no code currently prevents. **Mitigation, and it is a required part of Stage 4d:** a hard pre-send guard in `sendBroadcastTrickle` that refuses when the roster size plus the rolling 24 hour Workspace count exceeds the cap, modelled on `config.py:235` and its refusal semantics (refuse, name the numbers, never truncate). A truncating guard would silently drop members.

### 7.2 Single-account dependency

One mailbox sends everything: `virtualassistant@rrmacademy.org`, hardcoded at `skills/gmail/scripts/va-send.sh:21` and implied by the single `VA_GMAIL_REFRESH_TOKEN` in the Worker lane. After the inversion, that one mailbox carries password resets, purchase receipts, and event joining credentials. Its suspension, a Workspace-wide session-control policy change, an admin password reset, or a per-mailbox sending restriction takes down 99 percent of RRM Academy mail.

Partial mitigations, and their honest limits:

- The SES fallback at `_mail-lanes.js:285-298` catches a *throw*. It catches Gmail returning 401 or 429. It does not catch Gmail accepting the message and then not delivering it, and it does not catch a cap-induced bounce.
- The fallback preserves availability but not placement. Every fallback send lands in Promotions. A sustained Workspace outage silently reverts placement to the status quo while the mail keeps flowing, which is the correct priority order and is also easy not to notice. Hence the `lane_fallback` alert in Stage 0 and the digest section in Stage 6.
- A second sending mailbox is explicitly out of scope for this component and is a candidate follow-up (section 8, Q8).

### 7.3 OAuth refresh token expiry and revocation

`VA_GMAIL_REFRESH_TOKEN` is replayed as a refresh-token grant on every cold isolate (`_mail-lanes.js:138-175`, 5 second timeout at `:154`, single-slot in-isolate cache at `:136` and `:170-174` with a 60 second safety margin at `:91`). There is no rotation script, no scheduled rotation, no expiry monitor, and no runbook anywhere in the estate. Rotation is manual by policy (memory `feedback-credential-rotation-manual-only`).

A Workspace internal-app refresh token does not expire on a fixed clock, but it is revoked by: changing the OAuth client, the user's password change, an admin revoking third-party access, a scope change, or seven days of inactivity if the app is ever moved to testing status. Today a revocation degrades to SES silently, because `_mail-lanes.js:255-258` only checks that the secrets are *present*, not that they *work*. After the inversion, a revoked token silently returns 99 percent of mail to Promotions.

**Required mitigations, both in Stage 0:**
- Alert on `lane_fallback` rate, not just on individual failures. A sudden 100 percent fallback rate is the revocation signature.
- A daily observatory probe that mints an access token from the stored refresh token and asserts success. This is the only check that distinguishes "present" from "valid."

Rotation traps to carry into any runbook: `op read "op://..."` fails on item titles containing parentheses, and this item's title has them, so use `op item get "RRM Academy - VA Gmail Refresh Token (workspace mail lane)" --vault Automation --fields credential --reveal` (item id `gfnamyyuloztln4clj7idbvoua`). `wrangler pages secret put` has reported success against the wrong account id, so always re-run `pages secret list` after a put. `gog auth tokens export` emits a cached and usually expired access token alongside the refresh token, so force a real API call first and budget expiry for the whole run rather than the first call (`tools/fall-cohort-send/lib/mailer.py:94`).

### 7.4 Bulk sends that legitimately exceed Workspace limits

Covered in 7.1 for the newsletter. The general rule this component establishes: **a send whose recipient count plus the rolling 24 hour Workspace count exceeds 1,200 does not go over the Workspace lane, period.** It goes SES from `newsletter@mail.rrmacademy.org` and accepts Promotions, or it is split across days by an operator decision, or it does not go. It never silently half-sends. The guard refuses and names sends-in-last-24h, remaining, needed, and the UTC resume time, following `tools/fall-cohort-send/README.md`.

### 7.5 Apex reputation contamination

`CLAUDE.md:400` states the design intent that all transactional mail sends from `@mail.rrmacademy.org` to isolate transactional reputation from the root domain. This component moves the majority of transactional volume onto the apex, where `community@` STUC relationship mail also lives. If a transactional identity ever accumulates complaints, it now shares a reputation surface with the relationship lane.

Assessment: acceptable, because the volume is 10 to 27 per day, transactional complaint rates on requested mail are near zero, and Workspace reputation is dominated by per-recipient engagement (`docs/email-sending-playbook.md:30-35`) rather than domain-level history. But it should be stated rather than discovered. It is also a reason to keep internal ops alerts and any future high-volume automated mail off the apex identities.

### 7.6 DMARC is `p=none`

`docs/plans/backlog.md:138`. A `From` identity that does not align with the signing domain is delivered rather than rejected. If a registration lapses or a send-as is removed, Gmail rewrites the address to the mailbox owner (`virtualassistant@`) and the mail is delivered looking legitimate rather than failing loudly. This is precisely why G2 layer 3 (`from_identity` recorded) exists: DMARC will not catch it for us.

Moving to `p=quarantine` is a non-goal here, and would be a poor idea mid-flip. Revisit after Stage 6 has a clean month.

### 7.7 Fleet split across two From conventions

`partners/_emails.js` (four sites) and `admin/wix-migration-email.js` (one site) are documented at `CLAUDE.md:402` as not wired to the router. A flip does not reach them. Between Stage 4 and Stage 5 the fleet is deliberately split: most mail on apex Workspace identities, partner mail and the migration mail still on `@mail.rrmacademy.org` over SES. That is an accepted temporary state, ledgered as stub debt, not an oversight.

### 7.8 Category labels already lie

`admin/wix-migration-email.js:157` logs `category='transactional'` while riding the `sendRawEmail` path, which hardcodes `Precedence: bulk` (`_ses.js:132`). `community/_email.js:261` logs `category='transactional'` for a fan-out over a roster capped at 5,000. Any cap accounting or reputation analysis keyed on `category` understates bulk. **The Stage 4d cap guard must count rows, not trust `category`.**

### 7.9 The Message-ID domain stays on the subdomain

`_ses.js:124` hardcodes `@mail.rrmacademy.org` in the raw-send Message-ID. The Workspace lane does not set a Message-ID at all, so Gmail generates one under `rrmacademy.org`. Threading between a Workspace-sent message and an SES-sent fallback of the same conversation is therefore not guaranteed. Low impact for one-shot transactional mail, worth knowing before someone debugs a broken thread.

### 7.10 Two copies of the send wrapper

`~/.claude/skills/gmail/scripts/va-send.sh` and `~/iCode/skills/gmail/scripts/va-send.sh` are byte-identical today and callers disagree on which they invoke (`scripts/workspace-drip-send.sh:97` uses the first, `tools/fall-cohort-send/lib/config.py:50` the second). Unrelated to the Worker lane, but this component increases the consequence of them drifting. Ledgered as stub debt.

---

## 8. held_for_brian

**Q1. Auth identity name.** Is `accounts@rrmacademy.org` the right apex identity for security notices (password reset, sign-in alert, password changed), or do you prefer `security@`, `no-reply@`, or folding auth into `hello@`? This is the single highest-visibility rename in the plan and it is not reversible in members' memories the way a secret flip is.

**Q2. Guides identity.** Row 8 currently sends guide and quiz delivery from `info@mail`. Register `info@` on the apex, or fold guide delivery into `hello@rrmacademy.org` and register one fewer identity?

**Q3. Internal ops alerts (rows 3, 4, 7, 14).** Eight billing ops alerts, the courses admin notify, the contact admin notify, and four `alerts@` senders all go to `administrator@rrmacademy.org`, which is Google-to-Google. Promotions placement is irrelevant for our own inbox. Three options: (a) leave them on SES permanently, which keeps a real SES dependency alive and keeps the fleet split; (b) move them to a new `alerts@rrmacademy.org` Workspace identity for uniformity, at the cost of adding several hundred low-value sends per month to the VA mailbox's cap budget; (c) move them off email entirely to Telegram. Recommendation: (a) for now, (c) as the eventual answer for the pure alerts. Your call.

**Q4. Author-attributed community mail (rows 11, 12).** `brian@rrmacademy.org` and `naomi@rrmacademy.org` are used as senders at `community/_email.js:80` and `:82`. If either is a real Workspace user rather than an alias, the VA mailbox cannot own it as a send-as without SMTP verification. Options: (a) collapse both to `"Brian Whittaker" <community@rrmacademy.org>` and `"Dr. Naomi Whittaker" <community@rrmacademy.org>`, preserving the display name and losing the address; (b) leave author-attributed replies on SES; (c) you resolve the ownership so the send-as can be registered. Recommendation: (a), because the display name is what members read and `community@` is the identity the playbook is built on.

**Q5. Partner mail (row 15).** `partners/_emails.js` sends from `administrator@mail.rrmacademy.org` to external partners, which is relationship mail that would benefit most from Primary placement. `administrator@rrmacademy.org` is a real mailbox and cannot be a VA send-as. Register a new `partners@rrmacademy.org` and wire those four sites into the router, or leave them on SES?

**Q6. Seed endpoint.** Stage 3 needs a way to drive one Workspace send per identity. Add a temporary admin-gated `POST /api/admin/mail-seed` and delete it afterwards, or drive the seed sends entirely from the CLI lane (`gog drafts create` plus `va-send.sh`) and add no endpoint at all? Recommendation: CLI, no new endpoint, because it adds no authed surface and it exercises the same identities.

**Q7. Alert channel for this component.** Memory `feedback-alert-channel-email-not-telegram` sets your general preference for email alerts. Memory `mail-components-logging-observation` requires a mail component's failure alert to travel over a channel independent of email. Confirm Telegram is the exception for mail-lane failures specifically.

**Q8. Second sending mailbox.** Should a follow-up component add a standby sending mailbox and a second refresh token, so a VA mailbox problem degrades to a second Workspace identity rather than to Promotions? It roughly doubles the cap headroom as a side effect. Out of scope for this component either way.

**Q9. Live DNS verification before Stage 4.** No DNS is committed anywhere in this repo. Every SPF, DKIM, DMARC and custom MAIL FROM claim rests on prose at `CLAUDE.md:400` and `docs/email-sending-playbook.md:22`. Nothing in the repo documents DKIM for the apex Workspace senders, which authenticate under a separate Google Workspace DKIM key. Do you want a live `dig` verification of apex SPF, the Workspace DKIM selector, and the DMARC record captured as a Stage 1 artifact before any identity flips? Recommendation: yes, it is ten minutes and it is the only thing standing between us and an authentication assumption.

**Q10. Stale skill.** `~/.claude/skills/stuc-comms/SKILL.md:36-46` still says to send via Apps Script mail-merge because "my send tooling is send-blocked." That predates the `va-send` capability and contradicts both the playbook and the 94 send headless run of 2026-08-24. It will send a future session to build an Apps Script instead of using the proven lane. Fix in this component's Stage 6, or separately?

---

## 9. components.ledger.json entry proposal

To be written at Phase 8, with `done_at_head` stamped at the merge commit. `terminal_state` is `HELD-INCOMPLETE` and not `HELD-READY`, because this repo has no coverage tool and `converge.profile.json` records `coverage_gate: null`, which is a structurally unsatisfiable leg per the converge gates. Promotion to `HELD-READY` requires a coverage mechanism, not more work on this component.

```json
{
  "component": "mail-lane-inversion",
  "done_at_head": "<merge commit>",
  "terminal_state": "HELD-INCOMPLETE",
  "held_legs": [
    "null-coverage-gate (repo has no coverage tool; behavior-asserting tests in test/mail-lanes.test.js substitute)",
    "stage-4-flip-awaits-human-go (each identity class flips by Pages secret edit, never by deploy)",
    "stage-5-demotion-awaits-Q3-and-Q5"
  ],
  "held_reason": "Stages 0-3 are review-clean and deploy-safe (no routing change). Stage 4 flips are Pages-secret edits held for Brian's per-class go. Stage 5 is blocked on held_for_brian Q3 and Q5.",
  "read_contracts": [
    "functions/api/_mail-lanes.js: sendTransactionalEmail(env, opts) signature",
    "functions/api/_ses.js: sendEmail / insertEmailLog / sanitizeHeader",
    "env.GOG_CLIENT_ID, env.GOG_CLIENT_SECRET, env.VA_GMAIL_REFRESH_TOKEN (Pages secrets)",
    "env.WORKSPACE_LANE_IDENTITIES (new Pages secret, comma-separated identity keys)",
    "env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID (Pages secrets)",
    "Gmail send-as list on virtualassistant@rrmacademy.org (live, conformance-pinned fixture in CI)",
    "email_log (D1 rrm-auth)"
  ],
  "write_contracts": [
    "functions/api/_mail-identities.js: WORKSPACE_IDENTITIES registry (new, SSOT for sender identity)",
    "functions/api/_mail-lanes.js: identity-key resolution replaces workspaceFromFor local-part guessing",
    "functions/api/billing/_webhook-shared.js: sendEmailSafe gains an identity parameter",
    "email_log.from_identity (new column, scripts/migrations/2026-08-25-email-log-from-identity.sql)",
    "email_log events: lane_identity_unmapped, lane_identity_legacy",
    "Telegram egress on identity-resolution failure and on lane_fallback rate",
    "Gmail send-as identities created on virtualassistant@: accounts@, contact@, info@ (apex)",
    "scripts/gates/validate-mail-identities.mjs (new CI gate)"
  ],
  "stub_debt": [
    "Rows 3, 4, 7, 14: internal ops alerts to administrator@ remain on SES pending Q3. Fleet is deliberately split across two From conventions until then.",
    "Row 15: partners/_emails.js (4 sites) not wired to the router; administrator@rrmacademy.org cannot be a VA send-as. Pending Q5.",
    "Rows 11, 12: brian@ and naomi@ author senders unresolved; ownership blocks send-as registration. Pending Q4.",
    "_google-ads.js:236 and :274 pass no log object and write no email_log row; wired in Stage 5, invisible to lane audits until then.",
    "admin/wix-migration-email.js:157 logs category='transactional' while riding the Precedence: bulk raw path (_ses.js:132). Log category and wire reality disagree; not corrected here.",
    "community/_email.js:261 logs category='transactional' for a fan-out over a roster capped at 5000 (:115). Cap accounting must count rows, not trust category.",
    "No refresh-token rotation runbook, no expiry monitor beyond the Stage 0 daily mint probe. Rotation stays manual per policy.",
    "Two byte-identical copies of va-send.sh (~/.claude/skills/gmail/scripts/ and ~/iCode/skills/gmail/scripts/) with callers split between them; drift risk increases with this component's dependence on the lane.",
    "~/.claude/skills/stuc-comms/SKILL.md:36-46 is stale and routes future sessions to Apps Script. Pending Q10.",
    "isM365Recipient (_mail-lanes.js:264-267) retained as dead diagnostic code after the flip; removal deferred to avoid enlarging the Stage 4 diff.",
    "DMARC remains p=none (docs/plans/backlog.md:138); legacy Wix SPF include and DKIM CNAMEs remain in DNS (docs/plans/backlog.md:297)."
  ],
  "ci_mechanism": "github-actions",
  "ci_binding": ".github/workflows/deploy.yml:Build & Deploy (post-merge)",
  "peer_sync_mechanism": "gh-pr-merge",
  "peer_sync_binding": null,
  "durable_followup": "Second sending mailbox plus a second refresh token, so a VA mailbox failure degrades to another Workspace identity rather than to SES Promotions, and the rolling cap headroom doubles. Pending Q8.",
  "notes": "Inverts the 2026-08-03 dual-lane router default: Workspace-first for single-recipient transactional mail, SES demoted to error-fallback. SES and mail.rrmacademy.org are explicitly retained; the bulk newsletter (roughly 6,217 subscribers) stays on SES permanently because it does not fit the roughly 2,000/day Workspace ceiling. The flip control is a Pages secret (WORKSPACE_LANE_IDENTITIES), so any identity class reverses in about 60 seconds without a deploy. Driven by memory feedback-no-ses-for-rrmacademy-sends (Brian, 2026-08-24) and the 2026-07-11 placement experiment at docs/email-sending-playbook.md:22."
}
```

---

## 10. Suggested location

`/Users/brian/iCode/projects/rrm-academy-cf/docs/superpowers/specs/2026-08-24-mail-lane-inversion-design.md`

## 11. Recommended next action

Answer Q1 and Q9, then authorize Stage 0 only. Stage 0 changes no routing, is fully reversible by a revert, and is the prerequisite that makes every later stage auditable rather than hopeful.