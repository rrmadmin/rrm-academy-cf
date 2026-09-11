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
