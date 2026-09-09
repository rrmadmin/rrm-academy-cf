/**
 * THE ESTATE'S MAIL PACKAGE: one sender, four rails, and the lane rules
 * enforced in code rather than remembered.
 *
 * Nine senders across the estate did this job, each with its own SigV4 block,
 * its own header sanitiser and its own hardcoded from address. They agreed on
 * the mechanics and disagreed on everything else, and none of them could tell
 * a caller that the message it was about to send belonged on a different rail.
 * This package is the merge: `lanes.js` decides which rail may carry a
 * message, `ses.js`, `graph.js` and `cf-email.js` drive the three rails that
 * exist, and the fourth lane, Workspace, is the one this package REFUSES to
 * drive because a personal send from a human mailbox is not a rail at all.
 *
 * EVERYTHING IS INJECTED. `deps = { signer, fetch, kv, ae, logEmail }`. The
 * SES signer is the consumer's own `aws4fetch` client, which is what keeps
 * console-kit dependency-free and every rail testable with a fake. Nothing
 * here reads a global besides `fetch` as a last resort, and nothing here
 * hardcodes a from address: an adapter that wants a default from reads it out
 * of its own env and passes it in.
 *
 *   send(env, msg, deps) -> { ok: true, lane, id } | { ok: false, lane, reason, status }
 *
 * `msg` is `{ entity, purpose, from, to, subject, html, text, replyTo, cc,
 * headers, attachments, clinicRail, exemption }`. Throws only `MailPermanent`, and only
 * when the far side says the message can never be delivered; every other
 * failure is an `ok: false` answer a caller can log and move past.
 */

import { EXEMPTIONS, LANES, LaneRefused, MailPermanent, resolveLane, bareAddress, sanitizeHeader } from './lanes.js';
import { sendViaSes } from './ses.js';
import { sendViaGraph, forgetGraphTokenForTests } from './graph.js';
import { sendViaCfEmail } from './cf-email.js';

export {
  EXEMPTIONS,
  LANES,
  LaneRefused,
  MailPermanent,
  resolveLane,
  bareAddress,
  sanitizeHeader,
  sendViaSes,
  sendViaGraph,
  sendViaCfEmail,
  forgetGraphTokenForTests,
};

/**
 * One Analytics Engine row per send attempt, refusals included, because a
 * refused send is exactly the event a lane rule exists to make visible.
 * Best-effort by construction: an AE write must never be why a send fails.
 *
 * A send that rode a named exemption says so in the detail blob, prefixed so
 * it survives the 200-character cap. The exemptions are the one way RRM list
 * mail reaches SES at all, so "which sends used one" has to be answerable
 * from the telemetry rather than from the source.
 */
function writeAe(deps, { lane, purpose, ok, detail, durationMs, exemption }) {
  const prefix = exemption ? `exemption=${exemption} ` : '';
  try {
    deps?.ae?.writeDataPoint?.({
      blobs: ['mail', lane || 'none', purpose || '', ok ? 'ok' : 'error', `${prefix}${String(detail ?? '')}`.slice(0, 200)],
      doubles: [durationMs, 1, 0],
      indexes: [lane || 'none'],
    });
  } catch {
    // AE writes are best-effort.
  }
}

/**
 * The `email_log` row, handed to the consumer's own inserter. The package does
 * not touch D1: the schema, the binding and the retention policy belong to the
 * consumer, and rrm-academy-cf's table is not rrm-wix-stuc-sync's.
 *
 * The row carries `exemption`, the granted name or null, so the D1 record of
 * an RRM list send says on its face which ruling put it on SES.
 */
async function writeLog(deps, row) {
  if (typeof deps?.logEmail !== 'function') return;
  try {
    await deps.logEmail(row);
  } catch {
    // Logging is best-effort; it must never be why a caller sees a failure.
  }
}

function firstRecipient(to) {
  const value = Array.isArray(to) ? to[0] : to;
  return String(value ?? '').trim();
}

/** Every header-shaped field, cleaned before any transport sees it. */
function sanitiseMessage(msg) {
  const clean = { ...msg };
  clean.from = sanitizeHeader(msg.from, 320);
  clean.subject = sanitizeHeader(msg.subject);
  const cleanList = (value) => {
    if (value === undefined || value === null || value === '') return value;
    return Array.isArray(value)
      ? value.map((v) => sanitizeHeader(v, 320)).filter(Boolean)
      : sanitizeHeader(value, 320);
  };
  clean.to = cleanList(msg.to);
  if (msg.cc !== undefined) clean.cc = cleanList(msg.cc);
  if (msg.replyTo !== undefined) clean.replyTo = cleanList(msg.replyTo);
  if (msg.headers) {
    clean.headers = Object.fromEntries(
      Object.entries(msg.headers).map(([name, value]) => [sanitizeHeader(name, 200), sanitizeHeader(value)]),
    );
  }
  return clean;
}

/**
 * Send one message on the lane its entity and purpose require.
 *
 * The Workspace lane is the one answer that is not a transport outcome:
 * `{ ok: false, lane: 'workspace', reason: 'workspace-lane-only', how:
 * 'va-send.sh' }`. It means the message is legitimate and this is not the
 * thing that sends it. A caller that receives it should route the message
 * through the Workspace lane, not retry, not fall back to SES.
 */
export async function send(env, msg = {}, deps = {}) {
  const started = Date.now();
  const purpose = msg.purpose;
  // Only a name the lane rules actually granted is worth recording. A refused
  // send names an exemption too, and telemetry that repeated the name it just
  // rejected would read as though the exemption had applied.
  const exemption = String(msg.exemption ?? '').trim() || null;

  let lane;
  try {
    lane = resolveLane(msg);
  } catch (err) {
    if (!(err instanceof LaneRefused)) throw err;
    const answer = { ok: false, lane: err.lane, reason: err.reason, status: 0, detail: err.detail };
    if (err.how) answer.how = err.how;
    writeAe(deps, { lane: err.lane, purpose, ok: false, detail: `${err.reason}:${err.detail}`, durationMs: Date.now() - started });
    await writeLog(deps, {
      event: 'refused',
      email: firstRecipient(msg.to),
      category: purpose || null,
      source: msg.source || '',
      subject: msg.subject || null,
      detail: `${err.reason}: ${err.detail}`,
      send_id: null,
      ses_message_id: null,
      lane: err.lane,
      exemption: null,
    });
    return answer;
  }

  const clean = sanitiseMessage(msg);
  const transport = LANES[lane].transport;

  let result;
  try {
    if (transport === 'ses') result = await sendViaSes(env, clean, deps);
    else if (transport === 'graph') result = await sendViaGraph(env, clean, deps, lane);
    else if (transport === 'cf_email') result = await sendViaCfEmail(env, clean, deps);
    else result = { ok: false, status: 0, reason: 'no-transport', detail: `lane ${lane} has no transport` };
  } catch (err) {
    if (err instanceof MailPermanent) {
      writeAe(deps, { lane, purpose, ok: false, detail: `permanent:${err.message}`, durationMs: Date.now() - started, exemption });
      await writeLog(deps, {
        event: 'failed',
        email: firstRecipient(clean.to),
        category: purpose || null,
        source: msg.source || '',
        subject: clean.subject || null,
        detail: `permanent: ${err.message}`,
        send_id: null,
        ses_message_id: null,
        lane,
        exemption,
      });
    }
    throw err;
  }

  const durationMs = Date.now() - started;
  writeAe(deps, {
    lane,
    purpose,
    ok: result.ok,
    detail: result.ok ? (result.id ?? '') : `${result.reason}:${result.detail ?? ''}`,
    durationMs,
    exemption,
  });
  await writeLog(deps, {
    event: result.ok ? 'send' : 'failed',
    email: firstRecipient(clean.to),
    category: purpose || null,
    source: msg.source || '',
    subject: clean.subject || null,
    detail: result.ok ? result.id : `${result.reason}: ${result.detail ?? ''}`,
    send_id: result.ok ? result.id : null,
    ses_message_id: result.ok && transport === 'ses' ? result.id : null,
    lane,
    exemption,
  });

  return result.ok
    ? { ok: true, lane, id: result.id ?? null }
    : { ok: false, lane, reason: result.reason, status: result.status ?? 0, detail: result.detail };
}
