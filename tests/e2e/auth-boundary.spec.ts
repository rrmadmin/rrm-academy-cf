import { test, expect } from '@playwright/test';

// Auth surface boundary (anonymous callers only — verified against endpoint source).
//
// IMPORTANT: page gating on this site is CLIENT-SIDE + API-level, NOT server middleware.
// functions/_middleware.js does NOT redirect static HTML page routes (see memory
// cf-pages-middleware-static-route-bypass) — a logged-out GET to /account/ returns 200
// and the page JS gates content. So the real boundary is:
//   - Auth PAGES (/login/, /signup/, /forgot-password/, /reset-password/, /account/)
//     serve 200 anonymously (static shells, client-gated).
//   - Auth DATA/mutations are gated inside functions/api/auth/* handlers.
//
// PROD-SAFETY CONTRACT (hard): every assertion below is a GET, an anonymous-rejection
// check, or a malformed/incomplete-POST contract check that the source code rejects
// BEFORE any DB write, session mint, or email send. Zero mutating success paths.
// Request volume is kept to 1-2 per endpoint — login/signup/forgot/reset share
// 5-per-15-min per-IP rate limits and each Turnstile-path probe consumes one slot.
//
// Run against the live site or a local wrangler pages dev:
//   AUTH_E2E_BASE=https://rrmacademy.org npx playwright test tests/e2e/auth-boundary.spec.ts --project=desktop-chrome
// Not wired into CI (deploy.yml runs no e2e); this is a local + post-deploy regression aid.

const BASE = process.env.AUTH_E2E_BASE || 'http://localhost:8788';
test.use({ baseURL: BASE });

// Never a real password; only sent on paths the source rejects before any credential use.
const PROBE_PASSWORD = 'Zq7vRk2mX9pLwT4b';

test.describe('Auth pages — static shells serve 200 anonymously (client-gated)', () => {
  for (const path of ['/login/', '/signup/', '/forgot-password/', '/reset-password/', '/account/']) {
    test(`page ${path} serves 200`, async ({ request }) => {
      const resp = await request.get(path, { maxRedirects: 0 });
      expect(resp.status(), `${path} is a static shell; middleware must not redirect it`).toBe(200);
    });
  }
});

test.describe('GET /api/auth/session — anonymous no-session shape', () => {
  test('anonymous returns 200 { ok: true, user: null }', async ({ request }) => {
    const resp = await request.get('/api/auth/session', { maxRedirects: 0 });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toMatchObject({ ok: true, user: null });
  });
});

test.describe('POST /api/auth/login — malformed input contract', () => {
  test('empty object body rejected 400 before rate limit / DB lookup', async ({ request }) => {
    // login.js: isValidEmail('') fails -> 400 'Invalid email or password.'
    // This branch runs BEFORE checkRateLimit and before any user SELECT.
    const resp = await request.post('/api/auth/login', { data: {} });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Invalid email or password.');
  });

  test('missing Turnstile token rejected 403 before any DB read/write or email', async ({ request }) => {
    // login.js order: body validation -> rate limit -> verifyTurnstile -> user lookup.
    // verifyTurnstile (_shared.js) returns { ok:false, reason:'missing_token' } for an
    // absent token (or 'misconfigured' if the secret is unset) — both map to 403, and
    // the rejection happens BEFORE the user SELECT, password verify, session INSERT,
    // and the passwordless-guidance email path. Consumes 1 of 5 login rate slots.
    const resp = await request.post('/api/auth/login', {
      data: { email: 'e2e-boundary@example.org', password: PROBE_PASSWORD },
    });
    expect(resp.status()).toBe(403);
    const body = await resp.json();
    expect(body.ok).toBe(false);
  });
});

test.describe('POST /api/auth/signup — malformed input contract', () => {
  test('empty object body rejected 400 by validateBody before rate limit', async ({ request }) => {
    // signup.js: validateBody requires firstName/lastName/email -> 400 'firstName is required'.
    // Runs BEFORE checkRateLimit, Turnstile, ELV, and all INSERTs/emails.
    const resp = await request.post('/api/auth/signup', { data: {} });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('firstName is required');
  });

  test('missing Turnstile token rejected 403 before ELV, DB writes, and emails', async ({ request }) => {
    // signup.js order: validateBody -> password check -> rate limit -> AWS key check ->
    // verifyTurnstile -> (deep email validation -> user INSERT -> verification email).
    // The Turnstile 403 fires before validateEmail/ELV, before the existing-user lookup
    // (so no collision email), and before any DB write. No account is created and no
    // email can be triggered on this path. Consumes 1 of 5 signup rate slots.
    const resp = await request.post('/api/auth/signup', {
      data: {
        firstName: 'E2E',
        lastName: 'Boundary',
        email: 'e2e-boundary-no-turnstile@example.org',
        password: PROBE_PASSWORD,
      },
    });
    expect(resp.status()).toBe(403);
    const body = await resp.json();
    expect(body.ok).toBe(false);
  });
});

test.describe('Session-required auth endpoints reject anonymous callers', () => {
  test('POST /api/auth/change-password anonymous -> 401', async ({ request }) => {
    // change-password.js: validateSession runs before body parse -> 401 'Not logged in.'
    const resp = await request.post('/api/auth/change-password', { data: {} });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe('Not logged in.');
  });

  test('PATCH /api/auth/profile anonymous -> 401', async ({ request }) => {
    // profile.js: rate limit (60/min per IP) then validateSession -> 401 'Not authenticated.'
    const resp = await request.patch('/api/auth/profile', { data: {} });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe('Not authenticated.');
  });

  test('POST /api/auth/resend-verification anonymous -> 401', async ({ request }) => {
    // resend-verification.js: validateSession before rate limit and SES -> 401.
    const resp = await request.post('/api/auth/resend-verification', { data: {} });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe('Not authenticated.');
  });
});

test.describe('Token-redemption endpoints — garbage tokens rejected without side effects', () => {
  test('POST /api/auth/reset-password with garbage token -> 400', async ({ request }) => {
    // reset-password.js: token+password format pass, rate limit (1 of 5 slots), then the
    // password_reset lookup finds no row for a garbage token hash -> 400 BEFORE the
    // atomic consume/UPDATE batch. No mutation occurs.
    const resp = await request.post('/api/auth/reset-password', {
      data: { token: 'e2e-boundary-garbage-token', password: PROBE_PASSWORD },
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('invalid, expired');
  });

  test('GET /api/auth/verify-email with malformed token -> 400 HTML', async ({ request }) => {
    // verify-email.js GET is documented side-effect-free (no DB writes, no token consume);
    // a token failing isValidTokenFormat renders the invalid-link page with status 400.
    const resp = await request.get('/api/auth/verify-email?token=not-a-hex-token', { maxRedirects: 0 });
    expect(resp.status()).toBe(400);
    expect(resp.headers()['content-type'] || '').toContain('text/html');
  });
});
