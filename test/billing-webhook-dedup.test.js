/**
 * EXECUTED tests for the two-phase webhook dedup envelope
 * (functions/api/billing/_shared.js dedupWebhookEvent / markWebhookEventCompleted /
 * rollbackWebhookDedup).
 *
 * This is the gate every Stripe event passes through. Get it wrong in one
 * direction and a redelivered event double-enrolls, double-emails and
 * double-records a gift; get it wrong in the other and a crashed attempt's side
 * effects are silently dropped forever with no re-drive.
 *
 * The stale-reclaim branch is a genuine two-writer race, so it is exercised
 * against a REAL SQLite database (test/_d1-sqlite.mjs) with a scripted
 * concurrent writer landing in the window the code is written to survive. A
 * canned-row mock cannot express "the row changed between the SELECT and the
 * DELETE", which is exactly the state the cutoff binding exists to detect:
 * `.bind(eventId, nowSec - WEBHOOK_INFLIGHT_TTL_SECONDS)` refuses to delete a
 * claim someone else just refreshed, and `.bind(eventId, nowSec)` would steal it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './_d1-sqlite.mjs';
import { mockEnv, mockWaitUntil } from './_helpers.js';

const {
  dedupWebhookEvent, markWebhookEventCompleted, rollbackWebhookDedup,
} = await import('../functions/api/billing/_shared.js');

/** Mirrors the module-private WEBHOOK_INFLIGHT_TTL_SECONDS. */
const TTL = 60;
const nowSec = () => Math.floor(Date.now() / 1000);

function dedupDb(seed, interleave) {
  return sqliteD1({ seed, interleave });
}

function claim(db, eventId, { ageSec = 0, completed = null } = {}) {
  db._sqlite
    .prepare('INSERT INTO webhook_event (event_id, processed_at, completed_at) VALUES (?, ?, ?)')
    .run(eventId, nowSec() - ageSec, completed);
}

const row = (db, eventId) =>
  db._sqlite.prepare('SELECT event_id, processed_at, completed_at FROM webhook_event WHERE event_id = ?').get(eventId);

async function dedup(db) {
  return dedupWebhookEvent(db, 'evt_1', mockEnv({ DB: db }), mockWaitUntil());
}

describe('dedupWebhookEvent -- first delivery', () => {
  it('claims an unseen event and lets the handler run', async () => {
    const db = dedupDb();
    const result = await dedup(db);

    assert.equal(result.skip, false);
    assert.equal(result.error, undefined);
    const claimed = row(db, 'evt_1');
    assert.ok(claimed, 'the claim row must exist so a concurrent delivery sees it');
    assert.equal(claimed.completed_at, null, 'the claim starts in-flight, not completed');
    assert.ok(Math.abs(claimed.processed_at - nowSec()) <= 2, 'processed_at must be stamped now');
    db.close();
  });

  it('marks the claim completed after the handler succeeds', async () => {
    const db = dedupDb();
    await dedup(db);
    await markWebhookEventCompleted(db, 'evt_1', mockEnv({ DB: db }), mockWaitUntil());
    assert.ok(row(db, 'evt_1').completed_at, 'Phase 2 must stamp completed_at');
    db.close();
  });

  it('rolls the claim back on a 5xx so Stripe can retry', async () => {
    const db = dedupDb();
    await dedup(db);
    await rollbackWebhookDedup(db, 'evt_1', mockEnv({ DB: db }), mockWaitUntil());
    assert.equal(row(db, 'evt_1'), undefined, 'a rolled-back event must be redeliverable');
    assert.equal((await dedup(db)).skip, false, 'and the redelivery must be processed, not skipped');
    db.close();
  });
});

describe('dedupWebhookEvent -- redelivery of a settled or live event', () => {
  it('skips a completed duplicate with a 200 so Stripe stops retrying', async () => {
    const db = dedupDb((s) => {
      s.prepare('INSERT INTO webhook_event (event_id, processed_at, completed_at) VALUES (?, ?, ?)')
        .run('evt_1', nowSec() - 3600, nowSec() - 3599);
    });
    const result = await dedup(db);

    assert.equal(result.skip, true);
    assert.equal(result.response.status, 200);
    assert.deepEqual(await result.response.json(), { ok: true, skipped: true, completed: true });
    db.close();
  });

  it('forces a retry with a 500 while a fresh attempt is still in flight', async () => {
    const db = dedupDb();
    claim(db, 'evt_1', { ageSec: 5 });
    const result = await dedup(db);

    assert.equal(result.skip, true);
    assert.equal(result.response.status, 500, 'a live in-flight attempt must never be ack\'d');
    assert.equal(row(db, 'evt_1').processed_at, nowSec() - 5, 'the live claim must be left untouched');
    db.close();
  });
});

describe('dedupWebhookEvent -- reclaiming a crashed attempt', () => {
  it('reprocesses an attempt that never completed and is past the in-flight TTL', async () => {
    const db = dedupDb();
    claim(db, 'evt_1', { ageSec: TTL + 30 });
    const result = await dedup(db);

    assert.equal(result.skip, false, 'a crashed attempt must be re-driven, not silently dropped');
    const reclaimed = row(db, 'evt_1');
    assert.ok(reclaimed, 'the reclaim must leave a fresh claim behind');
    assert.ok(Math.abs(reclaimed.processed_at - nowSec()) <= 2, 'the reclaimed row carries a NEW processed_at');
    db.close();
  });

  it('holds the in-flight line at exactly the TTL boundary', async () => {
    const justInside = dedupDb();
    claim(justInside, 'evt_1', { ageSec: TTL - 2 });
    const inflight = await dedup(justInside);
    assert.equal(inflight.skip, true, `an attempt ${TTL - 2}s old is still in flight`);
    assert.equal(inflight.response.status, 500);
    justInside.close();

    const justOutside = dedupDb();
    claim(justOutside, 'evt_1', { ageSec: TTL });
    const reclaimed = await dedup(justOutside);
    assert.equal(reclaimed.skip, false, `an attempt exactly ${TTL}s old is reclaimable`);
    justOutside.close();
  });

  it('refuses to steal a claim another isolate refreshed between the read and the delete', async () => {
    // The window the cutoff binding exists for. Both isolates read the same
    // stale row; the other one wins the reclaim first. Our DELETE must then
    // match nothing, because the row it is looking at is no longer stale.
    let refreshed = false;
    const db = dedupDb(undefined, ({ sql, db: raw }) => {
      if (!refreshed && sql.includes('DELETE FROM webhook_event') && sql.includes('processed_at <= ?')) {
        refreshed = true;
        raw.prepare('UPDATE webhook_event SET processed_at = ? WHERE event_id = ?').run(nowSec(), 'evt_1');
      }
    });
    claim(db, 'evt_1', { ageSec: TTL + 30 });

    const result = await dedup(db);

    assert.ok(refreshed, 'the concurrent writer never fired -- the reclaim DELETE was not reached');
    assert.equal(
      result.skip, true,
      'the losing isolate proceeded anyway: BOTH isolates now run the handler for one Stripe event'
    );
    assert.equal(result.response.status, 500, 'the loser must force a Stripe retry, not ack');
    assert.deepEqual(await result.response.json(), { ok: false, error: 'in-flight' });

    const survivor = row(db, 'evt_1');
    assert.ok(survivor, 'the winner\'s claim must survive');
    assert.ok(
      Math.abs(survivor.processed_at - nowSec()) <= 2,
      'the winner\'s fresh claim must still be the one in the table'
    );
    db.close();
  });

  it('still reclaims when the concurrent writer refreshed the row to a value that is ALSO stale', async () => {
    // Complement of the test above: the cutoff is a staleness test, not a
    // "did anything change" test. A row refreshed to a still-stale timestamp is
    // still an abandoned claim and must be reclaimed.
    let bumped = false;
    const db = dedupDb(undefined, ({ sql, db: raw }) => {
      if (!bumped && sql.includes('DELETE FROM webhook_event') && sql.includes('processed_at <= ?')) {
        bumped = true;
        raw.prepare('UPDATE webhook_event SET processed_at = ? WHERE event_id = ?')
          .run(nowSec() - (TTL + 5), 'evt_1');
      }
    });
    claim(db, 'evt_1', { ageSec: TTL + 300 });

    const result = await dedup(db);
    assert.ok(bumped);
    assert.equal(result.skip, false, 'a still-stale claim must remain reclaimable');
    db.close();
  });
});

describe('dedupWebhookEvent -- database failure', () => {
  it('returns an error response rather than letting the handler run unguarded', async () => {
    const throwing = {
      prepare() {
        return { bind() { return this; }, async run() { throw new Error('D1_ERROR: network'); }, async first() { throw new Error('D1_ERROR: network'); } };
      },
    };
    const result = await dedupWebhookEvent(throwing, 'evt_1', mockEnv(), mockWaitUntil());
    assert.equal(result.skip, false);
    assert.ok(result.error, 'a dedup failure must surface an error response, not a silent proceed');
    assert.equal(result.error.status, 500);
    assert.equal((await result.error.json()).error, 'Internal error', 'the D1 message must not leak');
  });
});
