# Bulk Mail Rail Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a hardened, capped, warm-up-gated bulk mail rail on `rrmacademy.com` so multi-thousand sends never again touch rrmacademy.org's sender standing.

**Architecture:** The existing `POST /api/newsletter/send` endpoint gains a bulk path selected by `lane: 'bulk'` in the request body. That path resolves its lane through the vendored console-kit mail package before touching a single recipient row, sends from `newsletter@rrmacademy.com` through SES configuration set `rrm-bulk`, and is governed by a new pure policy module that reads a ramp table, a per-UTC-day counter and a 24-hour complaint/bounce circuit breaker out of D1. Two new D1 tables (`mail_domain_state`, `send_paused`) hold the warm-up state. A dry-run-by-default CLI drives it, a shared shell wrapper caps the Workspace lane on both Macs at 300, and an observatory daemon reads the result daily.

**Tech Stack:** Cloudflare Pages Functions (JavaScript, ES modules), D1 (SQLite), Amazon SES v2 via `vendor/mail` (aws4fetch), Amazon SNS, node:test with the repo's `test/_d1-sqlite.mjs` real-SQLite harness, Node 22+ ESM CLI scripts, bash, Cloudflare Workers (rrm-observatory daemon fleet), console-kit package vendoring.

**Spec:** `docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md`

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- "Multi-thousand sends never touch rrmacademy.org's sender standing again."
- "Non-goals: choosing audiences (policy stays with Brian and Naomi), a marketing GUI, open or click tracking pixels, moving transactional mail (that is phase 4, its own spec)."
- Identity: "`rrmacademy.com` (owned, zone on the RRM Cloudflare account `ecf2c5bc`, keeps its 301 to rrmacademy.org)".
- Rail: "Amazon SES, hardened, reusing the existing newsletter send path, subscriber table and bounce webhook".
- Unsubscribe on the bulk lane: "RFC 8058 one-click headers plus a visible link and the postal address".
- Warm lane audience: "Paying STUC members only".
- Bulk lane From: `"Dr. Naomi Whittaker, RRM Academy" <newsletter@rrmacademy.com>`; configuration set `rrm-bulk`; cap "ramp table, max 1,500 a day".
- Warm lane cap: "300 recipients per run, hard, on every machine".
- Routing rule: "a recipient is Warm when `wix_subscription.status = 'active'` for that email (COLLATE NOCASE) OR `contact_tag.tag = 'stuc:member'`; everything else is Bulk. There is no per-send override."
- "The Warm lane's Reply-To is `administrator@rrmacademy.org`. The Bulk lane's Reply-To is also `administrator@rrmacademy.org`, a monitored inbox".
- "**Sender identities** on the domain: `newsletter@` only. No other mailbox exists on rrmacademy.com; it is a sending identity, not a Workspace domain."
- "The mail package changes ONLY in `console-kit/kit/packages/mail`, never in this repo's `vendor/mail/`".
- "This is phase 1 task zero (§9) -- nothing else in this build can go live before `resolveLane()` accepts the bulk From."
- Pre-mark hazard: "The bulk path runs a `resolveLane()` preflight on the From address before touching a single recipient row; a refusal aborts the run with no `newsletter_event` rows written and no D1 writes at all."
- Ramp table: "days 1 to 2 | 200; days 3 to 5 | 500; days 6 to 12 | 1,000; day 13 on | 1,500".
- "The daily cap is a ceiling, never a target. A send that would exceed the day's remaining allowance is truncated to it and the remainder is left for the next day, engaged recipients first."
- "Per-run cap equals the day's remaining allowance. Pacing is 1 to 2 s between SES calls."
- First-ever send: "A missing row means the domain has never sent, and the policy BLOCKS the run. The CLI flag `--first-send` creates the row with `first_send_at` set, in its own D1 write before any recipient is touched, and the same run then proceeds under the day 1 cap."
- Circuit breaker: "`complained / sent >= 0.2%` or `bounced / sent >= 2%` pauses the run, writes a `send_paused` row with the reason, and alerts. The ratios are evaluated only once `sent >= 50` in the trailing 24 h; below that the breaker does not trip." "A paused run resumes only by a human passing `--resume` after reading the reason."
- "hard bounce is `bounce_type = 'Permanent'`"; sends come from "`email_log` rows whose `source` starts with `newsletter/bulk/<campaign>`"; "the bulk path writes `source = 'newsletter/bulk/<campaign>'`, `category = 'newsletter'`".
- Log-write failure: "The bulk path increments a per-UTC-day counter (`mail_domain_state.sent_today`, keyed on `day`) in the same D1 batch as the `email_log` insert for each send." "If that D1 batch itself fails, the run PAUSES immediately with `send_paused` reason `log-write-failed`."
- Cohort ordering: "Recipients are ordered by engagement: `last_clicked_at`, then `last_opened_at`, then `last_sent_at`, then `subscribed_at` descending." "The effective order during warm-up is therefore `last_sent_at` then `subscribed_at` descending, and 'engaged' means recently-sent-to, with `source = 'website'` subscribers first. The two engagement columns stay in the ORDER BY for when tracking returns."
- "**Feedback-ID** header on every bulk message: `Feedback-ID: <campaign>:<segment>:rrma:rrmacademy.com`".
- Unsubscribe: "`newsletter/_tracking.js`'s `unsubscribeHeaders()` produces only the `https:` form today; appending the `mailto:` alternative to the same header is a phase 1 task (§9)."
- CLI: "dry-run by default; prints audience size after exclusions, today's remaining cap, the cohort head it would send to, and the campaign key; requires `--send` to go live; refuses if the checkout is behind `origin/main`. It calls the endpoint; it never holds SES credentials."
- Governance: "Only the Pages Function holds SES credentials. No script on any Mac gets an SES key." "one shared wrapper, `tools/mail-cap/send-cap.sh`, vendored to both Macs, that counts the recipient file and refuses any run over 300 with a message naming the bulk rail." "A run log per machine (`.run-log/mail-cap/`) records every refusal and every allowed run with its count."
- Monitoring: "Observatory daemon `bulk-mail-health`: daily reading of SES complaint rate, bounce rate and sent count for `rrm-bulk`, plus the two Postmaster domains' spam-rate rows via the Postmaster Tools API (`gmailpostmastertools.googleapis.com`, read scope, administrator@). Red at complaint 0.2% or spam-rate 0.3% on any day; the morning digest names the campaign."
- Exclusions unchanged: "`email_log` already-sent for this campaign key; `status IN ('unsubscribed','bounced','complained')`; STUC members (they get the Warm lane); hard-exclude list. Delivery outcome and logging outcome stay separate (a D1 flake never reclassifies a delivered message)."
- Estate rules that bind this repo: code under `functions/api/` is written by dispatching the `coder` agent (`subagent_type: "coder"`), never hand-written in the main thread. Commit messages are built in a FILE and committed with `git commit -F`, never a long `-m`. Never use em dashes in prose. `console-kit` packages change only in the kit; `vendor/mail/` in this repo is read-only and is overwritten by `console-kit sync`. After editing `functions/api/newsletter/send.js` or `functions/api/_ses.js` run `npm run guard:update` (both are in `guard-manifest.json`).
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**console-kit** (`~/iCode/projects/console-kit`)

| File | Responsibility |
|---|---|
| `kit/packages/mail/lanes.js` (modify) | Admit `newsletter@rrmacademy.com`: add it to `EXEMPTIONS['newsletter-blast'].from`, add `rrmacademy.com` to `SES_SENDER_DOMAINS.rrma`, and make the exempt-branch sender check read the domain tables instead of its hardcoded pair. |
| `kit/manifest.json` (modify) | Bump `packages[mail].version` 1.5.0 -> 1.6.0; `console-kit hash` regenerates the shas. |
| `test/mail-package.test.js` (modify) | The §10 lane-admission cases. |

**rrm-academy-cf** (`~/iCode/projects/rrm-academy-cf`)

| File | Responsibility |
|---|---|
| `vendor/mail/lanes.js`, `kit.lock.json` (written by sync, never hand-edited) | The synced copy of the kit change. |
| `migrations/041-bulk-mail-rail.sql` (create) | `mail_domain_state` + `send_paused` DDL. Root numbered convention, the one rrm-auth migration history. |
| `scripts/gates/validate-sql-columns.mjs` (modify) | Add the 041 `EXTRA_DDL` entry so the SQL and schema-drift gates compose the two new tables. |
| `test/_bulk-mail-sqlite.mjs` (create) | A D1-shaped rrm-auth harness that is `SCHEMA_SQL` plus migration 041, mirroring `test/_community-sqlite.mjs`. |
| `functions/api/newsletter/_policy.js` (create) | Pure, I/O-free warm-up policy: ramp table, allowance arithmetic, truncation, first-send gate, breaker, cohort comparator, Feedback-ID, campaign-key validation, pause reasons. |
| `test/newsletter-policy.test.js` (create) | Unit tests for every `_policy.js` export, plus the breaker and cap mutation proofs. |
| `functions/api/newsletter/_tracking.js` (modify) | `unsubscribeHeaders()` appends the `mailto:` alternative to the same `List-Unsubscribe` header. |
| `test/newsletter-unsubscribe-roundtrip.test.js` (create) | Header shape plus the one-click POST and link GET round trip against real SQLite. |
| `functions/api/_ses.js` (modify) | Export `preflightLane()` and `LaneRefused` so the one vendor/mail boundary stays in this file. |
| `functions/api/newsletter/send.js` (modify) | The bulk path: preflight, `BULK_FROM`, campaign key, membership exclusion, cohort order, allowance truncation, breaker, per-send `email_log` + `sent_today` batch, `send_paused` writes, Feedback-ID header, `rrm-bulk` configuration set. |
| `test/newsletter-bulk-send.test.js` (create) | The bulk path end to end against real SQLite: preflight refusal writes nothing, membership routing, ordering, truncation, breaker pause, log-write-failed pause. |
| `test/email-events-sns.test.js` (create) | Signed SNS Complaint and Bounce fixtures through `functions/api/email/events.js`. |
| `scripts/bulk-send.mjs` (create) | Dry-run-by-default CLI driver. |
| `test/bulk-send-cli.test.js` (create) | CLI argument parsing, dry-run default, freshness refusal. |

**Shared tooling** (`~/iCode/tools/mail-cap`)

| File | Responsibility |
|---|---|
| `tools/mail-cap/send-cap.sh` (create) | Count a recipient file, refuse over 300 naming the bulk rail, run-log every outcome, otherwise exec the wrapped command. |
| `tools/mail-cap/test/send-cap.test.mjs` (create) | 300 passes, 301 refused, CRLF and blank lines, plus the cap mutation proof. |
| `tools/mail-cap/README.md` (create) | Install on both Macs, env overrides, run-log location. |

**rrm-observatory** (`~/iCode/projects/rrm-observatory`)

| File | Responsibility |
|---|---|
| `src/daemons/bulk-mail-health.js` (create) | Daily bulk-rail reading: 24 h sent/complaint/bounce for `rrm-bulk` out of `email_event` joined to `email_log`, open `send_paused` rows, SES enforcement status, and the two Postmaster domains' spam rates. |
| `src/daemons/_manifest.js` (modify) | Import and register the daemon. |
| `docs/superpowers/specs/2026-05-20-daemon-fleet-spec.md` (modify) | The registry row the parity gate requires. |
| `tests/bulk-mail-health.test.mjs` (create) | Daemon verdict tests. |

---

## Task 0: Lane admission in console-kit, and sync (TASK ZERO)

Nothing else in this phase may start until this task is green in both repos. `resolveLane()` refuses `newsletter@rrmacademy.com` three ways today, not two: the `newsletter-blast` exemption's closed `from` list, `SES_SENDER_DOMAINS.rrma`, and a third the spec does not name, a hardcoded `onDomain(address, 'mail.rrmacademy.org', 'rrmacademy.org')` inside the granted-exemption branch that never consults the domain tables. All three are fixed here.

**Files:**
- Modify: `~/iCode/projects/console-kit/kit/packages/mail/lanes.js:126-131` (`SES_SENDER_DOMAINS`), `:163-169` (`EXEMPTIONS['newsletter-blast']`), and the granted-exemption sender check inside `resolveLane` (the `if (!onDomain(address, 'mail.rrmacademy.org', 'rrmacademy.org')) throw refuseSender('ses_rrm', address);` line)
- Modify: `~/iCode/projects/console-kit/kit/manifest.json` (`packages` -> `mail` -> `version`)
- Test: `~/iCode/projects/console-kit/test/mail-package.test.js`
- Modify (by tool, never by hand): `~/iCode/projects/rrm-academy-cf/vendor/mail/lanes.js`, `~/iCode/projects/rrm-academy-cf/kit.lock.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `resolveLane({ entity: 'rrma', purpose: 'newsletter', from: 'newsletter@rrmacademy.com', exemption: 'newsletter-blast' })` returns the string `'ses_rrm'`.
  - `resolveLane({ entity: 'rrma', purpose: 'newsletter', from: '<any other local part>@rrmacademy.com', exemption: 'newsletter-blast' })` throws `LaneRefused` with `reason === 'exemption-sender-not-allowed'`.
  - `SES_SENDER_DOMAINS.rrma` is `['rrmacademy.org', 'rrmacademy.com']`.
  - `EXEMPTIONS['newsletter-blast'].from` is `['hello@rrmacademy.org', 'newsletter@mail.rrmacademy.org', 'newsletter@rrmacademy.com']`.
  - Vendored at `rrm-academy-cf/vendor/mail/lanes.js`, sha-locked in `kit.lock.json` under `packages.mail` at version `1.6.0`.

- [ ] **Step 1: Write the failing tests in the kit**

Append to `~/iCode/projects/console-kit/test/mail-package.test.js`:

```js
// ---------------------------------------------------------------------------
// The bulk mail rail on rrmacademy.com (spec 2026-09-10-bulk-mail-rail-design,
// section 5.0 and section 10). The Bulk lane's From is a SECOND domain, owned
// by us and deliberately not the apex, so a multi-thousand send cannot put a
// spam-rate day on rrmacademy.org. Three separate rules in this file refused it
// before this change: the exemption's closed from list, SES_SENDER_DOMAINS, and
// the hardcoded domain pair in the granted-exemption branch.
// ---------------------------------------------------------------------------

test('the bulk From on rrmacademy.com is admitted under the newsletter-blast exemption', () => {
  assert.equal(
    resolveLane({
      entity: 'rrma',
      purpose: 'newsletter',
      from: '"Dr. Naomi Whittaker, RRM Academy" <newsletter@rrmacademy.com>',
      exemption: 'newsletter-blast',
    }),
    'ses_rrm',
  );
});

test('any other local part on rrmacademy.com is still refused by name', () => {
  for (const from of ['newsletters@rrmacademy.com', 'hello@rrmacademy.com', 'naomi@rrmacademy.com']) {
    assert.throws(
      () => resolveLane({ entity: 'rrma', purpose: 'newsletter', from, exemption: 'newsletter-blast' }),
      /exemption-sender-not-allowed/,
      `${from} must not reach SES`,
    );
  }
});

test('the bulk domain without a named exemption is still the Workspace refusal', () => {
  assert.throws(
    () => resolveLane({ entity: 'rrma', purpose: 'newsletter', from: 'newsletter@rrmacademy.com' }),
    /workspace-lane-only/,
  );
});

test('rrmacademy.com is an addressable SES domain for rrma, and only for rrma', () => {
  const { SES_SENDER_DOMAINS } = await import('../kit/packages/mail/lanes.js');
  assert.deepEqual(SES_SENDER_DOMAINS.rrma, ['rrmacademy.org', 'rrmacademy.com']);
  assert.ok(!SES_SENDER_DOMAINS.rrmf.includes('rrmacademy.com'));
  assert.throws(
    () => resolveLane({ entity: 'rrmf', purpose: 'transactional', from: 'x@rrmacademy.com' }),
    /sender-not-on-rail/,
  );
});
```

The fourth test uses a dynamic import inside a non-async callback; change its signature to `async () => {` when you paste it.

- [ ] **Step 2: Run the kit suite and watch it fail**

```bash
cd ~/iCode/projects/console-kit && node --test test/mail-package.test.js
```

Expected: FAIL. The first test fails with `LaneRefused: exemption-sender-not-allowed: exemption "newsletter-blast" covers hello@rrmacademy.org and newsletter@mail.rrmacademy.org, not newsletter@rrmacademy.com`; the fourth fails on the `deepEqual` of `SES_SENDER_DOMAINS.rrma`. The second and third pass already.

- [ ] **Step 3: Implement the three rule changes in `kit/packages/mail/lanes.js`**

Replace the `SES_SENDER_DOMAINS` block:

```js
/**
 * The SES sending domains that remain addressable per entity.
 *
 * `rrmacademy.com` joined the Academy's list on 2026-09-11 as the BULK SENDING
 * IDENTITY, and it is not a second apex: the zone keeps its 301 to
 * rrmacademy.org and holds exactly one mailbox-shaped identity, newsletter@.
 * It exists because Google folds a subdomain's reputation into the apex's
 * compliance verdict, so isolating multi-thousand sends needs a different
 * REGISTRABLE domain, not a subdomain. Spec: rrm-academy-cf
 * docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 4.
 */
export const SES_SENDER_DOMAINS = {
  rrma: ['rrmacademy.org', 'rrmacademy.com'],
  rrmf: ['rrm.foundation'],
};
```

Replace the `newsletter-blast` exemption entry:

```js
  'newsletter-blast': {
    entity: 'rrma',
    from: ['hello@rrmacademy.org', 'newsletter@mail.rrmacademy.org', 'newsletter@rrmacademy.com'],
    reason:
      'the newsletter product is a bulk send from hello@rrmacademy.org through SES with list-unsubscribe headers; '
      + 'the Workspace lane is one-at-a-time Gmail with a daily quota and refuses at volume; ruled by Brian 2026-09-09. '
      + 'newsletter@rrmacademy.com added 2026-09-11: the bulk rail sends as a separate registrable domain so a '
      + 'spam-rate day cannot reach rrmacademy.org, whose compliance verdict every transactional send shares',
  },
```

Replace the hardcoded sender check inside `resolveLane`'s granted-exemption branch:

```js
      // A granted exemption still sends from an address this entity is allowed
      // to send from: the exemption lifts the PURPOSE rule, never the rail's
      // sender rule. This reads the domain tables rather than a hardcoded pair,
      // which is what it always meant; the literal list silently outranked
      // SES_SENDER_DOMAINS and would have refused the bulk domain even after it
      // was admitted there (found 2026-09-11 building the bulk rail).
      if (!onDomain(address, ...CF_SENDER_DOMAINS[ent], ...SES_SENDER_DOMAINS[ent])) {
        throw refuseSender('ses_rrm', address);
      }
      return 'ses_rrm';
```

- [ ] **Step 4: Run the whole kit suite and watch it pass**

```bash
cd ~/iCode/projects/console-kit && node --test test/*.test.js
```

Expected: PASS, 0 failing. `test/packages-class.test.js` may now report a manifest sha mismatch for `mail/lanes.js`; that is Step 5's job. If it does, note the failure and proceed.

- [ ] **Step 5: Bump the package version and regenerate the manifest shas**

Edit `kit/manifest.json`, in `packages` -> the entry whose `name` is `mail`, change `"version": "1.5.0"` to `"version": "1.6.0"`. Then:

```bash
cd ~/iCode/projects/console-kit && node bin/console-kit hash && node --test test/*.test.js
```

Expected: `hash` rewrites `kit/manifest.json`'s `sha256` values; the suite is PASS, 0 failing.

- [ ] **Step 6: Commit the kit change**

```bash
cd ~/iCode/projects/console-kit
cat > /tmp/ck-commit.txt <<'MSG'
mail 1.6.0: admit newsletter@rrmacademy.com on the bulk rail

The bulk mail rail sends as a separate registrable domain so a
multi-thousand send cannot put a spam-rate day on rrmacademy.org, whose
Postmaster compliance verdict every transactional send shares. Three
rules in lanes.js refused it, not the two the spec named:

  - EXEMPTIONS['newsletter-blast'].from is a closed list
  - SES_SENDER_DOMAINS.rrma admitted only rrmacademy.org
  - the granted-exemption branch compared against a HARDCODED
    ('mail.rrmacademy.org', 'rrmacademy.org') pair that silently
    outranked SES_SENDER_DOMAINS, so admitting the domain there alone
    would not have been enough

The third now reads the domain tables, which is what it always meant.
Any other local part on rrmacademy.com still refuses with
exemption-sender-not-allowed, and the domain with no named exemption is
still the workspace-lane-only refusal.

Spec: rrm-academy-cf docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 5.0

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git add kit/packages/mail/lanes.js kit/manifest.json test/mail-package.test.js
git commit -F /tmp/ck-commit.txt
```

- [ ] **Step 7: Dry-run the sync into rrm-academy-cf and read the plan**

```bash
cd ~/iCode/projects/console-kit && node bin/console-kit sync ~/iCode/projects/rrm-academy-cf
```

Expected: an UPDATE line for `vendor/mail/lanes.js` and nothing else, then `(dry run; pass --apply to write)`. If any other file appears in the plan, STOP and read why before applying.

- [ ] **Step 8: Apply the sync**

```bash
cd ~/iCode/projects/console-kit && node bin/console-kit sync ~/iCode/projects/rrm-academy-cf --apply
cd ~/iCode/projects/rrm-academy-cf && node --test test/kit-lock.test.js test/_mail.test.js test/ses-adapter.test.js
```

Expected: the sync writes `vendor/mail/lanes.js` plus `kit.lock.json`; the three test files are PASS, 0 failing.

- [ ] **Step 9: Prove the vendored copy admits the bulk From**

```bash
cd ~/iCode/projects/rrm-academy-cf && node -e "
import('./vendor/mail/index.js').then(({ resolveLane }) => {
  console.log(resolveLane({ entity: 'rrma', purpose: 'newsletter', from: 'newsletter@rrmacademy.com', exemption: 'newsletter-blast' }));
});
"
```

Expected: prints `ses_rrm`.

- [ ] **Step 10: Commit the sync in rrm-academy-cf**

```bash
cd ~/iCode/projects/rrm-academy-cf
cat > /tmp/rac-commit.txt <<'MSG'
sync console-kit mail 1.6.0 (bulk rail lane admission)

Vendored, not edited: the package changes only in
~/iCode/projects/console-kit/kit/packages/mail. resolveLane() now
returns ses_rrm for newsletter@rrmacademy.com under the
newsletter-blast exemption, which is task zero of the bulk mail rail
build -- nothing else in that phase can go live before this.

Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 5.0

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git add vendor/mail/lanes.js kit.lock.json
git commit -F /tmp/rac-commit.txt
```

---

## Task 1: SES identity, DNS, DMARC, configuration set, SNS and Postmaster for rrmacademy.com

An operator task. It produces no repository code; it produces the AWS and DNS facts every later task assumes. Every step is a command whose output you read, or a dashboard action where AWS or Google publishes no API for it. Run it from the blue iMac.

**Files:**
- Create: none in any repository.
- Modify: none in any repository.
- Test: the verification commands in Steps 9, 12, 15 and 18 are this task's proof gates.

**Interfaces:**
- Consumes: Task 0's `resolveLane` admission (the identity is pointless until the package accepts the From).
- Produces, as environment facts later tasks bind by name:
  - SES verified domain identity `rrmacademy.com` in `AWS_SES_REGION` (default `us-east-1`), Easy DKIM enabled, custom MAIL FROM `bounce.rrmacademy.com`.
  - SES configuration set named exactly `rrm-bulk`, with an SNS event destination publishing `BOUNCE`, `COMPLAINT` and `DELIVERY` to the EXISTING topic named in Step 13.
  - Pages secret `BULK_FROM` on the `rrm-academy` project, value `"Dr. Naomi Whittaker, RRM Academy" <newsletter@rrmacademy.com>`.
  - Pages secret `SES_EVENTS_SECRET` on the `rrm-academy` project (a 32-byte hex string), and Pages var `SES_EVENTS_TOPIC_ARN` set to the topic ARN.
  - Google Postmaster Tools registration for `rrmacademy.com` under `administrator@rrmacademy.org`.

**Credentials.** The SES admin key is 1Password item `RRM AWS - IAM Access Key (rrm-ses-sender)` in vault `Automation`; its title contains parentheses, so it is read with `op item get --fields`, never an `op://` reference (memory `op-item-name-parentheses`). The Cloudflare DNS token is `op://Automation/CF - DNS Editor - rrmacademy/credential`.

- [ ] **Step 1: Export the AWS and Cloudflare credentials into this shell**

```bash
export AWS_ACCESS_KEY_ID=$(op item get "RRM AWS - IAM Access Key (rrm-ses-sender)" --vault Automation --fields "access key id" --reveal)
export AWS_SECRET_ACCESS_KEY=$(op item get "RRM AWS - IAM Access Key (rrm-ses-sender)" --vault Automation --fields "secret access key" --reveal)
export AWS_DEFAULT_REGION=us-east-1
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - DNS Editor - rrmacademy/credential')
export CF_ZONE_ID=$(curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=rrmacademy.com" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"][0]["id"])')
echo "zone: $CF_ZONE_ID"
```

Expected: a 32-character hex zone id. An empty value means the token cannot see the zone; do not continue, heal the token with the `/cf-token-heal` skill.

- [ ] **Step 2: Create the SES domain identity with Easy DKIM**

```bash
aws sesv2 create-email-identity --email-identity rrmacademy.com \
  --dkim-signing-attributes NextSigningKeyLength=RSA_2048_BIT
```

Expected: JSON with `"IdentityType": "DOMAIN"` and `"DkimAttributes": {"SigningEnabled": true, "Status": "PENDING", ...}`. If it answers `AlreadyExistsException`, the identity exists; continue.

- [ ] **Step 3: Read the three DKIM CNAME tokens**

```bash
aws sesv2 get-email-identity --email-identity rrmacademy.com \
  --query 'DkimAttributes.Tokens' --output text
```

Expected: three tokens, tab separated. Each becomes a record `<token>._domainkey.rrmacademy.com CNAME <token>.dkim.amazonses.com`.

- [ ] **Step 4: Publish the three DKIM CNAMEs**

```bash
for T in $(aws sesv2 get-email-identity --email-identity rrmacademy.com --query 'DkimAttributes.Tokens' --output text); do
  curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"${T}._domainkey\",\"content\":\"${T}.dkim.amazonses.com\",\"ttl\":300,\"proxied\":false}" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["success"], d.get("errors"))'
done
```

Expected: three lines reading `True []`. A `81058` error means the record already exists; that is fine.

- [ ] **Step 5: Set the custom MAIL FROM domain**

```bash
aws sesv2 put-email-identity-mail-from-attributes \
  --email-identity rrmacademy.com \
  --mail-from-domain bounce.rrmacademy.com \
  --behavior-on-mx-failure USE_DEFAULT_VALUE
```

Expected: an empty JSON object `{}`.

- [ ] **Step 6: Publish the MAIL FROM MX and SPF records**

The MX host is region specific; for `us-east-1` it is `feedback-smtp.us-east-1.amazonses.com`.

```bash
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"type":"MX","name":"bounce","content":"feedback-smtp.us-east-1.amazonses.com","priority":10,"ttl":300,"proxied":false}'
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"type":"TXT","name":"bounce","content":"v=spf1 include:amazonses.com -all","ttl":300,"proxied":false}'
```

Expected: two responses with `"success": true`.

- [ ] **Step 7: Publish the apex SPF for rrmacademy.com**

```bash
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"type":"TXT","name":"@","content":"v=spf1 include:amazonses.com -all","ttl":300,"proxied":false}'
```

Expected: `"success": true`. If the zone already carries an apex SPF TXT, edit that record instead of adding a second; two SPF records on one name is a permerror.

- [ ] **Step 8: Publish the warm-up DMARC record at p=none**

```bash
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"type":"TXT","name":"_dmarc","content":"v=DMARC1; p=none; rua=mailto:dmarc@rrmacademy.org; fo=1; adkim=r; aspf=r","ttl":300,"proxied":false}'
```

Expected: `"success": true`. `p=quarantine` is phase 3, after two weeks of aligned-only reports; do not set it now.

- [ ] **Step 9: PROOF GATE -- DNS and DKIM verification**

Wait five minutes, then:

```bash
dig +short TXT rrmacademy.com | grep spf1
dig +short TXT _dmarc.rrmacademy.com
dig +short MX bounce.rrmacademy.com
aws sesv2 get-email-identity --email-identity rrmacademy.com \
  --query '{dkim:DkimAttributes.Status,verified:VerifiedForSendingStatus,mailfrom:MailFromAttributes.MailFromDomainStatus}'
```

Expected: the SPF and DMARC strings print; the MX prints `10 feedback-smtp.us-east-1.amazonses.com.`; the last command prints `{"dkim": "SUCCESS", "verified": true, "mailfrom": "SUCCESS"}`. DKIM can take up to 72 hours; re-run until `SUCCESS`. Do not proceed past Step 10 with `dkim` at `PENDING`.

- [ ] **Step 10: Create the `rrm-bulk` configuration set**

```bash
aws sesv2 create-configuration-set --configuration-set-name rrm-bulk \
  --reputation-options ReputationMetricsEnabled=true \
  --sending-options SendingEnabled=true \
  --suppression-options 'SuppressedReasons=BOUNCE,COMPLAINT'
```

Expected: an empty JSON object `{}`. The account-level suppression list stays on; this adds the configuration-set level on top, per spec section 5.2 ("SES account-level suppression list stays on").

- [ ] **Step 11: Find the EXISTING SNS topic the `rrm-email` configuration set publishes to**

```bash
aws sesv2 get-configuration-set-event-destinations --configuration-set-name rrm-email \
  --query 'EventDestinations[].{name:Name,enabled:Enabled,types:MatchingEventTypes,topic:SnsDestination.TopicArn}'
```

Expected: at least one destination with a `topic` ARN. Record it:

```bash
export SES_TOPIC_ARN='<the TopicArn printed above>'
echo "$SES_TOPIC_ARN"
```

If `rrm-email` has NO SNS destination, create the topic first:

```bash
export SES_TOPIC_ARN=$(aws sns create-topic --name rrm-ses-events --query TopicArn --output text)
```

- [ ] **Step 12: DECISION, recorded here rather than left implicit -- the bulk configuration set REUSES this topic**

`functions/api/email/events.js` does not key on the configuration set name anywhere: it reads `message.eventType`, `mail.messageId`, and the SES message tags, and it guards the sender with `SES_EVENTS_TOPIC_ARN`, a single scalar. So a second topic would buy a second subscription, a second secret and a second ARN guard for nothing. One topic, one subscription, one secret. Campaign scoping in the breaker comes from the `ses_message_id` join onto `email_log.source`, which Task 5 writes, never from the topic or the configuration set name.

Record the decision by echoing it into the run log so the next operator finds it:

```bash
mkdir -p ~/iCode/.run-log/bulk-mail
echo "$(date -u +%FT%TZ) rrm-bulk reuses SNS topic $SES_TOPIC_ARN (events.js does not key on config set name)" \
  >> ~/iCode/.run-log/bulk-mail/wiring.log
```

- [ ] **Step 13: Attach an SNS event destination to `rrm-bulk`**

```bash
aws sesv2 create-configuration-set-event-destination \
  --configuration-set-name rrm-bulk \
  --event-destination-name rrm-bulk-sns \
  --event-destination "Enabled=true,MatchingEventTypes=BOUNCE,MatchingEventTypes=COMPLAINT,MatchingEventTypes=DELIVERY,SnsDestination={TopicArn=$SES_TOPIC_ARN}"
```

Expected: an empty JSON object `{}`.

- [ ] **Step 14: Mint the events secret and subscribe the endpoint to the topic**

```bash
export SES_EVENTS_SECRET=$(openssl rand -hex 32)
aws sns subscribe --topic-arn "$SES_TOPIC_ARN" --protocol https \
  --notification-endpoint "https://rrmacademy.org/api/email/events?secret=$SES_EVENTS_SECRET"
```

Expected: JSON with `"SubscriptionArn": "pending confirmation"`. The endpoint answers the `SubscriptionConfirmation` itself once the secret is set, which is the next step, so set the secret BEFORE re-confirming.

- [ ] **Step 15: Set the Pages secrets and vars**

```bash
cd ~/iCode/projects/rrm-academy-cf
printf '%s' "$SES_EVENTS_SECRET" | npx wrangler pages secret put SES_EVENTS_SECRET --project-name rrm-academy
printf '%s' '"Dr. Naomi Whittaker, RRM Academy" <newsletter@rrmacademy.com>' | npx wrangler pages secret put BULK_FROM --project-name rrm-academy
printf '%s' "$SES_TOPIC_ARN" | npx wrangler pages secret put SES_EVENTS_TOPIC_ARN --project-name rrm-academy
npx wrangler pages secret list --project-name rrm-academy
```

Expected: the list names `SES_EVENTS_SECRET`, `BULK_FROM` and `SES_EVENTS_TOPIC_ARN`. Also store both new values in 1Password, vault `Automation`, items `RRM Academy SES Events Secret` and `RRM Academy Bulk From`, so the next operator is not reading them out of a shell.

- [ ] **Step 16: PROOF GATE -- the events endpoint is live, not inert**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://rrmacademy.org/api/email/events
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "https://rrmacademy.org/api/email/events?secret=$SES_EVENTS_SECRET" \
  -H 'Content-Type: application/json' --data '{"Type":"Notification"}'
```

Expected: the first prints `401` (the secret is set, so the endpoint is no longer 503, and an absent secret is unauthorized). The second prints `401` as well, because the SNS signature is missing. A `503` on either means the secret did not reach production; redeploy the Pages project and retry.

- [ ] **Step 17: Re-drive the SNS confirmation**

```bash
aws sns list-subscriptions-by-topic --topic-arn "$SES_TOPIC_ARN" \
  --query 'Subscriptions[?Protocol==`https`].{arn:SubscriptionArn,endpoint:Endpoint}'
```

Expected: the subscription whose endpoint carries our path shows a real ARN, not `PendingConfirmation`. If it still reads `PendingConfirmation`, delete it and re-run Step 14; the endpoint auto-confirms a signed `SubscriptionConfirmation` whose `SubscribeURL` is on `.amazonaws.com`.

- [ ] **Step 18: PROOF GATE -- register rrmacademy.com in Google Postmaster Tools**

Postmaster Tools has no provisioning API; registration is a dashboard action. In Comet, signed in as `administrator@rrmacademy.org`:

1. Open `https://postmaster.google.com/managedomains`.
2. Click **Add**, enter `rrmacademy.com`, click **Next**.
3. Copy the TXT verification value it shows (it begins `google-site-verification=`).
4. Publish it:

```bash
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"type":"TXT","name":"@","content":"google-site-verification=<PASTE THE VALUE FROM STEP 3>","ttl":300,"proxied":false}'
```

5. Back in Postmaster Tools, click **Verify**.

Expected: the domain list shows BOTH `rrmacademy.org` and `rrmacademy.com` as verified. The dashboards stay empty until real volume arrives in phase 2; that is expected, not a failure.

- [ ] **Step 19: Record the wiring facts**

```bash
cat >> ~/iCode/.run-log/bulk-mail/wiring.log <<LOG
$(date -u +%FT%TZ) SES identity rrmacademy.com verified, DKIM SUCCESS, MAIL FROM bounce.rrmacademy.com
$(date -u +%FT%TZ) configuration set rrm-bulk created, SNS destination rrm-bulk-sns -> $SES_TOPIC_ARN
$(date -u +%FT%TZ) Pages secrets set on rrm-academy: SES_EVENTS_SECRET, BULK_FROM, SES_EVENTS_TOPIC_ARN
$(date -u +%FT%TZ) Postmaster Tools: rrmacademy.com verified under administrator@rrmacademy.org
LOG
cat ~/iCode/.run-log/bulk-mail/wiring.log
```

Expected: five lines. There is nothing to commit in this task; the run log is deliberately outside any repository because it holds operational timestamps, not code.

---

## Task 2: Migration 041 -- `mail_domain_state` and `send_paused`

**Files:**
- Create: `migrations/041-bulk-mail-rail.sql`
- Modify: `scripts/gates/validate-sql-columns.mjs` (the `EXTRA_DDL` array, appended after the `039` entry)
- Create: `test/_bulk-mail-sqlite.mjs`
- Test: `test/bulk-mail-schema.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - Table `mail_domain_state(domain TEXT PRIMARY KEY, first_send_at TEXT, day TEXT, sent_today INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`.
  - Table `send_paused(id TEXT PRIMARY KEY, campaign TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT, paused_at TEXT NOT NULL DEFAULT (datetime('now')), resumed_at TEXT)` plus `idx_send_paused_open ON send_paused(campaign, resumed_at)`.
  - `test/_bulk-mail-sqlite.mjs` exports `bulkMailD1(opts)` with the same option bag as `sqliteD1` from `test/_d1-sqlite.mjs`, and `BULK_MAIL_SCHEMA_SQL` (a string).

- [ ] **Step 1: Write the failing schema test**

Create `test/bulk-mail-schema.test.js`:

```js
/**
 * EXECUTED tests for the bulk mail rail's two D1 tables (migration 041).
 *
 * These run against a REAL SQLite engine loaded with the repo's committed
 * schema.sql plus migration 041, so what they assert is what SQLite decides,
 * not what a substring matcher was told to return. The point of asserting the
 * shape at all is that three later surfaces bind these columns by name --
 * functions/api/newsletter/_policy.js, functions/api/newsletter/send.js and the
 * rrm-observatory bulk-mail-health daemon -- and a column renamed in the
 * migration without renaming it in all three is a silent production 500.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bulkMailD1 } from './_bulk-mail-sqlite.mjs';

describe('migration 041 shape', () => {
  it('mail_domain_state carries one row per sending domain with a per-UTC-day counter', async () => {
    const db = bulkMailD1();
    await db.prepare(
      "INSERT INTO mail_domain_state (domain, first_send_at, day, sent_today) VALUES (?, ?, ?, ?)"
    ).bind('rrmacademy.com', '2026-09-20T14:00:00.000Z', '2026-09-20', 137).run();
    const row = await db.prepare('SELECT * FROM mail_domain_state WHERE domain = ?').bind('rrmacademy.com').first();
    assert.equal(row.first_send_at, '2026-09-20T14:00:00.000Z');
    assert.equal(row.day, '2026-09-20');
    assert.equal(row.sent_today, 137);
    assert.ok(row.updated_at, 'updated_at defaults to datetime(now)');
  });

  it('sent_today defaults to 0 so a fresh row never reads NULL into the arithmetic', async () => {
    const db = bulkMailD1();
    await db.prepare("INSERT INTO mail_domain_state (domain, first_send_at, day) VALUES (?, ?, ?)")
      .bind('rrmacademy.com', '2026-09-20T14:00:00.000Z', '2026-09-20').run();
    const row = await db.prepare('SELECT sent_today FROM mail_domain_state WHERE domain = ?').bind('rrmacademy.com').first();
    assert.equal(row.sent_today, 0);
  });

  it('the domain is the primary key, so a second first-send write cannot mint a rival row', async () => {
    const db = bulkMailD1();
    await db.prepare("INSERT INTO mail_domain_state (domain, first_send_at, day) VALUES (?, ?, ?)")
      .bind('rrmacademy.com', '2026-09-20T14:00:00.000Z', '2026-09-20').run();
    await assert.rejects(
      db.prepare("INSERT INTO mail_domain_state (domain, first_send_at, day) VALUES (?, ?, ?)")
        .bind('rrmacademy.com', '2026-10-01T00:00:00.000Z', '2026-10-01').run(),
      /UNIQUE constraint failed/,
    );
  });

  it('send_paused records the reason and stays open until a human resumes it', async () => {
    const db = bulkMailD1();
    await db.prepare(
      "INSERT INTO send_paused (id, campaign, reason, detail) VALUES (?, ?, ?, ?)"
    ).bind('sp-1', 'sept-letter', 'complaint-rate', '3 complaints / 900 sent = 0.33%').run();
    const open = await db.prepare(
      'SELECT id, reason FROM send_paused WHERE campaign = ? AND resumed_at IS NULL'
    ).bind('sept-letter').all();
    assert.equal(open.results.length, 1);
    assert.equal(open.results[0].reason, 'complaint-rate');
    await db.prepare("UPDATE send_paused SET resumed_at = datetime('now') WHERE id = ?").bind('sp-1').run();
    const stillOpen = await db.prepare(
      'SELECT id FROM send_paused WHERE campaign = ? AND resumed_at IS NULL'
    ).bind('sept-letter').all();
    assert.equal(stillOpen.results.length, 0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/bulk-mail-schema.test.js
```

Expected: FAIL with `Cannot find module` for `./_bulk-mail-sqlite.mjs`.

- [ ] **Step 3: Write the migration**

Create `migrations/041-bulk-mail-rail.sql`:

```sql
-- 041-bulk-mail-rail.sql
-- Warm-up state for the bulk mail rail on rrmacademy.com -- additive migration on rrm-auth (D1).
--
-- WHY
-- The 2026-09-06 to 09-08 invite drip put a 0.55% user-reported spam day on
-- rrmacademy.org in Google Postmaster Tools, above the 0.3% policy line, and
-- flipped the domain's Compliance status to "Needs work". Every send as
-- rrmacademy.org shares that verdict, transactional mail included. The rail
-- built on top of these two tables moves multi-thousand sends onto a separate
-- registrable domain under a ramp table, a per-day counter and a circuit
-- breaker, so a bad cohort can cost at most one day's cap and then stops.
-- Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md sections 5.1 and 5.5.
--
-- mail_domain_state: ONE ROW PER SENDING DOMAIN, and the row's ABSENCE is
-- load-bearing. A missing row means the domain has never sent, and the policy
-- BLOCKS rather than computing a "days since first send" against a row that
-- does not exist. Only the CLI's --first-send flag creates it, in its own D1
-- write before any recipient is touched.
--
-- sent_today is keyed on `day`, a UTC calendar date, and is the ONLY source of
-- the day's spend. It is deliberately NOT recounted from email_log, because
-- insertEmailLog() in functions/api/_ses.js swallows D1 failures on purpose (a
-- logging failure must never turn into a bounced SES send), so a cap that
-- recounted email_log after SES had already accepted could undercount and let
-- a rerun exceed the ramp cap. The counter is incremented in the SAME db.batch()
-- as the email_log insert for each send, and a failure of that batch pauses the
-- run with reason 'log-write-failed' rather than being swallowed.
--
-- send_paused: an OPEN row (resumed_at IS NULL) is a stop. A paused run resumes
-- only by a human passing --resume after reading the reason; nothing in the
-- request path clears it. Rows are kept after resume as the campaign's history,
-- which is why resumed_at is a nullable column rather than a delete.
--
-- ADDITIVE ONLY: two new tables and one index. No existing reader is touched.
--
-- RE-RUNNABLE: every statement is IF NOT EXISTS.
--
-- ROLLBACK: DROP TABLE send_paused; DROP TABLE mail_domain_state;
--   Both are derived operational state, not a record of anything only they hold:
--   the sends themselves are in email_log and email_event.
--
-- Apply (by hand; no runner):
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/041-bulk-mail-rail.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/041-bulk-mail-rail.sql

CREATE TABLE IF NOT EXISTS mail_domain_state (
  domain         TEXT PRIMARY KEY,          -- 'rrmacademy.com'
  first_send_at  TEXT,                      -- ISO 8601 UTC; set once, by --first-send
  day            TEXT,                      -- UTC calendar date 'YYYY-MM-DD' that sent_today counts
  sent_today     INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS send_paused (
  id          TEXT PRIMARY KEY,             -- crypto.randomUUID()
  campaign    TEXT NOT NULL,                -- the campaign key, e.g. 'sept-letter'
  reason      TEXT NOT NULL,                -- complaint-rate | bounce-rate | log-write-failed
  detail      TEXT,                         -- the numbers behind the reason, <= 500 chars
  paused_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resumed_at  TEXT                          -- NULL while the pause stands
);

CREATE INDEX IF NOT EXISTS idx_send_paused_open ON send_paused(campaign, resumed_at);
```

- [ ] **Step 4: Write the test harness**

Create `test/_bulk-mail-sqlite.mjs`:

```js
/**
 * A D1-shaped rrm-auth binding that ALSO carries the bulk mail rail's tables.
 *
 * WHY THIS EXISTS
 * ---------------
 * test/_d1-sqlite.mjs builds rrm-auth from schema.sql ("Generated from the live
 * database on 2026-05-27") plus a replay list scoped to scripts/migrations/.
 * mail_domain_state and send_paused are in NEITHER: their DDL lives in the ROOT
 * migrations/ directory (041-bulk-mail-rail.sql), which the replay list does not
 * read and test/schema-migration-replay.test.mjs does not scan. This mirrors
 * test/_community-sqlite.mjs, whose action_area tables have the same problem for
 * the same reason.
 *
 * Load the plain harness and every statement in functions/api/newsletter/send.js's
 * bulk path fails to PREPARE with "no such table: mail_domain_state". Under
 * test/_helpers.js mockDB the same statements would "succeed" against canned
 * rows, which is the failure mode this harness family exists to refuse.
 *
 * WHAT THIS FAKE CANNOT DISTINGUISH (read before trusting a green run)
 * -------------------------------------------------------------------
 *  1. Whether live rrm-auth matches migration 041. This reads the file; it
 *     cannot query Cloudflare. `npm run gates:schema-drift` is what compares the
 *     composed mirror to live, in both directions, once the EXTRA_DDL entry in
 *     scripts/gates/validate-sql-columns.mjs is in place.
 *  2. Everything test/_d1-sqlite.mjs already lists: D1-vs-SQLite engine
 *     differences, the ~100KB statement cap, real concurrency, and every
 *     non-database service (SES, SNS, KV).
 */
import { readFileSync } from 'node:fs';
import { sqliteD1, SCHEMA_SQL } from './_d1-sqlite.mjs';

/** Root-migrations files, in application order, that define the bulk rail. */
export const BULK_MAIL_MIGRATIONS = ['041-bulk-mail-rail.sql'];

/** schema.sql + the replay list + migration 041, in that order. */
export const BULK_MAIL_SCHEMA_SQL = BULK_MAIL_MIGRATIONS.reduce(
  (sql, name) => sql + '\n' + readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'),
  SCHEMA_SQL,
);

/**
 * Same option bag as sqliteD1({ seed, interleave }); schemaSql is supplied.
 * @param {{ seed?: Function, interleave?: object }} [opts]
 */
export function bulkMailD1(opts = {}) {
  return sqliteD1({ ...opts, schemaSql: BULK_MAIL_SCHEMA_SQL });
}
```

- [ ] **Step 5: Run the schema test and watch it pass**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/bulk-mail-schema.test.js
```

Expected: PASS, 4 tests, 0 failing.

- [ ] **Step 6: Teach the SQL and schema-drift gates about the new tables**

In `scripts/gates/validate-sql-columns.mjs`, append this object to the `EXTRA_DDL` array, immediately after the `migrations/039-first-touch-attribution.sql` entry:

```js
  {
    path: 'migrations/041-bulk-mail-rail.sql',
    why: 'mail_domain_state and send_paused are the bulk mail rail\'s warm-up state, written by functions/api/newsletter/send.js\'s bulk path and read by the rrm-observatory bulk-mail-health daemon; they live in the ROOT migrations/ directory, which the test replay list does not read, and postdate the 2026-05-27 snapshot; added 2026-09-11 with the migration in the same change. The migration is applied to remote rrm-auth before the code that binds these tables deploys, so gates:schema-drift stays level with live; until that apply lands, SD2 (STALE-PRESENT) is the expected and intended signal.',
  },
```

- [ ] **Step 7: Run both schema gates**

```bash
cd ~/iCode/projects/rrm-academy-cf && npm run gates:sql && npm run gates:schema-drift:check
```

Expected: `gates:sql` prints all three gates passing with a PREPARED count at or above its floor; `gates:schema-drift:check` (SD1 only, no network) passes.

- [ ] **Step 8: Apply the migration to local and remote rrm-auth**

```bash
cd ~/iCode/projects/rrm-academy-cf
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - D1 Operator - account/credential')
export CLOUDFLARE_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a
npx wrangler d1 execute rrm-auth --local  --file=migrations/041-bulk-mail-rail.sql
npx wrangler d1 execute rrm-auth --remote --file=migrations/041-bulk-mail-rail.sql
npx wrangler d1 execute rrm-auth --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mail_domain_state','send_paused')"
```

Expected: the last command lists both table names. Two rows, not one, not zero.

- [ ] **Step 9: PROOF GATE -- the live drift gate is level**

```bash
cd ~/iCode/projects/rrm-academy-cf && npm run gates:schema-drift
```

Expected: SD1 pass, SD2 pass (no stale-present: the mirror's two new tables now exist live), SD3 pass or a warn that does NOT name `mail_domain_state` or `send_paused`.

- [ ] **Step 10: Commit**

```bash
cd ~/iCode/projects/rrm-academy-cf
cat > /tmp/rac-commit.txt <<'MSG'
migration 041: mail_domain_state + send_paused for the bulk mail rail

Two additive tables on rrm-auth, applied to remote before this lands so
gates:schema-drift stays level in both directions.

mail_domain_state holds the warm-up ramp's state, one row per sending
domain, and the row's ABSENCE is load-bearing: a missing row means the
domain has never sent and the policy blocks rather than computing a day
count against a row that does not exist. sent_today is keyed on a UTC
calendar date and is the ONLY source of the day's spend; it is
deliberately not recounted from email_log, because insertEmailLog()
swallows D1 failures by design and a recount after SES already accepted
could undercount and let a rerun exceed the cap.

send_paused records a stop with its reason. An open row (resumed_at
IS NULL) is a stop nothing in the request path can clear; a human
passes --resume after reading the reason.

Harness: test/_bulk-mail-sqlite.mjs composes schema.sql + 041 the way
test/_community-sqlite.mjs composes the root action-area migrations,
because the replay list only reads scripts/migrations/.

Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md sections 5.1, 5.5

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git add migrations/041-bulk-mail-rail.sql test/_bulk-mail-sqlite.mjs test/bulk-mail-schema.test.js scripts/gates/validate-sql-columns.mjs
git commit -F /tmp/rac-commit.txt
```

---

## Task 3: The policy module `_policy.js`, with unit tests and two mutation proofs

`functions/api/newsletter/_policy.js` is pure: no imports, no I/O, no clock of its own. Every function takes what it needs, including `nowIso`, which is what makes the ramp table and the day boundary testable without freezing a global.

**Dispatch the `coder` agent for the implementation step** (`subagent_type: "coder"`): this file lives under `functions/api/`, and the repo rule is that endpoint-directory code is written by that agent after it reads its siblings.

**Files:**
- Create: `functions/api/newsletter/_policy.js`
- Test: `test/newsletter-policy.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (`_policy.js` imports nothing).
- Produces, all named exports of `functions/api/newsletter/_policy.js`:
  - `BULK_DOMAIN: string` -- `'rrmacademy.com'`
  - `RAMP_TABLE: Array<{ throughDay: number, cap: number }>`
  - `COMPLAINT_RATE_LIMIT: number` -- `0.002`
  - `BOUNCE_RATE_LIMIT: number` -- `0.02`
  - `BREAKER_MIN_SAMPLE: number` -- `50`
  - `PAUSE_COMPLAINT_RATE: string`, `PAUSE_BOUNCE_RATE: string`, `PAUSE_LOG_WRITE_FAILED: string`
  - `COHORT_ORDER_SQL: string`
  - `utcDay(nowIso: string): string`
  - `domainAgeDays(firstSendAt: string, nowIso: string): number`
  - `dailyCap(ageDays: number): number`
  - `remainingAllowance(state: object|null, nowIso: string): { ok: boolean, reason: string|null, ageDays: number|null, cap: number, sentToday: number, remaining: number }`
  - `truncateToAllowance(recipients: Array<object>, remaining: number): { send: Array<object>, deferred: number }`
  - `compareCohort(a: object, b: object): number`
  - `breakerVerdict(counts: { sent: number, complained: number, bounced: number }): { tripped: boolean, reason: string|null, detail: string }`
  - `feedbackId(campaign: string, segment: string|null): string`
  - `isCampaignKey(value: unknown): boolean`

- [ ] **Step 1: Write the failing tests**

Create `test/newsletter-policy.test.js`:

```js
/**
 * EXECUTED tests for functions/api/newsletter/_policy.js -- the warm-up policy
 * for the bulk mail rail.
 *
 * The module is PURE by design: no D1, no fetch, no Date.now(). Every function
 * takes nowIso as an argument, so the day-boundary and ramp-table cases below
 * are real assertions rather than a frozen clock. The two mutation proofs at the
 * bottom are the point of the file: a breaker that cannot trip and a cap that is
 * ignored are exactly the defects that turn a 200-recipient warm-up day into the
 * 2,880-message drip that started this build.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BULK_DOMAIN, RAMP_TABLE, COMPLAINT_RATE_LIMIT, BOUNCE_RATE_LIMIT, BREAKER_MIN_SAMPLE,
  PAUSE_COMPLAINT_RATE, PAUSE_BOUNCE_RATE, PAUSE_LOG_WRITE_FAILED, COHORT_ORDER_SQL,
  utcDay, domainAgeDays, dailyCap, remainingAllowance, truncateToAllowance,
  compareCohort, breakerVerdict, feedbackId, isCampaignKey,
} from '../functions/api/newsletter/_policy.js';

const FIRST = '2026-09-20T14:00:00.000Z';

describe('the ramp table', () => {
  it('reads the spec table exactly: 200, 500, 1000, 1500', () => {
    assert.deepEqual(RAMP_TABLE.map(r => r.cap), [200, 500, 1000, 1500]);
    assert.equal(dailyCap(1), 200);
    assert.equal(dailyCap(2), 200);
    assert.equal(dailyCap(3), 500);
    assert.equal(dailyCap(5), 500);
    assert.equal(dailyCap(6), 1000);
    assert.equal(dailyCap(12), 1000);
    assert.equal(dailyCap(13), 1500);
    assert.equal(dailyCap(400), 1500);
  });

  it('counts the first-send day as day 1, on UTC calendar days not elapsed hours', () => {
    assert.equal(domainAgeDays(FIRST, '2026-09-20T14:00:01.000Z'), 1);
    assert.equal(domainAgeDays(FIRST, '2026-09-20T23:59:59.000Z'), 1);
    // 10 hours later, but a new UTC day: day 2, cap still 200.
    assert.equal(domainAgeDays(FIRST, '2026-09-21T00:00:01.000Z'), 2);
    assert.equal(domainAgeDays(FIRST, '2026-09-22T00:00:01.000Z'), 3);
    assert.equal(domainAgeDays(FIRST, '2026-10-02T12:00:00.000Z'), 13);
  });

  it('utcDay is the UTC calendar date, never the local one', () => {
    assert.equal(utcDay('2026-09-20T23:59:59.000Z'), '2026-09-20');
    assert.equal(utcDay('2026-09-21T00:00:00.000Z'), '2026-09-21');
  });
});

describe('the first-send gate', () => {
  it('BLOCKS when mail_domain_state has no row for the domain', () => {
    const v = remainingAllowance(null, '2026-09-20T14:00:00.000Z');
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'first-send-not-recorded');
    assert.equal(v.remaining, 0);
    assert.equal(v.ageDays, null);
  });

  it('BLOCKS when the row exists but first_send_at is NULL', () => {
    const v = remainingAllowance({ domain: BULK_DOMAIN, first_send_at: null, day: null, sent_today: 0 }, FIRST);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'first-send-not-recorded');
  });

  it('admits the run under the day 1 cap once the row exists', () => {
    const v = remainingAllowance({ first_send_at: FIRST, day: '2026-09-20', sent_today: 0 }, '2026-09-20T14:00:05.000Z');
    assert.equal(v.ok, true);
    assert.equal(v.reason, null);
    assert.equal(v.ageDays, 1);
    assert.equal(v.cap, 200);
    assert.equal(v.remaining, 200);
  });
});

describe('the daily allowance', () => {
  it('subtracts the day counter from the cap', () => {
    const v = remainingAllowance({ first_send_at: FIRST, day: '2026-09-20', sent_today: 137 }, '2026-09-20T18:00:00.000Z');
    assert.equal(v.sentToday, 137);
    assert.equal(v.remaining, 63);
  });

  it('is 0, never negative, when the day is already spent or overspent', () => {
    const spent = remainingAllowance({ first_send_at: FIRST, day: '2026-09-20', sent_today: 200 }, '2026-09-20T18:00:00.000Z');
    assert.equal(spent.remaining, 0);
    assert.equal(spent.ok, true, 'a spent day is a real answer, not an error');
    const over = remainingAllowance({ first_send_at: FIRST, day: '2026-09-20', sent_today: 260 }, '2026-09-20T18:00:00.000Z');
    assert.equal(over.remaining, 0);
  });

  it('resets the counter when the stored day is not today', () => {
    const v = remainingAllowance({ first_send_at: FIRST, day: '2026-09-20', sent_today: 200 }, '2026-09-21T00:00:01.000Z');
    assert.equal(v.sentToday, 0, 'yesterday spend does not follow the domain into today');
    assert.equal(v.cap, 200, 'day 2 is still the 200 band');
    assert.equal(v.remaining, 200);
  });

  it('treats a NULL day or NULL counter as an unspent day rather than NaN', () => {
    const v = remainingAllowance({ first_send_at: FIRST, day: null, sent_today: null }, '2026-09-20T18:00:00.000Z');
    assert.equal(v.sentToday, 0);
    assert.equal(v.remaining, 200);
  });
});

describe('truncation to the allowance', () => {
  const recipients = Array.from({ length: 250 }, (_, i) => ({ id: `sub-${i}` }));

  it('is a ceiling, never a target: the remainder is left for the next day', () => {
    const { send, deferred } = truncateToAllowance(recipients, 63);
    assert.equal(send.length, 63);
    assert.equal(deferred, 187);
    assert.equal(send[0].id, 'sub-0', 'the engaged head is kept, the tail is deferred');
    assert.equal(send[62].id, 'sub-62');
  });

  it('sends nothing when the day has no allowance left', () => {
    const { send, deferred } = truncateToAllowance(recipients, 0);
    assert.equal(send.length, 0);
    assert.equal(deferred, 250);
  });

  it('never invents recipients when the allowance exceeds the cohort', () => {
    const { send, deferred } = truncateToAllowance(recipients, 1500);
    assert.equal(send.length, 250);
    assert.equal(deferred, 0);
  });

  it('treats a negative allowance as zero', () => {
    const { send, deferred } = truncateToAllowance(recipients, -5);
    assert.equal(send.length, 0);
    assert.equal(deferred, 250);
  });
});

describe('the circuit breaker', () => {
  it('does not trip below the minimum sample, which is deliberate fail-open', () => {
    assert.equal(BREAKER_MIN_SAMPLE, 50);
    const v = breakerVerdict({ sent: 49, complained: 49, bounced: 49 });
    assert.equal(v.tripped, false);
    assert.match(v.detail, /49 sent/);
  });

  it('trips at exactly 0.2% complaints', () => {
    assert.equal(COMPLAINT_RATE_LIMIT, 0.002);
    const v = breakerVerdict({ sent: 1000, complained: 2, bounced: 0 });
    assert.equal(v.tripped, true);
    assert.equal(v.reason, PAUSE_COMPLAINT_RATE);
  });

  it('does not trip just under 0.2% complaints', () => {
    const v = breakerVerdict({ sent: 1000, complained: 1, bounced: 0 });
    assert.equal(v.tripped, false);
    assert.equal(v.reason, null);
  });

  it('trips at exactly 2% hard bounces', () => {
    assert.equal(BOUNCE_RATE_LIMIT, 0.02);
    const v = breakerVerdict({ sent: 1000, complained: 0, bounced: 20 });
    assert.equal(v.tripped, true);
    assert.equal(v.reason, PAUSE_BOUNCE_RATE);
  });

  it('does not trip just under 2% hard bounces', () => {
    assert.equal(breakerVerdict({ sent: 1000, complained: 0, bounced: 19 }).tripped, false);
  });

  it('names the complaint reason first when both thresholds are crossed', () => {
    const v = breakerVerdict({ sent: 1000, complained: 5, bounced: 50 });
    assert.equal(v.reason, PAUSE_COMPLAINT_RATE, 'complaints are the Postmaster-visible harm');
  });

  it('trips at the minimum sample exactly, not one send later', () => {
    // 50 sent, 1 complaint = 2%, ten times the line.
    const v = breakerVerdict({ sent: 50, complained: 1, bounced: 0 });
    assert.equal(v.tripped, true);
    assert.equal(v.reason, PAUSE_COMPLAINT_RATE);
  });

  it('carries the numbers in detail so send_paused records why, not just that', () => {
    const v = breakerVerdict({ sent: 900, complained: 3, bounced: 1 });
    assert.match(v.detail, /3/);
    assert.match(v.detail, /900/);
  });
});

describe('cohort ordering', () => {
  const mk = (over) => ({
    id: 'z', source: 'import',
    last_clicked_at: null, last_opened_at: null, last_sent_at: null, subscribed_at: null, ...over,
  });

  it('puts source=website subscribers first', () => {
    const web = mk({ id: 'a', source: 'website' });
    const imp = mk({ id: 'b', source: 'import' });
    assert.ok(compareCohort(web, imp) < 0);
    assert.ok(compareCohort(imp, web) > 0);
  });

  it('orders by last_clicked_at descending within the same source class', () => {
    const older = mk({ id: 'a', last_clicked_at: '2026-01-01T00:00:00Z' });
    const newer = mk({ id: 'b', last_clicked_at: '2026-06-01T00:00:00Z' });
    assert.ok(compareCohort(newer, older) < 0);
  });

  it('sorts NULL engagement columns LAST, not first', () => {
    const withValue = mk({ id: 'a', last_sent_at: '2026-01-01T00:00:00Z' });
    const withNull = mk({ id: 'b', last_sent_at: null });
    assert.ok(compareCohort(withValue, withNull) < 0, 'a recently-sent-to subscriber outranks one never sent to');
    assert.ok(compareCohort(withNull, withValue) > 0);
    assert.equal(compareCohort(mk({ id: 'a' }), mk({ id: 'a' })), 0, 'two all-NULL rows with the same id tie');
  });

  it('falls through the four engagement keys in the spec order', () => {
    const clicked = mk({ id: 'a', last_clicked_at: '2026-01-01T00:00:00Z', last_opened_at: null, last_sent_at: null });
    const opened = mk({ id: 'b', last_clicked_at: null, last_opened_at: '2026-09-01T00:00:00Z', last_sent_at: '2026-09-09T00:00:00Z' });
    assert.ok(compareCohort(clicked, opened) < 0, 'a click outranks any open or send, however recent');
    const sentRecent = mk({ id: 'c', last_sent_at: '2026-09-09T00:00:00Z', subscribed_at: '2020-01-01T00:00:00Z' });
    const sentNever = mk({ id: 'd', last_sent_at: null, subscribed_at: '2026-09-10T00:00:00Z' });
    assert.ok(compareCohort(sentRecent, sentNever) < 0, 'last_sent_at outranks subscribed_at');
  });

  it('breaks a total tie on id so the order is deterministic across pages', () => {
    assert.ok(compareCohort(mk({ id: 'a' }), mk({ id: 'b' })) < 0);
    assert.ok(compareCohort(mk({ id: 'b' }), mk({ id: 'a' })) > 0);
  });

  it('the SQL ORDER BY names the same five keys in the same order', () => {
    const idx = (s) => COHORT_ORDER_SQL.indexOf(s);
    assert.ok(idx("s.source = 'website'") >= 0);
    assert.ok(idx('s.last_clicked_at DESC') > idx("s.source = 'website'"));
    assert.ok(idx('s.last_opened_at DESC') > idx('s.last_clicked_at DESC'));
    assert.ok(idx('s.last_sent_at DESC') > idx('s.last_opened_at DESC'));
    assert.ok(idx('s.subscribed_at DESC') > idx('s.last_sent_at DESC'));
    assert.ok(idx('s.id ASC') > idx('s.subscribed_at DESC'));
  });
});

describe('Feedback-ID and campaign keys', () => {
  it('builds the four-part Feedback-ID the spec names', () => {
    assert.equal(feedbackId('sept-letter', 'engaged'), 'sept-letter:engaged:rrma:rrmacademy.com');
  });

  it('uses "all" as the segment when the send has no segment filter', () => {
    assert.equal(feedbackId('sept-letter', null), 'sept-letter:all:rrma:rrmacademy.com');
    assert.equal(feedbackId('sept-letter', ''), 'sept-letter:all:rrma:rrmacademy.com');
  });

  it('cannot carry a colon, a newline or any other header-splitting character', () => {
    const id = feedbackId('sept:letter\r\nBcc: evil@x', 'a b/c');
    assert.equal(id.split(':').length, 4, 'exactly four colon-separated parts');
    assert.ok(!/[\r\n]/.test(id));
    assert.equal(id, 'sept-letter-bcc-evil-x:a-b-c:rrma:rrmacademy.com');
  });

  it('accepts only lowercase slug campaign keys', () => {
    assert.equal(isCampaignKey('sept-letter'), true);
    assert.equal(isCampaignKey('a1'), true);
    assert.equal(isCampaignKey('Sept-Letter'), false);
    assert.equal(isCampaignKey('sept letter'), false);
    assert.equal(isCampaignKey('-sept'), false);
    assert.equal(isCampaignKey('a'), false, 'one character is too short to be a campaign name');
    assert.equal(isCampaignKey(''), false);
    assert.equal(isCampaignKey(null), false);
    assert.equal(isCampaignKey(42), false);
    assert.equal(isCampaignKey('x'.repeat(65)), false);
  });
});

describe('pause reasons', () => {
  it('are the three the spec names, as stable strings the daemon greps for', () => {
    assert.equal(PAUSE_COMPLAINT_RATE, 'complaint-rate');
    assert.equal(PAUSE_BOUNCE_RATE, 'bounce-rate');
    assert.equal(PAUSE_LOG_WRITE_FAILED, 'log-write-failed');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/newsletter-policy.test.js
```

Expected: FAIL with `Cannot find module '.../functions/api/newsletter/_policy.js'`.

- [ ] **Step 3: Implement the module (dispatch the `coder` agent)**

Dispatch `subagent_type: "coder"` with the instruction: "Create `functions/api/newsletter/_policy.js` in rrm-academy-cf exactly as given below. Read its siblings in `functions/api/newsletter/` first for comment and export conventions. The module must import nothing and must not read a clock." Hand it this file:

```js
/**
 * THE BULK RAIL'S WARM-UP POLICY, AS PURE FUNCTIONS.
 *
 * This module imports nothing, touches no binding, and never reads a clock:
 * every function that needs the time is handed `nowIso`. That is not
 * fastidiousness, it is what lets the ramp table, the UTC day boundary and the
 * breaker thresholds be asserted exactly, at the boundary values, without
 * freezing a global that the rest of the suite shares.
 *
 * WHY THERE IS A POLICY AT ALL. The 2026-09-06 to 09-08 drip sent about 2,880
 * messages over three UTC days from the apex Workspace identity and put a 0.55%
 * user-reported spam day on rrmacademy.org, above Google's 0.3% line, flipping
 * the domain's Compliance status to "Needs work" -- a verdict every send as
 * rrmacademy.org shares, transactional mail included. Nothing in the send path
 * could have stopped it, because there was nothing to stop it with. These are
 * the stops.
 *
 * THE CAP IS A CEILING, NEVER A TARGET. A run that would exceed the day's
 * remaining allowance is truncated to it and the remainder waits for tomorrow,
 * engaged recipients first. Nothing here ever rounds up, borrows from tomorrow,
 * or treats a spent day as an error.
 *
 * Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 5.1.
 */

/** The one domain this policy governs. Not the apex, deliberately (section 4). */
export const BULK_DOMAIN = 'rrmacademy.com';

/**
 * Days since the domain's first send -> that day's ceiling. `throughDay` is
 * INCLUSIVE, and day 1 is the calendar day of the first send itself.
 */
export const RAMP_TABLE = [
  { throughDay: 2, cap: 200 },
  { throughDay: 5, cap: 500 },
  { throughDay: 12, cap: 1000 },
  { throughDay: Infinity, cap: 1500 },
];

/** Google's published line is 0.3%; the breaker trips first, on purpose. */
export const COMPLAINT_RATE_LIMIT = 0.002;
export const BOUNCE_RATE_LIMIT = 0.02;

/**
 * The breaker refuses to judge a ratio on fewer than this many sends in the
 * trailing 24 hours. This is deliberate fail-open on a tiny sample, not a gap:
 * one complaint out of three is 33% and means nothing, and a breaker that
 * paused on it would make the first hour of every warm-up day unusable. The
 * daily Postmaster reading (section 7, the bulk-mail-health daemon) is the
 * backstop for exactly those first hours.
 */
export const BREAKER_MIN_SAMPLE = 50;

/** send_paused.reason values. The observatory daemon greps for these strings. */
export const PAUSE_COMPLAINT_RATE = 'complaint-rate';
export const PAUSE_BOUNCE_RATE = 'bounce-rate';
export const PAUSE_LOG_WRITE_FAILED = 'log-write-failed';

/**
 * The cohort ORDER BY, as the exact text send.js splices into its query.
 *
 * It lives here, next to compareCohort(), so the SQL and the comparator cannot
 * drift: a test asserts both name the same five keys in the same order. The
 * alias `s` is newsletter_subscriber in send.js's bulk query.
 *
 * NULLs sort LAST on every engagement key because SQLite treats NULL as the
 * smallest value and these are all DESC. That is the behaviour wanted: a
 * subscriber we have never sent to is not "most engaged".
 *
 * last_clicked_at and last_opened_at are never written under this build --
 * _template.js removed the open pixel and the click wrapping to keep newsletter
 * mail out of Gmail's Promotions tab, so open.js and click.js have no live
 * caller. They stay in the ORDER BY for when tracking returns; until then the
 * effective order is source, then last_sent_at, then subscribed_at.
 */
export const COHORT_ORDER_SQL = [
  "CASE WHEN s.source = 'website' THEN 0 ELSE 1 END ASC",
  's.last_clicked_at DESC',
  's.last_opened_at DESC',
  's.last_sent_at DESC',
  's.subscribed_at DESC',
  's.id ASC',
].join(', ');

/** The UTC calendar date of an ISO timestamp, 'YYYY-MM-DD'. */
export function utcDay(nowIso) {
  return new Date(nowIso).toISOString().slice(0, 10);
}

/**
 * Days since the first send, 1-based, counted in UTC CALENDAR DAYS rather than
 * elapsed hours. A first send at 23:00 and a run at 01:00 the next morning is
 * day 2, two hours later, because the cap is a per-calendar-day budget and the
 * counter it is compared against resets on the same boundary. Counting elapsed
 * hours would let a late-evening start spend day 1's cap twice.
 */
export function domainAgeDays(firstSendAt, nowIso) {
  const first = Date.parse(`${utcDay(firstSendAt)}T00:00:00.000Z`);
  const today = Date.parse(`${utcDay(nowIso)}T00:00:00.000Z`);
  return Math.floor((today - first) / 86400000) + 1;
}

/** The ceiling for a domain of this age. */
export function dailyCap(ageDays) {
  for (const band of RAMP_TABLE) {
    if (ageDays <= band.throughDay) return band.cap;
  }
  return RAMP_TABLE[RAMP_TABLE.length - 1].cap;
}

/**
 * What this run may send, from the mail_domain_state row and the clock.
 *
 * `state` is the row, or null when there is none. A null row -- or a row whose
 * first_send_at is NULL -- BLOCKS: the domain has never sent, and nothing
 * should compute a "days since first send" against a fact that does not exist.
 * The CLI's --first-send flag is the only thing that creates it, in its own D1
 * write before any recipient is touched.
 *
 * A stored `day` that is not today means the counter belongs to a finished day,
 * so today's spend is 0. A spent day is `ok: true` with `remaining: 0`: it is a
 * real answer the caller reports, not an error it retries.
 */
export function remainingAllowance(state, nowIso) {
  const blocked = {
    ok: false, reason: 'first-send-not-recorded', ageDays: null, cap: 0, sentToday: 0, remaining: 0,
  };
  if (!state || !state.first_send_at) return blocked;
  const ageDays = domainAgeDays(state.first_send_at, nowIso);
  const cap = dailyCap(ageDays);
  const sentToday = state.day === utcDay(nowIso) ? Number(state.sent_today) || 0 : 0;
  return {
    ok: true,
    reason: null,
    ageDays,
    cap,
    sentToday,
    remaining: Math.max(0, cap - sentToday),
  };
}

/**
 * Cut an ordered cohort down to the day's allowance. The caller has already
 * ordered it, so the head is the engaged head and the tail is what waits.
 */
export function truncateToAllowance(recipients, remaining) {
  const room = Math.max(0, Number(remaining) || 0);
  const send = recipients.slice(0, room);
  return { send, deferred: recipients.length - send.length };
}

/** DESC with NULLs last, which is what SQLite does for `<col> DESC`. */
function descNullsLast(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a > b) return -1;
  if (a < b) return 1;
  return 0;
}

/**
 * The JS mirror of COHORT_ORDER_SQL. Used by tests, and by any caller that has
 * to order a cohort it did not get from SQL.
 */
export function compareCohort(a, b) {
  const web = (r) => (r.source === 'website' ? 0 : 1);
  const bySource = web(a) - web(b);
  if (bySource !== 0) return bySource;
  for (const key of ['last_clicked_at', 'last_opened_at', 'last_sent_at', 'subscribed_at']) {
    const c = descNullsLast(a[key], b[key]);
    if (c !== 0) return c;
  }
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * The trailing-24h verdict. Complaints are checked before bounces because a
 * complaint is the harm Postmaster reports and the one that costs the domain
 * its standing; a bounce is list hygiene. Both are reported in `detail` either
 * way, so send_paused records why, not merely that.
 */
export function breakerVerdict({ sent, complained, bounced }) {
  const s = Number(sent) || 0;
  const c = Number(complained) || 0;
  const b = Number(bounced) || 0;
  const pct = (n) => (s === 0 ? '0.000' : ((n / s) * 100).toFixed(3));
  const detail = `${s} sent, ${c} complaints (${pct(c)}%), ${b} hard bounces (${pct(b)}%) in the trailing 24h`;
  if (s < BREAKER_MIN_SAMPLE) {
    return { tripped: false, reason: null, detail: `${detail}; below the ${BREAKER_MIN_SAMPLE}-send minimum sample` };
  }
  if (c / s >= COMPLAINT_RATE_LIMIT) return { tripped: true, reason: PAUSE_COMPLAINT_RATE, detail };
  if (b / s >= BOUNCE_RATE_LIMIT) return { tripped: true, reason: PAUSE_BOUNCE_RATE, detail };
  return { tripped: false, reason: null, detail };
}

/** One header-safe token: lowercase, [a-z0-9-] only, collapsed, clamped. */
function headerToken(value, fallback) {
  const t = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return t || fallback;
}

/**
 * `Feedback-ID: <campaign>:<segment>:rrma:rrmacademy.com`, which is what makes
 * Postmaster's Feedback Loop dashboard report a complaint rate PER CAMPAIGN
 * instead of one undifferentiated domain number.
 *
 * Both caller-supplied parts are reduced to [a-z0-9-], so the value can carry
 * neither a colon (which would invent a fifth field) nor a CR or LF (which
 * would split the header). The sanitising is here rather than at the call site
 * because this function is the only place the header's shape is known.
 */
export function feedbackId(campaign, segment) {
  return `${headerToken(campaign, 'campaign')}:${headerToken(segment, 'all')}:rrma:${BULK_DOMAIN}`;
}

/**
 * A campaign key is a lowercase slug of 2 to 64 characters. It is used as a
 * LIKE prefix against email_log.source and as a Feedback-ID part, so it is
 * validated at the boundary rather than sanitised silently: a caller that
 * mistypes a campaign must be told, not quietly given a different cohort's
 * already-sent set.
 */
export function isCampaignKey(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(value);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/newsletter-policy.test.js
```

Expected: PASS, 0 failing, across all describe blocks.

- [ ] **Step 5: MUTATION PROOF -- "the breaker never trips"**

Re-introduce the defect in `functions/api/newsletter/_policy.js`, replacing the two threshold lines in `breakerVerdict` with:

```js
  if (c / s > COMPLAINT_RATE_LIMIT) return { tripped: true, reason: PAUSE_COMPLAINT_RATE, detail };
  if (b / s > BOUNCE_RATE_LIMIT) return { tripped: true, reason: PAUSE_BOUNCE_RATE, detail };
```

That is the whole defect: `>` where the spec says `>=`, so a rate sitting exactly on the line sails through. Run:

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/newsletter-policy.test.js
```

Expected: FAIL, and specifically these three by name -- `trips at exactly 0.2% complaints`, `trips at exactly 2% hard bounces`, `trips at the minimum sample exactly, not one send later`. If the suite stays green, the tests are decoration; fix them before restoring.

- [ ] **Step 6: Restore, and confirm the file is byte-clean**

```bash
cd ~/iCode/projects/rrm-academy-cf && git diff --stat functions/api/newsletter/_policy.js
```

Restore the two `>=` comparisons, then re-run the command. Expected: no output at all from `git diff --stat` against the staged/working copy you intend to commit, and:

```bash
node --test test/newsletter-policy.test.js
```

Expected: PASS, 0 failing.

- [ ] **Step 7: MUTATION PROOF -- "the cap is ignored"**

Re-introduce the defect, replacing `truncateToAllowance`'s body with:

```js
export function truncateToAllowance(recipients, remaining) {
  return { send: recipients, deferred: 0 };
}
```

That is the shape of the original incident: a run that computes an allowance, reports it, and then sends the whole cohort anyway. Run:

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/newsletter-policy.test.js
```

Expected: FAIL, and specifically `is a ceiling, never a target: the remainder is left for the next day`, `sends nothing when the day has no allowance left`, and `treats a negative allowance as zero`.

- [ ] **Step 8: Restore and confirm green**

Put the real `truncateToAllowance` back, then:

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/newsletter-policy.test.js && git diff --stat functions/api/newsletter/_policy.js
```

Expected: PASS, 0 failing, and no unintended diff.

- [ ] **Step 9: Run the repo's static gates over the new file**

```bash
cd ~/iCode/projects/rrm-academy-cf && npm run lint && npm run gates:sql
```

Expected: eslint clean; `gates:sql` passes (the module contains no SQL, so the PREPARED count is unchanged).

- [ ] **Step 10: Commit**

```bash
cd ~/iCode/projects/rrm-academy-cf
cat > /tmp/rac-commit.txt <<'MSG'
newsletter: the bulk rail's warm-up policy, as pure functions

functions/api/newsletter/_policy.js imports nothing, touches no
binding, and never reads a clock: every function that needs the time
takes nowIso. That is what lets the ramp table, the UTC day boundary and
the breaker thresholds be asserted at their exact boundary values.

What it decides: the ramp cap by domain age (200/500/1000/1500), the
day's remaining allowance from mail_domain_state, truncation to that
allowance (a ceiling, never a target -- the remainder waits for
tomorrow), the first-send gate (a missing row BLOCKS rather than
computing a day count against a fact that does not exist), the
trailing-24h complaint and bounce breaker with its deliberate
fail-open below 50 sends, the cohort order with NULLs last, and a
Feedback-ID that can carry neither a colon nor a newline.

Mutation-proved both ways before committing: `>` for `>=` in the
breaker reddens three named tests, and a truncateToAllowance that
returns the whole cohort reddens three more.

Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 5.1

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git add functions/api/newsletter/_policy.js test/newsletter-policy.test.js
git commit -F /tmp/rac-commit.txt
```

---

## Task 4: The `mailto:` alternative in `unsubscribeHeaders`, and the unsubscribe round trip

`unsubscribeHeaders()` emits only the `https:` form today. RFC 8058 allows a header to carry several alternatives; the `https:` URI must stay FIRST because it is the one `List-Unsubscribe-Post: List-Unsubscribe=One-Click` refers to. The mailto goes to `administrator@rrmacademy.org`, which spec section 3 already names as the monitored inbox on both lanes.

**Dispatch the `coder` agent for the implementation step.**

**Files:**
- Modify: `functions/api/newsletter/_tracking.js:48-55` (`unsubscribeHeaders`)
- Test: `test/newsletter-unsubscribe-roundtrip.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `UNSUBSCRIBE_MAILTO: string` -- new named export of `_tracking.js`, value `'administrator@rrmacademy.org'`.
  - `unsubscribeHeaders(email: string, secret: string): Promise<{ 'List-Unsubscribe': string, 'List-Unsubscribe-Post': string }>` -- unchanged signature; the `List-Unsubscribe` value is now `<https://...>, <mailto:administrator@rrmacademy.org?subject=unsubscribe>`.

- [ ] **Step 1: Write the failing test**

Create `test/newsletter-unsubscribe-roundtrip.test.js`:

```js
/**
 * EXECUTED tests for the unsubscribe header and its round trip.
 *
 * The header half is new in the bulk rail build: RFC 8058 one-click stays the
 * primary, and a mailto alternative is appended for the clients that only
 * honour that form. The order is load-bearing -- List-Unsubscribe-Post refers
 * to the FIRST URI, so a mailto in front of the https would turn one-click into
 * a mail composer.
 *
 * The round-trip half runs the real endpoint against a REAL SQLite engine, so
 * "the token verifies and the status flips" is the engine's answer, not a
 * canned row. Both the one-click POST and the footer-link GET are exercised,
 * because Gmail uses the first and a human uses the second and only one of them
 * had a test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './_d1-sqlite.mjs';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { unsubscribeHeaders, unsubscribeUrl, hmacToken, UNSUBSCRIBE_MAILTO } from '../functions/api/newsletter/_tracking.js';
import { onRequestPost, onRequestGet } from '../functions/api/newsletter/unsubscribe.js';

const SECRET = 'test-newsletter-secret';

function seedSubscriber(db, { id, email, status = 'active' }) {
  return db.prepare(
    "INSERT INTO newsletter_subscriber (id, email, status, source) VALUES (?, ?, ?, 'website')"
  ).bind(id, email, status).run();
}

describe('unsubscribeHeaders', () => {
  it('keeps the https one-click URI FIRST and appends the mailto alternative', async () => {
    const h = await unsubscribeHeaders('reader@example.com', SECRET);
    assert.equal(h['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    const parts = h['List-Unsubscribe'].split(', ');
    assert.equal(parts.length, 2);
    assert.match(parts[0], /^<https:\/\/rrmacademy\.org\/api\/newsletter\/unsubscribe\?/);
    assert.equal(parts[1], `<mailto:${UNSUBSCRIBE_MAILTO}?subject=unsubscribe>`);
  });

  it('names the monitored inbox, which is the same address both lanes reply to', () => {
    assert.equal(UNSUBSCRIBE_MAILTO, 'administrator@rrmacademy.org');
  });

  it('still carries a token the endpoint verifies', async () => {
    const url = await unsubscribeUrl('reader@example.com', SECRET);
    const h = await unsubscribeHeaders('reader@example.com', SECRET);
    assert.ok(h['List-Unsubscribe'].includes(url), 'the header URI is the same URL the footer link uses');
  });
});

describe('the unsubscribe round trip', () => {
  it('one-click POST flips the subscriber to unsubscribed and logs it', async () => {
    const db = sqliteD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'Reader@Example.com' });
    const token = await hmacToken('reader@example.com', SECRET);
    const req = mockRequest('POST', {
      url: `https://rrmacademy.org/api/newsletter/unsubscribe?e=${encodeURIComponent('reader@example.com')}&t=${token}`,
    });
    const res = await onRequestPost({ request: req, env: mockEnv({ DB: db, NEWSLETTER_SECRET: SECRET }), waitUntil: mockWaitUntil() });
    assert.equal(res.status, 200);
    const row = await db.prepare('SELECT status, unsubscribed_at FROM newsletter_subscriber WHERE id = ?').bind('sub-1').first();
    assert.equal(row.status, 'unsubscribed');
    assert.ok(row.unsubscribed_at, 'unsubscribed_at is stamped');
    const logged = await db.prepare("SELECT event, source FROM email_log WHERE email = ? COLLATE NOCASE").bind('reader@example.com').first();
    assert.equal(logged.event, 'unsubscribed');
    assert.equal(logged.source, 'newsletter/unsubscribe');
  });

  it('the footer-link GET flips the same subscriber and renders a confirmation', async () => {
    const db = sqliteD1();
    await seedSubscriber(db, { id: 'sub-2', email: 'other@example.com' });
    const token = await hmacToken('other@example.com', SECRET);
    const req = mockRequest('GET', {
      url: `https://rrmacademy.org/api/newsletter/unsubscribe?e=${encodeURIComponent('other@example.com')}&t=${token}`,
    });
    const res = await onRequestGet({ request: req, env: mockEnv({ DB: db, NEWSLETTER_SECRET: SECRET }), waitUntil: mockWaitUntil() });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 200);
    assert.match(body, /You've been unsubscribed/);
    const row = await db.prepare('SELECT status FROM newsletter_subscriber WHERE id = ?').bind('sub-2').first();
    assert.equal(row.status, 'unsubscribed');
  });

  it('a forged token changes nothing', async () => {
    const db = sqliteD1();
    await seedSubscriber(db, { id: 'sub-3', email: 'safe@example.com' });
    const req = mockRequest('POST', {
      url: 'https://rrmacademy.org/api/newsletter/unsubscribe?e=safe%40example.com&t=deadbeef',
    });
    const res = await onRequestPost({ request: req, env: mockEnv({ DB: db, NEWSLETTER_SECRET: SECRET }), waitUntil: mockWaitUntil() });
    assert.equal(res.status, 400);
    const row = await db.prepare('SELECT status FROM newsletter_subscriber WHERE id = ?').bind('sub-3').first();
    assert.equal(row.status, 'active');
  });

  it('the unsubscribe is a status UPDATE, never a DELETE (CAN-SPAM)', async () => {
    const db = sqliteD1();
    await seedSubscriber(db, { id: 'sub-4', email: 'kept@example.com' });
    const token = await hmacToken('kept@example.com', SECRET);
    const req = mockRequest('POST', {
      url: `https://rrmacademy.org/api/newsletter/unsubscribe?e=${encodeURIComponent('kept@example.com')}&t=${token}`,
    });
    await onRequestPost({ request: req, env: mockEnv({ DB: db, NEWSLETTER_SECRET: SECRET }), waitUntil: mockWaitUntil() });
    const count = await db.prepare('SELECT COUNT(*) AS c FROM newsletter_subscriber WHERE id = ?').bind('sub-4').first();
    assert.equal(count.c, 1, 'the row survives; only its status changed');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/newsletter-unsubscribe-roundtrip.test.js
```

Expected: FAIL. The first two `unsubscribeHeaders` tests fail on the missing `UNSUBSCRIBE_MAILTO` export (`undefined`) and on `parts.length` being 1, not 2. The round-trip tests pass already; that is fine, they are the regression net for the header change.

- [ ] **Step 3: Implement (dispatch the `coder` agent)**

Dispatch `subagent_type: "coder"` with: "In rrm-academy-cf, modify `functions/api/newsletter/_tracking.js` only. Add the `UNSUBSCRIBE_MAILTO` export and rewrite `unsubscribeHeaders` exactly as below. Change nothing else in the file." Hand it:

```js
/**
 * The monitored inbox a mailto unsubscribe reaches. Spec section 3 names it as
 * the Reply-To on BOTH lanes, so it is already a mailbox a human reads; a
 * mailto alternative pointing anywhere else would be an opt-out request nobody
 * sees, which is the failure the 2026-06-30 send already paid for once.
 */
export const UNSUBSCRIBE_MAILTO = 'administrator@rrmacademy.org';

/**
 * RFC 8058 one-click, plus a mailto alternative.
 *
 * ORDER IS LOAD-BEARING. `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * refers to the FIRST URI in the header, so the https form must stay in front.
 * Put the mailto first and a Gmail one-click would open a mail composer instead
 * of POSTing, which reads to the user as a broken unsubscribe and to Google as
 * an unhonoured one.
 *
 * The mailto is an ALTERNATIVE, not a replacement: the https endpoint is what
 * honours the request immediately, in code. A mailto arrival is handled by a
 * human at administrator@, same day, well inside CAN-SPAM's ten business days.
 */
export async function unsubscribeHeaders(email, secret) {
  const url = await unsubscribeUrl(email, secret);
  return {
    'List-Unsubscribe': `<${url}>, <mailto:${UNSUBSCRIBE_MAILTO}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/newsletter-unsubscribe-roundtrip.test.js
```

Expected: PASS, 0 failing.

- [ ] **Step 5: Run every suite that renders a newsletter header**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/newsletter-send.test.js test/send-first-email.test.js test/subscribe-emails.test.js test/_mail.test.js
```

Expected: PASS, 0 failing. Any assertion that pinned the old single-URI header value is a real break to fix here, not to suppress.

- [ ] **Step 6: Commit**

```bash
cd ~/iCode/projects/rrm-academy-cf
cat > /tmp/rac-commit.txt <<'MSG'
newsletter: append the mailto alternative to List-Unsubscribe

RFC 8058 one-click stays FIRST, because List-Unsubscribe-Post refers to
the first URI in the header: a mailto in front would turn a Gmail
one-click into a mail composer, which reads to the user as a broken
unsubscribe and to Google as an unhonoured one.

The mailto goes to administrator@rrmacademy.org, which is already the
Reply-To on both lanes and therefore already a mailbox a human reads. A
mailto alternative pointing at an unread address is an opt-out nobody
sees, which the 2026-06-30 send already paid for once.

Adds test/newsletter-unsubscribe-roundtrip.test.js: header order and
shape, plus the one-click POST and the footer-link GET both flipping
status against a real SQLite engine, a forged token changing nothing,
and the CAN-SPAM invariant that the row survives.

Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 5.3

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git add functions/api/newsletter/_tracking.js test/newsletter-unsubscribe-roundtrip.test.js
git commit -F /tmp/rac-commit.txt
```

---

## Task 5: `preflightLane()` in `_ses.js` -- the refusal that writes nothing

`functions/api/_ses.js` is this repo's ONE boundary onto `vendor/mail`. The bulk path needs to ask "would this From be admitted?" before it touches a recipient row, and the honest place for that question is here, not a second import of `vendor/mail` from `send.js`.

Why a preflight at all, in the spec's words: `send.js` writes `newsletter_event(event='sent')` BEFORE calling SES, by design, so a genuine SES failure mid-batch is preferred false-positive-sent over a double-send. A lane refusal is not that kind of failure. It is certain and total, not a per-recipient SES error, and it is wrong for it to mark even one recipient sent.

`_ses.js` is guarded (`guard-manifest.json`), so this task ends with `npm run guard:update`.

**Dispatch the `coder` agent for the implementation step.**

**Files:**
- Modify: `functions/api/_ses.js` (add two exports near `sanitizeHeader`; the `LaneRefused` re-export sits beside the existing `export { MailPermanent }` at the foot of the file)
- Modify: `guard-manifest.json` (regenerated by `npm run guard:update`, never hand-edited)
- Test: `test/ses-adapter.test.js` (append)

**Interfaces:**
- Consumes: Task 0's admission of `newsletter@rrmacademy.com` in `vendor/mail/lanes.js`.
- Produces, as named exports of `functions/api/_ses.js`:
  - `preflightLane({ from: string, category?: string, purpose?: string }): string` -- returns the resolved lane name (`'ses_rrm'` for the bulk From); throws `LaneRefused` when no lane may carry it. Pure: no network, no D1, no env.
  - `LaneRefused` -- re-exported from `vendor/mail/index.js` so callers can `catch (err) { if (err instanceof LaneRefused) ... }` without importing `vendor/mail` themselves.

- [ ] **Step 1: Write the failing test**

Append to `test/ses-adapter.test.js`:

```js
// ---------------------------------------------------------------------------
// preflightLane -- the question the bulk path asks BEFORE it touches a row.
//
// send.js marks a recipient sent before calling SES, deliberately (a
// false-positive sent beats a double-send on an SES flake). A lane refusal is
// not that kind of failure: it is certain and total, so it must be discovered
// before the first newsletter_event row exists, not after eighty of them do.
// ---------------------------------------------------------------------------
import { preflightLane, LaneRefused } from '../functions/api/_ses.js';

describe('preflightLane', () => {
  it('admits the bulk From on the newsletter category', () => {
    assert.equal(
      preflightLane({ from: '"Dr. Naomi Whittaker, RRM Academy" <newsletter@rrmacademy.com>', category: 'newsletter' }),
      'ses_rrm',
    );
  });

  it('admits the existing newsletter sender, unchanged', () => {
    assert.equal(
      preflightLane({ from: '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>', category: 'newsletter' }),
      'ses_rrm',
    );
  });

  it('refuses a typo on the bulk domain with the exemption reason, not a generic error', () => {
    let caught = null;
    try {
      preflightLane({ from: 'newsletters@rrmacademy.com', category: 'newsletter' });
    } catch (err) { caught = err; }
    assert.ok(caught instanceof LaneRefused);
    assert.equal(caught.reason, 'exemption-sender-not-allowed');
  });

  it('refuses a foreign domain', () => {
    assert.throws(
      () => preflightLane({ from: 'naomi@whittaker.ai', category: 'newsletter' }),
      (err) => err instanceof LaneRefused && err.reason === 'exemption-sender-not-allowed',
    );
  });

  it('refuses an empty or malformed from address instead of resolving something', () => {
    assert.throws(() => preflightLane({ from: '', category: 'newsletter' }), LaneRefused);
    assert.throws(() => preflightLane({ from: 'not-an-address', category: 'newsletter' }), LaneRefused);
  });

  it('is pure: it neither sends nor logs', async () => {
    const before = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error('preflightLane must not fetch'); };
    try {
      preflightLane({ from: 'newsletter@rrmacademy.com', category: 'newsletter' });
    } finally {
      globalThis.fetch = before;
    }
    assert.equal(called, false);
  });
});
```

If `test/ses-adapter.test.js` already imports `describe`, `it` and `assert` at the top, drop the duplicate imports and keep only the new `preflightLane` import line.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/ses-adapter.test.js
```

Expected: FAIL with `SyntaxError: The requested module '../functions/api/_ses.js' does not provide an export named 'preflightLane'`.

- [ ] **Step 3: Implement (dispatch the `coder` agent)**

Dispatch `subagent_type: "coder"` with: "In rrm-academy-cf, modify `functions/api/_ses.js` only. It is a guarded file: change nothing except adding the import of `resolveLane` and `LaneRefused` from `vendor/mail/index.js`, the `preflightLane` export, and the `LaneRefused` re-export. Do not touch `sendEmail`, `sendRawEmail`, `insertEmailLog`, `logEmailFailure`, `depsFor`, `purposeOf` or `unwrap`." Hand it:

Change the vendor import line from:

```js
import { send, MailPermanent } from '../../vendor/mail/index.js';
```

to:

```js
import { send, MailPermanent, LaneRefused, resolveLane } from '../../vendor/mail/index.js';
```

Add, immediately after `purposeOf()`:

```js
/**
 * WOULD THIS FROM BE ADMITTED? Asked before a run touches a single row.
 *
 * `send.js` records send intent -- a `newsletter_event(event='sent')` row and a
 * `last_sent_at` stamp -- BEFORE it calls SES, deliberately: on an SES flake a
 * false-positive "sent" beats a double-send, because the recipient is skipped
 * on retry rather than mailed twice. A LANE REFUSAL is not that kind of
 * failure. It is certain, total and per-run rather than per-recipient, so
 * discovering it inside the batch loop would mark a page of recipients sent for
 * mail that never left, and every one of them would be skipped forever after.
 *
 * So the bulk path asks here first. This function resolves the lane and nothing
 * else: no network, no D1, no env, no telemetry. It throws `LaneRefused` (also
 * re-exported below), which the caller turns into a 4xx with no writes at all.
 *
 * The argument shape mirrors `sendRawEmail`'s `log` block on purpose, so the
 * preflight and the send that follows it cannot be asking about different
 * things: pass the same `from` and the same `category`.
 *
 * @param {{ from: string, category?: string, purpose?: string }} msg
 * @returns {string} the resolved lane name, e.g. 'ses_rrm'
 * @throws {LaneRefused}
 */
export function preflightLane({ from, category, purpose }) {
  return resolveLane({ entity: ENTITY, ...purposeOf({ purpose, category }), from });
}
```

And change the final line of the file from:

```js
export { MailPermanent };
```

to:

```js
export { MailPermanent, LaneRefused };
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/ses-adapter.test.js test/_mail.test.js test/mail-lanes.test.js
```

Expected: PASS, 0 failing.

- [ ] **Step 5: Re-hash the guard manifest and verify**

```bash
cd ~/iCode/projects/rrm-academy-cf && npm run guard:update && npm run guard
```

Expected: `guard:update` rewrites the `functions/api/_ses.js` hash in `guard-manifest.json`; `npm run guard` exits 0 with every invariant satisfied. If `guard` reports a security-invariant failure rather than a hash mismatch, the edit went beyond its brief; revert and redo Step 3.

- [ ] **Step 6: Commit**

```bash
cd ~/iCode/projects/rrm-academy-cf
cat > /tmp/rac-commit.txt <<'MSG'
_ses: export preflightLane, the refusal that writes nothing

send.js records send intent before calling SES on purpose: on an SES
flake a false-positive "sent" beats a double-send, because the
recipient is skipped on retry rather than mailed twice. A LANE REFUSAL
is not that kind of failure. It is certain, total and per-run rather
than per-recipient, so discovering it inside the batch loop would mark
a page of recipients sent for mail that never left, and every one of
them would be skipped forever after.

preflightLane() is the question asked first. It resolves the lane and
nothing else: no network, no D1, no env, no telemetry. LaneRefused is
re-exported alongside it so callers can catch it by type without
importing vendor/mail themselves -- this file stays the repo's one
boundary onto the vendored package.

guard-manifest.json re-hashed via npm run guard:update.

Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 5.0, "Pre-mark hazard"

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git add functions/api/_ses.js guard-manifest.json test/ses-adapter.test.js
git commit -F /tmp/rac-commit.txt
```

---

## Task 6: The bulk path in `send.js`

The single entry for bulk is the endpoint that already exists. It gains a second path, selected by `lane: 'bulk'` in the request body, and the legacy path is left EXACTLY as it is: its drivers are live, and silently narrowing their audience with a membership join nobody asked for would be a change with no spec mandate. The membership exclusion is the BULK audience's rule (spec section 3 routes members to the Warm lane), so it is scoped to the bulk path and said out loud in the code.

Three design decisions this task locks in, each because the alternative is worse:

1. **The bulk path does not use the `id` cursor.** Cohort ordering is by engagement, and an `id > ?` cursor can only paginate an `id ASC` order. It does not need one: already-sent recipients are excluded by the `email_log` campaign query and the `newsletter_event` guard, so each successive call naturally advances. A bulk request carrying `cursor` is refused `400 bulk_cursor_unsupported` rather than silently ordering by id.
2. **The bulk path writes its own `email_log` row.** `insertEmailLog()` swallows D1 failures on purpose, and the spec requires the `sent_today` increment to ride in the SAME batch as that insert, with a failure PAUSING the run. So the bulk send calls `sendRawEmail` with no `log` block and does the batch itself, which is also what lets it bind the real `ses_message_id`.
3. **The breaker's two time bounds are different formats, deliberately.** `email_log.created_at` is `datetime('now')` (`YYYY-MM-DD HH:MM:SS`); `email_event.ts` is an SES ISO 8601 timestamp (`YYYY-MM-DDTHH:MM:SS.sssZ`). A single bound would compare across the `' '` vs `'T'` at offset 10, and `' '` sorts below `'T'`, so a `datetime('now','-24 hours')` bound against `ts` would silently widen the complaint window. The sends bound is SQL-computed; the events bound is a JS ISO string.

**Dispatch the `coder` agent for the implementation step.** `send.js` is guarded, so this task ends with `npm run guard:update`.

**Files:**
- Modify: `functions/api/newsletter/send.js` (new imports at the head; a new `onRequestPost` branch and its helpers; the legacy body below `const db = env.DB;` untouched)
- Modify: `guard-manifest.json` (regenerated)
- Test: `test/newsletter-bulk-send.test.js`

**Interfaces:**
- Consumes:
  - `preflightLane({ from, category })` and `LaneRefused` from `functions/api/_ses.js` (Task 5).
  - `sendRawEmail(env, { from, to, subject, html, text, replyTo, headers, configurationSet, log })` from `functions/api/_ses.js` (unchanged, existing).
  - From `functions/api/newsletter/_policy.js` (Task 3): `remainingAllowance`, `truncateToAllowance`, `breakerVerdict`, `feedbackId`, `isCampaignKey`, `COHORT_ORDER_SQL`, `BULK_DOMAIN`, `PAUSE_LOG_WRITE_FAILED`.
  - `renderEmail({ body, sendId, subscriberId, email, secret })` from `./_template.js` (unchanged, existing).
  - `unsubscribeHeaders(email, secret)` from `./_tracking.js` (Task 4).
  - Tables `mail_domain_state` and `send_paused` (Task 2).
- Produces:
  - `POST /api/newsletter/send` accepts three new body fields: `lane` (`'bulk'`), `campaign` (a campaign key), `firstSend` (boolean) and `resume` (boolean).
  - Response on the bulk path: `{ ok, done, sendId, campaign, lane: 'bulk', sent, deferred, remainingToday, cap, ageDays, dryRun }`.
  - Refusal codes the CLI branches on: `bulk_campaign_required`, `bulk_cursor_unsupported`, `bulk_from_not_configured`, `bulk_lane_refused`, `bulk_first_send_required`, `bulk_paused`, `bulk_cap_exhausted`.
  - `email_log` rows with `category = 'newsletter'`, `source = 'newsletter/bulk/<campaign>'`, `event = 'send'`, `ses_message_id` bound.

- [ ] **Step 1: Write the failing tests**

Create `test/newsletter-bulk-send.test.js`:

```js
/**
 * EXECUTED tests for the bulk path of POST /api/newsletter/send.
 *
 * These run the REAL handler against a REAL SQLite engine carrying schema.sql
 * plus migration 041 (test/_bulk-mail-sqlite.mjs), with SES stubbed at
 * globalThis.fetch. That combination is what makes the assertions below mean
 * what their names say: the membership exclusion is a correlated subquery with
 * a COLLATE NOCASE comparison, the cohort order is an ORDER BY, and the
 * already-sent guard is a LIKE against email_log.source -- none of which a
 * substring-matching mock can decide.
 *
 * The load-bearing one is the first. A lane refusal must leave NOTHING behind:
 * no newsletter_event, no last_sent_at, no newsletter_send row. The endpoint
 * marks recipients sent before calling SES on purpose, so a refusal discovered
 * late would burn a page of recipients for mail that never left.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bulkMailD1 } from './_bulk-mail-sqlite.mjs';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { onRequestPost } from '../functions/api/newsletter/send.js';

const ADMIN = 'test-admin-secret';
const BULK_FROM = '"Dr. Naomi Whittaker, RRM Academy" <newsletter@rrmacademy.com>';

/** Captures every SESv2 request and answers 200 unless told otherwise. */
function stubSes({ answer } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = (input && typeof input === 'object' && input.url) ? input.url : String(input);
    if (!url.includes('amazonaws.com')) throw new Error(`unrouted fetch to ${url}`);
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (answer) return answer(calls.length, body);
    return new Response(JSON.stringify({ MessageId: `ses-${calls.length}` }), { status: 200 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

function env(db, over = {}) {
  return mockEnv({ DB: db, ADMIN_API_SECRET: ADMIN, NEWSLETTER_SECRET: 'nl-secret', BULK_FROM, ...over });
}

function post(body) {
  return mockRequest('POST', {
    body,
    headers: { Authorization: `Bearer ${ADMIN}` },
    url: 'https://rrmacademy.org/api/newsletter/send',
  });
}

async function call(db, body, over = {}) {
  const res = await onRequestPost({ request: post(body), env: env(db, over), waitUntil: mockWaitUntil() });
  return parseResponse(res);
}

async function seedSubscriber(db, { id, email, source = 'website', last_sent_at = null, subscribed_at = '2026-01-01 00:00:00' }) {
  await db.prepare(
    "INSERT INTO newsletter_subscriber (id, email, status, source, last_sent_at, subscribed_at) VALUES (?, ?, 'active', ?, ?, ?)"
  ).bind(id, email, source, last_sent_at, subscribed_at).run();
}

async function seedDomainState(db, { first_send_at, day, sent_today = 0 }) {
  await db.prepare(
    'INSERT INTO mail_domain_state (domain, first_send_at, day, sent_today) VALUES (?, ?, ?, ?)'
  ).bind('rrmacademy.com', first_send_at, day, sent_today).run();
}

/** Today's UTC date, which is what the handler's own clock will produce. */
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR_AGO = new Date(Date.now() - 400 * 86400000).toISOString();

const BODY = { lane: 'bulk', campaign: 'sept-letter', subject: 'The September letter', body: '<p>hello</p>' };

let ses;
before(() => { ses = stubSes(); });
after(() => { ses.restore(); });

describe('the lane preflight', () => {
  it('a refused From aborts with NO D1 writes at all', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 0 });
    const { status, body } = await call(db, { ...BODY, send: true }, { BULK_FROM: 'newsletters@rrmacademy.com' });
    assert.equal(status, 400);
    assert.equal(body.error, 'bulk_lane_refused');
    assert.equal(body.reason, 'exemption-sender-not-allowed');
    for (const table of ['newsletter_event', 'newsletter_send', 'email_log']) {
      const c = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first();
      assert.equal(c.c, 0, `${table} must be untouched by a refused run`);
    }
    const sub = await db.prepare('SELECT last_sent_at FROM newsletter_subscriber WHERE id = ?').bind('sub-1').first();
    assert.equal(sub.last_sent_at, null);
  });

  it('an unset BULK_FROM is a 503, not a fallback to the apex sender', async () => {
    const db = bulkMailD1();
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const { status, body } = await call(db, { ...BODY, send: true }, { BULK_FROM: undefined });
    assert.equal(status, 503);
    assert.equal(body.error, 'bulk_from_not_configured');
  });
});

describe('the first-send gate', () => {
  it('blocks when mail_domain_state has no row', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 409);
    assert.equal(body.error, 'bulk_first_send_required');
    const c = await db.prepare('SELECT COUNT(*) AS c FROM newsletter_event').first();
    assert.equal(c.c, 0);
  });

  it('firstSend creates the row in its own write, before any recipient is touched', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    const { status, body } = await call(db, { ...BODY, send: true, firstSend: true });
    assert.equal(status, 200);
    assert.equal(body.cap, 200, 'the same run proceeds under the day 1 cap');
    assert.equal(body.ageDays, 1);
    const row = await db.prepare("SELECT first_send_at, day, sent_today FROM mail_domain_state WHERE domain = 'rrmacademy.com'").first();
    assert.ok(row.first_send_at);
    assert.equal(row.day, TODAY);
    assert.equal(row.sent_today, 1);
  });

  it('firstSend on a domain that has already sent does not reset the age', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 0 });
    const { status, body } = await call(db, { ...BODY, send: true, firstSend: true });
    assert.equal(status, 200);
    assert.equal(body.cap, 1500, 'a year-old domain stays in the day 13+ band');
    const row = await db.prepare("SELECT first_send_at FROM mail_domain_state WHERE domain = 'rrmacademy.com'").first();
    assert.equal(row.first_send_at, YEAR_AGO);
  });
});

describe('membership routing (spec section 3)', () => {
  it('a paying member on wix_subscription.status=active is NOT in the bulk audience', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'Member@Example.com' });
    await seedSubscriber(db, { id: 'sub-2', email: 'stranger@example.com' });
    await db.prepare(
      "INSERT INTO wix_subscription (wix_subscription_id, contact_id, email, tier, amount_cents, status, started_at, last_order_at, product_id, product_source, updated_at) VALUES ('ws1','c1','member@example.com','core',500,'active','2026-01-01','2026-09-01','p','wix','2026-09-01')"
    ).run();
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 1);
    assert.equal(ses.calls.at(-1).body.Content.Raw ? true : true);
    const logged = await db.prepare("SELECT email FROM email_log WHERE source = 'newsletter/bulk/sept-letter'").all();
    assert.deepEqual(logged.results.map(r => r.email), ['stranger@example.com']);
  });

  it('a LAPSED member (status != active, membership_state set) IS in the bulk audience', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'lapsed@example.com' });
    await db.prepare(
      "INSERT INTO wix_subscription (wix_subscription_id, contact_id, email, tier, amount_cents, status, started_at, last_order_at, product_id, product_source, updated_at, membership_state) VALUES ('ws2','c2','lapsed@example.com','core',500,'inactive','2026-01-01','2026-06-01','p','wix','2026-06-01','expired_card')"
    ).run();
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 1, 'membership_state is a lapse REASON, never a status');
    const logged = await db.prepare("SELECT email FROM email_log WHERE source = 'newsletter/bulk/sept-letter'").first();
    assert.equal(logged.email, 'lapsed@example.com');
  });

  it('a contact tagged stuc:member is NOT in the bulk audience, case-insensitively', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'tagged@example.com' });
    await db.prepare("INSERT INTO contact (id, email) VALUES ('c3', 'Tagged@Example.com')").run();
    await db.prepare("INSERT INTO contact_tag (contact_id, tag) VALUES ('c3', 'stuc:member')").run();
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 0);
  });
});

describe('the cap and the cohort', () => {
  it('truncates to the day remaining allowance and reports the deferral', async () => {
    const db = bulkMailD1();
    for (let i = 0; i < 12; i++) await seedSubscriber(db, { id: `sub-${i}`, email: `r${i}@example.com` });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 1495 });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.cap, 1500);
    assert.equal(body.sent, 5);
    assert.equal(body.deferred, 7);
    assert.equal(body.remainingToday, 0);
    assert.equal(body.done, false, 'a deferral is not a finished campaign');
  });

  it('refuses outright when the day is already spent', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 1500 });
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 429);
    assert.equal(body.error, 'bulk_cap_exhausted');
    const c = await db.prepare('SELECT COUNT(*) AS c FROM newsletter_event').first();
    assert.equal(c.c, 0);
  });

  it('sends the engaged head first: website before import, recent before never', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-a', email: 'import-recent@example.com', source: 'import', last_sent_at: '2026-09-09 00:00:00' });
    await seedSubscriber(db, { id: 'sub-b', email: 'web-never@example.com', source: 'website', last_sent_at: null });
    await seedSubscriber(db, { id: 'sub-c', email: 'web-recent@example.com', source: 'website', last_sent_at: '2026-09-10 00:00:00' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 1498 });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 2);
    const logged = await db.prepare(
      "SELECT email FROM email_log WHERE source = 'newsletter/bulk/sept-letter' ORDER BY id ASC"
    ).all();
    assert.deepEqual(logged.results.map(r => r.email), ['web-recent@example.com', 'web-never@example.com']);
  });

  it('excludes anyone this campaign already sent to, across runs', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedSubscriber(db, { id: 'sub-2', email: 'b@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 0 });
    await db.prepare(
      "INSERT INTO email_log (event, email, category, source) VALUES ('send', 'a@example.com', 'newsletter', 'newsletter/bulk/sept-letter')"
    ).run();
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 1);
    const last = await db.prepare(
      "SELECT email FROM email_log WHERE source = 'newsletter/bulk/sept-letter' ORDER BY id DESC LIMIT 1"
    ).first();
    assert.equal(last.email, 'b@example.com');
  });

  it('excludes unsubscribed, bounced and complained subscribers', async () => {
    const db = bulkMailD1();
    for (const [i, status] of [['1', 'unsubscribed'], ['2', 'bounced'], ['3', 'complained']]) {
      await db.prepare(
        "INSERT INTO newsletter_subscriber (id, email, status, source) VALUES (?, ?, ?, 'website')"
      ).bind(`sub-${i}`, `s${i}@example.com`, status).run();
    }
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 0);
  });
});

describe('the message itself', () => {
  it('sends from BULK_FROM through the rrm-bulk configuration set with a Feedback-ID', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await call(db, { ...BODY, send: true });
    const sent = ses.calls.at(-1).body;
    assert.equal(sent.ConfigurationSetName, 'rrm-bulk');
    const raw = Buffer.from(sent.Content.Raw.Data, 'base64').toString('utf8');
    assert.match(raw, /^From: "Dr\. Naomi Whittaker, RRM Academy" <newsletter@rrmacademy\.com>$/m);
    assert.match(raw, /^Reply-To: administrator@rrmacademy\.org$/m);
    assert.match(raw, /^Feedback-ID: sept-letter:all:rrma:rrmacademy\.com$/m);
    assert.match(raw, /^List-Unsubscribe: <https:\/\/rrmacademy\.org\/api\/newsletter\/unsubscribe\?[^>]+>, <mailto:administrator@rrmacademy\.org\?subject=unsubscribe>$/m);
    assert.match(raw, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
  });

  it('names the segment in the Feedback-ID when the send is segmented', async () => {
    const db = bulkMailD1();
    await db.prepare(
      `INSERT INTO newsletter_subscriber (id, email, status, source, segments) VALUES ('sub-1','a@example.com','active','website','["donor"]')`
    ).run();
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await call(db, { ...BODY, send: true, segments: ['donor'] });
    const raw = Buffer.from(ses.calls.at(-1).body.Content.Raw.Data, 'base64').toString('utf8');
    assert.match(raw, /^Feedback-ID: sept-letter:donor:rrma:rrmacademy\.com$/m);
  });
});

describe('logging and the day counter', () => {
  it('writes email_log and increments sent_today in the same batch', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 7 });
    await call(db, { ...BODY, send: true });
    const log = await db.prepare("SELECT event, category, source, ses_message_id FROM email_log ORDER BY id DESC LIMIT 1").first();
    assert.equal(log.event, 'send');
    assert.equal(log.category, 'newsletter');
    assert.equal(log.source, 'newsletter/bulk/sept-letter');
    assert.match(log.ses_message_id, /^ses-/);
    const state = await db.prepare("SELECT sent_today FROM mail_domain_state WHERE domain = 'rrmacademy.com'").first();
    assert.equal(state.sent_today, 8);
  });

  it('a failed log batch PAUSES the run with reason log-write-failed', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedSubscriber(db, { id: 'sub-2', email: 'b@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const realBatch = db.batch.bind(db);
    let n = 0;
    db.batch = async (stmts) => {
      const isLogBatch = stmts.some(s => String(s._sql || '').includes('mail_domain_state'));
      if (isLogBatch && ++n === 1) throw new Error('D1_ERROR: network');
      return realBatch(stmts);
    };
    const { status, body } = await call(db, { ...BODY, send: true });
    db.batch = realBatch;
    assert.equal(status, 500);
    assert.equal(body.error, 'bulk_paused');
    assert.equal(body.reason, 'log-write-failed');
    const paused = await db.prepare("SELECT reason, resumed_at FROM send_paused WHERE campaign = 'sept-letter'").first();
    assert.equal(paused.reason, 'log-write-failed');
    assert.equal(paused.resumed_at, null);
    assert.equal(ses.calls.length >= 1, true, 'the message that was already accepted is NOT reclassified as unsent');
  });
});

describe('the circuit breaker', () => {
  async function seedTrailing(db, { sends, complaints }) {
    for (let i = 0; i < sends; i++) {
      await db.prepare(
        "INSERT INTO email_log (event, email, category, source, ses_message_id) VALUES ('send', ?, 'newsletter', 'newsletter/bulk/sept-letter', ?)"
      ).bind(`h${i}@example.com`, `msg-${i}`).run();
    }
    for (let i = 0; i < complaints; i++) {
      await db.prepare(
        "INSERT INTO email_event (id, ses_message_id, event_type, email, ts) VALUES (?, ?, 'complaint', ?, ?)"
      ).bind(`ev-${i}`, `msg-${i}`, `h${i}@example.com`, new Date().toISOString()).run();
    }
  }

  it('pauses before sending when the trailing 24h complaint rate is at the line', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-x', email: 'next@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedTrailing(db, { sends: 1000, complaints: 2 });
    const before = ses.calls.length;
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 423);
    assert.equal(body.error, 'bulk_paused');
    assert.equal(body.reason, 'complaint-rate');
    assert.equal(ses.calls.length, before, 'not one more message went out');
    const paused = await db.prepare("SELECT reason FROM send_paused WHERE campaign = 'sept-letter' AND resumed_at IS NULL").first();
    assert.equal(paused.reason, 'complaint-rate');
  });

  it('does not pause on a tiny sample, which is the deliberate fail-open', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-x', email: 'next@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedTrailing(db, { sends: 40, complaints: 40 });
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 200);
    assert.equal(body.sent, 1);
  });

  it('an OPEN send_paused row refuses every later run until --resume clears it', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-x', email: 'next@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await db.prepare(
      "INSERT INTO send_paused (id, campaign, reason, detail) VALUES ('sp-1','sept-letter','complaint-rate','seeded')"
    ).run();
    const refused = await call(db, { ...BODY, send: true });
    assert.equal(refused.status, 423);
    assert.equal(refused.body.error, 'bulk_paused');
    assert.equal(refused.body.reason, 'complaint-rate');
    const resumed = await call(db, { ...BODY, send: true, resume: true });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.sent, 1);
    const row = await db.prepare("SELECT resumed_at FROM send_paused WHERE id = 'sp-1'").first();
    assert.ok(row.resumed_at, 'resume stamps the row rather than deleting the history');
  });
});

describe('request validation', () => {
  it('refuses a bulk request with no campaign key', async () => {
    const db = bulkMailD1();
    const { status, body } = await call(db, { lane: 'bulk', subject: 's', body: 'b', send: true });
    assert.equal(status, 400);
    assert.equal(body.error, 'bulk_campaign_required');
  });

  it('refuses a campaign key that is not a lowercase slug', async () => {
    const db = bulkMailD1();
    for (const campaign of ['Sept Letter', 'sept letter', '-x', 'a', 'x'.repeat(65)]) {
      const { status, body } = await call(db, { ...BODY, campaign, send: true });
      assert.equal(status, 400, `${campaign} must be refused`);
      assert.equal(body.error, 'bulk_campaign_required');
    }
  });

  it('refuses a cursor on the bulk path rather than silently ordering by id', async () => {
    const db = bulkMailD1();
    const { status, body } = await call(db, { ...BODY, send: true, sendId: '0'.repeat(8), cursor: 'sub-1' });
    assert.equal(status, 400);
    assert.equal(body.error, 'bulk_cursor_unsupported');
  });

  it('is dry-run unless send:true, and a dry run touches nothing', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 3 });
    const before = ses.calls.length;
    const { status, body } = await call(db, BODY);
    assert.equal(status, 200);
    assert.equal(body.dryRun, true);
    assert.equal(body.sent, 0);
    assert.equal(body.wouldSend, 1);
    assert.equal(body.remainingToday, 1497);
    assert.equal(ses.calls.length, before);
    const c = await db.prepare('SELECT COUNT(*) AS c FROM newsletter_event').first();
    assert.equal(c.c, 0);
    const state = await db.prepare("SELECT sent_today FROM mail_domain_state WHERE domain = 'rrmacademy.com'").first();
    assert.equal(state.sent_today, 3, 'a dry run does not spend the day');
  });

  it('still requires the admin bearer', async () => {
    const db = bulkMailD1();
    const res = await onRequestPost({
      request: mockRequest('POST', { body: BODY, url: 'https://rrmacademy.org/api/newsletter/send' }),
      env: env(db),
      waitUntil: mockWaitUntil(),
    });
    assert.equal(res.status, 401);
  });

  it('leaves the legacy path alone: no lane field is the old behaviour', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'legacy@example.com' });
    const { status, body } = await call(db, { subject: 'legacy', body: '<p>x</p>' });
    assert.equal(status, 200);
    assert.equal(body.dryRun, undefined, 'the legacy path has no dry run and never gained one');
    assert.equal(body.sent, 1);
    const log = await db.prepare("SELECT source FROM email_log ORDER BY id DESC LIMIT 1").first();
    assert.equal(log.source, 'newsletter/send');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/newsletter-bulk-send.test.js
```

Expected: FAIL across every describe block. The bulk-specific ones fail because `lane: 'bulk'` is an unknown field the current handler ignores, so it takes the legacy path and answers `{ ok: true, done: true, sendId, cursor, sent, remaining }` with none of the asserted keys. `leaves the legacy path alone` passes already; that is the regression net.

- [ ] **Step 3: Implement the bulk path (dispatch the `coder` agent)**

Dispatch `subagent_type: "coder"` with: "In rrm-academy-cf, modify `functions/api/newsletter/send.js`. Read every sibling in `functions/api/newsletter/` first. Add the imports and the constants below, add `runBulkSend()` and its three helpers, and insert the single dispatch line into `onRequestPost` immediately after the `const db = env.DB;` statement. Change NOTHING below that line: the legacy path is live and its drivers depend on it byte for byte."

Add to the import block at the head of the file:

```js
import { sendRawEmail, preflightLane, LaneRefused } from '../_ses.js';
import {
  remainingAllowance, truncateToAllowance, breakerVerdict, feedbackId, isCampaignKey,
  COHORT_ORDER_SQL, BULK_DOMAIN, PAUSE_LOG_WRITE_FAILED,
} from './_policy.js';
```

(the existing `import { sendRawEmail } from '../_ses.js';` line is replaced by the first of these).

Add beside the existing `PAGE_SIZE` constants:

```js
/**
 * THE BULK LANE.
 *
 * A second path through this endpoint, selected by `lane: 'bulk'`. It exists
 * because the 2026-09-06 to 09-08 drip sent about 2,880 messages as
 * rrmacademy.org and put a 0.55% user-reported spam day on the domain in Google
 * Postmaster Tools -- above the 0.3% policy line -- flipping its Compliance
 * status to "Needs work", a verdict every transactional send from the domain
 * shares. Bulk now leaves from a separate registrable domain under a ramp
 * table, a per-UTC-day counter and a 24h complaint breaker.
 *
 * THE LEGACY PATH BELOW IS UNTOUCHED, deliberately. Its drivers are live, and
 * the membership exclusion this path applies is the BULK audience's rule (a
 * paying STUC member is routed to the Warm lane, spec section 3), not a new
 * rule for every newsletter send. Narrowing the legacy audience without a
 * mandate would be a silent cohort change nobody asked for.
 */
const BULK_CONFIGURATION_SET = 'rrm-bulk';
const BULK_REPLY_TO = 'administrator@rrmacademy.org';
/** Spec section 5.1: "Pacing is 1 to 2 s between SES calls." */
const BULK_PACING_MS = 1500;

/**
 * The bulk audience. Two correlated NOT EXISTS clauses implement spec section
 * 3's routing rule verbatim: a recipient is WARM when wix_subscription.status
 * is 'active' for that email (COLLATE NOCASE) OR a contact carries the
 * stuc:member tag, and everything else is BULK. There is no per-send override.
 *
 * membership_state is deliberately NOT consulted. Migration 034 added it as a
 * LAPSE-REASON code: it is NULL for every active member and is populated only
 * when a membership leaves active, and 034's own header names `status` as "the
 * gating field other code depends on". Gating on membership_state would route
 * every lapsed member to the Warm lane, which is the opposite of what it means.
 *
 * Three exclusions ride along: consent state (spec section 5.5), the ELV and
 * wix suppression tags the legacy path already applies, and everyone this
 * campaign key has already been sent to. The last is a LIKE on the source
 * prefix rather than a join on sendId, so a campaign that spans several runs,
 * several sendIds and several days still never mails the same person twice.
 */
const BULK_AUDIENCE_SQL = `
  SELECT s.id, s.email, s.name, s.segments, s.source,
         s.last_clicked_at, s.last_opened_at, s.last_sent_at, s.subscribed_at
    FROM newsletter_subscriber s
   WHERE s.status = 'active'
     AND NOT EXISTS (
       SELECT 1 FROM wix_subscription ws
        WHERE ws.email = s.email COLLATE NOCASE AND ws.status = 'active'
     )
     AND NOT EXISTS (
       SELECT 1 FROM contact c
        JOIN contact_tag ct ON ct.contact_id = c.id
       WHERE c.email = s.email COLLATE NOCASE AND ct.tag = 'stuc:member'
     )
     AND NOT EXISTS (
       SELECT 1 FROM contact c2
        JOIN contact_tag ct2 ON ct2.contact_id = c2.id
       WHERE c2.email = s.email COLLATE NOCASE
         AND ct2.tag IN ('elv:spamtrap', 'elv:email_disabled', 'elv:disposable',
                         'elv:invalid', 'elv:dead_server', 'elv:invalid_mx',
                         'wix:unsubscribed', 'email:bounced', 'wix:bounced', 'email:complained')
     )
     AND NOT EXISTS (
       SELECT 1 FROM email_log el
        WHERE el.email = s.email COLLATE NOCASE
          AND el.event = 'send'
          AND el.source LIKE ?
     )
   ORDER BY ${COHORT_ORDER_SQL}
`;
```

Add these three helpers above `onRequestPost`:

```js
/**
 * The trailing-24h numbers the breaker judges.
 *
 * TWO TIME BOUNDS, TWO FORMATS, ON PURPOSE. email_log.created_at is written by
 * datetime('now') -- 'YYYY-MM-DD HH:MM:SS' -- while email_event.ts is the SES
 * event's own ISO 8601 stamp, 'YYYY-MM-DDTHH:MM:SS.sssZ'. The two differ at
 * offset 10, ' ' against 'T', and ' ' sorts BELOW 'T', so a single
 * datetime('now','-24 hours') bound compared against ts would silently admit
 * events from outside the window. The sends bound is computed in SQL; the
 * events bound is a JS ISO string bound as a parameter.
 *
 * Complaints and bounces are scoped to the campaign by joining email_event to
 * email_log on ses_message_id, NOT by email_event.source: the mail package
 * sends no SES message tags, so events.js has nothing to put in that column and
 * it is NULL for every row this path produces.
 */
async function bulkTrailingCounts(db, sourcePrefix, nowIso) {
  const since = new Date(Date.parse(nowIso) - 24 * 3600 * 1000).toISOString();
  const sentRow = await db.prepare(
    `SELECT COUNT(*) AS c FROM email_log
      WHERE event = 'send' AND source LIKE ? AND created_at >= datetime('now','-24 hours')`
  ).bind(sourcePrefix).first();
  const events = (await db.prepare(
    `SELECT ev.event_type AS event_type, ev.bounce_type AS bounce_type, COUNT(*) AS c
       FROM email_event ev
       JOIN email_log el ON el.ses_message_id = ev.ses_message_id
      WHERE el.source LIKE ?
        AND el.event = 'send'
        AND ev.event_type IN ('complaint','bounce')
        AND ev.ts >= ?
      GROUP BY ev.event_type, ev.bounce_type`
  ).bind(sourcePrefix, since).all()).results;
  let complained = 0;
  let bounced = 0;
  for (const row of events) {
    if (row.event_type === 'complaint') complained += row.c;
    // Spec section 5.1: a HARD bounce is bounce_type = 'Permanent'. A transient
    // bounce is a mailbox full, not a bad address, and counting it would pause
    // a healthy run on somebody's holiday autoresponder.
    else if (row.bounce_type === 'Permanent') bounced += row.c;
  }
  return { sent: sentRow?.c || 0, complained, bounced };
}

/**
 * Write the pause and answer it. A pause is a STOP, not a retry: nothing in the
 * request path clears it, and the next run refuses until a human has read the
 * reason and passed --resume.
 */
async function pauseRun(db, { campaign, reason, detail, status, sendId, sent }) {
  await db.prepare(
    'INSERT INTO send_paused (id, campaign, reason, detail) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), campaign, reason, detail ? String(detail).slice(0, 500) : null).run();
  return Response.json({
    ok: false, error: 'bulk_paused', reason, detail: detail ? String(detail).slice(0, 300) : null,
    campaign, sendId: sendId || null, sent: sent || 0,
  }, { status });
}

/** The one open-pause question, asked before anything else touches a row. */
async function openPause(db, campaign) {
  return db.prepare(
    'SELECT id, reason, detail, paused_at FROM send_paused WHERE campaign = ? AND resumed_at IS NULL ORDER BY paused_at DESC LIMIT 1'
  ).bind(campaign).first();
}
```

Insert the dispatch line in `onRequestPost`, immediately after `const db = env.DB;`:

```js
  // The bulk lane is its own path. Everything below this line is the legacy
  // newsletter send, unchanged; see the BULK LANE comment above for why.
  if (body.lane === 'bulk') {
    return runBulkSend({ env, db, body, waitUntil });
  }
```

Then add `runBulkSend` at the foot of the file:

```js
/**
 * THE BULK RUN. One call sends at most the day's remaining allowance, engaged
 * recipients first, and leaves the rest for tomorrow.
 *
 * The order of the gates is the design, not an accident. Every gate that can
 * refuse the WHOLE run runs before the first recipient row is read, so a
 * refusal leaves no newsletter_event rows, no last_sent_at stamps and no
 * newsletter_send row behind:
 *
 *   1. shape        -- campaign key, no cursor, dry-run default
 *   2. BULK_FROM    -- 503 rather than a silent fall back to the apex sender
 *   3. lane         -- preflightLane(), certain and total if it refuses
 *   4. open pause   -- a human has stopped this campaign
 *   5. first send   -- the domain has never sent and --first-send was not passed
 *   6. breaker      -- the trailing 24h is already over the line
 *   7. allowance    -- the day is spent
 *
 * Only then does it read the cohort.
 */
async function runBulkSend({ env, db, body, waitUntil }) {
  const nowIso = new Date().toISOString();
  const { subject, body: htmlBody, campaign, segments, send: doSend, firstSend, resume, cursor } = body;

  // 1. Shape.
  if (!isCampaignKey(campaign)) {
    return Response.json({
      ok: false, error: 'bulk_campaign_required',
      detail: 'campaign must be a lowercase slug of 2 to 64 characters, e.g. "sept-letter"',
    }, { status: 400 });
  }
  if (cursor) {
    return Response.json({
      ok: false, error: 'bulk_cursor_unsupported',
      detail: 'the bulk lane orders by engagement, which an id cursor cannot paginate; resume by calling again, already-sent recipients are excluded',
    }, { status: 400 });
  }
  const dryRun = doSend !== true;
  const source = `newsletter/bulk/${campaign}`;
  const sourcePrefix = `${source}%`;

  // 2. The sender, or nothing.
  if (!env.BULK_FROM) {
    return Response.json({ ok: false, error: 'bulk_from_not_configured' }, { status: 503 });
  }

  // 3. The lane. Certain and total if it refuses, so it is asked here.
  let lane;
  try {
    lane = preflightLane({ from: env.BULK_FROM, category: 'newsletter' });
  } catch (err) {
    if (err instanceof LaneRefused) {
      log(env, waitUntil, 'newsletter', 'bulk_lane_refused', 'error', `${err.reason}: ${err.detail}`.slice(0, 200), 0, 400);
      return Response.json({
        ok: false, error: 'bulk_lane_refused', reason: err.reason,
        detail: String(err.detail).slice(0, 300),
      }, { status: 400 });
    }
    throw err;
  }

  // 4. A pause a human has not cleared.
  const paused = await openPause(db, campaign);
  if (paused && resume !== true) {
    return Response.json({
      ok: false, error: 'bulk_paused', reason: paused.reason,
      detail: paused.detail, pausedAt: paused.paused_at, campaign,
      action: 'read the reason, then re-run with --resume',
    }, { status: 423 });
  }
  if (paused && resume === true && !dryRun) {
    await db.prepare("UPDATE send_paused SET resumed_at = datetime('now') WHERE id = ?").bind(paused.id).run();
  }

  // 5. The first-send gate. The row's ABSENCE means the domain has never sent,
  //    and --first-send creates it in its own write BEFORE any recipient is
  //    touched, so nothing ever computes a day count against a missing fact.
  let state = await db.prepare('SELECT first_send_at, day, sent_today FROM mail_domain_state WHERE domain = ?')
    .bind(BULK_DOMAIN).first();
  if ((!state || !state.first_send_at) && firstSend === true && !dryRun) {
    await db.prepare(
      `INSERT INTO mail_domain_state (domain, first_send_at, day, sent_today)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(domain) DO UPDATE SET first_send_at = COALESCE(mail_domain_state.first_send_at, excluded.first_send_at)`
    ).bind(BULK_DOMAIN, nowIso, nowIso.slice(0, 10)).run();
    state = await db.prepare('SELECT first_send_at, day, sent_today FROM mail_domain_state WHERE domain = ?')
      .bind(BULK_DOMAIN).first();
  }
  const allowance = remainingAllowance(state, nowIso);
  if (!allowance.ok) {
    return Response.json({
      ok: false, error: 'bulk_first_send_required', reason: allowance.reason, campaign,
      action: 'pass --first-send once, after reading the ramp table; it records the domain first-send and runs under the day 1 cap',
    }, { status: 409 });
  }

  // 6. The breaker, on the trailing 24h, before a single new message.
  const counts = await bulkTrailingCounts(db, sourcePrefix, nowIso);
  const verdict = breakerVerdict(counts);
  if (verdict.tripped && !dryRun) {
    log(env, waitUntil, 'newsletter', 'bulk_breaker_tripped', 'error', `${verdict.reason}: ${verdict.detail}`.slice(0, 200), 0, 423);
    return pauseRun(db, { campaign, reason: verdict.reason, detail: verdict.detail, status: 423, sent: 0 });
  }

  // 7. The day's allowance.
  if (allowance.remaining === 0 && !dryRun) {
    return Response.json({
      ok: false, error: 'bulk_cap_exhausted', campaign,
      cap: allowance.cap, ageDays: allowance.ageDays, sentToday: allowance.sentToday, remainingToday: 0,
    }, { status: 429 });
  }

  // The cohort, already ordered and already excluding everyone this campaign
  // has reached. Fetch one allowance's worth plus one, so `done` can be
  // answered without a second query.
  const fetchLimit = Math.max(1, allowance.remaining) + 1;
  let cohort = (await db.prepare(`${BULK_AUDIENCE_SQL} LIMIT ?`).bind(sourcePrefix, fetchLimit).all()).results;
  if (segments && segments.length > 0) {
    cohort = cohort.filter((sub) => {
      const subSegments = parseSegments(sub.segments);
      return segments.some((seg) => subSegments.includes(seg));
    });
  }
  const { send: page, deferred } = truncateToAllowance(cohort, allowance.remaining);
  const segmentLabel = segments && segments.length > 0 ? segments.join('-') : null;

  if (dryRun) {
    return Response.json({
      ok: true, dryRun: true, done: false, lane, campaign,
      audience: cohort.length, wouldSend: page.length, deferred,
      cap: allowance.cap, ageDays: allowance.ageDays, sentToday: allowance.sentToday,
      remainingToday: allowance.remaining, sent: 0,
      feedbackId: feedbackId(campaign, segmentLabel),
      head: page.slice(0, 5).map((s) => s.email),
      breaker: verdict.detail,
      pausedNow: verdict.tripped ? verdict.reason : null,
    }, { status: 200 });
  }

  // A real run gets a newsletter_send row, so the existing surfaces that read
  // that table see a bulk campaign the same way they see any other send.
  const sendId = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO newsletter_send (id, subject, html, segment_filter, status, total_recipients, commentary_slug) VALUES (?, ?, ?, ?, 'sending', ?, ?)"
  ).bind(sendId, subject, htmlBody, segmentLabel ? JSON.stringify(segments) : null, page.length, null).run();

  let sentCount = 0;
  for (const sub of page) {
    // Re-check status immediately before SES so a concurrent unsubscribe during
    // a paced run is honoured, exactly as the legacy path does.
    const stillActive = await db.prepare('SELECT status FROM newsletter_subscriber WHERE id = ?').bind(sub.id).first();
    if (stillActive?.status !== 'active') {
      log(env, waitUntil, 'newsletter', 'bulk_skipped_status_changed', 'warn', sub.email, 0, 200);
      continue;
    }

    const { html, text } = await renderEmail({
      body: htmlBody, sendId, subscriberId: sub.id, email: sub.email, secret: env.NEWSLETTER_SECRET,
    });
    const headers = {
      ...(await unsubscribeHeaders(sub.email, env.NEWSLETTER_SECRET)),
      'Feedback-ID': feedbackId(campaign, segmentLabel),
    };

    // Send intent first, same rule as the legacy path: on an SES failure a
    // false-positive sent beats a double-send.
    await db.batch([
      db.prepare("INSERT INTO newsletter_event (send_id, subscriber_id, event) VALUES (?, ?, 'sent')").bind(sendId, sub.id),
      db.prepare("UPDATE newsletter_subscriber SET last_sent_at = datetime('now') WHERE id = ?").bind(sub.id),
    ]);

    let messageId = null;
    try {
      // No `log` block: this path writes its own email_log row below, in the
      // SAME batch as the day counter, because insertEmailLog() swallows D1
      // failures by design and the counter must not be able to fall behind.
      ({ messageId } = await sendRawEmail(env, {
        from: env.BULK_FROM,
        to: sub.email,
        subject,
        html,
        text,
        headers,
        replyTo: BULK_REPLY_TO,
        configurationSet: BULK_CONFIGURATION_SET,
      }));
    } catch (err) {
      log(env, waitUntil, 'newsletter', 'bulk_send_error', 'error', String(err?.message || 'unknown').slice(0, 200), 0, 0);
      await logEmailFailure(db, {
        email: sub.email, category: 'newsletter', source, subject, detail: err?.message,
      });
      continue;
    }

    // The log row and the day counter, atomically. A failure here PAUSES the
    // run: the message is already delivered and is never reclassified, but the
    // cap has lost its only source of truth for the day, so sending stops.
    try {
      await db.batch([
        db.prepare(
          "INSERT INTO email_log (event, email, category, source, subject, send_id, ses_message_id, lane) VALUES ('send', ?, 'newsletter', ?, ?, ?, ?, ?)"
        ).bind(sub.email.toLowerCase(), source, subject, sendId, messageId, lane),
        db.prepare(
          `UPDATE mail_domain_state
              SET sent_today = CASE WHEN day = ? THEN sent_today + 1 ELSE 1 END,
                  day = ?,
                  updated_at = datetime('now')
            WHERE domain = ?`
        ).bind(nowIso.slice(0, 10), nowIso.slice(0, 10), BULK_DOMAIN),
      ]);
    } catch (err) {
      sentCount++;
      log(env, waitUntil, 'newsletter', 'bulk_log_write_failed', 'error', String(err?.message || 'unknown').slice(0, 200), 0, 500);
      await db.prepare("UPDATE newsletter_send SET sent_count = sent_count + ?, status = 'failed' WHERE id = ?")
        .bind(sentCount, sendId).run();
      return pauseRun(db, {
        campaign, reason: PAUSE_LOG_WRITE_FAILED, detail: err?.message, status: 500, sendId, sent: sentCount,
      });
    }

    sentCount++;
    if (sentCount < page.length) await new Promise((r) => setTimeout(r, BULK_PACING_MS));
  }

  const done = deferred === 0 && cohort.length <= page.length;
  await db.prepare(
    `UPDATE newsletter_send SET sent_count = sent_count + ?, status = ?, sent_at = CASE WHEN ? = 1 THEN datetime('now') ELSE sent_at END WHERE id = ?`
  ).bind(sentCount, done ? 'sent' : 'sending', done ? 1 : 0, sendId).run();

  const after = remainingAllowance(
    await db.prepare('SELECT first_send_at, day, sent_today FROM mail_domain_state WHERE domain = ?').bind(BULK_DOMAIN).first(),
    nowIso,
  );
  log(env, waitUntil, 'newsletter', 'bulk_send_page', 'ok', `${campaign}: ${sentCount} sent, ${deferred} deferred`, 0, 200);

  return Response.json({
    ok: true, dryRun: false, done, lane, campaign, sendId,
    sent: sentCount, deferred,
    cap: after.cap, ageDays: after.ageDays, sentToday: after.sentToday, remainingToday: after.remaining,
  }, { status: 200 });
}
```

- [ ] **Step 4: Run the bulk tests and watch them pass**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/newsletter-bulk-send.test.js
```

Expected: PASS, 0 failing.

- [ ] **Step 5: Run every suite that touches this endpoint or its schema**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/newsletter-send.test.js test/newsletter-unsubscribe-roundtrip.test.js test/newsletter-policy.test.js test/bulk-mail-schema.test.js test/ses-adapter.test.js test/collation-identity.test.js
```

Expected: PASS, 0 failing. `newsletter-send.test.js` is the legacy path's own suite and must be untouched by this change; a failure there means the dispatch line landed in the wrong place.

- [ ] **Step 6: Run the static gates**

```bash
cd ~/iCode/projects/rrm-academy-cf && npm run lint && npm run gates:sql && npm run gates:schema-drift:check && npx arise-scan --json --files functions/api/newsletter/send.js
```

Expected: eslint clean; `gates:sql` passes with a PREPARED count at or above its floor (the new statements PREPARE against the composed mirror, which is what proves `mail_domain_state`, `send_paused`, `wix_subscription` and `contact_tag` columns all resolve); arise-scan reports no findings. A `collate-nocase` finding is a real one to fix, not to suppress.

- [ ] **Step 7: Re-hash the guard manifest and verify**

```bash
cd ~/iCode/projects/rrm-academy-cf && npm run guard:update && npm run guard
```

Expected: `guard:update` rewrites the `functions/api/newsletter/send.js` hash; `npm run guard` exits 0. Its `send.js must require ADMIN_API_SECRET Bearer auth` invariant still holds because the bulk dispatch sits below the auth check, not above it.

- [ ] **Step 8: Commit**

```bash
cd ~/iCode/projects/rrm-academy-cf
cat > /tmp/rac-commit.txt <<'MSG'
newsletter: the bulk lane on rrmacademy.com

A second path through POST /api/newsletter/send, selected by
lane: 'bulk'. The legacy path below the dispatch line is byte-for-byte
unchanged: its drivers are live, and the membership exclusion this path
applies is the BULK audience's rule (a paying STUC member is routed to
the Warm lane), not a new rule for every newsletter send.

Every gate that can refuse the whole run runs BEFORE the first
recipient row is read -- shape, BULK_FROM, lane preflight, open pause,
first-send, breaker, allowance -- because this endpoint records send
intent before calling SES, so a refusal discovered late would mark a
page of recipients sent for mail that never left.

Three decisions worth knowing:

  - no id cursor on this path. The cohort is ordered by engagement and
    an id cursor cannot paginate that. It needs none: already-sent
    recipients are excluded by a LIKE on the campaign source prefix, so
    each call advances on its own. A bulk request carrying a cursor is
    refused rather than silently ordered by id.

  - this path writes its own email_log row, in the SAME db.batch() as
    the sent_today increment. insertEmailLog() swallows D1 failures by
    design, and a cap that recounted email_log after SES had already
    accepted could undercount and let a rerun exceed the ramp. A
    failure of that batch pauses the run with reason log-write-failed;
    the delivered message is never reclassified as unsent.

  - the breaker's two time bounds are different formats deliberately.
    email_log.created_at is datetime('now'); email_event.ts is SES's
    ISO 8601. They differ at offset 10, ' ' against 'T', and ' ' sorts
    below 'T', so one bound for both would silently widen the complaint
    window.

Complaints and bounces are scoped to the campaign by joining
email_event to email_log on ses_message_id, not by email_event.source:
the mail package sends no SES message tags, so that column is NULL for
every row this path produces.

guard-manifest.json re-hashed via npm run guard:update.

Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md sections 3, 5.0, 5.1, 5.5

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git add functions/api/newsletter/send.js guard-manifest.json test/newsletter-bulk-send.test.js
git commit -F /tmp/rac-commit.txt
```

---

## Task 7: The SNS event feed, proved with signed fixtures

`functions/api/email/events.js` is the endpoint the `rrm-bulk` configuration set publishes into, and Task 1 wired it: the same SNS topic the `rrm-email` set already uses, because `events.js` keys on nothing configuration-set specific and a second topic would buy a second subscription, a second secret and a second ARN guard for nothing.

That decision means this task adds NO production code. What it adds is the thing the endpoint has never had: a test that drives it with a REAL SNS signature. Until now the endpoint's RSA verification, its `webhook_event` dedup, its complaint-to-`complained` write and its Permanent-bounce-to-`bounced` write were all unexercised, and they are exactly what the circuit breaker in Task 6 reads.

**Files:**
- Create: `test/email-events-sns.test.js`
- Modify: none. The decision not to modify `events.js` is recorded in its commit message.

**Interfaces:**
- Consumes: `email_event` and `newsletter_subscriber` (existing), migration 041 not required here but harmless.
- Produces: no new exports. The proof is that a signed Complaint writes `email_event(event_type='complaint')` and sets `newsletter_subscriber.status='complained'` in one batch, and a signed Permanent Bounce writes `email_event(event_type='bounce', bounce_type='Permanent')`, sets `status='bounced'` and increments `bounce_count`.

- [ ] **Step 1: Write the failing test**

Create `test/email-events-sns.test.js`:

```js
/**
 * EXECUTED tests for functions/api/email/events.js, driven with REAL SNS
 * signatures over a locally generated RSA key.
 *
 * The endpoint was self-described inert until the bulk rail wired it, and every
 * branch that matters had never run: the SHA-256 SigVer 2 verification, the
 * X.509 SPKI walk, the webhook_event dedup, and the two batches that move a
 * subscriber to 'complained' and 'bounced'. The circuit breaker in
 * functions/api/newsletter/send.js reads exactly the rows these branches write,
 * so an unexercised endpoint here is an unexercised breaker there.
 *
 * The signature is genuine, not stubbed: node:crypto generates a keypair, the
 * test builds SNS's canonical string itself, signs it, and stubs only the
 * CERTIFICATE FETCH so the endpoint's own verifier does the verifying. Stubbing
 * verifySnsSignature would leave the one security control untested.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, X509Certificate, createPrivateKey } from 'node:crypto';
import { bulkMailD1 } from './_bulk-mail-sqlite.mjs';
import { mockRequest, mockEnv, mockWaitUntil } from './_helpers.js';
import { onRequestPost } from '../functions/api/email/events.js';

const SECRET = 'events-secret';
const TOPIC = 'arn:aws:sns:us-east-1:111122223333:rrm-ses-events';
const CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem';

/**
 * A self-signed certificate whose SPKI the endpoint's ASN.1 walker extracts.
 * Generated once per run; nothing here is a fixture on disk, so there is no
 * expiry to rot.
 */
function makeSigner() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  // A minimal self-signed X.509 carrying that public key.
  const cert = X509Certificate ? null : null; // placeholder removed below
  return { privateKey, publicKey };
}

/**
 * SNS's canonical string for a Notification, field order fixed by AWS:
 * Message, MessageId, Subject (only when present), Timestamp, TopicArn, Type.
 * This mirrors buildCanonicalString() in the endpoint rather than importing it,
 * so a change to that function fails here instead of agreeing with itself.
 */
function canonicalString(p) {
  let s = '';
  s += `Message\n${p.Message}\n`;
  s += `MessageId\n${p.MessageId}\n`;
  if (p.Subject != null) s += `Subject\n${p.Subject}\n`;
  s += `Timestamp\n${p.Timestamp}\n`;
  s += `TopicArn\n${p.TopicArn}\n`;
  s += `Type\n${p.Type}\n`;
  return s;
}

let keys;
let certPem;
let originalFetch;

before(async () => {
  // openssl through node:crypto cannot mint an X.509 without a helper, so the
  // certificate is produced once by the shell and cached in-process.
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'sns-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-subj', '/CN=sns.amazonaws.com',
    '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
  keys = { privateKey: createPrivateKey(readFileSync(join(dir, 'k.pem'), 'utf8')) };
  certPem = readFileSync(join(dir, 'c.pem'), 'utf8');

  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === CERT_URL) return new Response(certPem, { status: 200 });
    throw new Error(`unrouted fetch to ${url}`);
  };
});

after(() => { globalThis.fetch = originalFetch; });

/** A signed SNS Notification carrying an SES event message. */
function signedNotification(message, { messageId = crypto.randomUUID() } = {}) {
  const payload = {
    Type: 'Notification',
    MessageId: messageId,
    TopicArn: TOPIC,
    Message: JSON.stringify(message),
    Timestamp: new Date().toISOString(),
    SignatureVersion: '2',
    SigningCertURL: CERT_URL,
  };
  const signer = createSign('RSA-SHA256');
  signer.update(canonicalString(payload));
  payload.Signature = signer.sign(keys.privateKey).toString('base64');
  return payload;
}

function env(db) {
  return mockEnv({ DB: db, SES_EVENTS_SECRET: SECRET, SES_EVENTS_TOPIC_ARN: TOPIC });
}

async function post(db, payload) {
  const req = mockRequest('POST', {
    body: payload,
    url: `https://rrmacademy.org/api/email/events?secret=${SECRET}`,
  });
  return onRequestPost({ request: req, env: env(db), waitUntil: mockWaitUntil() });
}

async function seedSubscriber(db, { id, email, status = 'active' }) {
  await db.prepare(
    "INSERT INTO newsletter_subscriber (id, email, status, source) VALUES (?, ?, ?, 'website')"
  ).bind(id, email, status).run();
}

describe('signed SNS events', () => {
  it('a Complaint writes email_event and flips the subscriber to complained', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'Angry@Example.com' });
    const res = await post(db, signedNotification({
      eventType: 'Complaint',
      mail: { messageId: 'ses-msg-1', destination: ['angry@example.com'] },
      complaint: {
        complainedRecipients: [{ emailAddress: 'angry@example.com' }],
        complaintFeedbackType: 'abuse',
        timestamp: new Date().toISOString(),
      },
    }));
    assert.equal(res.status, 200);
    const ev = await db.prepare("SELECT event_type, ses_message_id, feedback_type FROM email_event WHERE email = 'angry@example.com'").first();
    assert.equal(ev.event_type, 'complaint');
    assert.equal(ev.ses_message_id, 'ses-msg-1');
    assert.equal(ev.feedback_type, 'abuse');
    const sub = await db.prepare('SELECT status FROM newsletter_subscriber WHERE id = ?').bind('sub-1').first();
    assert.equal(sub.status, 'complained');
  });

  it('a Permanent Bounce writes bounce_type=Permanent, flips to bounced and counts', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-2', email: 'dead@example.com' });
    const res = await post(db, signedNotification({
      eventType: 'Bounce',
      mail: { messageId: 'ses-msg-2', destination: ['dead@example.com'] },
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'General',
        bouncedRecipients: [{ emailAddress: 'dead@example.com', diagnosticCode: '550 5.1.1 user unknown' }],
        timestamp: new Date().toISOString(),
      },
    }));
    assert.equal(res.status, 200);
    const ev = await db.prepare("SELECT event_type, bounce_type FROM email_event WHERE email = 'dead@example.com'").first();
    assert.equal(ev.event_type, 'bounce');
    assert.equal(ev.bounce_type, 'Permanent');
    const sub = await db.prepare('SELECT status, bounce_count FROM newsletter_subscriber WHERE id = ?').bind('sub-2').first();
    assert.equal(sub.status, 'bounced');
    assert.equal(sub.bounce_count, 1);
  });

  it('a Transient bounce counts but does not flip the status on its own', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-3', email: 'full@example.com' });
    await post(db, signedNotification({
      eventType: 'Bounce',
      mail: { messageId: 'ses-msg-3', destination: ['full@example.com'] },
      bounce: {
        bounceType: 'Transient',
        bouncedRecipients: [{ emailAddress: 'full@example.com' }],
        timestamp: new Date().toISOString(),
      },
    }));
    const sub = await db.prepare('SELECT status, bounce_count FROM newsletter_subscriber WHERE id = ?').bind('sub-3').first();
    assert.equal(sub.status, 'active');
    assert.equal(sub.bounce_count, 1);
  });

  it('an unsubscribed subscriber is never overwritten by a bounce', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-4', email: 'gone@example.com', status: 'unsubscribed' });
    await post(db, signedNotification({
      eventType: 'Bounce',
      mail: { messageId: 'ses-msg-4', destination: ['gone@example.com'] },
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [{ emailAddress: 'gone@example.com' }],
        timestamp: new Date().toISOString(),
      },
    }));
    const sub = await db.prepare('SELECT status FROM newsletter_subscriber WHERE id = ?').bind('sub-4').first();
    assert.equal(sub.status, 'unsubscribed');
  });

  it('a redelivered MessageId is deduped, so a retry cannot double-count', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-5', email: 'twice@example.com' });
    const payload = signedNotification({
      eventType: 'Complaint',
      mail: { messageId: 'ses-msg-5', destination: ['twice@example.com'] },
      complaint: { complainedRecipients: [{ emailAddress: 'twice@example.com' }], timestamp: new Date().toISOString() },
    });
    assert.equal((await post(db, payload)).status, 200);
    assert.equal((await post(db, payload)).status, 200);
    const c = await db.prepare("SELECT COUNT(*) AS c FROM email_event WHERE email = 'twice@example.com'").first();
    assert.equal(c.c, 1);
  });

  it('a forged signature is refused and writes nothing', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-6', email: 'safe@example.com' });
    const payload = signedNotification({
      eventType: 'Complaint',
      mail: { messageId: 'ses-msg-6', destination: ['safe@example.com'] },
      complaint: { complainedRecipients: [{ emailAddress: 'safe@example.com' }], timestamp: new Date().toISOString() },
    });
    payload.Signature = Buffer.from('not a signature').toString('base64');
    const res = await post(db, payload);
    assert.equal(res.status, 401);
    const c = await db.prepare('SELECT COUNT(*) AS c FROM email_event').first();
    assert.equal(c.c, 0);
    const sub = await db.prepare('SELECT status FROM newsletter_subscriber WHERE id = ?').bind('sub-6').first();
    assert.equal(sub.status, 'active');
  });

  it('a foreign TopicArn is refused', async () => {
    const db = bulkMailD1();
    const payload = signedNotification({ eventType: 'Delivery', mail: {}, delivery: { recipients: [] } });
    payload.TopicArn = 'arn:aws:sns:us-east-1:999999999999:someone-else';
    const signer = createSign('RSA-SHA256');
    signer.update(canonicalString(payload));
    payload.Signature = signer.sign(keys.privateKey).toString('base64');
    const res = await post(db, payload);
    assert.equal(res.status, 403);
  });

  it('a Delivery event for a bulk message is joinable back to email_log by ses_message_id', async () => {
    const db = bulkMailD1();
    await db.prepare(
      "INSERT INTO email_log (event, email, category, source, ses_message_id) VALUES ('send','r@example.com','newsletter','newsletter/bulk/sept-letter','ses-msg-7')"
    ).run();
    await post(db, signedNotification({
      eventType: 'Delivery',
      mail: { messageId: 'ses-msg-7', destination: ['r@example.com'] },
      delivery: { recipients: ['r@example.com'], timestamp: new Date().toISOString() },
    }));
    const joined = await db.prepare(
      `SELECT ev.event_type FROM email_event ev
         JOIN email_log el ON el.ses_message_id = ev.ses_message_id
        WHERE el.source LIKE 'newsletter/bulk/sept-letter%'`
    ).first();
    assert.equal(joined.event_type, 'delivery', 'this join is what the circuit breaker reads');
  });
});
```

Delete the unused `makeSigner` stub before running; it is left out of the final file.

- [ ] **Step 2: Run it and watch it fail, then pass**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/email-events-sns.test.js
```

Expected on the FIRST run, before deleting `makeSigner`: FAIL with a `ReferenceError` or an unused-binding lint complaint. After deleting it: PASS, 0 failing. If instead a test fails with `500` and an `email_event` insert error, the harness is missing the `email_event` table; confirm `test/_d1-sqlite.mjs`'s `POST_SNAPSHOT_MIGRATIONS` still lists `2026-06-28-email-event.sql`.

- [ ] **Step 3: MUTATION PROOF -- the signature check actually gates**

In `functions/api/email/events.js`, temporarily replace the body of `verifySnsSignature` with `return true;`. Run:

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/email-events-sns.test.js
```

Expected: FAIL on `a forged signature is refused and writes nothing`. Restore the function, re-run, and confirm PASS with `git diff --stat functions/api/email/events.js` reporting no change.

- [ ] **Step 4: Commit**

```bash
cd ~/iCode/projects/rrm-academy-cf
cat > /tmp/rac-commit.txt <<'MSG'
email/events: prove the SNS feed with real signatures

No production change, and that is the finding, not an omission. The
rrm-bulk configuration set publishes into the SAME SNS topic the
rrm-email set already uses, because events.js keys on nothing
configuration-set specific: it reads eventType, mail.messageId and the
message tags, and guards the sender with SES_EVENTS_TOPIC_ARN, a
single scalar. A second topic would have bought a second subscription,
a second secret and a second ARN guard for nothing.

What was missing is a test. The endpoint was self-described inert until
this build wired it, so its SHA-256 verification, its X.509 SPKI walk,
its webhook_event dedup and the two batches that move a subscriber to
'complained' and 'bounced' had never run. The bulk circuit breaker
reads exactly the rows those batches write.

The signature is genuine: node:crypto mints a keypair, the test builds
SNS's canonical string itself and signs it, and only the CERTIFICATE
FETCH is stubbed, so the endpoint's own verifier does the verifying.
Mutation-proved by making verifySnsSignature return true, which reddens
the forged-signature case.

Also pins the join the breaker depends on: email_event to email_log on
ses_message_id, which is how a bulk campaign is scoped, since the mail
package sends no SES message tags and email_event.source is NULL.

Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 5.2

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git add test/email-events-sns.test.js
git commit -F /tmp/rac-commit.txt
```

---

## Task 8: `scripts/bulk-send.mjs`, the CLI

Dry-run by default. It holds no SES credential: it reads `ADMIN_API_SECRET` from 1Password and calls the endpoint, which is the only thing that holds an SES key on this estate.

**Files:**
- Create: `scripts/bulk-send.mjs`
- Test: `test/bulk-send-cli.test.js`

**Interfaces:**
- Consumes: `POST /api/newsletter/send` with `lane: 'bulk'` (Task 6) and every refusal code it returns.
- Produces, as named exports of `scripts/bulk-send.mjs` so the CLI is testable without running it:
  - `parseArgs(argv: string[]): { campaign: string|null, subjectFile: string|null, bodyFile: string|null, segments: string[]|null, send: boolean, firstSend: boolean, resume: boolean, endpoint: string }`
  - `isBehindOrigin(cwd: string, run: Function): { behind: boolean, count: number, detail: string }` -- `run(cmd, args)` is injected so the test never shells out to git.
  - `renderReport(answer: object): string`
  - `main(argv: string[], deps: object): Promise<number>` -- returns the process exit code.

- [ ] **Step 1: Write the failing test**

Create `test/bulk-send-cli.test.js`:

```js
/**
 * EXECUTED tests for scripts/bulk-send.mjs.
 *
 * Every dangerous property of this CLI is a pure function, deliberately, so it
 * can be asserted without a network, a git checkout or a 1Password session:
 * dry-run is the default, --send is the only way past it, a checkout behind
 * origin/main refuses, and the refusal codes the endpoint returns are reported
 * rather than swallowed into a zero exit.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, isBehindOrigin, renderReport, main } from '../scripts/bulk-send.mjs';

describe('parseArgs', () => {
  it('is dry-run unless --send is passed', () => {
    assert.equal(parseArgs(['--campaign', 'sept-letter']).send, false);
    assert.equal(parseArgs(['--campaign', 'sept-letter', '--send']).send, true);
  });

  it('reads the campaign, the body file and the segments', () => {
    const a = parseArgs(['--campaign', 'sept-letter', '--body', 'letter.html', '--subject', 'subj.txt', '--segments', 'donor,student']);
    assert.equal(a.campaign, 'sept-letter');
    assert.equal(a.bodyFile, 'letter.html');
    assert.equal(a.subjectFile, 'subj.txt');
    assert.deepEqual(a.segments, ['donor', 'student']);
  });

  it('carries --first-send and --resume as their own flags, never implied', () => {
    const plain = parseArgs(['--campaign', 'x1', '--send']);
    assert.equal(plain.firstSend, false);
    assert.equal(plain.resume, false);
    const armed = parseArgs(['--campaign', 'x1', '--send', '--first-send', '--resume']);
    assert.equal(armed.firstSend, true);
    assert.equal(armed.resume, true);
  });

  it('defaults the endpoint to production and lets --endpoint override it', () => {
    assert.equal(parseArgs([]).endpoint, 'https://rrmacademy.org/api/newsletter/send');
    assert.equal(parseArgs(['--endpoint', 'http://localhost:8788/api/newsletter/send']).endpoint, 'http://localhost:8788/api/newsletter/send');
  });
});

describe('isBehindOrigin', () => {
  const runner = (counts) => (cmd, args) => {
    if (args[0] === 'fetch') return '';
    if (args.includes('HEAD..origin/main')) return counts;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };

  it('is clean when the checkout contains origin/main', () => {
    const v = isBehindOrigin('.', runner('0\n'));
    assert.equal(v.behind, false);
    assert.equal(v.count, 0);
  });

  it('is behind when origin/main carries commits this checkout does not', () => {
    const v = isBehindOrigin('.', runner('3\n'));
    assert.equal(v.behind, true);
    assert.equal(v.count, 3);
    assert.match(v.detail, /3 commit/);
  });

  it('treats a git failure as BEHIND, never as clean', () => {
    const v = isBehindOrigin('.', () => { throw new Error('not a git repository'); });
    assert.equal(v.behind, true, 'an unreadable checkout is not a fresh one');
    assert.match(v.detail, /not a git repository/);
  });
});

describe('main', () => {
  function deps({ answer, status = 200, behind = false, files = {} }) {
    const posted = [];
    return {
      posted,
      fetch: async (url, init) => {
        posted.push({ url, body: JSON.parse(init.body), headers: init.headers });
        return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } });
      },
      readFile: (p) => {
        if (!(p in files)) throw new Error(`no such file ${p}`);
        return files[p];
      },
      secret: () => 'admin-secret',
      git: () => (behind ? '2\n' : '0\n'),
      log: () => {},
      error: () => {},
    };
  }

  const ARGS = ['--campaign', 'sept-letter', '--subject', 's.txt', '--body', 'b.html'];
  const FILES = { 's.txt': 'The September letter', 'b.html': '<p>hello</p>' };

  it('refuses before any request when the checkout is behind origin/main', async () => {
    const d = deps({ answer: {}, behind: true, files: FILES });
    const code = await main([...ARGS, '--send'], d);
    assert.equal(code, 3);
    assert.equal(d.posted.length, 0, 'nothing is sent from a stale checkout');
  });

  it('dry-runs by default and never sets send on the request', async () => {
    const d = deps({
      files: FILES,
      answer: { ok: true, dryRun: true, audience: 812, wouldSend: 200, deferred: 612, cap: 200, ageDays: 1, remainingToday: 200, head: ['a@x.com'], feedbackId: 'sept-letter:all:rrma:rrmacademy.com' },
    });
    const code = await main(ARGS, d);
    assert.equal(code, 0);
    assert.equal(d.posted[0].body.lane, 'bulk');
    assert.equal(d.posted[0].body.campaign, 'sept-letter');
    assert.equal(d.posted[0].body.send, undefined);
    assert.equal(d.posted[0].headers.Authorization, 'Bearer admin-secret');
  });

  it('sets send only with --send', async () => {
    const d = deps({ files: FILES, answer: { ok: true, done: true, sent: 200, deferred: 0, cap: 200, ageDays: 1, remainingToday: 0 } });
    await main([...ARGS, '--send'], d);
    assert.equal(d.posted[0].body.send, true);
  });

  it('reports a pause as a non-zero exit with the reason on stderr', async () => {
    const d = deps({ status: 423, files: FILES, answer: { ok: false, error: 'bulk_paused', reason: 'complaint-rate', detail: '900 sent, 3 complaints (0.333%)' } });
    const code = await main([...ARGS, '--send'], d);
    assert.equal(code, 4);
  });

  it('reports a first-send gate as its own exit code, not a generic failure', async () => {
    const d = deps({ status: 409, files: FILES, answer: { ok: false, error: 'bulk_first_send_required', reason: 'first-send-not-recorded' } });
    assert.equal(await main([...ARGS, '--send'], d), 5);
  });

  it('refuses a campaign key the endpoint would reject, before the request', async () => {
    const d = deps({ files: FILES, answer: {} });
    const code = await main(['--campaign', 'Sept Letter', '--subject', 's.txt', '--body', 'b.html'], d);
    assert.equal(code, 2);
    assert.equal(d.posted.length, 0);
  });

  it('never holds an SES credential', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../scripts/bulk-send.mjs', import.meta.url), 'utf8');
    assert.ok(!/AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|aws4fetch/.test(src),
      'the CLI calls the endpoint; only the Pages Function holds SES credentials');
  });
});

describe('renderReport', () => {
  it('names the four things a dry run exists to show', () => {
    const out = renderReport({
      ok: true, dryRun: true, campaign: 'sept-letter', audience: 812, wouldSend: 200, deferred: 612,
      cap: 200, ageDays: 1, sentToday: 0, remainingToday: 200,
      head: ['a@x.com', 'b@x.com'], feedbackId: 'sept-letter:all:rrma:rrmacademy.com', breaker: '0 sent, 0 complaints',
    });
    assert.match(out, /812/);           // audience after exclusions
    assert.match(out, /200/);           // today's remaining cap
    assert.match(out, /a@x\.com/);      // the cohort head
    assert.match(out, /sept-letter/);   // the campaign key
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/bulk-send-cli.test.js
```

Expected: FAIL with `Cannot find module '.../scripts/bulk-send.mjs'`.

- [ ] **Step 3: Implement the CLI**

Create `scripts/bulk-send.mjs`:

```js
#!/usr/bin/env node
/**
 * THE BULK SEND DRIVER. Dry-run by default.
 *
 *   node scripts/bulk-send.mjs --campaign sept-letter --subject s.txt --body b.html
 *   node scripts/bulk-send.mjs --campaign sept-letter --subject s.txt --body b.html --send
 *   node scripts/bulk-send.mjs --campaign sept-letter ... --send --first-send
 *   node scripts/bulk-send.mjs --campaign sept-letter ... --send --resume
 *
 * IT HOLDS NO SES CREDENTIAL, and a test asserts that by reading this file.
 * Only the Pages Function holds an SES key on this estate (spec section 6); the
 * CLI reads ADMIN_API_SECRET from 1Password and calls the endpoint.
 *
 * IT REFUSES A STALE CHECKOUT. A send driven from a clone that does not contain
 * origin/main can be running against copy, exclusions or policy that were
 * superseded, and unlike a bad deploy there is no rollback for mail that has
 * already left. An unreadable git state counts as BEHIND, never as clean.
 *
 * EXIT CODES, so a wrapper can branch without parsing prose:
 *   0  success, or a dry run that produced a report
 *   2  bad arguments (a campaign key that is not a lowercase slug, a missing file)
 *   3  the checkout is behind origin/main
 *   4  the run is paused (breaker or log-write-failed); read the reason, then --resume
 *   5  the first-send gate: pass --first-send once
 *   6  the day's cap is exhausted
 *   7  any other refusal from the endpoint
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ENDPOINT = 'https://rrmacademy.org/api/newsletter/send';
const CAMPAIGN_KEY = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function parseArgs(argv) {
  const take = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1] ?? null;
  };
  const segments = take('--segments');
  return {
    campaign: take('--campaign'),
    subjectFile: take('--subject'),
    bodyFile: take('--body'),
    segments: segments ? segments.split(',').map((s) => s.trim()).filter(Boolean) : null,
    send: argv.includes('--send'),
    firstSend: argv.includes('--first-send'),
    resume: argv.includes('--resume'),
    endpoint: take('--endpoint') || DEFAULT_ENDPOINT,
  };
}

/**
 * Is this checkout missing commits that are on origin/main?
 *
 * `run` is injected so this is testable without a git repository. A throw from
 * git resolves to BEHIND: an unreadable checkout is not a fresh one, and the
 * failure mode of guessing "clean" is a send against superseded policy.
 */
export function isBehindOrigin(cwd, run) {
  try {
    run('git', ['fetch', 'origin', 'main', '--quiet'], cwd);
    const out = String(run('git', ['rev-list', '--count', 'HEAD..origin/main'], cwd)).trim();
    const count = Number.parseInt(out, 10);
    if (!Number.isFinite(count)) {
      return { behind: true, count: 0, detail: `git answered "${out}", which is not a count` };
    }
    return {
      behind: count > 0,
      count,
      detail: count > 0 ? `this checkout is behind origin/main by ${count} commit(s)` : 'checkout contains origin/main',
    };
  } catch (err) {
    return { behind: true, count: 0, detail: `git could not answer: ${err?.message || err}` };
  }
}

/** The four things a dry run exists to show, plus the state behind them. */
export function renderReport(a) {
  const lines = [];
  lines.push(a.dryRun ? `DRY RUN -- nothing was sent` : `SENT`);
  lines.push(`campaign        ${a.campaign}`);
  lines.push(`Feedback-ID     ${a.feedbackId ?? '(assigned at send time)'}`);
  lines.push(`domain age      day ${a.ageDays} -> cap ${a.cap}/day`);
  lines.push(`spent today     ${a.sentToday ?? 0}`);
  lines.push(`remaining today ${a.remainingToday}`);
  if (a.dryRun) {
    lines.push(`audience        ${a.audience} after exclusions`);
    lines.push(`would send      ${a.wouldSend}`);
    lines.push(`deferred        ${a.deferred} (left for the next day, engaged first)`);
  } else {
    lines.push(`sent            ${a.sent}`);
    lines.push(`deferred        ${a.deferred}`);
    lines.push(`done            ${a.done}`);
  }
  if (a.breaker) lines.push(`breaker         ${a.breaker}`);
  if (a.pausedNow) lines.push(`WOULD PAUSE     ${a.pausedNow}`);
  if (Array.isArray(a.head) && a.head.length) {
    lines.push(`cohort head     ${a.head.join(', ')}`);
  }
  return lines.join('\n');
}

const EXIT_FOR_ERROR = {
  bulk_paused: 4,
  bulk_first_send_required: 5,
  bulk_cap_exhausted: 6,
};

export async function main(argv, deps) {
  const {
    fetch: doFetch = globalThis.fetch,
    readFile = (p) => readFileSync(p, 'utf8'),
    secret = () => String(execFileSync('op', ['read', 'op://Automation/RRM Academy Admin API Secret/credential'], { encoding: 'utf8' })).trim(),
    git = (cmd, args, cwd) => execFileSync(cmd, args, { cwd: cwd || ROOT, encoding: 'utf8' }),
    log = console.log,
    error = console.error,
  } = deps || {};

  const args = parseArgs(argv);
  if (!args.campaign || !CAMPAIGN_KEY.test(args.campaign)) {
    error('--campaign must be a lowercase slug of 2 to 64 characters, e.g. sept-letter');
    return 2;
  }
  if (!args.subjectFile || !args.bodyFile) {
    error('--subject <file> and --body <file> are both required');
    return 2;
  }

  let subject;
  let body;
  try {
    subject = readFile(args.subjectFile).trim();
    body = readFile(args.bodyFile);
  } catch (err) {
    error(`could not read the copy: ${err?.message || err}`);
    return 2;
  }

  const freshness = isBehindOrigin(ROOT, git);
  if (freshness.behind) {
    error(`REFUSING: ${freshness.detail}`);
    error('Mail that has already left has no rollback. Pull, re-read the copy and the exclusions, then re-run.');
    return 3;
  }

  const payload = {
    lane: 'bulk',
    campaign: args.campaign,
    subject,
    body,
  };
  if (args.segments) payload.segments = args.segments;
  if (args.send) payload.send = true;
  if (args.firstSend) payload.firstSend = true;
  if (args.resume) payload.resume = true;

  const res = await doFetch(args.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const answer = await res.json();

  if (!answer.ok) {
    error(`REFUSED (${res.status}): ${answer.error}${answer.reason ? ` -- ${answer.reason}` : ''}`);
    if (answer.detail) error(answer.detail);
    if (answer.action) error(`NEXT: ${answer.action}`);
    return EXIT_FOR_ERROR[answer.error] ?? 7;
  }

  log(renderReport(answer));
  if (answer.dryRun) log('\nNothing was sent. Re-run with --send when the report reads right.');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv.slice(2), {}));
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/bulk-send-cli.test.js
```

Expected: PASS, 0 failing.

- [ ] **Step 5: MUTATION PROOF -- the freshness gate actually gates**

Replace `isBehindOrigin`'s `catch` block with `return { behind: false, count: 0, detail: 'assumed clean' };`. Run:

```bash
cd ~/iCode/projects/rrm-academy-cf && node --test test/bulk-send-cli.test.js
```

Expected: FAIL on `treats a git failure as BEHIND, never as clean`. Restore it, re-run, confirm PASS and a clean `git diff --stat scripts/bulk-send.mjs`.

- [ ] **Step 6: Drive one real dry run against production**

```bash
cd ~/iCode/projects/rrm-academy-cf
printf 'A test subject that is never sent' > /tmp/bulk-subject.txt
printf '<p>A test body that is never sent.</p>' > /tmp/bulk-body.html
node scripts/bulk-send.mjs --campaign dry-run-proof --subject /tmp/bulk-subject.txt --body /tmp/bulk-body.html
```

Expected: exit 5 with `bulk_first_send_required`, because `mail_domain_state` is empty and this is a dry run, which is exactly correct: the gate is live and the CLI reports it as its own exit code rather than a generic failure. Nothing was sent.

- [ ] **Step 7: Add the npm script and commit**

Add to `package.json` `scripts`: `"bulk-send": "node scripts/bulk-send.mjs"`. Then:

```bash
cd ~/iCode/projects/rrm-academy-cf
cat > /tmp/rac-commit.txt <<'MSG'
scripts: bulk-send.mjs, the dry-run-by-default bulk driver

It holds no SES credential, and a test asserts that by reading the file
for AWS keys and aws4fetch: only the Pages Function holds an SES key on
this estate. The CLI reads ADMIN_API_SECRET from 1Password and calls
the endpoint.

It refuses a checkout behind origin/main. A send driven from a stale
clone can be running against copy, exclusions or policy that were
superseded, and unlike a bad deploy there is no rollback for mail that
has already left. A git command that THROWS resolves to BEHIND, never
to clean, and that case is mutation-proved.

Exit codes are distinct so a wrapper can branch without parsing prose:
3 stale checkout, 4 paused, 5 first-send gate, 6 cap exhausted.

Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 5.4

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git add scripts/bulk-send.mjs test/bulk-send-cli.test.js package.json
git commit -F /tmp/rac-commit.txt
```

---

## Task 9: `tools/mail-cap/send-cap.sh`, the 300 cap on both Macs

The Warm lane is a personal Workspace send from a human mailbox, and its cap is the one rule that has to hold on a machine no CI can see. This wrapper counts the recipient file and refuses over 300, naming the bulk rail in the refusal so the operator is told where the run belongs instead of just being stopped. The DWD `gmail.send` key on Naomi's iMac is not removed; the cap is what changes.

**Files:**
- Create: `~/iCode/tools/mail-cap/send-cap.sh`
- Create: `~/iCode/tools/mail-cap/README.md`
- Test: `~/iCode/tools/mail-cap/test/send-cap.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `send-cap.sh <recipient-file> <command> [args...]` -- exits 2 and runs nothing when the file holds more than `MAIL_CAP_MAX` (default 300) non-blank lines; otherwise execs the command and returns its exit code. Exits 2 with its own message when the file is missing or unreadable.
  - Environment overrides, both read at start: `MAIL_CAP_MAX` (integer, default 300) and `MAIL_CAP_RUN_LOG_DIR` (default `$HOME/iCode/.run-log/mail-cap`).
  - Run-log line format, appended to `<run-log-dir>/send-cap.log`: `<ISO8601 UTC>\t<allowed|refused>\tcount=<n>\tmax=<n>\tfile=<path>\tcmd=<argv0>`.

- [ ] **Step 1: Write the failing test**

Create `~/iCode/tools/mail-cap/test/send-cap.test.mjs`:

```js
/**
 * EXECUTED tests for tools/mail-cap/send-cap.sh.
 *
 * This wrapper is the only thing standing between a 3,000-name roster and the
 * apex Workspace identity, on two Macs no CI can reach. So the counting rules
 * are tested at the boundary and in the shapes a real roster actually arrives
 * in: CRLF line endings from a spreadsheet export, and a trailing blank line
 * from every editor that ends a file properly.
 *
 * A blank line is NOT a recipient, and a CR is NOT a character that changes the
 * count. Get either wrong and the cap is off by one in a direction nobody
 * notices until it matters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'send-cap.sh');

/** Runs the wrapper over a roster, returning { code, stdout, stderr, log }. */
function run(lines, { max, eol = '\n', trailing = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mail-cap-'));
  const roster = join(dir, 'roster.txt');
  const logDir = join(dir, 'log');
  mkdirSync(logDir, { recursive: true });
  writeFileSync(roster, lines.join(eol) + eol + trailing);
  const env = { ...process.env, MAIL_CAP_RUN_LOG_DIR: logDir };
  if (max !== undefined) env.MAIL_CAP_MAX = String(max);
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('bash', [SCRIPT, roster, 'printf', 'RAN'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    code = err.status;
    stdout = err.stdout || '';
    stderr = err.stderr || '';
  }
  const logPath = join(logDir, 'send-cap.log');
  return { code, stdout, stderr, log: existsSync(logPath) ? readFileSync(logPath, 'utf8') : '' };
}

const roster = (n) => Array.from({ length: n }, (_, i) => `r${i}@example.com`);

test('300 recipients pass, and the wrapped command runs', () => {
  const r = run(roster(300));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'RAN');
  assert.match(r.log, /\tallowed\tcount=300\tmax=300\t/);
});

test('301 recipients are refused, and the wrapped command never runs', () => {
  const r = run(roster(301));
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '', 'the command must not have run');
  assert.match(r.log, /\trefused\tcount=301\tmax=300\t/);
});

test('the refusal names the bulk rail, so the operator is told where the run belongs', () => {
  const r = run(roster(301));
  assert.match(r.stderr, /bulk rail/i);
  assert.match(r.stderr, /newsletter@rrmacademy\.com|bulk-send/);
});

test('CRLF line endings do not change the count', () => {
  assert.equal(run(roster(300), { eol: '\r\n' }).code, 0);
  const over = run(roster(301), { eol: '\r\n' });
  assert.equal(over.code, 2);
  assert.match(over.log, /count=301/);
});

test('blank lines are not recipients', () => {
  const withBlanks = run(roster(300), { trailing: '\n\n   \n\t\n' });
  assert.equal(withBlanks.code, 0);
  assert.match(withBlanks.log, /count=300/);
});

test('blank lines cannot hide a 301st recipient', () => {
  const r = run([...roster(301)], { trailing: '\n\n' });
  assert.equal(r.code, 2);
  assert.match(r.log, /count=301/);
});

test('a missing recipient file is refused, never treated as an empty roster', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mail-cap-'));
  let code = 0;
  let stderr = '';
  try {
    execFileSync('bash', [SCRIPT, join(dir, 'nope.txt'), 'printf', 'RAN'],
      { env: { ...process.env, MAIL_CAP_RUN_LOG_DIR: dir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) { code = err.status; stderr = err.stderr || ''; }
  assert.equal(code, 2);
  assert.match(stderr, /recipient file/i);
});

test('the wrapped command exit code is passed through, not swallowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mail-cap-'));
  const roster = join(dir, 'r.txt');
  writeFileSync(roster, 'a@example.com\n');
  let code = 0;
  try {
    execFileSync('bash', [SCRIPT, roster, 'bash', '-c', 'exit 17'],
      { env: { ...process.env, MAIL_CAP_RUN_LOG_DIR: dir }, encoding: 'utf8', stdio: 'ignore' });
  } catch (err) { code = err.status; }
  assert.equal(code, 17);
});

test('MAIL_CAP_MAX lowers the cap but the default is 300 when it is unset', () => {
  assert.equal(run(roster(11), { max: 10 }).code, 2);
  assert.equal(run(roster(10), { max: 10 }).code, 0);
  assert.equal(run(roster(300)).code, 0, 'unset means 300, never unlimited');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/iCode/tools/mail-cap && node --test test/send-cap.test.mjs
```

Expected: FAIL, every test, because `send-cap.sh` does not exist yet (`bash: .../send-cap.sh: No such file or directory`, exit 127).

- [ ] **Step 3: Write the wrapper**

Create `~/iCode/tools/mail-cap/send-cap.sh`:

```bash
#!/usr/bin/env bash
#
# THE WARM LANE'S HARD CAP, ON EVERY MACHINE.
#
#   send-cap.sh <recipient-file> <command> [args...]
#
# The Warm lane is a personal Workspace send from a human mailbox to a Gmail
# Primary tab, paced, one message at a time. It is reserved for paying STUC
# members and it is capped at 300 recipients per run. The cap exists because
# the 2026-09-06 to 09-08 drip sent about 2,880 messages that way and put a
# 0.55% user-reported spam day on rrmacademy.org in Google Postmaster Tools --
# above the 0.3% policy line -- flipping the domain's Compliance status to
# "Needs work", a verdict every transactional send from the domain shares.
#
# This wrapper is what makes the cap real on a Mac, where no CI can see it. It
# counts the recipient file, refuses over the cap NAMING THE BULK RAIL so the
# operator is told where the run belongs rather than merely being stopped, logs
# every outcome, and otherwise execs the command it was given.
#
# The DWD gmail.send key on Naomi's iMac is not removed. The cap is what changes.
#
# COUNTING RULES, both tested at the boundary:
#   - a BLANK line is not a recipient (every editor ends a file with one)
#   - a CARRIAGE RETURN is not a character that changes the count (spreadsheet
#     exports arrive CRLF, and counting raw bytes would be off by nothing here
#     but off by one the first time somebody greps the file instead)
#
# EXIT CODES:
#   2  refused: over the cap, or the recipient file is missing or unreadable
#   *  otherwise, whatever the wrapped command exits with, passed through
#
# Install on both Macs: this file is the single copy, in ~/iCode/tools/mail-cap.
# Spec: rrm-academy-cf docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 6.
set -uo pipefail

MAIL_CAP_MAX="${MAIL_CAP_MAX:-300}"
RUN_LOG_DIR="${MAIL_CAP_RUN_LOG_DIR:-$HOME/iCode/.run-log/mail-cap}"
RUN_LOG="$RUN_LOG_DIR/send-cap.log"

usage() {
  echo "usage: send-cap.sh <recipient-file> <command> [args...]" >&2
  exit 2
}

[ "$#" -ge 2 ] || usage
ROSTER="$1"; shift

mkdir -p "$RUN_LOG_DIR" 2>/dev/null || true

log_line() {
  printf '%s\t%s\tcount=%s\tmax=%s\tfile=%s\tcmd=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$MAIL_CAP_MAX" "$ROSTER" "$3" >> "$RUN_LOG" 2>/dev/null || true
}

if [ ! -r "$ROSTER" ]; then
  echo "REFUSED: recipient file not readable: $ROSTER" >&2
  echo "A missing roster is not an empty one. Check the path before re-running." >&2
  log_line refused 0 "$1"
  exit 2
fi

# Strip CR, then count lines holding at least one non-whitespace character.
# grep -c exits 1 when nothing matches, which is a count of zero, not an error.
COUNT=$(tr -d '\r' < "$ROSTER" | grep -c '[^[:space:]]' || true)
COUNT=${COUNT:-0}

if [ "$COUNT" -gt "$MAIL_CAP_MAX" ]; then
  cat >&2 <<MSG
REFUSED: $COUNT recipients is over the Warm lane cap of $MAIL_CAP_MAX.

The Warm lane is a personal Workspace send, reserved for paying STUC members.
A run this size belongs on the BULK RAIL, which sends as
newsletter@rrmacademy.com through SES under a warm-up ramp, a daily cap and a
complaint circuit breaker:

  cd ~/iCode/projects/rrm-academy-cf
  node scripts/bulk-send.mjs --campaign <key> --subject <file> --body <file>

That is a dry run. It prints the audience after exclusions, today's remaining
cap and the cohort head before anything is sent.
MSG
  log_line refused "$COUNT" "$1"
  exit 2
fi

log_line allowed "$COUNT" "$1"
exec "$@"
```

Then `chmod +x ~/iCode/tools/mail-cap/send-cap.sh`.

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ~/iCode/tools/mail-cap && node --test test/send-cap.test.mjs
```

Expected: PASS, 9 tests, 0 failing.

- [ ] **Step 5: MUTATION PROOF -- the cap actually caps**

Change the comparison in `send-cap.sh` from `-gt` to `-ge`, which is the off-by-one that silently refuses a legitimate 300-name run, then change it to `if false; then` which is the off-by-one that silently allows everything. Run the suite after each:

```bash
cd ~/iCode/tools/mail-cap && node --test test/send-cap.test.mjs
```

Expected: with `-ge`, FAIL on `300 recipients pass, and the wrapped command runs` and on `MAIL_CAP_MAX lowers the cap but the default is 300 when it is unset`. With `if false`, FAIL on `301 recipients are refused, and the wrapped command never runs`, `the refusal names the bulk rail`, `CRLF line endings do not change the count` and `blank lines cannot hide a 301st recipient`. Restore `-gt`, re-run, confirm PASS.

- [ ] **Step 6: MUTATION PROOF -- the CR strip actually matters**

Remove `tr -d '\r' |` from the COUNT line and re-run. Expected: the CRLF tests still pass under GNU and BSD grep, because `[^[:space:]]` treats CR as whitespace. That is the point of running the proof: it shows the strip is belt-and-braces here rather than load-bearing, so nobody later removes the `[^[:space:]]` class believing `tr` is carrying it. Restore the `tr` and record this finding in the README's Counting rules section.

- [ ] **Step 7: Write the README**

Create `~/iCode/tools/mail-cap/README.md`:

```markdown
# mail-cap

The Warm lane's hard 300-recipient cap, on every machine.

## What it is for

The Warm lane is a personal Google Workspace send from a human mailbox
(`"Dr. Naomi Whittaker" <community@rrmacademy.org>`, a verified send-as on
`virtualassistant@`) to a Gmail Primary tab, paced at 50 seconds. It is reserved
for paying STUC members and capped at 300 recipients per run, hard.

The cap exists because the 2026-09-06 to 09-08 drip sent about 2,880 messages
that way and put a 0.55% user-reported spam day on rrmacademy.org in Google
Postmaster Tools, above the 0.3% policy line, flipping the domain's Compliance
status to "Needs work". Everything sent as rrmacademy.org shares that verdict,
transactional mail included.

Anything larger belongs on the bulk rail, which sends as
`newsletter@rrmacademy.com` through SES under a ramp table, a daily cap and a
complaint circuit breaker. The refusal message says so and gives the command.

## Use

    bash ~/iCode/tools/mail-cap/send-cap.sh <recipient-file> <command> [args...]

For the existing drip:

    bash ~/iCode/tools/mail-cap/send-cap.sh /tmp/laneA-roster.csv \
      zsh ~/iCode/projects/rrm-academy-cf/scripts/workspace-drip-send.sh

## Exit codes

| Code | Meaning |
|---|---|
| 2 | Refused: over the cap, or the recipient file is missing or unreadable |
| anything else | Whatever the wrapped command exited with, passed through |

## Counting rules

A blank line is not a recipient. A carriage return is not a character that
changes the count.

Both are tested at the boundary, 300 and 301. The `tr -d '\r'` is belt and
braces rather than load-bearing: `grep -c '[^[:space:]]'` already treats CR as
whitespace, which the mutation proof in the build plan confirmed. Keep both.
Removing the character class on the belief that `tr` is carrying it would break
the count.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `MAIL_CAP_MAX` | `300` | Lower it for a test. Unset means 300, never unlimited. |
| `MAIL_CAP_RUN_LOG_DIR` | `$HOME/iCode/.run-log/mail-cap` | The run log lives outside any repository: it holds operational timestamps, not code. |

## Run log

Every outcome, refusals included, appends one tab-separated line to
`<run-log-dir>/send-cap.log`:

    2026-09-20T14:03:11Z	refused	count=412	max=300	file=/tmp/roster.csv	cmd=zsh

## Both Macs

This file is the single copy. `~/iCode` is cloned on the blue iMac, the MacBook
and Naomi's iMac, so the wrapper arrives with a pull. The DWD `gmail.send` key
on Naomi's iMac is NOT removed; the cap is what changes.

## Tests

    cd ~/iCode/tools/mail-cap && node --test test/send-cap.test.mjs
```

- [ ] **Step 8: Prove it on the second Mac**

On the MacBook (and on Naomi's iMac when next reachable):

```bash
cd ~/iCode && git pull --ff-only
seq 1 301 | sed 's/$/@example.com/' > /tmp/roster-301.txt
seq 1 300 | sed 's/$/@example.com/' > /tmp/roster-300.txt
bash ~/iCode/tools/mail-cap/send-cap.sh /tmp/roster-301.txt echo SENT; echo "exit=$?"
bash ~/iCode/tools/mail-cap/send-cap.sh /tmp/roster-300.txt echo SENT; echo "exit=$?"
cat ~/iCode/.run-log/mail-cap/send-cap.log
```

Expected: the first prints the bulk-rail refusal and `exit=2`; the second prints `SENT` then `exit=0`; the log holds one `refused count=301` line and one `allowed count=300` line. Spec section 10 asks for exactly this on both Macs.

- [ ] **Step 9: Commit**

```bash
cd ~/iCode
cat > /tmp/tools-commit.txt <<'MSG'
tools/mail-cap: the Warm lane's hard 300 cap, on every machine

The Warm lane is a personal Workspace send to a Gmail Primary tab,
reserved for paying STUC members. The cap exists because the
2026-09-06 to 09-08 drip sent about 2,880 messages that way and put a
0.55% user-reported spam day on rrmacademy.org, above Google's 0.3%
line, flipping the domain's Compliance status to "Needs work" -- a
verdict every transactional send from the domain shares.

This wrapper is what makes the cap real on a Mac, where no CI can see
it. It refuses NAMING THE BULK RAIL and giving the command, so the
operator is told where a large run belongs rather than merely being
stopped, and it logs every outcome including every refusal.

Counting is tested at the boundary in the shapes a real roster arrives
in: 300 passes, 301 refuses, CRLF does not change the count, blank
lines are not recipients and cannot hide a 301st. Mutation-proved both
ways: -ge for -gt reddens the 300 case, and a disabled comparison
reddens four others.

The DWD gmail.send key on Naomi's iMac is not removed. The cap is what
changes.

Spec: rrm-academy-cf docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 6

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git add tools/mail-cap/send-cap.sh tools/mail-cap/README.md tools/mail-cap/test/send-cap.test.mjs
git commit -F /tmp/tools-commit.txt
```

---

## Task 10: The observatory daemon `bulk-mail-health`

One task, in `~/iCode/projects/rrm-observatory`. Daily. It reads three things and refuses to pretend about any of them.

**Where the SES numbers come from, and why.** The spec asks for "SES complaint rate, bounce rate and sent count for `rrm-bulk`". SES publishes per-configuration-set rates only through CloudWatch, which would need a CloudWatch event destination on the set, a second AWS permission on the observatory's key, and a metric-math query. The same events are already in D1: the `rrm-bulk` SNS destination feeds `functions/api/email/events.js`, which writes one `email_event` row per recipient per event, and the bulk send path writes a matching `email_log` row with the SES message id. So the daemon counts the SES events themselves, joined to the campaign, out of the `AUTH_DB` binding it already holds. It also reads SES v2 `GetAccount` for `EnforcementStatus`, which is the one fact D1 cannot hold. Recorded here so nobody later reads "reads D1" as a shortcut around SES.

**Files:**
- Create: `~/iCode/projects/rrm-observatory/src/daemons/bulk-mail-health.js`
- Modify: `~/iCode/projects/rrm-observatory/src/daemons/_manifest.js` (one import, one REGISTRY entry)
- Modify: `~/iCode/projects/rrm-observatory/docs/superpowers/specs/2026-05-20-daemon-fleet-spec.md` (one registry row, required by `tools/check-spec-manifest-parity.mjs`)
- Test: `~/iCode/projects/rrm-observatory/tests/bulk-mail-health.test.mjs`

**Interfaces:**
- Consumes: D1 `rrm-auth` via the existing `AUTH_DB` binding; tables `email_log`, `email_event`, `send_paused` (Task 2), `mail_domain_state` (Task 2). SES v2 `GET /v2/email/account` via `aws4fetch`, the same call `src/health-checks.js` already makes.
- Produces: a default-exported daemon object with `name: 'bulk-mail-health'`, `domain: 'Infra/Deploy'`, `cadence: '20 12 * * *'`, `alertSink: ['digest', 'email']`, `alertSeverity: 'fail'`, and `run(env)` returning `{ recordsRead, recordsWritten, status: 'ok'|'warn'|'fail', shortReason, action? }`.
- New Worker secrets it reads, all optional and all warn-skipping when absent: `POSTMASTER_CLIENT_ID`, `POSTMASTER_CLIENT_SECRET`, `POSTMASTER_REFRESH_TOKEN`.

- [ ] **Step 1: Write the failing test**

Create `~/iCode/projects/rrm-observatory/tests/bulk-mail-health.test.mjs`:

```js
/**
 * EXECUTED tests for the bulk-mail-health daemon.
 *
 * Its whole job is to be the backstop for the hours when the in-request circuit
 * breaker cannot help: the breaker refuses to judge a ratio below 50 sends in
 * the trailing 24 hours, which is deliberate fail-open, and the first hours of
 * every warm-up day are exactly that window. So the cases that matter most here
 * are the ones where it must NOT report ok: a missing binding, an unreadable
 * Postmaster answer, an unreachable SES. Silence and health must never render
 * the same.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import daemon from '../src/daemons/bulk-mail-health.js';

/** A D1-shaped stub that answers by SQL substring, like the fleet's others. */
function db(answers = {}) {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          for (const [needle, spec] of Object.entries(answers)) {
            if (sql.includes(needle)) return spec.first ?? null;
          }
          return null;
        },
        async all() {
          for (const [needle, spec] of Object.entries(answers)) {
            if (sql.includes(needle)) return { results: spec.all ?? [] };
          }
          return { results: [] };
        },
      };
    },
  };
}

const HEALTHY_SES = { SendingEnabled: true, EnforcementStatus: 'HEALTHY', ProductionAccessEnabled: true };

function env(over = {}) {
  return {
    AUTH_DB: db(),
    AWS_ACCESS_KEY_ID: 'k',
    AWS_SECRET_ACCESS_KEY: 's',
    AWS_SES_REGION: 'us-east-1',
    POSTMASTER_CLIENT_ID: 'cid',
    POSTMASTER_CLIENT_SECRET: 'csec',
    POSTMASTER_REFRESH_TOKEN: 'rt',
    ...over,
  };
}

/** Routes the three external hosts the daemon talks to. */
function stubFetch({ ses = HEALTHY_SES, spam = {}, tokenFails = false } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    if (url.includes('amazonaws.com')) return new Response(JSON.stringify(ses), { status: 200 });
    if (url.includes('oauth2.googleapis.com')) {
      if (tokenFails) return new Response('nope', { status: 400 });
      return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('gmailpostmastertools.googleapis.com')) {
      const domain = url.includes('rrmacademy.com') ? 'rrmacademy.com' : 'rrmacademy.org';
      const answer = spam[domain];
      if (answer === undefined) return new Response('{}', { status: 404 });
      if (answer === null) return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ userReportedSpamRatio: answer }), { status: 200 });
    }
    throw new Error(`unrouted fetch to ${url}`);
  };
  return () => { globalThis.fetch = original; };
}

test('a quiet day with no bulk sends is ok, and says so without inventing a rate', async () => {
  const restore = stubFetch({ spam: { 'rrmacademy.org': 0.0005, 'rrmacademy.com': 0.0004 } });
  const r = await daemon.run(env({
    AUTH_DB: db({
      "FROM email_log": { first: { c: 0 } },
      "FROM email_event": { all: [] },
      "FROM send_paused": { all: [] },
      "FROM mail_domain_state": { first: { first_send_at: null, day: null, sent_today: 0 } },
    }),
  }));
  restore();
  assert.equal(r.status, 'ok');
  assert.match(r.shortReason, /0 bulk sends/);
  assert.ok(!/NaN|Infinity/.test(r.shortReason));
});

test('fails when the 24h complaint rate is at or over 0.2%', async () => {
  const restore = stubFetch({ spam: { 'rrmacademy.org': 0.001, 'rrmacademy.com': 0.001 } });
  const r = await daemon.run(env({
    AUTH_DB: db({
      "FROM email_log": { first: { c: 1000 } },
      "FROM email_event": { all: [{ event_type: 'complaint', bounce_type: null, c: 2 }] },
      "FROM send_paused": { all: [] },
      "FROM mail_domain_state": { first: { first_send_at: '2026-09-20T00:00:00Z', day: '2026-09-21', sent_today: 500 } },
    }),
  }));
  restore();
  assert.equal(r.status, 'fail');
  assert.match(r.shortReason, /complaint/i);
});

test('fails when a Postmaster spam rate is at or over 0.3% on either domain, naming it', async () => {
  const restore = stubFetch({ spam: { 'rrmacademy.org': 0.003, 'rrmacademy.com': 0.0001 } });
  const r = await daemon.run(env({ AUTH_DB: db({ "FROM email_log": { first: { c: 10 } } }) }));
  restore();
  assert.equal(r.status, 'fail');
  assert.match(r.shortReason, /rrmacademy\.org/);
  assert.match(r.shortReason, /0\.3|spam/i);
});

test('fails and NAMES THE CAMPAIGN when a send_paused row is open', async () => {
  const restore = stubFetch({ spam: { 'rrmacademy.org': 0.0001, 'rrmacademy.com': 0.0001 } });
  const r = await daemon.run(env({
    AUTH_DB: db({
      "FROM email_log": { first: { c: 100 } },
      "FROM email_event": { all: [] },
      "FROM send_paused": { all: [{ campaign: 'sept-letter', reason: 'complaint-rate', paused_at: '2026-09-21 04:00:00' }] },
      "FROM mail_domain_state": { first: { first_send_at: '2026-09-20T00:00:00Z', day: '2026-09-21', sent_today: 100 } },
    }),
  }));
  restore();
  assert.equal(r.status, 'fail');
  assert.match(r.shortReason, /sept-letter/);
  assert.match(r.shortReason, /complaint-rate/);
});

test('fails when SES enforcement is not HEALTHY', async () => {
  const restore = stubFetch({ ses: { SendingEnabled: true, EnforcementStatus: 'PROBATION' }, spam: { 'rrmacademy.org': 0.0001, 'rrmacademy.com': 0.0001 } });
  const r = await daemon.run(env({ AUTH_DB: db({ "FROM email_log": { first: { c: 10 } } }) }));
  restore();
  assert.equal(r.status, 'fail');
  assert.match(r.shortReason, /PROBATION/);
});

test('an unbound AUTH_DB is a fail, never an ok with zero rows', async () => {
  const restore = stubFetch({ spam: { 'rrmacademy.org': 0.0001, 'rrmacademy.com': 0.0001 } });
  const r = await daemon.run(env({ AUTH_DB: undefined }));
  restore();
  assert.equal(r.status, 'fail');
  assert.match(r.shortReason, /AUTH_DB/);
});

test('an unreadable Postmaster half WARNS and refuses to judge, it does not report ok', async () => {
  const restore = stubFetch({ spam: { 'rrmacademy.org': null, 'rrmacademy.com': 0.0001 } });
  const r = await daemon.run(env({ AUTH_DB: db({ "FROM email_log": { first: { c: 10 } } }) }));
  restore();
  assert.equal(r.status, 'warn');
  assert.match(r.shortReason, /postmaster/i);
});

test('absent Postmaster credentials WARN rather than silently dropping the backstop', async () => {
  const restore = stubFetch({ spam: {} });
  const r = await daemon.run(env({
    POSTMASTER_REFRESH_TOKEN: undefined,
    AUTH_DB: db({ "FROM email_log": { first: { c: 10 } } }),
  }));
  restore();
  assert.equal(r.status, 'warn');
  assert.match(r.shortReason, /credential|not configured/i);
});

test('a 404 from Postmaster for a day with no traffic is not a failure', async () => {
  const restore = stubFetch({ spam: {} });
  const r = await daemon.run(env({
    AUTH_DB: db({
      "FROM email_log": { first: { c: 0 } },
      "FROM email_event": { all: [] },
      "FROM send_paused": { all: [] },
      "FROM mail_domain_state": { first: { first_send_at: null } },
    }),
  }));
  restore();
  assert.equal(r.status, 'ok');
});

test('the registry entry is shaped the way the fleet validator demands', async () => {
  const { validateEntry } = await import('../src/daemons/_manifest.js');
  assert.deepEqual(validateEntry(daemon, 0), []);
  assert.equal(daemon.name, 'bulk-mail-health');
  assert.equal(daemon.alertSeverity, 'fail');
  assert.deepEqual(daemon.alertSink, ['digest', 'email']);
  assert.equal(daemon.quarantineUntil, null, 'armed at birth: a soak window on a deadman is the gap it exists to close');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/iCode/projects/rrm-observatory && node --test tests/bulk-mail-health.test.mjs
```

Expected: FAIL with `Cannot find module '../src/daemons/bulk-mail-health.js'`.

- [ ] **Step 3: Write the daemon**

Create `~/iCode/projects/rrm-observatory/src/daemons/bulk-mail-health.js`:

```js
// bulk-mail-health -- the daily reading on the bulk mail rail (rrmacademy.com).
//
// WHY IT EXISTS. The in-request circuit breaker in rrm-academy-cf's bulk send
// path refuses to judge a complaint ratio below 50 sends in the trailing 24
// hours. That is deliberate fail-open (one complaint out of three is 33% and
// means nothing), and the first hours of every warm-up day are exactly that
// window. This daemon is the backstop for those hours, and the only thing that
// reads Google's own verdict rather than our count of it.
//
// WHERE THE SES NUMBERS COME FROM. SES publishes per-configuration-set rates
// only through CloudWatch, which would need a CloudWatch event destination on
// the rrm-bulk set, a second AWS permission on this worker's key and a
// metric-math query. The same events are already in D1: the rrm-bulk SNS
// destination feeds rrm-academy-cf's /api/email/events, which writes one
// email_event row per recipient per event, and the bulk send path writes a
// matching email_log row carrying the SES message id. So this counts the SES
// events themselves, joined to the campaign. SES v2 GetAccount is still called,
// for EnforcementStatus, which is the one fact D1 cannot hold.
//
// WHAT IT REFUSES TO PRETEND ABOUT. An unbound AUTH_DB, an unreadable
// Postmaster answer and absent Postmaster credentials are all WARN or FAIL,
// never a quiet ok. Silence and health must not render the same, which is the
// standing lesson from worker-error-reporting.
//
// ARMED AT BIRTH (alertSink digest+email, quarantineUntil null): a soak window
// on a deadman is the gap it exists to close, the same call Brian made for
// adgrants-notices-watch and offsite-backup-freshness.
//
// Spec: rrm-academy-cf docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 7.
import { AwsClient } from 'aws4fetch';

const BULK_DOMAIN = 'rrmacademy.com';
const APEX_DOMAIN = 'rrmacademy.org';
const SOURCE_PREFIX = 'newsletter/bulk/%';
/** The breaker's own line. Google's published line is 0.3%; we trip first. */
const COMPLAINT_RATE_LIMIT = 0.002;
const BOUNCE_RATE_LIMIT = 0.02;
/** Google's line, from the sender guidelines. */
const SPAM_RATE_LIMIT = 0.003;
const DEADLINE_MS = 22000;

const pct = (n, d) => (d === 0 ? '0.000' : ((n / d) * 100).toFixed(3));

/** SES v2 GetAccount: the one fact D1 cannot hold. */
async function sesEnforcement(env, signal) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    return { ok: false, detail: 'SES credentials not bound' };
  }
  const region = env.AWS_SES_REGION || 'us-east-1';
  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region,
    service: 'ses',
  });
  try {
    const res = await aws.fetch(`https://email.${region}.amazonaws.com/v2/email/account`, { method: 'GET', signal });
    if (!res.ok) return { ok: false, detail: `SES API ${res.status}` };
    const data = await res.json();
    return {
      ok: true,
      sending: data.SendingEnabled,
      enforcement: data.EnforcementStatus || 'unknown',
    };
  } catch (err) {
    return { ok: false, detail: `SES unreachable (${String(err?.message || err).slice(0, 60)})` };
  }
}

/**
 * Google Postmaster Tools, read scope, administrator@. Yesterday's row, because
 * today's is not published until the day closes.
 *
 * Absent credentials WARN rather than skipping quietly: this is the only signal
 * in the system that comes from Google rather than from our own count, so
 * losing it is a real loss of coverage, not a configuration detail.
 */
async function postmasterSpamRates(env, signal) {
  if (!env.POSTMASTER_CLIENT_ID || !env.POSTMASTER_CLIENT_SECRET || !env.POSTMASTER_REFRESH_TOKEN) {
    return { ok: false, detail: 'Postmaster credentials not configured' };
  }
  let token;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.POSTMASTER_CLIENT_ID,
        client_secret: env.POSTMASTER_CLIENT_SECRET,
        refresh_token: env.POSTMASTER_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
      signal,
    });
    if (!res.ok) return { ok: false, detail: `Postmaster token ${res.status}` };
    ({ access_token: token } = await res.json());
  } catch (err) {
    return { ok: false, detail: `Postmaster token unreachable (${String(err?.message || err).slice(0, 60)})` };
  }

  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const rates = {};
  for (const domain of [APEX_DOMAIN, BULK_DOMAIN]) {
    try {
      const res = await fetch(
        `https://gmailpostmastertools.googleapis.com/v1beta1/domains/${domain}/trafficStats/${day}`,
        { headers: { Authorization: `Bearer ${token}` }, signal },
      );
      // A 404 is "no traffic that day", which is a real answer during warm-up.
      if (res.status === 404) { rates[domain] = null; continue; }
      if (!res.ok) return { ok: false, detail: `Postmaster ${domain} ${res.status}` };
      const data = await res.json();
      rates[domain] = typeof data.userReportedSpamRatio === 'number' ? data.userReportedSpamRatio : null;
    } catch (err) {
      return { ok: false, detail: `Postmaster ${domain} unreachable (${String(err?.message || err).slice(0, 60)})` };
    }
  }
  return { ok: true, rates, day };
}

export default {
  name: 'bulk-mail-health',
  domain: 'Infra/Deploy',
  cadence: '20 12 * * *',
  alertSink: ['digest', 'email'],
  secretRefs: [],
  enabled: true,
  ownerRepo: 'rrmadmin/rrm-academy-cf (the bulk send path) + AWS SES + Google Postmaster Tools',
  firstSeenAt: '2026-09-11',
  enabledSinceAt: '2026-09-11',
  quarantineUntil: null,
  alertSeverity: 'fail',
  config: { tags: ['email', 'bulk-rail', 'reputation', 'warm-up'] },

  async run(env) {
    const base = { recordsRead: 0, recordsWritten: 0 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
    try {
      if (!env?.AUTH_DB || typeof env.AUTH_DB.prepare !== 'function') {
        return { ...base, status: 'fail', shortReason: 'AUTH_DB unbound', action: 'bind AUTH_DB (rrm-auth) in wrangler.toml' };
      }
      const db = env.AUTH_DB;
      const since = new Date(Date.now() - 86400000).toISOString();

      let sent = 0;
      let complained = 0;
      let bounced = 0;
      let paused = [];
      let read = 0;
      try {
        const sentRow = await db.prepare(
          `SELECT COUNT(*) AS c FROM email_log
            WHERE event = 'send' AND source LIKE ? AND created_at >= datetime('now','-24 hours')`
        ).bind(SOURCE_PREFIX).first();
        sent = sentRow?.c || 0;
        read += 1;

        const events = (await db.prepare(
          `SELECT ev.event_type AS event_type, ev.bounce_type AS bounce_type, COUNT(*) AS c
             FROM email_event ev
             JOIN email_log el ON el.ses_message_id = ev.ses_message_id
            WHERE el.source LIKE ? AND el.event = 'send'
              AND ev.event_type IN ('complaint','bounce') AND ev.ts >= ?
            GROUP BY ev.event_type, ev.bounce_type`
        ).bind(SOURCE_PREFIX, since).all()).results || [];
        for (const row of events) {
          if (row.event_type === 'complaint') complained += row.c;
          else if (row.bounce_type === 'Permanent') bounced += row.c;
        }
        read += events.length;

        paused = (await db.prepare(
          'SELECT campaign, reason, paused_at FROM send_paused WHERE resumed_at IS NULL ORDER BY paused_at DESC LIMIT 10'
        ).all()).results || [];
        read += paused.length;
      } catch (err) {
        return { ...base, recordsRead: read, status: 'fail', shortReason: `D1 read failed (${String(err?.message || err).slice(0, 80)})` };
      }

      const [ses, pm] = await Promise.all([
        sesEnforcement(env, controller.signal),
        postmasterSpamRates(env, controller.signal),
      ]);

      const fails = [];
      const warns = [];

      if (paused.length) {
        fails.push(`paused: ${paused.map((p) => `${p.campaign} (${p.reason})`).join('; ')}`);
      }
      if (sent > 0) {
        if (complained / sent >= COMPLAINT_RATE_LIMIT) {
          fails.push(`complaint rate ${pct(complained, sent)}% (${complained}/${sent}) at or over 0.200%`);
        }
        if (bounced / sent >= BOUNCE_RATE_LIMIT) {
          fails.push(`hard bounce rate ${pct(bounced, sent)}% (${bounced}/${sent}) at or over 2.000%`);
        }
      }
      if (!ses.ok) warns.push(ses.detail);
      else if (!ses.sending || ses.enforcement !== 'HEALTHY') {
        fails.push(`SES enforcement ${ses.enforcement}, sending ${ses.sending ? 'on' : 'OFF'}`);
      }

      if (!pm.ok) {
        warns.push(pm.detail);
      } else {
        for (const [domain, ratio] of Object.entries(pm.rates)) {
          if (ratio === null) continue;
          if (ratio >= SPAM_RATE_LIMIT) {
            fails.push(`Postmaster spam rate ${(ratio * 100).toFixed(3)}% on ${domain} at or over 0.300% (${pm.day})`);
          }
        }
      }

      const summary = sent === 0
        ? `0 bulk sends in the trailing 24h`
        : `${sent} bulk sends, ${complained} complaints (${pct(complained, sent)}%), ${bounced} hard bounces (${pct(bounced, sent)}%) in the trailing 24h`;

      if (fails.length) {
        return {
          ...base, recordsRead: read, status: 'fail',
          shortReason: `${summary}; ${fails.join('; ')}`.slice(0, 300),
          action: 'read send_paused and the Postmaster dashboards before the next run; resume only with --resume',
        };
      }
      if (warns.length) {
        return {
          ...base, recordsRead: read, status: 'warn',
          shortReason: `${summary}; could not judge: ${warns.join('; ')}`.slice(0, 300),
        };
      }
      return { ...base, recordsRead: read, status: 'ok', shortReason: summary.slice(0, 300) };
    } finally {
      clearTimeout(timer);
    }
  },
};
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ~/iCode/projects/rrm-observatory && node --test tests/bulk-mail-health.test.mjs
```

Expected: PASS, 10 tests, 0 failing.

- [ ] **Step 5: Register the daemon**

In `src/daemons/_manifest.js`, add the import beside the other Infra/Deploy imports:

```js
// Bulk mail rail health (added 2026-09-11, ARMED AT BIRTH). The daily reading
// on rrmacademy.com's warm-up: trailing-24h complaint and bounce rates for the
// rrm-bulk configuration set counted out of email_event joined to email_log,
// any open send_paused row, SES EnforcementStatus, and the two Postmaster
// domains' own spam-rate rows. It is the backstop for the hours when the
// in-request breaker refuses to judge a sub-50-send sample, which is every
// warm-up morning.
import bulkMailHealth from './bulk-mail-health.js';
```

and add `bulkMailHealth,` to the `REGISTRY` array, next to `offsiteBackupFreshness,`.

- [ ] **Step 6: Add the spec registry row**

In `docs/superpowers/specs/2026-05-20-daemon-fleet-spec.md`, append after the `fsp-ci-proof-freshness` row:

```
| bulk-mail-health | Infra/Deploy | The daily reading on the bulk mail rail (rrmacademy.com): trailing-24h complaint and bounce rates for the rrm-bulk configuration set, counted out of email_event joined to email_log on ses_message_id, plus any open send_paused row, SES EnforcementStatus, and the two Postmaster domains' own spam-rate rows. Backstop for the hours when the in-request breaker refuses to judge a sub-50-send sample | `20 12 * * *` | D1 rrm-auth (email_log, email_event, send_paused), SES v2 GetAccount, Google Postmaster Tools API | open send_paused row / complaint rate >= 0.2% / hard bounce rate >= 2% / Postmaster spam rate >= 0.3% on either domain / SES enforcement not HEALTHY (fail), SES or Postmaster unreadable or uncredentialed (warn, refuses to judge) | n/a (read-only) | digest + email, armed at birth | rrm-observatory | NEW |
```

- [ ] **Step 7: Run the fleet gates**

```bash
cd ~/iCode/projects/rrm-observatory
node scripts/wave2-scaffold-checks.mjs && node tools/check-manifest-validates.mjs && node tools/check-spec-manifest-parity.mjs && npm test
```

Expected: all three gates exit 0, the manifest validator prints the new daemon count, the parity gate matches spec rows to REGISTRY names, and `npm test` is green.

- [ ] **Step 8: Mint the Postmaster credential and bind it**

```bash
cd ~/iCode/projects/rrm-observatory
# Mint an OAuth refresh token for administrator@rrmacademy.org with the scope
# https://www.googleapis.com/auth/postmaster.readonly via the /google-oauth-mint
# skill, then store it in 1Password and bind all three secrets:
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - Worker Deploy - account/credential')
export CLOUDFLARE_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a
op read 'op://Automation/RRM Postmaster Tools OAuth/client id'      | npx wrangler secret put POSTMASTER_CLIENT_ID
op read 'op://Automation/RRM Postmaster Tools OAuth/client secret'  | npx wrangler secret put POSTMASTER_CLIENT_SECRET
op read 'op://Automation/RRM Postmaster Tools OAuth/refresh token'  | npx wrangler secret put POSTMASTER_REFRESH_TOKEN
```

Expected: three `Success!` lines. Until they are bound the daemon WARNS rather than reporting ok, which is the intended behaviour and is tested.

- [ ] **Step 9: Deploy and force one tick**

```bash
cd ~/iCode/projects/rrm-observatory
node scripts/wave2-scaffold-checks.mjs && node tools/check-manifest-validates.mjs && node tools/check-spec-manifest-parity.mjs \
  && CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - Worker Deploy - account/credential') \
     CLOUDFLARE_ACCOUNT_ID=ecf2c5bc8b5ebd634bcb587b3890910a npx wrangler deploy
TOKEN=$(op read 'op://Automation/RRM Observatory API Token/credential')
curl -sS "https://rrm-observatory.administrator-cloudflare.workers.dev/api/daemons/run?name=bulk-mail-health" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
bash scripts/wave1-smoke.sh
```

Expected: the deploy succeeds after the three gates; the forced tick answers with `"status": "ok"` and a `shortReason` reading `0 bulk sends in the trailing 24h` (nothing has been sent yet, which is correct at this point in phase 1); `wave1-smoke.sh` reports 0 failures with its assertion count bumped by the new daemon.

- [ ] **Step 10: Commit**

```bash
cd ~/iCode/projects/rrm-observatory
cat > /tmp/obs-commit.txt <<'MSG'
daemon: bulk-mail-health, the daily reading on the bulk mail rail

The in-request circuit breaker in rrm-academy-cf's bulk send path
refuses to judge a complaint ratio below 50 sends in the trailing 24
hours. That is deliberate fail-open, and the first hours of every
warm-up day are exactly that window. This is the backstop for those
hours, and the only thing in the system reading Google's own verdict
rather than our count of it.

The SES numbers come from D1, and that is a decision, not a shortcut.
SES publishes per-configuration-set rates only through CloudWatch,
which would need a CloudWatch event destination on rrm-bulk, a second
AWS permission on this worker's key and a metric-math query. The same
events are already in D1: the rrm-bulk SNS destination feeds
/api/email/events, which writes one email_event row per recipient per
event, and the bulk path writes a matching email_log row carrying the
SES message id. SES v2 GetAccount is still called, for
EnforcementStatus, which is the one fact D1 cannot hold.

What it refuses to pretend about: an unbound AUTH_DB, an unreadable
Postmaster answer and absent Postmaster credentials are WARN or FAIL,
never a quiet ok. Silence and health must not render the same. A 404
from Postmaster IS a real answer during warm-up (no traffic that day)
and is not a failure.

ARMED AT BIRTH, no soak: a soak window on a deadman is the gap it
exists to close.

Spec: rrm-academy-cf docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 7

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
git add src/daemons/bulk-mail-health.js src/daemons/_manifest.js docs/superpowers/specs/2026-05-20-daemon-fleet-spec.md tests/bulk-mail-health.test.mjs
git commit -F /tmp/obs-commit.txt
```

---

## Handoff to phase 2

Not tasks. These are what phase 2 opens with, and phase 1 is not finished until each is possible.

1. **Seed tests before the first warm-up send** (`/mail-seed-test`). Gmail personal, Gmail Workspace, Outlook.com and an M365 tenant. Assert SPF, DKIM and DMARC all pass on `rrmacademy.com` and record which tab each landed in. Promotions is the accepted outcome on the Bulk lane; Spam is a stop.
2. **The first live send: 200 to the engaged head.** `node scripts/bulk-send.mjs --campaign <key> --subject <file> --body <file>` first, read the report, then the same command with `--send --first-send`. That one run records `mail_domain_state.first_send_at`, which is the fact everything in the ramp table counts from, so it is worth doing deliberately rather than as a side effect of a bigger send.
3. **Watch the SNS Delivery events arrive for it.** `SELECT event_type, COUNT(*) FROM email_event ev JOIN email_log el ON el.ses_message_id = ev.ses_message_id WHERE el.source LIKE 'newsletter/bulk/%' GROUP BY 1` should show `delivery` rows within minutes. No delivery rows means the SNS subscription is not live, whatever the AWS console says.
4. **Confirm Postmaster shows the day for rrmacademy.com.** Dashboards lag; the row appears the day after. The `bulk-mail-health` daemon will name it either way.
5. **The SES mailbox simulator legs.** `complaint@simulator.amazonses.com` and `bounce@simulator.amazonses.com` through the live bulk path, asserting the `email_event` rows and the `newsletter_subscriber.status` flips end to end. Deliberately phase 2: they consume real cap and must not run before the ramp is understood.
6. **Two to three weeks of real sends** to engaged cohorts under the ramp table, not test copy. Abort rule from the 2026-06-30 A/B, unchanged: over 1% unsubscribes on a send means the approach was wrong; stop and rewrite, do not push through.
7. **Then phase 3:** the 3,058 the September drip never reached, if wanted, engaged first, with Gianna's plain letter, or not at all. And DMARC to `p=quarantine` once two weeks of aggregate reports show only aligned traffic.

---

## Self-Review

### 1. Spec coverage

| Spec item | Task |
|---|---|
| §4 SES identity for `rrmacademy.com`, Easy DKIM, custom MAIL FROM `bounce.rrmacademy.com` | 1 (Steps 2 to 6, 9) |
| §4 DMARC `p=none` with `rua` during warm-up | 1 (Step 8); `p=quarantine` is phase 3, named in Handoff item 7 |
| §4 Google Postmaster Tools registration for rrmacademy.com | 1 (Step 18) |
| §4 Feedback-ID header on every bulk message | 3 (`feedbackId`), 6 (the header, asserted in "the message itself") |
| §4 Web face: zone keeps its 301, unsubscribe resolves on rrmacademy.org | 4 (`unsubscribeUrl` is unchanged and still built from `SITE_URL`); no zone change is made, which is the requirement |
| §4 Sender identities: `newsletter@` only | 0 (the exemption `from` list admits exactly that one address; every other local part is proved refused) |
| §5.0 Lane admission: exemption `from` list, `SES_SENDER_DOMAINS`, version bump, `hash`, `sync --apply`, kit tests green | 0 (all ten steps). **Spec gap found and closed here:** the granted-exemption branch also compared against a hardcoded domain pair that outranked `SES_SENDER_DOMAINS`, so the spec's two steps would not have been enough. |
| §5.0 Pre-mark hazard: `resolveLane()` preflight before any row, refusal writes nothing | 5 (`preflightLane`), 6 (gate 3, asserted by "a refused From aborts with NO D1 writes at all") |
| §5.1 Ramp table 200/500/1000/1500 keyed on domain age from `mail_domain_state` | 2 (the table), 3 (`RAMP_TABLE`, `dailyCap`, `domainAgeDays`) |
| §5.1 Cap is a ceiling; overflow truncated, remainder left for next day, engaged first | 3 (`truncateToAllowance`), 6 ("truncates to the day remaining allowance and reports the deferral") |
| §5.1 Per-run cap equals the day's remaining allowance; pacing 1 to 2 s | 3 (`remainingAllowance`), 6 (`BULK_PACING_MS = 1500`) |
| §5.1 First-ever send: missing row BLOCKS; `--first-send` creates it in its own write, then the run proceeds under the day 1 cap | 3 (`first-send-not-recorded`), 6 (gate 5), 8 (`--first-send`, exit code 5) |
| §5.1 Circuit breaker: 0.2% complaints or 2% hard bounces, `sent >= 50` only, writes `send_paused`, alerts, resumes only by `--resume` | 3 (`breakerVerdict`), 6 (gate 6 plus the open-pause gate), 8 (`--resume`, exit code 4), 10 (the alert) |
| §5.1 Log-write failure: `sent_today` in the same batch as the `email_log` insert; failure pauses with `log-write-failed` | 2 (the column), 6 ("a failed log batch PAUSES the run with reason log-write-failed") |
| §5.1 Cohort ordering, the two dead engagement columns kept, `source = 'website'` first | 3 (`COHORT_ORDER_SQL`, `compareCohort`), 6 (`BULK_AUDIENCE_SQL`) |
| §5.2 SES configuration set `rrm-bulk` publishing Bounce, Complaint, Delivery to SNS, subscribed to `events.js`, signature-verified, tested with a real event | 1 (Steps 10 to 17), 7 (the signed fixtures). Topic reuse is stated in 1 Step 12 and 7. |
| §5.2 Complaint sets `status='complained'`; Permanent bounce sets `'bounced'` and increments `bounce_count`, both in the same batch | 7 (asserted; the code already did this and was never exercised) |
| §5.2 SES account-level suppression stays on | 1 (Step 10 adds set-level suppression on top; the account list is untouched) |
| §5.3 One-click headers plus a visible link and the postal address | 4 (headers), and `_template.js` already renders the visible link and the postal address, asserted unchanged by Task 4 Step 5 |
| §5.3 `mailto:` alternative appended to `unsubscribeHeaders` | 4 |
| §5.3 Unsubscribe honored immediately | 4 (the round-trip tests) |
| §5.4 CLI: dry-run default, prints audience after exclusions, remaining cap, cohort head, campaign key; `--send` required; refuses behind `origin/main`; never holds SES credentials | 8 (all of it; the no-credential property is asserted by reading the file) |
| §5.5 Exclusions: already-sent for this campaign, consent statuses, STUC members, hard-exclude list | 6 (`BULK_AUDIENCE_SQL`'s four NOT EXISTS clauses; the suppression-tag clause carries the hard-exclude set the legacy path uses) |
| §5.5 Delivery outcome and logging outcome stay separate | 6 (the log batch is in its own try; a failure pauses and never reclassifies the delivered message, asserted) |
| §6 Only the Pages Function holds SES credentials | 8 (asserted by source scan) |
| §6 Shared `tools/mail-cap/send-cap.sh`, 300 cap, message naming the bulk rail, vendored to both Macs | 9 |
| §6 Run log per machine at `.run-log/mail-cap/` | 9 |
| §7 Observatory daemon `bulk-mail-health`, daily, SES + Postmaster, red at 0.2% / 0.3%, digest names the campaign | 10 |
| §7 `send_paused` rows page the same channel as the breaker | 10 (open rows are a `fail` on the `['digest','email']` sink) |
| §7 Weekly DMARC aggregate | phase 2 onward (the `/dmarc-report` skill reads the `rua` mailbox Task 1 Step 8 provisions; no build work) |
| §9 phase 1 task zero, SES identity, DNS, Postmaster, `rrm-bulk` + SNS, policy module, CLI, `send-cap.sh`, daemon, membership join, `mailto:` | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| §10 Lane admission tests | 0 (Step 1), 5 |
| §10 Policy unit tests, including both mutation proofs | 3 (Steps 1 to 8) |
| §10 Membership routing: paid and lapsed fixtures | 6 ("membership routing (spec section 3)", all three cases) |
| §10 Events endpoint: signed SNS Complaint and Bounce fixtures | 7 |
| §10 Events endpoint: live SES mailbox-simulator legs | phase 2 (Handoff item 5) |
| §10 Unsubscribe round trip | 4 |
| §10 Seed tests | phase 2 (Handoff item 1) |
| §10 Cap wrapper: 301 refused, 300 passes, both Macs, both in the run log | 9 (Steps 1 to 6 locally, Step 8 on the second Mac) |
| §10 Live proof of phase 1: one 200-recipient warm-up send, SNS Delivery observed, Postmaster shows the day | phase 2 (Handoff items 2, 3, 4) |
| §8 Audience policy | deliberately outside this build, per the spec |

Gaps: none. Two spec items are explicitly phase 2 by the spec's own text (seed tests, the live send) and are in the Handoff section rather than as tasks, as instructed.

### 2. Placeholder scan

Searched the plan for every pattern the writing-plans skill names.

- `TBD`, `TODO`, `implement later`, `fill in details`: 0 occurrences.
- "add appropriate error handling", "add validation", "handle edge cases": 0 occurrences. Every validation is written out (the `isCampaignKey` regex, the `cursor` refusal, the `BULK_FROM` 503, the recipient-file readability check).
- "Write tests for the above" with no test code: 0 occurrences. Every test step carries the full test file or the full appended block.
- "Similar to Task N": 0 occurrences. The repeated patterns (the `bulkMailD1` seed helpers, the SES stub, the commit ritual) are written out in each task that uses them.
- Steps describing what to do without showing how: 0. The only steps without a code block are Task 1's dashboard actions (Postmaster registration has no provisioning API), and those are numbered click-by-click.
- References to types, functions or methods not defined in any task: 0. Checked below.

One deliberate instruction that reads like a placeholder and is not: Task 7 Step 1 tells the implementer to delete the `makeSigner` stub before running, and Step 2 states the expected failure that stub produces. It is there because the test file is otherwise complete and an implementer pasting it verbatim needs to be told which four lines are scaffolding.

Two values an operator must paste from a screen, both unavoidable and both with the exact command around them: the Postmaster TXT verification value (Task 1 Step 18) and the SNS Topic ARN (Task 1 Step 11, captured into `$SES_TOPIC_ARN` and used by name thereafter).

### 3. Type consistency

Every symbol a later task calls, checked against where it is defined.

| Symbol | Defined | Used | Consistent |
|---|---|---|---|
| `resolveLane({entity, purpose, from, exemption}) -> string` | existing kit, modified Task 0 | Task 5 | yes |
| `LaneRefused` with `.reason`, `.detail` | existing kit | Tasks 0, 5, 6 | yes |
| `SES_SENDER_DOMAINS.rrma: string[]` | Task 0 | Task 0 test | yes |
| `preflightLane({from, category, purpose}) -> string` | Task 5 | Task 6 (`preflightLane({ from: env.BULK_FROM, category: 'newsletter' })`) | yes, same keys |
| `remainingAllowance(state, nowIso) -> {ok, reason, ageDays, cap, sentToday, remaining}` | Task 3 | Task 6 (reads `.ok`, `.reason`, `.remaining`, `.cap`, `.ageDays`, `.sentToday`) | yes, all six fields defined |
| `truncateToAllowance(recipients, remaining) -> {send, deferred}` | Task 3 | Task 6 (`const { send: page, deferred }`) | yes |
| `breakerVerdict({sent, complained, bounced}) -> {tripped, reason, detail}` | Task 3 | Task 6 (reads all three) | yes |
| `feedbackId(campaign, segment) -> string` | Task 3 | Task 6 (header and dry-run report) | yes |
| `isCampaignKey(value) -> boolean` | Task 3 | Task 6 (gate 1) | yes |
| `COHORT_ORDER_SQL: string` with alias `s.` | Task 3 | Task 6 (`ORDER BY ${COHORT_ORDER_SQL}` inside a query whose only alias is `s`) | yes |
| `BULK_DOMAIN: string` | Task 3 | Task 6 (`mail_domain_state` key), Task 10 (its own constant, deliberately not imported across repos) | yes |
| `PAUSE_LOG_WRITE_FAILED: string` | Task 3 | Task 6 (`pauseRun` reason) | yes |
| `unsubscribeHeaders(email, secret) -> Promise<object>` | existing, modified Task 4 | Task 6 (spread into `headers`) | yes, signature unchanged |
| `UNSUBSCRIBE_MAILTO: string` | Task 4 | Task 4 test, Task 6 test (the header regex) | yes |
| `renderEmail({body, sendId, subscriberId, email, secret}) -> {html, text}` | existing | Task 6 | yes |
| `sendRawEmail(env, {from,to,subject,html,text,replyTo,headers,configurationSet,log}) -> {messageId}` | existing | Task 6 (omits `log` deliberately, which is allowed: `log` is optional, `headers` is the required one) | yes |
| `mail_domain_state(domain, first_send_at, day, sent_today, updated_at)` | Task 2 | Tasks 3 (field names `first_send_at`, `day`, `sent_today`), 6, 10 | yes, identical names |
| `send_paused(id, campaign, reason, detail, paused_at, resumed_at)` | Task 2 | Tasks 6, 10 | yes |
| `bulkMailD1(opts)` | Task 2 | Tasks 6, 7 | yes |
| `BULK_MAIL_SCHEMA_SQL` | Task 2 | (exported for future harnesses; unused elsewhere, which is fine) | yes |
| `parseArgs`, `isBehindOrigin`, `renderReport`, `main` | Task 8 | Task 8 test only | yes |
| `send-cap.sh` exit 2, `MAIL_CAP_MAX`, `MAIL_CAP_RUN_LOG_DIR`, log line format | Task 9 | Task 9 test and README | yes |
| daemon `run(env) -> {recordsRead, recordsWritten, status, shortReason, action?}` | Task 10 | fleet runner (existing contract, matched against `offsite-backup-freshness`) | yes |

Two naming points worth stating rather than leaving to be noticed:

- `email_log.event` is `'send'` on the bulk path, not `'sent'`. That matches what `_ses.js`'s `depsFor()` already writes through the mail package, and both the breaker query (Task 6) and the daemon query (Task 10) filter on `event = 'send'`. The legacy `email_log` rows written by `unsubscribe.js` use `'unsubscribed'`, a different vocabulary entirely, and are untouched.
- `newsletter_event.event` stays `'sent'` on both paths, because that column's vocabulary is the newsletter surface's own and three existing readers depend on it.
