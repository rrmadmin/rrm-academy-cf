/**
 * functions/api/pdf/request.js + functions/api/pdf/redeem.js + _guide-pdfs.js
 * -- the mint-then-redeem magic-link flow that gates guide PDF downloads.
 *
 * WHY A REAL ENGINE HERE
 * ----------------------
 * This pair has exactly three ways to be wrong, and all three are SILENT in
 * production -- the user still gets a PDF, so nothing pages anyone:
 *
 *   a. the token is redeemable more than ONCE (the whole point of a one-shot
 *      link),
 *   b. an EXPIRED token still redeems,
 *   c. a token minted for guide A redeems guide B (the IDOR case).
 *
 * Every one of those is a claim about DATABASE STATE SURVIVING BETWEEN TWO
 * REQUESTS. Under test/_helpers.js mockDB the first redeem's
 * `UPDATE pdf_token SET used_at = unixepoch()` writes nowhere, so a second
 * redeem re-reads the same canned unused row and "single use" can be asserted
 * without ever being true. Same for the reuse path in request.js, whose whole
 * contract is "an unused, unexpired token for this email+slug is REUSED rather
 * than re-minted" -- a canned SELECT proves only that the test author knew what
 * to hand back.
 *
 * So the DB here is test/_d1-sqlite.mjs: node:sqlite loaded with the committed
 * schema.sql, in which `pdf_token` really is
 * `token TEXT NOT NULL UNIQUE / expires_at INTEGER NOT NULL / used_at INTEGER`.
 * Writes persist; a read reflects them; an assertion can fail.
 *
 * WHAT IS STILL FAKED, AND WHAT THAT CANNOT DISTINGUISH
 * ----------------------------------------------------
 *  - R2 is `mockR2()` below. It proves WHICH KEY the handler asked for (that is
 *    the IDOR assertion) and how the handler behaves when the object is missing
 *    or the bucket throws. It does not prove the bucket really holds that key.
 *  - SES / Turnstile / ELV / DoH go through stubExternalFetch, so "the email
 *    was sent" means "a signed SES request carrying this body was issued".
 *  - Clock: expiry is driven by writing an `expires_at` in the PAST rather than
 *    by moving Date.now(). unixepoch() inside SQL is the real engine's clock,
 *    so the INSERT path's `unixepoch() + 86400` is asserted as a range, not an
 *    exact value.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, stubExternalFetch, randomIp } from './_helpers.js';
import { sqliteD1 } from './_d1-sqlite.mjs';
import { onRequestPost, onRequestOptions } from '../functions/api/pdf/request.js';
import { onRequestGet as redeemGet } from '../functions/api/pdf/redeem.js';
import { GUIDE_PDFS } from '../functions/api/_guide-pdfs.js';

const SITE = 'https://rrmacademy.org';
/** The one guide that is `enabled: true` today; request.js refuses the others. */
const LIVE_SLUG = 'rrm-care-team';
const OFF_SLUG = 'naprotechnology';

/**
 * R2 stub. Records every key requested so a test can assert the handler read
 * the key belonging to the TOKEN'S guide and not one supplied by the caller.
 */
function mockR2(objects = {}, { throwOn = null } = {}) {
  const gets = [];
  return {
    gets,
    async get(key) {
      gets.push(key);
      if (throwOn !== null && (throwOn === true || throwOn === key)) {
        throw new Error('R2 GetObject failed');
      }
      if (!Object.prototype.hasOwnProperty.call(objects, key)) return null;
      const bytes = new TextEncoder().encode(objects[key]);
      return { body: bytes, size: bytes.byteLength };
    },
  };
}

function db(opts) {
  return sqliteD1(opts);
}

function postCtx(body, { env, headers = {}, ip = null } = {}) {
  const request = mockRequest('POST', {
    url: `${SITE}/api/pdf/request`,
    body,
    headers: { 'CF-Connecting-IP': ip ?? randomIp(), ...headers },
  });
  return { request, env, waitUntil: mockWaitUntil() };
}

function getCtx(url, env) {
  return { request: mockRequest('GET', { url }), env, waitUntil: mockWaitUntil() };
}

/** Reads the single pdf_token row for a token value, or null. */
function tokenRow(harness, token) {
  const r = harness._sqlite.prepare('SELECT * FROM pdf_token WHERE token = ?').get(token);
  return r ? { ...r } : null;
}

function allTokens(harness) {
  return harness._sqlite.prepare('SELECT * FROM pdf_token ORDER BY id').all().map((r) => ({ ...r }));
}

/** Seeds a pdf_token row directly, bypassing the mint endpoint. */
function seedToken(sqlite, { token, email = 'reader@example.com', slug = LIVE_SLUG, expiresAt, usedAt = null }) {
  sqlite.prepare(
    'INSERT INTO pdf_token (token, email, guide_slug, expires_at, used_at) VALUES (?, ?, ?, ?, ?)'
  ).run(token, email, slug, expiresAt ?? Math.floor(Date.now() / 1000) + 3600, usedAt);
}

const now = () => Math.floor(Date.now() / 1000);

// --------------------------------------------------------------- config ---

describe('_guide-pdfs.js -- the config both endpoints dereference', () => {
  it('every ENABLED guide carries the fields request.js and redeem.js read', () => {
    const enabled = Object.entries(GUIDE_PDFS).filter(([, g]) => g.enabled);
    assert.ok(enabled.length > 0, 'at least one guide must be enabled or the feature is dead');
    for (const [slug, g] of enabled) {
      // request.js emails `Your ${title} - Download Link Inside`; a missing
      // title ships the literal word "undefined" to a subscriber.
      assert.equal(typeof g.title, 'string', `${slug}: title must be a string`);
      assert.ok(g.title.trim().length > 0, `${slug}: title must not be blank`);
      // redeem.js calls R2_ASSETS.get(r2Key); a missing key is an unavailable download.
      assert.equal(typeof g.r2Key, 'string', `${slug}: r2Key must be a string`);
      assert.ok(g.r2Key.endsWith('.pdf'), `${slug}: r2Key must point at a .pdf`);
    }
  });

  it('every declared pagePath is an absolute, trailing-slashed site path', () => {
    // redeem.js builds `${SITE_URL}${pagePath}?pdf_error=...`; a relative or
    // unslashed value yields a broken redirect target.
    for (const [slug, g] of Object.entries(GUIDE_PDFS)) {
      if (g.pagePath === undefined) continue;
      assert.ok(g.pagePath.startsWith('/'), `${slug}: pagePath must start with /`);
      assert.ok(g.pagePath.endsWith('/'), `${slug}: pagePath must end with /`);
    }
  });

  it('r2Key values are unique, so no two guides can serve each other\'s PDF', () => {
    const keys = Object.values(GUIDE_PDFS).map((g) => g.r2Key);
    assert.equal(new Set(keys).size, keys.length, 'duplicate r2Key across guides');
  });
});

// ------------------------------------------------- request.js: guards ---

describe('POST /api/pdf/request -- configuration and payload guards', () => {
  it('OPTIONS returns the 204 CORS preflight', async () => {
    const res = await onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  });

  it('returns 500 when the DB binding is absent', async () => {
    const env = mockEnv({ DB: undefined });
    const res = await onRequestPost(postCtx({ guide_slug: LIVE_SLUG }, { env }));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('returns 500 when SES credentials are absent -- before any token is minted', async () => {
    const harness = db();
    const env = mockEnv({ DB: harness, AWS_ACCESS_KEY_ID: undefined });
    const res = await onRequestPost(postCtx({ guide_slug: LIVE_SLUG, email: 'a@b.com' }, { env }));
    assert.equal((await parseResponse(res)).status, 500);
    assert.equal(allTokens(harness).length, 0, 'must not mint a token it cannot deliver');
    harness.close();
  });

  it('returns 400 on a body that is not JSON', async () => {
    const env = mockEnv({ DB: db() });
    const request = mockRequest('POST', { url: `${SITE}/api/pdf/request` }); // no body -> json() throws
    const res = await onRequestPost({ request, env, waitUntil: mockWaitUntil() });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('returns 400 on a JSON array payload', async () => {
    const env = mockEnv({ DB: db() });
    const res = await onRequestPost(postCtx([{ guide_slug: LIVE_SLUG }], { env }));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  it('returns 400 on a JSON null payload', async () => {
    const env = mockEnv({ DB: db() });
    const request = mockRequest('POST', { url: `${SITE}/api/pdf/request`, rawBody: 'null' });
    const res = await onRequestPost({ request, env, waitUntil: mockWaitUntil() });
    assert.equal((await parseResponse(res)).body.error, 'Invalid payload');
  });

  it('returns 400 when guide_slug is missing, blank, or not a string', async () => {
    const env = mockEnv({ DB: db() });
    for (const guide_slug of [undefined, '', 123, null, { a: 1 }]) {
      const res = await onRequestPost(postCtx({ guide_slug }, { env }));
      const { status, body } = await parseResponse(res);
      assert.equal(status, 400, `guide_slug=${JSON.stringify(guide_slug)}`);
      assert.equal(body.error, 'guide_slug is required.');
    }
  });

  it('returns 404 for an unknown guide_slug', async () => {
    const env = mockEnv({ DB: db() });
    const res = await onRequestPost(postCtx({ guide_slug: 'no-such-guide' }, { env }));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 404);
    assert.equal(body.error, 'Not found.');
  });

  it('returns 404 for a guide that exists but is enabled:false', async () => {
    // The gate that keeps unfinished guides unreachable. Distinct from "unknown
    // slug": naprotechnology IS in the config, it is just switched off.
    assert.equal(GUIDE_PDFS[OFF_SLUG].enabled, false, 'fixture assumption: naprotechnology is off');
    const harness = db();
    const env = mockEnv({ DB: harness });
    const res = await onRequestPost(postCtx({ guide_slug: OFF_SLUG, email: 'a@b.com' }, { env }));
    assert.equal((await parseResponse(res)).status, 404);
    assert.equal(allTokens(harness).length, 0, 'a disabled guide must mint no token');
    harness.close();
  });

  it('returns 429 once the per-IP budget of 5 in 15 minutes is spent', async () => {
    const harness = db();
    const env = mockEnv({ DB: harness });
    const ip = randomIp();
    const stub = stubExternalFetch();
    try {
      // The rate limiter is checked BEFORE email validation, so an invalid
      // email still consumes budget: 5 allowed, the 6th refused.
      const seen = [];
      for (let i = 0; i < 6; i++) {
        const res = await onRequestPost(postCtx({ guide_slug: LIVE_SLUG, email: 'not-an-email' }, { env, ip }));
        seen.push((await parseResponse(res)).status);
      }
      assert.deepEqual(seen, [400, 400, 400, 400, 400, 429], 'five pass the limiter, the sixth is refused');
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('returns 429 when the KV binding is missing (rate limiter fails CLOSED)', async () => {
    const env = mockEnv({ DB: db(), COMMUNITY_KV: undefined });
    const res = await onRequestPost(postCtx({ guide_slug: LIVE_SLUG, email: 'a@b.com' }, { env }));
    assert.equal((await parseResponse(res)).status, 429);
  });

  it('checks the rate limit before the DB configuration guard', async () => {
    // Order matters: a misconfigured account must not become an unmetered
    // endpoint that answers 500 as fast as it is asked.
    const env = mockEnv({ DB: undefined });
    const ip = randomIp();
    const seen = [];
    for (let i = 0; i < 6; i++) {
      const res = await onRequestPost(postCtx({ guide_slug: LIVE_SLUG, email: `a${i}@b.com` }, { env, ip }));
      seen.push((await parseResponse(res)).status);
    }
    assert.deepEqual(seen, [500, 500, 500, 500, 500, 429], 'five hit the config guard, the sixth is rate-limited');
  });

  it('returns 400 for a structurally invalid email', async () => {
    const env = mockEnv({ DB: db() });
    const res = await onRequestPost(postCtx({ guide_slug: LIVE_SLUG, email: 'reader@@example' }, { env }));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 400);
    assert.equal(body.error, 'Valid email is required.');
  });

  it('returns 400 when email is omitted entirely (the "" || default arm)', async () => {
    const env = mockEnv({ DB: db() });
    const res = await onRequestPost(postCtx({ guide_slug: LIVE_SLUG }, { env }));
    assert.equal((await parseResponse(res)).body.error, 'Valid email is required.');
  });

  it('returns 400 with the validator\'s own message for a disposable domain', async () => {
    const harness = db();
    const env = mockEnv({ DB: harness });
    const stub = stubExternalFetch();
    try {
      const res = await onRequestPost(postCtx({ guide_slug: LIVE_SLUG, email: 'reader@mailinator.com' }, { env }));
      const { status, body } = await parseResponse(res);
      assert.equal(status, 400);
      assert.notEqual(body.error, 'Valid email is required.', 'message must come from validateEmail, not the syntax check');
      assert.match(body.error, /disposable|temporary|permanent/i);
      assert.equal(allTokens(harness).length, 0);
    } finally {
      stub.restore();
      harness.close();
    }
  });
});

describe('POST /api/pdf/request -- spam and reputation gates', () => {
  it('returns 403 "Spam check failed" when Turnstile rejects the token', async () => {
    const harness = db();
    const env = mockEnv({ DB: harness });
    const stub = stubExternalFetch({ turnstile: () => ({ ok: true, json: async () => ({ success: false }) }) });
    try {
      const res = await onRequestPost(postCtx(
        { guide_slug: LIVE_SLUG, email: 'reader@example.com', turnstileToken: 'tok' }, { env }));
      const { status, body } = await parseResponse(res);
      assert.equal(status, 403);
      assert.match(body.error, /Spam check failed/);
      assert.equal(allTokens(harness).length, 0);
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('returns 403 with the RETRYABLE message when Turnstile is unreachable', async () => {
    // reason:'network' gets different copy from reason:'rejected' -- the user is
    // told to try again rather than told they look like a bot.
    const env = mockEnv({ DB: db() });
    const stub = stubExternalFetch({ turnstile: () => { throw new Error('connect ETIMEDOUT'); } });
    try {
      const res = await onRequestPost(postCtx(
        { guide_slug: LIVE_SLUG, email: 'reader@example.com', turnstileToken: 'tok' }, { env }));
      const { status, body } = await parseResponse(res);
      assert.equal(status, 403);
      assert.match(body.error, /Verification service unavailable/);
      assert.doesNotMatch(body.error, /Spam check failed/);
    } finally {
      stub.restore();
    }
  });

  it('returns 403 when CF_TURNSTILE_SECRET is unset (misconfigured, not a bypass)', async () => {
    const env = mockEnv({ DB: db(), CF_TURNSTILE_SECRET: undefined });
    const stub = stubExternalFetch();
    try {
      const res = await onRequestPost(postCtx(
        { guide_slug: LIVE_SLUG, email: 'reader@example.com', turnstileToken: 'tok' }, { env }));
      assert.equal((await parseResponse(res)).status, 403);
    } finally {
      stub.restore();
    }
  });

  it('returns 422 when EmailListVerify blocks the address', async () => {
    const harness = db();
    const env = mockEnv({ DB: harness });
    const stub = stubExternalFetch({ elv: () => ({ ok: true, text: async () => 'spamtrap' }) });
    try {
      const res = await onRequestPost(postCtx(
        { guide_slug: LIVE_SLUG, email: 'trap@example.com', turnstileToken: 'tok' }, { env }));
      const { status, body } = await parseResponse(res);
      assert.equal(status, 422);
      assert.match(body.error, /cannot be used/i);
      assert.equal(allTokens(harness).length, 0, 'a blocked address must not receive a token');
      // ...but the CRM tag is still recorded, which is the point of tagging.
      const tags = harness._sqlite.prepare("SELECT tag FROM contact_tag").all();
      assert.ok(tags.some((t) => t.tag === 'elv:spamtrap'), 'ELV verdict recorded on the contact');
    } finally {
      stub.restore();
      harness.close();
    }
  });
});

// ------------------------------------------------- request.js: minting ---

describe('POST /api/pdf/request -- minting, reuse, and CRM side effects', () => {
  async function mint(harness, { email = 'reader@example.com', slug = LIVE_SLUG, stub } = {}) {
    const env = mockEnv({ DB: harness });
    const res = await onRequestPost(postCtx({ guide_slug: slug, email, turnstileToken: 'tok' }, { env }));
    return { res, parsed: await parseResponse(res), stub };
  }

  it('mints a token, persists it unused with a ~24h expiry, and emails the redeem URL', async () => {
    const harness = db();
    const stub = stubExternalFetch();
    try {
      const before = now();
      const { parsed } = await mint(harness);
      assert.equal(parsed.status, 200);
      assert.deepEqual(parsed.body, { ok: true });

      const rows = allTokens(harness);
      assert.equal(rows.length, 1, 'exactly one token row');
      const row = rows[0];
      assert.equal(row.email, 'reader@example.com');
      assert.equal(row.guide_slug, LIVE_SLUG);
      assert.equal(row.used_at, null, 'a freshly minted token is unused');
      assert.ok(row.expires_at >= before + 86400, `expiry at least 24h out, got ${row.expires_at - before}s`);
      assert.ok(row.expires_at <= now() + 86400, 'expiry no more than 24h out');
      assert.match(row.token, /^[0-9a-f-]{36}$/, 'token is a UUID, not a guessable counter');

      // The email carries a link that redeems THAT token.
      assert.equal(stub.ses.length, 1, 'exactly one SES send');
      const sent = stub.ses[0].body;
      assert.equal(sent.Destination.ToAddresses[0], 'reader@example.com');
      assert.equal(sent.Content.Simple.Subject.Data, `Your ${GUIDE_PDFS[LIVE_SLUG].title} - Download Link Inside`);
      const expectedUrl = `${SITE}/api/pdf/redeem?token=${row.token}`;
      assert.ok(sent.Content.Simple.Body.Html.Data.includes(expectedUrl), 'HTML body links the minted token');
      assert.ok(sent.Content.Simple.Body.Text.Data.includes(expectedUrl), 'text body links the minted token');
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('the email address is lower-cased before it is stored', async () => {
    const harness = db();
    const stub = stubExternalFetch();
    try {
      await mint(harness, { email: '  Reader@Example.COM  ' });
      assert.equal(allTokens(harness)[0].email, 'reader@example.com');
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('REUSES an existing unused, unexpired token instead of minting a second one', async () => {
    const harness = db();
    const stub = stubExternalFetch();
    try {
      await mint(harness);
      const first = allTokens(harness)[0];

      await mint(harness);
      const rows = allTokens(harness);
      assert.equal(rows.length, 1, 'the second request must NOT mint a second token');
      assert.equal(rows[0].token, first.token, 'the same token value is re-sent');

      // Two emails, both pointing at the same link.
      assert.equal(stub.ses.length, 2);
      for (const s of stub.ses) {
        assert.ok(s.body.Content.Simple.Body.Text.Data.includes(first.token));
      }
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('reuse EXTENDS the expiry of the existing token (the UPDATE arm)', async () => {
    const harness = db({
      // A token minted 23 hours ago: still valid, so it is reused, and its
      // remaining life is topped back up to a full 24h.
      seed(sqlite) {
        seedToken(sqlite, { token: 'tok-nearly-stale', expiresAt: now() + 3600 });
      },
    });
    const stub = stubExternalFetch();
    try {
      await mint(harness);
      const rows = allTokens(harness);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].token, 'tok-nearly-stale');
      assert.ok(rows[0].expires_at > now() + 86000, `expiry topped up, got +${rows[0].expires_at - now()}s`);
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('does NOT reuse an expired token -- it mints a fresh one', async () => {
    const harness = db({
      seed(sqlite) { seedToken(sqlite, { token: 'tok-expired', expiresAt: now() - 10 }); },
    });
    const stub = stubExternalFetch();
    try {
      await mint(harness);
      const rows = allTokens(harness);
      assert.equal(rows.length, 2, 'the stale row stays; a new token is added');
      assert.ok(rows.some((r) => r.token !== 'tok-expired' && r.used_at === null && r.expires_at > now()));
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('does NOT reuse an already-redeemed token -- it mints a fresh one', async () => {
    const harness = db({
      seed(sqlite) { seedToken(sqlite, { token: 'tok-used', usedAt: now() - 5 }); },
    });
    const stub = stubExternalFetch();
    try {
      await mint(harness);
      const rows = allTokens(harness);
      assert.equal(rows.length, 2);
      assert.equal(tokenRow(harness, 'tok-used').used_at !== null, true, 'the spent token stays spent');
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('does NOT reuse a token minted for a DIFFERENT guide', async () => {
    const harness = db({
      seed(sqlite) { seedToken(sqlite, { token: 'tok-other-guide', slug: OFF_SLUG }); },
    });
    const stub = stubExternalFetch();
    try {
      await mint(harness, { slug: LIVE_SLUG });
      const rows = allTokens(harness);
      assert.equal(rows.length, 2, 'guide_slug is part of the reuse key');
      assert.ok(rows.some((r) => r.guide_slug === LIVE_SLUG && r.token !== 'tok-other-guide'));
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('the reuse lookup is case-insensitive on email (COLLATE NOCASE)', async () => {
    // pdf_token.email is declared BINARY in schema.sql, so the query-level
    // COLLATE NOCASE is the only thing making this match. A row written in
    // mixed case (by an older build, or by hand) must still be found.
    const harness = db({
      seed(sqlite) { seedToken(sqlite, { token: 'tok-mixed', email: 'Reader@Example.com' }); },
    });
    const stub = stubExternalFetch();
    try {
      await mint(harness, { email: 'reader@example.com' });
      const rows = allTokens(harness);
      assert.equal(rows.length, 1, 'the mixed-case row was matched and reused, not duplicated');
      assert.equal(rows[0].token, 'tok-mixed');
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('creates a newsletter subscriber tagged with the guide segment', async () => {
    const harness = db();
    const stub = stubExternalFetch();
    try {
      await mint(harness);
      const sub = harness._sqlite.prepare('SELECT * FROM newsletter_subscriber WHERE email = ?')
        .get('reader@example.com');
      assert.ok(sub, 'subscriber row created');
      assert.equal(sub.status, 'active');
      assert.equal(sub.source, 'pdf-download');
      assert.deepEqual(JSON.parse(sub.segments), [`pdf-${LIVE_SLUG}`]);
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('appends the segment to an EXISTING subscriber without dropping their others', async () => {
    const harness = db({
      seed(sqlite) {
        sqlite.prepare(
          "INSERT INTO newsletter_subscriber (id, email, status, source, subscribed_at, segments) VALUES (?, ?, 'active', 'website', datetime('now'), ?)"
        ).run('sub_1', 'reader@example.com', JSON.stringify(['stuc-member']));
      },
    });
    const stub = stubExternalFetch();
    try {
      await mint(harness);
      const sub = harness._sqlite.prepare('SELECT * FROM newsletter_subscriber WHERE email = ?')
        .get('reader@example.com');
      assert.deepEqual(JSON.parse(sub.segments), ['stuc-member', `pdf-${LIVE_SLUG}`]);
      assert.equal(sub.source, 'website', 'an existing subscriber keeps their original source');
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('does not add the same segment twice across repeat requests', async () => {
    const harness = db();
    const stub = stubExternalFetch();
    try {
      await mint(harness);
      await mint(harness);
      const sub = harness._sqlite.prepare('SELECT * FROM newsletter_subscriber WHERE email = ?')
        .get('reader@example.com');
      assert.deepEqual(JSON.parse(sub.segments), [`pdf-${LIVE_SLUG}`]);
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('upserts a CRM contact, and a repeat request updates rather than duplicates it', async () => {
    const harness = db();
    const stub = stubExternalFetch();
    try {
      await mint(harness);
      await mint(harness);
      const contacts = harness._sqlite.prepare('SELECT * FROM contact WHERE email = ?')
        .all('reader@example.com');
      assert.equal(contacts.length, 1, 'ON CONFLICT(email) DO UPDATE, not a second row');
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('returns 502 and records an email_log failure when SES rejects the send', async () => {
    const harness = db();
    const stub = stubExternalFetch({ ses: () => { throw new Error('SES connection reset'); } });
    try {
      const { parsed } = await mint(harness);
      assert.equal(parsed.status, 502);
      assert.equal(parsed.body.error, 'Failed to send email. Please try again.');
      assert.doesNotMatch(JSON.stringify(parsed.body), /connection reset/, 'no err.message leak to the client');

      const logs = harness._sqlite.prepare("SELECT * FROM email_log WHERE event = 'failed'").all();
      assert.equal(logs.length, 1, 'the failed send is recorded for the deliverability audit');
      assert.equal(logs[0].source, 'pdf/request');
      assert.equal(logs[0].category, 'transactional');
    } finally {
      stub.restore();
      harness.close();
    }
  });

  // The three tests below pin the email_log contract for this endpoint. A mail
  // component that sends without leaving a row is unauditable: nobody can tell
  // that a requester never received the guide.
  //
  // These first failed against a harness whose schema was BEHIND production:
  // test/_d1-sqlite.mjs skipped 2026-06-28-email-event.sql on the strength of
  // that file's stale "DRAFT / HELD" header, so email_log had no
  // ses_message_id column here even though live rrm-auth has had one since
  // 2026-06-28. insertEmailLog swallowed the resulting error and the row
  // vanished in tests only. The harness now replays the migration; the eight
  // column INSERT in functions/api/_ses.js is unchanged and always worked in
  // production.
  it('records the successful send in email_log so delivery is auditable', async () => {
    const harness = db();
    const stub = stubExternalFetch();
    try {
      const { parsed } = await mint(harness);
      assert.equal(parsed.status, 200);

      const logs = harness._sqlite.prepare("SELECT * FROM email_log WHERE event = 'send'").all();
      assert.equal(logs.length, 1, 'a successful send leaves exactly one audit row');
      assert.equal(logs[0].source, 'pdf/request');
      assert.equal(logs[0].category, 'transactional');
      assert.equal(logs[0].email, 'reader@example.com');
      assert.equal(
        logs[0].subject,
        `Your ${GUIDE_PDFS[LIVE_SLUG].title} - Download Link Inside`,
      );
      // The correlation key SES events join back on. This is the column the
      // stale harness was missing, so assert it lands rather than assuming it.
      assert.equal(logs[0].ses_message_id, 'mock-ses-message-id');
      assert.equal(logs[0].send_id, 'mock-ses-message-id');
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('logs the send against the lower-cased recipient, matching the token row', async () => {
    const harness = db();
    const stub = stubExternalFetch();
    try {
      await mint(harness, { email: 'Reader@Example.COM' });
      const logs = harness._sqlite.prepare('SELECT * FROM email_log').all();
      assert.ok(logs.length > 0, 'the send was logged at all');
      for (const row of logs) {
        assert.equal(row.email, 'reader@example.com', 'email_log.email is normalised');
      }
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('still returns 502, not 503, when the email_log write itself fails', async () => {
    // logEmailFailure runs INSIDE the send-failure catch block. If it threw, the
    // throw would escape to the outer handler and downgrade a truthful 502 into
    // a generic 503, losing the reason the request failed.
    const harness = db();
    const real = harness.prepare.bind(harness);
    let emailLogAttempts = 0;
    harness.prepare = (sql) => {
      if (sql.includes('INSERT INTO email_log')) {
        emailLogAttempts += 1;
        return { bind: () => ({ run: async () => { throw new Error('D1_ERROR: email_log is gone'); } }) };
      }
      return real(sql);
    };
    const stub = stubExternalFetch({ ses: () => { throw new Error('SES connection reset'); } });
    try {
      const { parsed } = await mint(harness);
      assert.equal(parsed.status, 502, 'a dead email_log must not change the status the caller sees');
      assert.equal(parsed.body.error, 'Failed to send email. Please try again.');
      assert.equal(emailLogAttempts, 1, 'a non-schema error is not retried against the base column set');
    } finally {
      stub.restore();
      harness.close();
    }
  });

  it('returns 503 without leaking the driver message when D1 throws mid-write', async () => {
    const harness = db();
    const real = harness.prepare.bind(harness);
    harness.prepare = (sql) => {
      if (sql.includes('INSERT INTO pdf_token')) {
        return { bind: () => ({ run: async () => { throw new Error('D1_ERROR: disk I/O'); } }) };
      }
      return real(sql);
    };
    const stub = stubExternalFetch();
    try {
      const { parsed } = await mint(harness);
      assert.equal(parsed.status, 503);
      assert.equal(parsed.body.error, 'service_unavailable');
      assert.doesNotMatch(JSON.stringify(parsed.body), /disk I\/O/);
      assert.equal(stub.ses.length, 0, 'no email goes out when the token was never stored');
    } finally {
      stub.restore();
      harness.close();
    }
  });
});

// --------------------------------------------------- redeem.js: guards ---

describe('GET /api/pdf/redeem -- configuration and lookup guards', () => {
  const guidesFallback = `${SITE}/guides/?pdf_error=notfound`;

  it('redirects to the guides index when the DB binding is absent', async () => {
    const env = mockEnv({ DB: undefined, R2_ASSETS: mockR2() });
    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=x`, env));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), guidesFallback);
  });

  it('redirects to the guides index when the R2 binding is absent', async () => {
    const env = mockEnv({ DB: db(), R2_ASSETS: undefined });
    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=x`, env));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), guidesFallback);
  });

  it('redirects when no token query parameter is supplied', async () => {
    const env = mockEnv({ DB: db(), R2_ASSETS: mockR2() });
    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem`, env));
    assert.equal(res.headers.get('location'), guidesFallback);
  });

  it('redirects for a token that was never minted', async () => {
    const harness = db();
    const env = mockEnv({ DB: harness, R2_ASSETS: mockR2() });
    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=fabricated`, env));
    assert.equal(res.headers.get('location'), guidesFallback);
    harness.close();
  });

  it('redirects when the token names a guide that is no longer in the config', async () => {
    // A slug retired from _guide-pdfs.js leaves live tokens behind; those must
    // dead-end at the index rather than throw on an undefined r2Key.
    const harness = db({ seed(s) { seedToken(s, { token: 'tok-orphan', slug: 'retired-guide' }); } });
    const env = mockEnv({ DB: harness, R2_ASSETS: mockR2() });
    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-orphan`, env));
    assert.equal(res.headers.get('location'), guidesFallback);
    harness.close();
  });

  it('redirects to the guides index when the outer query throws', async () => {
    const harness = db();
    harness.prepare = () => ({ bind: () => ({ first: async () => { throw new Error('D1_ERROR'); } }) });
    const env = mockEnv({ DB: harness, R2_ASSETS: mockR2() });
    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=whatever`, env));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), guidesFallback);
  });
});

// ----------------------------------- redeem.js: the three silent failures ---

describe('GET /api/pdf/redeem -- (b) an expired token must not redeem', () => {
  it('redirects to the guide page with pdf_error=expired and leaves the token unspent', async () => {
    const harness = db({
      seed(s) { seedToken(s, { token: 'tok-old', expiresAt: now() - 1 }); },
    });
    const r2 = mockR2({ [GUIDE_PDFS[LIVE_SLUG].r2Key]: '%PDF-1.7 care team' });
    const env = mockEnv({ DB: harness, R2_ASSETS: r2 });

    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-old`, env));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${SITE}${GUIDE_PDFS[LIVE_SLUG].pagePath}?pdf_error=expired`);
    assert.equal(r2.gets.length, 0, 'the bucket is never touched for an expired token');
    assert.equal(tokenRow(harness, 'tok-old').used_at, null, 'expiry must not consume the token');
    harness.close();
  });

  it('a token expiring one second in the FUTURE still redeems (boundary is not off by one)', async () => {
    const harness = db({ seed(s) { seedToken(s, { token: 'tok-edge', expiresAt: now() + 5 }); } });
    const r2 = mockR2({ [GUIDE_PDFS[LIVE_SLUG].r2Key]: '%PDF-1.7 care team' });
    const env = mockEnv({ DB: harness, R2_ASSETS: r2 });
    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-edge`, env));
    assert.equal(res.status, 200);
    harness.close();
  });

  // The two below sit ON the boundary, not near it. redeem.js compares
  //   row.expires_at < Math.floor(Date.now() / 1000)
  // so the second at which expires_at EQUALS the wall clock is the last second
  // the token is good for. Nothing above hits that second: seeding "now + 5" or
  // "now - 1" leaves the comparison correct under either < or <=, which is why
  // relaxing it to <= used to survive the whole file. Date.now is frozen for
  // the call because a real clock can tick between the seed and the read, which
  // would make the equality case flaky rather than exact.
  // The freeze must span the AWAIT, not just the call: redeem.js reads the clock
  // after `await ... .first()`, so a non-async wrapper restores Date.now before
  // the comparison ever runs and the test silently measures the real clock.
  async function atFrozenSecond(second, fn) {
    const real = Date.now;
    Date.now = () => second * 1000 + 500;
    try {
      return await fn();
    } finally {
      Date.now = real;
    }
  }

  it('a token expiring at EXACTLY the current second still redeems (< not <=)', async () => {
    const second = now();
    const harness = db({ seed(s) { seedToken(s, { token: 'tok-boundary', expiresAt: second }); } });
    const r2 = mockR2({ [GUIDE_PDFS[LIVE_SLUG].r2Key]: '%PDF-1.7 care team' });
    const env = mockEnv({ DB: harness, R2_ASSETS: r2 });

    const res = await atFrozenSecond(second, () =>
      redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-boundary`, env)));

    assert.equal(res.status, 200, 'expires_at === now is the last valid second, not the first expired one');
    assert.equal(r2.gets.length, 1, 'the bucket is read, so this is a real download and not a redirect');
    assert.notEqual(tokenRow(harness, 'tok-boundary').used_at, null, 'a boundary redeem still spends the token');
    harness.close();
  });

  it('the very next second expires it (the boundary is one second wide, not open-ended)', async () => {
    const second = now();
    const harness = db({ seed(s) { seedToken(s, { token: 'tok-boundary-next', expiresAt: second }); } });
    const r2 = mockR2({ [GUIDE_PDFS[LIVE_SLUG].r2Key]: '%PDF-1.7 care team' });
    const env = mockEnv({ DB: harness, R2_ASSETS: r2 });

    const res = await atFrozenSecond(second + 1, () =>
      redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-boundary-next`, env)));

    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${SITE}${GUIDE_PDFS[LIVE_SLUG].pagePath}?pdf_error=expired`);
    assert.equal(r2.gets.length, 0, 'the bucket is never touched for an expired token');
    assert.equal(tokenRow(harness, 'tok-boundary-next').used_at, null);
    harness.close();
  });
});

describe('GET /api/pdf/redeem -- (a) a token must redeem exactly ONCE', () => {
  it('serves the PDF on the first redeem and refuses every one after it', async () => {
    const pdfBytes = '%PDF-1.7 rrm-care-team body';
    const harness = db({ seed(s) { seedToken(s, { token: 'tok-once' }); } });
    const r2 = mockR2({ [GUIDE_PDFS[LIVE_SLUG].r2Key]: pdfBytes });
    const env = mockEnv({ DB: harness, R2_ASSETS: r2 });

    // --- first redeem: a real download
    const first = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-once`, env));
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('content-type'), 'application/pdf');
    assert.equal(first.headers.get('content-disposition'), `attachment; filename="${LIVE_SLUG}.pdf"`);
    assert.equal(first.headers.get('content-length'), String(new TextEncoder().encode(pdfBytes).byteLength));
    assert.equal(first.headers.get('cache-control'), 'private, no-store');
    assert.equal(await first.text(), pdfBytes);

    // The state change that makes the SECOND call fail actually persisted.
    const spent = tokenRow(harness, 'tok-once');
    assert.ok(typeof spent.used_at === 'number' && spent.used_at > 0, `used_at stamped, got ${spent.used_at}`);

    // --- second redeem: refused
    const second = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-once`, env));
    assert.equal(second.status, 302);
    assert.equal(second.headers.get('location'), `${SITE}${GUIDE_PDFS[LIVE_SLUG].pagePath}?pdf_error=used`);
    assert.equal(r2.gets.length, 1, 'the bucket is read once, not twice');

    // --- third, for good measure: still refused
    const third = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-once`, env));
    assert.equal(third.status, 302);
    harness.close();
  });

  it('refuses a token whose used_at was already set before the request', async () => {
    const harness = db({ seed(s) { seedToken(s, { token: 'tok-spent', usedAt: now() - 60 }); } });
    const r2 = mockR2({ [GUIDE_PDFS[LIVE_SLUG].r2Key]: '%PDF' });
    const env = mockEnv({ DB: harness, R2_ASSETS: r2 });
    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-spent`, env));
    assert.equal(res.headers.get('location'), `${SITE}${GUIDE_PDFS[LIVE_SLUG].pagePath}?pdf_error=used`);
    assert.equal(r2.gets.length, 0);
    harness.close();
  });

  it('the claiming UPDATE is the authority: a racing writer that spends the token first wins', async () => {
    // The read-then-claim window. `interleave` lands a concurrent claim between
    // the SELECT (which saw used_at NULL) and the UPDATE. The guarded
    // `WHERE used_at IS NULL` must then match zero rows and the handler must
    // refuse rather than serve a second copy.
    let raced = false;
    const harness = sqliteD1({
      seed(s) { seedToken(s, { token: 'tok-race' }); },
      interleave({ sql, db: sqlite }) {
        if (!raced && sql.includes('UPDATE pdf_token SET used_at = unixepoch()')) {
          raced = true;
          sqlite.prepare('UPDATE pdf_token SET used_at = unixepoch() WHERE token = ?').run('tok-race');
        }
      },
    });
    const r2 = mockR2({ [GUIDE_PDFS[LIVE_SLUG].r2Key]: '%PDF' });
    const env = mockEnv({ DB: harness, R2_ASSETS: r2 });

    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-race`, env));
    assert.ok(raced, 'the interleave actually fired');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${SITE}${GUIDE_PDFS[LIVE_SLUG].pagePath}?pdf_error=used`);
    assert.equal(r2.gets.length, 0, 'the loser of the race never reaches the bucket');
    harness.close();
  });
});

describe('GET /api/pdf/redeem -- (c) a token must only ever redeem its OWN guide', () => {
  it('serves the r2Key of the TOKEN\'S guide, ignoring any guide named in the query string', async () => {
    // The IDOR case. The attacker holds a valid token for rrm-care-team and
    // asks for naprotechnology; the guide must be resolved from the stored row,
    // never from caller-controlled input.
    const careTeam = '%PDF-1.7 CARE-TEAM-CONTENT';
    const napro = '%PDF-1.7 NAPRO-CONTENT';
    const harness = db({ seed(s) { seedToken(s, { token: 'tok-idor', slug: LIVE_SLUG }); } });
    const r2 = mockR2({
      [GUIDE_PDFS[LIVE_SLUG].r2Key]: careTeam,
      [GUIDE_PDFS[OFF_SLUG].r2Key]: napro,
    });
    const env = mockEnv({ DB: harness, R2_ASSETS: r2 });

    const url = `${SITE}/api/pdf/redeem?token=tok-idor`
      + `&guide_slug=${OFF_SLUG}&slug=${OFF_SLUG}&r2Key=${encodeURIComponent(GUIDE_PDFS[OFF_SLUG].r2Key)}`;
    const res = await redeemGet(getCtx(url, env));

    assert.equal(res.status, 200);
    assert.deepEqual(r2.gets, [GUIDE_PDFS[LIVE_SLUG].r2Key], 'only the token\'s own key was fetched');
    assert.equal(await res.text(), careTeam);
    assert.equal(res.headers.get('content-disposition'), `attachment; filename="${LIVE_SLUG}.pdf"`);
    harness.close();
  });

  it('a token minted for the disabled guide serves THAT guide, not the live one', async () => {
    // The mirror image, so the assertion above cannot pass by accident just
    // because rrm-care-team is what the config would hand back anyway.
    const napro = '%PDF-1.7 NAPRO-CONTENT';
    const harness = db({ seed(s) { seedToken(s, { token: 'tok-napro', slug: OFF_SLUG }); } });
    const r2 = mockR2({
      [GUIDE_PDFS[LIVE_SLUG].r2Key]: '%PDF-1.7 CARE-TEAM-CONTENT',
      [GUIDE_PDFS[OFF_SLUG].r2Key]: napro,
    });
    const env = mockEnv({ DB: harness, R2_ASSETS: r2 });
    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-napro&guide_slug=${LIVE_SLUG}`, env));
    assert.equal(res.status, 200);
    assert.deepEqual(r2.gets, [GUIDE_PDFS[OFF_SLUG].r2Key]);
    assert.equal(await res.text(), napro);
    harness.close();
  });
});

describe('GET /api/pdf/redeem -- object-store failures roll the token back', () => {
  it('rolls used_at back to NULL when the bucket has no such object', async () => {
    // Without the rollback the reader loses their one shot to an outage that
    // was never their fault, and the link is dead forever.
    const harness = db({ seed(s) { seedToken(s, { token: 'tok-missing' }); } });
    const env = mockEnv({ DB: harness, R2_ASSETS: mockR2({}) });

    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-missing`, env));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${SITE}${GUIDE_PDFS[LIVE_SLUG].pagePath}?pdf_error=unavailable`);
    assert.equal(tokenRow(harness, 'tok-missing').used_at, null, 'token returned to the reader');
    harness.close();
  });

  it('rolls used_at back to NULL when the bucket throws', async () => {
    const harness = db({ seed(s) { seedToken(s, { token: 'tok-throw' }); } });
    const env = mockEnv({ DB: harness, R2_ASSETS: mockR2({}, { throwOn: true }) });

    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-throw`, env));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${SITE}${GUIDE_PDFS[LIVE_SLUG].pagePath}?pdf_error=unavailable`);
    assert.equal(tokenRow(harness, 'tok-throw').used_at, null);
    harness.close();
  });

  it('after a rollback the SAME token still redeems once the object is back', async () => {
    // The rollback is only worth anything if the link genuinely works again.
    const harness = db({ seed(s) { seedToken(s, { token: 'tok-retry' }); } });
    const key = GUIDE_PDFS[LIVE_SLUG].r2Key;
    const empty = mockR2({});
    await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-retry`, mockEnv({ DB: harness, R2_ASSETS: empty })));
    assert.equal(tokenRow(harness, 'tok-retry').used_at, null);

    const restored = mockR2({ [key]: '%PDF-1.7 restored' });
    const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-retry`, mockEnv({ DB: harness, R2_ASSETS: restored })));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '%PDF-1.7 restored');
    assert.ok(tokenRow(harness, 'tok-retry').used_at > 0, 'now spent for real');
    harness.close();
  });
});

describe('GET /api/pdf/redeem -- the /guides/ pagePath default', () => {
  it('falls back to /guides/ for a config entry that declares no pagePath', async () => {
    // `guideConfig.pagePath || '/guides/'` -- every entry shipping today sets
    // pagePath, so the default arm is only reachable via a config entry that
    // omits it. Added and removed here rather than left to a future edit that
    // forgets it and silently redirects readers to an undefined path.
    const slug = 'test-guide-without-pagepath';
    GUIDE_PDFS[slug] = { enabled: true, r2Key: 'guide-pdfs/test-no-pagepath.pdf', title: 'Test Guide' };
    try {
      const harness = db({ seed(s) { seedToken(s, { token: 'tok-nopath', slug, expiresAt: now() - 1 }); } });
      const env = mockEnv({ DB: harness, R2_ASSETS: mockR2({}) });
      const res = await redeemGet(getCtx(`${SITE}/api/pdf/redeem?token=tok-nopath`, env));
      assert.equal(res.headers.get('location'), `${SITE}/guides/?pdf_error=expired`);
      harness.close();
    } finally {
      delete GUIDE_PDFS[slug];
    }
  });
});

// ----------------------------------------------------- the round trip ---

describe('mint -> email -> redeem, end to end', () => {
  it('the link in the email downloads the PDF exactly once', async () => {
    const harness = db();
    const stub = stubExternalFetch();
    try {
      const env = mockEnv({ DB: harness, R2_ASSETS: mockR2({ [GUIDE_PDFS[LIVE_SLUG].r2Key]: '%PDF-1.7 end-to-end' }) });
      const minted = await onRequestPost(postCtx(
        { guide_slug: LIVE_SLUG, email: 'reader@example.com', turnstileToken: 'tok' }, { env }));
      assert.equal((await parseResponse(minted)).status, 200);

      // Pull the URL out of the delivered email rather than out of the database,
      // so the test follows the same path a reader does.
      const text = stub.ses[0].body.Content.Simple.Body.Text.Data;
      const link = /https:\/\/\S*\/api\/pdf\/redeem\?token=[0-9a-f-]{36}/.exec(text);
      assert.ok(link, `no redeem link in the email body: ${text}`);

      const download = await redeemGet(getCtx(link[0], env));
      assert.equal(download.status, 200);
      assert.equal(await download.text(), '%PDF-1.7 end-to-end');

      const replay = await redeemGet(getCtx(link[0], env));
      assert.equal(replay.status, 302);
      assert.match(replay.headers.get('location'), /pdf_error=used$/);
    } finally {
      stub.restore();
      harness.close();
    }
  });
});
