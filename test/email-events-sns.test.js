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
import { createSign, createPrivateKey } from 'node:crypto';
import { bulkMailD1 } from './_bulk-mail-sqlite.mjs';
import { mockRequest, mockEnv, mockWaitUntil } from './_helpers.js';
import { onRequestPost } from '../functions/api/email/events.js';

const SECRET = 'events-secret';
const TOPIC = 'arn:aws:sns:us-east-1:111122223333:rrm-ses-events';
const CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem';

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
  const { mkdtempSync, readFileSync } = await import('node:fs');
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
