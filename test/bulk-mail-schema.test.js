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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bulkMailD1 } from './_bulk-mail-sqlite.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

describe('migration 043 header: the documented lease-recovery UPDATE is scoped, not blanket', () => {
  it('carries a campaign-scoped, age-checked recovery statement -- never a blanket WHERE that could flip a live campaign', () => {
    const header = readFileSync(join(ROOT, 'migrations', '043-bulk-lease-unique.sql'), 'utf8');
    assert.match(
      header, /UPDATE newsletter_send SET status = 'partial'/,
      'the documented recovery UPDATE must still be present',
    );
    assert.match(
      header, /campaign = /,
      'the recovery UPDATE must be scoped to the one campaign the CREATE named, never every campaign',
    );
    assert.match(
      header, /-180 seconds/,
      'the recovery UPDATE must only touch leases old enough to be abandoned',
    );
    assert.doesNotMatch(
      header, /UPDATE newsletter_send SET status = 'partial'\s+WHERE status = 'sending' AND campaign IS NOT NULL;/,
      'the old blanket form (every campaign, no age check) must not come back',
    );
  });
});
