/**
 * POST /api/newsletter/bounce?secret={NEWSLETTER_BOUNCE_SECRET}
 * SNS webhook for SES bounce and complaint notifications.
 * Gated by query param secret (set when creating the SNS subscription).
 */
import { log } from '../_log.js';

const ALLOWED_SNS_TYPES = new Set(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']);

// Module-scoped SPKI cache keyed by SigningCertURL.
// Per-isolate (ephemeral), capped at 10 entries to limit memory growth.
const spkiCache = new Map();
const SPKI_CACHE_MAX = 10;

/**
 * Minimal ASN.1 DER walker. Returns { value: Uint8Array, next: number } for the
 * TLV at offset `pos` inside `der`. Handles short-form (len ≤ 127) and long-form
 * (len encoded in subsequent bytes) length octets.
 */
function derReadTlv(der, pos) {
  const tag = der[pos];
  let lenByte = der[pos + 1];
  let headerLen = 2;
  let len;
  if (lenByte <= 0x7f) {
    // Short form: length is the byte itself
    len = lenByte;
  } else {
    // Long form: low 7 bits = number of subsequent length bytes
    const numLenBytes = lenByte & 0x7f;
    len = 0;
    for (let i = 0; i < numLenBytes; i++) {
      len = (len << 8) | der[pos + 2 + i];
    }
    headerLen = 2 + numLenBytes;
  }
  return { tag, value: der.subarray(pos + headerLen, pos + headerLen + len), next: pos + headerLen + len };
}

/**
 * Walks an ASN.1 SEQUENCE value (the bytes after tag+length) and returns
 * an array of its child TLVs (each as { tag, value, next }).
 */
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

/**
 * Extracts the SubjectPublicKeyInfo (SPKI) SEQUENCE from a DER-encoded X.509v3
 * certificate as a Uint8Array suitable for crypto.subtle.importKey('spki', ...).
 *
 * X.509 structure:
 *   Certificate ::= SEQUENCE {
 *     tbsCertificate  TBSCertificate,    <- child[0]
 *     signatureAlgorithm ...,
 *     signature ...
 *   }
 *
 * TBSCertificate (v3) ::= SEQUENCE {
 *     version         [0] EXPLICIT INTEGER,   <- child[0]  (tag 0xA0)
 *     serialNumber    INTEGER,                <- child[1]
 *     signature       AlgorithmIdentifier,    <- child[2]
 *     issuer          Name,                   <- child[3]
 *     validity        Validity,               <- child[4]
 *     subject         Name,                   <- child[5]
 *     subjectPublicKeyInfo SubjectPublicKeyInfo <- child[6]
 *   }
 */
function extractSpki(der) {
  // Outer Certificate SEQUENCE
  const cert = derReadTlv(der, 0);
  // tbsCertificate is the first child of Certificate SEQUENCE
  const certChildren = derReadSequenceChildren(cert.value);
  const tbs = certChildren[0]; // tbsCertificate SEQUENCE
  // Walk into tbsCertificate — child[6] is subjectPublicKeyInfo
  // (child[0] is the explicit [0] version tag for v3 certs)
  let pos = 0;
  let childIdx = 0;
  while (pos < tbs.value.length && childIdx < 7) {
    const tlv = derReadTlv(tbs.value, pos);
    if (childIdx === 6) {
      // Return the full TLV bytes for SPKI (tag + encoded length + value)
      return tbs.value.subarray(pos, tlv.next);
    }
    pos = tlv.next;
    childIdx++;
  }
  throw new Error('SPKI not found in certificate');
}

/**
 * Builds the canonical signing string for an SNS message per AWS SNS spec.
 * Fields are concatenated as: FieldName\nFieldValue\n for each applicable field
 * in alphabetical order (AWS defines the exact field set per message type).
 */
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
    // SubscriptionConfirmation / UnsubscribeConfirmation
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

/**
 * Validates the SNS message signature against the AWS-provided signing certificate.
 * Returns true if valid, false if invalid or if cert fetch/parse fails.
 */
async function verifySnsSignature(payload, env, waitUntil) {
  // Only SignatureVersion 1 (SHA-1) and 2 (SHA-256) are defined by AWS
  if (payload.SignatureVersion !== '1' && payload.SignatureVersion !== '2') {
    return false;
  }

  if (!payload.Signature || typeof payload.Signature !== 'string') {
    return false;
  }

  // Validate SigningCertURL hostname — must be SNS-owned AWS domain
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
    // Retrieve or fetch SPKI bytes
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
      // Evict oldest entry if cache is full (LRU-lite: just drop the first inserted key)
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
      log(env, waitUntil, 'newsletter', 'sns_sig_verify_error', 'error', String(err?.message || err).slice(0, 200), 0, 0);
    }
    return false;
  }
}

export async function onRequestPost({ request, env, waitUntil }) {
  // Auth: shared secret in query param (configured in SNS subscription URL)
  const url = new URL(request.url);
  if (!env.NEWSLETTER_BOUNCE_SECRET || url.searchParams.get('secret') !== env.NEWSLETTER_BOUNCE_SECRET) {
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

  // Type allowlist: reject unknown SNS message types
  if (!ALLOWED_SNS_TYPES.has(payload.Type)) {
    log(env, waitUntil, 'newsletter', 'sns_type_rejected', 'error', String(payload.Type || '').slice(0, 100), 0, 400);
    return new Response('Unsupported Type', { status: 400 });
  }

  // TopicArn guard: if configured, reject messages from unexpected topics
  if (env.NEWSLETTER_SNS_TOPIC_ARN && payload.TopicArn && payload.TopicArn !== env.NEWSLETTER_SNS_TOPIC_ARN) {
    log(env, waitUntil, 'newsletter', 'sns_topic_rejected', 'error', String(payload.TopicArn || '').slice(0, 200), 0, 403);
    return new Response('Topic mismatch', { status: 403 });
  }

  // Full RSA signature verification against the AWS-provided signing certificate
  const sigValid = await verifySnsSignature(payload, env, waitUntil);
  if (!sigValid) {
    log(env, waitUntil, 'newsletter', 'sns_sig_invalid', 'error', String(payload.MessageId || '').slice(0, 100), 0, 401);
    return new Response('Unauthorized', { status: 401 });
  }

  // SNS subscription confirmation
  if (payload.Type === 'SubscriptionConfirmation' && payload.SubscribeURL) {
    // Validate that SubscribeURL points to AWS (prevent SSRF)
    try {
      const subUrl = new URL(payload.SubscribeURL);
      if (!subUrl.hostname.endsWith('.amazonaws.com')) {
        log(env, waitUntil, 'newsletter', 'sns_confirm_blocked', 'error', subUrl.hostname, 0, 400);
        return new Response('Invalid SubscribeURL', { status: 400 });
      }
    } catch {
      return new Response('Invalid SubscribeURL', { status: 400 });
    }
    let r;
    try {
      r = await fetch(payload.SubscribeURL);
    } catch (err) {
      log(env, waitUntil, 'newsletter', 'sns_confirm_fetch_error', 'error', err?.message || 'network', 0, 502);
      return new Response('Confirmation fetch failed', { status: 502 });
    }
    if (!r.ok) {
      log(env, waitUntil, 'newsletter', 'sns_confirm_fetch_error', 'error', `HTTP ${r.status}`, 0, 502);
      return new Response('Confirmation fetch failed', { status: 502 });
    }
    log(env, waitUntil, 'newsletter', 'sns_confirmed', 'ok', payload.TopicArn || '', 0, 200);
    return new Response('OK', { status: 200 });
  }

  // SNS notification
  if (payload.Type !== 'Notification') {
    return new Response('OK', { status: 200 });
  }

  let message;
  try {
    message = JSON.parse(payload.Message);
  } catch (err) {
    log(env, waitUntil, 'newsletter', 'sns_parse_error', 'error', `${err?.message || 'parse'}: ${(payload.Message || '').slice(0, 200)}`, 0, 200);
    return new Response('OK', { status: 200 });
  }

  const db = env.DB;
  if (!db) {
    log(env, waitUntil, 'newsletter', 'config_missing', 'error', 'DB binding not configured', 0, 500);
    return new Response('Server misconfigured', { status: 500 });
  }

  // Webhook event dedup: prevent replay double-processing
  const eventId = payload.MessageId;
  if (eventId) {
    try {
      const ins = await db.prepare(
        "INSERT OR IGNORE INTO webhook_event (event_id) VALUES (?)"
      ).bind(eventId).run();
      if (ins.meta.changes === 0) {
        // Already processed
        return new Response('OK', { status: 200 });
      }
    } catch (err) {
      log(env, waitUntil, 'newsletter', 'dedup_error', 'error', err?.message || 'unknown', 0, 500);
      return new Response('Server error', { status: 500 });
    }
  }

  let processingError = false;

  const notifType = message.notificationType || message.eventType;

  if (notifType === 'Bounce') {
    const bounceType = message.bounce?.bounceType;
    const recipients = message.bounce?.bouncedRecipients || [];
    for (const r of recipients) {
      try {
        const email = r.emailAddress?.toLowerCase();
        if (!email) continue;

        const subscriber = await db.prepare(
          "SELECT id FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE"
        ).bind(email).first();

        if (!subscriber) continue;

        const lastEvent = await db.prepare(
          "SELECT send_id FROM newsletter_event WHERE subscriber_id = ? AND event = 'sent' ORDER BY id DESC LIMIT 1"
        ).bind(subscriber.id).first();
        const sendId = lastEvent?.send_id || null;

        if (bounceType === 'Permanent') {
          const batch = [
            db.prepare(
              "UPDATE newsletter_subscriber SET status = 'bounced', bounce_count = bounce_count + 1 WHERE email = ? COLLATE NOCASE AND status NOT IN ('unsubscribed','complained')"
            ).bind(email),
            db.prepare(
              "INSERT INTO email_log (event, email, category, source, detail) VALUES ('bounced', ?, 'newsletter', 'ses/bounce-webhook', ?)"
            ).bind(email, bounceType),
          ];
          if (sendId) {
            batch.push(
              db.prepare(
                "UPDATE newsletter_send SET bounce_count = bounce_count + 1 WHERE id = ?"
              ).bind(sendId)
            );
          }
          await db.batch(batch);
        } else {
          // Soft bounce: increment count, suppress after 3 using single atomic UPDATE
          const batch = [
            db.prepare(
              "UPDATE newsletter_subscriber SET bounce_count = bounce_count + 1, status = CASE WHEN bounce_count + 1 >= 3 THEN 'bounced' ELSE status END WHERE email = ? COLLATE NOCASE AND status NOT IN ('unsubscribed','complained')"
            ).bind(email),
            db.prepare(
              "INSERT INTO email_log (event, email, category, source, detail) VALUES ('bounced', ?, 'newsletter', 'ses/bounce-webhook', ?)"
            ).bind(email, bounceType),
          ];
          if (sendId) {
            batch.push(
              db.prepare(
                "UPDATE newsletter_send SET bounce_count = bounce_count + 1 WHERE id = ?"
              ).bind(sendId)
            );
          }
          await db.batch(batch);
        }
        log(env, waitUntil, 'newsletter', 'bounce', bounceType === 'Permanent' ? 'error' : 'warn', email, 0, 0);
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'bounce_loop_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  if (notifType === 'Complaint') {
    const recipients = message.complaint?.complainedRecipients || [];
    for (const r of recipients) {
      try {
        const email = r.emailAddress?.toLowerCase();
        if (!email) continue;

        const subscriber = await db.prepare(
          "SELECT id FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE"
        ).bind(email).first();

        if (!subscriber) continue;

        await db.batch([
          db.prepare(
            "UPDATE newsletter_subscriber SET status = 'complained' WHERE email = ? COLLATE NOCASE"
          ).bind(email),
          db.prepare(
            "INSERT INTO email_log (event, email, category, source, detail) VALUES ('complained', ?, 'newsletter', 'ses/bounce-webhook', 'complaint')"
          ).bind(email),
        ]);
        log(env, waitUntil, 'newsletter', 'complaint', 'error', email, 0, 0);
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'complaint_loop_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  if (notifType === 'Delivery') {
    // Log delivery for deliverability tracking (sent != delivered)
    const recipients = message.delivery?.recipients || [];
    for (const rawEmail of recipients) {
      try {
        const email = rawEmail.toLowerCase();

        const subscriber = await db.prepare(
          "SELECT id FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE"
        ).bind(email).first();

        if (!subscriber) continue;

        await db.prepare(
          "INSERT INTO email_log (event, email, category, source, detail) VALUES ('delivered', ?, 'newsletter', 'ses/bounce-webhook', 'delivery')"
        ).bind(email).run();
        log(env, waitUntil, 'newsletter', 'delivered', 'ok', email, 0, 200);
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'delivery_loop_error', 'error', err?.message || 'unknown', 0, 0);
        processingError = true;
      }
    }
  }

  // On processing error, delete dedup row so SNS can retry
  if (processingError && eventId) {
    try {
      await db.prepare("DELETE FROM webhook_event WHERE event_id = ?").bind(eventId).run();
    } catch (_e) { /* best-effort rollback; SNS may still retry */ }
    return new Response('Server error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}
