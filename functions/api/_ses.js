/**
 * THE SES ADAPTER. The SigV4 block, the MIME builder and the lane rules used
 * to live in this file; they now live in `vendor/mail/`, the estate's one
 * outbound sender, and what is left here is the thin layer that adapts it to
 * this repo: this repo's env, this repo's `email_log` table, this repo's
 * Analytics Engine binding, and this repo's calling convention.
 *
 * Every export this file has ever had is still here with its old signature,
 * because thirty-odd call sites import them and this change is meant to be
 * invisible to all of them. What moved is where the bytes come from.
 *
 * WHAT THE PACKAGE ADDS. It refuses. `resolveLane()` decides which rail may
 * carry a message from the entity that owns it and the purpose it serves, and
 * RRM community, member and newsletter mail belongs to the Workspace lane, a
 * personal send from a human mailbox, never SES. That was convention here for
 * a long time and convention is not enforcement. Two named sends are exempt,
 * by Brian's ruling of 2026-09-09, and only two: the newsletter blast and the
 * STUC overdue outreach. This adapter names the first of those, because the
 * newsletter endpoints in this repo are the thing the exemption exists for.
 *
 * PURPOSE, FROM THE CATEGORY THE CALLER ALREADY PASSES:
 *
 *   log.category            purpose          exemption
 *   ----------------------- ---------------- ------------------
 *   'newsletter'            'newsletter'     'newsletter-blast'
 *   'transactional'         'transactional'  none
 *   anything else, or none  'transactional'  none
 *
 * plus an explicit `purpose` on the options, which is how `_google-ads.js`
 * declares its alert mail `system` without inventing a log category for it.
 * The fallback is `transactional` rather than a refusal on purpose: every
 * caller in this repo sends transactional mail unless it says otherwise, and
 * a send failing because someone wrote a new category string would be this
 * change breaking mail it had no quarrel with.
 *
 * TWO THINGS ABOUT RETRIES, NEITHER OF THEM NEW POLICY. The package says it
 * never retries an SES call, and that is true of the package: what retries is
 * `aws4fetch`, whose AwsClient backs off and re-sends a 5xx up to ten times by
 * default. That was already the behaviour of the hand-rolled sender this file
 * replaces -- the same client, the same default -- so it is left alone rather
 * than silently changed in a refactor. It is worth knowing about: it is
 * exactly the "a transient 500 becomes two copies of the same receipt" shape
 * the package's own no-retry rule is written against, and if it should be
 * `retries: 0` that is a deliberate decision, made once, with the callers in
 * front of you.
 *
 * The one thing that IS new is a bound: the package hands SES a 15-second
 * AbortSignal, which this file never did, so the retry sequence can now end
 * in `ses-timeout` instead of running as long as ten backoffs take.
 *
 * SANITIZEHEADER IS STILL THE THROWING ONE. The package strips control
 * characters on the way out; this export throws on them, and it stays that
 * way because `_mail-lanes.js` uses it as VALIDATION when it composes its own
 * Workspace MIME. Both behaviours are wanted: the throw is a caller asserting
 * its input, the strip is the sender refusing to emit a split header. A
 * message that reaches the package unsanitised still cannot inject one.
 */
import { AwsClient } from 'aws4fetch';
import { send, MailPermanent, LaneRefused, resolveLane } from '../../vendor/mail/index.js';
import { r } from '../_report.js';

/** Every message this repo sends belongs to the Academy. */
const ENTITY = 'rrma';

/**
 * The newsletter's own senders, which are also the addresses the
 * `newsletter-blast` exemption is bound to in the package. A newsletter-
 * category send from anything else is refused there, by name, rather than
 * quietly going out over an exemption written for a different mailbox.
 */
const NEWSLETTER_PURPOSE = { purpose: 'newsletter', exemption: 'newsletter-blast' };

/**
 * Header validation for callers that compose their own MIME. THROWS, unlike
 * the package's stripping sanitiser. See the file header.
 */
export function sanitizeHeader(v) {
  const s = String(v ?? '');
  // eslint-disable-next-line no-control-regex -- intentional: block CRLF + NUL header injection
  if (/[\r\n\x00]/.test(s)) throw new Error('Header contains illegal control characters');
  return s.slice(0, 998);
}

export async function insertEmailLog(db, { event, email, category, source, subject, detail, send_id, ses_message_id, lane }) {
  try {
    await db.prepare(
      'INSERT INTO email_log (event, email, category, source, subject, detail, send_id, ses_message_id, lane) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      event,
      email.toLowerCase(),
      category,
      source,
      subject || null,
      detail ? String(detail).slice(0, 500) : null,
      send_id || null,
      ses_message_id || null,
      lane || 'ses',
    ).run();
  } catch (err) {
    console.error('insertEmailLog failed:', err.message);
  }
}

export async function logEmailFailure(db, { email, category, source, subject, detail }) {
  if (!db) return;
  await insertEmailLog(db, { event: 'failed', email, category, source, subject, detail });
}

/**
 * The purpose (and any exemption) a message asks for. An explicit `purpose`
 * wins; otherwise the log category decides, and anything unrecognised is
 * transactional. See the table in the file header.
 */
function purposeOf({ purpose, category }) {
  if (purpose) return { purpose };
  if (category === 'newsletter') return { ...NEWSLETTER_PURPOSE };
  return { purpose: 'transactional' };
}

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

/**
 * The deps the package needs, built out of this repo's bindings.
 *
 * `logEmail` forwards only the SUCCESS row. The package offers a row for
 * every outcome, but this repo's callers already write their own failure rows
 * through `logEmailFailure` in their catch blocks, and forwarding both would
 * double every failure in `email_log`. The row keeps the CALLER's category
 * rather than the package's purpose, so the column's values do not shift
 * under the historical rows; `lane` now carries the resolved lane
 * (`cf_rrm` or `ses_rrm`), which is what that column was added to hold. The
 * `exemption` the package hands over has no column of its own and is appended
 * to `source`, where the send that used it is already named.
 *
 * `fallback: 'ses'` is the watched-cutover flag, added 2026-09-09 with the
 * Cloudflare rail. Every sender in this repo already sends from
 * `@mail.rrmacademy.org`, the onboarded Email Sending subdomain, so the lane
 * rule now resolves them to `cf_rrm` on its own; the flag is the ONLY way
 * back to SES at runtime, and only when Cloudflare answers a 5xx or nothing
 * at all. A 4xx never falls back. It comes out, with the `AWS_*` secrets,
 * once a week of `email_log.lane` is clean.
 */
function depsFor(env, { db, category, source, subject }) {
  return {
    fallback: 'ses',
    signer: new AwsClient({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      region: regionOf(env),
      service: 'ses',
    }),
    // aeFor re-attributes the mail package's own row, which puts 'mail' in
    // blob1, to this worker: [rrm-academy, mail, <lane>, <status>, <purpose>
    // <detail>]. Passing env.EVENTS raw is what used to render mail activity
    // in the fleet view as a worker called "mail" that nobody deployed.
    ae: r.aeFor(env, 'mail'),
    logEmail: db
      ? async (row) => {
        if (row.event !== 'send') return;
        await insertEmailLog(db, {
          event: 'send',
          email: row.email,
          category,
          source: row.exemption ? `${source} (${row.exemption})` : source,
          subject,
          detail: row.detail,
          send_id: row.send_id,
          ses_message_id: row.ses_message_id,
          lane: row.lane,
        });
      }
      : undefined,
  };
}

/**
 * Translates the package's answer into this repo's convention. Callers here
 * expect `{ messageId }` on success and a THROW on failure, which is what
 * every one of their try/catch blocks is written against; the package answers
 * `{ ok: false, ... }` instead, so a refusal or a transport failure has to
 * become an Error here rather than silently reading as a send.
 *
 * `MailPermanent` is left to propagate. It is already an Error, and a caller
 * that catches everything treats it the way it treated the old permanent-
 * failure throw.
 */
function unwrap(result, what) {
  if (result.ok) return { messageId: result.id };
  const detail = result.detail ? `: ${String(result.detail).slice(0, 200)}` : '';
  throw new Error(`${what} failed (${result.reason}, status ${result.status})${detail}`);
}

function regionOf(env) {
  return env.AWS_SES_REGION || 'us-east-1';
}

function requireCredentials(env) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS SES credentials not configured');
  }
}

/**
 * Send a transactional-shaped message. SESv2 Simple format: no custom
 * headers, which is what separates it from `sendRawEmail` below.
 */
export async function sendEmail(env, { from, to, subject, html, text, replyTo, configurationSet, log, purpose }) {
  requireCredentials(env);
  const category = log?.category || 'transactional';
  const source = log?.source || '';
  const result = await send(
    env,
    {
      entity: ENTITY,
      ...purposeOf({ purpose, category }),
      from,
      to,
      subject,
      html,
      text,
      replyTo,
      configurationSet,
      source,
    },
    depsFor(env, { db: log?.db, category, source, subject }),
  );
  return unwrap(result, 'SES request');
}

/**
 * Send a raw MIME email via SESv2. Custom headers (`List-Unsubscribe` above
 * all) are what Raw exists for, and handing the package `headers` is what
 * switches its SES rail from Simple to Raw.
 *
 * Headers are REQUIRED, which the old copy of this function did not demand
 * because it composed MIME unconditionally. A headerless call would now
 * silently go out Simple, losing the `Precedence: bulk` and the Message-ID
 * that a bulk send wants, so it refuses instead of quietly sending something
 * else. The one caller, the newsletter blast, always passes
 * `List-Unsubscribe`.
 */
export async function sendRawEmail(env, { from, to, subject, html, text, replyTo, headers, configurationSet, log }) {
  requireCredentials(env);
  if (!headers || !Object.keys(headers).length) {
    throw new Error('sendRawEmail requires headers; a message with none should use sendEmail');
  }
  const category = log?.category || 'newsletter';
  const source = log?.source || '';
  const result = await send(
    env,
    {
      entity: ENTITY,
      ...purposeOf({ category }),
      from,
      to,
      subject,
      html,
      text,
      replyTo,
      headers,
      configurationSet,
      source,
    },
    depsFor(env, { db: log?.db, category, source, subject }),
  );
  return unwrap(result, 'SES raw request');
}

export { MailPermanent, LaneRefused };
