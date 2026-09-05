/**
 * Unit tests for the first-party conversion ledger written by sendGA4Event
 * (functions/api/_ga4.js) behind the CONVERSION_LEDGER flag.
 * Run with: node --test test/ga4-conversion-ledger.test.js
 *
 * The ledger is an ADDITIVE write on the GA4 relay choke point, so every test
 * here holds one of two lines: the row is what migrations/036-conversion-ledger.sql
 * says it is, or the GA4 send is untouched by whatever the ledger did.
 *
 * SCHEMA. sqliteD1's default rrm-auth composition (schema.sql + the replay list
 * in test/_d1-sqlite.mjs) does NOT reach conversion_event: 036 lives in the ROOT
 * migrations/ directory, which the replay list does not read, and postdates the
 * 2026-05-27 snapshot. It is composed on here the same way test/_community-sqlite.mjs
 * composes 025/027/032, so the tests run against the real DDL rather than a
 * table this file invented. What that CANNOT prove is that 036 has been applied
 * to live rrm-auth; that is scripts/gates/validate-schema-drift.mjs's job, and
 * scripts/gates/validate-sql-columns.mjs carries the matching EXTRA_DDL entry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sendGA4Event, deriveLedgerType } from '../functions/api/_ga4.js';
import { mockRequest, mockEnv, stubExternalFetch } from './_helpers.js';
import { sqliteD1, SCHEMA_SQL, insertUser, insertSession } from './_d1-sqlite.mjs';

const LEDGER_SCHEMA_SQL =
  SCHEMA_SQL + '\n' +
  readFileSync(new URL('../migrations/036-conversion-ledger.sql', import.meta.url), 'utf8') + '\n' +
  readFileSync(new URL('../migrations/039-first-touch-attribution.sql', import.meta.url), 'utf8');

function ledgerD1({ seed } = {}) {
  return sqliteD1({ seed, schemaSql: LEDGER_SCHEMA_SQL });
}

function rows(db) {
  return db._sqlite.prepare('SELECT * FROM conversion_event ORDER BY id').all().map((r) => ({ ...r }));
}

function makeRequest({ cookie = '', entryRef = '', entryUrl = 'https://rrmacademy.org/?utm_campaign=aug_push' } = {}) {
  const cookies = [`entry_ref=${encodeURIComponent(entryRef)}`, `entry_url=${encodeURIComponent(entryUrl)}`];
  if (cookie) cookies.push(cookie);
  return mockRequest('POST', {
    headers: {
      'CF-Connecting-IP': '203.0.113.5',
      'User-Agent': 'Mozilla/5.0 (test-agent)',
      Cookie: cookies.join('; '),
    },
    url: 'https://rrmacademy.org/api/test',
  });
}

// -------------------------------------------------------------- type table ---

describe('conversion ledger -- migration 039 composes onto 036', () => {
  it('PRAGMA table_info reports all seven first-touch columns', () => {
    const db = ledgerD1();
    try {
      const columns = db._sqlite.prepare('PRAGMA table_info(conversion_event)').all().map((r) => r.name);
      for (const col of ['ft_source', 'ft_medium', 'ft_campaign', 'ft_landing', 'ft_at', 'click_id', 'transaction_id']) {
        assert.ok(columns.includes(col), `conversion_event.${col} missing after composing 039 onto 036`);
      }
    } finally { db.close(); }
  });
});

describe('conversion ledger -- type derivation', () => {
  // Every branch of the contract in migrations/036-conversion-ledger.sql,
  // including both 'other' fallbacks and the deliberate page_view null.
  const table = [
    ['purchase donation',        'purchase',        { items: [{ item_name: 'Donation' }] },          'donation'],
    ['purchase course',          'purchase',        { items: [{ item_name: 'Course: endo-101' }] },  'course'],
    ['purchase course any case', 'purchase',        { items: [{ item_name: 'COURSE: endo-101' }] },  'course'],
    ['purchase stuc tier',       'purchase',        { items: [{ item_name: 'STUC Supporter' }] },    'stuc_supporter'],
    ['purchase stuc multiword',  'purchase',        { items: [{ item_name: 'STUC Founding Member' }] }, 'stuc_founding_member'],
    ['purchase stuc any case',   'purchase',        { items: [{ item_name: 'Stuc Supporter' }] },    'stuc_supporter'],
    ['checkout donation',        'begin_checkout',  { items: [{ item_name: 'Donation' }] },          'donation'],
    ['checkout stuc tier',       'begin_checkout',  { items: [{ item_name: 'STUC Advocate' }] },     'stuc_advocate'],
    ['checkout unknown item',    'begin_checkout',  { items: [{ item_name: 'Event: fall-webinar' }] }, 'other'],
    ['checkout missing items',   'begin_checkout',  {},                                              'other'],
    ['checkout empty items',     'begin_checkout',  { items: [] },                                   'other'],
    ['checkout non-string item', 'begin_checkout',  { items: [{ item_name: 42 }] },                  'other'],
    ['lead with source',         'generate_lead',   { lead_source: 'newsletter' },                   'newsletter'],
    ['lead missing source',      'generate_lead',   {},                                              'other'],
    ['lead empty source',        'generate_lead',   { lead_source: '' },                             'other'],
    ['lead non-string source',   'generate_lead',   { lead_source: 7 },                              'other'],
    ['signup email',             'sign_up',         { method: 'email' },                             'email'],
    ['signup google',            'sign_up',         { method: 'google' },                            'google'],
    ['signup checkout',          'sign_up',         { method: 'checkout' },                          'checkout'],
    ['signup other method',      'sign_up',         { method: 'facebook' },                          'other'],
    ['signup missing method',    'sign_up',         {},                                              'other'],
    ['signup non-string method', 'sign_up',         { method: 42 },                                  'other'],
    ['page_view',                'page_view',       { page_location: 'https://rrmacademy.org/' },    null],
    ['unlisted event',           'survey_complete', { lead_source: 'endo_survey' },                  null],
  ];

  for (const [label, eventName, params, expected] of table) {
    it(`${label} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(deriveLedgerType(eventName, params), expected);
    });
  }

  // The ledger reads `params ?? sourceParams`, so a caller-supplied lead_source
  // never met the sourceParams screen in sendGA4Event. Screening it inside the
  // derivation is what keeps a phone-shaped value out of the `type` column.
  it('derives other for a PII-shaped lead_source', () => {
    for (const source of ['5551234567', '555-123-4567', 'jane@example.com', '4111 1111 1111 1111']) {
      assert.equal(deriveLedgerType('generate_lead', { lead_source: source }), 'other');
    }
  });

  it('derives other for a PII-shaped item_name rather than typing it', () => {
    assert.equal(deriveLedgerType('purchase', { items: [{ item_name: 'STUC 555-123-4567' }] }), 'other');
    assert.equal(deriveLedgerType('begin_checkout', { items: [{ item_name: 'jane@example.com' }] }), 'other');
  });

  it('caps a long lead_source at 64 chars', () => {
    const long = 'x'.repeat(200);
    assert.equal(deriveLedgerType('generate_lead', { lead_source: long }).length, 64);
  });

  it('never splits a surrogate pair straddling the 64-char cap', () => {
    // The astral character occupies positions 63 and 64, so a naive slice at 64
    // would keep its high half alone and write a lone surrogate into `type`.
    const straddling = `${'x'.repeat(63)}\u{1F600}tail`;
    const type = deriveLedgerType('generate_lead', { lead_source: straddling });
    assert.equal(type.length, 63);
    assert.equal(type, 'x'.repeat(63));
    for (const ch of type) assert.ok(ch.codePointAt(0) < 0xD800 || ch.codePointAt(0) > 0xDFFF, 'no lone surrogate');
  });
});

// ------------------------------------------------------------- flag gating ---

describe('conversion ledger -- flag gating', () => {
  it('writes no row when CONVERSION_LEDGER is unset', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db });
      await sendGA4Event(env, makeRequest(), 'generate_lead', { lead_source: 'newsletter' });
      assert.equal(fetchStub.ga4.length, 1, 'the GA4 send still happens');
      assert.deepEqual(rows(db), [], 'no ledger row without the flag');
    } finally { fetchStub.restore(); db.close(); }
  });

  it("writes no row when CONVERSION_LEDGER is '0'", async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '0' });
      await sendGA4Event(env, makeRequest(), 'generate_lead', { lead_source: 'newsletter' });
      assert.equal(fetchStub.ga4.length, 1);
      assert.deepEqual(rows(db), []);
    } finally { fetchStub.restore(); db.close(); }
  });

  it("writes one row when CONVERSION_LEDGER is '1'", async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'purchase', {
        value: 49.99,
        currency: 'USD',
        items: [{ item_name: 'Course: endo-101' }],
      });
      assert.equal(fetchStub.ga4.length, 1);
      const [row] = rows(db);
      assert.equal(row.event, 'purchase');
      assert.equal(row.type, 'course');
      assert.equal(row.value_cents, 4999, 'dollars are stored as integer cents');
      assert.equal(row.item, 'Course: endo-101');
      assert.equal(row.entry_category, 'direct');
      assert.equal(row.entry_source, 'direct');
      assert.equal(row.utm_campaign, 'aug_push');
      assert.equal(typeof row.client_id, 'string');
      assert.equal(typeof row.session_id, 'string');
      assert.ok(row.ts, 'ts comes from the column default');
    } finally { fetchStub.restore(); db.close(); }
  });

  it("writes cents for a numeric STRING value, which GA4's MP allows", async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'purchase', {
        value: '50.00',
        items: [{ item_name: 'Donation' }],
      });
      const [row] = rows(db);
      assert.equal(row.value_cents, 5000);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('never splits a surrogate pair straddling the 128-char item cap', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'purchase', {
        value: 1,
        items: [{ item_name: `${'x'.repeat(127)}\u{1F600}tail` }],
      });
      const [row] = rows(db);
      assert.equal(row.item.length, 127, 'the high surrogate is dropped rather than orphaned');
      assert.equal(row.item, 'x'.repeat(127));
    } finally { fetchStub.restore(); db.close(); }
  });

  it('writes a null value_cents when the event carries no numeric value', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'generate_lead', { lead_source: 'newsletter', value: 'free' });
      const [row] = rows(db);
      assert.equal(row.value_cents, null);
      assert.equal(row.type, 'newsletter');
      assert.equal(row.item, null);
    } finally { fetchStub.restore(); db.close(); }
  });
});

// ------------------------------------------------------------- event scope ---

describe('conversion ledger -- event scope', () => {
  // The relay carries every server-side event; the ledger carries five. These
  // three are the engagement signals that were landing rows before the scope
  // gate, and the GA4 send must be untouched by their exclusion.
  for (const [eventName, params] of [
    ['scroll_depth', { percent_scrolled: 90 }],
    ['user_engagement', { engagement_time_msec: 15000 }],
    ['cta_click', { id: 'hero-primary', page: '/endometriosis/' }],
  ]) {
    it(`writes no row for ${eventName} while GA4 still receives it`, async () => {
      const fetchStub = stubExternalFetch();
      const db = ledgerD1();
      try {
        const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
        await sendGA4Event(env, makeRequest(), eventName, params);
        assert.equal(fetchStub.ga4.length, 1, 'the GA4 send is unchanged');
        assert.deepEqual(rows(db), [], 'no ledger row outside the five funnel events');
      } finally { fetchStub.restore(); db.close(); }
    });
  }

  for (const [eventName, params] of [
    ['page_view', { page_location: 'https://rrmacademy.org/' }],
    ['sign_up', { method: 'email' }],
    ['generate_lead', { lead_source: 'newsletter' }],
    ['begin_checkout', { value: 25, items: [{ item_name: 'Donation' }] }],
    ['purchase', { value: 25, items: [{ item_name: 'Donation' }] }],
  ]) {
    it(`still writes a row for ${eventName}`, async () => {
      const fetchStub = stubExternalFetch();
      const db = ledgerD1();
      try {
        const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
        await sendGA4Event(env, makeRequest(), eventName, params);
        assert.equal(fetchStub.ga4.length, 1);
        const written = rows(db);
        assert.equal(written.length, 1);
        assert.equal(written[0].event, eventName);
      } finally { fetchStub.restore(); db.close(); }
    });
  }

  // The scope gate sits ahead of resolveLedgerUserId, so an out-of-scope event
  // carrying a live session cookie never reaches the session lookup either.
  it('resolves no session for an out-of-scope event carrying a live session', async () => {
    const fetchStub = stubExternalFetch();
    const RAW_SESSION = 'sess_scope_gate_cookie_value';
    const db = ledgerD1({
      seed(sqlite) { insertUser(sqlite, { id: 'usr_scope_1', email: 'scope@example.com' }); },
    });
    await insertSession(db._sqlite, {
      rawId: RAW_SESSION,
      userId: 'usr_scope_1',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest({ cookie: `session=${RAW_SESSION}` }), 'scroll_depth', { percent_scrolled: 50 });
      assert.deepEqual(rows(db), []);
      const sessionReads = db._calls.filter((c) => /FROM session/i.test(c.sql));
      assert.equal(sessionReads.length, 0, 'an out-of-scope event must not attempt the session lookup');
    } finally { fetchStub.restore(); db.close(); }
  });
});

// ----------------------------------------------------------- entry_source ---

describe('conversion ledger -- entry_source', () => {
  it('prefers the classified entry_platform', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest({
        entryRef: 'https://chatgpt.com/c/abc',
        entryUrl: 'https://rrmacademy.org/?utm_source=partner_news&utm_campaign=aug_push',
      }), 'generate_lead', { lead_source: 'newsletter' });
      const [row] = rows(db);
      assert.equal(row.entry_source, 'chatgpt', 'entry_platform wins over utm_source');
      assert.equal(row.entry_category, 'ai');
    } finally { fetchStub.restore(); db.close(); }
  });

  it('falls back to utm_source when entry_platform is absent', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      // A referring hostname whose leading label is a bare 10-digit run matches
      // the phone alternative of PII_VALUE_REGEX, so the screen in sendGA4Event
      // deletes entry_platform before the payload is built. entry_category and
      // utm_source survive, which is exactly the shape the fallback exists for.
      await sendGA4Event(env, makeRequest({
        entryRef: 'https://5551234567.example.com/blog/',
        entryUrl: 'https://rrmacademy.org/?utm_source=partner_news&utm_campaign=aug_push',
      }), 'generate_lead', { lead_source: 'newsletter' });
      const [row] = rows(db);
      assert.equal(row.entry_source, 'partner_news', 'utm_source is the fallback');
      assert.equal(row.entry_category, 'referral');
    } finally { fetchStub.restore(); db.close(); }
  });

  // The GA4 payload spreads `...sourceParams, ...params`, so a caller-supplied
  // attribution value wins there. The ledger reads with the same precedence, or
  // the webhooks' ga_* metadata replay would be dropped from the row and the
  // two surfaces would disagree about where one purchase came from.
  it('prefers caller-supplied attribution over the request-derived source, as the payload does', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest({
        entryRef: 'https://chatgpt.com/c/abc',
        entryUrl: 'https://rrmacademy.org/?utm_source=organic_news&utm_campaign=direct_visit',
      }), 'purchase', {
        value: 25,
        items: [{ item_name: 'Donation' }],
        entry_category: 'email',
        entry_platform: 'newsletter',
        utm_source: 'aug_blast',
        utm_campaign: 'fall_cohort',
      });
      const [row] = rows(db);
      assert.equal(row.entry_source, 'newsletter', 'the caller entry_platform wins over the classified one');
      assert.equal(row.entry_category, 'email');
      assert.equal(row.utm_campaign, 'fall_cohort');

      const payload = fetchStub.ga4[0].body.events[0].params;
      assert.equal(row.entry_category, payload.entry_category, 'the row and the GA4 payload agree');
      assert.equal(row.utm_campaign, payload.utm_campaign);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('falls back to the request-derived source for attribution the caller did not supply', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest({
        entryRef: 'https://chatgpt.com/c/abc',
        entryUrl: 'https://rrmacademy.org/?utm_campaign=aug_push',
      }), 'purchase', { value: 25, items: [{ item_name: 'Donation' }] });
      const [row] = rows(db);
      assert.equal(row.entry_source, 'chatgpt');
      assert.equal(row.entry_category, 'ai');
      assert.equal(row.utm_campaign, 'aug_push');
    } finally { fetchStub.restore(); db.close(); }
  });

  it('caps entry_source at 64 chars', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      const longHost = `${'a'.repeat(90)}.example.com`;
      await sendGA4Event(env, makeRequest({
        entryRef: `https://${longHost}/`,
        entryUrl: 'https://rrmacademy.org/',
      }), 'generate_lead', { lead_source: 'newsletter' });
      const [row] = rows(db);
      assert.equal(row.entry_source.length, 64);
      assert.equal(row.entry_source, longHost.slice(0, 64));
    } finally { fetchStub.restore(); db.close(); }
  });
});

// -------------------------------------------------------- failure isolation ---

describe('conversion ledger -- failure isolation', () => {
  it('a throwing ledger DB leaves the GA4 send intact and logs no row values', async () => {
    const fetchStub = stubExternalFetch();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
    try {
      const env = mockEnv({
        DB: {
          prepare() {
            return {
              bind() { return this; },
              async first() { throw new Error('D1_ERROR: no such table: conversion_event'); },
              async run() { throw new Error('D1_ERROR: no such table: conversion_event'); },
            };
          },
        },
        CONVERSION_LEDGER: '1',
      });
      await assert.doesNotReject(() => sendGA4Event(env, makeRequest(), 'purchase', {
        value: 49.99,
        items: [{ item_name: 'Donation' }],
      }));
      assert.equal(fetchStub.ga4.length, 1, 'the GA4 Measurement Protocol call still went out');
      const p = fetchStub.ga4[0].body.events[0].params;
      assert.equal(p.value, 49.99, 'the GA4 payload is unaltered by the ledger');
      assert.equal(p.utm_campaign, 'aug_push');

      const logged = warnings.join('\n');
      assert.ok(/ledger/i.test(logged) && logged.includes('purchase'), 'the warn names the event');
      for (const secret of ['Donation', '49.99', 'aug_push', '203.0.113.5', 'Mozilla', 'no such table']) {
        assert.ok(!logged.includes(secret), `ledger warn must not log ${secret}`);
      }
    } finally { console.warn = originalWarn; fetchStub.restore(); }
  });

  it('a ledger INSERT failure also produces one AE datapoint with action ledger_write_failed, without throwing or touching the GA4 send', async () => {
    const fetchStub = stubExternalFetch();
    const originalWarn = console.warn;
    console.warn = () => {};
    const aeCalls = [];
    try {
      const env = mockEnv({
        DB: {
          prepare() {
            return {
              bind() { return this; },
              async first() { throw new Error('D1_ERROR: no such column: ft_source'); },
              async run() { throw new Error('D1_ERROR: no such column: ft_source'); },
            };
          },
        },
        CONVERSION_LEDGER: '1',
        EVENTS: { writeDataPoint(point) { aeCalls.push(point); } },
      });
      await assert.doesNotReject(() => sendGA4Event(env, makeRequest(), 'purchase', {
        value: 49.99,
        items: [{ item_name: 'Donation' }],
      }));
      assert.equal(fetchStub.ga4.length, 1, 'the GA4 Measurement Protocol call still went out');

      const ledgerFailures = aeCalls.filter((p) => p.blobs?.[2] === 'ledger_write_failed');
      assert.equal(ledgerFailures.length, 1, 'exactly one ledger_write_failed AE datapoint');
      assert.equal(ledgerFailures[0].blobs[0], 'rrm-academy');
      assert.equal(ledgerFailures[0].blobs[1], 'ga4');
      assert.equal(ledgerFailures[0].blobs[3], 'error');
      assert.ok(ledgerFailures[0].blobs[4].includes('Error'), 'detail carries the error name');
    } finally { console.warn = originalWarn; fetchStub.restore(); }
  });

  it('a ledger DB that throws synchronously on prepare still leaves sendGA4Event resolved', async () => {
    const fetchStub = stubExternalFetch();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const env = mockEnv({
        DB: { prepare() { throw new TypeError('binding unavailable'); } },
        CONVERSION_LEDGER: '1',
      });
      await assert.doesNotReject(() => sendGA4Event(env, makeRequest(), 'sign_up', { method: 'email' }));
      assert.equal(fetchStub.ga4.length, 1);
    } finally { console.warn = originalWarn; fetchStub.restore(); }
  });
});

// ---------------------------------------------------------------- user_id ---

describe('conversion ledger -- user_id', () => {
  const RAW_SESSION = 'sess_ledger_test_cookie_value';
  const FUTURE = Math.floor(Date.now() / 1000) + 3600;

  async function seededDb() {
    const db = ledgerD1({
      seed(sqlite) { insertUser(sqlite, { id: 'usr_ledger_1', email: 'ledger@example.com' }); },
    });
    await insertSession(db._sqlite, { rawId: RAW_SESSION, userId: 'usr_ledger_1', expiresAt: FUTURE });
    return db;
  }

  it('populates user_id for a conversion event carrying a valid session', async () => {
    const fetchStub = stubExternalFetch();
    const db = await seededDb();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest({ cookie: `session=${RAW_SESSION}` }), 'begin_checkout', {
        value: 25,
        items: [{ item_name: 'STUC Supporter' }],
      });
      const [row] = rows(db);
      assert.equal(row.user_id, 'usr_ledger_1');
      assert.equal(row.type, 'stuc_supporter');
      assert.equal(row.value_cents, 2500);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('leaves user_id null for page_view even when a valid session is present', async () => {
    const fetchStub = stubExternalFetch();
    const db = await seededDb();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest({ cookie: `session=${RAW_SESSION}` }), 'page_view', {
        page_location: 'https://rrmacademy.org/courses/',
      });
      const [row] = rows(db);
      assert.equal(row.event, 'page_view');
      assert.equal(row.type, null);
      assert.equal(row.user_id, null, 'page_view must never carry a user id');
      const sessionReads = db._calls.filter((c) => /FROM session/i.test(c.sql));
      assert.equal(sessionReads.length, 0, 'page_view must not even attempt the session lookup');
    } finally { fetchStub.restore(); db.close(); }
  });

  it('leaves user_id null for a conversion event with no session cookie', async () => {
    const fetchStub = stubExternalFetch();
    const db = await seededDb();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'sign_up', { method: 'email' });
      const [row] = rows(db);
      assert.equal(row.event, 'sign_up');
      assert.equal(row.type, 'email');
      assert.equal(row.user_id, null);
    } finally { fetchStub.restore(); db.close(); }
  });

  // The webhook replay case: functions/api/billing/_webhook-checkout.js sends
  // the three purchase events on STRIPE's request, which carries no session
  // cookie of ours. Without the override the buyer's purchase keys to their
  // client id while every earlier row of theirs keys to their user id.
  it('takes user_id from the caller when the request carries no session of ours', async () => {
    const fetchStub = stubExternalFetch();
    const db = await seededDb();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'purchase', {
        value: 49.99,
        items: [{ item_name: 'Course: endo-101' }],
      }, { client_id: 'ga-client-1', session_id: 1723500000, user_id: 'usr_ledger_1' });
      const [row] = rows(db);
      assert.equal(row.user_id, 'usr_ledger_1');
      assert.equal(row.client_id, 'ga-client-1');
      assert.equal(row.session_id, '1723500000');
      const sessionReads = db._calls.filter((c) => /FROM session/i.test(c.sql));
      assert.equal(sessionReads.length, 0, 'a supplied id short-circuits the cookie lookup');
    } finally { fetchStub.restore(); db.close(); }
  });

  it('prefers the caller-supplied user_id over the one the session cookie resolves to', async () => {
    const fetchStub = stubExternalFetch();
    const db = await seededDb();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest({ cookie: `session=${RAW_SESSION}` }), 'purchase', {
        value: 10,
        items: [{ item_name: 'Donation' }],
      }, { user_id: 'usr_from_webhook' });
      const [row] = rows(db);
      assert.equal(row.user_id, 'usr_from_webhook');
    } finally { fetchStub.restore(); db.close(); }
  });

  it('ignores a non-string or empty user_id override and falls back to the cookie', async () => {
    const fetchStub = stubExternalFetch();
    const db = await seededDb();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      for (const bogus of [41, null, '', { id: 'usr_x' }]) {
        await sendGA4Event(env, makeRequest({ cookie: `session=${RAW_SESSION}` }), 'purchase', {
          value: 10,
          items: [{ item_name: 'Donation' }],
        }, { user_id: bogus });
      }
      for (const row of rows(db)) assert.equal(row.user_id, 'usr_ledger_1');
    } finally { fetchStub.restore(); db.close(); }
  });

  it('caps a supplied user_id at 128 chars', async () => {
    const fetchStub = stubExternalFetch();
    const db = await seededDb();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'sign_up', { method: 'email' }, { user_id: 'u'.repeat(300) });
      const [row] = rows(db);
      assert.equal(row.user_id.length, 128);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('ignores a supplied user_id on page_view, which never carries one', async () => {
    const fetchStub = stubExternalFetch();
    const db = await seededDb();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'page_view', {
        page_location: 'https://rrmacademy.org/courses/',
      }, { user_id: 'usr_ledger_1' });
      const [row] = rows(db);
      assert.equal(row.user_id, null);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('leaves user_id null when the session cookie matches no live session', async () => {
    const fetchStub = stubExternalFetch();
    const db = await seededDb();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest({ cookie: 'session=not_a_real_session' }), 'generate_lead', {
        lead_source: 'newsletter',
      });
      const [row] = rows(db);
      assert.equal(row.user_id, null);
    } finally { fetchStub.restore(); db.close(); }
  });
});

// ------------------------------------------------------------ idempotency ---

describe('conversion ledger -- dedup_key', () => {
  const donation = { value: 25, items: [{ item_name: 'Donation' }] };

  it('writes one row when the same dedup_key arrives twice', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      // The 5xx-retry window: the handler wrote a row, returned 500, the
      // webhook_event dedup row was rolled back, and Stripe redelivered.
      for (let i = 0; i < 2; i += 1) {
        await sendGA4Event(env, makeRequest(), 'purchase', donation, { event_id: 'evt_retry_1' });
      }
      const written = rows(db);
      assert.equal(written.length, 1, 'the redelivery is ignored');
      assert.equal(written[0].dedup_key, 'purchase:evt_retry_1');
      assert.equal(fetchStub.ga4.length, 2, 'both GA4 sends still go out');
    } finally { fetchStub.restore(); db.close(); }
  });

  // One Stripe checkout.session.completed relays BOTH a sign_up (for an account
  // the checkout just created) and a purchase, and _webhook-checkout.js passes
  // the same gaOverrides -- so the same event.id -- to both. On a bare dedup key
  // the second INSERT collides on the UNIQUE index and INSERT OR IGNORE drops it
  // without a word, silently undercounting one of the two in the table built to
  // stop undercounting.
  it('writes both rows for two different events sharing one Stripe event id', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      const overrides = { client_id: 'GA1.1.9.9', session_id: 1738000000, user_id: 'usr_new', event_id: 'evt_shared' };
      await sendGA4Event(env, makeRequest(), 'sign_up', { method: 'checkout' }, overrides);
      await sendGA4Event(env, makeRequest(), 'purchase', donation, overrides);
      const written = rows(db);
      assert.equal(written.length, 2, 'the qualified keys differ, so neither row is dropped');
      assert.deepEqual(written.map((r) => r.event), ['sign_up', 'purchase']);
      assert.deepEqual(written.map((r) => r.dedup_key), ['sign_up:evt_shared', 'purchase:evt_shared']);
      assert.deepEqual(written.map((r) => r.type), ['checkout', 'donation']);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('still writes one row when the same event name and event id arrive twice', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      // Qualification must not weaken redelivery idempotency: a redelivered
      // checkout replays the SAME sign_up under the same Stripe event id.
      for (let i = 0; i < 2; i += 1) {
        await sendGA4Event(env, makeRequest(), 'sign_up', { method: 'checkout' }, { event_id: 'evt_shared' });
      }
      const written = rows(db);
      assert.equal(written.length, 1, 'the redelivery is still ignored');
      assert.equal(written[0].dedup_key, 'sign_up:evt_shared');
    } finally { fetchStub.restore(); db.close(); }
  });

  it('writes every row when dedup_key is null, which UNIQUE allows without limit', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      // Client-beacon and direct-caller events have no natural event identity.
      for (let i = 0; i < 3; i += 1) {
        await sendGA4Event(env, makeRequest(), 'purchase', donation);
      }
      const written = rows(db);
      assert.equal(written.length, 3);
      for (const row of written) assert.equal(row.dedup_key, null);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('keeps distinct dedup_keys apart', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'purchase', donation, { event_id: 'evt_a' });
      await sendGA4Event(env, makeRequest(), 'purchase', donation, { event_id: 'evt_b' });
      assert.deepEqual(rows(db).map((r) => r.dedup_key), ['purchase:evt_a', 'purchase:evt_b']);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('ignores a non-string or empty event_id and caps a long one at 128 chars', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      for (const bogus of [42, null, '', { id: 'evt_x' }]) {
        await sendGA4Event(env, makeRequest(), 'purchase', donation, { event_id: bogus });
      }
      await sendGA4Event(env, makeRequest(), 'purchase', donation, { event_id: 'e'.repeat(300) });
      const written = rows(db);
      assert.equal(written.length, 5, 'the four null keys all land');
      for (const row of written.slice(0, 4)) assert.equal(row.dedup_key, null);
      assert.equal(written[4].dedup_key.length, 128, 'the qualified key is capped as a whole');
      assert.ok(written[4].dedup_key.startsWith('purchase:e'));
    } finally { fetchStub.restore(); db.close(); }
  });

  it('binds null rather than a bare event name when no event_id is supplied', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      // Qualification must not invent a key for the unkeyed callers -- a
      // 'purchase:' prefix with nothing after it would make every client-beacon
      // purchase collide with every other one and land exactly one row ever.
      for (let i = 0; i < 3; i += 1) {
        await sendGA4Event(env, makeRequest(), 'purchase', donation);
        await sendGA4Event(env, makeRequest(), 'sign_up', { method: 'email' });
      }
      const written = rows(db);
      assert.equal(written.length, 6);
      for (const row of written) assert.equal(row.dedup_key, null);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('never lets dedup_key reach the GA4 payload', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'purchase', donation, { event_id: 'evt_payload_check' });
      const serialized = JSON.stringify(fetchStub.ga4[0].body);
      assert.ok(!serialized.includes('evt_payload_check'), 'event_id is ledger-only');
      assert.ok(!serialized.includes('event_id'));
    } finally { fetchStub.restore(); db.close(); }
  });
});

// ---------------------------------------------------- ledger-side PII screen ---

describe('conversion ledger -- caller-supplied params are screened at the ledger boundary', () => {
  // sendGA4Event screens sourceParams only, and must keep doing exactly that:
  // the GA4 payload is a pinned contract. The ledger reads params with higher
  // precedence than sourceParams, so the screen has to run again on its side.
  it('writes null for an email-shaped utm_campaign while GA4 still carries it', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'purchase', {
        value: 25,
        items: [{ item_name: 'Donation' }],
        utm_campaign: 'jane.doe@example.com',
      });
      const [row] = rows(db);
      assert.equal(row.utm_campaign, null, 'the ledger drops it');
      const payload = fetchStub.ga4[0].body.events[0].params;
      assert.equal(payload.utm_campaign, 'jane.doe@example.com', 'the GA4 payload is untouched');
    } finally { fetchStub.restore(); db.close(); }
  });

  it('writes null for a PII-shaped entry_category and item, and falls entry_source back to utm_source', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'purchase', {
        value: 25,
        items: [{ item_name: 'Donation 4111 1111 1111 1111' }],
        entry_category: 'jane@example.com',
        entry_platform: '5551234567',
        utm_source: 'partner_news',
      });
      const [row] = rows(db);
      assert.equal(row.entry_category, null);
      assert.equal(row.item, null);
      assert.equal(row.entry_source, 'partner_news',
        'a screened entry_platform falls through to utm_source rather than nulling the column');
      assert.equal(row.type, 'other', 'a PII-shaped item_name derives other, never the raw value');
    } finally { fetchStub.restore(); db.close(); }
  });

  it('leaves a numeric session_id and client_id unscreened', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      // A 10-digit GA4 session id matches the phone alternative of
      // PII_VALUE_REGEX. Identifiers are exempt for exactly this reason.
      await sendGA4Event(env, makeRequest(), 'purchase', {
        value: 25, items: [{ item_name: 'Donation' }],
      }, { client_id: '1234567890.1723500000', session_id: 1723500000, event_id: 'evt_ident' });
      const [row] = rows(db);
      assert.equal(row.session_id, '1723500000');
      assert.equal(row.client_id, '1234567890.1723500000');
      assert.equal(row.dedup_key, 'purchase:evt_ident');
    } finally { fetchStub.restore(); db.close(); }
  });
});

// ------------------------------------------- independence from GA4 credentials ---

describe('conversion ledger -- runs without GA4 credentials', () => {
  // The ledger is our own record of these conversions, so a credential lapse
  // (exactly when GA4 is losing data) must not also stop the ledger.
  function silenceWarn() {
    const original = console.warn;
    console.warn = () => {};
    return () => { console.warn = original; };
  }

  it('writes a ledger row and dispatches no fetch when credentials are missing', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    const restoreWarn = silenceWarn();
    try {
      const env = mockEnv({
        DB: db,
        CONVERSION_LEDGER: '1',
        GA4_MEASUREMENT_ID: undefined,
        GA4_API_SECRET: undefined,
      });
      await sendGA4Event(env, makeRequest(), 'purchase', {
        value: 49.99,
        items: [{ item_name: 'Course: endo-101' }],
      }, { event_id: 'evt_no_creds' });
      assert.equal(fetchStub.calls.length, 0, 'nothing is dispatched without credentials');
      const [row] = rows(db);
      assert.equal(row.event, 'purchase');
      assert.equal(row.type, 'course');
      assert.equal(row.value_cents, 4999);
      assert.equal(row.utm_campaign, 'aug_push', 'attribution is still resolved from the request');
      assert.equal(row.dedup_key, 'purchase:evt_no_creds');
    } finally { restoreWarn(); fetchStub.restore(); db.close(); }
  });

  it('writes nothing when credentials are missing and the flag is off', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    const restoreWarn = silenceWarn();
    try {
      const env = mockEnv({ DB: db, GA4_MEASUREMENT_ID: undefined, GA4_API_SECRET: undefined });
      await assert.doesNotReject(() => sendGA4Event(env, makeRequest(), 'purchase', {
        value: 10, items: [{ item_name: 'Donation' }],
      }));
      assert.equal(fetchStub.calls.length, 0);
      assert.deepEqual(rows(db), []);
    } finally { restoreWarn(); fetchStub.restore(); db.close(); }
  });

  it('resolves the session-derived user_id without credentials', async () => {
    const fetchStub = stubExternalFetch();
    const restoreWarn = silenceWarn();
    const db = ledgerD1({
      seed(sqlite) { insertUser(sqlite, { id: 'usr_nocreds', email: 'nocreds@example.com' }); },
    });
    try {
      await insertSession(db._sqlite, {
        rawId: 'sess_nocreds_cookie', userId: 'usr_nocreds', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });
      const env = mockEnv({
        DB: db, CONVERSION_LEDGER: '1', GA4_MEASUREMENT_ID: undefined, GA4_API_SECRET: undefined,
      });
      await sendGA4Event(env, makeRequest({ cookie: 'session=sess_nocreds_cookie' }), 'sign_up', { method: 'email' });
      const [row] = rows(db);
      assert.equal(row.user_id, 'usr_nocreds');
      assert.equal(row.type, 'email');
    } finally { restoreWarn(); fetchStub.restore(); db.close(); }
  });
});

// -------------------------------------------------------- flag misconfiguration ---

describe('conversion ledger -- flag misconfiguration', () => {
  it('warns once for a CONVERSION_LEDGER value that is neither 1 nor 0, and writes nothing', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: 'true' });
      await sendGA4Event(env, makeRequest(), 'purchase', { value: 10, items: [{ item_name: 'Donation' }] });
      await sendGA4Event(env, makeRequest(), 'purchase', { value: 10, items: [{ item_name: 'Donation' }] });

      const flagWarnings = warnings.filter((w) => w.includes('CONVERSION_LEDGER'));
      assert.equal(flagWarnings.length, 1, 'one-shot, like the missing-credentials warn');
      assert.match(flagWarnings[0], /unrecognized value/);
      assert.ok(!flagWarnings[0].includes('true'), 'the misconfigured value itself is never logged');

      assert.equal(fetchStub.ga4.length, 2, 'the GA4 send is unaffected');
      assert.deepEqual(rows(db), [], 'only "1" enables the ledger');
    } finally { console.warn = originalWarn; fetchStub.restore(); db.close(); }
  });
});

// ------------------------------------------------------------- PII posture ---

describe('conversion ledger -- no raw IP or user agent is ever written', () => {
  it('writes neither the CF-Connecting-IP nor the User-Agent into any column', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      const request = makeRequest({
        entryUrl: 'https://rrmacademy.org/?utm_campaign=aug_push&utm_source=partner',
      });
      for (const eventName of ['page_view', 'sign_up', 'generate_lead', 'begin_checkout', 'purchase']) {
        await sendGA4Event(env, request, eventName, { value: 10, items: [{ item_name: 'Donation' }] });
      }
      const written = rows(db);
      assert.equal(written.length, 5);
      const serialized = JSON.stringify(written);
      assert.ok(!serialized.includes('203.0.113.5'), 'raw IP must never be written');
      assert.ok(!serialized.includes('Mozilla'), 'user agent must never be written');
      assert.ok(!serialized.includes('test-agent'), 'user agent must never be written');
      // client_id is the hashed device identifier, not the IP itself.
      for (const row of written) {
        assert.match(row.client_id, /^[0-9a-f]{16}$/, 'client_id is the 16-char hash, never a raw header');
      }
    } finally { fetchStub.restore(); db.close(); }
  });
});

// ---------------------------------------------------- first-touch columns ---

describe('conversion ledger -- first-touch columns (migration 039)', () => {
  it('a page_view with an rrm_ft cookie lands ft_* and click_id', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      const req = mockRequest('GET', {
        headers: {
          'CF-Connecting-IP': '203.0.113.9',
          'User-Agent': 'Mozilla/5.0 (test-agent)',
          Cookie: 'entry_ref=; entry_url=' + encodeURIComponent('https://rrmacademy.org/') +
            '; rrm_ft=s=google&m=cpc&c=q3_push&l=' + encodeURIComponent('/endo-quiz/') + '&g=gEAIaIQtest&d=1757030400',
        },
        url: 'https://rrmacademy.org/api/test',
      });
      await sendGA4Event(env, req, 'page_view', { page_location: 'https://rrmacademy.org/endo-quiz/' });
      const [row] = rows(db);
      assert.equal(row.ft_source, 'google');
      assert.equal(row.ft_medium, 'cpc');
      assert.equal(row.ft_campaign, 'q3_push');
      assert.equal(row.ft_landing, '/endo-quiz/');
      assert.equal(row.click_id, 'EAIaIQtest');
      assert.equal(row.ft_at, new Date(1757030400 * 1000).toISOString());
    } finally { fetchStub.restore(); db.close(); }
  });

  it('a purchase replay carries transaction_id from params, exempt from the digit-run screen', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'purchase', {
        value: 25,
        items: [{ item_name: 'Donation' }],
        transaction_id: 'pi_3Ptest1234567890123',
      });
      const [row] = rows(db);
      assert.equal(row.transaction_id, 'pi_3Ptest1234567890123');
    } finally { fetchStub.restore(); db.close(); }
  });

  it('a 66-char cs_live_ session-id fallback lands intact, not truncated to LEDGER_SHORT_CAP', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      const longSessionId = 'cs_live_' + 'a'.repeat(58);
      assert.equal(longSessionId.length, 66);
      await sendGA4Event(env, makeRequest(), 'purchase', {
        value: 0,
        items: [{ item_name: 'Donation' }],
        transaction_id: longSessionId,
      });
      const [row] = rows(db);
      assert.equal(row.transaction_id, longSessionId);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('a pre-039-style row with no rrm_ft cookie leaves ft_* and click_id NULL', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      await sendGA4Event(env, makeRequest(), 'generate_lead', { lead_source: 'newsletter' });
      const [row] = rows(db);
      assert.equal(row.ft_source, null);
      assert.equal(row.ft_medium, null);
      assert.equal(row.click_id, null);
      assert.equal(row.transaction_id, null);
    } finally { fetchStub.restore(); db.close(); }
  });

  it('an email-shaped click_id in the cookie never reaches the ledger', async () => {
    const fetchStub = stubExternalFetch();
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      const req = mockRequest('GET', {
        headers: {
          'CF-Connecting-IP': '203.0.113.10',
          'User-Agent': 'Mozilla/5.0 (test-agent)',
          Cookie: 'rrm_ft=s=google&g=g' + encodeURIComponent('someone@example.com'),
        },
        url: 'https://rrmacademy.org/api/test',
      });
      await sendGA4Event(env, req, 'page_view', { page_location: 'https://rrmacademy.org/' });
      const [row] = rows(db);
      assert.equal(row.click_id, null);
      assert.equal(row.ft_source, 'google');
    } finally { fetchStub.restore(); db.close(); }
  });
});
