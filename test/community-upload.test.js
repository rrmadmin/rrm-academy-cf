/**
 * functions/api/community/upload.js -- the member image-upload surface.
 *
 * WHY A REAL ENGINE HERE
 * The first thing this endpoint does is `requireMember`, the canonical
 * membership gate in community/_shared.js. Every assertion below about who is
 * allowed to upload is only worth something if that gate actually ran, so it
 * is NOT stubbed: the harness is test/_d1-sqlite.mjs (node:sqlite loaded with
 * the committed rrm-auth schema) and the gate resolves membership out of real
 * `session` / `user` / `wix_subscription` / `user_label` rows. A canned mock
 * would let a test "prove" an anonymous request was refused while the gate it
 * was refused by was never executed.
 *
 * The request objects are real `Request`s carrying real `FormData`, so
 * `request.formData()` does genuine multipart parsing. A hand-rolled formData()
 * stub would hand back whatever File the test invented and the content-type /
 * size / magic-byte checks would be assertions about the fixture.
 *
 * WHAT IS STILL FAKED, AND WHAT THAT CANNOT DISTINGUISH
 *  - R2 is a recording stub. It proves which key/bytes/metadata the handler
 *    ASKS R2 to write; it cannot prove R2 accepts them, nor that two isolates
 *    racing on the same key behave as the test says.
 *  - The 10s R2 watchdog is collapsed by replacing globalThis.setTimeout for
 *    the duration of one test (see r2TimeoutClock). That proves the handler's
 *    timeout BRANCH, not that 10,000 ms is the right budget.
 *  - Analytics Engine and KV are the mockEnv stubs.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockEnv, mockWaitUntil, parseResponse, randomIp } from './_helpers.js';
import { sqliteD1, insertUser, insertSession, insertWixSubscription, insertLabel } from './_d1-sqlite.mjs';

const upload = await import('../functions/api/community/upload.js');

const MEMBER = 'u_member';
const OTHER_MEMBER = 'u_other';
const STAFF = 'u_staff';
const UNVERIFIED = 'u_unverified';
const BLOCKED = 'u_blocked';

const SESSION_MEMBER = 'raw-session-member';
const SESSION_OTHER = 'raw-session-other';
const SESSION_STAFF = 'raw-session-staff';
const SESSION_UNVERIFIED = 'raw-session-unverified';
const SESSION_BLOCKED = 'raw-session-blocked';

const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const MAX_SIZE = 5 * 1024 * 1024;

async function seededDb() {
  let handle;
  const db = sqliteD1({
    seed(sqlite) {
      handle = sqlite;
      insertUser(sqlite, { id: MEMBER, email: 'member@example.com', role: 'member', email_verified: 1 });
      insertUser(sqlite, { id: OTHER_MEMBER, email: 'other@example.com', role: 'member', email_verified: 1 });
      insertUser(sqlite, { id: STAFF, email: 'staff@example.com', role: 'admin', email_verified: 0 });
      insertUser(sqlite, { id: UNVERIFIED, email: 'unverified@example.com', role: 'member', email_verified: 0 });
      insertUser(sqlite, { id: BLOCKED, email: 'blocked@example.com', role: 'member', email_verified: 1, blocked: 1 });
      insertWixSubscription(sqlite, { email: 'member@example.com', user_id: MEMBER });
      insertWixSubscription(sqlite, { email: 'other@example.com', user_id: OTHER_MEMBER });
      // The unverified account is a paying member; only the email gate stands between
      // it and an upload, which is what makes the 403 below meaningful.
      insertWixSubscription(sqlite, { email: 'unverified@example.com', user_id: UNVERIFIED });
      insertLabel(sqlite, BLOCKED, 'STUC Legacy Grandfather');
    },
  });
  await Promise.all([
    insertSession(handle, { rawId: SESSION_MEMBER, userId: MEMBER, expiresAt: FUTURE }),
    insertSession(handle, { rawId: SESSION_OTHER, userId: OTHER_MEMBER, expiresAt: FUTURE }),
    insertSession(handle, { rawId: SESSION_STAFF, userId: STAFF, expiresAt: FUTURE }),
    insertSession(handle, { rawId: SESSION_UNVERIFIED, userId: UNVERIFIED, expiresAt: FUTURE }),
    insertSession(handle, { rawId: SESSION_BLOCKED, userId: BLOCKED, expiresAt: FUTURE }),
  ]);
  return db;
}

/** Recording R2 stub. `behaviour` may override what put() does. */
function r2Stub(behaviour) {
  const puts = [];
  return {
    puts,
    async put(key, body, opts) {
      puts.push({ key, body, opts });
      if (behaviour) return behaviour(key, body, opts);
      return { key };
    },
  };
}

function bytesWith(prefix, { size = 64, at = 0 } = {}) {
  const b = new Uint8Array(size);
  b.set(prefix, at);
  return b;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
/** RIFF....WEBP -- the handler sniffs bytes 8..11 only. */
const WEBP_BYTES = () => {
  const b = new Uint8Array(64);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  return b;
};

function png(size = 64) { return bytesWith(PNG_MAGIC, { size }); }
function jpeg(size = 64) { return bytesWith(JPEG_MAGIC, { size }); }
function gif(size = 64) { return bytesWith(GIF_MAGIC, { size }); }

/**
 * Builds a genuine multipart Request. `content-type` is left to FormData so the
 * boundary is real; `rawContentType` overrides it for the non-multipart case.
 */
function uploadRequest({
  bytes = png(),
  filename = 'photo.png',
  type = 'image/png',
  cookie = SESSION_MEMBER,
  ip = null,
  omitFile = false,
  stringPart = false,
  rawContentType = null,
} = {}) {
  const headers = {};
  if (cookie !== null) headers.Cookie = `session=${cookie}`;
  if (ip !== null) headers['CF-Connecting-IP'] = ip;

  if (rawContentType) {
    return new Request('https://rrmacademy.org/api/community/upload', {
      method: 'POST',
      body: 'not-multipart',
      headers: { ...headers, 'Content-Type': rawContentType },
    });
  }

  const fd = new FormData();
  if (stringPart) fd.set('file', 'just-a-string');
  else if (!omitFile) fd.set('file', new File([bytes], filename, { type }), filename);
  return new Request('https://rrmacademy.org/api/community/upload', { method: 'POST', body: fd, headers });
}

function ctx(db, request, envOverrides = {}) {
  return {
    request,
    env: mockEnv({ DB: db, R2_ASSETS: r2Stub(), ...envOverrides }),
    waitUntil: mockWaitUntil(),
  };
}

async function post(db, reqOpts = {}, envOverrides = {}) {
  const request = uploadRequest({ ip: reqOpts.ip === undefined ? randomIp() : reqOpts.ip, ...reqOpts });
  const context = ctx(db, request, envOverrides);
  const response = await upload.onRequestPost(context);
  return { parsed: await parseResponse(response), env: context.env };
}

describe('community/upload.js -- OPTIONS', () => {
  it('answers the preflight with 204 and the locked CORS origin', async () => {
    const response = await upload.onRequestOptions();
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
    assert.equal(await response.text(), '');
  });
});

describe('community/upload.js -- the membership gate decides who may write to R2', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('refuses an anonymous request 401 and never touches R2', async () => {
    const { parsed, env } = await post(db, { cookie: null });
    assert.equal(parsed.status, 401);
    assert.equal(parsed.body.error, 'Not authenticated');
    assert.equal(env.R2_ASSETS.puts.length, 0, 'an unauthenticated caller must not reach storage');
  });

  it('refuses a session whose user is blocked (validateSession treats blocked as invalid)', async () => {
    const { parsed, env } = await post(db, { cookie: SESSION_BLOCKED });
    assert.equal(parsed.status, 401);
    assert.equal(env.R2_ASSETS.puts.length, 0);
  });

  it('refuses a paying member whose email is unverified, 403, with the resend copy', async () => {
    const { parsed, env } = await post(db, { cookie: SESSION_UNVERIFIED });
    assert.equal(parsed.status, 403);
    assert.match(parsed.body.error, /verify your email/i);
    assert.equal(env.R2_ASSETS.puts.length, 0);
  });

  it('lets staff through even though their own email is unverified (documented staff bypass)', async () => {
    const { parsed, env } = await post(db, { cookie: SESSION_STAFF });
    assert.equal(parsed.status, 200);
    assert.equal(env.R2_ASSETS.puts.length, 1);
  });

  it('returns 500 when the DB binding is missing, rather than a silent success', async () => {
    const { parsed } = await post(db, {}, { DB: null });
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'Server misconfigured');
  });
});

describe('community/upload.js -- request-shape validation', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('503s when Cloudflare gave us no client IP (the rate limiter has nothing to key on)', async () => {
    const { parsed, env } = await post(db, { ip: null });
    assert.equal(parsed.status, 503);
    assert.equal(parsed.body.error, 'service_unavailable');
    assert.equal(env.R2_ASSETS.puts.length, 0);
  });

  it('rate-limits the 11th upload from one IP inside the window', async () => {
    const ip = randomIp();
    const env = mockEnv({ DB: db, R2_ASSETS: r2Stub() });
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const response = await upload.onRequestPost({
        request: uploadRequest({ ip }), env, waitUntil: mockWaitUntil(),
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200), 'the first ten must be allowed');
    assert.equal(statuses[10], 429, 'the eleventh must be refused');
    assert.equal(env.R2_ASSETS.puts.length, 10, 'the refused request must not have written to R2');
  });

  it('rejects a non-multipart body 400', async () => {
    const { parsed, env } = await post(db, { rawContentType: 'application/json' });
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'Multipart required');
    assert.equal(env.R2_ASSETS.puts.length, 0);
  });

  it('rejects a request carrying no Content-Type header at all 400 (the `|| \'\'` default arm)', async () => {
    const request = new Request('https://rrmacademy.org/api/community/upload', {
      method: 'POST',
      headers: { Cookie: `session=${SESSION_MEMBER}`, 'CF-Connecting-IP': randomIp() },
    });
    assert.equal(request.headers.get('content-type'), null, 'the fixture must genuinely omit the header');
    const context = ctx(db, request);
    const parsed = await parseResponse(await upload.onRequestPost(context));
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'Multipart required');
    assert.equal(context.env.R2_ASSETS.puts.length, 0);
  });

  it('rejects multipart with no file part 400', async () => {
    const { parsed } = await post(db, { omitFile: true });
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'No file provided');
  });

  it('rejects a text field masquerading as the file part 400 (no .size)', async () => {
    const { parsed } = await post(db, { stringPart: true });
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'No file provided');
  });

  it('rejects a zero-byte file 400', async () => {
    const { parsed } = await post(db, { bytes: new Uint8Array(0) });
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'No file provided');
  });
});

describe('community/upload.js -- the size cap at its exact boundary', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('accepts a file of exactly 5 MB', async () => {
    const { parsed, env } = await post(db, { bytes: png(MAX_SIZE) });
    assert.equal(parsed.status, 200, 'the cap is inclusive: exactly MAX_SIZE must pass');
    assert.equal(env.R2_ASSETS.puts[0].body.byteLength, MAX_SIZE);
  });

  it('refuses 5 MB plus one byte with 413 and writes nothing', async () => {
    const { parsed, env } = await post(db, { bytes: png(MAX_SIZE + 1) });
    assert.equal(parsed.status, 413);
    assert.equal(parsed.body.error, 'File too large (max 5 MB)');
    assert.equal(env.R2_ASSETS.puts.length, 0);
  });
});

describe('community/upload.js -- declared type allowlist and magic-byte agreement', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  for (const type of ['image/svg+xml', 'text/html', 'application/pdf', 'image/jpg', '']) {
    it(`refuses declared content-type ${JSON.stringify(type)} 400`, async () => {
      const { parsed, env } = await post(db, { type, filename: 'x.bin' });
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.error, 'Unsupported file type');
      assert.equal(env.R2_ASSETS.puts.length, 0);
    });
  }

  const accepted = [
    ['image/png', 'png', png()],
    ['image/jpeg', 'jpg', jpeg()],
    ['image/webp', 'webp', WEBP_BYTES()],
    ['image/gif', 'gif', gif()],
  ];
  for (const [type, ext, bytes] of accepted) {
    it(`accepts ${type} whose magic bytes agree, storing it as .${ext}`, async () => {
      const { parsed, env } = await post(db, { type, bytes, filename: `image.${ext}` });
      assert.equal(parsed.status, 200);
      assert.equal(parsed.body.ok, true);
      assert.match(parsed.body.url, new RegExp(`^/api/assets/community/[0-9a-f-]{36}\\.${ext}$`));
      assert.equal(env.R2_ASSETS.puts.length, 1);
      assert.equal(env.R2_ASSETS.puts[0].opts.httpMetadata.contentType, type);
      assert.deepEqual(new Uint8Array(env.R2_ASSETS.puts[0].body), bytes,
        'the bytes handed to R2 must be the bytes uploaded, unaltered');
    });
  }

  const mismatches = [
    ['image/png', jpeg()],
    ['image/jpeg', png()],
    ['image/webp', png()],
    ['image/gif', png()],
    // An HTML payload relabelled as a PNG: the classic stored-XSS delivery attempt.
    ['image/png', new TextEncoder().encode('<html><script>alert(1)</script></html>')],
  ];
  for (const [type, bytes] of mismatches) {
    it(`refuses ${type} whose first bytes disagree with the declared type`, async () => {
      const { parsed, env } = await post(db, { type, bytes });
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.error, 'File contents do not match declared type');
      assert.equal(env.R2_ASSETS.puts.length, 0, 'a sniff failure must never reach storage');
    });
  }

  it('refuses a webp shorter than the 12 bytes the RIFF sniff needs', async () => {
    const { parsed } = await post(db, { type: 'image/webp', bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]) });
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'File contents do not match declared type');
  });
});

describe('community/upload.js -- the storage key is server-controlled', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  const hostileNames = [
    '../../../etc/passwd.png',
    '..%2f..%2fsecret.png',
    'community/u_other/avatar.png',
    'a\u0000.png',
    'x'.repeat(400) + '.png',
  ];
  for (const filename of hostileNames) {
    it(`ignores the client filename ${JSON.stringify(filename.slice(0, 32))} entirely`, async () => {
      const { parsed, env } = await post(db, { filename });
      assert.equal(parsed.status, 200);
      const { key } = env.R2_ASSETS.puts[0];
      assert.match(key, /^community\/[0-9a-f-]{36}\.png$/,
        'the key must be prefix + server-generated UUID + extension, nothing caller-supplied');
      assert.equal(key.split('/').length, 2, 'no extra path segment may be introduced');
      assert.ok(!key.includes('..'), 'no traversal segment may survive');
      assert.equal(parsed.body.url, '/api/assets/' + key);
    });
  }

  it('gives two members uploading the identical filename two distinct keys', async () => {
    const first = await post(db, { cookie: SESSION_MEMBER, filename: 'avatar.png' });
    const second = await post(db, { cookie: SESSION_OTHER, filename: 'avatar.png' });
    const keyA = first.env.R2_ASSETS.puts[0].key;
    const keyB = second.env.R2_ASSETS.puts[0].key;
    assert.notEqual(keyA, keyB, 'a shared filename must not let one member overwrite another member object');
  });

  it('derives the extension from the declared type, not from the filename suffix', async () => {
    const { parsed, env } = await post(db, { type: 'image/gif', bytes: gif(), filename: 'trap.png.php' });
    assert.equal(parsed.status, 200);
    assert.match(env.R2_ASSETS.puts[0].key, /\.gif$/);
    assert.ok(!env.R2_ASSETS.puts[0].key.includes('.php'));
  });
});

describe('community/upload.js -- storage failure paths', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('returns 504 upload_timeout when the R2 put outlives the watchdog', async () => {
    // The handler races put() against a 10,000 ms timer. Collapse only that timer
    // so the branch runs in test time; the delay VALUE is asserted, not waited on.
    const realSetTimeout = globalThis.setTimeout;
    const delays = [];
    globalThis.setTimeout = (fn, ms, ...rest) => {
      delays.push(ms);
      return realSetTimeout(fn, 0, ...rest);
    };
    const events = [];
    try {
      const hangingR2 = { puts: [], put() { return new Promise(() => {}); } };
      const { parsed } = await post(db, {}, {
        R2_ASSETS: hangingR2,
        EVENTS: { writeDataPoint(d) { events.push(d); } },
      });
      assert.equal(parsed.status, 504);
      assert.equal(parsed.body.error, 'upload_timeout');
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    assert.ok(delays.includes(10000), 'the watchdog budget must still be 10s');
    const logged = events.find(e => e.blobs?.includes('upload_timeout'));
    assert.ok(logged, 'a timeout must be logged to Analytics Engine');
    assert.match(logged.blobs[4], /^community\/[0-9a-f-]{36}\.png$/, 'the log must name the key that timed out');
  });

  it('returns 500 (never 200) when R2 rejects for any other reason, and leaks no detail', async () => {
    const failingR2 = { puts: [], put() { return Promise.reject(new Error('R2: bucket unavailable xyz')); } };
    const { parsed } = await post(db, {}, { R2_ASSETS: failingR2 });
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'Upload failed');
    assert.ok(!JSON.stringify(parsed.body).includes('bucket unavailable'),
      'the storage error text must not reach the client');
  });

  it('returns 500 when the R2 binding is missing entirely', async () => {
    const { parsed } = await post(db, {}, { R2_ASSETS: undefined });
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'Upload failed');
  });

  it('answers success with the CORS origin the guard pins', async () => {
    const { parsed } = await post(db, {});
    assert.equal(parsed.status, 200);
    assert.equal(parsed.headers['access-control-allow-origin'], 'https://rrmacademy.org');
    assert.equal(parsed.headers['content-type'], 'application/json');
  });
});
