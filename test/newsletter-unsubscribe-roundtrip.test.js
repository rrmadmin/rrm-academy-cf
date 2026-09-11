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
