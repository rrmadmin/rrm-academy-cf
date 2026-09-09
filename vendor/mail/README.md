# mail

The estate's one outbound sender. It lives here, it is vendored into each
consumer at `vendor/mail/` by `console-kit sync`, and its bytes are sha-locked
in that consumer's `kit.lock.json`. Nine senders did this job before it, each
with its own SigV4 block, its own header sanitiser and its own hardcoded from
address; a fix now is one edit here plus a sync.

Files: `lanes.js` (the rules and the two error classes), `ses.js`, `graph.js`,
`cf-email.js` (the three rails), `index.js` (`send()` and the re-exports).

## The lane is not the sender's choice

Which rail may carry a message follows from the entity that owns it and the
purpose it serves, and `resolveLane()` is the only way to get one. It throws
`LaneRefused` when no lane may carry the message, so a consumer cannot quietly
pick the wrong rail by handing in the wrong client.

| entity | purpose | lane | the from address must be |
|---|---|---|---|
| `rrma` | `community`, `member`, `newsletter` | `workspace` | not sent here at all, see below, except under a named exemption |
| `rrma` | `transactional`, `system`, `receipt` | `ses_rrm` | `@mail.rrmacademy.org` or `@rrmacademy.org` |
| `rrmf` | `transactional`, `system`, `receipt` | `ses_rrm` | `@rrm.foundation` or `@mail.rrm.foundation` |
| `fsp` | any | `graph_fsp` | `@fivestarpractices.com` (`brian@` or an alias) |
| `neo` | any | `graph_neo` | `@neofertility.ie` |
| `clinic` | any | `cf_email`, or `graph_fsp` with `clinicRail: 'graph'` | the clinic's own sending domain, and `@fivestarpractices.com` on the graph rail |

Every `from` is accepted in display-name form (`Name <addr@host>`) as well as
bare; the domain check reads the address inside the wrapper.

`clinicRail` is a consumer config flag, never a per-message decision: `'cf'`
(the default) is what is live today, `'graph'` moves FSP client sites onto the
tenant rail the day that rail exists.

## The Workspace lane is a refusal, and that is the point

RRM community, member and newsletter mail goes out through the Workspace lane:
a personal send from a human mailbox to a Gmail Primary tab, driven by
`va-send.sh`. That has been the rule for a long time, and the 2026-09-08 survey
found SES callers doing it anyway, because a convention nobody can enforce is a
convention that drifts. Here it is enforced:

```js
const r = await send(env, { entity: 'rrma', purpose: 'newsletter', ... }, deps);
// { ok: false, lane: 'workspace', reason: 'workspace-lane-only', how: 'va-send.sh' }
```

That answer means the message is legitimate and this is not the thing that
sends it. A caller must route it through the Workspace lane. It must not retry,
and it must not fall back to SES; falling back is the exact behaviour the rule
exists to stop.

## Exemptions: two named sends, and no others

Brian ruled on 2026-09-09 that two RRM sends do belong on SES despite their
purpose. A send claims one by name, `EXEMPTIONS` in `lanes.js` is a closed
table, and a name that is not in it refuses with `unknown-exemption` rather
than falling through to the ordinary rule. There is no wildcard and no
`exempt: true`; adding a third exemption means editing that table.

| exemption | allowed `from` | why |
|---|---|---|
| `newsletter-blast` | `hello@rrmacademy.org`, `newsletter@mail.rrmacademy.org` | the newsletter product is a bulk send from `hello@rrmacademy.org` through SES with list-unsubscribe headers; the Workspace lane is one-at-a-time Gmail with a daily quota and refuses at volume |
| `stuc-overdue-outreach` | `community@rrmacademy.org` | member overdue outreach from `community@rrmacademy.org`; disarmed by `OVERDUE_EMAIL_ENABLED` today, revisit if it is ever armed |

```js
const r = await send(env, {
  entity: 'rrma',
  purpose: 'newsletter',
  from: '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>',
  exemption: 'newsletter-blast',
  ...
}, deps);
// { ok: true, lane: 'ses_rrm', id }
```

Each exemption is bound to its entity and to its own from addresses, and the
binding is the load-bearing half. The overdue-outreach exemption exists for one
mailbox's mail; without the binding, quoting its name would be a general
licence to put any RRM member mail on SES. The refusals are
`exemption-not-for-entity` and `exemption-sender-not-allowed`, and an exempt
send still has to come from an RRM Academy sending domain like any other
message on the rail.

A granted exemption is recorded, not just permitted: the AE detail blob is
prefixed `exemption=<name>` and the `email_log` row carries an `exemption`
column value, so "which sends used one" is answerable from the telemetry
rather than from the source. A refused send records `null`, never the name it
was refused for.

## Everything is injected

```js
send(env, msg, deps) -> { ok: true, lane, id } | { ok: false, lane, reason, status, detail }
```

`deps = { signer, fetch, kv, ae, logEmail }`, all optional, each needed by the
rails that use it:

- `signer` is the SES rail's SigV4 client, the consumer's own `aws4fetch`
  `AwsClient`. Anything with a `fetch(url, init)` method works. This is what
  keeps console-kit dependency-free, and it is why an SES lane with no signer
  answers `{ ok: false, reason: 'no-signer' }` rather than crashing.
- `fetch` drives the Graph and Cloudflare rails; it falls back to the global.
- `kv` is the Graph token cache, key `mail:graph:token`. With a namespace the
  token is shared across isolates (what neofertility-ie needs); without one it
  lives in an isolate-local variable (what fsp-intake-sheets needs, having no
  KV binding). Both are correct, so the package does both.
- `ae` gets one `writeDataPoint` per attempt, refusals included:
  `blobs: ['mail', lane, purpose, 'ok'|'error', detail (200 chars)]`,
  `doubles: [durationMs, 1, 0]`, `indexes: [lane]`.
- `logEmail(row)` is the consumer's own `email_log` inserter. The package never
  touches D1: the schema, the binding and the retention policy belong to the
  consumer. The row carries `{ event, email, category, source, subject, detail,
  send_id, ses_message_id, lane }`, and `lane` is the resolved lane, which is
  what rrm-academy-cf's existing `lane` column should now hold.

`env` supplies the rail's own bindings: `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `AWS_SES_REGION`, `SES_CONFIGURATION_SET` for SES;
`GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`,
`GRAPH_SENDER_UPN` for Graph; `EMAIL_SEND_ACCOUNT_ID`, `EMAIL_SEND_TOKEN` for
Cloudflare. There is no default from address anywhere in this package: an
adapter that wants one reads it out of its own env and passes it in.

## What every lane does the same way

- **Headers are sanitised before any transport sees them.** CR, LF and NUL are
  replaced with a space in `from`, `to`, `cc`, `replyTo`, `subject` and every
  custom header name and value. This is rrm-academy-cf's `sanitizeHeader` with
  one deliberate change: that copy THROWS on a control character and this one
  strips. A throw turns a hostile subject line typed into a public form into a
  500; a strip turns it into a harmless subject and lets the send proceed,
  which is what the guard was there to do.
- **Graph retries once, on 401 and 403 only, after minting a fresh token** (and
  evicting the KV entry first, so the next isolate does not inherit the token
  that just failed). Nothing else Graph answers gets better by being asked
  twice, and the retry never repeats.
- **SES never retries.** SESv2 answers 4xx for a request it will not accept and
  5xx for its own trouble; the callers here are cron ticks, webhooks and form
  handlers that already run again, and an internal retry is how a transient 500
  becomes two copies of the same receipt.
- **A permanent refusal throws `MailPermanent`**, and only that. SES codes
  `MessageRejected`, `MailFromDomainNotVerified`, the suspension and paused
  codes; Graph's non-existent mailbox errors; any non-empty
  `permanent_bounces` on the Cloudflare rail. It means record a failure and
  stop, never queue a retry. Every other failure is an `ok: false` answer.
- **Success is the transport's own success and nothing looser.** Graph is 202
  and only 202 (fsp-intake-sheets' rule, the stricter of the two merged). The
  Cloudflare rail is `success: true` plus no bounce, with `message_id` the only
  evidence a queued send leaves; do not add a check that the recipient appears
  in `result.delivered` or `result.queued`, because a real queued send answers
  with all three arrays empty.

## Shapes an adapter should know

- A message carrying custom `headers` goes out on SES as **Raw MIME**, because
  Raw is what carries `List-Unsubscribe`. Without headers it is Simple.
- `to` may be a string or an array. The Cloudflare rail takes the first
  recipient only and sends a bare address, both measured constraints of that
  API, not shortcuts.
- `attachments` pass through untouched to Graph as `fileAttachment` entries;
  the other two rails ignore them.
- `graphPayload`, on the Graph rail only, is POSTed verbatim in place of
  anything the package would compose. Graph's message shape carries more than a
  portable message does (a from display name, a named replyTo, inline
  attachments with content ids), and a consumer that uses those should keep
  composing its own body; what it gets from the package is the token, the
  cache, the one retry, the 202 rule, and the lane check, which still reads
  `from`. `timeoutMs` overrides the rail's 20s for one send, which is what a
  caller sending inside a request rather than a cron needs.
- `senderUpn` on the message overrides `env.GRAPH_SENDER_UPN` for one send,
  which is how neofertility-ie sends as `beacon@` while the from address reads
  `noreply@`.
