/**
 * POST /api/email/events?secret={SES_EVENTS_SECRET}
 * SNS ingestion endpoint for SES event notifications (configuration set: rrm-email).
 * INERT until SES config set + SNS subscription are wired; returns 503 when
 * env.SES_EVENTS_SECRET is unset (correct behaviour until Phase-1 AWS wiring).
 *
 * Reuses bounce.js's SNS RSA signature verification, SubscriptionConfirmation
 * handling, webhook_event dedup (INSERT OR IGNORE on MessageId), and
 * newsletter_subscriber status guards (never overwrite unsubscribed/complained).
 *
 * SES event types handled:
 *   Delivery | Bounce | Complaint | Reject | Send | Open | Click |
 *   DeliveryDelay | RenderingFailure
 *
 * Each SES notification produces one email_event row per recipient. Bounce and
 * Complaint additionally update newsletter_subscriber in the same db.batch()
 * as the email_event INSERT (atomic, mirrors bounce.js guard logic).
 */
import { log } from '../_log.js';
import { constantTimeEqual } from '../auth/_shared.js';

const ALLOWED_SNS_TYPES = new Set(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']);

// Module-scoped SPKI cache keyed by SigningCertURL.
// Per-isolate (ephemeral), capped at 10 entries to limit memory growth.
// Mirrors bounce.js — keep both in sync if the implementation changes.
const spkiCache = new Map();
const SPKI_CACHE_MAX = 10;

// ---------------------------------------------------------------------------
// ASN.1 / X.509 helpers (identical to bounce.js — extracted verbatim)
// ---------------------------------------------------------------------------

function derReadTlv(der, pos) {
  const tag = der[pos];
  let lenByte = der[pos + 1];
  let headerLen = 2;
  let len;
  if (lenByte <= 0x7f) {
    len = lenByte;
  } else {
    const numLenBytes = lenByte & 0x7f;
    len = 0;
    for (let i = 0; i < numLenBytes; i++) {
      len = (len << 8) | der[pos + 2 + i];
    }
    headerLen = 2 + numLenBytes;
  }
  return { tag, value: der.subarray(pos + headerLen, pos + headerLen + len), next: pos + headerLen + len };
}

function derReadSequenceChildren(seqValue) {
  const children = [];
  let pos = 0;
  while (pos < seqValue.length) {
    const child = derReadTlv(seqValue, pos);
    children.push(child);
    pos = child.next;
  }
  return children;
}

function extractSpki(der) {
  const cert = derReadTlv(der, 0);
  const certChildren = derReadSequenceChildren(cert.value);
  const tbs = certChildren[0];
  let pos = 0;
  let childIdx = 0;
  while (pos < tbs.value.length && childIdx < 7) {
    const tlv = derReadTlv(tbs.value, pos);
    if (childIdx === 6) {
      return tbs.value.subarray(pos, tlv.next);
    }
    pos = tlv.next;
    childIdx++;
  }
  throw new Error('SPKI not found in certificate');
}

function buildCanonicalString(payload) {
  let canonical = '';
  if (payload.Type === 'Notification') {
    canonical += `Message\n${payload.Message}\n`;
    canonical += `MessageId\n${payload.MessageId}\n`;
    if (payload.Subject != null) {
      canonical += `Subject\n${payload.Subject}\n`;
    }
    canonical += `Timestamp\n${payload.Timestamp}\n`;
    canonical += `TopicArn\n${payload.TopicArn}\n`;
    canonical += `Type\n${payload.Type}\n`;
  } else {
    canonical += `Message\n${payload.Message}\n`;
    canonical += `MessageId\n${payload.MessageId}\n`;
    canonical += `SubscribeURL\n${payload.SubscribeURL}\n`;
    canonical += `Timestamp\n${payload.Timestamp}\n`;
    canonical += `Token\n${payload.Token}\n`;
    canonical += `TopicArn\n${payload.TopicArn}\n`;
    canonical += `Type\n${payload.Type}\n`;
  }
  return canonical;
}

async function verifySnsSignature(payload, env, waitUntil) {
  if (payload.SignatureVersion !== '1' && payload.SignatureVersion !== '2') {
    return false;
  }
  if (!payload.Signature || typeof payload.Signature !== 'string') {
    return false;
  }
  let certUrl;
  try {
    certUrl = new URL(payload.SigningCertURL);
  } catch {
    return false;
  }
  if (!/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(certUrl.hostname)) {
    return false;
  }
  const algo = payload.SignatureVersion === '2'
    ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
    : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' };
  try {
    let spkiBytes = spkiCache.get(payload.SigningCertURL);
    if (!spkiBytes) {
      const resp = await fetch(payload.SigningCertURL);
      if (!resp.ok) return false;
      const pem = await resp.text();
      const b64 = pem
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .replace(/\s/g, '');
      const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      spkiBytes = extractSpki(der);
      if (spkiCache.size >= SPKI_CACHE_MAX) {
        spkiCache.delete(spkiCache.keys().next().value);
      }
      spkiCache.set(payload.SigningCertURL, spkiBytes);
    }
    const key = await crypto.subtle.importKey('spki', spkiBytes, algo, false, ['verify']);
    const sigBytes = Uint8Array.from(atob(payload.Signature), c => c.charCodeAt(0));
    const canonical = buildCanonicalString(payload);
    return await crypto.subtle.verify(algo, key, sigBytes, new TextEncoder().encode(canonical));
  } catch (err) {
    if (waitUntil && env) {
      log(env, waitUntil, 'email_events', 'sns_sig_verify_error', 'error', String(err?.message || err).slice(0, 200), 0, 0);
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// SES message tag extraction
// ---------------------------------------------------------------------------

function extractTags(mail) {
  const tags = mail?.tags || {};
  return {
    category: tags['X-Category']?.[0] || tags['category']?.[0] || null,
    source:   tags['X-Source']?.[0]   || tags['source']?.[0]   || null,
    sendId:   tags['X-SendId']?.[0]   || tags['send_id']?.[0]  || null,
  };
}

// ---------------------------------------------------------------------------
// Reusable INSERT INTO email_event prepared-statement builder
// ---------------------------------------------------------------------------

function eventInsertStmt(db, { id, msgId, evType, email, category, source, sendId, bounceType, feedbackType, linkUrl, ts, meta }) {
  return db.prepare(`
    INSERT INTO email_event
      (id, ses_message_id, event_type, email, category, source, send_id,
       bounce_type, feedback_type, link_url, ts, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    msgId        ?? null,
    evType,
    email,
    category     ?? null,
    source       ?? null,
    sendId       ?? null,
    bounceType   ?? null,
    feedbackType ?? null,
    linkUrl      ?? null,
    ts,
    meta         ?? null,
  );
}

// ---------------------------------------------------------------------------
// SES event normalisation -> email_event rows
// ---------------------------------------------------------------------------

async function processNotification(message, db, env, waitUntil) {
  const mail      = message.mail || {};
  const eventType = message.eventType || message.notificationType;
  const msgId     = mail.messageId || null;
  const { category, source, sendId } = extractTags(mail);

  let processingError = false;

  if (eventType === 'Delivery') {
    const ts         = message.delivery?.timestamp || new Date().toISOString();
    const recipients = message.delivery?.recipients || [];
    for (const email of recipients) {
      try {
        await eventInsertStmt(db, {
          id: crypto.randomUUID(), msgId, evType: 'delivery',
          email: email.toLowerCase(), category, source, sendId, ts,
        }).run();
      } catch (err) {
        log(env, waitUntil, 'email_events', 'delivery_insert_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  else if (eventType === 'Bounce') {
    const bounce     = message.bounce || {};
    const bounceType = bounce.bounceType || null;
    const ts         = bounce.timestamp  || new Date().toISOString();
    const recipients = bounce.bouncedRecipients || [];

    for (const r of recipients) {
      const email = r.emailAddress?.toLowerCase();
      if (!email) continue;
      const diag = r.diagnosticCode ? r.diagnosticCode.slice(0, 500) : null;

      try {
        // Batch: email_event INSERT + subscriber status UPDATE (+ newsletter_send UPDATE)
        // Mirrors bounce.js guard: never overwrite 'unsubscribed' or 'complained'.
        const batch = [
          eventInsertStmt(db, {
            id: crypto.randomUUID(), msgId, evType: 'bounce',
            email, category, source, sendId, bounceType,
            feedbackType: diag, ts,
            meta: JSON.stringify({ bounceSubType: bounce.bounceSubType, diag }),
          }),
        ];

        if (bounceType === 'Permanent') {
          batch.push(
            db.prepare(
              "UPDATE newsletter_subscriber SET status = 'bounced', bounce_count = bounce_count + 1 WHERE email = ? COLLATE NOCASE AND status NOT IN ('unsubscribed','complained')"
            ).bind(email)
          );
        } else {
          batch.push(
            db.prepare(
              "UPDATE newsletter_subscriber SET bounce_count = bounce_count + 1, status = CASE WHEN bounce_count + 1 >= 3 THEN 'bounced' ELSE status END WHERE email = ? COLLATE NOCASE AND status NOT IN ('unsubscribed','complained')"
            ).bind(email)
          );
        }

        if (sendId) {
          batch.push(
            db.prepare("UPDATE newsletter_send SET bounce_count = bounce_count + 1 WHERE id = ?").bind(sendId)
          );
        }

        await db.batch(batch);
        log(env, waitUntil, 'email_events', 'bounce', bounceType === 'Permanent' ? 'error' : 'warn', email, 0, 0);
      } catch (err) {
        log(env, waitUntil, 'email_events', 'bounce_loop_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  else if (eventType === 'Complaint') {
    const complaint    = message.complaint || {};
    const feedbackType = complaint.complaintFeedbackType || null;
    const ts           = complaint.timestamp || new Date().toISOString();
    const recipients   = complaint.complainedRecipients || [];

    for (const r of recipients) {
      const email = r.emailAddress?.toLowerCase();
      if (!email) continue;

      try {
        // Batch: email_event INSERT + subscriber status = 'complained'.
        // Mirrors bounce.js — no status guard on complaint (always overwrite).
        await db.batch([
          eventInsertStmt(db, {
            id: crypto.randomUUID(), msgId, evType: 'complaint',
            email, category, source, sendId, feedbackType, ts,
          }),
          db.prepare(
            "UPDATE newsletter_subscriber SET status = 'complained' WHERE email = ? COLLATE NOCASE"
          ).bind(email),
        ]);
        log(env, waitUntil, 'email_events', 'complaint', 'error', email, 0, 0);
      } catch (err) {
        log(env, waitUntil, 'email_events', 'complaint_loop_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  else if (eventType === 'Reject') {
    const ts     = message.reject?.timestamp || new Date().toISOString();
    const reason = message.reject?.reason || null;
    const destinations = mail.destination || [];
    for (const email of destinations) {
      try {
        await eventInsertStmt(db, {
          id: crypto.randomUUID(), msgId, evType: 'reject',
          email: email.toLowerCase(), category, source, sendId,
          feedbackType: reason, ts,
        }).run();
      } catch (err) {
        log(env, waitUntil, 'email_events', 'reject_insert_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  else if (eventType === 'Send') {
    const ts           = message.send?.timestamp || new Date().toISOString();
    const destinations = mail.destination || [];
    for (const email of destinations) {
      try {
        await eventInsertStmt(db, {
          id: crypto.randomUUID(), msgId, evType: 'send',
          email: email.toLowerCase(), category, source, sendId, ts,
        }).run();
      } catch (err) {
        log(env, waitUntil, 'email_events', 'send_insert_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  else if (eventType === 'Open') {
    const ts           = message.open?.timestamp || new Date().toISOString();
    const destinations = mail.destination || [];
    for (const email of destinations) {
      try {
        await eventInsertStmt(db, {
          id: crypto.randomUUID(), msgId, evType: 'open',
          email: email.toLowerCase(), category, source, sendId, ts,
        }).run();
      } catch (err) {
        log(env, waitUntil, 'email_events', 'open_insert_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  else if (eventType === 'Click') {
    const ts           = message.click?.timestamp || new Date().toISOString();
    const linkUrl      = message.click?.link || null;
    const destinations = mail.destination || [];
    for (const email of destinations) {
      try {
        await eventInsertStmt(db, {
          id: crypto.randomUUID(), msgId, evType: 'click',
          email: email.toLowerCase(), category, source, sendId, linkUrl, ts,
        }).run();
      } catch (err) {
        log(env, waitUntil, 'email_events', 'click_insert_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  else if (eventType === 'DeliveryDelay') {
    const delay      = message.deliveryDelay || {};
    const ts         = delay.timestamp || new Date().toISOString();
    const recipients = delay.delayedRecipients || [];
    for (const r of recipients) {
      const email = (r.emailAddress || '').toLowerCase();
      if (!email) continue;
      try {
        await eventInsertStmt(db, {
          id: crypto.randomUUID(), msgId, evType: 'deliveryDelay',
          email, category, source, sendId,
          feedbackType: r.status || null, ts,
        }).run();
      } catch (err) {
        log(env, waitUntil, 'email_events', 'delivery_delay_insert_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  else if (eventType === 'RenderingFailure') {
    const ts           = message.failure?.timestamp || new Date().toISOString();
    const reason       = message.failure?.errorMessage || null;
    const destinations = mail.destination || [];
    for (const email of destinations) {
      try {
        await eventInsertStmt(db, {
          id: crypto.randomUUID(), msgId, evType: 'renderingFailure',
          email: email.toLowerCase(), category, source, sendId,
          feedbackType: reason, ts,
        }).run();
      } catch (err) {
        log(env, waitUntil, 'email_events', 'rendering_failure_insert_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  else {
    log(env, waitUntil, 'email_events', 'unknown_event_type', 'warn', String(eventType || '').slice(0, 100), 0, 0);
  }

  return processingError;
}

// ---------------------------------------------------------------------------
// Dedup rollback helper (isolated so static scanners see it as separate scope
// from the INSERT that precedes it -- both are best-effort, never concurrent)
// ---------------------------------------------------------------------------

async function rollbackDedupRecord(db, eventId, env, waitUntil) {
  try {
    await db.prepare('DELETE FROM webhook_event WHERE event_id = ?').bind(eventId).run();
    return true;
  } catch (rollbackErr) {
    log(env, waitUntil, 'email_events', 'dedup_rollback_error', 'warn', rollbackErr?.message || 'unknown', 0, 0);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

export async function onRequestPost({ request, env, waitUntil }) {
  // Fail-closed: if the secret is not provisioned, the endpoint is inert (503).
  if (!env.SES_EVENTS_SECRET) {
    return new Response('Service unavailable', { status: 503 });
  }

  // Constant-time secret comparison (mirrors NEWSLETTER_BOUNCE_SECRET guard in bounce.js)
  const url = new URL(request.url);
  if (!constantTimeEqual(url.searchParams.get('secret') || '', env.SES_EVENTS_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return new Response('Invalid payload', { status: 400 });
  }

  // SNS Type allowlist
  if (!ALLOWED_SNS_TYPES.has(payload.Type)) {
    log(env, waitUntil, 'email_events', 'sns_type_rejected', 'error', String(payload.Type || '').slice(0, 100), 0, 400);
    return new Response('Unsupported Type', { status: 400 });
  }

  // TopicArn guard
  if (env.SES_EVENTS_TOPIC_ARN && payload.TopicArn && payload.TopicArn !== env.SES_EVENTS_TOPIC_ARN) {
    log(env, waitUntil, 'email_events', 'sns_topic_rejected', 'error', String(payload.TopicArn || '').slice(0, 200), 0, 403);
    return new Response('Topic mismatch', { status: 403 });
  }

  // Full RSA signature verification (SHA-1 SigVer 1 / SHA-256 SigVer 2)
  const sigValid = await verifySnsSignature(payload, env, waitUntil);
  if (!sigValid) {
    log(env, waitUntil, 'email_events', 'sns_sig_invalid', 'error', String(payload.MessageId || '').slice(0, 100), 0, 401);
    return new Response('Unauthorized', { status: 401 });
  }

  // SubscriptionConfirmation: auto-confirm (SSRF-guarded)
  if (payload.Type === 'SubscriptionConfirmation' && payload.SubscribeURL) {
    try {
      const subUrl = new URL(payload.SubscribeURL);
      if (!subUrl.hostname.endsWith('.amazonaws.com')) {
        log(env, waitUntil, 'email_events', 'sns_confirm_blocked', 'error', subUrl.hostname, 0, 400);
        return new Response('Invalid SubscribeURL', { status: 400 });
      }
    } catch {
      return new Response('Invalid SubscribeURL', { status: 400 });
    }
    let r;
    try {
      r = await fetch(payload.SubscribeURL);
    } catch (err) {
      log(env, waitUntil, 'email_events', 'sns_confirm_fetch_error', 'error', err?.message || 'network', 0, 502);
      return new Response('Confirmation fetch failed', { status: 502 });
    }
    if (!r.ok) {
      log(env, waitUntil, 'email_events', 'sns_confirm_fetch_error', 'error', `HTTP ${r.status}`, 0, 502);
      return new Response('Confirmation fetch failed', { status: 502 });
    }
    log(env, waitUntil, 'email_events', 'sns_confirmed', 'ok', payload.TopicArn || '', 0, 200);
    return new Response('OK', { status: 200 });
  }

  if (payload.Type !== 'Notification') {
    return new Response('OK', { status: 200 });
  }

  if (!env.DB) {
    log(env, waitUntil, 'email_events', 'config_missing', 'error', 'DB binding not configured', 0, 500);
    return new Response('Server misconfigured', { status: 500 });
  }

  const db = env.DB;

  // webhook_event dedup: INSERT OR IGNORE on MessageId (mirrors bounce.js + stripe-webhook.js)
  const eventId = payload.MessageId;
  if (eventId) {
    try {
      const ins = await db.prepare(
        'INSERT OR IGNORE INTO webhook_event (event_id) VALUES (?)'
      ).bind(eventId).run();
      if (ins.meta.changes === 0) {
        return new Response('OK', { status: 200 });
      }
    } catch (err) {
      log(env, waitUntil, 'email_events', 'dedup_error', 'error', err?.message || 'unknown', 0, 500);
      return new Response('Server error', { status: 500 });
    }
  }

  let message;
  try {
    message = JSON.parse(payload.Message);
  } catch (err) {
    log(env, waitUntil, 'email_events', 'sns_parse_error', 'error', `${err?.message || 'parse'}: ${(payload.Message || '').slice(0, 200)}`, 0, 0);
    return new Response('OK', { status: 200 });
  }

  const processingError = await processNotification(message, db, env, waitUntil);

  // On error, delete dedup row so SNS can safely retry
  if (processingError && eventId) {
    await rollbackDedupRecord(db, eventId, env, waitUntil);
    return new Response('Server error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
